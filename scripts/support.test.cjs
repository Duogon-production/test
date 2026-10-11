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
  vm.runInNewContext(compiled, { module, exports: module.exports, URL, Array, Number, Object, String }, { filename });
  return module.exports;
}

const support = load('shared/support.ts');

test('preset subjects are accepted as-is and ignore custom text', () => {
  const result = support.parseSubject({ subject: "I can't log in", customSubject: 'ignored' });
  assert.deepEqual({ ...result }, { ok: true, subject: "I can't log in" });
});

test('"Other" requires a specified subject', () => {
  assert.equal(support.parseSubject({ subject: 'Other', customSubject: '   ' }).ok, false);
  const ok = support.parseSubject({ subject: 'Other', customSubject: ' Printer broke ' });
  assert.equal(ok.subject, 'Printer broke');
});

test('free-text subjects outside the list are rejected', () => {
  assert.equal(support.parseSubject({ subject: 'anything I like' }).ok, false);
  assert.equal(support.parseSubject(null).ok, false);
});

test('messages need text or an attachment', () => {
  assert.equal(support.parseMessage({ body: '  ' }).ok, false);
  assert.equal(support.parseMessage({ body: 'hello' }).ok, true);
});

test('attachments must be https UploadThing files', () => {
  const good = { url: 'https://utfs.io/f/abc', name: 'shot.png', size: 10, type: 'image/png' };
  assert.equal(support.parseMessage({ body: '', attachments: [good] }).ok, true);
  assert.equal(support.parseMessage({ body: 'x', attachments: [{ ...good, url: 'https://evil.example/a.png' }] }).ok, false);
  assert.equal(support.parseMessage({ body: 'x', attachments: [{ ...good, url: 'http://utfs.io/f/abc' }] }).ok, false);
  const many = Array.from({ length: 6 }, () => good);
  assert.equal(support.parseMessage({ body: 'x', attachments: many }).ok, false);
});
