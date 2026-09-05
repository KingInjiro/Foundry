import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { DEPLOYMENT_MODES, resolveDeploymentMode } from './src/platform/backend/config/deploymentMode.js';

export function validateFirebaseClientBuildConfig(env, mode) {
  if (mode !== 'production') return;
  const deploymentMode = resolveDeploymentMode(env, { requireExplicit: true });
  if (deploymentMode === DEPLOYMENT_MODES.SINGLE_HOST) return;
  const required = [
    'VITE_FIREBASE_API_KEY',
    'VITE_FIREBASE_AUTH_DOMAIN',
    'VITE_FIREBASE_PROJECT_ID',
    'VITE_FIREBASE_APP_ID'
  ];
  const missing = required.filter(key => typeof env[key] !== 'string' || env[key].trim() === '');
  if (missing.length) throw new Error(`Production Firebase client configuration is incomplete: ${missing.join(', ')}`);
  if (!/^[a-z0-9.-]+$/i.test(env.VITE_FIREBASE_AUTH_DOMAIN) || env.VITE_FIREBASE_AUTH_DOMAIN.includes('..')) {
    throw new Error('VITE_FIREBASE_AUTH_DOMAIN must be a valid hostname.');
  }
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(env.VITE_FIREBASE_PROJECT_ID)) {
    throw new Error('VITE_FIREBASE_PROJECT_ID must be a valid Firebase project ID.');
  }
}

export function createDeploymentProfile(env, mode) {
  if (mode !== 'production') return null;
  const deploymentMode = resolveDeploymentMode(env, { requireExplicit: true });
  const profile = {
    schemaVersion: 2,
    deploymentMode,
    authProvider: deploymentMode === DEPLOYMENT_MODES.CLOUD ? 'firebase' : 'local',
    storageProvider: deploymentMode === DEPLOYMENT_MODES.CLOUD ? 'r2' : 'local-disk'
  };
  if (deploymentMode === DEPLOYMENT_MODES.CLOUD) return {
    ...profile,
    firebaseProjectId: env.VITE_FIREBASE_PROJECT_ID,
    firebaseAuthDomain: env.VITE_FIREBASE_AUTH_DOMAIN
  };
  return profile;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  validateFirebaseClientBuildConfig(env, mode);
  const deploymentProfile = createDeploymentProfile(env, mode);
  const deploymentMode = deploymentProfile?.deploymentMode || resolveDeploymentMode(env);
  return {
  define: {
    __FOUNDRY_AUTH_PROVIDER__: JSON.stringify(deploymentMode === DEPLOYMENT_MODES.SINGLE_HOST ? 'local' : 'firebase')
  },
  server: {
    watch: {
      ignored: ['**/.local/**', '**/.e2e/**']
    },
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp'
    }
  },
  test: { exclude: ["e2e/**", "node_modules/**"] }, plugins: [
    tailwindcss(),
    react(),
    ...(deploymentProfile ? [{
      name: 'foundry-deployment-profile',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'deployment-profile.json', source: `${JSON.stringify(deploymentProfile, null, 2)}\n` });
      }
    }] : [])
  ],
  build: {
    // Keep browser assets physically separate from the executable backend.
    // Express serves only this directory in production.
    outDir: 'dist/client',
    rollupOptions: {
      // Monaco's local workers add a large module graph. Keep Rollup's file
      // scheduling bounded so the documented build works with Node's default
      // heap instead of requiring a machine-specific NODE_OPTIONS override.
      maxParallelFileOps: 32,
      input: {
        main: resolve(__dirname, 'index.html'),
        sandbox: resolve(__dirname, 'sandbox.html'),
        genericSandbox: resolve(__dirname, 'generic-sandbox.html')
      }
    }
  }
  };
});
