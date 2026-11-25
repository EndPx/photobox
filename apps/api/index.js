const PROMO_LIMIT = 5;
const PROMO_DISCOUNT = 5000;
const SESSION_AGE = 8 * 60 * 60 * 1000;
const SHOP_DEFAULTS = {price:35000, countdown:3, mode:'trial'};
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2,'0')).join('');
const randomHex = length => hex(crypto.getRandomValues(new Uint8Array(length)));
const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), byte => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[byte & 31]).join('');
const normalCode = value => String(value ?? '').toUpperCase().replace(/[ -]/g, '');
const json = (data, status=200, headers={}) => Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const publicOrder = row => ({
  reference:row.reference, baseAmount:row.base_amount, discount:row.discount, total:row.total,
  status:row.status, qr:row.status === 'pending' ? row.qr_url : null, mode:row.is_trial ? 'trial' : row.mode
});

class Problem extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function setting(db, key) {
  return db.prepare('SELECT value FROM shop WHERE key = ?').bind(key).first('value');
}

function writeSetting(db, key, value) {
  return db.prepare('INSERT INTO shop (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(key, value);
}

async function shop(db) {
  const value = await setting(db, 'config');
  return value ? {...SHOP_DEFAULTS,...JSON.parse(value),price:SHOP_DEFAULTS.price} : SHOP_DEFAULTS;
}

async function bodyOf(request) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw new Problem(403, 'Permintaan harus berasal dari halaman Photobox.');
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Problem(415, 'Format permintaan tidak didukung.');
  const raw = await boundedBody(request,8000);
  try {
    const data = JSON.parse(new TextDecoder().decode(raw));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch { throw new Problem(400, 'Permintaan tidak valid.'); }
}

async function hash(text) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

function sameDigest(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i=0; i<a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function cashierToken(request) {
  return request.headers.get('Cookie')?.match(/(?:^|;\s*)st_cashier=([a-f0-9]{64})(?:;|$)/)?.[1];
}

function adminConfigured(env) {
  return Boolean(env.ADMIN_USERNAME && env.ADMIN_PASSWORD?.length >= 16);
}

function sessionDigest(env, token) {
  return hash(JSON.stringify([env.ADMIN_USERNAME, env.ADMIN_PASSWORD, token]));
}

async function cashierAuthorized(env, request) {
  const token = cashierToken(request);
  if (!token || !adminConfigured(env)) return false;
  const session = await env.DB.prepare('SELECT 1 AS present FROM cashier_sessions WHERE digest = ? AND expires_at > ?')
    .bind(await sessionDigest(env,token), Date.now()).first();
  return Boolean(session);
}

async function cashierLogin(env, data) {
  const db = env.DB;
  if (!adminConfigured(env)) throw new Problem(503,'Akses admin belum dikonfigurasi.');
  const username = String(data.username ?? '');
  const password = String(data.password ?? '');
  if (username.length > 128 || password.length > 512) throw new Problem(400,'Kredensial admin tidak valid.');
  const window = Math.floor(Date.now() / 300000);
  const attempts = await db.prepare(`INSERT INTO shop (key,value) VALUES ('cashier_attempts',json_array(?,1))
    ON CONFLICT (key) DO UPDATE SET value = CASE
      WHEN json_extract(value,'$[0]') = ? THEN json_array(?,json_extract(value,'$[1]')+1)
      ELSE json_array(?,1) END RETURNING json_extract(value,'$[1]') AS count`)
    .bind(window,window,window,window).first('count');
  if (attempts > 6) throw new Problem(429,'Terlalu banyak percobaan. Coba lagi dalam 5 menit.');
  const [provided,expected] = await Promise.all([
    hash(JSON.stringify([username,password])),
    hash(JSON.stringify([env.ADMIN_USERNAME,env.ADMIN_PASSWORD]))
  ]);
  if (!sameDigest(provided,expected)) throw new Problem(401,'Username atau password salah.');
  const token = randomHex(32);
  await db.batch([
    db.prepare("DELETE FROM shop WHERE key = 'cashier_attempts'"),
    db.prepare('DELETE FROM cashier_sessions WHERE expires_at <= ?').bind(Date.now()),
    db.prepare('INSERT INTO cashier_sessions (digest,expires_at) VALUES (?,?)').bind(await sessionDigest(env,token),Date.now()+SESSION_AGE)
  ]);
  return json({ok:true},200,{
    'Set-Cookie':'st_cashier=' + token + '; Path=/api/cashier; HttpOnly; SameSite=Strict; Secure; Max-Age=28800'
  });
}

async function lookupVoucher(db, input, isTrial) {
  const code = normalCode(input);
  if (!/^[A-HJ-NP-Z2-9]{8}$/.test(code)) throw new Problem(400,'Masukkan kode yang tertera dari kasir.');
  const promo = await db.prepare('SELECT code, revoked_at FROM promo_codes WHERE code = ?').bind(code).first();
  if (promo) {
    if (promo.revoked_at !== null) throw new Problem(409,'Kode voucher sudah dinonaktifkan.');
    return {code, discount:PROMO_DISCOUNT, reusable:true};
  }
  const voucher = await db.prepare('SELECT * FROM vouchers WHERE code = ?').bind(code).first();
  if (!voucher) throw new Problem(404,'Kode tidak ditemukan. Cek kembali kode dari kasir.');
  if (Boolean(voucher.is_trial) !== isTrial) {
    throw new Problem(409,'Kode ini dibuat untuk mode pembayaran yang berbeda.');
  }
  const active = await db.prepare("SELECT status FROM orders WHERE voucher = ? AND status IN ('pending','paid','completed')").bind(code).first();
  if (active) {
    throw new Problem(409,active.status === 'pending' ? 'Kode sedang dipakai di pembayaran lain. Selesaikan atau batalkan pembayaran tersebut.' : 'Kode ini sudah pernah dipakai.');
  }
  return voucher;
}

async function voucherIssue(db) {
  const code = randomCode();
  const result = await db.prepare(`INSERT INTO promo_codes (code,created_at)
    SELECT ?,? WHERE (SELECT COUNT(*) FROM promo_codes WHERE revoked_at IS NULL) < ?
      AND NOT EXISTS (SELECT 1 FROM vouchers WHERE code = ?)
    ON CONFLICT(code) DO NOTHING`)
    .bind(code,Date.now(),PROMO_LIMIT,code).run();
  if (!result.meta.changes) throw new Problem(409,'Kode belum terbit. Maksimal 5 kode aktif. Jika masih ada tempat, coba lagi.');
  return json({code,discount:PROMO_DISCOUNT},201);
}

async function voucherRevoke(db, data) {
  const result = await db.prepare('UPDATE promo_codes SET revoked_at = ? WHERE code = ? AND revoked_at IS NULL')
    .bind(Date.now(),normalCode(data.code)).run();
  if (!result.meta.changes) throw new Problem(404,'Kode voucher aktif tidak ditemukan.');
  return json({ok:true});
}

async function getOrder(db, id) {
  if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Problem(400,'Sesi pembayaran tidak valid.');
  return db.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
}

async function createOrder(env,data) {
  const {DB: db} = env;
  let order = await getOrder(db,data.id);
  if (!order) {
    const config = await shop(db);
    const isTrial = config.mode === 'trial';
    if (!isTrial && !paymentKey(env,config.mode)) throw new Problem(503,'QRIS belum diaktifkan oleh kasir.');
    const voucher = data.code ? await lookupVoucher(db,data.code,isTrial) : null;
    const discount = voucher?.discount || 0;
    const promoCode = voucher?.reusable ? voucher.code : null;
    const voucherCode = voucher && !voucher.reusable ? voucher.code : null;
    const result = await db.prepare(`INSERT INTO orders
      (id,reference,voucher,base_amount,discount,total,mode,status,created_at,is_trial,qr_url,promo_code)
      SELECT ?,?,?,?,?,?,?,'pending',?,?,?,? WHERE
        (? IS NULL OR NOT EXISTS (SELECT 1 FROM orders WHERE voucher = ? AND status IN ('pending','paid','completed')))
        AND (? IS NULL OR EXISTS (SELECT 1 FROM promo_codes WHERE code = ? AND revoked_at IS NULL))
      ON CONFLICT(id) DO NOTHING`)
      .bind(data.id,(isTrial ? 'TRIAL-' : 'ST-') + randomCode(),voucherCode,config.price,discount,
        config.price-discount,isTrial ? 'sandbox' : config.mode,Date.now(),Number(isTrial),
        isTrial ? '/trial-qr.svg' : null,promoCode,voucherCode,voucherCode,promoCode,promoCode).run();
    order = await getOrder(db,data.id);
    if (!order && !result.meta.changes) throw new Problem(409,'Kode voucher sudah tidak tersedia. Periksa kembali kode dan coba lagi.');
  }
  if (!order.is_trial && order.status === 'pending' && !order.qr_url) {
    const key = paymentKey(env,order.mode);
    if (!key) throw new Problem(503,'QRIS sedang tidak tersedia. Hubungi kasir.');
    // Let one request at a time initiate or recover a charge for this order.
    const acquired = await db.prepare("UPDATE orders SET provider_checked_at = ? WHERE id = ? AND status = 'pending' AND qr_url IS NULL AND provider_checked_at <= ?")
      .bind(Date.now(),order.id,Date.now()-12000).run();
    if (acquired.meta.changes) await startProviderPayment(db,order,key);
  }
  return json(publicOrder(await getOrder(db,data.id)));
}

async function updateOrder(env, order, action) {
  const db = env.DB;
  if (!order) throw new Problem(404,'Sesi pembayaran tidak ditemukan.');
  if (action === 'simulate') {
    if (!order.is_trial) throw new Problem(403,'Simulasi hanya tersedia untuk transaksi trial.');
    await db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ? AND is_trial = 1 AND status = 'pending'")
      .bind(Date.now(),order.id).run();
  } else if (action === 'complete') {
    if (order.status !== 'paid' && order.status !== 'completed') throw new Problem(409,'Pembayaran belum terverifikasi.');
    await db.prepare("UPDATE orders SET status = 'completed', completed_at = ? WHERE id = ? AND status = 'paid'")
      .bind(Date.now(),order.id).run();
  } else if (order.is_trial) {
    if (action === 'cancel') {
      await db.prepare("UPDATE orders SET status = 'canceled' WHERE id = ? AND is_trial = 1 AND status = 'pending'")
        .bind(order.id).run();
    }
  } else if (order.status === 'pending') {
    const key = paymentKey(env,order.mode);
    if (!key) throw new Problem(503,'QRIS sedang tidak tersedia. Hubungi kasir.');
    if (action === 'cancel') {
      if (!order.qr_url) throw new Problem(409,'QRIS masih disiapkan. Coba cek status dulu.');
      const result = await midtrans(order.mode,key,'/v2/' + order.reference + '/cancel',{});
      if (matchesPayment(result,order)) await recordProviderStatus(db,order,result);
      await refreshProviderPayment(db,order,key);
    } else {
      const acquired = await db.prepare("UPDATE orders SET provider_checked_at = ? WHERE id = ? AND status = 'pending' AND provider_checked_at <= ?")
        .bind(Date.now(),order.id,Date.now()-9500).run();
      if (acquired.meta.changes) await refreshProviderPayment(db,order,key);
    }
  }
  return json(publicOrder(await getOrder(db,order.id)));
}

async function configure(env, data) {
  const db = env.DB;
  const mode = data.mode;
  const countdown = Number(data.countdown);
  if (!['trial','sandbox','production'].includes(mode) || ![3,5,8].includes(countdown)) {
    throw new Problem(400,'Periksa mode QRIS dan waktu hitung mundur.');
  }
  if (mode !== 'trial' && !paymentKey(env,mode)) {
    throw new Problem(409,'Server Key Midtrans untuk mode ini belum dikonfigurasi di backend.');
  }
  await writeSetting(db,'config',JSON.stringify({mode,countdown})).run();
  return json({ok:true});
}

async function handleCashier(request, env, route) {
  const db = env.DB;
  if (route === '/api/cashier/status' && request.method === 'GET') {
    return json({configured:adminConfigured(env),authorized:await cashierAuthorized(env,request)});
  }
  if (route === '/api/cashier/login' && request.method === 'POST') return cashierLogin(env,await bodyOf(request));
  if (!await cashierAuthorized(env,request)) throw new Problem(401,'Masukkan PIN kasir.');
  if (route === '/api/cashier/dashboard' && request.method === 'GET') {
    const config = await shop(db);
    const offset = 8 * 60 * 60 * 1000;
    const day = 24 * 60 * 60 * 1000;
    const local = new Date(Date.now() + offset);
    const today = Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate()) - offset;
    const week = today - (local.getUTCDay() + 6) % 7 * day;
    const month = Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),1) - offset;
    const [metrics,pending,latest,promos] = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS total, COALESCE(SUM(total),0) AS revenue,
        COUNT(CASE WHEN paid_at >= ? THEN 1 END) AS today,
        COUNT(CASE WHEN paid_at >= ? THEN 1 END) AS week,
        COUNT(CASE WHEN paid_at >= ? THEN 1 END) AS month
        FROM orders WHERE mode='production' AND is_trial=0 AND status IN ('paid','completed')`).bind(today,week,month).first(),
      db.prepare("SELECT COUNT(*) AS count FROM orders WHERE status = 'pending' AND mode = 'production'").first(),
      db.prepare("SELECT reference,total,discount,status,CASE WHEN is_trial=1 THEN 'trial' ELSE mode END AS mode,created_at FROM orders ORDER BY created_at DESC LIMIT 35").all(),
      db.prepare('SELECT code,created_at FROM promo_codes WHERE revoked_at IS NULL ORDER BY created_at DESC, code ASC').all()
    ]);
    return json({config,ready:config.mode === 'trial' || Boolean(paymentKey(env,config.mode)),metrics,pending:pending.count,latest:latest.results,promos:promos.results,promoLimit:PROMO_LIMIT});
  }
  if (request.method !== 'POST') throw new Problem(405,'Metode tidak didukung.');
  const data = await bodyOf(request);
  if (route === '/api/cashier/voucher') return voucherIssue(db);
  if (route === '/api/cashier/voucher/revoke') return voucherRevoke(db,data);
  if (route === '/api/cashier/config') return configure(env,data);
  if (route === '/api/cashier/refresh') {
    const ref = String(data.reference || '');
    const order = await db.prepare('SELECT * FROM orders WHERE reference = ?').bind(ref).first();
    return updateOrder(env,order,'status');
  }
  if (route === '/api/cashier/logout') {
    await db.prepare('DELETE FROM cashier_sessions WHERE digest = ?').bind(await sessionDigest(env,cashierToken(request))).run();
    return json({ok:true},200,{'Set-Cookie':'st_cashier=; Path=/api/cashier; HttpOnly; SameSite=Strict; Secure; Max-Age=0'});
  }
  throw new Problem(404,'Halaman tidak ditemukan.');
}

async function handle(request, env) {
  const route = new URL(request.url).pathname.replace(/\/$/,'') || '/';
  if (!route.startsWith('/api/')) {
    const asset = assets[route];
    if (!asset || !['GET','HEAD'].includes(request.method)) return new Response('Halaman tidak ditemukan.',{status:404});
    let body = null;
    if (request.method !== 'HEAD') {
      body = asset.base64 ? Uint8Array.from(atob(asset.base64), character => character.charCodeAt(0)) : asset.body;
    }
    return new Response(body,{headers:{
      'Content-Type':asset.type,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer','Permissions-Policy':'camera=(self), microphone=()',
      'Content-Security-Policy':"default-src 'self'; img-src 'self' data: blob: https://api.midtrans.com https://api.sandbox.midtrans.com; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'"
    }});
  }
  if (!env.DB) throw new Problem(503,'Database Photobox belum terhubung.');
  if (route === '/api/photo/share' && request.method === 'POST') return sharePhoto(request,env);
  if (route.startsWith('/api/photo/download/') && ['GET','HEAD'].includes(request.method)) {
    return downloadPhoto(request,env,route.split('/').at(-1));
  }
  if (route.startsWith('/api/cashier/')) return handleCashier(request,env,route);
  if (route === '/api/shop' && request.method === 'GET') {
    const config = await shop(env.DB);
    return json({...config,ready:config.mode === 'trial' || Boolean(paymentKey(env,config.mode))});
  }
  if (request.method !== 'POST') throw new Problem(405,'Metode tidak didukung.');
  const data = await bodyOf(request);
  if (route === '/api/quote') {
    const config = await shop(env.DB);
    const voucher = data.code ? await lookupVoucher(env.DB,data.code,config.mode === 'trial') : null;
    return json({baseAmount:config.price,discount:voucher?.discount || 0,total:config.price-(voucher?.discount || 0)});
  }
  if (route === '/api/order/start') return createOrder(env,data);
  const actions = {'/api/order/status':'status','/api/order/cancel':'cancel','/api/order/complete':'complete','/api/order/simulate':'simulate'};
  if (actions[route]) return updateOrder(env,await getOrder(env.DB,data.id),actions[route]);
  throw new Problem(404,'Halaman tidak ditemukan.');
}

export default {
  async fetch(request, env) {
    try { return await handle(request,env); }
    catch (error) {
      if (error instanceof Problem) return json({error:error.message},error.status);
      console.error('Photobox request failed',error.name);
      return json({error:'Photobox sedang mengalami gangguan. Coba lagi sebentar.'},500);
    }
  }
};
