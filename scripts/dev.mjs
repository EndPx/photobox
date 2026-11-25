import {createServer} from 'node:http';
import worker from '../dist/server/index.js';
import {previewDatabase,previewPhotoStorage} from './preview-db.mjs';

const envFile = new URL('../apps/api/.env', import.meta.url);
try { process.loadEnvFile(envFile); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const env = {DB:previewDatabase(), PHOTOS:previewPhotoStorage(), ...Object.fromEntries([
  'ADMIN_USERNAME', 'ADMIN_PASSWORD', 'MIDTRANS_SANDBOX_SERVER_KEY', 'MIDTRANS_PRODUCTION_SERVER_KEY'
].map(key => [key, process.env[key]]))};
const arg = process.argv.indexOf('--port');
const port = Number(process.env.PORT || (arg >= 0 ? process.argv[arg+1] : 4173));
createServer(async (req,res)=>{
  const body = [];
  let received = 0;
  for await (const chunk of req) {
    received += chunk.length;
    if (received > 2500000) {
      res.writeHead(413,{'Content-Type':'application/json','Connection':'close'});
      res.end(JSON.stringify({error:'Permintaan terlalu besar.'}));
      return;
    }
    body.push(chunk);
  }
  const url = 'http://' + req.headers.host + req.url;
  const headers = new Headers(req.headers);
  const response = await worker.fetch(new Request(url,{
    method:req.method,headers,body:body.length ? Buffer.concat(body) : undefined
  }),env);
  res.writeHead(response.status,Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port,'127.0.0.1',()=>console.log('Photobox preview on port ' + port));
