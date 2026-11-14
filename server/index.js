// Starts the server. Reads DATABASE_URL, CLIENT_URL (comma-separated origins) and PORT.
require('dotenv').config();
const { getPool } = require('./db');
const { createRepo } = require('./repo');
const { createApp } = require('./app');

for (const name of ['DATABASE_URL', 'CLIENT_URL']) {
  if (!process.env[name]) {
    console.error(`${name} is missing. Create server/.env (see .env.example).`);
    process.exit(1);
  }
}

const pool = getPool();
const app = createApp({ repo: createRepo(pool), clientUrl: process.env.CLIENT_URL });
const port = Number(process.env.PORT) || 4000;
const server = app.listen(port, () => console.log(`API listening on port ${port}`));

function shutdown() {
  server.close(() => pool.end().finally(() => process.exit(0)));
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
