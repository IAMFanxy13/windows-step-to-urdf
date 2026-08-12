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

  it('contains only the generated public STEP example', () => {
    const publicRoot = path.join(root, 'public');
    const stepFiles = fs.readdirSync(path.join(publicRoot, 'examples'))
      .filter(name => /\.(step|stp)$/i.test(name));

    expect(stepFiles).toEqual(['two_joint_servo_arm_ap242.step']);
    expect(fs.existsSync(path.join(publicRoot, 'robot'))).toBe(false);
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
