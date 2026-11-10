const { Pool } = require('pg');

const pool = process.env.DATABASE_URL
  ? new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 30000,
  })
  : null;

if (pool) {
  pool.on('error', (error) => {
    console.error('Error en una conexión PostgreSQL inactiva:', error);
  });
}

let schemaReady;

async function getPool() {
  if (!pool) {
    const error = new Error('Configura DATABASE_URL con la URL privada de PostgreSQL de Render.');
    error.statusCode = 503;
    throw error;
  }
  if (!schemaReady) {
    schemaReady = pool.query(`
      CREATE TABLE IF NOT EXISTS synclife_accounts (
        firebase_uid TEXT PRIMARY KEY,
        email TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
        registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
  return pool;
}

async function syncAccount(user, role) {
  const database = await getPool();
  await database.query(`
    INSERT INTO synclife_accounts (firebase_uid, email, display_name, role)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (firebase_uid) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      role = EXCLUDED.role,
      last_login_at = NOW(),
      updated_at = NOW()
  `, [user.uid, user.email || '', user.displayName || '', role]);
}

async function deleteAccountRecord(uid) {
  const database = await getPool();
  await database.query('DELETE FROM synclife_accounts WHERE firebase_uid = $1', [uid]);
}

function isPostgresConfigured() {
  return Boolean(pool);
}

module.exports = { deleteAccountRecord, isPostgresConfigured, syncAccount };
