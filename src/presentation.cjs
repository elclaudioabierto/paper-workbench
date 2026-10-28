function clean(text) {
  return text
    .replace(/\*\*|__/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .trim();
}
function parseDeck(markdown) {
  const title = clean(
    markdown.match(/^#\s+(.+)$/m)?.[1] || "Manuscript appraisal",
  );
  const slides = [];
  let slide = null,
    inNotes = false;
  for (const line of markdown.split("\n")) {
    const heading = line.match(/^##\s+(?:Slide\s+\d+\s*[:.\-–—]\s*)?(.+)$/i);
    if (heading) {
      slide = { title: clean(heading[1]), bullets: [], notes: "" };
      slides.push(slide);
      inNotes = false;
      continue;
    }
    if (!slide) continue;
    if (/^###\s+(?:speaker\s+)?notes/i.test(line)) {
      inNotes = true;
      continue;
    }
    if (inNotes) {
      slide.notes += (slide.notes ? "\n" : "") + clean(line);
      continue;
    }
    const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)$/);
    if (bullet) slide.bullets.push(clean(bullet[1]));
    else if (line.trim() && !/^###/.test(line)) slide.bullets.push(clean(line));
  }
  if (!slides.length)
    slides.push({
      title,
      bullets: markdown
        .split(/\n\s*\n/)
        .map(clean)
        .filter(Boolean),
      notes: "",
    });
  // Never silently drop overflowing content: split it into continuation slides and retain notes.
  const expanded = [];
  for (const slide of slides) {
    const chunks = [];
    let chunk = [];
    let size = 0;
    for (const bullet of slide.bullets) {
      const pieces = bullet.match(/[\s\S]{1,300}(?:\s|$)|[\s\S]{1,300}/g) || [
        bullet,
      ];
      for (const piece of pieces) {
        if (chunk.length >= 5 || size + piece.length > 950) {
          chunks.push(chunk);
          chunk = [];
          size = 0;
        }
        chunk.push(piece.trim());
        size += piece.length;
      }
    }
    if (chunk.length || !chunks.length) chunks.push(chunk);
    chunks.forEach((bullets, i) =>
      expanded.push({
        ...slide,
        title: slide.title + (i ? " (continued)" : ""),
        bullets,
      }),
    );
  }
  return { title, slides: expanded };
}
async function exportPptx(markdown) {
  const PptxGenJS = require("pptxgenjs");
  const deck = parseDeck(markdown);
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Paper Workbench";
  pptx.subject = "Manuscript summary and critical appraisal";
  pptx.title = deck.title;
  pptx.company = "Paper Workbench";
  pptx.lang = "en-US";
  pptx.theme = {
    headFontFace: "Aptos Display",
    bodyFontFace: "Aptos",
    lang: "en-US",
  };
  deck.slides.forEach((content, i) => {
    const slide = pptx.addSlide();
    slide.background = { color: "FFFFFF" };
    const critique = /missing|overstat|gap|limitation|claim/i.test(
      content.title,
    );
    const accent = critique ? "111111" : "111111";
    slide.addShape(pptx.ShapeType.rect, {
      x: 0,
      y: 0,
      w: 0.16,
      h: 7.5,
      line: { color: accent },
      fill: { color: accent },
    });
    slide.addText(
      "PAPER WORKBENCH / " +
        (critique ? "CRITICAL APPRAISAL" : "MANUSCRIPT BRIEF"),
      {
        x: 0.7,
        y: 0.38,
        w: 11.6,
        h: 0.25,
        fontFace: "Aptos",
        fontSize: 10,
        bold: true,
        charSpacing: 2,
        color: accent,
        margin: 0,
      },
    );
    slide.addText(content.title, {
      x: 0.7,
      y: 0.95,
      w: 11.8,
      h: 1.08,
      fontSize: 30,
      bold: false,
      color: "111111",
      margin: 0,
      breakLine: false,
      fit: "shrink",
    });
    slide.addShape(pptx.ShapeType.line, {
      x: 0.7,
      y: 2.15,
      w: 11.8,
      h: 0,
      line: { color: "BBBBBB", width: 1 },
    });
    const length = content.bullets.reduce((n, b) => n + b.length, 0);
    const fontSize = length > 700 ? 18 : length > 450 ? 20 : 23;
    const runs = content.bullets.map((text) => ({
      text,
      options: {
        bullet: { indent: 20 },
        hanging: 5,
        breakLine: true,
        paraSpaceAfter: 18,
      },
    }));
    if (runs.length)
      slide.addText(runs, {
        x: 0.88,
        y: 2.48,
        w: 11.35,
        h: 3.85,
        fontFace: "Aptos",
        fontSize,
        color: "222222",
        margin: 0,
        breakLine: false,
        valign: "top",
        fit: "shrink",
      });
    slide.addText(deck.title, {
      x: 0.7,
      y: 7,
      w: 10.6,
      h: 0.2,
      fontSize: 9,
      color: "666666",
      margin: 0,
      fit: "shrink",
    });
    slide.addText(
      String(i + 1).padStart(2, "0") +
        " / " +
        String(deck.slides.length).padStart(2, "0"),
      {
        x: 11.45,
        y: 6.96,
        w: 1.05,
        h: 0.25,
        fontSize: 10,
        color: accent,
        align: "right",
        margin: 0,
      },
    );
    if (content.notes) slide.addNotes(content.notes);
  });
  return pptx.write({ outputType: "nodebuffer" });
}
module.exports = { parseDeck, exportPptx };
