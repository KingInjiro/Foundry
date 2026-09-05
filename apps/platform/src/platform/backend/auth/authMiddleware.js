import { getAuth, isFirebaseAdminConfigured } from './firebaseAdmin.js';

function getDevAuth(req) {
    return {
        uid: req.headers['x-dev-uid'] || 'dev-user-123',
        email: 'dev@foundry.test',
        role: 'DEVELOPER',
        claims: {}
    };
}

async function authenticateLocalRequest(req, res, { optional = false } = {}) {
    const service = req.app?.locals?.localAuthService;
    if (!service) return false;
    const hasSessionToken = Boolean(service.readSessionToken(req));
    if (optional && !hasSessionToken) return null;
    try {
        const session = await service.authenticateRequest(req);
        if (!session) {
            res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Sign in to continue.' } });
            return false;
        }
        req.auth = session.auth;
        req.localAuthSession = session;
        return true;
    } catch (error) {
        req.app?.locals?.logger?.warn('local_auth_session_rejected', {
            requestId: req.requestId,
            errorCode: error?.code || 'SESSION_INVALID'
        });
        const status = error?.code === 'ACCOUNT_DISABLED' ? 403 : 401;
        res.status(status).json({
            success: false,
            error: {
                code: error?.code === 'ACCOUNT_DISABLED' ? 'ACCOUNT_DISABLED' : 'UNAUTHORIZED',
                message: error?.code === 'ACCOUNT_DISABLED'
                    ? 'This account is disabled. Contact the server operator.'
                    : 'Your session is invalid or expired. Sign in again.'
            }
        });
        return false;
    }
}

export async function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (process.env.NODE_ENV !== 'production' && process.env.AUTH_DEV_BYPASS === 'true') {
        req.auth = getDevAuth(req);
        return next();
    }

    if (req.app?.locals?.localAuthService) {
        if (await authenticateLocalRequest(req, res)) return next();
        return;
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
        req.app?.locals?.logger?.warn('auth_token_rejected', { requestId: req.requestId, errorCode: error?.code || 'TOKEN_INVALID' });
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

    if (req.app?.locals?.localAuthService) {
        const result = await authenticateLocalRequest(req, res, { optional: true });
        if (result === null || result === true) return next();
        return;
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
        req.app?.locals?.logger?.warn('optional_auth_token_rejected', { requestId: req.requestId, errorCode: error?.code || 'TOKEN_INVALID' });
        return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired ID token' } });
    }
}
