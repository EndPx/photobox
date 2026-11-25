const PROVIDER = {
  sandbox: 'https://api.sandbox.midtrans.com',
  production: 'https://api.midtrans.com'
};

async function midtrans(mode, key, path, body) {
  try {
    const response = await fetch(PROVIDER[mode] + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Basic ' + btoa(key + ':'),
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000)
    });
    return await response.json();
  } catch {
    throw new Problem(502, 'Midtrans sedang tidak bisa dihubungi. Coba lagi.');
  }
}

function qrImage(transaction, mode) {
  for (const name of ['generate-qr-code-v2', 'generate-qr-code']) {
    const action = transaction.actions?.find(item => item.name === name && item.method === 'GET');
    if (action) {
      try {
        const url = new URL(action.url);
        if (url.origin === PROVIDER[mode] && /\/qr-code$/.test(url.pathname) && !url.username && !url.password) return url.href;
      } catch {}
    }
  }
  // The documented v2 image can be recovered by transaction ID after a charge timeout.
  if (/^[a-f0-9-]{36}$/i.test(transaction.transaction_id || '')) {
    return PROVIDER[mode] + '/v2/qris/' + transaction.transaction_id + '/qr-code';
  }
  return null;
}

function matchesPayment(transaction, order) {
  return transaction.order_id === order.reference &&
    transaction.payment_type === 'qris' &&
    /^[0-9]+(?:\.00)?$/.test(String(transaction.gross_amount)) &&
    Number(transaction.gross_amount) === order.total &&
    transaction.currency === 'IDR';
}

async function recordProviderStatus(db, order, transaction) {
  if (!matchesPayment(transaction, order)) {
    throw new Problem(502, 'Rincian pembayaran dari Midtrans tidak cocok. Hubungi kasir.');
  }
  const now = Date.now();
  if (transaction.transaction_status === 'settlement' && transaction.fraud_status === 'accept') {
    await db.prepare("UPDATE orders SET status = 'paid', paid_at = ? WHERE id = ? AND status = 'pending'")
      .bind(now, order.id).run();
  }
  const status = {expire:'expired', cancel:'canceled', deny:'failed'}[transaction.transaction_status];
  if (status) {
    await db.prepare("UPDATE orders SET status = ? WHERE id = ? AND status = 'pending'")
      .bind(status, order.id).run();
  }
  if (transaction.transaction_status === 'pending' && !order.qr_url) {
    const qr = qrImage(transaction, order.mode);
    if (qr) await db.prepare('UPDATE orders SET qr_url = ? WHERE id = ? AND qr_url IS NULL').bind(qr, order.id).run();
  }
}

async function startProviderPayment(db, order, key) {
  if (order.qr_url || order.status !== 'pending') return;
  const transaction = await midtrans(order.mode, key, '/v2/charge', {
    payment_type: 'qris',
    transaction_details: {order_id: order.reference, gross_amount: order.total},
    qris: {acquirer: 'gopay'}
  });
  if (String(transaction.status_code) === '201' || transaction.transaction_status === 'settlement') {
    await recordProviderStatus(db, order, transaction);
    return;
  }
  // The provider enforces unique order IDs. A repeated charge recovers the same order.
  if (String(transaction.status_code) === '406' || String(transaction.status_code) === '409') {
    await refreshProviderPayment(db, order, key);
    return;
  }
  if (['400', '401', '403', '410', '411', '412'].includes(String(transaction.status_code))) {
    await db.prepare("UPDATE orders SET status = 'failed' WHERE id = ? AND status = 'pending' AND qr_url IS NULL")
      .bind(order.id).run();
    throw new Problem(502, 'Midtrans menolak pembuatan QRIS. Kasir perlu memeriksa pengaturan merchant.');
  }
  throw new Problem(502, 'QRIS belum diterbitkan. Coba lagi dari sesi pembayaran yang sama.');
}

async function refreshProviderPayment(db, order, key) {
  const data = await midtrans(order.mode, key, '/v2/' + order.reference + '/status');
  if (String(data.status_code) === '404') return;
  if (!data.transaction_status) throw new Problem(502, 'Status QRIS belum bisa diperiksa. Coba lagi.');
  await recordProviderStatus(db, order, data);
}

function paymentKey(env, mode) {
  if (mode === 'sandbox') return env.MIDTRANS_SANDBOX_SERVER_KEY?.trim() || null;
  if (mode === 'production') return env.MIDTRANS_PRODUCTION_SERVER_KEY?.trim() || null;
  return null;
}
