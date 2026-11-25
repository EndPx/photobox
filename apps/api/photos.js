const PHOTO_MAX = 2500000;
const PHOTO_LIFETIME = 24 * 60 * 60 * 1000;

async function boundedBody(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) throw new Problem(413,'Permintaan terlalu besar.');
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const {done,value} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Problem(413,'Permintaan terlalu besar.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function jpegBody(request) {
  if (request.headers.get('Content-Type') !== 'image/jpeg') throw new Problem(415,'Unggah hasil foto dalam format JPG.');
  const bytes = await boundedBody(request,PHOTO_MAX);
  const size = bytes.byteLength;
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff ||
      bytes[size-2] !== 0xff || bytes[size-1] !== 0xd9) throw new Problem(415,'File JPG tidak valid.');
  return bytes;
}

async function sharePhoto(request, env) {
  if (request.headers.get('Origin') !== new URL(request.url).origin) throw new Problem(403,'Permintaan harus berasal dari Photobox.');
  const id = request.headers.get('X-Photo-Session');
  const order = await getOrder(env.DB,id);
  const now = Date.now();
  if (!order?.paid_at || now >= order.paid_at + PHOTO_LIFETIME || !['paid','completed'].includes(order.status)) {
    throw new Problem(403,'Sesi foto sudah berakhir atau belum dibayar.');
  }
  if (!env.PHOTOS) throw new Problem(503,'Unduhan QR belum tersedia. Gunakan Unduh JPG.');
  const token = await hash('photobox-download:' + id);
  const expiresAt = order.paid_at + PHOTO_LIFETIME;
  await env.PHOTOS.put('photo/' + token,await jpegBody(request),{customMetadata:{expiresAt:String(expiresAt)}});
  return json({path:'/api/photo/download/' + token,expiresAt});
}

async function downloadPhoto(request, env, token) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Problem(404,'Foto tidak tersedia.');
  const object = await env.PHOTOS?.get('photo/' + token);
  const expiresAt = Number(object?.customMetadata?.expiresAt);
  if (!object || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Problem(404,'Foto tidak tersedia atau tautan sudah kedaluwarsa.');
  return new Response(request.method === 'HEAD' ? null : object.body,{
    headers:{
      'Cache-Control':'private, no-store',
      'Content-Type':'image/jpeg',
      'Content-Disposition':'attachment; filename="photobox-obor.jpg"',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer',
      'X-Robots-Tag':'noindex, nofollow'
    }
  });
}
