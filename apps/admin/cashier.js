import {api} from './checkout.js';

const root = document.querySelector('#app');
const logout = document.querySelector('#cashier-logout');
const money = value => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(value);
const wita = new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Makassar',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
const modes = {trial:'QRIS dummy',sandbox:'Sandbox Midtrans',production:'Produksi'};
const statuses = {pending:'Menunggu QRIS',paid:'Dibayar',completed:'Foto selesai',canceled:'Dibatalkan',expired:'Kedaluwarsa',failed:'Gagal'};

async function open() {
  try {
    const state = await api('cashier/status');
    logout.hidden = !state.authorized;
    if (state.authorized) return await dashboard();
    if (!state.configured) {
      root.innerHTML = '<section class="checkout-panel"><h1>Admin belum siap</h1><p>Atur kredensial admin di environment backend.</p></section>';
      return;
    }
    root.innerHTML = `<section class="checkout-panel"><h1>Masuk admin</h1>
      <form id="cashier-access">
        <label class="form-field">Username <input name="username" maxlength="128" required autocomplete="username" spellcheck="false" autocapitalize="none"></label>
        <label class="form-field">Password <input name="password" type="password" maxlength="512" required autocomplete="current-password"></label>
        <button class="primary">Masuk</button>
        <p role="status" class="input-hint" id="login-status"></p>
      </form></section>`;
    submit('#cashier-access',async values=>{
      await api('cashier/login',values);
      await open();
    },'#login-status');
  } catch (error) {
    root.textContent = error.message;
  }
}

function submit(selector, handler, statusSelector) {
  const form = root.querySelector(selector);
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    const button = form.querySelector('button[type=submit], button:not([type])');
    if (button.disabled) return;
    const status = root.querySelector(statusSelector);
    status.textContent = '';
    button.disabled = true;
    try { await handler(Object.fromEntries(new FormData(form))); }
    catch (error) { status.textContent = error.message; }
    finally { button.disabled = false; }
  });
}

let view = 'transactions';

async function dashboard(message='') {
  const data = await api('cashier/dashboard');
  const {config} = data;
  root.innerHTML = `<div class="page-top"><div><div class="eyebrow">SIMPANG SAMPING OBOR</div><h1>Panel kasir</h1><p>Kelola pembayaran, voucher, dan pengaturan kiosk.</p></div><a class="secondary brand-link" href="/">Buka layar Photobox</a></div>
  <nav class="admin-nav" aria-label="Menu admin">${[['transactions','Transaksi'],['vouchers','Voucher'],['settings','Pengaturan']].map(([id,label])=>`<button type="button" class="pill ${view===id?'selected':''}" data-admin-view="${id}" aria-pressed="${view===id}">${label}</button>`).join('')}</nav>
  <div class="cashier-grid" ${view==='transactions'?'hidden':''}>
    <section class="cashier-card" ${view==='vouchers'?'':'hidden'}>
      <h2>Voucher Rp5.000</h2>
      <p>${data.promos.length} dari ${data.promoLimit} kode aktif. Setiap kode bisa dipakai ulang selama aktif.</p>
      <div class="promo-list" id="promo-list"></div>
      <form id="issue-form">
        <button class="primary" ${data.promos.length>=data.promoLimit?'disabled':''}>Buat kode baru</button>
      </form>
      <p id="issue-status" role="status" class="input-hint"></p>
    </section>
    <section class="cashier-card" ${view==='settings'?'':'hidden'}>
      <h2>Pengaturan sesi dan QRIS</h2>
      <p><strong>${modes[config.mode]}</strong> · ${config.mode==='trial'?'Siap dicoba tanpa Midtrans':data.ready?'Server Key tersedia di backend':'QRIS belum terhubung'}</p>
      <form id="config-form">
        <div class="settings-grid"><p>Harga per sesi <strong>${money(config.price)}</strong></p>
          <label class="form-field">Hitung mundur per pose<select name="countdown">${[3,5,8].map(n=>`<option value="${n}" ${n===config.countdown?'selected':''}>${n} detik</option>`).join('')}</select></label>
        </div>
        <label class="form-field">Mode pembayaran<select name="mode"><option value="trial" ${config.mode==='trial'?'selected':''}>QRIS dummy · trial</option><option value="production" ${config.mode==='production'?'selected':''}>Produksi · pembayaran asli</option><option value="sandbox" ${config.mode==='sandbox'?'selected':''}>Sandbox · simulasi</option></select></label>
        <button class="primary">Simpan pengaturan</button>
      </form>
      <p id="config-status" role="status" class="input-hint"></p>
    </section>
  </div>
  <section class="cashier-card cashier-ledger" ${view==='transactions'?'':'hidden'}>
    <div class="page-top"><div><h2>Pembayaran Photobox</h2><p>Pembayaran produksi terverifikasi · waktu Tabalong (WITA).</p></div><button class="secondary" id="refresh-ledger">Segarkan</button></div>
    <div class="metrics admin-metrics">${[['Total transaksi',data.metrics.total],['Hari ini',data.metrics.today],['Minggu ini',data.metrics.week],['Bulan ini',data.metrics.month]].map(([label,value])=>`<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>
    <p>Total diterima <strong>${money(data.metrics.revenue)}</strong> · ${data.pending} menunggu QRIS</p>
    <div class="ledger-scroll"><table class="history"><thead><tr><th>Sesi</th><th>Waktu</th><th>Total</th><th>Potongan</th><th>Status</th><th></th></tr></thead><tbody id="payments-list"></tbody></table></div>
    <p id="ledger-status" class="input-hint" role="status"></p>
  </section>`;
  root.querySelector(view==='vouchers'?'#issue-status':'#config-status').textContent = message;
  root.querySelectorAll('[data-admin-view]').forEach(button=>button.addEventListener('click',()=>{
    view = button.dataset.adminView;
    dashboard().catch(error=>root.textContent=error.message);
  }));
  const list = root.querySelector('#payments-list');
  for (const payment of data.latest) {
    const row = list.insertRow();
    for (const value of [payment.reference,wita.format(payment.created_at),money(payment.total),money(payment.discount),
      (payment.mode==='trial'?'Trial · ':payment.mode==='sandbox'?'Uji · ':'')+(statuses[payment.status]||payment.status)]) row.insertCell().textContent=value;
    const buttonCell = row.insertCell();
    if (payment.status === 'pending' && payment.mode !== 'trial') {
      const button = document.createElement('button');
      button.className = 'quiet';
      button.textContent = 'Cek QRIS';
      button.addEventListener('click',async()=>{
        button.disabled = true;
        try {
          await api('cashier/refresh',{reference:payment.reference});
          await dashboard();
        } catch (error) {
          root.querySelector('#ledger-status').textContent = error.message;
          button.disabled = false;
        }
      });
      buttonCell.append(button);
    }
  }
  if (!data.latest.length) root.querySelector('#ledger-status').textContent = 'Belum ada sesi QRIS.';
  root.querySelector('#refresh-ledger').addEventListener('click',()=>dashboard().catch(error=>root.querySelector('#ledger-status').textContent=error.message));
  const promoList = root.querySelector('#promo-list');
  const promoStatus = root.querySelector('#issue-status');
  for (const promo of data.promos) {
    const row = document.createElement('div');
    row.className = 'promo-row';
    const code = promo.code.slice(0,4)+'-'+promo.code.slice(4);
    const label = document.createElement('strong');
    label.textContent = code;
    const copy = document.createElement('button');
    copy.className = 'secondary';
    copy.textContent = 'Salin';
    copy.addEventListener('click',async()=>{
      try { await navigator.clipboard.writeText(code); promoStatus.textContent = 'Kode disalin.'; }
      catch { promoStatus.textContent = 'Salin kode yang tertera di layar.'; }
    });
    const disable = document.createElement('button');
    disable.className = 'quiet';
    disable.textContent = 'Nonaktifkan';
    disable.addEventListener('click',async()=>{
      if (!window.confirm('Nonaktifkan kode voucher ini?')) return;
      disable.disabled = true;
      try {
        await api('cashier/voucher/revoke',{code:promo.code});
        await dashboard('Kode dinonaktifkan. Kamu bisa membuat kode pengganti.');
      } catch (error) {
        promoStatus.textContent = error.message;
        disable.disabled = false;
      }
    });
    row.append(label,copy,disable);
    promoList.append(row);
  }
  submit('#issue-form',async()=>{
    await api('cashier/voucher',{});
    await dashboard('Kode voucher baru siap digunakan.');
  },'#issue-status');
  submit('#config-form',async values=>{
    await api('cashier/config',values);
    await dashboard('Pengaturan tersimpan.');
  },'#config-status');
}

logout.addEventListener('click',async()=>{
  try { await api('cashier/logout',{}); await open(); }
  catch (error) { root.textContent=error.message; }
});
open();
