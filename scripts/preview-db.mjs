import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

export function previewDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  const root = new URL('../apps/api/drizzle/',import.meta.url);
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json',root),'utf8'));
  for (const {tag} of journal.entries) {
    sqlite.exec(readFileSync(new URL(tag + '.sql',root),'utf8'));
  }
  function wrap(sql, args=[]) {
    const statement = sqlite.prepare(sql);
    return {
      bind: (...values) => wrap(sql,values),
      first: async column => {
        const result = statement.get(...args);
        return column ? result?.[column] ?? null : result ?? null;
      },
      all: async () => ({results:statement.all(...args)}),
      run: async () => ({meta:statement.run(...args)})
    };
  }
  return {
    prepare:wrap,
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    }
  };
}

export function previewMidtrans() {
  const transactions = new Map();
  return {
    transactions,
    async fetch(input, init) {
      const url = new URL(input);
      if (url.hostname !== 'api.sandbox.midtrans.com') throw new Error('Preview only supports the simulated sandbox.');
      if (url.pathname === '/v2/charge') {
        const {transaction_details:details} = JSON.parse(init.body);
        if (transactions.has(details.order_id)) return Response.json({status_code:'406'});
        const transaction = {
          status_code:'201',order_id:details.order_id,
          transaction_id:'11111111-1111-1111-1111-111111111111',
          transaction_status:'pending',payment_type:'qris',fraud_status:'accept',
          gross_amount:details.gross_amount.toFixed(2),currency:'IDR'
        };
        transactions.set(details.order_id,transaction);
        return Response.json(transaction);
      }
      const [, , reference, action] = url.pathname.split('/');
      const transaction = transactions.get(reference);
      if (!transaction) return Response.json({status_code:'404'});
      if (action === 'cancel' && transaction.transaction_status === 'pending') transaction.transaction_status = 'cancel';
      return Response.json(transaction);
    }
  };
}
export function previewPhotoStorage() {
  const objects = new Map();
  return {
    async get(key) { return objects.get(key) ?? null; },
    async put(key, body, {customMetadata}) {
      for (const [previous,object] of objects) {
        if (Number(object.customMetadata.expiresAt) <= Date.now()) objects.delete(previous);
      }
      if (objects.size >= 40 && !objects.has(key)) objects.delete(objects.keys().next().value);
      objects.set(key,{body,customMetadata});
    }
  };
}
