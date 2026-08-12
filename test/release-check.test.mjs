import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { scanReleaseTree } from '../scripts/check-public-release.mjs';

const temporary = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'step-urdf-release-check-'));
  temporary.push(root);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'safe.mjs'), 'export const safe = true;\n');
  return root;
}

describe('public release scanner', () => {
  it('accepts a small source-only tree', () => {
    expect(scanReleaseTree(fixture()).issues).toEqual([]);
  });

  it('ignores the Git pointer file used by linked worktrees', () => {
    const root = fixture();
    const gitDirectory = ['C:', 'Users', 'example', 'repository', '.git', 'worktrees', 'feature'].join('/');
    fs.writeFileSync(path.join(root, '.git'), `gitdir: ${gitDirectory}\n`);

    expect(scanReleaseTree(root).issues).toEqual([]);
  });

  it('blocks retired CAD files and local absolute paths', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, `private.${['sld', 'prt'].join('')}`), 'binary');
    const localPath = ['C:', 'Users', 'someone'].join('\\');
    fs.writeFileSync(path.join(root, 'src', 'path.mjs'), `export const path = '${localPath}';`);
    const codes = scanReleaseTree(root).issues.map(issue => issue.code);
    expect(codes).toContain('FORBIDDEN_FILE_TYPE');
    expect(codes).toContain('LOCAL_ABSOLUTE_PATH');
  });

  it('blocks common credential formats', () => {
    const root = fixture();
    fs.writeFileSync(path.join(root, 'src', 'credential.txt'), ['github', '_pat_', 'A'.repeat(40)].join(''));
    expect(scanReleaseTree(root).issues.map(issue => issue.code)).toContain('POSSIBLE_SECRET');
  });
});
