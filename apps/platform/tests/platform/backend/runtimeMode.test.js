import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertSafeRuntimeMode } from '../../../src/platform/backend/config/runtimeMode.js';

describe('runtime mode safety boundary', () => {
    it.each(['E2E_MODE', 'LOCAL_DEV_MODE', 'AUTH_DEV_BYPASS', 'SINGLE_HOST_TEST_MODE'])(
        'rejects %s in production',
        flag => {
            expect(() => assertSafeRuntimeMode({ NODE_ENV: 'production', [flag]: 'true' }))
                .toThrow(/Refusing to start/);
        }
    );

    it('rejects inline job execution in production', () => {
        expect(() => assertSafeRuntimeMode({ NODE_ENV: 'production', JOB_MODE: 'inline' }))
            .toThrow('JOB_MODE=inline cannot be enabled');
    });

    it('allows isolated E2E mode outside production', () => {
        expect(assertSafeRuntimeMode({ NODE_ENV: 'test', E2E_MODE: 'true' }))
            .toMatchObject({ production: false, e2eMode: true, localDevMode: false });
    });

    it('allows an isolated local-auth/local-storage test mode without auth bypass', () => {
        expect(assertSafeRuntimeMode({
            NODE_ENV: 'test',
            FOUNDRY_DEPLOYMENT_MODE: 'single-host',
            SINGLE_HOST_TEST_MODE: 'true'
        })).toMatchObject({
            production: false,
            e2eMode: false,
            localDevMode: false,
            singleHostTestMode: true
        });
        expect(() => assertSafeRuntimeMode({
            NODE_ENV: 'test',
            SINGLE_HOST_TEST_MODE: 'true',
            AUTH_DEV_BYPASS: 'true'
        })).toThrow('cannot be combined');
    });

    it('terminates the actual production server process before exposing E2E reset routes', async () => {
        const serverPath = fileURLToPath(new URL('../../../server.js', import.meta.url));
        const result = await new Promise(resolve => {
            const child = spawn(process.execPath, [serverPath], {
                env: { ...process.env, NODE_ENV: 'production', E2E_MODE: 'true', PORT: '0' },
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let output = '';
            child.stdout.on('data', chunk => { output += String(chunk); });
            child.stderr.on('data', chunk => { output += String(chunk); });
            child.once('close', code => resolve({ code, output }));
        });

        expect(result.code).not.toBe(0);
        expect(result.output).toContain('E2E_MODE cannot be enabled');
        expect(result.output).not.toContain('server_started');
    }, 15_000);
});
