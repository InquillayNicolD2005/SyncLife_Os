const { getAdminServices } = require('../firebase-admin');
const { isRootAccount } = require('../admin-identity');

async function main() {
  const identifier = process.argv[2];
  if (!identifier || identifier.startsWith('-')) {
    throw new Error('Uso: npm run set-admin -- <UID-o-correo-de-Firebase>');
  }

  const { auth } = getAdminServices();
  const user = identifier.includes('@')
    ? await auth.getUserByEmail(identifier.trim())
    : await auth.getUser(identifier);
  if (!isRootAccount(user)) {
    throw new Error('Solo se puede establecer como propietaria la cuenta configurada en SUPER_ADMIN_EMAIL.');
  }
  await auth.setCustomUserClaims(user.uid, { ...user.customClaims, admin: true, superAdmin: true });
  console.log(`Cuenta propietaria preparada para ${user.email || user.uid}. Inicia sesión para sincronizar el rol en PostgreSQL.`);
}

main().catch((error) => {
  console.error('No se pudo asignar el rol admin:', error);
  process.exitCode = 1;
});
