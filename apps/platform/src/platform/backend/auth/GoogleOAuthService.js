import crypto from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { LocalAuthError } from './LocalAuthService.js';

export const GOOGLE_CALLBACK_PATH = '/api/auth/google/callback';
export const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING_STATES = 1000;
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

export class GoogleAuthError extends LocalAuthError {
    constructor(code = 'GOOGLE_AUTH_FAILED', status = 400) {
        super(code, 'Google sign-in could not be completed. Try again or sign in with your username and password.', status);
        this.name = 'GoogleAuthError';
    }
}

export function safeGoogleReturnTo(value) {
    if (typeof value !== 'string' || value.length > 2048 || /[\\\x00-\x20]/.test(value) || /%(?:0[ad]|5c)/i.test(value)) return '/';
    try {
        const url = new URL(value, 'https://foundry.invalid');
        if (!value.startsWith('/') || value.startsWith('//') || url.origin !== 'https://foundry.invalid') return '/';
        if (!/^\/(?:$|(?:developer|player)(?:\/|$)|editor$|moderation$)/.test(url.pathname)) return '/';
        url.searchParams.delete('googleAuth');
        return url.pathname + url.search + url.hash;
    } catch {
        return '/';
    }
}

export function googleConfiguration({ clientId, clientSecret, publicOrigin, secureCookies = true } = {}) {
    if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{1,200}\.apps\.googleusercontent\.com$/.test(clientId)) return null;
    if (typeof clientSecret !== 'string' || !/^[\x21-\x7e]{16,256}$/.test(clientSecret)) return null;
    try {
        const url = new URL(publicOrigin);
        const localHttp = !secureCookies && url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
        return { clientId, clientSecret, redirectUri: url.origin + GOOGLE_CALLBACK_PATH };
    } catch {
        return null;
    }
}

export class GoogleOAuthService {
    constructor(localAuth, configuration, { client, now = () => Date.now() } = {}) {
        this.localAuth = localAuth;
        this.database = localAuth.database;
        this.configuration = googleConfiguration({ ...configuration, secureCookies: localAuth.secureCookies });
        this.now = now;
        this.pending = new Map();
        this.cookieName = localAuth.secureCookies ? '__Host-foundry_google' : 'foundry_google';
        this.client = this.configuration ? client || new OAuth2Client({
            ...this.configuration,
            issuers: ISSUERS,
            transporterOptions: { timeout: 10_000, maxContentLength: 64 * 1024 }
        }) : null;
    }

    get enabled() { return Boolean(this.client); }

    stateCookie(value, maxAge = GOOGLE_STATE_TTL_MS / 1000) {
        // Only this temporary binding cookie is Lax for Google's top-level GET
        // callback. The existing Foundry session remains SameSite=Strict.
        return `${this.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${this.localAuth.secureCookies ? '; Secure' : ''}`;
    }

    readBinding(cookieHeader) {
        const matches = String(cookieHeader || '').split(';').map(value => value.trim())
            .filter(value => value.startsWith(`${this.cookieName}=`));
        return matches.length === 1 ? matches[0].slice(this.cookieName.length + 1) : '';
    }

    start(returnTo, previousBinding = '') {
        if (!this.enabled) throw new GoogleAuthError('GOOGLE_AUTH_UNAVAILABLE', 503);
        const now = this.now();
        // No timers, disk credentials, or unbounded pending-login accumulation.
        // A restart invalidates unfinished flows; users can simply start again.
        for (const [key, state] of this.pending) {
            if (state.expiresAt <= now || (previousBinding && state.bindingHash === hash(previousBinding))) this.pending.delete(key);
        }
        if (this.pending.size >= MAX_PENDING_STATES) throw new GoogleAuthError('GOOGLE_AUTH_BUSY', 429);
        const state = crypto.randomBytes(32).toString('base64url');
        const binding = crypto.randomBytes(32).toString('base64url');
        const nonce = crypto.randomBytes(32).toString('base64url');
        const codeVerifier = crypto.randomBytes(32).toString('base64url');
        this.pending.set(hash(state), {
            bindingHash: hash(binding), nonce, codeVerifier,
            returnTo: safeGoogleReturnTo(returnTo), expiresAt: now + GOOGLE_STATE_TTL_MS
        });
        const url = this.client.generateAuthUrl({
            response_type: 'code', scope: ['openid', 'email', 'profile'],
            access_type: 'online', prompt: 'select_account', state, nonce,
            code_challenge: crypto.createHash('sha256').update(codeVerifier).digest('base64url'),
            code_challenge_method: 'S256'
        });
        return { url, cookie: this.stateCookie(binding) };
    }

    consume(state, binding) {
        if (typeof state !== 'string' || typeof binding !== 'string' || !TOKEN_PATTERN.test(state) || !TOKEN_PATTERN.test(binding)) {
            throw new GoogleAuthError('GOOGLE_STATE_INVALID');
        }
        const key = hash(state);
        const pending = this.pending.get(key);
        if (!pending || !crypto.timingSafeEqual(Buffer.from(pending.bindingHash), Buffer.from(hash(binding)))) {
            throw new GoogleAuthError('GOOGLE_STATE_INVALID');
        }
        // Consume before any asynchronous operation, including cancellation and
        // failed code exchanges. Parallel/repeated callbacks cannot reuse state.
        this.pending.delete(key);
        if (pending.expiresAt <= this.now()) throw new GoogleAuthError('GOOGLE_STATE_INVALID');
        return pending;
    }

    async verifyCode(code, { nonce, codeVerifier }) {
        if (!this.enabled) throw new GoogleAuthError('GOOGLE_AUTH_UNAVAILABLE', 503);
        if (typeof code !== 'string' || !code.length || code.length > 4096 || /[\x00-\x20]/.test(code)) throw new GoogleAuthError();
        try {
            const { tokens } = await this.client.getToken({ code, codeVerifier, redirect_uri: this.configuration.redirectUri });
            const idToken = tokens?.id_token;
            if (typeof idToken !== 'string' || idToken.length > 16 * 1024) throw new Error('Invalid identity');
            const header = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64url').toString('utf8'));
            if (header?.alg !== 'RS256') throw new Error('Invalid identity');
            const ticket = await this.client.verifyIdToken({ idToken, audience: this.configuration.clientId, maxExpiry: 7200 });
            const claims = ticket.getPayload();
            const seconds = this.now() / 1000;
            if (!claims || !ISSUERS.includes(claims.iss) || claims.aud !== this.configuration.clientId
                || (claims.azp !== undefined && claims.azp !== this.configuration.clientId)
                || !Number.isSafeInteger(claims.exp) || claims.exp <= seconds
                || !Number.isSafeInteger(claims.iat) || claims.iat > seconds + 60 || claims.exp <= claims.iat
                || typeof nonce !== 'string' || !TOKEN_PATTERN.test(nonce) || claims.nonce !== nonce
                || typeof claims.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(claims.sub)) throw new Error('Invalid identity');
            return {
                subject: claims.sub,
                email: claims.email_verified === true && typeof claims.email === 'string' && claims.email.length <= 320 ? claims.email : '',
                displayName: typeof claims.name === 'string' ? claims.name.trim().slice(0, 80) : ''
            };
        } catch {
            // SDK errors may embed authorization codes, tokens and request
            // credentials. Never propagate their messages, objects or causes.
            throw new GoogleAuthError('GOOGLE_IDENTITY_REJECTED', 401);
        }
    }

    async signIn(code, transaction) {
        const identity = await this.verifyCode(code, transaction);
        const mapped = await this.database.findOrCreateGoogleUser({ ...identity, now: this.now() });
        return this.database.runSerializedTransaction(async () => {
            const user = await this.database.getExternalAccountByUid(mapped.uid);
            if (!user || user.disabledAt) throw new GoogleAuthError('ACCOUNT_DISABLED', 403);
            return this.localAuth.createSession(user);
        });
    }
}
