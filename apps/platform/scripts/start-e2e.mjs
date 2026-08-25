process.env.PORT = '3001';
process.env.E2E_MODE = 'true';
process.env.NODE_ENV = 'test';

await import('../server.js');
