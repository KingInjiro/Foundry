import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(crypto.scrypt);
const USERNAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,63}$/;
const PASSWORD_MIN_LENGTH = 12;
const PASSWORD_MAX_BYTES = 1024;
const SESSION_TOKEN_BYTES = 32;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const ALLOWED_ROLES = new Set(['DEVELOPER', 'MODERATOR', 'ADMIN']);

export const LOCAL_PASSWORD_SCRYPT = Object.freeze({
    cost: 32768,
    blockSize: 8,
    parallelization: 1,
    keyLength: 64,
    saltBytes: 16,
    maxmem: 64 * 1024 * 1024
});

export class LocalAuthError extends Error {
    constructor(code, message, status = 400) {
        super(message);
        this.name = 'LocalAuthError';
        this.code = code;
        this.status = status;
    }
}

export function normalizeLocalUsername(username) {
    return typeof username === 'string' ? username.trim().toLocaleLowerCase('en-US') : '';
}

export function validateLocalUsername(username) {
    const trimmed = typeof username === 'string' ? username.trim() : '';
    if (!USERNAME_PATTERN.test(trimmed)) {
        throw new LocalAuthError(
            'INVALID_USERNAME',
            'Username must be 3 to 64 characters and use only letters, numbers, dot, underscore, or hyphen.'
        );
    }
    return { username: trimmed, usernameNormalized: normalizeLocalUsername(trimmed) };
}

export function validateLocalPassword(password) {
    if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
        throw new LocalAuthError('WEAK_PASSWORD', `Password must contain at least ${PASSWORD_MIN_LENGTH} characters.`);
    }
    if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
        throw new LocalAuthError('PASSWORD_TOO_LONG', `Password must be at most ${PASSWORD_MAX_BYTES} UTF-8 bytes.`);
    }
    return password;
}

function encodePasswordHash({ salt, hash, params = LOCAL_PASSWORD_SCRYPT }) {
    return [
        'scrypt',
        params.cost,
        params.blockSize,
        params.parallelization,
        salt.toString('base64url'),
        hash.toString('base64url')
    ].join('$');
}

function decodePasswordHash(encoded) {
    const [algorithm, costValue, blockSizeValue, parallelizationValue, saltValue, hashValue, ...extra] = String(encoded || '').split('$');
    const cost = Number(costValue);
    const blockSize = Number(blockSizeValue);
    const parallelization = Number(parallelizationValue);
    const salt = Buffer.from(saltValue || '', 'base64url');
    const hash = Buffer.from(hashValue || '', 'base64url');
    const validCost = Number.isSafeInteger(cost) && cost >= 16384 && cost <= 262144 && (cost & (cost - 1)) === 0;
    if (
        algorithm !== 'scrypt'
        || extra.length
        || !validCost
        || !Number.isSafeInteger(blockSize) || blockSize < 1 || blockSize > 16
        || !Number.isSafeInteger(parallelization) || parallelization < 1 || parallelization > 4
        || salt.length < 16 || salt.length > 64
        || hash.length !== LOCAL_PASSWORD_SCRYPT.keyLength
    ) {
        throw new LocalAuthError('INVALID_PASSWORD_RECORD', 'Stored password record is invalid.', 500);
    }
    const minimumMaxmem = 128 * cost * blockSize + 128 * blockSize * parallelization + 1024;
    return {
        salt,
        hash,
        params: {
            cost,
            blockSize,
            parallelization,
            keyLength: hash.length,
            maxmem: Math.max(LOCAL_PASSWORD_SCRYPT.maxmem, minimumMaxmem)
        }
    };
}

async function derivePassword(password, salt, params) {
    return scryptAsync(password, salt, params.keyLength, {
        cost: params.cost,
        blockSize: params.blockSize,
        parallelization: params.parallelization,
        maxmem: params.maxmem
    });
}

export async function hashLocalPassword(password, { salt = crypto.randomBytes(LOCAL_PASSWORD_SCRYPT.saltBytes) } = {}) {
    validateLocalPassword(password);
    const hash = await derivePassword(password, salt, LOCAL_PASSWORD_SCRYPT);
    return encodePasswordHash({ salt, hash });
}

export async function verifyLocalPassword(password, encoded) {
    if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) return false;
    const record = decodePasswordHash(encoded);
    const actual = await derivePassword(password, record.salt, record.params);
    return actual.length === record.hash.length && crypto.timingSafeEqual(actual, record.hash);
}

function hashSessionToken(token) {
    return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function timingSafeStringEqual(actual, expected) {
    const actualBuffer = Buffer.from(String(actual || ''), 'utf8');
    const expectedBuffer = Buffer.from(String(expected || ''), 'utf8');
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function parseCookie(cookieHeader, name) {
    for (const part of String(cookieHeader || '').split(';')) {
        const separator = part.indexOf('=');
        if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
        try {
            return decodeURIComponent(part.slice(separator + 1).trim());
        } catch {
            return null;
        }
    }
    return null;
}

function safeUser(row) {
    return {
        uid: row.uid,
        username: row.username,
        email: row.email || '',
        displayName: row.displayName,
        avatarUrl: row.avatarUrl || '',
        role: row.role || 'DEVELOPER'
    };
}

export class LocalAuthService {
    constructor(database, {
        sessionSecret,
        sessionTtlSeconds = 604_800,
        secureCookies = process.env.NODE_ENV === 'production',
        publicOrigin,
        now = () => Date.now(),
        randomBytes = size => crypto.randomBytes(size)
    } = {}) {
        if (!database) throw new TypeError('LocalAuthService requires a database provider.');
        if (typeof sessionSecret !== 'string' || Buffer.byteLength(sessionSecret, 'utf8') < 32) {
            throw new TypeError('LocalAuthService requires a session secret containing at least 32 bytes.');
        }
        let parsedOrigin = null;
        if (publicOrigin) {
            const url = new URL(publicOrigin);
            parsedOrigin = url.origin;
        }
        this.database = database;
        this.sessionSecret = sessionSecret;
        this.sessionTtlSeconds = Math.max(300, Math.min(Number(sessionTtlSeconds) || 604_800, 2_592_000));
        this.secureCookies = Boolean(secureCookies);
        this.publicOrigin = parsedOrigin;
        this.now = now;
        this.randomBytes = randomBytes;
        this.kind = 'local';
        this.cookieName = this.secureCookies ? '__Host-foundry_session' : 'foundry_session';
    }

    async isReady() {
        return Boolean(await this.database.ping());
    }

    csrfTokenForHash(tokenHash) {
        return crypto.createHmac('sha256', this.sessionSecret)
            .update('foundry-csrf-v1\0', 'utf8')
            .update(tokenHash, 'utf8')
            .digest('base64url');
    }

    readSessionToken(req) {
        return parseCookie(req?.headers?.cookie, this.cookieName);
    }

    sessionTokenHash(token) {
        return hashSessionToken(token);
    }

    sessionCookie(token) {
        const parts = [
            `${this.cookieName}=${encodeURIComponent(token)}`,
            'Path=/',
            'HttpOnly',
            'SameSite=Strict',
            `Max-Age=${this.sessionTtlSeconds}`
        ];
        if (this.secureCookies) parts.push('Secure');
        return parts.join('; ');
    }

    clearSessionCookie() {
        const parts = [
            `${this.cookieName}=`,
            'Path=/',
            'HttpOnly',
            'SameSite=Strict',
            'Max-Age=0'
        ];
        if (this.secureCookies) parts.push('Secure');
        return parts.join('; ');
    }

    verifyRequestOrigin(req) {
        const origin = req?.get?.('Origin') || req?.headers?.origin;
        return Boolean(this.publicOrigin && origin === this.publicOrigin);
    }

    verifyCsrf(req, tokenHash) {
        const supplied = req?.get?.('X-CSRF-Token') || req?.headers?.['x-csrf-token'];
        return timingSafeStringEqual(supplied, this.csrfTokenForHash(tokenHash));
    }

    async createAccount({ username, password, displayName, role = 'DEVELOPER' }) {
        const normalized = validateLocalUsername(username);
        validateLocalPassword(password);
        const resolvedRole = String(role || 'DEVELOPER').trim().toUpperCase();
        if (!ALLOWED_ROLES.has(resolvedRole)) {
            throw new LocalAuthError('INVALID_ROLE', 'Unsupported local account role.');
        }
        if (await this.database.getLocalCredentialByUsername(normalized.usernameNormalized)) {
            throw new LocalAuthError('USERNAME_TAKEN', 'That username is already registered.', 409);
        }
        const resolvedDisplayName = typeof displayName === 'string' ? displayName.trim() : '';
        if (resolvedDisplayName.length > 80) {
            throw new LocalAuthError('INVALID_DISPLAY_NAME', 'Display name must be 80 characters or fewer.');
        }
        const passwordHash = await hashLocalPassword(password);
        const now = this.now();
        const user = {
            uid: crypto.randomUUID(),
            email: '',
            displayName: resolvedDisplayName || normalized.username,
            avatarUrl: '',
            role: resolvedRole,
            createdAt: now,
            updatedAt: now
        };
        try {
            const created = await this.database.createLocalAccount({
                user,
                username: normalized.username,
                usernameNormalized: normalized.usernameNormalized,
                passwordHash,
                now
            });
            return { ...created, username: normalized.username };
        } catch (error) {
            if (String(error?.message || '').includes('local_auth_credentials.usernameNormalized')) {
                throw new LocalAuthError('USERNAME_TAKEN', 'That username is already registered.', 409);
            }
            throw error;
        }
    }

    async register(credentials) {
        const user = await this.createAccount({ ...credentials, role: 'DEVELOPER' });
        return this.createSession(user);
    }

    async login({ username, password }) {
        const usernameNormalized = normalizeLocalUsername(username);
        const validInput = USERNAME_PATTERN.test(typeof username === 'string' ? username.trim() : '')
            && typeof password === 'string'
            && Buffer.byteLength(password, 'utf8') <= PASSWORD_MAX_BYTES;
        const credential = validInput
            ? await this.database.getLocalCredentialByUsername(usernameNormalized)
            : null;
        if (!credential) {
            if (typeof password === 'string' && Buffer.byteLength(password, 'utf8') <= PASSWORD_MAX_BYTES) {
                await hashLocalPassword(password.length >= PASSWORD_MIN_LENGTH ? password : `${password}${'x'.repeat(PASSWORD_MIN_LENGTH)}`);
            }
            throw new LocalAuthError('INVALID_CREDENTIALS', 'Username or password is incorrect.', 401);
        }
        const passwordValid = await verifyLocalPassword(password, credential.passwordHash);
        if (!passwordValid) {
            throw new LocalAuthError('INVALID_CREDENTIALS', 'Username or password is incorrect.', 401);
        }
        if (credential.disabledAt) {
            throw new LocalAuthError('ACCOUNT_DISABLED', 'This account is disabled. Contact the server operator.', 403);
        }
        return this.createSession(safeUser(credential));
    }

    async createSession(user) {
        const token = this.randomBytes(SESSION_TOKEN_BYTES).toString('base64url');
        const tokenHash = hashSessionToken(token);
        const createdAt = this.now();
        const expiresAt = createdAt + this.sessionTtlSeconds * 1000;
        await this.database.createLocalSession({
            tokenHash,
            uid: user.uid,
            createdAt,
            expiresAt,
            lastSeenAt: createdAt
        });
        return {
            user: safeUser(user),
            token,
            tokenHash,
            csrfToken: this.csrfTokenForHash(tokenHash),
            expiresAt
        };
    }

    async authenticateToken(token) {
        if (typeof token !== 'string' || token.length < 32 || token.length > 256) return null;
        const tokenHash = hashSessionToken(token);
        const session = await this.database.getLocalSession(tokenHash);
        if (!session || session.revokedAt) return null;
        const now = this.now();
        if (Number(session.expiresAt) <= now) {
            await this.database.revokeLocalSession(tokenHash, now);
            throw new LocalAuthError('SESSION_EXPIRED', 'Your session expired. Sign in again.', 401);
        }
        if (session.disabledAt) {
            await this.database.revokeLocalSession(tokenHash, now);
            throw new LocalAuthError('ACCOUNT_DISABLED', 'This account is disabled. Contact the server operator.', 403);
        }
        if (now - Number(session.lastSeenAt || 0) >= TOUCH_INTERVAL_MS) {
            await this.database.touchLocalSession(tokenHash, now);
        }
        const user = safeUser(session);
        return {
            user,
            auth: {
                uid: user.uid,
                email: user.email,
                role: user.role,
                claims: { name: user.displayName, localUsername: user.username }
            },
            tokenHash,
            csrfToken: this.csrfTokenForHash(tokenHash),
            expiresAt: Number(session.expiresAt)
        };
    }

    async authenticateRequest(req) {
        const token = this.readSessionToken(req);
        return token ? this.authenticateToken(token) : null;
    }

    async logoutRequest(req) {
        const token = this.readSessionToken(req);
        if (!token) return false;
        return this.database.revokeLocalSession(hashSessionToken(token), this.now());
    }

    async findAccount(identifier) {
        const value = typeof identifier === 'string' ? identifier.trim() : '';
        if (!value) return null;
        return await this.database.getLocalCredentialByUid(value)
            || await this.database.getLocalCredentialByUsername(normalizeLocalUsername(value));
    }

    async resetPassword(identifier, password) {
        validateLocalPassword(password);
        const account = await this.findAccount(identifier);
        if (!account) throw new LocalAuthError('ACCOUNT_NOT_FOUND', 'Local account not found.', 404);
        const passwordHash = await hashLocalPassword(password);
        const updated = await this.database.updateLocalPassword(account.uid, passwordHash, this.now());
        return safeUser(updated);
    }

    async setDisabled(identifier, disabled) {
        const account = await this.findAccount(identifier);
        if (!account) throw new LocalAuthError('ACCOUNT_NOT_FOUND', 'Local account not found.', 404);
        const updated = await this.database.setLocalUserDisabled(account.uid, Boolean(disabled), this.now());
        return { ...safeUser(updated), disabled: Boolean(updated.disabledAt) };
    }
}
