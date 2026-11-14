// Database connection. The app uses the default schema; tests pass schema: 'test'.
// Needs the Supabase SESSION pooler string (SET search_path would not survive the
// transaction pooler).
require('dotenv').config();
const { Pool } = require('pg');

function createPool({ connectionString, schema } = {}) {
  if (!connectionString) throw new Error('Database connection string is missing');
  const pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 5 });
  if (schema) {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid schema name');
    pool.on('connect', (client) => {
      client.query(`SET search_path TO ${schema}`).catch((err) => console.error('search_path failed:', err.message));
    });
  }
  pool.on('error', (err) => console.error('Unexpected database pool error:', err.message));
  return pool;
}

let appPool;
function getPool() {
  if (!appPool) appPool = createPool({ connectionString: process.env.DATABASE_URL });
  return appPool;
}

module.exports = { createPool, getPool };
