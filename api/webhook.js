// Webhook do Mercado Pago. ÚNICO caminho que confirma pagamento e libera a entrega.
// 1) valida a assinatura x-signature (HMAC-SHA256) com MP_WEBHOOK_SECRET
// 2) consulta o pagamento direto na API do Mercado Pago (não confia no corpo recebido)
// 3) só então chama fulfill_order (idempotente)
const crypto = require('crypto');
const { db, env, send, handler } = require('./_lib/shared');

function validSignature(req) {
  const secret = env('MP_WEBHOOK_SECRET');
  const sig = String(req.headers['x-signature'] || '');
  const reqId = String(req.headers['x-request-id'] || '');
  const parts = Object.fromEntries(sig.split(',').map(s => s.trim().split('=').map(x => x.trim())).filter(a => a.length === 2));
  if (!parts.ts || !parts.v1) return false;
  let dataId = String((req.query && (req.query['data.id'] || req.query.id)) || '');
  if (/^[a-z0-9]+$/i.test(dataId)) dataId = dataId.toLowerCase();
  const manifest = `id:${dataId};request-id:${reqId};ts:${parts.ts};`;
  const expected = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const a = Buffer.from(expected), b = Buffer.from(parts.v1);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  // Sem checagem de idade: reenvios do MP são seguros, pois o pagamento é reconsultado na API e fulfill_order é idempotente.
  return true;
}

module.exports = handler(async (req, res) => {
  if (!validSignature(req)) return send(res, 401, { error: 'assinatura inválida' });

  const q = req.query || {};
  const b = (req.body && typeof req.body === 'object') ? req.body : {};
  const type = q.type || q.topic || b.type || b.topic;
  const paymentId = String(q['data.id'] || (b.data && b.data.id) || '');
  if (type !== 'payment' || !paymentId) return send(res, 200, { ok: true, ignored: true });

  // Fonte da verdade: o próprio Mercado Pago
  const r = await fetch('https://api.mercadopago.com/v1/payments/' + encodeURIComponent(paymentId), {
    headers: { Authorization: 'Bearer ' + env('MP_ACCESS_TOKEN') },
  });
  if (!r.ok) { console.error('[webhook] MP respondeu', r.status); return send(res, 502, { error: 'tente novamente' }); }
  const pay = await r.json();
  const orderId = String(pay.external_reference || '');
  let result = 'ignored:' + pay.status;

  if (orderId) {
    if (pay.status === 'approved' && pay.currency_id === 'BRL') {
      const { data, error } = await db().rpc('fulfill_order', { p_order_id: orderId, p_payment_id: String(pay.id), p_paid: Number(pay.transaction_amount) });
      if (error) { console.error('[webhook] fulfill', error.message); return send(res, 500, { error: 'tente novamente' }); }
      result = (data && data.result) || 'ok';
    } else if (pay.status === 'refunded' || pay.status === 'charged_back') {
      await db().from('orders').update({ status: 'refunded', note: 'Pagamento ' + pay.status }).eq('id', orderId).eq('mp_payment_id', String(pay.id));
      result = pay.status;
    }
  }
  await db().from('webhook_events').insert({ payment_id: paymentId, event: pay.status, result });
  send(res, 200, { ok: true });
}, ['POST']);
