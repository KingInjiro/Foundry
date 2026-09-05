import { applicationDefault, initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

let configurationAttempted = false;
let isConfigured = false;
let initializationError = null;
let app = null;

function ensureConfigured(env = process.env) {
    if (configurationAttempted) return;
    configurationAttempted = true;
    try {
        if (!getApps().length) {
            const projectId = env.FIREBASE_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT;
            const explicitCredentials = env.FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS === 'true'
                || Boolean(env.GOOGLE_APPLICATION_CREDENTIALS);
            app = initializeApp({
                ...(projectId && { projectId }),
                ...(explicitCredentials && { credential: applicationDefault() })
            });
        } else {
            app = getApp();
        }
        isConfigured = true;
    } catch (error) {
        initializationError = error;
        isConfigured = false;
        if (env.NODE_ENV !== 'test') {
            console.warn('Firebase Admin SDK initialization failed. Real authentication will be unavailable.', error.message);
        }
    }
}

export const getAuth = () => {
    ensureConfigured();
    return isConfigured ? getAdminAuth(app) : null;
};
export const isFirebaseAdminConfigured = () => {
    ensureConfigured();
    return isConfigured;
};
export const getFirebaseAdminStatus = () => {
    ensureConfigured();
    return {
        configured: isConfigured,
        projectId: app?.options?.projectId || null,
        errorCode: initializationError?.code || null
    };
};
