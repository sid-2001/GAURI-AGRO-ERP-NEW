import { ObjectId } from 'mongodb';
import { getDb } from './mongodb';

export async function ensureSystemSeed() {
  const db = await getDb();

  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

  let admin = await db.collection('users').findOne({ role: 'admin' });
  if (!admin) {
    const result = await db.collection('users').insertOne({
      username: adminUsername,
      password: adminPassword,
      role: 'admin',
      createdAt: new Date()
    });
    admin = { _id: new ObjectId(result.insertedId), username: adminUsername, role: 'admin' };
  }

  const productCount = await db.collection('products').countDocuments();
  if (!productCount) {
    await db.collection('products').insertMany([
      { name: 'Neem Fertilizer', price: 450 },
      { name: 'Organic Pesticide', price: 620 },
      { name: 'Soil Booster Mix', price: 390 }
    ]);
  }

  const adminWarehouse = await db.collection('warehouses').findOne({ ownerUserId: String(admin._id), name: 'Admin Main' });
  if (!adminWarehouse) {
    const wh = await db.collection('warehouses').insertOne({
      ownerUserId: String(admin._id),
      name: 'Admin Main',
      location: 'HQ',
      createdAt: new Date()
    });
    const products = await db.collection('products').find({}).toArray();
    if (products.length) {
      await db.collection('inventory').insertMany(
        products.map((p) => ({
          ownerUserId: String(admin._id),
          warehouseId: String(wh.insertedId),
          productId: String(p._id),
          quantity: 200
        }))
      );
    }
  }

  return db;
}
