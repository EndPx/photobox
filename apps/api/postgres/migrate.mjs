import {readFile} from 'node:fs/promises';
import {neon} from '@neondatabase/serverless';

try { process.loadEnvFile(new URL('../.env',import.meta.url)); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point to the selected Neon branch.');
const sql = neon(process.env.DATABASE_URL);
const migration = await readFile(new URL('./0001_initial.sql',import.meta.url),'utf8');
await sql.transaction(migration.split(';').map(statement=>statement.trim()).filter(Boolean)
  .map(statement=>sql.query(statement)));
console.log('PhotoBox schema migration applied.');
