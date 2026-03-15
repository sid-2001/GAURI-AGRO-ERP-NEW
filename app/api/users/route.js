import { NextResponse } from 'next/server';
import { ensureSystemSeed } from '../../../lib/bootstrap';

function isAdmin(request) {
  return request.headers.get('x-user-role') === 'admin';
}

export async function GET(request) {
  try {
    if (!isAdmin(request)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const db = await ensureSystemSeed();
    const users = await db.collection('users').find({ role: 'user' }).sort({ createdAt: -1 }).toArray();
    return NextResponse.json(users.map((u) => ({ ...u, _id: String(u._id), password: undefined })));
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    if (!isAdmin(request)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const username = String(body.username || '').trim();
    const password = String(body.password || '').trim();
    const warehouseName = String(body.warehouseName || '').trim() || `${username} Main`;
    const warehouseLocation = String(body.warehouseLocation || '').trim() || 'Default';

    if (!username || !password) {
      return NextResponse.json({ error: 'Username and password are required' }, { status: 400 });
    }

    const db = await ensureSystemSeed();
    const existing = await db.collection('users').findOne({ username });
    if (existing) {
      return NextResponse.json({ error: 'Username already exists' }, { status: 400 });
    }

    const userRes = await db.collection('users').insertOne({ username, password, role: 'user', createdAt: new Date() });
    const userId = String(userRes.insertedId);
    await db.collection('warehouses').insertOne({ ownerUserId: userId, name: warehouseName, location: warehouseLocation, createdAt: new Date() });

    return NextResponse.json({ success: true, userId }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
