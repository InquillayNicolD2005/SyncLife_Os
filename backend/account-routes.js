const express = require('express');
const { getAdminServices } = require('./firebase-admin');
const { syncAccount } = require('./postgres');
const { isRootAccount } = require('./admin-identity');

const router = express.Router();
const usernameLoginAttempts = new Map();
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]{3,24}$/;
const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'support', 'ayuda', 'root', 'synclife']);

async function getAuthenticatedUser(req) {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    const error = new Error('Se requiere una sesión autenticada.');
    error.status = 401;
    throw error;
  }

  const { auth } = getAdminServices();
  const decodedToken = await auth.verifyIdToken(match[1], true);
  const user = await auth.getUser(decodedToken.uid);
  if (user.disabled) {
    const error = new Error('Esta cuenta está deshabilitada.');
    error.status = 403;
    throw error;
  }
  return { auth, user };
}

function isInvalidSession(error) {
  return error.code === 'auth/id-token-expired' || error.code === 'auth/invalid-id-token'
    || error.code === 'auth/argument-error' || error.code === 'auth/id-token-revoked';
}

function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function allowUsernameLogin(ip) {
  const now = Date.now();
  if (usernameLoginAttempts.size >= 5000 && !usernameLoginAttempts.has(ip)) {
    for (const [key, attempt] of usernameLoginAttempts) {
      if (attempt.resetAt <= now) usernameLoginAttempts.delete(key);
    }
    if (usernameLoginAttempts.size >= 5000) return false;
  }
  const current = usernameLoginAttempts.get(ip);
  if (!current || current.resetAt <= now) {
    usernameLoginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  if (current.count >= 10) return false;
  current.count += 1;
  return true;
}

router.get('/username', async (req, res) => {
  try {
    const { user } = await getAuthenticatedUser(req);
    const { firestore } = getAdminServices();
    const profile = await firestore.collection('usernamesByUid').doc(user.uid).get();
    return res.json({ username: profile.exists ? profile.get('username') : null });
  } catch (error) {
    if (isInvalidSession(error) || error.status) {
      return res.status(error.status || 401).json({ error: error.message || 'La sesión expiró. Inicia sesión de nuevo.' });
    }
    console.error('No se pudo consultar el nombre de usuario:', error);
    return res.status(503).json({ error: 'No se pudo consultar tu nombre de usuario. Inténtalo más tarde.' });
  }
});

router.post('/username', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const normalizedUsername = username.toLowerCase();
  if (!USERNAME_PATTERN.test(username) || RESERVED_USERNAMES.has(normalizedUsername)) {
    return res.status(400).json({
      error: 'El nombre de usuario debe tener entre 3 y 24 caracteres, usar letras, números, punto, guion o guion bajo, y no ser una palabra reservada.',
    });
  }

  try {
    const { user } = await getAuthenticatedUser(req);
    const { firestore } = getAdminServices();
    const usernameRef = firestore.collection('usernames').doc(normalizedUsername);
    const userRef = firestore.collection('usernamesByUid').doc(user.uid);
    await firestore.runTransaction(async (transaction) => {
      const [usernameSnapshot, userSnapshot] = await Promise.all([
        transaction.get(usernameRef),
        transaction.get(userRef),
      ]);
      if (usernameSnapshot.exists && usernameSnapshot.get('uid') !== user.uid) {
        const error = new Error('Ese nombre de usuario ya está ocupado. Prueba con otro.');
        error.status = 409;
        throw error;
      }

      const previousUsername = userSnapshot.exists ? userSnapshot.get('username') : null;
      if (previousUsername && previousUsername.toLowerCase() !== normalizedUsername) {
        transaction.delete(firestore.collection('usernames').doc(previousUsername.toLowerCase()));
      }
      transaction.set(usernameRef, { uid: user.uid, username });
      transaction.set(userRef, { username });
    });
    return res.json({ username });
  } catch (error) {
    if (isInvalidSession(error) || error.status) {
      return res.status(error.status || 401).json({ error: error.message || 'La sesión expiró. Inicia sesión de nuevo.' });
    }
    console.error('No se pudo guardar el nombre de usuario:', error);
    return res.status(503).json({ error: 'No se pudo guardar el nombre de usuario. Inténtalo más tarde.' });
  }
});

router.post('/username/login', async (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  const attemptKey = `${req.ip || 'unknown'}:${username.toLowerCase()}`;
  if (!allowUsernameLogin(attemptKey)) {
    return res.status(429).json({ error: 'Hubo demasiados intentos. Espera 15 minutos y vuelve a probar.' });
  }
  if (!USERNAME_PATTERN.test(username) || !password || password.length > 128) {
    return res.status(401).json({ error: 'El nombre de usuario o la contraseña no son correctos.' });
  }

  const apiKey = process.env.FIREBASE_WEB_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'El acceso por nombre de usuario no está configurado en el servidor.' });
  }

  try {
    const { firestore, auth } = getAdminServices();
    const usernameSnapshot = await firestore.collection('usernames').doc(username.toLowerCase()).get();
    if (!usernameSnapshot.exists) {
      return res.status(401).json({ error: 'El nombre de usuario o la contraseña no son correctos.' });
    }

    const user = await auth.getUser(usernameSnapshot.get('uid'));
    if (user.disabled || !user.email) {
      return res.status(401).json({ error: 'El nombre de usuario o la contraseña no son correctos.' });
    }

    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password, returnSecureToken: false }),
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok || result.localId !== user.uid) {
      return res.status(401).json({ error: 'El nombre de usuario o la contraseña no son correctos.' });
    }

    const customToken = await auth.createCustomToken(user.uid);
    return res.json({ token: customToken });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return res.status(504).json({ error: 'El acceso tardó demasiado. Inténtalo de nuevo.' });
    }
    console.error('No se pudo iniciar sesión con nombre de usuario:', error);
    return res.status(503).json({ error: 'No se pudo completar el acceso. Inténtalo más tarde.' });
  }
});

router.post('/sync', async (req, res) => {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Se requiere una sesión autenticada.' });

  try {
    const { auth } = getAdminServices();
    const decodedToken = await auth.verifyIdToken(match[1], true);
    let user = await auth.getUser(decodedToken.uid);
    if (user.disabled) return res.status(403).json({ error: 'Esta cuenta está deshabilitada.' });

    if (isRootAccount(user)
      && (user.customClaims?.admin !== true || user.customClaims?.superAdmin !== true)) {
      await auth.setCustomUserClaims(user.uid, {
        ...user.customClaims,
        admin: true,
        superAdmin: true,
      });
      user = await auth.getUser(user.uid);
    }

    let accountRole = await syncAccount(user);
    const claims = { ...user.customClaims };
    const shouldHaveAdminClaim = accountRole.admin;
    const shouldHaveSuperAdminClaim = accountRole.superAdmin && isRootAccount(user);
    if ((claims.admin === true) !== shouldHaveAdminClaim
      || (claims.superAdmin === true) !== shouldHaveSuperAdminClaim) {
      if (shouldHaveAdminClaim) claims.admin = true;
      else delete claims.admin;
      if (shouldHaveSuperAdminClaim) claims.superAdmin = true;
      else delete claims.superAdmin;
      await auth.setCustomUserClaims(user.uid, claims);
      user = await auth.getUser(user.uid);
      accountRole = await syncAccount(user);
    }
    return res.json({
      synced: true,
      admin: accountRole.admin,
      superAdmin: accountRole.superAdmin && isRootAccount(user),
    });
  } catch (error) {
    console.error('No se pudo sincronizar la cuenta con PostgreSQL:', error);
    if (error.code === 'auth/id-token-expired' || error.code === 'auth/invalid-id-token'
      || error.code === 'auth/argument-error' || error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ error: 'La sesión expiró. Inicia sesión de nuevo.' });
    }
    if (error.code === 'auth/user-disabled' || error.code === 'auth/user-not-found') {
      return res.status(403).json({ error: 'Esta cuenta ya no puede acceder.' });
    }
    return res.status(error.statusCode || 503).json({
      error: error.statusCode === 503
        ? error.message
        : 'No se pudo guardar la cuenta en la base de datos. Revisa la conexión PostgreSQL del backend.',
    });
  }
});

module.exports = router;
