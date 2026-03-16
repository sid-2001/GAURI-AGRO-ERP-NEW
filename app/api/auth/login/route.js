import { NextResponse } from 'next/server';
import { ensureSystemSeed } from '../../../../lib/bootstrap';

export async function POST(request) {
  try {
    const { username, password } = await request.json();
    const db = await ensureSystemSeed();

    const user = await db.collection('users').findOne({
      username: String(username || '').trim(),
      password: String(password || '').trim()
    });

    if (!user) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
    }

    return NextResponse.json({
      user: {
        _id: String(user._id),
        username: user.username,
        role: user.role,
        firmName: user.firmName || "",
        gstNumber: user.gstNumber || "",
        billingAddress: user.billingAddress || ""
      }
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
