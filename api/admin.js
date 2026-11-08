// Painel administrativo. TODA ação exige token válido + papel 'admin' conferido no banco.
const { db, requireAdmin, send, handler, body } = require('./_lib/shared');

const CATS = ['blox', 'gp', 'ff', 'xit', 'roblox', 'outros'];
const str = (v, n) => (v == null ? null : String(v).slice(0, n));
const dataImg = (v, max) => (typeof v === 'string' && /^data:image\/(png|jpe?g|webp|svg\+xml);/.test(v) && v.length <= max ? v : null);

function clean(p) {
  const price = Number(p.price);
  if (!p.name || !String(p.name).trim() || !isFinite(price) || price < 0) throw Object.assign(new Error('bad'), { status: 400, public: 'Nome e preço válidos são obrigatórios.' });
  if (!CATS.includes(p.category)) throw Object.assign(new Error('bad'), { status: 400, public: 'Categoria inválida.' });
  return {
    category: p.category, name: str(p.name, 200).trim(), price: Math.round(price * 100) / 100,
    old_price: Number(p.old_price) > 0 ? Math.round(Number(p.old_price) * 100) / 100 : null,
    description: str(p.description, 1000) || '', details: str(p.details, 4000) || '', icon: str(p.icon, 16) || '🎮',
    icon_image: dataImg(p.icon_image, 120000), image: dataImg(p.image, 400000),
    banner: Array.isArray(p.banner) ? p.banner.slice(0, 3).map(x => str(x, 80) || '') : null,
    section: str(p.section, 80) || null, price_from: !!p.price_from, active: p.active !== false,
  };
}

const actions = {
  async products() {
    const { data, error } = await db().from('products').select('*').order('created_at', { ascending: true });
    if (error) throw error;
    const { data: cnt } = await db().rpc('stock_counts');
    const counts = {}; (cnt || []).forEach(r => { counts[r.product_id] = Number(r.n); });
    return { products: data, counts };
  },
  async save({ product }) {
    const row = clean(product || {});
    if (product.id) {
      const { data, error } = await db().from('products').update(row).eq('id', product.id).select().single();
      if (error) throw error; return { product: data };
    }
    const { data, error } = await db().from('products').insert(row).select().single();
    if (error) throw error; return { product: data };
  },
  async remove({ id }) {
    const { count: c1 } = await db().from('order_items').select('*', { count: 'exact', head: true }).eq('product_id', id);
    const { count: c2 } = await db().from('product_stock').select('*', { count: 'exact', head: true }).eq('product_id', id);
    if ((c1 || 0) + (c2 || 0) > 0) {  // tem histórico/estoque: arquiva em vez de apagar
      await db().from('products').update({ active: false }).eq('id', id);
      return { archived: true };
    }
    const { error } = await db().from('products').delete().eq('id', id);
    if (error) throw error; return { deleted: true };
  },
  // Importa o catálogo local sem duplicar (compara por categoria + nome) e sem apagar nada.
  async import({ products }) {
    if (!Array.isArray(products) || products.length > 200) throw Object.assign(new Error('bad'), { status: 400, public: 'Lista inválida.' });
    const { data: ex } = await db().from('products').select('name,category');
    const seen = new Set((ex || []).map(p => p.category + '|' + p.name));
    const rows = []; 
    for (const p of products) { try { const r = clean(p); if (!seen.has(r.category + '|' + r.name)) { rows.push(r); seen.add(r.category + '|' + r.name); } } catch {} }
    if (rows.length) { const { error } = await db().from('products').insert(rows); if (error) throw error; }
    return { imported: rows.length, skipped: products.length - rows.length };
  },
  async stock_add({ product_id, lines }) {
    const items = String(lines || '').split('\n').map(l => l.trim()).filter(Boolean).slice(0, 500).map(l => {
      const [secret, note] = l.split('|').map(x => x.trim()); return { product_id, secret: secret.slice(0, 500), note: note ? note.slice(0, 300) : null };
    }).filter(x => x.secret);
    if (!items.length) throw Object.assign(new Error('bad'), { status: 400, public: 'Nenhum item válido.' });
    const { error } = await db().from('product_stock').insert(items);
    if (error) throw error; return { added: items.length };
  },
  async stock_list({ product_id }) {
    const { data, error } = await db().from('product_stock').select('id,secret,note,status,created_at').eq('product_id', product_id).in('status', ['available', 'reserved']).order('created_at').limit(300);
    if (error) throw error; return { items: data };
  },
  async stock_remove({ id }) {
    const { error } = await db().from('product_stock').delete().eq('id', id).eq('status', 'available');
    if (error) throw error; return { ok: true };
  },
  async orders() {
    const { data, error } = await db().from('orders').select('id,email,status,total,created_at,paid_at,note,order_items(product_name)').order('created_at', { ascending: false }).limit(100);
    if (error) throw error; return { orders: data };
  },
};

module.exports = handler(async (req, res) => {
  await requireAdmin(req);
  const b = body(req);
  const fn = actions[b.action];
  if (!fn) return send(res, 400, { error: 'Ação inválida.' });
  send(res, 200, await fn(b));
}, ['POST']);
