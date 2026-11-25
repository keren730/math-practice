// Generator tests. Run: node --test
// Loads the inline <script> from index.html in a vm sandbox (no document, so UI code is skipped).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*?)<\/script>/);
assert.ok(m, 'no inline <script> found in index.html');

const ctx = vm.createContext({ console });
vm.runInContext(m[1], ctx);
const { GENS, TOPICS, setLV } = vm.runInContext(
  '({GENS, TOPICS, setLV: v => { LV = v; }})', ctx);

const RUNS = 500;
const BAD_TEXT = /NaN|undefined|null|\[object|Infinity/;

function checkText(label, s) {
  assert.equal(typeof s, 'string', `${label}: not a string`);
  assert.ok(!BAD_TEXT.test(s), `${label}: bad text -> ${s}`);
}

function checkQuestion(name, lv, q) {
  const tag = `${name} (level ${lv})`;
  assert.ok(q && (q.type === 'num' || q.type === 'mc'), `${tag}: bad question type`);
  checkText(`${tag} q`, q.q);
  checkText(`${tag} explain`, q.explain);
  checkText(`${tag} svg`, q.svg);
  if (q.type === 'num') {
    const a = q.answer;
    assert.ok(typeof a === 'number' && Number.isInteger(a) && a >= 0,
      `${tag}: answer must be a non-negative integer, got ${a}`);
  } else {
    assert.ok(q.options.length >= 2, `${tag}: fewer than 2 options`);
    assert.equal(q.options.filter(o => o.ok).length, 1, `${tag}: need exactly one correct option`);
    const seen = new Set();
    for (const o of q.options) {
      checkText(`${tag} option`, String(o.h));
      assert.ok(!seen.has(o.h), `${tag}: duplicate option ${o.h}`);
      seen.add(o.h);
    }
  }
}

for (const lv of [1, 2]) {
  for (const [name, gen] of Object.entries(GENS)) {
    test(`${name} @ level ${lv}`, () => {
      setLV(lv);
      for (let i = 0; i < RUNS; i++) checkQuestion(name, lv, gen());
    });
  }
}

test('every generator used in TOPICS is registered in GENS', () => {
  const registered = new Set(Object.values(GENS));
  for (const t of TOPICS) for (const s of t.subs) for (const g of s.gens) {
    assert.ok(registered.has(g), `${t.id}/${s.id}: generator ${g.name} missing from GENS`);
  }
});

test('every generator in GENS is used by some sub-topic', () => {
  const used = new Set(TOPICS.flatMap(t => t.subs.flatMap(s => s.gens)));
  for (const [name, g] of Object.entries(GENS)) assert.ok(used.has(g), `${name} is never used`);
});
