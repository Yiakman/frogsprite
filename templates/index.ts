#!/usr/bin/env node
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);

const entries = readdirSync(DIR, { recursive: true });
const scripts = entries
  .filter((f): f is string => typeof f === 'string')
  .map(f => join(DIR, f))
  .filter(p => (p.endsWith('.mjs') || p.endsWith('.ts') || p.endsWith('.js')) && p !== SELF && !p.endsWith('/index.ts') && !p.endsWith('/mod.ts'))
  .sort();

for (const script of scripts) {
  const rel = relative(process.cwd(), script);
  console.log(`[build:templates] ${rel}`);
  const res = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (res.status !== 0) {
    process.exit(res.status ?? 1);
  }
}
