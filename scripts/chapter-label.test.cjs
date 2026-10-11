const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(filename) {
  const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Number, String, Object }, { filename });
  return module.exports;
}

const label = load('shared/chapter-label.ts');

test('titles follow [Type] [Number] - [Name]', () => {
  assert.equal(label.formatChapterTitle('Chapter', 1, "Ohm's Law"), "Chapter 1 - Ohm's Law");
  assert.equal(label.formatChapterTitle('Month', 2, 'Advanced Review'), 'Month 2 - Advanced Review');
  assert.equal(label.formatChapterTitle('Month', 2, '  '), 'Month 2');
  assert.equal(label.formatChapterTitle(null, 3), 'Chapter 3');
});

test('chapter group keys ignore type case and spacing', () => {
  assert.equal(label.chapterKey('month', 2), label.chapterKey(' Month ', 2));
  assert.notEqual(label.chapterKey('Month', 2), label.chapterKey('Month', 3));
});

test('type and number validation', () => {
  assert.equal(label.parseChapterType('  Semester   one '), 'Semester one');
  assert.equal(label.parseChapterType(''), null);
  assert.equal(label.parseChapterType('x'.repeat(25)), null);
  assert.equal(label.parseChapterNumber('12'), 12);
  assert.equal(label.parseChapterNumber(0), null);
  assert.equal(label.parseChapterNumber(100), null);
  assert.equal(label.parseChapterNumber(1.5), null);
  assert.equal(label.parseChapterNumber(''), null);
});

test('chapter info needs a name; description is optional', () => {
  assert.equal(label.parseChapterInfo({ type: 'Chapter', number: 1, name: '' }).ok, false);
  const ok = label.parseChapterInfo({ type: 'Month', number: 2, name: 'Review', summary: ' quick ', description: '  ' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.summary, 'quick');
  assert.equal(ok.value.description, null);
  assert.equal(label.parseChapterInfo({ type: 'Month', number: 2, name: 'R', summary: 'x'.repeat(201) }).ok, false);
});
