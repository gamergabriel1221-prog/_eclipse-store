// Pedidos do cliente logado. Só entrega as contas de pedidos PAGOS que pertencem a ele.
const { db, requireUser, send, handler } = require('./_lib/shared');

module.exports = handler(async (req, res) => {
  const { user } = await requireUser(req);
  const id = String((req.query && req.query.id) || '');

  if (!id) {  // histórico de compras
    const { data } = await db().from('orders').select('id,status,total,created_at,paid_at,order_items(product_name,unit_price)').eq('user_id', user.id).order('created_at', { ascending: false }).limit(50);
    return send(res, 200, { orders: data || [] });
  }
  if (!/^[\w-]{1,64}$/.test(id)) return send(res, 400, { error: 'Pedido inválido.' });

  const { data: o } = await db().from('orders').select('id,status,total,user_id,note,created_at').eq('id', id).maybeSingle();
  if (!o || o.user_id !== user.id) return send(res, 404, { error: 'Pedido não encontrado.' });

  const out = { id: o.id, status: o.status, total: o.total };
  if (o.status === 'paid' || o.status === 'paid_review') {
    const { data: st } = await db().from('product_stock').select('secret,note,product_id').eq('order_id', o.id).eq('status', 'sold');
    const ids = [...new Set((st || []).map(s => s.product_id))];
    const names = {};
    if (ids.length) { const { data: ps } = await db().from('products').select('id,name').in('id', ids); (ps || []).forEach(p => { names[p.id] = p.name; }); }
    out.delivered = (st || []).map(s => ({ produto: names[s.product_id] || 'Produto', conteudo: s.secret, extra: s.note || '' }));
    if (o.status === 'paid_review') out.review = true;
  }
  send(res, 200, out);
}, ['GET']);
