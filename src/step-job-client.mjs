export const MAX_STEP_UPLOAD_BYTES = 512 * 1024 * 1024;

export function validateStepFile(file) {
  if (!file) return { ok: false, error: '请选择 STEP 装配体文件' };
  if (!/\.(step|stp)$/i.test(String(file.name || ''))) return { ok: false, error: '只接受 .step 或 .stp 文件' };
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: 'STEP 文件为空' };
  if (file.size > MAX_STEP_UPLOAD_BYTES) return { ok: false, error: 'STEP 文件超过 512 MB 上传限制' };
  return { ok: true };
}

async function responseJson(response) {
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || value.message || `HTTP ${response.status}`);
  return value;
}

export async function createStepJob(file, fetchImpl = fetch) {
  const validation = validateStepFile(file);
  if (!validation.ok) throw new Error(validation.error);
  return responseJson(await fetchImpl('/api/step-jobs', { method: 'POST', headers: { 'x-step-filename': encodeURIComponent(file.name) }, body: file }));
}

export async function fetchStepJobStatus(jobId, fetchImpl = fetch) {
  return responseJson(await fetchImpl(`/api/step-jobs/${encodeURIComponent(jobId)}/status`));
}

export async function requestStepExport(jobId, payload, fetchImpl = fetch) {
  return responseJson(await fetchImpl(`/api/step-jobs/${encodeURIComponent(jobId)}/export`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
  }));
}
