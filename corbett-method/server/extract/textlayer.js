// Fallback when AI analysis is not configured: harvest dimension labels and notes from the
// PDF text layer. It cannot tell which component a label belongs to, so everything is
// proposed as notes for the person to map in review. Nothing is guessed.

const FT_IN = /(\d{1,3})\s*['’]\s*(\d{1,2}(?:\.\d+)?)\s*(?:"|”|'')/g;            // 7'9.5"  24'4"
const PAIR = /(\d{1,3}(?:\.\d+)?)\s*['’]?\s*[xX×]\s*(\d{1,3}(?:\.\d+)?)\s*['’]/g;  // 8'x13'
const FEET = /(?<![\dx×.])(\d{1,3}(?:\.\d+)?)\s*['’](?!\s*\d+(?:\.\d+)?\s*(?:"|”|''))/g;                  // 7.5'  12'
const INCH = /\((\d{1,3}(?:\.\d+)?)\s*(?:"|”)\)/g;                                // (27.5")
const QTY = /\((\d{1,3})\)\s*(\d{1,2}\s*[xX×]\s*\d{1,2})/g;                       // (5) 2x6

export function parseTextLayer(text) {
  const t = String(text || '').slice(0, 400000);
  const lines = t.split(/\r?\n/);
  const dims = [], notes = [], exclusions = [];
  let idx = 0;
  for (const raw of lines) {
    const line = raw.replace(/[’‘′]/g, "'").replace(/[“”″]/g, '"').replace(/\s+/g, ' ').trim();
    if (!line) continue;
    const taken = [];
    const mark = (m) => taken.push([m.index, m.index + m[0].length]);
    const free = (m) => !taken.some(([a, b]) => m.index < b && m.index + m[0].length > a);
    for (const m of line.matchAll(PAIR)) { mark(m); dims.push({ index: idx++, text: m[0].replace(/\s+/g, ''), valueFt: Number(m[1]), secondFt: Number(m[2]), line }); }
    for (const m of line.matchAll(FT_IN)) if (free(m)) { mark(m); dims.push({ index: idx++, text: m[0].replace(/\s+/g, ''), valueFt: Number(m[1]) + Number(m[2]) / 12, line }); }
    for (const m of line.matchAll(FEET)) if (free(m)) { mark(m); dims.push({ index: idx++, text: m[0].replace(/\s+/g, ''), valueFt: Number(m[1]), line }); }
    for (const m of line.matchAll(INCH)) dims.push({ index: idx++, text: m[0], valueFt: Number(m[1]) / 12, line });
    for (const m of line.matchAll(QTY)) notes.push(`Quantity note: ${m[0]}`);
    if (/\bno\s+(irrigation|lighting)/i.test(line)) exclusions.push(line);
    const words = line.replace(/[\d'".x×()]+/g, ' ').trim().split(/\s+/).filter(w => /[a-z]{2,}/i.test(w));
    if (words.length >= 3) notes.push(line);
  }
  return {
    projectName: null, revision: null, drawingDate: null, pageRotationNote: null,
    components: [], exclusions: [...new Set(exclusions)], alternatives: [],
    notes: [...new Set(notes)].slice(0, 100),
    dimensionCandidates: dims.slice(0, 300),
    uncertainties: [],
  };
}
