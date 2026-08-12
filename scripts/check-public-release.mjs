import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const IGNORED_DIRECTORIES = new Set([
  '.git', '.runtime', '.venv', '.worktrees', 'dist', 'jobs', 'node_modules', 'playwright-report', 'test-results', '__pycache__',
]);
const TEXT_EXTENSIONS = new Set([
  '', '.css', '.html', '.js', '.json', '.md', '.mjs', '.ps1', '.py', '.txt', '.xml', '.yaml', '.yml',
]);
const RETIRED_MARKERS = [
  ['edu', 'botics'].join(''),
  ['lx', '-16a'].join(''),
  ['pack', '-and-go'].join(''),
  ['pack', ' and go'].join(''),
];
const FORBIDDEN_EXTENSIONS = new Set([
  ['.sld', 'asm'].join(''),
  ['.sld', 'prt'].join(''),
  '.zip',
]);
const ALLOWED_STEP_FILES = new Set([
  'public/examples/two_joint_servo_arm_ap242.step',
  'third_party/adafruit_sg51r/2201_submicro_servo_sg51r.step',
]);
const MAX_FILE_BYTES = 25 * 1024 * 1024;

function walk(root, directory = root) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (IGNORED_DIRECTORIES.has(entry.name)) return [];
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return [{ absolute, symbolicLink: true }];
    return entry.isDirectory() ? walk(root, absolute) : [{ absolute, symbolicLink: false }];
  });
}

function relative(root, file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

function secretPatterns() {
  return [
    new RegExp(['github', '_pat_', '[A-Za-z0-9_]{20,}'].join(''), 'i'),
    new RegExp(['ghp', '_', '[A-Za-z0-9]{20,}'].join(''), 'i'),
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\bAKIA[A-Z0-9]{16}\b/,
    /\bsk-[A-Za-z0-9_-]{20,}\b/,
  ];
}

export function scanReleaseTree(inputRoot) {
  const root = path.resolve(inputRoot);
  const issues = [];
  let bytes = 0;
  let fileCount = 0;

  for (const entry of walk(root)) {
    const name = relative(root, entry.absolute);
    const lowerName = name.toLowerCase();
    fileCount += 1;
    if (entry.symbolicLink) {
      issues.push({ code: 'SYMLINK_NOT_ALLOWED', path: name, message: 'Public snapshot must not contain symbolic links.' });
      continue;
    }
    const stat = fs.statSync(entry.absolute);
    bytes += stat.size;
    const extension = path.extname(lowerName);

    if (FORBIDDEN_EXTENSIONS.has(extension)) {
      issues.push({ code: 'FORBIDDEN_FILE_TYPE', path: name, message: `Retired or archive file type: ${extension}` });
    }
    if (['.step', '.stp'].includes(extension) && !ALLOWED_STEP_FILES.has(lowerName)) {
      issues.push({ code: 'UNAPPROVED_STEP', path: name, message: 'STEP file is not on the public release allowlist.' });
    }
    if (stat.size > MAX_FILE_BYTES) {
      issues.push({ code: 'LARGE_FILE', path: name, message: `File is ${(stat.size / 1024 / 1024).toFixed(1)} MiB.` });
    }
    if (RETIRED_MARKERS.some(marker => lowerName.includes(marker))) {
      issues.push({ code: 'PRIVATE_OR_RETIRED_NAME', path: name, message: 'Filename contains a private-product or retired-workflow marker.' });
    }

    if (!TEXT_EXTENSIONS.has(extension) || stat.size > 5 * 1024 * 1024) continue;
    const content = fs.readFileSync(entry.absolute, 'utf8');
    const lowerContent = content.toLowerCase();
    if (RETIRED_MARKERS.some(marker => lowerContent.includes(marker))) {
      issues.push({ code: 'PRIVATE_OR_RETIRED_CONTENT', path: name, message: 'Text contains a private-product or retired-workflow marker.' });
    }
    if (/(?:^|["'`\s])(?:[A-Za-z]:[\\/](?:Users|Documents and Settings)[\\/]|[\\/](?:home|Users)[\\/][^/\\\s]+)/im.test(content)) {
      issues.push({ code: 'LOCAL_ABSOLUTE_PATH', path: name, message: 'Text contains a user-specific absolute path.' });
    }
    if (secretPatterns().some(pattern => pattern.test(content))) {
      issues.push({ code: 'POSSIBLE_SECRET', path: name, message: 'Text resembles a credential or private key.' });
    }
  }

  return { root, fileCount, bytes, issues };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const report = scanReleaseTree(process.argv[2] || process.cwd());
  if (report.issues.length) {
    console.error(JSON.stringify(report, null, 2));
    process.exitCode = 1;
  } else {
    console.log(`Public release check passed: ${report.fileCount} files, ${(report.bytes / 1024 / 1024).toFixed(2)} MiB.`);
  }
}
