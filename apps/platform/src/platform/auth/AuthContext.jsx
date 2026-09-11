import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import bundledDevelopmentConfig from '../../../firebase-applet-config.json';
import { LocalAuthDialog } from './LocalAuthDialog.jsx';

const AuthContext = createContext();
let firebaseClientPromise = null;
let localCsrfToken = null;
const localDevAuth = import.meta.env.DEV && import.meta.env.VITE_LOCAL_DEV_AUTH === 'true';
const storedDevAuthEnabled = import.meta.env.DEV;
const builtAuthProvider = typeof __FOUNDRY_AUTH_PROVIDER__ !== 'undefined'
    ? __FOUNDRY_AUTH_PROVIDER__
    : (import.meta.env.VITE_FOUNDRY_AUTH_PROVIDER || 'firebase');
const localProductionAuth = builtAuthProvider === 'local';
const firebaseConfig = import.meta.env.PROD ? {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || undefined,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || undefined
} : bundledDevelopmentConfig;

async function getFirebaseClient() {
    if (localProductionAuth) throw new Error('Firebase authentication is not available in the single-host build.');
    if (!firebaseClientPromise) {
        firebaseClientPromise = Promise.all([
            import('firebase/app'),
            import('firebase/auth')
        ]).then(([appModule, authModule]) => {
            const app = appModule.getApps().length
                ? appModule.getApp()
                : appModule.initializeApp(firebaseConfig);
            return {
                auth: authModule.getAuth(app),
                GoogleAuthProvider: authModule.GoogleAuthProvider,
                onAuthStateChanged: authModule.onAuthStateChanged,
                signInWithPopup: authModule.signInWithPopup,
                signOut: authModule.signOut
            };
        });
    }
    return firebaseClientPromise;
}

function getStoredDevUser() {
    if (!storedDevAuthEnabled) return null;
    try {
        const value = localStorage.getItem('FOUNDRY_DEV_USER') || localStorage.getItem('E2E_MOCK_USER');
        return value ? JSON.parse(value) : null;
    } catch {
        localStorage.removeItem('FOUNDRY_DEV_USER');
        localStorage.removeItem('E2E_MOCK_USER');
        return null;
    }
}

function getDevUserId() {
    if (!storedDevAuthEnabled) return null;
    return localStorage.getItem('FOUNDRY_DEV_USER_ID') || localStorage.getItem('E2E_MOCK_USER_ID');
}

export function getDevAuthUserId() {
    return getDevUserId();
}

export function getCsrfToken() {
    return localProductionAuth ? localCsrfToken : null;
}

export function getAuthProvider() {
    return localProductionAuth ? 'local' : 'firebase';
}

function createLocalDevUser() {
    const devUser = { uid: 'local-developer', email: 'local@foundry.dev', displayName: 'Local Developer' };
    localStorage.setItem('FOUNDRY_DEV_USER_ID', devUser.uid);
    localStorage.setItem('FOUNDRY_DEV_USER', JSON.stringify(devUser));
    return devUser;
}

async function localAuthRequest(path, options = {}) {
    const response = await fetch(path, {
        ...options,
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {})
        }
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
        const error = new Error(payload?.error?.message || 'The authentication request failed.');
        error.code = payload?.error?.code || `HTTP_${response.status}`;
        error.status = response.status;
        throw error;
    }
    return payload?.data ?? payload;
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const [localDialogOpen, setLocalDialogOpen] = useState(false);
    const [googleEnabled, setGoogleEnabled] = useState(false);
    const [googleNotice, setGoogleNotice] = useState(() => {
        if (!localProductionAuth) return '';
        const result = new URLSearchParams(window.location.search).get('googleAuth');
        return new Map([
            ['cancelled', 'Google sign-in was cancelled. You can try again, use your username and password, or browse without signing in.'],
            ['failed', 'Google sign-in could not be completed. Try again or use your username and password.'],
            ['disabled', 'This Google-linked Foundry account is disabled. Contact the server operator.']
        ]).get(result) || '';
    });
    const loginResolverRef = useRef(null);

    const clearGoogleNotice = () => {
        setGoogleNotice('');
        const url = new URL(window.location.href);
        if (url.searchParams.has('googleAuth')) {
            url.searchParams.delete('googleAuth');
            window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
        }
    };

    const resolveLocalLogin = useCallback(result => {
        loginResolverRef.current?.(result);
        loginResolverRef.current = null;
        setLocalDialogOpen(false);
    }, []);

    useEffect(() => {
        if (localProductionAuth) {
            let cancelled = false;
            void localAuthRequest('/api/auth/google/config').then(configuration => {
                if (!cancelled) setGoogleEnabled(configuration?.enabled === true);
            }).catch(() => {
                // Optional Google availability cannot block local login/session
                // initialization. The server reports configured availability.
                if (!cancelled) setGoogleEnabled(false);
            });
            void localAuthRequest('/api/auth/local/session')
                .then(session => {
                    if (cancelled) return;
                    localCsrfToken = session.csrfToken;
                    setUser(session.user);
                })
                .catch(error => {
                    if (error?.status !== 401) console.error('Local authentication initialization failed:', error);
                    if (!cancelled) {
                        localCsrfToken = null;
                        setUser(null);
                    }
                })
                .finally(() => {
                    if (!cancelled) setLoading(false);
                });
            return () => {
                cancelled = true;
                loginResolverRef.current?.(null);
                loginResolverRef.current = null;
            };
        }

        const devUser = getStoredDevUser();
        if (devUser) {
            setUser(devUser);
            setLoading(false);
            return () => {};
        }
        if (localDevAuth) {
            setUser(createLocalDevUser());
            setLoading(false);
            return () => {};
        }

        let cancelled = false;
        let unsubscribe = () => {};
        void getFirebaseClient().then(client => {
            if (cancelled) return;
            unsubscribe = client.onAuthStateChanged(client.auth, currentUser => {
                setUser(currentUser);
                setLoading(false);
            });
        }).catch(error => {
            console.error('Authentication initialization failed:', error);
            if (!cancelled) setLoading(false);
        });

        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, []);

    const login = async () => {
        if (localProductionAuth) {
            if (user) return user;
            setLocalDialogOpen(true);
            return new Promise(resolve => {
                loginResolverRef.current?.(null);
                loginResolverRef.current = resolve;
            });
        }

        const devUserId = getDevUserId();
        if (devUserId || localDevAuth) {
            const devUser = getStoredDevUser() || (localDevAuth
                ? createLocalDevUser()
                : { uid: devUserId, email: 'dev@foundry.test', displayName: 'Foundry Developer' });
            if (!localDevAuth) localStorage.setItem('E2E_MOCK_USER', JSON.stringify(devUser));
            setUser(devUser);
            return devUser;
        }

        try {
            const client = await getFirebaseClient();
            const credential = await client.signInWithPopup(client.auth, new client.GoogleAuthProvider());
            return credential.user;
        } catch (error) {
            console.error('Login failed:', error);
            return null;
        }
    };

    const submitLocalLogin = async ({ mode, username, displayName, password }) => {
        const session = await localAuthRequest(`/api/auth/local/${mode === 'register' ? 'register' : 'login'}`, {
            method: 'POST',
            body: JSON.stringify({ username, password, ...(mode === 'register' && { displayName }) })
        });
        localCsrfToken = session.csrfToken;
        setUser(session.user);
        clearGoogleNotice();
        resolveLocalLogin(session.user);
    };

    const beginGoogleLogin = async () => {
        if (!localProductionAuth || !googleEnabled) throw new Error('Google sign-in is unavailable. Use your username and password.');
        const { url } = await localAuthRequest('/api/auth/google/start', {
            method: 'POST',
            body: JSON.stringify({ returnTo: window.location.pathname + window.location.search + window.location.hash })
        });
        const target = new URL(url);
        if (target.origin !== 'https://accounts.google.com' || target.pathname !== '/o/oauth2/v2/auth') {
            throw new Error('Google sign-in could not be started. Use your username and password.');
        }
        clearGoogleNotice();
        window.location.assign(target.href);
    };

    const logout = async () => {
        if (localProductionAuth) {
            try {
                await localAuthRequest('/api/auth/local/logout', {
                    method: 'POST',
                    headers: localCsrfToken ? { 'X-CSRF-Token': localCsrfToken } : {}
                });
                localCsrfToken = null;
                setUser(null);
                return true;
            } catch (error) {
                console.error('Logout failed:', error);
                return false;
            }
        }

        if (getStoredDevUser() || getDevUserId()) {
            localStorage.removeItem('FOUNDRY_DEV_USER');
            localStorage.removeItem('FOUNDRY_DEV_USER_ID');
            localStorage.removeItem('E2E_MOCK_USER');
            localStorage.removeItem('E2E_MOCK_USER_ID');
            setUser(null);
            return true;
        }

        try {
            const client = await getFirebaseClient();
            await client.signOut(client.auth);
            return true;
        } catch (error) {
            console.error('Logout failed:', error);
            return false;
        }
    };

    return (
        <AuthContext.Provider value={{ user, loading, login, logout, authProvider: getAuthProvider() }}>
            {children}
            {googleNotice && (
                <div role="status" aria-label="Sign-in feedback" className="fixed bottom-4 left-4 right-4 z-[90] mx-auto max-w-lg rounded-xl border border-neutral-600 bg-neutral-900 p-4 text-sm text-white shadow-lg">
                    <p>{googleNotice}</p>
                    <button type="button" onClick={clearGoogleNotice} className="mt-2 rounded px-2 py-1 font-semibold underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">Dismiss sign-in message</button>
                </div>
            )}
            <LocalAuthDialog
                open={localProductionAuth && localDialogOpen}
                onClose={() => resolveLocalLogin(null)}
                onSubmit={submitLocalLogin}
                onGoogle={localProductionAuth && googleEnabled ? beginGoogleLogin : undefined}
            />
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);

export async function getAuthToken() {
    if (localProductionAuth || getDevUserId()) return null;
    const client = await getFirebaseClient();
    return client.auth.currentUser ? client.auth.currentUser.getIdToken() : null;
}
