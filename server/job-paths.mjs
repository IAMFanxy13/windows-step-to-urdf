import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export function defaultJobsRoot(projectRoot, tempRoot = os.tmpdir()) {
  const identity = crypto.createHash('sha256').update(path.resolve(projectRoot)).digest('hex').slice(0, 12);
  return path.join(path.resolve(tempRoot), `windows-step-to-urdf-${identity}`);
}
