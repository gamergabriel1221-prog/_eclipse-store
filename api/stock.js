// Contagem pública de estoque disponível por produto (sem revelar nenhuma conta).
const { db, send, handler } = require('./_lib/shared');
module.exports = handler(async (req, res) => {
  const { data, error } = await db().rpc('stock_counts');
  if (error) throw error;
  const counts = {};
  (data || []).forEach(r => { counts[r.product_id] = Number(r.n); });
  send(res, 200, { counts });
}, ['GET']);
