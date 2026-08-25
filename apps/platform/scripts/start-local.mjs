import path from 'node:path';
import { fileURLToPath } from 'node:url';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(platformRoot);
process.env.LOCAL_DEV_MODE = 'true';
process.env.VITE_LOCAL_DEV_AUTH = 'true';
process.env.NODE_ENV = 'development';
process.env.HOST ||= '127.0.0.1';

await import('../server.js');
