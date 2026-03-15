import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { ensureSystemSeed } from '../../../lib/bootstrap';

export async function GET() {
  try {
    const db = await ensureSystemSeed();
    const products = await db.collection('products').find({}).sort({ name: 1 }).toArray();
    return NextResponse.json(products.map((p) => ({ ...p, _id: String(p._id) })));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const role = request.headers.get('x-user-role');
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Only admin can create products' }, { status: 403 });
    }

    const { name, price } = await request.json();
    if (!name || Number(price) <= 0) {
      return NextResponse.json({ error: 'Invalid product data' }, { status: 400 });
    }

    const db = await ensureSystemSeed();
    const result = await db.collection('products').insertOne({ name: String(name).trim(), price: Number(price) });
    return NextResponse.json({ success: true, id: String(result.insertedId) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const role = request.headers.get('x-user-role');
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Only admin can edit products' }, { status: 403 });
    }

    const { id, name, price } = await request.json();
    if (!id || !name || Number(price) <= 0) {
      return NextResponse.json({ error: 'Invalid product update data' }, { status: 400 });
    }

    const db = await ensureSystemSeed();
    const result = await db.collection('products').updateOne(
      { _id: new ObjectId(id) },
      { $set: { name: String(name).trim(), price: Number(price) } }
    );

    if (!result.matchedCount) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
