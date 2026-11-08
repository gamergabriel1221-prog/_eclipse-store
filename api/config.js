// Entrega ao navegador SÓ o que é público por design (URL + anon key).
const { send, handler, env } = require('./_lib/shared');
module.exports = handler(async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ supabaseUrl: env('SUPABASE_URL'), supabaseAnonKey: env('SUPABASE_ANON_KEY') }));
}, ['GET']);
