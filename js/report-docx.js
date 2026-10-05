// Word (.docx) export of the rendered report (detailed or simplified). Walks the report's DOM and rebuilds it with the
// docx library (loaded on first use): headings, paragraphs with bold/italic/links, tables, lists, stat cards as a
// one-row table, and the map image. Letter size, 0.75 in margins, Calibri 10 pt.
const DOCX_URL = "https://cdn.jsdelivr.net/npm/docx@9.8.1/dist/index.iife.js";
function loadDocx() {
  if (window.docx) return Promise.resolve(window.docx);
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = DOCX_URL; s.onload = () => res(window.docx); s.onerror = () => rej(new Error("could not load the Word library")); document.head.append(s); });
}
const SKIP = new Set(["SCRIPT", "STYLE", "BUTTON", "INPUT", "SELECT", "CANVAS", "SVG"]);
const BLOCK = new Set(["DIV", "P", "SECTION", "TABLE", "H1", "H2", "H3", "H4", "UL", "OL", "DETAILS", "IMG", "FIGURE", "HR"]);
const isSmall = (el) => !!el.closest?.(".note, .small, .meta, .asof, .sub, .s, .l");

export async function downloadDocx(root, filename) {
  const D = await loadDocx();
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, ImageRun, ExternalHyperlink, ShadingType } = D;
  const out = [];

  // inline content → runs
  const runs = (node, fmt = {}) => {
    const r = [];
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { const t = c.textContent.replace(/\s+/g, " "); if (t.trim() || (t === " " && r.length)) r.push(new TextRun({ text: t, ...fmt })); continue; }
      if (c.nodeType !== 1 || SKIP.has(c.tagName) || c.classList.contains("no-print")) continue;
      const tag = c.tagName;
      if (tag === "BR") { r.push(new TextRun({ text: "", break: 1, ...fmt })); continue; }
      const f2 = { ...fmt };
      if (tag === "B" || tag === "STRONG") f2.bold = true;
      if (tag === "I" || tag === "EM") f2.italics = true;
      if (tag === "SUB") f2.subScript = true;
      if (tag === "SUP") f2.superScript = true;
      if (c.classList.contains("small") || c.classList.contains("sub") || c.classList.contains("note")) f2.size = 16;
      if (tag === "A" && /^https?:/.test(c.getAttribute("href") || "")) { r.push(new ExternalHyperlink({ link: c.getAttribute("href"), children: [new TextRun({ text: c.textContent.replace(/\s+/g, " "), style: "Hyperlink", ...f2 })] })); continue; }
      if (BLOCK.has(tag)) { r.push(new TextRun({ text: "", break: r.length ? 1 : 0, ...fmt }), ...runs(c, f2)); continue; } // a block inside inline content (e.g. a cell's sub-line)
      r.push(...runs(c, f2));
    }
    return r;
  };
  const para = (el, opts = {}) => { const r = runs(el, isSmall(el) ? { size: 16, color: "555555" } : {}); return r.length ? new Paragraph({ children: r, spacing: { after: 80 }, ...opts }) : null; };
  const hasBlockChild = (el) => [...el.children].some((c) => BLOCK.has(c.tagName) && !c.classList.contains("no-print"));
  const cellParas = (cell) => { if (!hasBlockChild(cell)) { const p = para(cell); return [p || new Paragraph("")]; } const tmp = []; walk(cell, tmp); if (!tmp.length || !(tmp[tmp.length - 1] instanceof Paragraph)) tmp.push(new Paragraph("")); return tmp; }; // a cell must end with a paragraph

  const table = (el) => {
    const rows = [...el.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr")];
    if (!rows.length) return null;
    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: rows.map((tr) => new TableRow({ tableHeader: !!tr.closest("thead"), children: [...tr.children].map((td) => new TableCell({
      children: td.tagName === "TH" ? [new Paragraph({ children: [new TextRun({ text: td.textContent.replace(/\s+/g, " ").trim(), bold: true, size: 18 })] })] : cellParas(td),
      shading: td.tagName === "TH" ? { type: ShadingType.CLEAR, color: "auto", fill: "F3F4F6" } : undefined,
      columnSpan: td.colSpan > 1 ? td.colSpan : undefined })) })) });
  };
  const statsTable = (el) => { const cards = [...el.children].filter((c) => c.classList.contains("stat")); if (!cards.length) return null;
    return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: cards.map((c) => new TableCell({ children: [
      new Paragraph({ children: [new TextRun({ text: (c.querySelector(".v")?.textContent || "").trim(), bold: true, size: 26 })] }),
      ...[".l", ".s"].map((k) => c.querySelector(k)).filter((x) => x && x.textContent.trim()).map((x) => new Paragraph({ children: [new TextRun({ text: x.textContent.trim(), size: 15, color: "555555" })] })) ] })) })] }); };
  const image = (img) => {
    const m = (img.getAttribute("src") || "").match(/^data:image\/(png|jpe?g);base64,(.+)$/); if (!m) return null;
    const bin = atob(m[2]); const data = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
    const w = 624, h = Math.round((img.naturalHeight || 400) * w / (img.naturalWidth || 600)); // 6.5 in at 96 dpi
    return new Paragraph({ children: [new ImageRun({ type: m[1] === "png" ? "png" : "jpg", data, transformation: { width: w, height: h } })], spacing: { after: 60 } });
  };

  // Walk child nodes in order; loose text and inline elements between blocks become their own paragraph
  function walk(node, acc) {
    let inline = [];
    const flush = () => {
      if (!inline.length) return; const holder = document.createElement("span"); inline.forEach((x) => holder.append(x.cloneNode(true))); inline = [];
      if (!holder.textContent.trim()) return; const r = runs(holder, isSmall(node) ? { size: 16, color: "555555" } : {}); if (r.length) acc.push(new Paragraph({ children: r, spacing: { after: 80 } }));
    };
    for (const el of node.childNodes) {
      if (el.nodeType === 3) { inline.push(el); continue; }
      if (el.nodeType !== 1) continue;
      if (SKIP.has(el.tagName) || el.classList.contains("no-print") || el.classList.contains("chart") || el.classList.contains("js-plotly-plot")) continue;
      if (!BLOCK.has(el.tagName)) { inline.push(el); continue; }
      flush();
      const tag = el.tagName;
      if (tag === "H1") { acc.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: el.textContent.trim() })] })); continue; }
      if (tag === "H2") { acc.push(new Paragraph({ heading: HeadingLevel.HEADING_1, pageBreakBefore: el.classList.contains("pb"), children: [new TextRun({ text: el.textContent.trim() })] })); continue; }
      if (tag === "H3" || tag === "H4") { acc.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(el) })); continue; }
      if (tag === "TABLE") { const t = table(el); if (t) { acc.push(t); acc.push(new Paragraph({ text: "", spacing: { after: 60 } })); } continue; }
      if (tag === "IMG") { const p = image(el); if (p) acc.push(p); continue; }
      if (tag === "UL" || tag === "OL") { [...el.children].forEach((li, i) => { const r = runs(li, isSmall(el) || el.classList.contains("sources") ? { size: 17 } : {}); if (r.length) acc.push(new Paragraph({ children: [new TextRun({ text: tag === "OL" ? `${i + 1}. ` : "• ", size: 17 }), ...r], indent: { left: 360, hanging: 360 }, spacing: { after: 40 } })); }); continue; }
      if (el.classList.contains("stats") || el.classList.contains("stat-row")) { const t = statsTable(el); if (t) { acc.push(t); acc.push(new Paragraph({ text: "", spacing: { after: 60 } })); } continue; }
      if (tag === "DETAILS") { const s = el.querySelector(":scope > summary"); if (s) acc.push(new Paragraph({ children: [new TextRun({ text: s.textContent.trim(), bold: true })] })); const clone = el.cloneNode(true); clone.querySelector(":scope > summary")?.remove(); walk(clone, acc); continue; }
      if (hasBlockChild(el)) { walk(el, acc); continue; }
      const p = para(el); if (p) acc.push(p);
    }
    flush();
  }
  walk(root, out);
  const doc = new Document({
    creator: "Northland Eco", title: document.title,
    styles: { default: { document: { run: { font: "Calibri", size: 20 } } }, characterStyles: [{ id: "Hyperlink", name: "Hyperlink", basedOn: "DefaultParagraphFont", run: { color: "0369A1", underline: {} } }] },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children: out }],
  });
  const blob = await Packer.toBlob(doc);
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
