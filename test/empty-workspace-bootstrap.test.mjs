import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const project = path.resolve(import.meta.dirname, '..');

describe('generic application bootstrap', () => {
  it('starts as an empty STEP workspace with no bundled robot', () => {
    const html = fs.readFileSync(path.join(project, 'index.html'), 'utf8');
    const main = fs.readFileSync(path.join(project, 'src', 'main.js'), 'utf8');

    expect(html).not.toContain('id="legacy-panel"');
    expect(html).toContain('导入前不会加载任何机器人模型');
    expect(main).toContain('initializeEmptyWorkspace();');
    expect(main).not.toMatch(/initializeManualV2/);
    expect(main).not.toMatch(/\bloadRobot\b/);
  });
});
