import http from 'node:http';
import { OAuth2Client } from 'google-auth-library';
import { mockGoogleClient } from './googleOAuthMock.js';

// Loaded only by the isolated browser-test launcher, never the release/server.
// The compiled server still performs its own code exchange, PKCE checks and
// real SDK RSA/claim verification. Replace only Google's outbound transport.
const mock = mockGoogleClient({
    clientId: process.env.GOOGLE_OAUTH_CLIENT_ID,
    clientSecret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    redirectUri: `${process.env.PLATFORM_PUBLIC_BASE_URL}/api/auth/google/callback`
});
for (const method of ['getToken', 'getFederatedSignonCertsAsync']) {
    const original = OAuth2Client.prototype[method];
    OAuth2Client.prototype[method] = function (...args) {
        this.transporter.request = mock.client.transporter.request;
        return original.apply(this, args);
    };
}

// The browser navigates on the Google origin, but obtains a synthetic one-use
// code here. No tokens or secrets are returned to the browser.
const issuer = http.createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/issue') {
        response.writeHead(404).end();
        return;
    }
    try {
        const chunks = [];
        let size = 0;
        for await (const chunk of request) {
            size += chunk.length;
            if (size > 8192) throw new Error('Oversized test request');
            chunks.push(chunk);
        }
        const { nonce, challenge, claims } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const { code } = mock.issueCode({ nonce, challenge, claims });
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ code }));
    } catch {
        response.writeHead(400).end();
    }
});
await new Promise((resolve, reject) => {
    issuer.once('error', reject);
    issuer.listen(3445, '127.0.0.1', resolve);
});
issuer.unref();
