import {neon} from '@neondatabase/serverless';

export function postgresDatabase(sql) {
  // PostgreSQL returns int8 counts and epoch timestamps as strings.
  function rows(result) {
    const integers = (result.fields ?? []).filter(field => field.dataTypeID === 20);
    return result.rows.map(row => {
      const mapped = {...row};
      for (const {name} of integers) {
        if (mapped[name] == null) continue;
        const value = Number(mapped[name]);
        if (!Number.isSafeInteger(value)) throw new RangeError('PostgreSQL integer exceeds JavaScript safe range.');
        mapped[name] = value;
      }
      return mapped;
    });
  }

  function prepare(statement, args=[]) {
    let index = 0;
    const query = statement.replace(/\?/g, () => '$'+(++index));
    const execute = () => sql.query(query,args);
    return {
      bind: (...values) => prepare(statement,values),
      execute,
      async first(column) {
        const row = rows(await execute())[0];
        return column ? row?.[column] ?? null : row ?? null;
      },
      async all() { return {results:rows(await execute())}; },
      async run() { return {meta:{changes:(await execute()).rowCount}}; }
    };
  }

  return {
    prepare,
    batch: statements => sql.transaction(statements.map(statement => statement.execute()))
  };
}

export function neonDatabase(url) {
  return url ? postgresDatabase(neon(url,{fullResults:true})) : null;
}
