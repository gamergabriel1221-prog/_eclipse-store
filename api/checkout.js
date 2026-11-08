// Cria o pedido (preço e estoque vêm do BANCO, nunca do navegador) e a preferência de pagamento no Mercado Pago.
const { db, env, requireUser, send, handler, body, siteUrl } = require('./_lib/shared');

const ERR = {
  AUTH_REQUIRED: [401, 'Faça login para comprar.'],
  EMPTY_CART: [400, 'Seu carrinho está vazio.'],
  CART_TOO_BIG: [400, 'Carrinho grande demais.'],
  TOO_MANY_PENDING: [429, 'Você já tem pedidos aguardando pagamento. Pague ou aguarde expirarem.'],
};

module.exports = handler(async (req, res) => {
  const { user, profile } = await requireUser(req);
  const ids = (body(req).ids || []).map(String).filter(x => /^[\w-]{1,64}$/.test(x));
  const email = profile.email || user.email;

  const { data, error } = await db().rpc('create_order', { p_user: user.id, p_email: email, p_product_ids: ids, p_minutes: 30 });
  if (error) {
    const m = String(error.message || '');
    const key = Object.keys(ERR).find(k => m.includes(k));
    if (key) return send(res, ERR[key][0], { error: ERR[key][1] });
    if (m.includes('OUT_OF_STOCK')) return send(res, 409, { error: 'Sem estoque: ' + (m.split('OUT_OF_STOCK:')[1] || '').trim().split('\n')[0] });
    if (m.includes('INVALID_PRODUCT')) return send(res, 400, { error: 'Um dos produtos não está mais disponível.' });
    throw error;
  }
  const orderId = data.order_id;

  const { data: items } = await db().from('order_items').select('product_name,unit_price,quantity').eq('order_id', orderId);
  const site = siteUrl();
  const pref = {
    items: (items || []).map(i => ({ title: String(i.product_name).slice(0, 250), quantity: i.quantity, unit_price: Number(i.unit_price), currency_id: 'BRL' })),
    payer: { email },
    external_reference: orderId,
    notification_url: site + '/api/webhook',
    back_urls: { success: site + '/?pedido=' + orderId, pending: site + '/?pedido=' + orderId, failure: site + '/?pedido=' + orderId },
    auto_return: 'approved',
    statement_descriptor: 'ECLIPSE STORE',
    expires: true,
    expiration_date_to: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  };

  let mp;
  try {
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env('MP_ACCESS_TOKEN'), 'X-Idempotency-Key': orderId },
      body: JSON.stringify(pref),
    });
    mp = await r.json();
    if (!r.ok || !mp.init_point) throw new Error('MP ' + r.status + ' ' + JSON.stringify(mp).slice(0, 300));
  } catch (e) {
    await db().rpc('cancel_order', { p_order_id: orderId });  // devolve o estoque
    console.error('[checkout] falha no Mercado Pago:', e.message);
    return send(res, 502, { error: 'Não foi possível criar o pagamento agora. Tente novamente.' });
  }

  await db().from('orders').update({ mp_preference_id: mp.id }).eq('id', orderId);
  send(res, 200, { id: orderId, url: mp.init_point });
}, ['POST']);
