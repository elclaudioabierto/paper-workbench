const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
async function extract(file) {
  const buffer = await fs.readFile(file);
  if (buffer.length > 30 * 1024 * 1024)
    throw new Error("Please use a document smaller than 30 MB.");
  const ext = path.extname(file).toLowerCase();
  let text;
  if (ext === ".docx")
    text = (await require("mammoth").extractRawText({ buffer })).value;
  else if (ext === ".pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const pdf = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: true,
      isEvalSupported: false,
    }).promise;
    try {
      const pages = [];
      for (let n = 1; n <= pdf.numPages; n++) {
        const page = await pdf.getPage(n);
        const content = await page.getTextContent();
        pages.push(
          content.items.map((i) => i.str + (i.hasEOL ? "\n" : " ")).join(""),
        );
      }
      text = pages.join("\n\n");
    } finally {
      await pdf.destroy();
    }
  } else if ([".txt", ".md", ".markdown", ".csv"].includes(ext))
    text = buffer.toString("utf8");
  else throw new Error("Use DOCX, PDF, Markdown, or plain text.");
  if (!text.trim())
    throw new Error("No text found. Scanned PDFs require OCR before import.");
  return {
    text,
    name: path.basename(file),
    sourceName: path.basename(file),
    sourceSha256: createHash("sha256").update(buffer).digest("hex"),
  };
}
async function exportDocx(text) {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
  } = require("docx");
  const children = text.split("\n").map((line) => {
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    return new Paragraph({
      heading: heading
        ? [
            HeadingLevel.HEADING_1,
            HeadingLevel.HEADING_2,
            HeadingLevel.HEADING_3,
          ][heading[1].length - 1]
        : undefined,
      children: [new TextRun(heading ? heading[2] : line)],
    });
  });
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}
function placeholderSvg(number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675"><rect x="2" y="2" width="1196" height="671" rx="12" fill="#ffffff" stroke="#111111" stroke-width="2" stroke-dasharray="12 8"/><path d="M490 395l75-90 55 55 40-40 65 75z" fill="none" stroke="#777777" stroke-width="5"/><circle cx="675" cy="265" r="21" fill="#777777"/><text x="600" y="480" text-anchor="middle" fill="#111111" font-family="sans-serif" font-size="26">Figure ${Number(number)} placeholder</text><text x="600" y="520" text-anchor="middle" fill="#666666" font-family="sans-serif" font-size="18">Replace with the final figure. Caption stays in the manuscript.</text></svg>`;
}
function markdownBundle(text) {
  const { zipSync, strToU8 } = require("fflate");
  const files = { "manuscript.md": strToU8(text) };
  for (const match of text.matchAll(/assets\/figure-([1-9][0-9]{0,3})\.svg/g))
    files[`assets/figure-${match[1]}.svg`] = strToU8(placeholderSvg(match[1]));
  files["README.txt"] = strToU8(
    "Open manuscript.md in a Markdown editor. Blank tables are editable Markdown skeletons. Replace assets/figure-N.svg with final figure files, updating references if the filename changes. Captions stay in the manuscript body. Review the converted text against the source for completeness.",
  );
  return Buffer.from(zipSync(files));
}
module.exports = { extract, exportDocx, markdownBundle, placeholderSvg };
