/**
 * Purpose: measures a PDF the way the layout checks need it (pdf.js from the unpdf dependency, no system tools):
 * every text run with its real font name, size, left edge and baseline, and every image with its box. Coordinates are
 * PDF points from the TOP-LEFT of the page. `top` is baseline - 0.75 * size (the convention the reference
 * measurements use; for Lexend it is about the cap-height top of the glyphs).
 * Used by test-render.mjs (--pdf). Run on its own: node scripts/pdf-measure.mjs file.pdf [page]
 */
import fs from "node:fs";
import { getDocumentProxy } from "unpdf";
import { OPS } from "unpdf/pdfjs";

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

/** [{ width, height, runs: [{ text, font, size, x, x1, baseline, top }], images: [{ x, y, w, h }] }] per page. */
export async function measurePdf(file) {
  const pdf = await getDocumentProxy(new Uint8Array(fs.readFileSync(file)));
  const pages = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const [, , width, height] = page.view;
    const ops = await page.getOperatorList();
    // images: the current transform maps the unit square onto the page
    const images = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() ?? ctm;
      else if (fn === OPS.transform) ctm = mul(ctm, ops.argsArray[i]);
      else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageMaskXObject) {
        const xs = [ctm[4], ctm[4] + ctm[0], ctm[4] + ctm[2], ctm[4] + ctm[0] + ctm[2]];
        const ys = [ctm[5], ctm[5] + ctm[1], ctm[5] + ctm[3], ctm[5] + ctm[1] + ctm[3]];
        const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
        images.push({ x: x0, y: height - y1, w: x1 - x0, h: y1 - y0 });
      }
    }
    const content = await page.getTextContent();
    const runs = [];
    for (const item of content.items) {
      if (!item.str || !item.str.replace(/[\s​]/g, "")) continue;
      const [a, b, , , e, f] = item.transform;
      const size = Math.hypot(a, b);
      let font = item.fontName;
      try {
        font = page.commonObjs.get(item.fontName)?.name ?? font;
      } catch {}
      font = font.replace(/^[A-Z]{6}\+/, "");
      const baseline = height - f;
      runs.push({ text: item.str, font, size: Math.round(size * 100) / 100, x: e, x1: e + item.width, baseline, top: baseline - 0.75 * size });
    }
    pages.push({ width, height, runs, images });
  }
  return pages;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/^.*\//, ""))) {
  const pages = await measurePdf(process.argv[2]);
  const only = process.argv[3] ? [Number(process.argv[3])] : pages.map((_, n) => n + 1);
  for (const n of only) {
    const p = pages[n - 1];
    console.log(`--- page ${n} (${p.width} x ${p.height})`);
    for (const im of p.images) console.log(`IMAGE x=${im.x.toFixed(1)} y=${im.y.toFixed(1)} w=${im.w.toFixed(1)} h=${im.h.toFixed(1)} right=${(p.width - im.x - im.w).toFixed(1)} bottom=${(p.height - im.y - im.h).toFixed(1)}`);
    for (const r of p.runs) console.log(`${r.font.padEnd(22)} ${String(r.size).padStart(5)}  x=${r.x.toFixed(1).padStart(6)} x1=${r.x1.toFixed(1).padStart(6)} base=${r.baseline.toFixed(1).padStart(6)} top=${r.top.toFixed(1).padStart(6)}  ${JSON.stringify(r.text)}`);
  }
}
