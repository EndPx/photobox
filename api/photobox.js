import app from '../dist/server/index.js';
import {neonDatabase} from '../apps/api/postgres/database.mjs';

const env = {
  DB: neonDatabase(process.env.DATABASE_URL),
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  MIDTRANS_SANDBOX_SERVER_KEY: process.env.MIDTRANS_SANDBOX_SERVER_KEY,
  MIDTRANS_PRODUCTION_SERVER_KEY: process.env.MIDTRANS_PRODUCTION_SERVER_KEY,
};

export default {
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/api/photobox') {
      const route = url.searchParams.get('photoboxRoute');
      if (!route || !/^[a-z0-9/-]+$/.test(route)) return new Response('Not found',{status:404});
      url.pathname = '/api/' + route;
      url.search = '';
      request = new Request(url,request);
    }
    return app.fetch(request,env);
  }
};
