self.addEventListener('fetch', event => {
  if (event.request.mode !== 'navigate' || new URL(event.request.url).pathname !== '/') return;
  event.respondWith(fetch(event.request).catch(() => new Response(
    '<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Photobox offline</title><h1>Koneksi terputus</h1><p>Sambungkan kembali iPad ke internet untuk memulai sesi.</p><p><a href="/">Coba lagi</a></p></html>',
    {status: 503, headers: {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store'}}
  )));
});
