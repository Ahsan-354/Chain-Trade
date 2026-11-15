import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = new URL('../.env', import.meta.url);
if (existsSync(env)) {
  console.log(
    '.env already exists. Keep its wallet encryption key for the lifetime of the database.',
  );
} else {
  const template = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  const config = template
    .replace('JWT_SECRET=', 'JWT_SECRET=' + randomBytes(48).toString('hex'))
    .replace('WALLET_ENCRYPTION_KEY=', 'WALLET_ENCRYPTION_KEY=' + randomBytes(32).toString('hex'));
  writeFileSync(env, config, { flag: 'wx', mode: 0o600 });
  console.log('Created local .env with generated secrets.');
}
