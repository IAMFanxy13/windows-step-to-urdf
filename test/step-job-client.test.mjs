import { describe, expect, it, vi } from 'vitest';

import { createStepJob, validateStepFile } from '../src/step-job-client.mjs';

describe('STEP job client', () => {
  it('accepts STEP/STP case-insensitively without product-name assumptions', () => {
    expect(validateStepFile({ name: 'arbitrary-robot.AP242.STEP', size: 12 })).toEqual({ ok: true });
    expect(validateStepFile({ name: 'mechanism.StP', size: 12 })).toEqual({ ok: true });
  });

  it('rejects empty, wrong-extension and oversized inputs', () => {
    expect(validateStepFile({ name: 'robot.zip', size: 12 }).ok).toBe(false);
    expect(validateStepFile({ name: 'robot.step', size: 0 }).ok).toBe(false);
    expect(validateStepFile({ name: 'robot.step', size: 513 * 1024 * 1024 }).ok).toBe(false);
  });

  it('uses the generic STEP endpoint and preserves the UTF-8 display filename', async () => {
    const file = { name: '机器人总装.AP242.step', size: 12 };
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ jobId: 'abc' }),
    }));
    await createStepJob(file, fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('/api/step-jobs', expect.objectContaining({
      method: 'POST',
      headers: { 'x-step-filename': encodeURIComponent(file.name) },
      body: file,
    }));
  });
});
