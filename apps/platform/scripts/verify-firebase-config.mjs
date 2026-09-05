import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const deploymentConfig = JSON.parse(fs.readFileSync(path.join(platformRoot, 'firebase.json'), 'utf8'));
const clientConfig = JSON.parse(fs.readFileSync(path.join(platformRoot, 'firebase-applet-config.json'), 'utf8'));
const firestoreTargets = Array.isArray(deploymentConfig.firestore)
    ? deploymentConfig.firestore
    : [deploymentConfig.firestore].filter(Boolean);
const target = firestoreTargets.find(item => item.database === clientConfig.firestoreDatabaseId);
if (!target) throw new Error('firebase.json does not map the configured Firestore database ID.');
if (target.rules !== 'firestore.rules') throw new Error('firebase.json must deploy the tested firestore.rules file.');
if (target.indexes !== 'firestore.indexes.json') throw new Error('firebase.json must map the checked-in Firestore indexes file.');

const rulesPath = path.resolve(platformRoot, target.rules);
const indexesPath = path.resolve(platformRoot, target.indexes);
if (!rulesPath.startsWith(`${platformRoot}${path.sep}`) || !fs.existsSync(rulesPath)) throw new Error('Mapped Firestore rules file is missing or unsafe.');
if (!indexesPath.startsWith(`${platformRoot}${path.sep}`) || !fs.existsSync(indexesPath)) throw new Error('Mapped Firestore indexes file is missing or unsafe.');
const rules = fs.readFileSync(rulesPath, 'utf8');
if (/allow\s+read\s*,\s*write\s*:\s*if\s+true/i.test(rules)) throw new Error('Firestore rules contain an unconditional read/write grant.');
for (const required of ['request.auth != null', 'request.auth.uid', 'allow list: if false']) {
    if (!rules.includes(required)) throw new Error(`Firestore rules are missing required ownership boundary: ${required}`);
}
if (process.env.FIREBASE_PROJECT_ID && process.env.VITE_FIREBASE_PROJECT_ID
    && process.env.FIREBASE_PROJECT_ID !== process.env.VITE_FIREBASE_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_ID and VITE_FIREBASE_PROJECT_ID do not match.');
}
if (process.env.FIRESTORE_DATABASE_ID && process.env.FIRESTORE_DATABASE_ID !== target.database) {
    throw new Error('FIRESTORE_DATABASE_ID does not match the database mapped by firebase.json.');
}

console.log(JSON.stringify({
    status: 'PASS',
    database: target.database,
    rules: path.relative(platformRoot, rulesPath),
    indexes: path.relative(platformRoot, indexesPath),
    liveDeployment: 'NOT VERIFIED'
}, null, 2));
