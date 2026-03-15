'use client';

import { useEffect, useMemo, useState } from 'react';

const TABS = ['billing', 'inventory', 'orders', 'dashboard', 'admin'];

const authHeaders = (user) => ({
  'Content-Type': 'application/json',
  'x-user-id': user?._id || '',
  'x-user-role': user?.role || ''
});

const fmt = (v) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v || 0);

export default function Home() {
  const [tab, setTab] = useState('billing');
  const [user, setUser] = useState(null);
  const [login, setLogin] = useState({ username: '', password: '' });

  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ username: '', password: '', warehouseName: '', warehouseLocation: '' });

  const [warehouses, setWarehouses] = useState([]);
  const [allWarehouses, setAllWarehouses] = useState([]);
  const [selectedWarehouse, setSelectedWarehouse] = useState('');

  const [products, setProducts] = useState([]);
  const [newProduct, setNewProduct] = useState({ name: '', price: '' });
  const [editingProduct, setEditingProduct] = useState({ id: '', name: '', price: '' });

  const [inventory, setInventory] = useState([]);
  const [orders, setOrders] = useState([]);

  const [bill, setBill] = useState({ date: new Date().toISOString().slice(0, 10), partyName: '', gstNumber: '', items: [] });
  const [transfer, setTransfer] = useState({ fromWarehouseId: '', toWarehouseId: '', productId: '', quantity: 0 });
  const [adjust, setAdjust] = useState({ productId: '', delta: 0 });

  const loadAll = async (u = user, wh = selectedWarehouse) => {
    if (!u) return;
    const h = authHeaders(u);

    const warehouseUrl = u.role === 'admin' ? '/api/warehouses?all=1' : '/api/warehouses';
    const [pRes, wRes, oRes] = await Promise.all([
      fetch('/api/products', { headers: h }),
      fetch(warehouseUrl, { headers: h }),
      fetch('/api/orders', { headers: h })
    ]);

    const [p, w, o] = await Promise.all([pRes.json(), wRes.json(), oRes.json()]);
    const productRows = Array.isArray(p) ? p : [];
    const warehouseRows = Array.isArray(w) ? w : [];

    setProducts(productRows);
    setAllWarehouses(warehouseRows);

    const visibleWarehouses = u.role === 'admin' ? warehouseRows : warehouseRows.filter((x) => x.ownerUserId === u._id);
    setWarehouses(visibleWarehouses);
    setOrders(Array.isArray(o) ? o : []);

    const nextWarehouse = wh || visibleWarehouses[0]?._id || '';
    setSelectedWarehouse(nextWarehouse);

    if (nextWarehouse) {
      const iRes = await fetch(`/api/inventory?warehouseId=${nextWarehouse}`, { headers: h });
      const i = await iRes.json();
      setInventory(Array.isArray(i) ? i : []);
    } else {
      setInventory([]);
    }

    if (u.role === 'admin') {
      const uRes = await fetch('/api/users', { headers: h });
      const uList = await uRes.json();
      setUsers(Array.isArray(uList) ? uList : []);
    }

    if (!bill.items.length && productRows.length) {
      setBill((prev) => ({ ...prev, items: [{ productId: productRows[0]._id, qty: 1 }] }));
    }
  };

  useEffect(() => {
    const cached = localStorage.getItem('erp_user');
    if (cached) {
      setUser(JSON.parse(cached));
    }
  }, []);

  useEffect(() => {
    if (user) {
      localStorage.setItem('erp_user', JSON.stringify(user));
      loadAll(user);
    }
  }, [user]);

  const availableProducts = useMemo(() => inventory.filter((row) => Number(row.quantity) > 0).map((row) => row.product).filter(Boolean), [inventory]);

  useEffect(() => {
    if (!availableProducts.length) return;
    setBill((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        availableProducts.some((p) => p._id === item.productId)
          ? item
          : { ...item, productId: availableProducts[0]._id }
      )
    }));
  }, [selectedWarehouse, availableProducts.length]);

  const billRows = useMemo(
    () =>
      bill.items
        .map((it) => {
          const p = availableProducts.find((x) => x._id === it.productId);
          return p ? { ...it, name: p.name, price: p.price, amount: p.price * Number(it.qty || 0) } : null;
        })
        .filter(Boolean),
    [bill, availableProducts]
  );

  const totals = useMemo(() => {
    const subtotal = billRows.reduce((s, r) => s + r.amount, 0);
    const gst = subtotal * 0.18;
    return { subtotal, gst, total: subtotal + gst };
  }, [billRows]);

  const loginSubmit = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(login)
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Login failed');
    setUser(data.user);
  };

  const saveBill = async () => {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: authHeaders(user),
      body: JSON.stringify({ ...bill, warehouseId: selectedWarehouse, items: bill.items })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Failed to save bill');
    alert(`Saved ${data.orderId}`);
    setBill((prev) => ({ ...prev, partyName: '', gstNumber: '' }));
    await loadAll();
  };

  const deleteBill = async (id) => {
    const res = await fetch(`/api/orders?id=${id}`, { method: 'DELETE', headers: authHeaders(user) });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Delete failed');
    await loadAll();
  };



const downloadOrderPdf = (order) => {
  const rows = (order.items || [])
    .map(
      (item, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${item.name}</td>
        <td>${order.warehouseId}</td>
        <td>${item.qty}</td>
        <td>${fmt(item.price)}</td>
        <td>${fmt(item.amount)}</td>
      </tr>
    `
    )
    .join("");

  const html = `
<html>
<head>
<title>${order.orderId}</title>

<style>

body{
font-family: Arial;
padding:20px;
}

.header{
text-align:center;
}

.logo{
width:70px;
margin-bottom:10px;
}

.company{
font-size:20px;
font-weight:bold;
}

table{
width:100%;
border-collapse:collapse;
margin-top:10px;
}

th,td{
border:1px solid black;
padding:6px;
}

th{
background:#eee;
}

.right{
text-align:right;
}

.sign{
margin-top:40px;
text-align:right;
}

</style>
</head>

<body>

<div class="header">

<img class="logo"
src="https://static.wixstatic.com/media/75f4d5_13bdb4f8642d459d842bae2db20aefad~mv2.jpg/v1/fill/w_77,h_77,al_c,q_80,usm_0.66_1.00_0.01,enc_avif,quality_auto/WhatsApp%20Image%202025-06-08%20at%204_56_edited.jpg"
/>

<div class="company">M/s GAURI AGROPRODUCE</div>

<div>
KHUSHALPUR ROAD, MORADABAD 244001<br>
GSTIN/UIN: 09ABDFG0229R1Z1<br>
State Name: Uttar Pradesh, Code: 09
</div>

<h2>TAX INVOICE</h2>

</div>


<table>

<tr>
<td><b>Date:</b> ${order.date}</td>
<td><b>Invoice No:</b> ${order.orderId}</td>
</tr>

<tr>
<td colspan="2">
<b>Party:</b> ${order.partyName}<br>
<b>GST:</b> ${order.gstNumber || "N/A"}
</td>
</tr>

</table>


<table>

<thead>

<tr>
<th>Sl No</th>
<th>Description</th>
<th>Warehouse</th>
<th>Qty</th>
<th>Rate</th>
<th>Amount</th>
</tr>

</thead>

<tbody>

${rows}

</tbody>

</table>


<h3 class="right">Amount Chargeable: ${fmt(order.subtotal)}</h3>


<table>

<thead>
<tr>
<th>Warehouse</th>
<th>Taxable Value</th>
<th>CGST 9%</th>
<th>SGST 9%</th>
<th>Total Tax</th>
</tr>
</thead>

<tbody>

<tr>
<td>${order.warehouseId}</td>
<td>${fmt(order.subtotal)}</td>
<td>${fmt(order.gstAmount / 2)}</td>
<td>${fmt(order.gstAmount / 2)}</td>
<td>${fmt(order.gstAmount)}</td>
</tr>

</tbody>

</table>


<h2 class="right">Net Amount: ${fmt(order.total)}</h2>


<div style="margin-top:20px">

<b>Bank Details</b><br>

A/c Name: Gauri Agroproduce<br>
A/c Number: 0279102100002084<br>
IFSC Code: PUNB0027910

<br><br>

<b>Declaration:</b><br>
We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.

</div>


<div class="sign">

For Gauri Agroproduce<br><br><br>

Authorised Signatory

</div>


<p style="text-align:center;font-size:12px;margin-top:20px">
This is a Computer Generated Invoice
</p>


<script>
window.print()
</script>

</body>
</html>
`;

  const win = window.open("", "_blank");
  if (!win) return alert("Enable popups");

  win.document.write(html);
  win.document.close();
};
  // const downloadOrderPdf = (order) => {
  //   const rows = (order.items || [])
  //     .map((item) => `<tr><td>${item.name}</td><td>${item.qty}</td><td>${fmt(item.price)}</td><td>${fmt(item.amount)}</td></tr>`)
  //     .join('');

  //   const html = `
  //     <html>
  //     <head>
  //       <title>${order.orderId}</title>
  //       <style>
  //         body { font-family: Arial; padding:16px; }
  //         h1 { color:#0f5f1c; }
  //         table { width:100%; border-collapse: collapse; margin-top:12px; }
  //         th, td { border:1px solid #222; padding:8px; text-align:left; }
  //         th { background:#111; color:#77ff66; }
  //       </style>
  //     </head>
  //     <body>
  //       <h1>GAURI AGRO BILL - ${order.orderId}</h1>
  //       <p><b>Date:</b> ${order.date}</p>
  //       <p><b>Party:</b> ${order.partyName}</p>
  //       <p><b>GST:</b> ${order.gstNumber || 'N/A'}</p>
  //       <table><thead><tr><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
  //       <h3>Subtotal: ${fmt(order.subtotal)}</h3>
  //       <h3>GST: ${fmt(order.gstAmount)}</h3>
  //       <h2>Total: ${fmt(order.total)}</h2>
  //       <script>window.print()</script>
  //     </body>
  //     </html>
  //   `;

  //   const printWindow = window.open('', '_blank');
  //   if (!printWindow) return alert('Enable popups to download PDF');
  //   printWindow.document.write(html);
  //   printWindow.document.close();
  // };

  const patchInventory = async (productId, quantity) => {
    const res = await fetch('/api/inventory', {
      method: 'PATCH',
      headers: authHeaders(user),
      body: JSON.stringify({ warehouseId: selectedWarehouse, productId, quantity: Number(quantity) })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Inventory update failed');
    await loadAll();
  };

  const adjustInventory = async () => {
    const res = await fetch('/api/inventory/adjust', {
      method: 'POST',
      headers: authHeaders(user),
      body: JSON.stringify({ warehouseId: selectedWarehouse, productId: adjust.productId, delta: Number(adjust.delta) })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Adjustment failed');
    await loadAll();
  };

  const transferInventory = async () => {
    const res = await fetch('/api/inventory/transfer', {
      method: 'POST',
      headers: authHeaders(user),
      body: JSON.stringify({ ...transfer, quantity: Number(transfer.quantity) })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Transfer failed');
    await loadAll();
  };

  const createUser = async () => {
    const res = await fetch('/api/users', { method: 'POST', headers: authHeaders(user), body: JSON.stringify(newUser) });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'User create failed');
    setNewUser({ username: '', password: '', warehouseName: '', warehouseLocation: '' });
    await loadAll();
  };

  const createWarehouse = async () => {
    const name = prompt('Warehouse name');
    if (!name) return;
    const location = prompt('Warehouse location') || '';
    const ownerId = user.role === 'admin' ? prompt('Owner user id (blank for admin)') || user._id : user._id;
    const res = await fetch('/api/warehouses', {
      method: 'POST',
      headers: authHeaders(user),
      body: JSON.stringify({ name, location, ownerUserId: ownerId })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Warehouse create failed');
    await loadAll();
  };

  const createProduct = async () => {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: authHeaders(user),
      body: JSON.stringify({ name: newProduct.name, price: Number(newProduct.price) })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Create product failed');
    setNewProduct({ name: '', price: '' });
    await loadAll();
  };

  const updateProduct = async () => {
    const res = await fetch('/api/products', {
      method: 'PATCH',
      headers: authHeaders(user),
      body: JSON.stringify({ id: editingProduct.id, name: editingProduct.name, price: Number(editingProduct.price) })
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || 'Update product failed');
    setEditingProduct({ id: '', name: '', price: '' });
    await loadAll();
  };

  if (!user) {
    return (
      <main className="app-shell">
        <section className="card login-card">
          <h2>Login</h2>
          <form onSubmit={loginSubmit}>
            <input placeholder="username" value={login.username} onChange={(e) => setLogin({ ...login, username: e.target.value })} />
            <input type="password" placeholder="password" value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} />
            <button type="submit">Login</button>
          </form>
        </section>
      </main>
    );
  }

  const selectableWarehouses = user.role === 'admin' ? allWarehouses : warehouses;

  return (
    <main className="app-shell">
      <header className="header">
        <h1>GAURI AGRO ERP ({user.role})</h1>
        <button onClick={() => { localStorage.removeItem('erp_user'); setUser(null); }}>Logout</button>
      </header>

      <div className="tabs">
        {TABS.filter((t) => user.role === 'admin' || t !== 'admin').map((t) => (
          <button key={t} className={tab === t ? 'tab active' : 'tab'} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      <section className="card">
        <h3>Warehouse</h3>
        <select value={selectedWarehouse} onChange={(e) => { setSelectedWarehouse(e.target.value); loadAll(user, e.target.value); }}>
          {warehouses.map((w) => <option key={w._id} value={w._id}>{w.name} - {w.location}</option>)}
        </select>
        <button onClick={createWarehouse}>+ Add Warehouse</button>
      </section>

      {tab === 'billing' && (
        <section className="card">
          <h2>Create Bill</h2>
          <input placeholder="Party" value={bill.partyName} onChange={(e) => setBill({ ...bill, partyName: e.target.value })} />
          <input placeholder="GST optional" value={bill.gstNumber} onChange={(e) => setBill({ ...bill, gstNumber: e.target.value })} />
          <input type="date" value={bill.date} onChange={(e) => setBill({ ...bill, date: e.target.value })} />
          <p>Products shown below are only from selected warehouse and with available stock.</p>
          {bill.items.map((it, idx) => (
            <div className="line-item" key={idx}>
              <select
                value={it.productId}
                onChange={(e) => setBill({ ...bill, items: bill.items.map((x, i) => (i === idx ? { ...x, productId: e.target.value } : x)) })}
              >
                {availableProducts.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
              <input
                type="number"
                min="1"
                value={it.qty}
                onChange={(e) => setBill({ ...bill, items: bill.items.map((x, i) => (i === idx ? { ...x, qty: Number(e.target.value) } : x)) })}
              />
            </div>
          ))}
          <button onClick={() => setBill({ ...bill, items: [...bill.items, { productId: availableProducts[0]?._id || '', qty: 1 }] })}>+ Item</button>
          <p>Total: {fmt(totals.total)}</p>
          <button onClick={saveBill}>Save Bill (deduct from selected warehouse)</button>
        </section>
      )}

      {tab === 'inventory' && (
        <section className="card">
          <h2>Inventory Manual Manage</h2>
          <div className="line-item">
            <select value={adjust.productId} onChange={(e) => setAdjust({ ...adjust, productId: e.target.value })}>
              <option value="">select product</option>
              {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
            <input type="number" value={adjust.delta} onChange={(e) => setAdjust({ ...adjust, delta: Number(e.target.value) })} />
            <button onClick={adjustInventory}>Adjust +/-</button>
          </div>
          <table>
            <thead><tr><th>Product</th><th>Qty</th><th>Set Qty</th></tr></thead>
            <tbody>
              {inventory.map((r) => (
                <tr key={r._id}>
                  <td>{r.product?.name}</td>
                  <td>{r.quantity}</td>
                  <td><input type="number" defaultValue={r.quantity} onBlur={(e) => patchInventory(r.productId, Number(e.target.value))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'orders' && (
        <section className="card">
          <h2>Orders</h2>
          <table>
            <thead><tr><th>ID</th><th>Warehouse</th><th>Party</th><th>Total</th><th>Action</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o._id}>
                  <td>{o.orderId}</td>
                  <td>{o.warehouseId}</td>
                  <td>{o.partyName}</td>
                  <td>{fmt(o.total)}</td>
                  <td>
                    <button onClick={() => downloadOrderPdf(o)}>PDF</button>
                    <button onClick={() => deleteBill(o._id)}>Delete bill (restore stock)</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {tab === 'dashboard' && (
        <section className="card">
          <h2>Dashboard</h2>
          <p>Total Orders: {orders.length}</p>
          <p>Total Sales: {fmt(orders.reduce((s, o) => s + Number(o.total || 0), 0))}</p>
        </section>
      )}

      {tab === 'admin' && user.role === 'admin' && (
        <section className="card">
          <h2>Admin User Management</h2>
          <div className="line-item">
            <input placeholder="username" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
            <input placeholder="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} />
            <input placeholder="first warehouse name" value={newUser.warehouseName} onChange={(e) => setNewUser({ ...newUser, warehouseName: e.target.value })} />
            <input placeholder="first warehouse location" value={newUser.warehouseLocation} onChange={(e) => setNewUser({ ...newUser, warehouseLocation: e.target.value })} />
            <button onClick={createUser}>Create User</button>
          </div>
          <h3>Users</h3>
          {users.map((u) => <p key={u._id}>{u.username} ({u._id})</p>)}

          <h3>Create Product</h3>
          <div className="line-item">
            <input placeholder="name" value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} />
            <input type="number" placeholder="price" value={newProduct.price} onChange={(e) => setNewProduct({ ...newProduct, price: e.target.value })} />
            <button onClick={createProduct}>Create Product</button>
          </div>

          <h3>Edit Product</h3>
          <div className="line-item">
            <select value={editingProduct.id} onChange={(e) => {
              const p = products.find((x) => x._id === e.target.value);
              setEditingProduct({ id: p?._id || '', name: p?.name || '', price: p?.price || '' });
            }}>
              <option value="">select product</option>
              {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
            <input placeholder="name" value={editingProduct.name} onChange={(e) => setEditingProduct({ ...editingProduct, name: e.target.value })} />
            <input type="number" placeholder="price" value={editingProduct.price} onChange={(e) => setEditingProduct({ ...editingProduct, price: e.target.value })} />
            <button onClick={updateProduct}>Update Product</button>
          </div>

          <h3>Refill / Transfer Inventory (warehouse to warehouse)</h3>
          <div className="line-item">
            <select value={transfer.fromWarehouseId} onChange={(e) => setTransfer({ ...transfer, fromWarehouseId: e.target.value })}>
              <option value="">from warehouse</option>
              {selectableWarehouses.map((w) => <option key={w._id} value={w._id}>{w.name} - {w.location}</option>)}
            </select>
            <select value={transfer.toWarehouseId} onChange={(e) => setTransfer({ ...transfer, toWarehouseId: e.target.value })}>
              <option value="">to warehouse</option>
              {selectableWarehouses.map((w) => <option key={w._id} value={w._id}>{w.name} - {w.location}</option>)}
            </select>
            <select value={transfer.productId} onChange={(e) => setTransfer({ ...transfer, productId: e.target.value })}>
              <option value="">product</option>
              {products.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
            </select>
            <input type="number" value={transfer.quantity} onChange={(e) => setTransfer({ ...transfer, quantity: Number(e.target.value) })} />
            <button onClick={transferInventory}>Transfer</button>
          </div>
        </section>
      )}
    </main>
  );
}
