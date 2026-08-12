const SNAPSHOT_VERSION = 2;
const prefix = 'step-urdf-project:';
const lastJobKey = 'step-urdf:last-step-job';

export function clearSavedProjects(storage) {
  const keys = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key === lastJobKey || key?.startsWith(prefix)) keys.push(key);
  }
  keys.forEach(key => storage.removeItem(key));
  return keys.length;
}

export function projectStorageKey(sourceSha256) {
  if (!/^[a-f0-9]{6,128}$/i.test(String(sourceSha256 || ''))) throw new Error('A valid STEP source hash is required');
  return `${prefix}${String(sourceSha256).toLowerCase()}`;
}

export function saveProjectCheckpoint(storage, sourceSha256, { model, workflow = null, mode = 'novice', notifications = [], metadata = {} }) {
  const payload = {
    version: SNAPSHOT_VERSION, schemaVersion: SNAPSHOT_VERSION,
    sourceSha256: String(sourceSha256).toLowerCase(),
    savedAt: new Date().toISOString(),
    model: structuredClone(model),
    workflow: structuredClone(workflow), mode, notifications: structuredClone(notifications.slice(0, 20)), metadata: structuredClone(metadata),
  };
  storage.setItem(projectStorageKey(sourceSha256), JSON.stringify(payload));
  return payload;
}

export function saveProjectSnapshot(storage, sourceSha256, model) {
  return saveProjectCheckpoint(storage, sourceSha256, { model });
}

export function loadProjectCheckpoint(storage, sourceSha256) {
  let key;
  try { key = projectStorageKey(sourceSha256); } catch { return null; }
  try {
    const payload = JSON.parse(storage.getItem(key));
    if (![1, SNAPSHOT_VERSION].includes(payload?.version) || payload?.sourceSha256 !== String(sourceSha256).toLowerCase()) return null;
    if (payload?.model?.schema !== 'step-servo-urdf/robot-model/v1') return null;
    if (payload.version === 1) return { ...structuredClone(payload), version: SNAPSHOT_VERSION, schemaVersion: SNAPSHOT_VERSION, migratedFrom: 1, workflow: null, mode: 'novice', notifications: [], metadata: {} };
    return structuredClone(payload);
  } catch {
    return null;
  }
}

export function loadProjectSnapshot(storage, sourceSha256) {
  return loadProjectCheckpoint(storage, sourceSha256)?.model || null;
}
