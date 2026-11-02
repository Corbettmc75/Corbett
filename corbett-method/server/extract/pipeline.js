// In-process analysis queue: reading file → rendering pages → analyzing drawing → checking dimensions → done.
// Results are stored as a *proposal*; nothing touches the job until a person applies it in review.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pdfInfo, renderPage, pdfText, isPdf } from './pdf.js';
import { analyzeWithClaude, AnalysisError, redact } from './anthropic.js';
import { parseTextLayer } from './textlayer.js';
import { normalizeTakeoff } from './normalize.js';

const MAX_PDF_BYTES = 30 * 1024 * 1024;

export class AnalysisQueue {
  constructor(store, { fetchImpl, log = () => {} } = {}) {
    this.store = store; this.fetchImpl = fetchImpl; this.log = log;
    this.queue = []; this.running = false; this.idleWaiters = [];
  }
  enqueue(extractionId) { this.queue.push(extractionId); this._pump(); }
  /** Resolves when the queue is empty (tests). */
  idle() { return this.running || this.queue.length ? new Promise(r => this.idleWaiters.push(r)) : Promise.resolve(); }

  async _pump() {
    if (this.running) return;
    this.running = true;
    while (this.queue.length) {
      const id = this.queue.shift();
      try { await this._run(id); }
      catch (e) {
        const msg = redact(e instanceof AnalysisError ? e.message : `Analysis failed unexpectedly: ${e.message}`);
        this.store.updateExtraction(id, { status: 'error', stage: 'failed', error: msg });
        this.log(`analysis ${id} failed: ${msg}`);
      }
    }
    this.running = false;
    for (const r of this.idleWaiters.splice(0)) r();
  }

  async _run(id) {
    const st = this.store;
    const ex = st.getExtraction(id);
    const file = st.getFile(ex.fileId);
    if (!file) throw new AnalysisError('The uploaded file is missing on the server. Upload it again.');
    const set = (stage, progress) => st.updateExtraction(id, { status: 'running', stage, progress });

    set('reading file', 5);
    let pages = 1, rotation = [];
    if (isPdf(file.mime)) {
      try { ({ pages, rotation } = await pdfInfo(file.path)); }
      catch (e) { if (e.code !== 'NO_POPPLER') throw new AnalysisError(`This PDF could not be read (${e.message.slice(0, 120)}). Re-export it and upload again.`); pages = file.pages || 1; }
      if (pages === 0) throw new AnalysisError('PDF has 0 pages. Re-export the drawing and upload again.');
    }

    set('rendering pages', 20);
    if (isPdf(file.mime)) {
      try { await renderPage(file.path, file.sha256, 1, join(st.dataDir, 'pages')); } catch { /* preview only; analysis can continue */ }
    }

    set('analyzing drawing', 35);
    const hasKey = !!process.env.ANTHROPIC_API_KEY;
    let raw, meta;
    if (hasKey) {
      const input = { fileName: file.name, pageCount: pages };
      if (isPdf(file.mime)) {
        if (file.size > MAX_PDF_BYTES) throw new AnalysisError('This PDF is larger than 30 MB. Export a smaller PDF or upload pages as images.');
        input.pdfBase64 = readFileSync(file.path).toString('base64');
      } else input.images = [{ mime: file.mime, base64: readFileSync(file.path).toString('base64') }];
      const out = await analyzeWithClaude(input, { fetchImpl: this.fetchImpl });
      raw = out.data;
      meta = { source: 'ai', model: out.model, message: rotation.some(r => r) ? `PDF page rotation detected (${rotation.join(', ')}°); labels were read in all orientations.` : null };
      st.updateExtraction(id, { model: out.model });
    } else if (isPdf(file.mime)) {
      let text = '';
      try { text = await pdfText(file.path); } catch (e) { if (e.code !== 'NO_POPPLER') throw e; }
      raw = parseTextLayer(text);
      meta = { source: 'text-layer', message: 'AI not configured — labels found in text layer only; map them in review. (Set ANTHROPIC_API_KEY on the server to enable drawing analysis.)' };
    } else {
      throw new AnalysisError('Analysis is not configured on this server: set ANTHROPIC_API_KEY in the server environment. Image drawings cannot be read without it.');
    }

    set('checking dimensions', 85);
    const proposal = normalizeTakeoff(raw, { ...meta, extractionId: id, fileName: file.name });
    st.updateExtraction(id, { status: 'done', stage: 'done', progress: 100, raw, proposal, error: null });
  }
}
