import { getAuth, isFirebaseAdminConfigured } from './firebaseAdmin.js';

function getDevAuth(req) {
    return {
        uid: req.headers['x-dev-uid'] || 'dev-user-123',
        email: 'dev@foundry.test',
        role: 'DEVELOPER',
        claims: {}
    };
}

export async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (process.env.NODE_ENV !== 'production' && process.env.AUTH_DEV_BYPASS === 'true') {
        req.auth = getDevAuth(req);
        return next();
    }

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing or invalid Authorization header' } });
    }

    const idToken = authHeader.split('Bearer ')[1];

    if (!isFirebaseAdminConfigured()) {
        return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Firebase Admin SDK not configured' } });
    }

    try {
        const decodedToken = await getAuth().verifyIdToken(idToken);
        req.auth = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            claims: decodedToken
        };
        next();
    } catch (error) {
        console.error('Error verifying Firebase ID token:', error);
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired ID token' } });
    }
}

// Used by public discovery endpoints that become more useful when a user is signed in.
// Anonymous traffic remains anonymous; an invalid supplied token is still rejected.
export async function optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (process.env.NODE_ENV !== 'production' && process.env.AUTH_DEV_BYPASS === 'true') {
        if (req.headers['x-dev-uid']) req.auth = getDevAuth(req);
        return next();
    }

    if (!authHeader) return next();
    if (!authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid Authorization header' } });
    }
    if (!isFirebaseAdminConfigured()) {
        return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Firebase Admin SDK not configured' } });
    }

    try {
        const decodedToken = await getAuth().verifyIdToken(authHeader.slice('Bearer '.length));
        req.auth = {
            uid: decodedToken.uid,
            email: decodedToken.email,
            claims: decodedToken
        };
        next();
    } catch (error) {
        console.error('Error verifying optional Firebase ID token:', error);
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired ID token' } });
    }
}
