const { getAdminServices } = require('../firebase-admin');

async function main() {
  const uid = process.argv[2];
  if (!uid || uid.startsWith('-')) {
    throw new Error('Uso: npm run set-admin -- <UID-de-Firebase>');
  }

  const { auth } = getAdminServices();
  const user = await auth.getUser(uid);
  await auth.setCustomUserClaims(uid, { ...user.customClaims, admin: true });
  console.log(`Rol admin asignado a ${user.email || user.uid}. Cierra y vuelve a iniciar sesión para actualizar el token.`);
}

main().catch((error) => {
  console.error('No se pudo asignar el rol admin:', error);
  process.exitCode = 1;
});
