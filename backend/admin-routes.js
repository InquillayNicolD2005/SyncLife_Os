const express = require('express');
const { getAdminServices } = require('./firebase-admin');
const { obtenerClima, getProviderUsage } = require('./synclife');

const router = express.Router();
const PAGE_SIZE = 100;
const ADMIN_ACTIVITY_COLLECTION = 'adminActivity';
const validActivityTypes = new Set(['meal', 'routine']);

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
  };
}

router.post('/activity', authenticate, async (req, res) => {
  const { type, recordId } = req.body || {};
  if (!validActivityTypes.has(type) || typeof recordId !== 'string'
    || !/^[A-Za-z0-9_-]{1,80}$/.test(recordId)) {
    return res.status(400).json({ error: 'El tipo o identificador de actividad no es válido.' });
  }

  try {
    const { firestore, fieldValue } = getAdminServices();
    const summaryRef = firestore.collection(ADMIN_ACTIVITY_COLLECTION).doc(req.authUser.uid);
    const eventRef = summaryRef.collection('events').doc(`${type}_${recordId}`);
    const result = await firestore.runTransaction(async (transaction) => {
      const event = await transaction.get(eventRef);
      if (event.exists) return { recorded: false };
      const countField = type === 'meal' ? 'meals' : 'routines';
      transaction.create(eventRef, { type, createdAt: fieldValue.serverTimestamp() });
      transaction.set(summaryRef, {
        [countField]: fieldValue.increment(1),
        updatedAt: fieldValue.serverTimestamp(),
      }, { merge: true });
      return { recorded: true };
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
    const [users, activitySnapshot] = await Promise.all([
      listAllUsers(auth),
      firestore.collection(ADMIN_ACTIVITY_COLLECTION).get(),
    ]);
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const utcDayStart = new Date();
    utcDayStart.setUTCHours(0, 0, 0, 0);
    let meals = 0;
    let routines = 0;

    activitySnapshot.forEach((document) => {
      const counts = document.data();
      meals += Number.isSafeInteger(counts.meals) && counts.meals > 0 ? counts.meals : 0;
      routines += Number.isSafeInteger(counts.routines) && counts.routines > 0 ? counts.routines : 0;
    });

    return res.json({
      totalUsers: users.length,
      newUsersThisWeek: users.filter((user) => {
        const createdAt = Date.parse(user.metadata.creationTime);
        return Number.isFinite(createdAt) && createdAt >= weekAgo;
      }).length,
      activeToday: users.filter((user) => {
        const lastSignIn = Date.parse(user.metadata.lastSignInTime || '');
        return !user.disabled && Number.isFinite(lastSignIn) && lastSignIn >= utcDayStart.getTime();
      }).length,
      totalMeals: meals,
      totalRoutines: routines,
    });
  } catch (error) {
    return sendAdminError(res, error, 'No se pudieron cargar las métricas administrativas.');
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
    try {
      await firestore.recursiveDelete(firestore.collection(ADMIN_ACTIVITY_COLLECTION).doc(uid));
    } catch (cleanupError) {
      console.error('La cuenta se eliminó, pero no se pudieron borrar sus contadores agregados:', cleanupError);
      return res.json({
        deleted: true,
        warning: 'La cuenta se eliminó, pero no se pudieron borrar sus contadores agregados.',
      });
    }
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
