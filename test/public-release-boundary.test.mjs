import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(target) : [target];
  }).filter(file => /\.(?:html|js|mjs|py|ps1|json)$/i.test(file));
}

function stepFiles(directory) {
  const ignored = new Set(['.git', '.runtime', '.venv', '.worktrees', 'dist', 'jobs', 'node_modules']);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isDirectory() && ignored.has(entry.name)) return [];
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return stepFiles(target);
    return /\.(?:step|stp)$/i.test(entry.name) ? [target] : [];
  });
}

describe('public release boundary', () => {
  it('ships a STEP-only runtime with no obsolete product entry points', () => {
    const runtime = [
      'index.html',
      'src/main.js',
      'src/styles.css',
      'scripts/start_windows.ps1',
      'server/step-job-api.mjs',
    ].map(read).join('\n').toLowerCase();

    for (const forbidden of [
      ['edu', 'botics'].join(''),
      ['lx', '-16a'].join(''),
      ['pack', '-and-go'].join(''),
      ['pack', ' and go'].join(''),
      ['sld', 'asm'].join(''),
      ['sld', 'prt'].join(''),
      'legacy/runtime',
      '/robot/',
    ]) {
      expect(runtime, `runtime contains obsolete token: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('contains only the generated example and the pinned licensed servo source', () => {
    const publicRoot = path.join(root, 'public');
    const permitted = [
      'public/examples/two_joint_servo_arm_ap242.step',
      'third_party/adafruit_sg51r/2201_Submicro_Servo_SG51R.step',
    ];
    const discovered = stepFiles(root)
      .map(file => path.relative(root, file).replaceAll('\\', '/'))
      .sort();

    expect(discovered).toEqual(permitted);
    expect(fs.existsSync(path.join(publicRoot, 'robot'))).toBe(false);

    const pinnedServo = path.join(root, permitted[1]);
    expect(fs.existsSync(pinnedServo)).toBe(true);
    if (fs.existsSync(pinnedServo)) {
      const checksum = crypto.createHash('sha256').update(fs.readFileSync(pinnedServo)).digest('hex');
      expect(checksum).toBe('66fa3c9570de91e698b0077e20adc652eaf3e21f98db499cfc4980c35e740013');
    }
  });

  it('contains no private-product or retired-CAD implementation in production sources', () => {
    const production = [
      path.join(root, 'index.html'),
      ...sourceFiles(path.join(root, 'src')),
      ...sourceFiles(path.join(root, 'server')),
      ...sourceFiles(path.join(root, 'scripts')),
    ].map(file => fs.readFileSync(file, 'utf8').toLowerCase()).join('\n');

    for (const forbidden of [
      ['edu', 'botics'].join(''), ['lx', '-16a'].join(''),
      ['pack', ' and go'].join(''), ['pack', '-and-go'].join(''),
      ['sld', 'asm'].join(''), ['sld', 'prt'].join(''),
    ]) {
      expect(production, `production sources contain retired token: ${forbidden}`).not.toContain(forbidden);
    }
  });
});
