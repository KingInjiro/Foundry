import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rulesPath = fileURLToPath(new URL('../../../firestore.rules', import.meta.url));
const firebaseConfigPath = fileURLToPath(new URL('../../../firebase.json', import.meta.url));
const clientConfigPath = fileURLToPath(new URL('../../../firebase-applet-config.json', import.meta.url));

describe('Firestore editor project rules', () => {
    it('does not expose editor projects publicly and enforces immutable ownership', async () => {
        const rules = await readFile(rulesPath, 'utf8');

        expect(rules).not.toMatch(/allow\s+read\s*,\s*write\s*:\s*if\s+true/);
        expect(rules).toContain('resource.data.ownerUid == request.auth.uid');
        expect(rules).toContain('request.resource.data.ownerUid == request.auth.uid');
        expect(rules).toContain('request.resource.data.ownerUid == resource.data.ownerUid');
        expect(rules).toContain('allow list: if false');
    });

    it('deploys the exact rules file tested by this suite to the configured database', async () => {
        const deployment = JSON.parse(await readFile(firebaseConfigPath, 'utf8'));
        const client = JSON.parse(await readFile(clientConfigPath, 'utf8'));
        const target = deployment.firestore.find(item => item.database === client.firestoreDatabaseId);
        expect(target).toMatchObject({ rules: 'firestore.rules', indexes: 'firestore.indexes.json' });
        expect(fileURLToPath(new URL(`../../../${target.rules}`, import.meta.url))).toBe(rulesPath);
    });
});
