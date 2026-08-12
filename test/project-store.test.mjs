import { describe, expect, it } from 'vitest';

import { clearSavedProjects, loadProjectCheckpoint, loadProjectSnapshot, saveProjectCheckpoint, saveProjectSnapshot } from '../src/project-store.mjs';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

describe('project autosave and crash recovery', () => {
  it('clears only STEP-to-URDF workspace keys for a new project', () => {
    const storage = new MemoryStorage();
    storage.setItem('step-urdf:last-step-job', '{}');
    storage.setItem('step-urdf-project:abcdef', '{}');
    storage.setItem('unrelated-preference', 'keep');
    expect(clearSavedProjects(storage)).toBe(2);
    expect(storage.getItem('unrelated-preference')).toBe('keep');
  });
  it('round-trips a versioned model only for the same STEP hash', () => {
    const storage = new MemoryStorage();
    const model = { schema: 'step-servo-urdf/robot-model/v1', jobId: 'job-1', rigidGroups: [], joints: [] };
    saveProjectSnapshot(storage, 'abc123', model);
    expect(loadProjectSnapshot(storage, 'abc123')).toEqual(model);
    expect(loadProjectSnapshot(storage, 'different')).toBeNull();
  });

  it('ignores malformed, unknown-version and mismatched-source snapshots', () => {
    const storage = new MemoryStorage();
    storage.setItem('step-urdf-project:bad', '{broken');
    expect(loadProjectSnapshot(storage, 'bad')).toBeNull();
    storage.setItem('step-urdf-project:v1', JSON.stringify({ version: 99, sourceSha256: 'v1', model: {} }));
    expect(loadProjectSnapshot(storage, 'v1')).toBeNull();
  });

  it('stores workflow and mode in schema v2 while preserving the v1 model API', () => {
    const storage = new MemoryStorage();
    const model = { schema: 'step-servo-urdf/robot-model/v1', jobId: 'job-2', rigidGroups: [], joints: [] };
    const payload = saveProjectCheckpoint(storage, 'feed12', { model, workflow: { currentStage: 'REVIEW' }, mode: 'advanced' });
    expect(payload.schemaVersion).toBe(2);
    expect(loadProjectCheckpoint(storage, 'feed12')).toMatchObject({ model, workflow: { currentStage: 'REVIEW' }, mode: 'advanced' });
    expect(loadProjectSnapshot(storage, 'feed12')).toEqual(model);
  });

  it('migrates legacy version 1 payloads without losing the RobotModel', () => {
    const storage = new MemoryStorage();
    const model = { schema: 'step-servo-urdf/robot-model/v1', jobId: 'legacy', rigidGroups: [], joints: [] };
    storage.setItem('step-urdf-project:abc999', JSON.stringify({ version: 1, sourceSha256: 'abc999', savedAt: '2026-01-01T00:00:00Z', model }));
    expect(loadProjectCheckpoint(storage, 'abc999')).toMatchObject({ schemaVersion: 2, migratedFrom: 1, model });
  });
});
