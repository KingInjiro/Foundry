export class AuthService {
    async authenticate(provider, token) {
        throw new Error("Method not implemented.");
    }

    async getSession(sessionId) {
        throw new Error("Method not implemented.");
    }
}

export class GoogleAuthProvider extends AuthService {
    async authenticate(provider, token) {
        // Future Google OAuth verification
        console.log("Verifying Google OAuth token...");
        return {
            userId: 'user-123',
            role: 'developer'
        };
    }
}
