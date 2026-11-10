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
        const error = new Error('FIREBASE_SERVICE_ACCOUNT_JSON no contiene JSON válido.');
        error.code = 'firebase/invalid-service-account-json';
        throw error;
      }
    }

    const projectId = process.env.FIREBASE_PROJECT_ID || serviceAccount?.project_id;
    if (serviceAccount && (!serviceAccount.project_id || !serviceAccount.client_email || !serviceAccount.private_key)) {
      const error = new Error('FIREBASE_SERVICE_ACCOUNT_JSON debe incluir project_id, client_email y private_key.');
      error.code = 'firebase/incomplete-service-account';
      throw error;
    }
    if (serviceAccount?.project_id && projectId !== serviceAccount.project_id) {
      const error = new Error('FIREBASE_PROJECT_ID no coincide con el proyecto de la cuenta de servicio.');
      error.code = 'firebase/project-mismatch';
      throw error;
    }
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
