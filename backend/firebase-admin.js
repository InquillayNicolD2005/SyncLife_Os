const { applicationDefault, cert, getApp, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { FieldValue, getFirestore } = require('firebase-admin/firestore');

function getAdminServices() {
  let app;
  if (!getApps().length) {
    let serviceAccount;
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (rawServiceAccount) {
      try {
        serviceAccount = JSON.parse(rawServiceAccount);
      } catch {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON no contiene JSON válido.');
      }
    }

    const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id;
    const credential = serviceAccount
      ? cert(serviceAccount)
      : applicationDefault();

    app = initializeApp({
      credential,
      ...(projectId ? { projectId } : {}),
    });
  } else {
    app = getApp();
  }

  return {
    auth: getAuth(app),
    firestore: getFirestore(app),
    fieldValue: FieldValue,
  };
}

module.exports = { getAdminServices };
