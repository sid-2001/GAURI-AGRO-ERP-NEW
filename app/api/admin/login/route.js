import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '').trim();

    const adminUser = process.env.ADMIN_USERNAME || 'admin';
    const adminPass = process.env.ADMIN_PASSWORD || 'admin123';

    if (username !== adminUser || password !== adminPass) {
      return NextResponse.json({ error: 'Invalid admin credentials.' }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      token: 'admin-authenticated',
      user: { role: 'admin', username: adminUser }
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
