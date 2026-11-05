// The title-screen font (Wizard, by Graphiqa Studio): it must be a real font, cover every character the title screen
// shows, be wired up in index.html with fallbacks, and keep its personal-use-only license note next to it.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, '..') + '/';
let failed = 0;
const check = (name, ok, extra = '') => { if (!ok) failed++; console.log(ok ? 'PASS' : 'FAIL', name, extra); };

const fontPath = dir + 'fonts/Wizard.ttf';
check('fonts/Wizard.ttf exists', fs.existsSync(fontPath));
const data = fs.readFileSync(fontPath);
const magic = data.readUInt32BE(0);
check('it is a TrueType font (starts 0x00010000 or "true"), not an HTML error page saved by mistake', magic === 0x00010000 || magic === 0x74727565, `0x${magic.toString(16)}`);
check('...and a sensible size (a few KB to a few hundred KB)', data.length > 5000 && data.length < 500000, `${data.length} bytes`);

// the character map: which characters does the font have?
function mappedChars(buf) {
  const numTables = buf.readUInt16BE(4);
  let cmapOff = -1;
  for (let i = 0; i < numTables; i++) if (buf.toString('latin1', 12 + i * 16, 16 + i * 16) === 'cmap') cmapOff = buf.readUInt32BE(20 + i * 16);
  const chars = new Set();
  if (cmapOff < 0) return chars;
  const n = buf.readUInt16BE(cmapOff + 2);
  for (let i = 0; i < n; i++) {
    const base = cmapOff + buf.readUInt32BE(cmapOff + 4 + i * 8 + 4);
    const format = buf.readUInt16BE(base);
    if (format === 4) {
      const segX2 = buf.readUInt16BE(base + 6), seg = segX2 / 2;
      for (let k = 0; k < seg; k++) {
        const end = buf.readUInt16BE(base + 14 + k * 2), start = buf.readUInt16BE(base + 16 + segX2 + k * 2);
        for (let c = start; c <= Math.min(end, 0xfffe); c++) chars.add(c);
      }
    } else if (format === 12) {
      const groups = buf.readUInt32BE(base + 12);
      for (let g = 0; g < groups; g++) for (let c = buf.readUInt32BE(base + 16 + g * 12); c <= buf.readUInt32BE(base + 20 + g * 12); c++) chars.add(c);
    }
  }
  return chars;
}
const chars = mappedChars(data);
check('the font has a character map with real content', chars.size > 50, `${chars.size} characters`);

// every character that appears as visible text in the title screen's HTML (and in the strings title.js / online.js put there)
const html = fs.readFileSync(dir + 'index.html', 'utf8');
const body = html.slice(html.indexOf('<body>'));
const visible = body.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
const strings = ['title.js', 'online.js'].flatMap((f) => [...fs.readFileSync(dir + f, 'utf8').matchAll(/(?:textContent = |say\(|levelMsg\()[`'"]([^`'"$]+)/g)].map((m) => m[1])).join(' ');
const needed = new Set([...(visible + ' ' + strings)].filter((c) => c.charCodeAt(0) > 32 && c.charCodeAt(0) < 127));
const missing = [...needed].filter((c) => !chars.has(c.charCodeAt(0)));
check(`it covers every printable ASCII character the title screen can show (${needed.size} distinct: letters, digits, punctuation)`, missing.length === 0, missing.length ? `missing: ${missing.join(' ')}` : '');
check('...including the space', chars.has(32));
check('...and the characters in the title itself, "WizardBall"', [...'WizardBall'].every((c) => chars.has(c.charCodeAt(0))));

// wiring
check('index.html declares @font-face "Wizard" from fonts/Wizard.ttf', /@font-face\s*{[^}]*font-family:\s*'Wizard'[^}]*fonts\/Wizard\.ttf/.test(html));
check('...with font-display: swap, so the menu shows (in a fallback) instead of staying blank while it loads', /font-family:\s*'Wizard'[^}]*font-display:\s*swap/.test(html));
check('...and the title screen uses it FIRST in its font stack, with real fallbacks behind it (so a missing file does not break the layout)', /#title\s*{[^}]*font-family:\s*'Wizard',\s*'MedievalSharp'[^}]*serif/.test(html));
check('the font file is preloaded', /<link rel="preload" href="fonts\/Wizard\.ttf" as="font" type="font\/ttf" crossorigin>/.test(html));
const mainSrc = fs.readFileSync(dir + 'main.js', 'utf8');
check('the in-game canvas text still uses the arcade font; no ctx.font anywhere in the game uses Wizard (it is for the menu only)', /ctx\.font\s*=\s*[^;]*Press Start 2P/.test(mainSrc) && ![...mainSrc.matchAll(/ctx\.font\s*=\s*([^;]+);/g)].some((m) => /Wizard/.test(m[1])));

// license
const lic = fs.existsSync(dir + 'fonts/Wizard-READ-ME.txt') ? fs.readFileSync(dir + 'fonts/Wizard-READ-ME.txt', 'utf8') : '';
check("the author's license note ships next to the font, and says personal use only", /PERSONAL USE/i.test(lic) && /NO COMMERCIAL USE/i.test(lic));
const readme = fs.readFileSync(dir + 'README.md', 'utf8');
check('the README warns that the font is personal-use only and says how to swap it out', /Wizard/.test(readme) && /personal use only/i.test(readme) && /no commercial use/i.test(readme) && /graphiqastudio\.com/.test(readme));
check('index.html itself carries a comment saying the same, next to the font-face', /DEMO, PERSONAL USE ONLY/.test(html));

console.log(failed ? `\n${failed} FAILED` : '\nall passed');
process.exit(failed ? 1 : 0);
