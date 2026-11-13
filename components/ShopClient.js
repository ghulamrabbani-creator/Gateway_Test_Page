'use client';
import Link from 'next/link';
import SettingsPanel, { SettingsChips } from './SettingsPanel';
import { useSettings, useCart } from '@/lib/clientState';
import { PRODUCTS } from '@/lib/products';

export default function ShopClient({ pub, role }) {
  const [s, setS] = useSettings();
  const [cart, setCart] = useCart();
  const count = Object.values(cart.items).reduce((a, b) => a + b, 0);
  const add = (id) => setCart((c) => ({ items: { ...c.items, [id]: (c.items[id] || 0) + 1 } }));
  return (
    <div className="grid shop">
      <SettingsPanel s={s} set={setS} pub={pub} role={role} />
      <div>
        <SettingsChips s={s} />
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
          <div><h1>Shop</h1><p className="sub" style={{ margin: 0 }}>Add something, then check out with the settings on the left.</p></div>
          <Link className="btn" href="/checkout">Checkout ({count})</Link>
        </div>
        <div className="products">
          {PRODUCTS.map((p) => (
            <div key={p.id} className="card product" style={{ marginBottom: 0 }}>
              <div className="art" style={{ background: p.color }}>{p.letter}</div>
              <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase' }}>{p.cat}</div>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                <span>{s.currency} {p.price.toFixed(2)}</span>
                <button onClick={() => add(p.id)}>Add{cart.items[p.id] ? ` (${cart.items[p.id]})` : ''}</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
