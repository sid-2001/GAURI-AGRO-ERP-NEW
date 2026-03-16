import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { ensureSystemSeed } from '../../../../lib/bootstrap';

export async function POST(request) {
  try {
    const role = request.headers.get('x-user-role');
    const userId = request.headers.get('x-user-id');

    if (!role || !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { warehouseId, productId, delta } = await request.json();
    const qty = Number(delta || 0);

    if (!warehouseId || !productId || !Number.isFinite(qty)) {
      return NextResponse.json({ error: 'Invalid adjustment payload' }, { status: 400 });
    }

    const db = await ensureSystemSeed();
    const warehouse = await db.collection('warehouses').findOne({ _id: new ObjectId(warehouseId) });
    if (!warehouse) {
      return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 });
    }

    if (role !== 'admin' && warehouse.ownerUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (role !== 'admin' && qty > 0) {
      return NextResponse.json({ error: 'Vendors can only deduct inventory' }, { status: 403 });
    }

    const current = await db.collection('inventory').findOne({ warehouseId, productId });
    const nextQty = (current?.quantity || 0) + qty;
    if (nextQty < 0) {
      return NextResponse.json({ error: 'Adjustment leads to negative inventory' }, { status: 400 });
    }

    await db.collection('inventory').updateOne(
      { warehouseId, productId },
      { $set: { ownerUserId: warehouse.ownerUserId }, $inc: { quantity: qty } },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
