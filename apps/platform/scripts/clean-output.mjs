import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.rmSync(path.join(platformRoot, 'dist'), { recursive: true, force: true });
