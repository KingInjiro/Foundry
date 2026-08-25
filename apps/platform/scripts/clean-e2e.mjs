import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const directory of ['.e2e', 'test-results', 'playwright-report']) {
    fs.rmSync(path.join(platformRoot, directory), { recursive: true, force: true });
}
