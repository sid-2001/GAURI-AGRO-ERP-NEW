import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { ensureSystemSeed } from '../../../lib/bootstrap';

const formatUserSnapshot = (user) => ({
  vendorId: String(user?._id || ''),
  vendorUsername: user?.username || '',
  vendorFirmName: user?.firmName || '',
  vendorGstNumber: user?.gstNumber || '',
  vendorBillingAddress: user?.billingAddress || ''
});

export async function GET(request) {
  try {
    const role = request.headers.get('x-user-role');
    const userId = request.headers.get('x-user-id');
    if (!role || !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const query = role === 'admin' ? {} : { ownerUserId: userId };
    const db = await ensureSystemSeed();
    const orders = await db.collection('orders').find(query).sort({ createdAt: -1 }).toArray();
    return NextResponse.json(orders.map((o) => ({ ...o, _id: String(o._id) })));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const role = request.headers.get('x-user-role');
    const userId = request.headers.get('x-user-id');
    if (!role || !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { date, partyName, gstNumber, warehouseId, items, discountPercent } = await request.json();
    if (!date || !partyName || !warehouseId || !Array.isArray(items) || !items.length) {
      return NextResponse.json({ error: 'Invalid bill data' }, { status: 400 });
    }

    const db = await ensureSystemSeed();
    const warehouse = await db.collection('warehouses').findOne({ _id: new ObjectId(warehouseId) });
    if (!warehouse) {
      return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 });
    }
    if (role !== 'admin' && warehouse.ownerUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden warehouse access' }, { status: 403 });
    }

    const owner = await db.collection('users').findOne({ _id: new ObjectId(warehouse.ownerUserId) });
    const products = await db.collection('products').find({ _id: { $in: items.map((i) => new ObjectId(i.productId)) } }).toArray();
    const productMap = new Map(products.map((p) => [String(p._id), p]));

    const lineItems = [];
    for (const item of items) {
      const qty = Number(item.qty || 0);
      const product = productMap.get(String(item.productId));
      if (!product || qty <= 0) {
        return NextResponse.json({ error: 'Invalid item in bill' }, { status: 400 });
      }
      const stock = await db.collection('inventory').findOne({ warehouseId, productId: String(product._id) });
      if (!stock || stock.quantity < qty) {
        return NextResponse.json({ error: `Insufficient stock for ${product.name}` }, { status: 400 });
      }
      const amount = qty * product.price;
      const gstRate = Number(product.gstRate || 0);
      const gstAmount = amount * (gstRate / 100);
      lineItems.push({ productId: String(product._id), name: product.name, price: product.price, qty, gstRate, amount, gstAmount });
    }

    for (const line of lineItems) {
      await db.collection('inventory').updateOne({ warehouseId, productId: line.productId }, { $inc: { quantity: -line.qty } });
    }

    const subtotal = lineItems.reduce((sum, l) => sum + l.amount, 0);
    const resolvedDiscount = Math.max(0, Number(discountPercent || 0));
    const discountAmount = subtotal * (resolvedDiscount / 100);
    const taxableSubtotal = Math.max(0, subtotal - discountAmount);
    const gstAmount = lineItems.reduce((sum, l) => sum + l.gstAmount, 0) * (taxableSubtotal / (subtotal || 1));
    const cgstAmount = gstAmount / 2;
    const sgstAmount = gstAmount / 2;
    const total = taxableSubtotal + gstAmount;

    const order = {
      orderId: `ORD-${Date.now()}`,
      ownerUserId: warehouse.ownerUserId,
      warehouseId,
      date,
      partyName,
      gstNumber: gstNumber || '',
      discountPercent: resolvedDiscount,
      discountAmount,
      items: lineItems,
      subtotal,
      taxableSubtotal,
      cgstAmount,
      sgstAmount,
      gstAmount,
      total,
      ...formatUserSnapshot(owner),
      createdAt: new Date()
    };

    const result = await db.collection('orders').insertOne(order);
    const created = await db.collection('orders').findOne({ _id: new ObjectId(result.insertedId) });
    return NextResponse.json({ ...created, _id: String(created._id) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request) {
  try {
    const role = request.headers.get('x-user-role');
    const userId = request.headers.get('x-user-id');
    if (!role || !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Order id required' }, { status: 400 });
    }

    const db = await ensureSystemSeed();
    const order = await db.collection('orders').findOne({ _id: new ObjectId(id) });
    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }

    if (role !== 'admin') {
      return NextResponse.json({ error: 'Only admin can delete bills' }, { status: 403 });
    }

    for (const line of order.items || []) {
      await db.collection('inventory').updateOne(
        { warehouseId: order.warehouseId, productId: line.productId },
        { $inc: { quantity: Number(line.qty || 0) }, $setOnInsert: { ownerUserId: order.ownerUserId } },
        { upsert: true }
      );
    }

    await db.collection('orders').deleteOne({ _id: new ObjectId(id) });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
