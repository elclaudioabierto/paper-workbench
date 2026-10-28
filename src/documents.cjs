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
    text = docxHtmlToText(
      (
        await require("mammoth").convertToHtml({
          buffer,
          convertImage: require("mammoth").images.imgElement(() => ({})),
        })
      ).value,
    );
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
function docxHtmlToText(html) {
  const { DOMParser } = require("@xmldom/xmldom");
  const root = new DOMParser().parseFromString(
    `<root>${html}</root>`,
    "text/xml",
  ).documentElement;
  function contents(node) {
    if (node.nodeType === 3) return node.data;
    if (node.nodeType !== 1) return "";
    if (node.tagName === "br") return "\n";
    return Array.from(node.childNodes).map(contents).join("");
  }
  function blocks(node) {
    if (node.nodeType !== 1) return node.nodeType === 3 ? node.data : "";
    if (node.tagName === "br") return "\n";
    if (node.tagName === "table") {
      const rows = Array.from(node.getElementsByTagName("tr"))
        .map((row) =>
          Array.from(row.childNodes)
            .filter((c) => c.nodeType === 1 && ["td", "th"].includes(c.tagName))
            .map((cell) => {
              const span = [
                cell.getAttribute("rowspan") > 1
                  ? `rowspan ${cell.getAttribute("rowspan")}`
                  : "",
                cell.getAttribute("colspan") > 1
                  ? `colspan ${cell.getAttribute("colspan")}`
                  : "",
              ]
                .filter(Boolean)
                .join(", ");
              return (
                contents(cell)
                  .trim()
                  .replace(/\s*\n\s*/g, " ") + (span ? ` [${span}]` : "")
              ).replace(/\|/g, "\\|");
            }),
        )
        .filter((row) => row.length);
      if (!rows.length) return "";
      const width = Math.max(...rows.map((row) => row.length));
      const line = (row) =>
        `| ${Array.from({ length: width }, (_, i) => row[i] || "").join(" | ")} |`;
      return `\n\n${line(rows[0])}\n${line(Array(width).fill("---"))}${rows
        .slice(1)
        .map((row) => `\n${line(row)}`)
        .join("")}\n\n`;
    }
    const result = Array.from(node.childNodes).map(blocks).join("");
    return ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li"].includes(
      node.tagName,
    )
      ? `${result}\n\n`
      : result;
  }
  return blocks(root).trim();
}
async function exportDocx(text) {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
  } = require("docx");
  const tokens = require("markdown-it")().parse(text, {});
  const tables = new Map();
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].type !== "table_open") continue;
    const start = tokens[i].map[0],
      end = tokens[i].map[1],
      rows = [];
    let row;
    for (i++; i < tokens.length && tokens[i].type !== "table_close"; i++) {
      if (tokens[i].type === "tr_open") row = [];
      else if (tokens[i].type === "inline")
        row.push(
          tokens[i].children
            .map((t) =>
              t.type === "text" || t.type === "code_inline"
                ? t.content
                : t.type === "softbreak" || t.type === "hardbreak"
                  ? " "
                  : "",
            )
            .join(""),
        );
      else if (tokens[i].type === "tr_close") rows.push(row);
    }
    tables.set(start, { end, rows });
  }
  const children = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (tables.has(i)) {
      const table = tables.get(i);
      children.push(
        new Table({
          rows: table.rows.map(
            (row) =>
              new TableRow({
                children: row.map(
                  (cell) => new TableCell({ children: [new Paragraph(cell)] }),
                ),
              }),
          ),
        }),
      );
      i = table.end - 1;
      continue;
    }
    const line = lines[i];
    const heading = line.match(/^(#{1,3})\s+(.+)/);
    children.push(
      new Paragraph({
        heading: heading
          ? [
              HeadingLevel.HEADING_1,
              HeadingLevel.HEADING_2,
              HeadingLevel.HEADING_3,
            ][heading[1].length - 1]
          : undefined,
        children: [new TextRun(heading ? heading[2] : line)],
      }),
    );
  }
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
