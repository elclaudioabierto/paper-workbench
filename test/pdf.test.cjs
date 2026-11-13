const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function samplePdf() {
  const stream = "BT /F1 12 Tf 72 720 Td (PDF import works) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("");
  return pdf + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

test("PDF text extraction works in Electron without loading native canvas", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "paper-pdf-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, "sample.pdf");
  fs.writeFileSync(file, samplePdf());
  const script = `
    const assert = require('node:assert/strict');
    const { extract } = require('./src/documents.cjs');
    (async () => {
      const results = await Promise.all([extract(process.argv[1]), extract(process.argv[1])]);
      for (const result of results) {
        assert.match(result.text, /PDF import works/);
        assert.equal(result.sourceSha256.length, 64);
      }
    })().catch(error => { console.error(error); process.exitCode = 1; });`;
  const result = spawnSync(require("electron"), ["-e", script, file], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    encoding: "utf8",
    timeout: 30000,
  });
  assert.equal(result.status, 0, `Electron failed: ${result.signal || result.stderr}`);
});
