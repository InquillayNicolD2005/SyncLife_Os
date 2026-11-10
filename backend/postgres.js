const { Pool } = require('pg');
const { ROOT_ADMIN_EMAIL } = require('./admin-identity');

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
        providers JSONB NOT NULL DEFAULT '[]'::jsonb,
        disabled BOOLEAN NOT NULL DEFAULT FALSE,
        registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_login_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => pool.query(`
      ALTER TABLE synclife_accounts
        ADD COLUMN IF NOT EXISTS providers JSONB NOT NULL DEFAULT '[]'::jsonb,
        ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS admin_granted_by TEXT
    `)).then(() => pool.query(`
      UPDATE synclife_accounts
      SET role = CASE WHEN LOWER(email) = $1 THEN 'admin' ELSE 'user' END,
          admin_granted_by = CASE WHEN LOWER(email) = $1 THEN 'system-root' ELSE NULL END
      WHERE admin_granted_by IS NULL
    `, [ROOT_ADMIN_EMAIL])).then(() => pool.query(`
      UPDATE synclife_accounts
      SET role = 'admin', admin_granted_by = 'system-root'
      WHERE LOWER(email) = $1
    `, [ROOT_ADMIN_EMAIL])).then(() => pool.query(`
      CREATE TABLE IF NOT EXISTS synclife_activity_events (
        id BIGSERIAL PRIMARY KEY,
        firebase_uid TEXT NOT NULL REFERENCES synclife_accounts(firebase_uid) ON DELETE CASCADE,
        event_type TEXT NOT NULL CHECK (event_type IN ('meal', 'routine', 'exercise', 'daily-record')),
        record_id TEXT NOT NULL,
        score SMALLINT,
        event_date DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (firebase_uid, event_type, record_id),
        CHECK (score IS NULL OR (score >= 0 AND score <= 100))
      )
    `)).then(() => pool.query(`
      CREATE INDEX IF NOT EXISTS synclife_activity_events_created_at_idx
      ON synclife_activity_events (event_type, created_at DESC)
    `)).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
  return pool;
}

async function syncAccount(user) {
  const database = await getPool();
  const registeredAt = user.metadata?.creationTime || new Date().toISOString();
  const lastLoginAt = user.metadata?.lastSignInTime || registeredAt;
  const isRootAdmin = user.email?.trim().toLowerCase() === ROOT_ADMIN_EMAIL;
  const isFirebaseAdmin = isRootAdmin || user.customClaims?.admin === true;
  const providers = Array.isArray(user.providerData)
    ? user.providerData.map((provider) => provider.providerId).filter(Boolean)
    : [];
  const result = await database.query(`
    INSERT INTO synclife_accounts (
      firebase_uid, email, display_name, role, providers, disabled, registered_at, last_login_at,
      admin_granted_by
    )
    VALUES (
      $1, $2, $3, CASE WHEN $8 THEN 'admin' ELSE 'user' END,
      $4::jsonb, $5, $6::timestamptz, $7::timestamptz,
      CASE WHEN $9 THEN 'system-root' WHEN $8 THEN 'firebase-claim' ELSE NULL END
    )
    ON CONFLICT (firebase_uid) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      role = EXCLUDED.role,
      admin_granted_by = CASE
        WHEN $9 THEN 'system-root'
        WHEN $8 THEN COALESCE(synclife_accounts.admin_granted_by, 'firebase-claim')
        ELSE NULL
      END,
      providers = $4,
      disabled = $5,
      registered_at = LEAST(synclife_accounts.registered_at, $6::timestamptz),
      last_login_at = GREATEST(synclife_accounts.last_login_at, $7::timestamptz),
      updated_at = NOW()
    RETURNING role, admin_granted_by
  `, [
    user.uid,
    user.email || '',
    user.displayName || '',
    JSON.stringify(providers),
    Boolean(user.disabled),
    registeredAt,
    lastLoginAt,
    isFirebaseAdmin,
    isRootAdmin,
  ]);
  return {
    admin: result.rows[0]?.role === 'admin',
    superAdmin: result.rows[0]?.admin_granted_by === 'system-root',
  };
}

async function syncAccounts(users) {
  const database = await getPool();
  const rows = users.map((user) => ({
    uid: user.uid,
    email: user.email || '',
    name: user.displayName || '',
    role: user.email?.trim().toLowerCase() === ROOT_ADMIN_EMAIL || user.customClaims?.admin === true
      ? 'admin'
      : 'user',
    adminGrantedBy: user.email?.trim().toLowerCase() === ROOT_ADMIN_EMAIL
      ? 'system-root'
      : user.customClaims?.admin === true
        ? 'firebase-claim'
        : null,
    providers: Array.isArray(user.providerData)
      ? user.providerData.map((provider) => provider.providerId).filter(Boolean)
      : [],
    disabled: Boolean(user.disabled),
    registeredAt: user.metadata?.creationTime || new Date().toISOString(),
    lastLoginAt: user.metadata?.lastSignInTime || user.metadata?.creationTime || new Date().toISOString(),
  }));
  if (!rows.length) return;

  await database.query(`
    INSERT INTO synclife_accounts (
      firebase_uid, email, display_name, role, providers, disabled, registered_at, last_login_at,
      admin_granted_by
    )
    SELECT firebase_uid, email, display_name,
      role, providers, disabled, registered_at, last_login_at, admin_granted_by
    FROM jsonb_to_recordset($1::jsonb) AS accounts(
      firebase_uid text, email text, display_name text, role text, providers jsonb,
      disabled boolean, registered_at timestamptz, last_login_at timestamptz,
      admin_granted_by text
    )
    ON CONFLICT (firebase_uid) DO UPDATE SET
      email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      role = EXCLUDED.role,
      admin_granted_by = CASE
        WHEN EXCLUDED.admin_granted_by = 'system-root' THEN 'system-root'
        WHEN EXCLUDED.role = 'admin' THEN COALESCE(
          synclife_accounts.admin_granted_by,
          EXCLUDED.admin_granted_by
        )
        ELSE NULL
      END,
      providers = EXCLUDED.providers,
      disabled = EXCLUDED.disabled,
      registered_at = LEAST(synclife_accounts.registered_at, EXCLUDED.registered_at),
      last_login_at = GREATEST(synclife_accounts.last_login_at, EXCLUDED.last_login_at),
      updated_at = NOW()
  `, [JSON.stringify(rows.map((row) => ({
    firebase_uid: row.uid,
    email: row.email,
    display_name: row.name,
    role: row.role,
    providers: row.providers,
    disabled: row.disabled,
    registered_at: row.registeredAt,
    last_login_at: row.lastLoginAt,
    admin_granted_by: row.adminGrantedBy,
  })))]);
}

async function setAccountRole(uid, role, grantedBy = null) {
  const database = await getPool();
  const result = await database.query(`
    UPDATE synclife_accounts
    SET role = $2, admin_granted_by = $3, updated_at = NOW()
    WHERE firebase_uid = $1
  `, [uid, role, role === 'admin' ? grantedBy : null]);
  if (!result.rowCount) {
    const error = new Error('La cuenta no está sincronizada en PostgreSQL.');
    error.statusCode = 404;
    throw error;
  }
}

async function isAccountAdmin(uid) {
  const database = await getPool();
  const result = await database.query(`
    SELECT role = 'admin' AS admin FROM synclife_accounts WHERE firebase_uid = $1
  `, [uid]);
  return result.rows[0]?.admin === true;
}

async function recordAdminActivity({ uid, type, recordId, score }) {
  const database = await getPool();
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(`
      INSERT INTO synclife_activity_events (firebase_uid, event_type, record_id, score, event_date)
      VALUES ($1, $2, $3, $4, CASE WHEN $2 = 'daily-record' THEN $3::date ELSE NULL END)
      ON CONFLICT (firebase_uid, event_type, record_id) DO NOTHING
      RETURNING id
    `, [uid, type, recordId, type === 'daily-record' ? score : null]);
    if (inserted.rowCount) {
      await client.query('COMMIT');
      return { recorded: true, updated: false };
    }

    if (type === 'daily-record') {
      await client.query(`
        UPDATE synclife_activity_events
        SET score = $4, created_at = NOW()
        WHERE firebase_uid = $1 AND event_type = $2 AND record_id = $3
      `, [uid, type, recordId, score]);
      await client.query('COMMIT');
      return { recorded: false, updated: true };
    }

    await client.query('COMMIT');
    return { recorded: false, updated: false };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function getAdminMetrics() {
  const database = await getPool();
  const now = new Date();
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const previousWeekStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const utcDayStart = new Date(now);
  utcDayStart.setUTCHours(0, 0, 0, 0);
  const sevenDaysAgo = new Date(utcDayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
  const todayDate = utcDayStart.toISOString().slice(0, 10);
  const previousWeekDate = new Date(utcDayStart.getTime() - 7 * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const [accounts, activity, dailyRecords, admins] = await Promise.all([
    database.query(`
      SELECT
        COUNT(*)::int AS total_users,
        COUNT(*) FILTER (WHERE role = 'user')::int AS user_count,
        COUNT(*) FILTER (WHERE role = 'admin')::int AS admin_count,
        COUNT(*) FILTER (WHERE disabled = FALSE AND last_login_at >= $1)::int AS active_today,
        COUNT(*) FILTER (WHERE registered_at >= $2)::int AS users_this_week,
        COUNT(*) FILTER (WHERE registered_at >= $3 AND registered_at < $2)::int AS users_previous_week
      FROM synclife_accounts
    `, [utcDayStart, weekStart, previousWeekStart]),
    database.query(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'meal')::int AS total_meals,
        COUNT(*) FILTER (WHERE event_type = 'routine')::int AS total_routines,
        COUNT(*) FILTER (WHERE event_type = 'exercise')::int AS total_exercises
      FROM synclife_activity_events
    `),
    database.query(`
      SELECT
        COUNT(*)::int AS total_records,
        COUNT(*) FILTER (WHERE created_at >= $1)::int AS records_this_week,
        COUNT(*) FILTER (WHERE created_at >= $2 AND created_at < $1)::int AS records_previous_week,
        COUNT(*) FILTER (WHERE event_date = $3::date)::int AS records_today,
        COUNT(*) FILTER (WHERE event_date = $4::date)::int AS records_same_day_previous_week,
        COUNT(score) FILTER (WHERE created_at >= $1)::int AS scored_records_this_week,
        COUNT(score) FILTER (WHERE created_at >= $2 AND created_at < $1)::int AS scored_records_previous_week,
        AVG(score) FILTER (WHERE created_at >= $1)::numeric AS average_score,
        AVG(score) FILTER (WHERE created_at >= $2 AND created_at < $1)::numeric AS previous_average_score
      FROM synclife_activity_events
      WHERE event_type = 'daily-record'
    `, [weekStart, previousWeekStart, todayDate, previousWeekDate]),
    database.query(`
      SELECT firebase_uid AS uid, display_name AS name, email, registered_at AS "createdAt",
        disabled, providers, role = 'admin' AS admin
      FROM synclife_accounts
      WHERE role = 'admin'
      ORDER BY registered_at ASC, firebase_uid ASC
    `),
  ]);
  const [dailyCounts, accountCounts, activityCounts, recordCounts] = await Promise.all([
    database.query(`
      SELECT event_date::text AS date, COUNT(*)::int AS count
      FROM synclife_activity_events
      WHERE event_type = 'daily-record' AND event_date >= $1::date AND event_date <= $2::date
      GROUP BY event_date
    `, [sevenDaysAgo.toISOString().slice(0, 10), todayDate]),
    Promise.resolve(accounts.rows[0]),
    Promise.resolve(activity.rows[0]),
    Promise.resolve(dailyRecords.rows[0]),
  ]);
  const countsByDate = new Map(dailyCounts.rows.map((row) => [row.date, row.count]));
  const recordsLast7Days = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(sevenDaysAgo.getTime() + offset * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    return { date, count: countsByDate.get(date) || 0 };
  });
  const roundedAverage = (value) => value == null ? null : Math.round(Number(value) * 10) / 10;

  return {
    totalUsers: accountCounts.total_users,
    admins: admins.rows.map((admin) => ({
      ...admin,
      createdAt: admin.createdAt ? new Date(admin.createdAt).toISOString() : null,
    })),
    usersThisWeek: accountCounts.users_this_week,
    usersPreviousWeek: accountCounts.users_previous_week,
    activeToday: accountCounts.active_today,
    totalMeals: activityCounts.total_meals,
    totalRoutines: activityCounts.total_routines,
    totalExercises: activityCounts.total_exercises,
    totalRecords: recordCounts.total_records,
    recordsThisWeek: recordCounts.records_this_week,
    recordsPreviousWeek: recordCounts.records_previous_week,
    recordsToday: recordCounts.records_today,
    recordsSameDayPreviousWeek: recordCounts.records_same_day_previous_week,
    scoredRecordsThisWeek: recordCounts.scored_records_this_week,
    scoredRecordsPreviousWeek: recordCounts.scored_records_previous_week,
    averageScore: roundedAverage(recordCounts.average_score),
    previousAverageScore: roundedAverage(recordCounts.previous_average_score),
    recordsLast7Days,
    database: 'PostgreSQL',
    updatedAt: now.toISOString(),
  };
}

async function listAccounts(limit, offset) {
  const database = await getPool();
  const result = await database.query(`
    SELECT firebase_uid AS uid, email, display_name AS name, role = 'admin' AS admin,
      providers, disabled, registered_at AS "createdAt"
    FROM synclife_accounts
    ORDER BY registered_at DESC, firebase_uid DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  const count = await database.query('SELECT COUNT(*)::int AS total FROM synclife_accounts');
  return { users: result.rows, total: count.rows[0].total };
}

async function listDailyRecords(limit, offset) {
  const database = await getPool();
  const result = await database.query(`
    SELECT events.id::text AS id, events.firebase_uid AS uid,
      accounts.display_name AS name, accounts.email,
      events.event_date::text AS date, events.score,
      events.created_at AS "createdAt"
    FROM synclife_activity_events AS events
    JOIN synclife_accounts AS accounts USING (firebase_uid)
    WHERE events.event_type = 'daily-record'
    ORDER BY events.created_at DESC, events.id DESC
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  const count = await database.query(`
    SELECT COUNT(*)::int AS total FROM synclife_activity_events WHERE event_type = 'daily-record'
  `);
  return {
    records: result.rows.map((record) => ({
      ...record,
      createdAt: record.createdAt ? new Date(record.createdAt).toISOString() : null,
    })),
    total: count.rows[0].total,
  };
}

async function deleteAccountRecord(uid) {
  const database = await getPool();
  await database.query('DELETE FROM synclife_accounts WHERE firebase_uid = $1', [uid]);
}

function isPostgresConfigured() {
  return Boolean(pool);
}

module.exports = {
  deleteAccountRecord,
  getAdminMetrics,
  isPostgresConfigured,
  listAccounts,
  listDailyRecords,
  isAccountAdmin,
  recordAdminActivity,
  setAccountRole,
  syncAccount,
  syncAccounts,
};
