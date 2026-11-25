import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {previewDatabase,previewMidtrans,previewPhotoStorage} from '../scripts/preview-db.mjs';
import worker from '../dist/server/index.js';

test('admin sessions, reusable vouchers, settlement, reporting, and photo download', async context=>{
  const database = previewDatabase();
  const midtrans = previewMidtrans();
  context.mock.method(globalThis,'fetch',midtrans.fetch);
  const env = {DB:database,PHOTOS:previewPhotoStorage(),ADMIN_USERNAME:'operator',ADMIN_PASSWORD:'fixture-password-123',MIDTRANS_SANDBOX_SERVER_KEY:'SB-fixture-server-key'};
  const origin = 'https://photobox.test';
  let cashierCookie;
  const call = async (path, body, options={})=>{
    const headers = new Headers({'Origin':origin,'Content-Type':'application/json'});
    if (options.cashier && cashierCookie) headers.set('Cookie',cashierCookie);
    const response = await worker.fetch(new Request(origin+'/api/'+path,{
      method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)
    }),env);
    return {status:response.status,payload:await response.json(),cookie:response.headers.get('Set-Cookie')};
  };
  const newId = ()=>randomBytes(32).toString('hex');
  assert.deepEqual((await call('shop')).payload,{price:35000,countdown:3,mode:'sandbox',ready:true,photoShare:true});
  assert.equal((await call('cashier/login',{username:'operator',password:'wrong'})).status,401);
  const login = await call('cashier/login',{username:'operator',password:'fixture-password-123'});
  assert.equal(login.status,200);
  assert.match(login.cookie,/HttpOnly; SameSite=Strict; Secure/);
  cashierCookie = login.cookie.split(';')[0];
  assert.equal((await call('cashier/voucher',{})).status,401);
  const {payload:voucher} = await call('cashier/voucher',{},{cashier:true});
  assert.equal(voucher.code.length,8);
  const createdPromos = await Promise.all(Array.from({length:5},()=>call('cashier/voucher',{},{cashier:true})));
  assert.equal(createdPromos.filter(item=>item.status===201).length,4);
  assert.equal(createdPromos.filter(item=>item.status===409).length,1);
  const toReplace = createdPromos.find(item=>item.status===201).payload.code;
  assert.equal((await call('cashier/voucher/revoke',{code:toReplace},{cashier:true})).status,200);
  assert.equal((await call('quote',{code:toReplace})).status,409);
  assert.equal((await call('cashier/voucher',{},{cashier:true})).status,201);
  const quote = await call('quote',{code:voucher.code.slice(0,4)+'-'+voucher.code.slice(4)});
  assert.deepEqual(quote.payload,{baseAmount:35000,discount:5000,total:30000});
  const trialId = newId();
  await database.prepare(`INSERT INTO orders (id,reference,base_amount,discount,total,mode,status,created_at,is_trial)
    VALUES (?,?,35000,0,35000,'sandbox','pending',?,1)`).bind(trialId,trialId,Date.now()).run();
  assert.equal((await call('order/start',{id:trialId})).status,410);
  assert.equal((await call('order/status',{id:trialId})).status,410);
  assert.equal((await call('order/simulate',{id:trialId})).status,404);
  assert.equal((await call('cashier/config',{mode:'trial',countdown:3},{cashier:true})).status,400);
  env.MIDTRANS_SANDBOX_SERVER_KEY = '';
  assert.equal((await call('shop')).payload.ready,false);
  assert.equal((await call('order/start',{id:newId()})).status,503);
  assert.equal(midtrans.transactions.size,0);
  env.MIDTRANS_SANDBOX_SERVER_KEY = 'SB-fixture-server-key';
  const fullPriceId = newId();
  assert.equal((await call('order/start',{id:fullPriceId})).payload.total,35000);
  assert.equal((await call('order/cancel',{id:fullPriceId})).payload.status,'canceled');

  const sandboxVoucher = voucher;
  const id = newId();
  const created = await call('order/start',{id,code:sandboxVoucher.code});
  assert.equal((await call('order/simulate',{id})).status,404);
  assert.equal(created.status,200);
  assert.equal(created.payload.status,'pending');
  assert.equal(created.payload.total,30000);
  assert.equal(await database.prepare('SELECT promo_code FROM orders WHERE id=?').bind(id).first('promo_code'),voucher.code);
  assert.match(created.payload.qr,/api\.sandbox\.midtrans\.com/);
  assert.equal((await call('order/start',{id:newId(),code:sandboxVoucher.code})).status,200);
  assert.equal((await call('order/complete',{id})).status,409);
  const transaction = midtrans.transactions.get(created.payload.reference);
  transaction.transaction_status = 'settlement';
  transaction.gross_amount = '24000.00';
  await database.prepare('UPDATE orders SET provider_checked_at=0 WHERE id=?').bind(id).run();
  assert.equal((await call('order/status',{id})).status,502);
  assert.equal((await call('order/complete',{id})).status,409);
  transaction.gross_amount = '30000.00';
  await database.prepare('UPDATE orders SET provider_checked_at=0 WHERE id=?').bind(id).run();
  assert.equal((await call('order/status',{id})).payload.status,'paid');
  assert.equal((await call('order/complete',{id})).payload.status,'completed');
  assert.equal((await call('order/complete',{id})).payload.status,'completed');
  assert.equal((await call('quote',{code:voucher.code})).status,200);

  const photoBytes = Uint8Array.of(255,216,255,224,255,217);
  const share = (session,requestOrigin=origin) => worker.fetch(new Request(origin+'/api/photo/share',{
    method:'POST',headers:{Origin:requestOrigin,'Content-Type':'image/jpeg','X-Photo-Session':session},body:photoBytes
  }),env);
  assert.equal((await share(newId())).status,403);
  assert.equal((await share(trialId)).status,403);
  assert.equal((await share(id,'https://other.test')).status,403);
  const upload = await share(id);
  assert.equal(upload.status,200);
  const {path,expiresAt} = await upload.json();
  assert(expiresAt>Date.now());
  assert(!path.includes(id));
  const download = await worker.fetch(new Request(origin+path),env);
  assert.equal(download.status,200);
  assert.equal(download.headers.get('Cache-Control'),'private, no-store');
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()),photoBytes);
  await env.PHOTOS.put('photo/'+path.split('/').at(-1),photoBytes,{customMetadata:{expiresAt:String(Date.now()-1)}});
  assert.equal((await worker.fetch(new Request(origin+path),env)).status,404);

  const ledger = await call('cashier/dashboard',undefined,{cashier:true});
  assert.equal(ledger.payload.metrics.revenue,0);
  assert(ledger.payload.latest.some(order=>order.mode==='sandbox' && order.status==='completed'));
  assert.equal(ledger.payload.promos.length,5);
  assert(ledger.payload.latest.some(order => order.mode==='trial' && order.status==='pending'));
  const time = Date.now();
  const day = 86400000;
  const offset = 8 * 3600000;
  const local = new Date(time+offset);
  const today = Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),local.getUTCDate())-offset;
  const week = today - (local.getUTCDay()+6)%7 * day;
  const month = Date.UTC(local.getUTCFullYear(),local.getUTCMonth(),1)-offset;
  const businessPayments = [time,today-1,week-1,month-1];
  for (const at of businessPayments) {
    const orderId = newId();
    await database.prepare(`INSERT INTO orders (id,reference,base_amount,discount,total,mode,status,created_at,paid_at)
      VALUES (?,?,35000,0,35000,'production','paid',?,?)`).bind(orderId,orderId,at,at).run();
  }
  assert.deepEqual((await call('cashier/dashboard',undefined,{cashier:true})).payload.metrics,{
    total:4,revenue:140000,today:1,week:businessPayments.filter(at=>at>=week).length,
    month:businessPayments.filter(at=>at>=month).length
  });

  const next = sandboxVoucher;
  const canceledId = newId();
  assert.equal((await call('order/start',{id:canceledId,code:next.code})).payload.status,'pending');
  assert.equal((await call('order/cancel',{id:canceledId})).payload.status,'canceled');
  assert.equal((await call('order/start',{id:newId(),code:next.code})).payload.total,30000);
  env.ADMIN_PASSWORD = 'rotated-fixture-password-456';
  assert.equal((await call('cashier/dashboard',undefined,{cashier:true})).status,401);
});
