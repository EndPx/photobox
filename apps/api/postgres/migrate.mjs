import {readFile} from 'node:fs/promises';
import {neon} from '@neondatabase/serverless';

const migrations = ['0001_initial.sql','0002_remove_legacy_vouchers.sql'];
const requested = process.argv[2];
if (requested && !migrations.includes(requested)) throw new Error('Unknown PhotoBox migration.');

try { process.loadEnvFile(new URL('../.env',import.meta.url)); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL must point to the selected Neon branch.');
const sql = neon(process.env.DATABASE_URL);
const statements = [];
for (const file of requested ? [requested] : migrations) {
  const source = await readFile(new URL(file,import.meta.url),'utf8');
  const separator = source.includes('--> statement-breakpoint') ? '--> statement-breakpoint' : ';';
  statements.push(...source.split(separator).map(statement=>statement.trim()).filter(Boolean));
}
await sql.transaction(statements.map(statement=>sql.query(statement)));
console.log('PhotoBox schema migration applied.');
