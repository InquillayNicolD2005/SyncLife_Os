const { getAdminServices } = require('../firebase-admin');

async function main() {
  const identifier = process.argv[2];
  if (!identifier || identifier.startsWith('-')) {
    throw new Error('Uso: npm run set-admin -- <UID-o-correo-de-Firebase>');
  }

  const { auth } = getAdminServices();
  const user = identifier.includes('@')
    ? await auth.getUserByEmail(identifier.trim())
    : await auth.getUser(identifier);
  await auth.setCustomUserClaims(user.uid, { ...user.customClaims, admin: true });
  console.log(`Rol admin asignado a ${user.email || user.uid}. Cierra y vuelve a iniciar sesión para actualizar el token.`);
}

main().catch((error) => {
  console.error('No se pudo asignar el rol admin:', error);
  process.exitCode = 1;
});
