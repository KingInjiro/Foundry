import React, { createContext, useContext, useEffect, useState } from 'react';
import firebaseConfig from '../../../firebase-applet-config.json';

const AuthContext = createContext();
let firebaseClientPromise = null;
const localDevAuth = import.meta.env.DEV && import.meta.env.VITE_LOCAL_DEV_AUTH === 'true';
const storedDevAuthEnabled = import.meta.env.DEV;

async function getFirebaseClient() {
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

function createLocalDevUser() {
    const devUser = { uid: 'local-developer', email: 'local@foundry.dev', displayName: 'Local Developer' };
    localStorage.setItem('FOUNDRY_DEV_USER_ID', devUser.uid);
    localStorage.setItem('FOUNDRY_DEV_USER', JSON.stringify(devUser));
    return devUser;
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
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

    const logout = async () => {
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
        <AuthContext.Provider value={{ user, loading, login, logout }}>
            {children}
        </AuthContext.Provider>
    );
}

export const useAuth = () => useContext(AuthContext);

export async function getAuthToken() {
    if (getDevUserId()) return null;
    const client = await getFirebaseClient();
    return client.auth.currentUser ? client.auth.currentUser.getIdToken() : null;
}
