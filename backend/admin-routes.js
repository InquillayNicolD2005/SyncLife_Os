const express = require('express');
const { getAdminServices } = require('./firebase-admin');
const { obtenerClima, getProviderUsage } = require('./synclife');
const { isRootAccount, ROOT_ADMIN_EMAIL } = require('./admin-identity');
const {
  deleteAccountRecord,
  getAdminMetrics,
  isAccountAdmin,
  listAccounts,
  listDailyRecords,
  recordAdminActivity,
  syncAccount,
  syncAccounts,
  setAccountRole,
} = require('./postgres');

const router = express.Router();
const PAGE_SIZE = 100;
const ADMIN_ACTIVITY_COLLECTION = 'adminActivity';
const ADMIN_RECORDS_COLLECTION = 'adminRecords';
const validActivityTypes = new Set(['meal', 'routine', 'exercise', 'daily-record']);
let firebaseAccountSync;

function sendAdminError(res, error, fallbackMessage) {
  console.error(fallbackMessage, error);
  if (error.code === 'auth/id-token-expired' || error.code === 'auth/invalid-id-token'
    || error.code === 'auth/argument-error' || error.code === 'auth/id-token-revoked') {
    return res.status(401).json({ error: 'La sesión expiró. Inicia sesión de nuevo.' });
  }
  if (error.code === 'auth/user-disabled' || error.code === 'auth/user-not-found') {
    return res.status(403).json({ error: 'La cuenta ya no puede acceder al panel.' });
  }
  if (error.statusCode) return res.status(error.statusCode).json({ error: error.message });
  return res.status(503).json({ error: fallbackMessage });
}

async function authenticate(req, res, next) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Se requiere una sesión autenticada.' });

  try {
    const { auth } = getAdminServices();
    const decodedToken = await auth.verifyIdToken(match[1], true);
    const user = await auth.getUser(decodedToken.uid);
    if (user.disabled) return res.status(403).json({ error: 'Esta cuenta está deshabilitada.' });
    req.authUser = user;
    req.authToken = decodedToken;
    return next();
  } catch (error) {
    return sendAdminError(res, error, 'No se pudo validar la sesión. Configura Firebase Admin en el backend.');
  }
}

async function requireAdmin(req, res, next) {
  if (req.authToken?.admin !== true || req.authUser.customClaims?.admin !== true) {
    return res.status(403).json({ error: 'Se requiere el rol de administrador.' });
  }
  try {
    if (!await isAccountAdmin(req.authUser.uid)) {
      return res.status(403).json({ error: 'Esta cuenta no tiene acceso administrativo autorizado.' });
    }
    return next();
  } catch (error) {
    return sendAdminError(res, error, 'No se pudo validar el rol en PostgreSQL.');
  }
}

function requireRootAdmin(req, res, next) {
  if (!isRootAccount(req.authUser) || req.authToken?.superAdmin !== true
    || req.authUser.customClaims?.superAdmin !== true) {
    return res.status(403).json({ error: 'Solo la cuenta propietaria puede gestionar administradores.' });
  }
  return next();
}

async function listAllUsers(auth) {
  const users = [];
  let pageToken;
  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

function toSafeUser(user) {
  return {
    uid: user.uid,
    name: user.name || user.displayName || 'Sin nombre',
    email: user.email || '',
    createdAt: user.createdAt || user.metadata?.creationTime || null,
    disabled: Boolean(user.disabled),
    admin: user.admin === true || user.customClaims?.admin === true,
    superAdmin: isRootAccount(user),
    providers: user.providers || user.providerData?.map((provider) => provider.providerId) || [],
  };
}

async function ensureFirebaseAccountsSynced(auth) {
  if (!firebaseAccountSync) {
    firebaseAccountSync = listAllUsers(auth)
      .then((users) => syncAccounts(users))
      .catch((error) => {
        firebaseAccountSync = null;
        throw error;
      });
  }
  await firebaseAccountSync;
}

router.post('/activity', authenticate, async (req, res) => {
  const { type, recordId, score } = req.body || {};
  if (!validActivityTypes.has(type) || typeof recordId !== 'string'
    || !/^[A-Za-z0-9_-]{1,80}$/.test(recordId)) {
    return res.status(400).json({ error: 'El tipo o identificador de actividad no es válido.' });
  }
  if (type === 'daily-record'
    && (!/^\d{4}-\d{2}-\d{2}$/.test(recordId) || !Number.isInteger(score) || score < 0 || score > 100)) {
    return res.status(400).json({ error: 'El registro diario debe incluir una fecha y un puntaje válidos.' });
  }

  try {
    await syncAccount(req.authUser);
    const result = await recordAdminActivity({ uid: req.authUser.uid, type, recordId, score });
    return res.status(200).json(result);
  } catch (error) {
    return sendAdminError(res, error, 'No se pudo registrar la actividad agregada.');
  }
});

router.use(authenticate, requireAdmin);

router.get('/metrics', async (req, res) => {
  try {
    const { auth, firestore } = getAdminServices();
    const now = new Date();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const previousWeekStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const utcDayStart = new Date(now);
    utcDayStart.setUTCHours(0, 0, 0, 0);
    const sevenDaysAgo = new Date(utcDayStart.getTime() - 6 * 24 * 60 * 60 * 1000);
    const recordsRef = firestore.collection(ADMIN_RECORDS_COLLECTION);
    await ensureFirebaseAccountsSynced(auth);
    const [totalRecordCount, recentRecordsSnapshot] = await Promise.all([
      recordsRef.count().get(),
      recordsRef.where('createdAt', '>=', previousWeekStart).get(),
    ]);
    const metrics = await getAdminMetrics();

    const timestampOf = (record) => {
      if (record.createdAt && typeof record.createdAt.toDate === 'function') {
        return record.createdAt.toDate().getTime();
      }
      return Date.parse(record.createdAt || '');
    };
    const recentRecords = recentRecordsSnapshot.docs.map((document) => document.data());
    const currentWeekRecords = recentRecords.filter((record) => timestampOf(record) >= weekStart.getTime());
    const previousWeekRecords = recentRecords.filter((record) => {
      const time = timestampOf(record);
      return time >= previousWeekStart.getTime() && time < weekStart.getTime();
    });
    const averageScore = (records) => {
      const scores = records.map((record) => record.score)
        .filter((score) => Number.isInteger(score) && score >= 0 && score <= 100);
      return {
        count: scores.length,
        average: scores.length
          ? Math.round((scores.reduce((total, score) => total + score, 0) / scores.length) * 10) / 10
          : null,
      };
    };
    const currentWeekLegacyAverage = averageScore(currentWeekRecords);
    const previousWeekLegacyAverage = averageScore(previousWeekRecords);
    const combineAverages = (databaseAverage, databaseCount, legacy) => {
      const count = databaseCount + legacy.count;
      if (!count) return null;
      return Math.round(((Number(databaseAverage || 0) * databaseCount
        + Number(legacy.average || 0) * legacy.count) / count) * 10) / 10;
    };
    const todayDate = utcDayStart.toISOString().slice(0, 10);
    const previousWeekDate = new Date(utcDayStart.getTime() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const dayCounts = new Map();
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(sevenDaysAgo.getTime() + offset * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      dayCounts.set(date, {
        date,
        count: metrics.recordsLast7Days.find((day) => day.date === date)?.count || 0,
      });
    }
    recentRecords.forEach((record) => {
      const time = timestampOf(record);
      if (Number.isFinite(time)) {
        const date = new Date(time).toISOString().slice(0, 10);
        const daily = dayCounts.get(date);
        if (daily) daily.count += 1;
      }
    });

    return res.json({
      ...metrics,
      admins: metrics.admins.map(toSafeUser),
      totalRecords: metrics.totalRecords + totalRecordCount.data().count,
      recordsThisWeek: metrics.recordsThisWeek + currentWeekRecords.length,
      recordsPreviousWeek: metrics.recordsPreviousWeek + previousWeekRecords.length,
      recordsToday: metrics.recordsToday + recentRecords.filter((record) => record.date === todayDate).length,
      recordsSameDayPreviousWeek: metrics.recordsSameDayPreviousWeek
        + recentRecords.filter((record) => record.date === previousWeekDate).length,
      averageScore: combineAverages(metrics.averageScore, metrics.scoredRecordsThisWeek, currentWeekLegacyAverage),
      previousAverageScore: combineAverages(metrics.previousAverageScore, metrics.scoredRecordsPreviousWeek, previousWeekLegacyAverage),
      recordsLast7Days: [...dayCounts.values()],
      updatedAt: now.toISOString(),
    });
  } catch (error) {
    return sendAdminError(res, error, 'No se pudieron cargar las métricas administrativas.');
  }
});

router.get('/records', async (req, res) => {
  try {
    const { firestore } = getAdminServices();
    const pageSize = PAGE_SIZE;
    const pageOffset = req.query.pageToken === undefined ? 0 : Number(req.query.pageToken);
    if (!Number.isSafeInteger(pageOffset) || pageOffset < 0 || pageOffset > 10000
      || !/^\d+$/.test(String(req.query.pageToken ?? '0'))) {
      return res.status(400).json({ error: 'El número de página no es válido.' });
    }
    const querySize = pageOffset + pageSize + 1;
    const recordsRef = firestore.collection(ADMIN_RECORDS_COLLECTION);
    const [databasePage, legacyCount, legacyPage] = await Promise.all([
      listDailyRecords(querySize, 0),
      recordsRef.count().get(),
      recordsRef.orderBy('createdAt', 'desc').limit(querySize).get(),
    ]);
    const legacyRecords = legacyPage.docs.map((document) => {
      const record = document.data();
      return {
        id: document.id,
        uid: record.uid || '',
        name: record.name || 'Sin nombre',
        email: record.email || '',
        date: record.date || '',
        score: Number.isInteger(record.score) ? record.score : null,
        createdAt: record.createdAt?.toDate?.().toISOString() || null,
      };
    });
    const records = [
      ...databasePage.records.map((record) => ({ ...record, id: `pg-${record.id}` })),
      ...legacyRecords,
    ].sort((first, second) => {
      const firstTime = Date.parse(first.createdAt || '');
      const secondTime = Date.parse(second.createdAt || '');
      return (Number.isFinite(secondTime) ? secondTime : 0) - (Number.isFinite(firstTime) ? firstTime : 0)
        || first.id.localeCompare(second.id);
    });
    const total = databasePage.total + legacyCount.data().count;
    return res.json({
      records: records.slice(pageOffset, pageOffset + pageSize),
      nextPageToken: pageOffset + pageSize < total ? String(pageOffset + pageSize) : null,
    });
  } catch (error) {
    return sendAdminError(res, error, 'No se pudieron cargar los registros diarios.');
  }
});

router.get('/users', async (req, res) => {
  try {
    const { auth } = getAdminServices();
    const pageOffset = Number.parseInt(req.query.pageToken || '0', 10);
    if (!Number.isSafeInteger(pageOffset) || pageOffset < 0) {
      return res.status(400).json({ error: 'El número de página no es válido.' });
    }
    if (pageOffset === 0) await ensureFirebaseAccountsSynced(auth);
    const page = await listAccounts(PAGE_SIZE, pageOffset);
    const users = page.users.map(toSafeUser);
    return res.json({
      users,
      nextPageToken: pageOffset + users.length < page.total ? String(pageOffset + users.length) : null,
    });
  } catch (error) {
    return sendAdminError(res, error, 'No se pudieron cargar las cuentas de usuario.');
  }
});

router.post('/admins', requireRootAdmin, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Ingresa un correo válido de una cuenta ya registrada.' });
  }
  if (email === ROOT_ADMIN_EMAIL) {
    return res.status(409).json({ error: 'La cuenta propietaria ya tiene el rol principal.' });
  }

  try {
    const { auth } = getAdminServices();
    const target = await auth.getUserByEmail(email);
    await syncAccount(target);
    if (await isAccountAdmin(target.uid)) {
      return res.status(409).json({ error: 'Esta cuenta ya tiene acceso de administrador.' });
    }
    await auth.setCustomUserClaims(target.uid, { ...target.customClaims, admin: true });
    const updatedUser = await auth.getUser(target.uid);
    await setAccountRole(target.uid, 'admin', req.authUser.uid);
    let warning = null;
    try {
      await auth.revokeRefreshTokens(target.uid);
    } catch (error) {
      console.error('Se asignó el rol, pero no se pudieron revocar las sesiones anteriores:', error);
      warning = 'El rol se asignó, pero la persona deberá cerrar e iniciar sesión para que se actualice.';
    }
    return res.json({ user: toSafeUser(updatedUser), warning });
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return res.status(404).json({ error: 'No existe una cuenta registrada con ese correo.' });
    }
    return sendAdminError(res, error, 'No se pudo asignar el rol de administrador.');
  }
});

router.delete('/admins/:uid', requireRootAdmin, async (req, res) => {
  const { uid } = req.params;
  if (!uid || uid === req.authUser.uid) {
    return res.status(400).json({ error: 'No puedes retirar el rol de tu propia cuenta propietaria.' });
  }
  try {
    const { auth } = getAdminServices();
    const target = await auth.getUser(uid);
    if (isRootAccount(target)) {
      return res.status(409).json({ error: 'No se puede retirar el rol de la cuenta propietaria.' });
    }
    if (!await isAccountAdmin(uid)) {
      return res.status(409).json({ error: 'La cuenta indicada no es administradora.' });
    }
    await setAccountRole(uid, 'user');
    const claims = { ...target.customClaims };
    delete claims.admin;
    delete claims.superAdmin;
    await auth.setCustomUserClaims(uid, claims);
    const updatedUser = await auth.getUser(uid);
    await syncAccount(updatedUser);
    let warning = null;
    try {
      await auth.revokeRefreshTokens(uid);
    } catch (error) {
      console.error('Se retiró el rol, pero no se pudieron revocar inmediatamente las sesiones:', error);
      warning = 'El rol se retiró, pero no se pudieron revocar inmediatamente las sesiones anteriores.';
    }
    return res.json({ user: toSafeUser(updatedUser), warning });
  } catch (error) {
    return sendAdminError(res, error, 'No se pudo retirar el rol de administrador.');
  }
});

router.patch('/users/:uid/status', async (req, res) => {
  const { uid } = req.params;
  const { disabled } = req.body || {};
  if (!uid || typeof disabled !== 'boolean') {
    return res.status(400).json({ error: 'Indica si la cuenta debe quedar bloqueada.' });
  }
  if (uid === req.authUser.uid) {
    return res.status(400).json({ error: 'No puedes bloquear tu propia cuenta de administrador.' });
  }

  try {
    const { auth } = getAdminServices();
    const target = await auth.getUser(uid);
    if (await isAccountAdmin(uid) || isRootAccount(target)) {
      return res.status(409).json({ error: 'No se pueden bloquear ni desbloquear cuentas de administrador desde este panel.' });
    }
    const updatedUser = await auth.updateUser(uid, { disabled });
    await syncAccount(updatedUser);
    if (disabled) {
      try {
        await auth.revokeRefreshTokens(uid);
      } catch (revokeError) {
        console.error('La cuenta se deshabilitó, pero no se pudieron revocar de inmediato sus tokens:', revokeError);
        return res.json({
          user: toSafeUser(updatedUser),
          warning: 'La cuenta se deshabilitó, pero no se pudieron revocar de inmediato sus tokens.',
        });
      }
    }
    return res.json({ user: toSafeUser(updatedUser) });
  } catch (error) {
    return sendAdminError(res, error, 'No se pudo actualizar el estado de la cuenta.');
  }
});

router.delete('/users/:uid', async (req, res) => {
  const { uid } = req.params;
  if (!uid) return res.status(400).json({ error: 'La cuenta indicada no es válida.' });
  if (uid === req.authUser.uid) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta de administrador.' });
  }

  try {
    const { auth, firestore } = getAdminServices();
    const target = await auth.getUser(uid);
    if (await isAccountAdmin(uid) || isRootAccount(target)) {
      return res.status(409).json({ error: 'No se pueden eliminar cuentas de administrador desde este panel.' });
    }
    await auth.deleteUser(uid);
    const cleanupWarnings = [];
    try {
      await deleteAccountRecord(uid);
    } catch (cleanupError) {
      console.error('La cuenta se eliminó de Firebase, pero no de PostgreSQL:', cleanupError);
      cleanupWarnings.push('No se pudo borrar el registro de la base de datos PostgreSQL.');
    }
    try {
      await firestore.recursiveDelete(firestore.collection(ADMIN_ACTIVITY_COLLECTION).doc(uid));
    } catch (cleanupError) {
      console.error('La cuenta se eliminó, pero no se pudieron borrar sus contadores agregados:', cleanupError);
      cleanupWarnings.push('No se pudieron borrar sus contadores agregados.');
    }
    try {
      const usernameProfileRef = firestore.collection('usernamesByUid').doc(uid);
      const usernameProfile = await usernameProfileRef.get();
      const username = usernameProfile.exists ? usernameProfile.get('username') : null;
      if (typeof username === 'string') {
        const usernameRef = firestore.collection('usernames').doc(username.toLowerCase());
        await firestore.runTransaction(async (transaction) => {
          const reservation = await transaction.get(usernameRef);
          if (reservation.exists && reservation.get('uid') === uid) transaction.delete(usernameRef);
          transaction.delete(usernameProfileRef);
        });
      } else if (usernameProfile.exists) {
        await usernameProfileRef.delete();
      }
    } catch (cleanupError) {
      console.error('La cuenta se eliminó, pero no se pudo liberar su nombre de usuario:', cleanupError);
      cleanupWarnings.push('No se pudo liberar su nombre de usuario.');
    }
    try {
      const recordSnapshot = await firestore.collection(ADMIN_RECORDS_COLLECTION)
        .where('uid', '==', uid)
        .get();
      for (let offset = 0; offset < recordSnapshot.docs.length; offset += 500) {
        const batch = firestore.batch();
        recordSnapshot.docs.slice(offset, offset + 500).forEach((document) => batch.delete(document.ref));
        await batch.commit();
      }
    } catch (cleanupError) {
      console.error('La cuenta se eliminó, pero no se pudieron borrar sus registros diarios:', cleanupError);
      cleanupWarnings.push('No se pudieron borrar los registros diarios asociados.');
    }
    if (cleanupWarnings.length) return res.json({ deleted: true, warning: cleanupWarnings.join(' ') });
    return res.status(204).end();
  } catch (error) {
    return sendAdminError(res, error, 'No se pudo eliminar la cuenta.');
  }
});

router.get('/apis', async (req, res) => {
  const youtubeUrl = 'https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DUItWltVZZmE&format=json';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7000);
  const youtubeCheck = fetch(youtubeUrl, { signal: controller.signal })
    .then((response) => ({ available: response.ok, status: response.status }))
    .catch((error) => ({ available: false, error: error.name === 'AbortError' ? 'Tiempo de espera agotado' : 'No se pudo conectar' }))
    .finally(() => clearTimeout(timeout));

  try {
    const [youtube, weather] = await Promise.all([youtubeCheck, obtenerClima('Cusco')]);
    return res.json({
      youtube: {
        status: youtube.available ? 'online' : 'error',
        check: 'oEmbed',
        dataApiQuotaEstimate: 0,
        detail: 'Los videos se reproducen con iframe; la app no consume cuota de YouTube Data API.',
        error: youtube.error || null,
      },
      weather: {
        status: weather.temp != null && !weather.stale ? 'online' : 'error',
        source: weather.source || 'sin conexión',
        stale: Boolean(weather.stale),
        requestsSinceStart: getProviderUsage(),
        detail: 'Conteo aproximado de solicitudes a proveedores del clima desde el inicio del backend.',
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return sendAdminError(res, error, 'No se pudo comprobar el estado de las APIs.');
  }
});

module.exports = router;
