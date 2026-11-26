// Avaliações: leitura pública; envio SÓ de cliente logado com compra paga (1 avaliação por pedido).
const { db, requireUser, send, handler, body } = require('./_lib/shared');

module.exports = handler(async (req, res) => {
  if (req.method === 'GET') {
    const { data, error } = await db().from('reviews').select('author,rating,body,created_at').eq('approved', true).order('created_at', { ascending: false }).limit(30);
    if (error) throw error;
    return send(res, 200, { reviews: data || [] });
  }

  const { user, profile } = await requireUser(req);
  const b = body(req);
  const rating = Math.round(Number(b.rating));
  const text = String(b.text || '').trim();
  if (!(rating >= 1 && rating <= 5)) return send(res, 400, { error: 'Escolha uma nota de 1 a 5.' });
  if (text.length < 5 || text.length > 600) return send(res, 400, { error: 'O comentário deve ter entre 5 e 600 caracteres.' });

  const { data: orders } = await db().from('orders').select('id').eq('user_id', user.id).eq('status', 'paid').order('paid_at', { ascending: false }).limit(50);
  const ids = (orders || []).map(o => String(o.id));
  if (!ids.length) return send(res, 403, { error: 'Só clientes com compra confirmada podem avaliar.' });

  const { data: used } = await db().from('reviews').select('order_id').in('order_id', ids);
  const usedSet = new Set((used || []).map(r => r.order_id));
  const free = ids.find(i => !usedSet.has(i));
  if (!free) return send(res, 409, { error: 'Você já avaliou todas as suas compras. Obrigado!' });

  const first = String(profile.name || 'Cliente').trim().split(/\s+/)[0].slice(0, 30) || 'Cliente';
  const { error } = await db().from('reviews').insert({ user_id: user.id, order_id: free, author: first, rating, body: text });
  if (error) {
    if (String(error.code) === '23505') return send(res, 409, { error: 'Esta compra já foi avaliada.' });
    throw error;
  }
  send(res, 200, { ok: true });
}, ['GET', 'POST']);
