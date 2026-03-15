import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { ensureSystemSeed } from '../../../lib/bootstrap';

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

    const { date, partyName, gstNumber, warehouseId, items, cgstRate, sgstRate } = await request.json();
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
      lineItems.push({ productId: String(product._id), name: product.name, price: product.price, qty, amount: qty * product.price });
    }

    for (const line of lineItems) {
      await db.collection('inventory').updateOne({ warehouseId, productId: line.productId }, { $inc: { quantity: -line.qty } });
    }

    const subtotal = lineItems.reduce((sum, l) => sum + l.amount, 0);
    const resolvedCgstRate = Number.isFinite(Number(cgstRate)) ? Number(cgstRate) : 9;
    const resolvedSgstRate = Number.isFinite(Number(sgstRate)) ? Number(sgstRate) : 9;
    const cgstAmount = subtotal * (resolvedCgstRate / 100);
    const sgstAmount = subtotal * (resolvedSgstRate / 100);
    const gstAmount = cgstAmount + sgstAmount;
    const total = subtotal + gstAmount;

    const order = {
      orderId: `ORD-${Date.now()}`,
      ownerUserId: warehouse.ownerUserId,
      warehouseId,
      date,
      partyName,
      gstNumber: gstNumber || '',
      cgstRate: resolvedCgstRate,
      sgstRate: resolvedSgstRate,
      items: lineItems,
      subtotal,
      cgstAmount,
      sgstAmount,
      gstAmount,
      total,
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

    if (role !== 'admin' && order.ownerUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
