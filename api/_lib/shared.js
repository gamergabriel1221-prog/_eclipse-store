// Utilitários compartilhados pelas funções /api. Roda só no servidor (Vercel).
const { createClient } = require('@supabase/supabase-js');

function env(name) {
  const v = process.env[name];
  if (!v) throw Object.assign(new Error('Variável de ambiente ausente: ' + name), { status: 500, public: 'Servidor não configurado.' });
  return v;
}

let _admin;
// Cliente com service_role: ignora RLS. NUNCA vai para o navegador.
function db() {
  if (!_admin) {
    _admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return _admin;
}

function bearer(req) {
  const h = req.headers['authorization'] || '';
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

// Valida o token do Supabase Auth NO SERVIDOR e devolve { user, profile }.
async function requireUser(req) {
  const token = bearer(req);
  if (!token) throw Object.assign(new Error('auth'), { status: 401, public: 'Faça login para continuar.' });
  const { data, error } = await db().auth.getUser(token);
  if (error || !data || !data.user) throw Object.assign(new Error('auth'), { status: 401, public: 'Sessão inválida. Entre novamente.' });
  const { data: profile } = await db().from('profiles').select('id,email,name,role').eq('id', data.user.id).maybeSingle();
  return { user: data.user, profile: profile || { id: data.user.id, email: data.user.email, role: 'customer' } };
}

async function requireAdmin(req) {
  const ctx = await requireUser(req);
  if (!ctx.profile || ctx.profile.role !== 'admin') throw Object.assign(new Error('forbidden'), { status: 403, public: 'Acesso restrito a administradores.' });
  return ctx;
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

// Envolve o handler: trata erros sem vazar detalhes internos.
function handler(fn, methods) {
  return async (req, res) => {
    try {
      if (methods && !methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); return send(res, 405, { error: 'Método não permitido' }); }
      await fn(req, res);
    } catch (e) {
      const status = e.status || 500;
      if (status >= 500) console.error('[api]', req.url, e && e.message);
      send(res, status, { error: e.public || 'Erro interno. Tente novamente.' });
    }
  };
}

function body(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body || '{}'); } catch { return {}; }
}

const siteUrl = () => (process.env.SITE_URL || '').replace(/\/+$/, '');

module.exports = { db, env, requireUser, requireAdmin, send, handler, body, siteUrl };
