import { GoogleAuthError, GOOGLE_CALLBACK_PATH } from './GoogleOAuthService.js';

function failureDestination(returnTo, reason) {
    const url = new URL(returnTo, 'https://foundry.invalid');
    url.searchParams.set('googleAuth', reason);
    return url.pathname + url.search + url.hash;
}

export function registerGoogleAuthRoutes(app, google, { startLimit, callbackLimit, logger }) {
    const localAuth = google.localAuth;
    const noStore = (_req, res, next) => {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Referrer-Policy', 'no-referrer');
        next();
    };
    app.use('/api/auth/google', noStore);
    app.get('/api/auth/google/config', (_req, res) => {
        res.json({ success: true, data: { enabled: google.enabled } });
    });
    app.post('/api/auth/google/start', startLimit, async (req, res) => {
        try {
            if (!google.enabled) throw new GoogleAuthError('GOOGLE_AUTH_UNAVAILABLE', 503);
            // An expired cookie must not prevent reauthentication, but starting
            // Google while signed in must not silently switch/link identities.
            let current = null;
            try { current = await localAuth.authenticateRequest(req); } catch (error) {
                if (!['SESSION_EXPIRED', 'ACCOUNT_DISABLED'].includes(error?.code)) throw error;
            }
            if (current) throw new GoogleAuthError('GOOGLE_ALREADY_SIGNED_IN', 409);
            const { url, cookie } = google.start(req.body?.returnTo, google.readBinding(req.headers.cookie));
            res.setHeader('Set-Cookie', cookie);
            res.json({ success: true, data: { url } });
        } catch (error) {
            const known = error instanceof GoogleAuthError;
            logger.warn('google_auth_start_rejected', { requestId: req.requestId, errorCode: known ? error.code : 'GOOGLE_AUTH_FAILED' });
            res.status(known ? error.status : 500).json({
                success: false,
                error: { code: known ? error.code : 'GOOGLE_AUTH_FAILED', message: new GoogleAuthError().message }
            });
        }
    });
    app.get(GOOGLE_CALLBACK_PATH, callbackLimit, async (req, res) => {
        let transaction;
        res.setHeader('Set-Cookie', google.stateCookie('', 0));
        try {
            if (!google.enabled) throw new GoogleAuthError('GOOGLE_AUTH_UNAVAILABLE', 503);
            transaction = google.consume(req.query.state, google.readBinding(req.headers.cookie));
            const { code, error } = req.query;
            if (error !== undefined) {
                if (code !== undefined || typeof error !== 'string' || !error || error.length > 128) throw new GoogleAuthError();
                const cancelled = error === 'access_denied';
                logger.info('google_auth_callback_rejected', { requestId: req.requestId, errorCode: cancelled ? 'GOOGLE_CANCELLED' : 'GOOGLE_AUTH_FAILED' });
                return res.redirect(303, failureDestination(transaction.returnTo, cancelled ? 'cancelled' : 'failed'));
            }
            if (typeof code !== 'string' || !code || code.length > 4096) throw new GoogleAuthError();
            const session = await google.signIn(code, transaction);
            await localAuth.logoutRequest(req);
            res.append('Set-Cookie', localAuth.sessionCookie(session.token));
            res.redirect(303, transaction.returnTo);
        } catch (error) {
            // Never log query/body/SDK error objects, even for unexpected faults.
            const code = error instanceof GoogleAuthError ? error.code : 'GOOGLE_AUTH_FAILED';
            logger.warn('google_auth_callback_rejected', { requestId: req.requestId, errorCode: code });
            if (transaction) return res.redirect(303, failureDestination(transaction.returnTo, code === 'ACCOUNT_DISABLED' ? 'disabled' : 'failed'));
            return res.redirect(303, '/?googleAuth=failed');
        }
    });
}
