export async function api(path, data) {
  const response = await fetch('/api/' + path, data === undefined ? {} : {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(data)
  });
  let value;
  try { value = await response.json(); }
  catch { throw new Error('Koneksi terputus atau akun perlu masuk kembali.'); }
  if (!response.ok) {
    const error = new Error(value.error || 'Terjadi gangguan. Coba lagi.');
    error.status = response.status;
    throw error;
  }
  return value;
}

const activeKey = 'st-active-checkout-v2';
const amount = number => new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(number);
const token = () => Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('');

function loadCheckout() {
  try {
    const data = JSON.parse(localStorage.getItem(activeKey));
    if (/^[a-f0-9]{64}$/.test(data?.id)) return data;
  } catch {}
  return null;
}

export function createCheckout({root, onPaid, onHome}) {
  let active = loadCheckout();
  let order = null;
  let config = null;
  let appliedCode = '';
  let quote = null;
  let pending = false;
  let visible = false;
  let generation = 0;
  let pollTimer;

  function remember(value) {
    active = value;
    try {
      if (value) localStorage.setItem(activeKey,JSON.stringify(value));
      else localStorage.removeItem(activeKey);
    } catch {}
  }

  function alert(text) {
    const element = root.querySelector('#payment-message');
    if (element) element.textContent = text || '';
  }

  function hide() {
    visible = false;
    generation++;
    clearTimeout(pollTimer);
  }

  function leave() {
    hide();
    onHome();
  }

  function renderCheckout() {
    const price = order?.baseAmount ?? quote?.baseAmount ?? config?.price ?? 35000;
    const discount = order?.discount ?? quote?.discount ?? 0;
    const total = order?.total ?? quote?.total ?? price;
    const mode = order?.mode || config?.mode;
    const sandbox = mode === 'sandbox';
    const waiting = active && (!order || order.status === 'pending');
    root.innerHTML = `
      <section class="checkout-panel ${waiting?'is-waiting':''}">
        <div class="eyebrow">PEMBAYARAN QRIS</div>
        <h1>Bayar di sini, kakak!</h1>
        ${sandbox ? '<p class="demo-badge">MODE UJI MIDTRANS · tanpa pembayaran asli</p>' : ''}
        <div class="checkout-receipt">
          <div><span>Sesi foto · 3 pose</span><strong>${amount(price)}</strong></div>
          <div><span>Potongan promo</span><strong>${discount ? '−' + amount(discount) : '—'}</strong></div>
          <div class="checkout-total"><span>Total</span><strong>${amount(total)}</strong></div>
        </div>
        ${waiting ? `<div class="qr-panel">
          <strong>${order?.reference || 'Menyiapkan QRIS…'}</strong>
          <img id="payment-qr" alt="Kode QRIS untuk sesi ini" ${order?.qr ? '' : 'hidden'}>
          <p>${order?.qr
            ? (sandbox ? 'Gunakan simulator QRIS Midtrans Sandbox untuk transaksi uji.' : 'Pindai QR dengan aplikasi bank atau dompet digital di HP.')
            : 'QR sedang disiapkan. Lanjutkan dari sesi ini jika koneksi terputus.'}</p>
          <button class="secondary" id="check-payment" ${pending ? 'disabled' : ''}>${order?.qr ? 'Cek status pembayaran' : 'Coba tampilkan QRIS'}</button>
          ${order?.qr ? '<button class="quiet" id="cancel-payment">Batalkan QRIS</button>' : ''}
        </div>` : `<form id="redeem-form">
          <label class="form-field">Punya kode voucher?
            <span class="input-hint">Masukkan kode dari kasir untuk potongan Rp5.000.</span>
            <span class="redeem-input"><input id="redeem-code" maxlength="12" placeholder="Kode dari kasir" autocapitalize="characters" autocomplete="off"><button type="submit" class="secondary">Pakai kode</button></span>
          </label>
        </form>
        <div class="button-row"><button class="primary" id="pay-qris" ${config?.ready ? '' : 'disabled'}>Tampilkan QRIS</button><button class="quiet" id="payment-home">Kembali</button></div>`}
        <p id="payment-message" class="input-hint payment-message" role="status"></p>
      </section>`;
    const qr = root.querySelector('#payment-qr');
    if (qr && order?.qr) qr.src = order.qr;
    const input = root.querySelector('#redeem-code');
    if (input) input.value = appliedCode;
    root.querySelector('#redeem-form')?.addEventListener('submit',applyCode);
    input?.addEventListener('input',()=>{ if (input.value !== appliedCode && appliedCode) alert('Tekan Pakai kode untuk memperbarui potongan.'); });
    root.querySelector('#pay-qris')?.addEventListener('click',begin);
    root.querySelector('#payment-home')?.addEventListener('click',leave);
    root.querySelector('#check-payment')?.addEventListener('click',()=>order?.qr ? check(true) : start());
    root.querySelector('#cancel-payment')?.addEventListener('click',async event=>{
      if (pending) return;
      if (event.currentTarget.dataset.confirm !== 'yes') {
        event.currentTarget.dataset.confirm = 'yes';
        event.currentTarget.textContent = 'Ya, batalkan QRIS ini';
        alert('Kalau sudah membayar, pilih Cek status pembayaran.');
        return;
      }
      await check(true,'cancel');
    });
    if (!waiting && config && !config.ready) alert('QRIS belum aktif. Hubungi pengelola untuk mengaktifkan Midtrans.');
  }

  async function applyCode(event) {
    event.preventDefault();
    if (pending) return;
    const candidate = root.querySelector('#redeem-code').value.trim().toUpperCase();
    const run = generation;
    pending = true;
    try {
      quote = await api('quote',{code:candidate});
      if (run !== generation) return;
      appliedCode = candidate;
      renderCheckout();
      alert(candidate ? 'Kode berlaku. Potongan Rp5.000 sudah dipakai pada total.' : 'Kode dilepas.');
    } catch (error) {
      if (run !== generation) return;
      quote = null;
      appliedCode = '';
      renderCheckout();
      root.querySelector('#redeem-code').value = candidate;
      alert(error.message);
    } finally { if (run === generation) pending = false; }
  }

  async function begin() {
    if (pending) return;
    const entered = root.querySelector('#redeem-code').value.trim().toUpperCase();
    if (entered !== appliedCode) {
      alert('Tekan Pakai kode untuk memperbarui potongan sebelum membayar.');
      return;
    }
    remember({id:token(),code:entered});
    order = null;
    await start();
  }

  function accept(row) {
    order = row;
    if (row.status === 'paid') {
      hide();
      onPaid(active.id);
      return true;
    }
    if (row.status !== 'pending') {
      remember(null);
      order = null;
      quote = null;
      appliedCode = '';
      renderCheckout();
      alert({expired:'QRIS kedaluwarsa. Buat QRIS baru untuk melanjutkan.',canceled:'QRIS dibatalkan. Kode promo bisa dipakai lagi.',failed:'Pembayaran gagal. Buat QRIS baru untuk melanjutkan.'}[row.status] || 'Sesi ini sudah selesai.');
      return true;
    }
    return false;
  }

  function schedule() {
    clearTimeout(pollTimer);
    if (active && visible && order?.status === 'pending') pollTimer = setTimeout(()=>check(false),10000);
  }

  async function start() {
    if (!active || pending) return;
    pending = true;
    const run = generation;
    renderCheckout();
    let errorMessage = '';
    try {
      const row = await api('order/start',active);
      if (run !== generation) return;
      pending = false;
      if (accept(row)) return;
    } catch (error) {
      if (run !== generation) return;
      if ([400,404,409,410].includes(error.status)) remember(null);
      errorMessage = error.message;
    } finally {
      if (run === generation) {
        pending = false;
        if (active || errorMessage) renderCheckout();
        if (errorMessage) alert(errorMessage);
        schedule();
      }
    }
  }

  async function check(manual,action='status') {
    if (!active || pending) return;
    pending = true;
    clearTimeout(pollTimer);
    const run = generation;
    if (manual) alert('Memeriksa pembayaran…');
    try {
      const row = await api('order/' + action,{id:active.id});
      if (run !== generation) return;
      pending = false;
      const prior = order?.qr;
      if (accept(row)) return;
      if (prior !== row.qr || manual) renderCheckout();
      if (manual) alert('Pembayaran belum diterima. Tunggu sebentar setelah memindai QRIS.');
    } catch (error) {
      if (run !== generation) return;
      if (error.status === 404 && !order) {
        pending = false;
        await start();
        return;
      }
      if (error.status === 410) {
        remember(null);
        order = null;
        renderCheckout();
      }
      if (manual || error.status === 410) alert(error.message);
    } finally {
      if (run === generation) {
        pending = false;
        schedule();
      }
    }
  }

  return {
    async open(currentConfig) {
      hide();
      visible = true;
      pending = false;
      config = currentConfig;
      order = null;
      quote = null;
      appliedCode = '';
      renderCheckout();
      if (active) await check(true);
    },
    hide,
    hasActive:()=>Boolean(active),
    async complete() {
      if (!active) return;
      await api('order/complete',{id:active.id});
      remember(null);
      order = null;
    }
  };
}
