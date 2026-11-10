const express = require('express');
const { getAdminServices } = require('./firebase-admin');
const { syncAccount } = require('./postgres');

const router = express.Router();

router.post('/sync', async (req, res) => {
  const authorization = req.get('authorization') || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Se requiere una sesión autenticada.' });

  try {
    const { auth } = getAdminServices();
    const decodedToken = await auth.verifyIdToken(match[1], true);
    const user = await auth.getUser(decodedToken.uid);
    if (user.disabled) return res.status(403).json({ error: 'Esta cuenta está deshabilitada.' });

    await syncAccount(user, decodedToken.admin === true ? 'admin' : 'user');
    return res.json({ synced: true });
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
