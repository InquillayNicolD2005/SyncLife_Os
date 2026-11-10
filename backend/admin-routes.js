const express = require('express');
const { getAdminServices } = require('./firebase-admin');
const { obtenerClima, getProviderUsage } = require('./synclife');
const { deleteAccountRecord } = require('./postgres');

const router = express.Router();
const PAGE_SIZE = 100;
const ADMIN_ACTIVITY_COLLECTION = 'adminActivity';
const ADMIN_RECORDS_COLLECTION = 'adminRecords';
const validActivityTypes = new Set(['meal', 'routine', 'daily-record']);

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

function requireAdmin(req, res, next) {
  if (req.authToken?.admin !== true) {
    return res.status(403).json({ error: 'Se requiere el rol de administrador.' });
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
    name: user.displayName || 'Sin nombre',
    email: user.email || '',
    createdAt: user.metadata.creationTime || null,
    disabled: Boolean(user.disabled),
    admin: user.customClaims?.admin === true,
    providers: user.providerData.map((provider) => provider.providerId),
  };
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
    const { firestore, fieldValue } = getAdminServices();
    const summaryRef = firestore.collection(ADMIN_ACTIVITY_COLLECTION).doc(req.authUser.uid);
    const eventRef = summaryRef.collection('events').doc(`${type}_${recordId}`);
    const dailyRecordRef = type === 'daily-record'
      ? firestore.collection(ADMIN_RECORDS_COLLECTION).doc(`${req.authUser.uid}_${recordId}`)
      : null;
    const result = await firestore.runTransaction(async (transaction) => {
      const event = await transaction.get(eventRef);
      if (event.exists) {
        if (dailyRecordRef) {
          const recordData = {
            score,
            date: recordId,
            uid: req.authUser.uid,
            name: req.authUser.displayName || '',
            email: req.authUser.email || '',
            createdAt: fieldValue.serverTimestamp(),
          };
          transaction.set(eventRef, { score, createdAt: fieldValue.serverTimestamp() }, { merge: true });
          transaction.set(dailyRecordRef, recordData, { merge: true });
          return { recorded: false, updated: true };
        }
        return { recorded: false, updated: false };
      }

      const countField = type === 'meal' ? 'meals' : type === 'routine' ? 'routines' : 'records';
      const eventData = { type, createdAt: fieldValue.serverTimestamp() };
      if (type === 'daily-record') eventData.score = score;
      transaction.create(eventRef, eventData);
      transaction.set(summaryRef, {
        [countField]: fieldValue.increment(1),
        updatedAt: fieldValue.serverTimestamp(),
      }, { merge: true });

      if (dailyRecordRef) {
        transaction.create(dailyRecordRef, {
          score,
          date: recordId,
          uid: req.authUser.uid,
          name: req.authUser.displayName || '',
          email: req.authUser.email || '',
          createdAt: fieldValue.serverTimestamp(),
        });
      }
      return { recorded: true, updated: false };
    });
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
    const [users, activitySnapshot] = await Promise.all([
      listAllUsers(auth),
      firestore.collection(ADMIN_ACTIVITY_COLLECTION).get(),
    ]);
    const [totalRecordCount, recentRecordsSnapshot] = await Promise.all([
      recordsRef.count().get(),
      recordsRef.where('createdAt', '>=', previousWeekStart).get(),
    ]);
    let meals = 0;
    let routines = 0;

    activitySnapshot.forEach((document) => {
      const counts = document.data();
      meals += Number.isSafeInteger(counts.meals) && counts.meals > 0 ? counts.meals : 0;
      routines += Number.isSafeInteger(counts.routines) && counts.routines > 0 ? counts.routines : 0;
    });

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
      return scores.length
        ? Math.round((scores.reduce((total, score) => total + score, 0) / scores.length) * 10) / 10
        : null;
    };
    const todayDate = utcDayStart.toISOString().slice(0, 10);
    const previousWeekDate = new Date(utcDayStart.getTime() - 7 * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    const dayCounts = new Map();
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(sevenDaysAgo.getTime() + offset * 24 * 60 * 60 * 1000)
        .toISOString().slice(0, 10);
      dayCounts.set(date, { date, count: 0 });
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
      totalUsers: users.length,
      admins: users.filter((user) => user.customClaims?.admin === true).map(toSafeUser),
      usersThisWeek: users.filter((user) => Date.parse(user.metadata.creationTime || '') >= weekStart.getTime()).length,
      usersPreviousWeek: users.filter((user) => {
        const createdAt = Date.parse(user.metadata.creationTime || '');
        return createdAt >= previousWeekStart.getTime() && createdAt < weekStart.getTime();
      }).length,
      activeToday: users.filter((user) => {
        const lastSignIn = Date.parse(user.metadata.lastSignInTime || '');
        return !user.disabled && Number.isFinite(lastSignIn) && lastSignIn >= utcDayStart.getTime();
      }).length,
      totalMeals: meals,
      totalRoutines: routines,
      totalRecords: totalRecordCount.data().count,
      recordsThisWeek: currentWeekRecords.length,
      recordsPreviousWeek: previousWeekRecords.length,
      recordsToday: recentRecords.filter((record) => record.date === todayDate).length,
      recordsSameDayPreviousWeek: recentRecords.filter((record) => record.date === previousWeekDate).length,
      averageScore: averageScore(currentWeekRecords),
      previousAverageScore: averageScore(previousWeekRecords),
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
    const pageSize = 100;
    const recordsRef = firestore.collection(ADMIN_RECORDS_COLLECTION);
    let query = recordsRef.orderBy('createdAt', 'desc').limit(pageSize);
    if (typeof req.query.pageToken === 'string' && req.query.pageToken) {
      const cursor = await recordsRef.doc(req.query.pageToken).get();
      if (!cursor.exists) return res.status(400).json({ error: 'No se encontró el punto desde donde continuar.' });
      query = recordsRef.orderBy('createdAt', 'desc').startAfter(cursor).limit(pageSize);
    }
    const page = await query.get();
    return res.json({
      records: page.docs.map((document) => {
        const record = document.data();
        return {
          id: document.id,
          name: record.name || 'Sin nombre',
          email: record.email || '',
          date: record.date || '',
          score: Number.isInteger(record.score) ? record.score : null,
          createdAt: record.createdAt?.toDate?.().toISOString() || null,
        };
      }),
      nextPageToken: page.docs.length === pageSize ? page.docs[page.docs.length - 1].id : null,
    });
  } catch (error) {
    return sendAdminError(res, error, 'No se pudieron cargar los registros diarios.');
  }
});

router.get('/users', async (req, res) => {
  try {
    const { auth } = getAdminServices();
    const page = await auth.listUsers(PAGE_SIZE, typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined);
    return res.json({
      users: page.users.map(toSafeUser),
      nextPageToken: page.pageToken || null,
    });
  } catch (error) {
    return sendAdminError(res, error, 'No se pudieron cargar las cuentas de usuario.');
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
    if (target.customClaims?.admin === true) {
      return res.status(409).json({ error: 'No se pueden bloquear ni desbloquear cuentas de administrador desde este panel.' });
    }
    const updatedUser = await auth.updateUser(uid, { disabled });
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
    if (target.customClaims?.admin === true) {
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
