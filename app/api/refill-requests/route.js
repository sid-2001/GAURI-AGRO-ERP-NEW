import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { ensureSystemSeed } from '../../../lib/bootstrap';

export async function GET(request) {
  try {
    const role = request.headers.get('x-user-role');
    const userId = request.headers.get('x-user-id');
    if (!role || !userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const db = await ensureSystemSeed();
    const query = role === 'admin' ? {} : { vendorUserId: userId };
    const rows = await db.collection('refillRequests').find(query).sort({ createdAt: -1 }).toArray();
    return NextResponse.json(rows.map((row) => ({ ...row, _id: String(row._id) })));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const role = request.headers.get('x-user-role');
    const userId = request.headers.get('x-user-id');
    if (!role || !userId || role === 'admin') return NextResponse.json({ error: 'Only vendor can create request' }, { status: 403 });

    const { warehouseId, productId, quantity } = await request.json();
    const qty = Number(quantity || 0);
    if (!warehouseId || !productId || qty <= 0) return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });

    const db = await ensureSystemSeed();
    const warehouse = await db.collection('warehouses').findOne({ _id: new ObjectId(warehouseId) });
    if (!warehouse || warehouse.ownerUserId !== userId) return NextResponse.json({ error: 'Forbidden warehouse access' }, { status: 403 });
    const product = await db.collection('products').findOne({ _id: new ObjectId(productId) });
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });

    const vendor = await db.collection('users').findOne({ _id: new ObjectId(userId) });
    const requestRow = {
      vendorUserId: userId,
      warehouseId,
      productId,
      productName: product.name,
      quantity: qty,
      status: 'pending',
      vendorFirmName: vendor?.firmName || '',
      vendorGstNumber: vendor?.gstNumber || '',
      vendorBillingAddress: vendor?.billingAddress || '',
      createdAt: new Date()
    };

    const result = await db.collection('refillRequests').insertOne(requestRow);
    return NextResponse.json({ success: true, id: String(result.insertedId) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const role = request.headers.get('x-user-role');
    if (role !== 'admin') return NextResponse.json({ error: 'Only admin can update request' }, { status: 403 });

    const { id, action } = await request.json();
    if (!id || !['approve', 'reject'].includes(action)) return NextResponse.json({ error: 'Invalid action payload' }, { status: 400 });

    const db = await ensureSystemSeed();
    const reqDoc = await db.collection('refillRequests').findOne({ _id: new ObjectId(id) });
    if (!reqDoc) return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    if (reqDoc.status !== 'pending') return NextResponse.json({ error: 'Request already processed' }, { status: 400 });

    if (action === 'reject') {
      await db.collection('refillRequests').updateOne({ _id: new ObjectId(id) }, { $set: { status: 'rejected', processedAt: new Date() } });
      return NextResponse.json({ success: true });
    }

    const admin = await db.collection('users').findOne({ role: 'admin' });
    const adminWarehouse = await db.collection('warehouses').findOne({ ownerUserId: String(admin._id) });
    const sourceItem = await db.collection('inventory').findOne({ warehouseId: String(adminWarehouse._id), productId: reqDoc.productId });
    if (!sourceItem || sourceItem.quantity < reqDoc.quantity) {
      return NextResponse.json({ error: 'Insufficient admin inventory for refill' }, { status: 400 });
    }

    await db.collection('inventory').updateOne({ warehouseId: String(adminWarehouse._id), productId: reqDoc.productId }, { $inc: { quantity: -reqDoc.quantity } });
    await db.collection('inventory').updateOne(
      { warehouseId: reqDoc.warehouseId, productId: reqDoc.productId },
      { $inc: { quantity: reqDoc.quantity }, $setOnInsert: { ownerUserId: reqDoc.vendorUserId } },
      { upsert: true }
    );

    const product = await db.collection('products').findOne({ _id: new ObjectId(reqDoc.productId) });
    const amount = reqDoc.quantity * Number(product?.price || 0);
    const gstRate = Number(product?.gstRate || 0);
    const gstAmount = amount * (gstRate / 100);
    const order = {
      orderId: `REFILL-${Date.now()}`,
      ownerUserId: reqDoc.vendorUserId,
      warehouseId: reqDoc.warehouseId,
      date: new Date().toISOString().slice(0, 10),
      partyName: reqDoc.vendorFirmName || 'Vendor Refill',
      gstNumber: reqDoc.vendorGstNumber || '',
      discountPercent: 0,
      discountAmount: 0,
      subtotal: amount,
      taxableSubtotal: amount,
      cgstAmount: gstAmount / 2,
      sgstAmount: gstAmount / 2,
      gstAmount,
      total: amount + gstAmount,
      items: [{ productId: reqDoc.productId, name: reqDoc.productName, price: Number(product?.price || 0), qty: reqDoc.quantity, amount, gstRate, gstAmount }],
      vendorId: reqDoc.vendorUserId,
      vendorFirmName: reqDoc.vendorFirmName || '',
      vendorGstNumber: reqDoc.vendorGstNumber || '',
      vendorBillingAddress: reqDoc.vendorBillingAddress || '',
      orderType: 'refill',
      createdAt: new Date()
    };
    const insertedOrder = await db.collection('orders').insertOne(order);

    await db.collection('refillRequests').updateOne(
      { _id: new ObjectId(id) },
      { $set: { status: 'approved', processedAt: new Date(), refillOrderId: String(insertedOrder.insertedId) } }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
