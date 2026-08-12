import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { defaultJobsRoot } from '../server/job-paths.mjs';

describe('default STEP job path', () => {
  it('keeps generated CAD artifacts outside the Vite workspace', () => {
    const projectRoot = path.resolve('D:/workspace/windows-step-to-urdf');
    const tempRoot = path.resolve('D:/runner-temp');
    const jobsRoot = defaultJobsRoot(projectRoot, tempRoot);
    expect(path.relative(projectRoot, jobsRoot).startsWith('..')).toBe(true);
    expect(path.relative(tempRoot, jobsRoot).startsWith('..')).toBe(false);
    expect(path.basename(jobsRoot)).toMatch(/^windows-step-to-urdf-[0-9a-f]{12}$/);
  });

  it('uses the Windows temporary directory by default', () => {
    expect(defaultJobsRoot(process.cwd())).toContain(os.tmpdir());
  });
});
