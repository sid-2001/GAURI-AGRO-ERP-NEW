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

    const warehouseId = request.nextUrl.searchParams.get('warehouseId');
    if (!warehouseId) {
      return NextResponse.json({ error: 'warehouseId is required' }, { status: 400 });
    }

    const db = await ensureSystemSeed();
    const warehouse = await db.collection('warehouses').findOne({ _id: new ObjectId(warehouseId) });
    if (!warehouse) {
      return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 });
    }

    if (role !== 'admin' && warehouse.ownerUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const items = await db.collection('inventory').find({ warehouseId }).toArray();
    const products = await db.collection('products').find({}).toArray();
    const productMap = new Map(products.map((p) => [String(p._id), p]));

    const rows = items.map((item) => {
      const p = productMap.get(item.productId);
      return {
        ...item,
        _id: String(item._id),
        product: p ? { ...p, _id: String(p._id) } : null
      };
    });

    return NextResponse.json(rows);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const role = request.headers.get('x-user-role');
    const userId = request.headers.get('x-user-id');
    if (!role || !userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { warehouseId, productId, quantity } = await request.json();
    if (!warehouseId || !productId || Number(quantity) < 0) {
      return NextResponse.json({ error: 'Invalid update payload' }, { status: 400 });
    }

    const db = await ensureSystemSeed();
    const warehouse = await db.collection('warehouses').findOne({ _id: new ObjectId(warehouseId) });
    if (!warehouse) {
      return NextResponse.json({ error: 'Warehouse not found' }, { status: 404 });
    }

    if (role !== 'admin' && warehouse.ownerUserId !== userId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await db.collection('inventory').updateOne(
      { warehouseId, productId },
      { $set: { quantity: Number(quantity), ownerUserId: warehouse.ownerUserId } },
      { upsert: true }
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
