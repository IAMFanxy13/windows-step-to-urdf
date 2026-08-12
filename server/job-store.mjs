import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidJobId(value) {
  return typeof value === 'string' && JOB_ID.test(value);
}

export class JobStore {
  constructor(root, { maxUploadBytes = 512 * 1024 * 1024 } = {}) {
    this.root = path.resolve(root);
    this.maxUploadBytes = maxUploadBytes;
    fs.mkdirSync(this.root, { recursive: true });
  }

  jobDirectory(id) {
    if (!isValidJobId(id)) throw new Error('Invalid job id');
    return path.join(this.root, id);
  }

  writeStatus(id, status) {
    const target = path.join(this.jobDirectory(id), 'status.json');
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
    fs.renameSync(temporary, target);
  }

  readStatus(id) {
    const target = path.join(this.jobDirectory(id), 'status.json');
    if (!fs.existsSync(target)) throw new Error('Job not found');
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  }

  createSource(payload, filename, { extensions, sourceFilename, kind = 'file-import', message = '文件已接收，等待分析' }) {
    if (!Buffer.isBuffer(payload) || payload.length === 0) throw new Error('Upload is empty');
    if (payload.length > this.maxUploadBytes) throw new Error('Upload is too large');
    const lowerName = String(filename || '').toLowerCase();
    if (!Array.isArray(extensions) || !extensions.some(extension => lowerName.endsWith(extension.toLowerCase()))) {
      throw new Error(`Input must use one of: ${(extensions || []).join(', ')}`);
    }
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(sourceFilename || '')) throw new Error('Internal source filename must be ASCII and path-free');
    const id = crypto.randomUUID();
    const directory = this.jobDirectory(id);
    fs.mkdirSync(directory, { recursive: false });
    const source = path.join(directory, sourceFilename);
    fs.writeFileSync(source, payload, { flag: 'wx' });
    try { fs.chmodSync(source, 0o444); } catch { /* Windows ACLs may ignore POSIX mode. */ }
    this.writeStatus(id, { state: 'queued', kind, message, originalFilename: path.basename(filename), sourceFilename, uploadedBytes: payload.length });
    return { id, directory };
  }
}
