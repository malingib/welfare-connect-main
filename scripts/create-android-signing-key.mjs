import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const androidDir = resolve('flt_app/android');
const keystorePath = resolve(androidDir, 'app/malanga-upload-key.jks');
const propertiesPath = resolve(androidDir, 'key.properties');

if (existsSync(keystorePath) || existsSync(propertiesPath)) {
  throw new Error('Signing key or key.properties already exists; refusing to overwrite.');
}

mkdirSync(dirname(keystorePath), { recursive: true });
const storePassword = randomBytes(32).toString('base64url');
const keyPassword = randomBytes(32).toString('base64url');
const result = spawnSync(
  'keytool',
  [
    '-genkeypair',
    '-noprompt',
    '-keystore', keystorePath,
    '-storetype', 'JKS',
    '-alias', 'malanga-welfare-upload',
    '-keyalg', 'RSA',
    '-keysize', '3072',
    '-validity', '10000',
    '-dname', 'CN=Malanga Welfare, OU=Android, O=Malanga Community Welfare Group, L=Malindi, ST=Kilifi, C=KE',
    '-storepass:env', 'MALANGA_KEYSTORE_PASSWORD',
    '-keypass:env', 'MALANGA_KEY_PASSWORD',
  ],
  {
    env: {
      ...process.env,
      MALANGA_KEYSTORE_PASSWORD: storePassword,
      MALANGA_KEY_PASSWORD: keyPassword,
    },
    stdio: 'ignore',
  },
);

if (result.error || result.status !== 0) {
  if (existsSync(keystorePath)) unlinkSync(keystorePath);
  throw new Error('keytool could not create the Android release signing key.');
}

const properties = [
  'storeFile=app/malanga-upload-key.jks',
  'keyAlias=malanga-welfare-upload',
  `storePassword=${storePassword}`,
  `keyPassword=${keyPassword}`,
  '',
].join('\n');

try {
  writeFileSync(propertiesPath, properties, { mode: 0o600, flag: 'wx' });
  chmodSync(keystorePath, 0o600);
} catch (error) {
  unlinkSync(keystorePath);
  if (existsSync(propertiesPath)) unlinkSync(propertiesPath);
  throw error;
}

console.log('Created the Android release key and private local Gradle properties.');
console.log('Both files are excluded from Git; back them up securely for future app updates.');
