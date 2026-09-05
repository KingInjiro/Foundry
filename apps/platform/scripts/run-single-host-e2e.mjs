import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const platformRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(platformRoot, '..', '..');

function run(command, args, env = process.env, cwd = root) {
    const result = spawnSync(command, args, { cwd, env, stdio: 'inherit' });
    if (result.status !== 0) {
        const error = new Error(`${command} ${args.join(' ')} failed.`);
        error.exitCode = result.status || 1;
        throw error;
    }
}

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'foundry-single-host-e2e-'));
const testEnvironment = { ...process.env, SINGLE_HOST_E2E_ROOT: testRoot };
try {
    run('npm', ['run', 'build'], { ...process.env, FOUNDRY_DEPLOYMENT_MODE: 'single-host' });
    run(path.join(root, 'node_modules', '.bin', 'playwright'), ['test', '--config', 'playwright.single-host.config.js'], testEnvironment, platformRoot);
    run(process.execPath, ['scripts/verify-single-host-persistence.mjs'], testEnvironment, platformRoot);

    const profile = JSON.parse(fs.readFileSync(path.join(platformRoot, 'dist', 'client', 'deployment-profile.json'), 'utf8'));
    if (profile.deploymentMode !== 'single-host' || profile.authProvider !== 'local' || profile.storageProvider !== 'local-disk') {
        throw new Error('Single-host Chromium ran against the wrong client build profile.');
    }
} catch (error) {
    process.exitCode = error.exitCode || 1;
    console.error(error.message);
} finally {
    fs.rmSync(testRoot, { recursive: true, force: true });
}
