import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { hash, json } from './core.mjs';

const key = '[A-Za-z][\\w-]*(?:\\.[\\w-]+)+';
const lineAt = (text, offset) => text.slice(0, offset).split('\n').length;

// Bounded support for the app's shared dynamic equipment labels. This avoids
// treating the `equipment.name.` prefix as a missing literal while still
// checking every controlled equipment ID.
function dynamicEquipmentIssues(text, source) {
  const match = text.match(/const\s+EQUIPMENT_TYPES\s*=\s*\[([\s\S]*?)\]/);
  if (!match) return [];
  const ids = [...match[1].matchAll(/['"]([a-z][\w-]*)['"]/g)].map(m => m[1]);
  const issues = [];
  for (const id of ids) {
    const expected = `equipment.name.${id}`;
    if (!Object.hasOwn(source, expected)) issues.push(`app.js:${lineAt(text, match.index)}: unregistered dynamic key ${expected}`);
  }
  return issues;
}

function htmlLiterals(text, file, baseLine=0) {
  const issues = [], literals = [], stack = [];
  const report = (value, offset) => {
    value = value.replace(/\s+/g, ' ').trim();
    if (value.includes('${') || value.includes('{{') || !/[A-Za-z]{2}/.test(value)) return;
    const id = hash({file, value});
    const line = baseLine + lineAt(text, offset);
    if (!literals.some(item => item.id === id)) literals.push({id, file, value, line});
    issues.push({id, file, value, line});
  };
  for (const token of text.matchAll(/<[^>]*>|[^<]+/g)) {
    const value = token[0], offset = token.index;
    if (value[0] !== '<') {
      if (stack.length && !stack.some(item => item.hidden || item.translated)) report(value, offset);
      continue;
    }
    const closing = value.match(/^<\/\s*([a-z][\w-]*)/i);
    if (closing) {
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === closing[1].toLowerCase()) { stack.length = i; break; }
      continue;
    }
    const opening = value.match(/^<\s*([a-z][\w-]*)\b([\s\S]*?)(?:\/)?\s*>$/i);
    if (!opening) continue;
    const tag = opening[1].toLowerCase(), attrs = opening[2];
    const translated = /\bdata-i18n(?:-[\w-]+)?\s*=/.test(attrs);
    const hidden = /^(?:script|style|template|head|noscript)$/.test(tag);
    for (const attr of attrs.matchAll(/(?<!data-i18n-)\b(?:aria-label|placeholder|title)\s*=\s*(['"])([^'"]*)\1/gi)) {
      const attrName = attr[0].split('=')[0].trim().toLowerCase();
      if (!new RegExp(`\\bdata-i18n-${attrName}\\s*=`, 'i').test(attrs)) report(attr[2], offset + attr.index);
    }
    if (!/\/$/.test(value.trim()) && !['meta', 'link', 'input', 'img', 'br', 'hr'].includes(tag)) stack.push({tag, hidden, translated});
  }
  return {issues, literals};
}

// Deliberately conservative heuristic, not a proof of full semantic coverage.
// It checks static HTML body text/attributes and literal UI messages.
export async function scan(root, source) {
  const issues = [], literals = [];
  const allow = await json(path.join(root, 'tools/i18n/literal-allowlist.json'), {});
  const reportLiteral = item => {
    if (!literals.some(existing => existing.id === item.id)) literals.push(item);
    if (typeof allow[item.id] !== 'string' || !allow[item.id].trim()) issues.push(`${item.file}:${item.line}: untranslated literal ${JSON.stringify(item.value)} [${item.id}]`);
  };
  for (const file of ['app.js', 'index.html', 'exercises.js']) {
    const text = await readFile(path.join(root, file), 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; });
    for (const match of text.matchAll(new RegExp(`\\b(?:t|th|tr)\\(\\s*['"](${key})['"]`, 'g'))) if (!Object.hasOwn(source, match[1])) issues.push(`${file}:${lineAt(text, match.index)}: unregistered key ${match[1]}`);
    for (const match of text.matchAll(/\bdata-i18n(?:-[\w-]+)?\s*=\s*(['"])([^'"]+)\1/gi)) {
      if (new RegExp(`^${key}$`).test(match[2]) && !Object.hasOwn(source, match[2])) issues.push(`${file}:${lineAt(text, match.index)}: unregistered key ${match[2]}`);
    }
    if (file === 'app.js') {
      issues.push(...dynamicEquipmentIssues(text, source));
      for (const match of text.matchAll(/\b(?:alert|confirm|prompt|showToast|toast)\(\s*(['"])([^'"\n]+)\1/g)) {
        const value = match[2].trim();
        if (!value.includes('${') && /[A-Za-z]{2}/.test(value)) reportLiteral({id: hash({file, value}), file, value, line: lineAt(text, match.index)});
      }
      // These are common direct DOM/UI escape hatches. Keep this list narrow so
      // data values and arbitrary template strings are not reported as prose.
      for (const pattern of [/\.textContent\s*=\s*(['"])([^'"\n]+)\1/g, /\bshowModal\(\s*(['"])([^'"\n]+)\1/g, /\blabel\s*:\s*(['"])([^'"\n]+)\1/g]) {
        for (const match of text.matchAll(pattern)) {
          const value = match[2].trim();
          if (!value.includes('${') && /[A-Za-z]{2}/.test(value)) reportLiteral({id: hash({file, value}), file, value, line: lineAt(text, match.index)});
        }
      }
    }
    if (file === 'index.html') {
      const body = text.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
      if (body) {
        const start = body.index + body[0].indexOf(body[1]);
        const found = htmlLiterals(body[1], file, lineAt(text, start) - 1);
        found.issues.forEach(reportLiteral);
        found.literals.forEach(item => { if (!literals.some(existing => existing.id === item.id)) literals.push(item); });
      }
    }
  }
  return {issues: [...new Set(issues)], literals};
}
