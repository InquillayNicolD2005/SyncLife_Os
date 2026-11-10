const ROOT_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || 'admin@gmail.com').trim().toLowerCase();

function isRootAccount(user) {
  return Boolean(ROOT_ADMIN_EMAIL && user?.email
    && user.email.trim().toLowerCase() === ROOT_ADMIN_EMAIL);
}

module.exports = { isRootAccount, ROOT_ADMIN_EMAIL };
