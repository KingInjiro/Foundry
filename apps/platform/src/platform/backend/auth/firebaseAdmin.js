import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

let isConfigured = false;
let app;
try {
    if (!getApps().length) {
        app = initializeApp();
    } else {
        app = getApp();
    }
    isConfigured = true;
} catch (error) {
    console.warn('Firebase Admin SDK initialization failed. Real authentication will be unavailable.', error.message);
}

export const getAuth = () => isConfigured ? getAdminAuth(app) : null;
export const isFirebaseAdminConfigured = () => isConfigured;
