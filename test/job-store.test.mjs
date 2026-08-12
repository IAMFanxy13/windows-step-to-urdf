import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { JobStore, isValidJobId } from '../server/job-store.mjs';

const temporary = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('JobStore', () => {
  it('creates STEP jobs using an ASCII internal filename', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'step-jobs-'));
    const store = new JobStore(root);
    const job = store.createSource(Buffer.from('ISO-10303-21;'), '机器人总装.AP242.STEP', {
      extensions: ['.step', '.stp'],
      sourceFilename: 'source.step',
      kind: 'step-import',
    });
    expect(fs.existsSync(path.join(job.directory, 'source.step'))).toBe(true);
    expect(store.readStatus(job.id)).toMatchObject({
      state: 'queued', kind: 'step-import', originalFilename: '机器人总装.AP242.STEP',
    });
  });

  it('creates isolated immutable STEP source jobs', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'step-urdf-jobs-'));
    temporary.push(root);
    const store = new JobStore(root);
    const job = store.createSource(Buffer.from('step bytes'), 'robot.step', {
      extensions: ['.step', '.stp'], sourceFilename: 'source.step', kind: 'step-import',
    });
    expect(isValidJobId(job.id)).toBe(true);
    expect(fs.readFileSync(path.join(job.directory, 'source.step'), 'utf8')).toBe('step bytes');
    expect(store.readStatus(job.id).state).toBe('queued');
    expect(() => store.jobDirectory('../outside')).toThrow(/invalid job id/i);
  });

  it('rejects empty and oversized uploads', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'step-urdf-jobs-'));
    temporary.push(root);
    const store = new JobStore(root, { maxUploadBytes: 4 });
    const create = (payload, filename) => store.createSource(payload, filename, {
      extensions: ['.step', '.stp'], sourceFilename: 'source.step', kind: 'step-import',
    });
    expect(() => create(Buffer.alloc(0), 'empty.step')).toThrow(/empty/i);
    expect(() => create(Buffer.alloc(5), 'large.step')).toThrow(/too large/i);
    expect(() => create(Buffer.from('1234'), 'robot.obj')).toThrow(/step|stp/i);
  });
});
