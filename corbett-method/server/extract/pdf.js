// PDF helpers using poppler-utils (pdfinfo, pdftoppm, pdftotext) via execFile — no shell,
// fixed argument lists, timeouts. Uploaded files are data only and are never executed.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

function run(cmd, args, { timeout = 60000, maxBuffer = 32 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, maxBuffer, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        if (err.code === 'ENOENT') { const e = new Error(`${cmd} is not installed on this server (install poppler-utils).`); e.code = 'NO_POPPLER'; return reject(e); }
        const e = new Error(`${cmd} failed: ${String(stderr || err.message).slice(0, 300)}`); return reject(e);
      }
      resolve(stdout);
    });
  });
}

export const isPdf = (mime) => mime === 'application/pdf';
export const isImage = (mime) => mime === 'image/png' || mime === 'image/jpeg';

/** Sniff the real type from magic bytes (never trust the client's Content-Type alone). */
export function sniffMime(buf) {
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (buf.length >= 8 && buf[0] === 0x89 && buf.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

/** {pages, rotation[], pageSizes[]} — rotation from pdfinfo per page. */
export async function pdfInfo(path) {
  const out = await run('pdfinfo', ['-l', '200', path], { timeout: 20000 });
  const pages = Number((/^Pages:\s+(\d+)/m.exec(out) || [])[1] || 0);
  const rotation = [], sizes = [];
  for (const m of out.matchAll(/^Page\s+(\d+)\s+rot:\s+(\d+)/gm)) rotation[Number(m[1]) - 1] = Number(m[2]);
  for (const m of out.matchAll(/^Page\s+(\d+)\s+size:\s+([\d.]+) x ([\d.]+)/gm)) sizes[Number(m[1]) - 1] = [Number(m[2]), Number(m[3])];
  const single = /^Page rot:\s+(\d+)/m.exec(out);
  if (single && !rotation.length) rotation[0] = Number(single[1]);
  const singleSize = /^Page size:\s+([\d.]+) x ([\d.]+)/m.exec(out);
  if (singleSize && !sizes.length) sizes[0] = [Number(singleSize[1]), Number(singleSize[2])];
  return { pages, rotation, sizes };
}

/** Render one page to PNG (cached). Returns the PNG path. */
export async function renderPage(path, sha, page, cacheDir, dpi = 110) {
  mkdirSync(cacheDir, { recursive: true });
  const out = join(cacheDir, `${sha}-p${page}-${dpi}.png`);
  if (existsSync(out)) return out;
  const prefix = join(cacheDir, `${sha}-p${page}-${dpi}-tmp-${process.pid}-${Date.now()}`);
  await run('pdftoppm', ['-f', String(page), '-l', String(page), '-r', String(dpi), '-png', '-singlefile', path, prefix], { timeout: 90000 });
  renameSync(`${prefix}.png`, out);
  return out;
}

export async function pdfText(path) {
  return run('pdftotext', ['-layout', '-enc', 'UTF-8', path, '-'], { timeout: 30000 });
}

export function readBase64(path) { return readFileSync(path).toString('base64'); }
