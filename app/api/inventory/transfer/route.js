import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { ensureSystemSeed } from '../../../../lib/bootstrap';

export async function POST(request) {
  try {
    const role = request.headers.get('x-user-role');
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Only admin can transfer stock' }, { status: 403 });
    }

    const { fromWarehouseId, toWarehouseId, productId, quantity } = await request.json();
    const qty = Number(quantity || 0);
    if (!fromWarehouseId || !toWarehouseId || !productId || qty <= 0) {
      return NextResponse.json({ error: 'Invalid transfer payload' }, { status: 400 });
    }

    const db = await ensureSystemSeed();
    const fromWarehouse = await db.collection('warehouses').findOne({ _id: new ObjectId(fromWarehouseId) });
    const toWarehouse = await db.collection('warehouses').findOne({ _id: new ObjectId(toWarehouseId) });

    if (!fromWarehouse || !toWarehouse) {
      return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 });
    }

    const fromItem = await db.collection('inventory').findOne({ warehouseId: fromWarehouseId, productId });
    if (!fromItem || fromItem.quantity < qty) {
      return NextResponse.json({ error: 'Insufficient source inventory' }, { status: 400 });
    }

    await db.collection('inventory').updateOne(
      { warehouseId: fromWarehouseId, productId },
      { $inc: { quantity: -qty } }
    );

    await db.collection('inventory').updateOne(
      { warehouseId: toWarehouseId, productId },
      { $inc: { quantity: qty }, $setOnInsert: { ownerUserId: toWarehouse.ownerUserId } },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
