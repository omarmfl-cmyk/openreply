// Local validation only. Never load usable production credentials from .env files.
import { readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const env = {};
for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir', 'COMSPEC', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']) {
  if (process.env[key] !== undefined) env[key] = process.env[key];
}
for (const file of readdirSync('.').filter(name => /^\.env(?:\.|$)/.test(name))) {
  for (const match of readFileSync(file, 'utf8').matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)) env[match[1]] = '';
}
Object.assign(env, {
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/openreply_build',
  REDIS_URL: 'redis://127.0.0.1:1', NEXTAUTH_URL: 'http://127.0.0.1:3000',
  NEXTAUTH_SECRET: 'isolated-build-test-secret', ENCRYPTION_KEY: 'ab'.repeat(32),
  CRON_SECRET: 'isolated-build-cron', RESEND_API_KEY: 're_test',
  INSTAGRAM_APP_ID: 'test', INSTAGRAM_APP_SECRET: 'test', FACEBOOK_APP_SECRET: 'test', WEBHOOK_VERIFY_TOKEN: 'test',
  FACEBOOK_PAGE_APP_ID: '123', FACEBOOK_PAGE_APP_SECRET: 'facebook-test', FACEBOOK_PAGE_WEBHOOK_VERIFY_TOKEN: 'facebook-test',
  OPENREPLY_ENV: 'staging', FACEBOOK_AUTOMATION_ENABLED: 'true', NEXT_TELEMETRY_DISABLED: '1',
  NODE_ENV: 'production', CI: '1',
});
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  env, stdio: 'inherit', shell: process.platform === 'win32',
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
