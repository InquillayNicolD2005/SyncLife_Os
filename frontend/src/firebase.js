import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyB4iEb6OVqDkiQ7_nbK42RUqw4NNEDTcCA',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'synclife-os-b2daf.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'synclife-os-b2daf',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'synclife-os-b2daf.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '1054650131751',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:1054650131751:web:62c13afc4a59fb1464f502',
};

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);
export const auth = firebaseConfigured
  ? getAuth(getApps().length ? getApp() : initializeApp(firebaseConfig))
  : null;
