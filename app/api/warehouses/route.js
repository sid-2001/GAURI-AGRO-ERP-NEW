import { NextResponse } from 'next/server';
import { ensureSystemSeed } from '../../../lib/bootstrap';

export async function GET(request) {
  try {
    const db = await ensureSystemSeed();
    const role = request.headers.get('x-user-role');
    const userId = request.headers.get('x-user-id');
    const forUserId = request.nextUrl.searchParams.get('userId');
    const all = request.nextUrl.searchParams.get('all') === '1';

    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let query = { ownerUserId: userId };
    if (role === 'admin' && all) {
      query = {};
    } else if (role === 'admin') {
      query = { ownerUserId: forUserId || userId };
    }

    const warehouses = await db.collection('warehouses').find(query).sort({ createdAt: -1 }).toArray();
    return NextResponse.json(warehouses.map((w) => ({ ...w, _id: String(w._id) })));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const role = request.headers.get('x-user-role');
    const userId = request.headers.get('x-user-id');
    if (!userId || !role) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { name, location, ownerUserId } = await request.json();
    const db = await ensureSystemSeed();
    const targetOwner = role === 'admin' ? String(ownerUserId || userId) : userId;

    if (!name) {
      return NextResponse.json({ error: 'Warehouse name required' }, { status: 400 });
    }

    const created = await db.collection('warehouses').insertOne({
      ownerUserId: targetOwner,
      name: String(name).trim(),
      location: String(location || '').trim(),
      createdAt: new Date()
    });

    return NextResponse.json({ success: true, id: String(created.insertedId) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
