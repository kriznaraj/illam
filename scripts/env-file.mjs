// Tiny .env reader/writer shared by the setup scripts (no dependencies).
import fs from 'node:fs';

export function readEnv(path) {
  if (!fs.existsSync(path)) return {};
  const env = {};
  for (const line of fs.readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
      value = value.slice(1, -1);
    }
    env[m[1]] = value;
  }
  return env;
}

export function formatEnvValue(value) {
  return /^[A-Za-z0-9_./:@%+=,-]*$/.test(value) ? value : `'${value}'`;
}
