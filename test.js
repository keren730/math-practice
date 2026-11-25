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

test('level 1 place-value generators stay within 100,000 (as in the workbook)', () => {
  setLV(1);
  for (const name of ['qAddUnits', 'qWriteNumber', 'qExpanded', 'qPlaceOp', 'qSeqNext', 'qSeqMiss', 'qNeighbor', 'qNumGrid']) {
    for (let i = 0; i < RUNS; i++) {
      const q = GENS[name]();
      assert.ok(q.answer <= 99999, `${name}: answer ${q.answer} exceeds 99,999 at level 1`);
    }
  }
});

// ---- progress statistics (pure helpers) ----
const helpers = vm.runInContext('({subStat, streak, statsTotal, mergeStats, ago, dkey})', ctx);
const bits = (n1, n0) => '1'.repeat(n1) + '0'.repeat(n0);

test('subStat: status thresholds use the last-20 window', () => {
  const st = { a: { x: { c: 0, t: 0, r: bits(2, 0) }, s: { c: 0, t: 0, r: bits(18, 2) }, o: { c: 0, t: 0, r: bits(15, 5) }, w: { c: 0, t: 0, r: bits(10, 10) }, f: { c: 0, t: 0, r: bits(9, 1) } }, log: [], days: {} };
  assert.equal(helpers.subStat('missing', st).status, 'new');
  assert.equal(helpers.subStat('x', st).status, 'new');     // < 5 answers
  assert.equal(helpers.subStat('s', st).status, 'strong');  // 90%
  assert.equal(helpers.subStat('o', st).status, 'ok');      // 75%
  assert.equal(helpers.subStat('w', st).status, 'weak');    // 50%
  assert.equal(helpers.subStat('f', st).status, 'strong');  // 90% with exactly 10 answers
});

test('streak counts consecutive days ending today or yesterday', () => {
  const day = back => { const d = new Date(); d.setDate(d.getDate() - back); return helpers.dkey(d); };
  assert.equal(helpers.streak({ days: {} }), 0);
  assert.equal(helpers.streak({ days: { [day(0)]: 3, [day(1)]: 2, [day(2)]: 5 } }), 3);
  assert.equal(helpers.streak({ days: { [day(1)]: 2, [day(2)]: 5 } }), 2);       // not practiced yet today
  assert.equal(helpers.streak({ days: { [day(0)]: 1, [day(2)]: 5 } }), 1);       // gap breaks the streak
});

test('mergeStats adopts the cloud copy only when it has more answers', () => {
  const local = { a: { x: { c: 1, t: 5, r: '' } }, log: [], days: {} };
  const bigger = { a: { x: { c: 9, t: 20, r: '' } } };            // no log/days -> normalised
  const smaller = { a: { x: { c: 1, t: 2, r: '' } }, log: [], days: {} };
  assert.equal(helpers.mergeStats(local, smaller), local);
  assert.equal(helpers.mergeStats(local, null), local);
  const m = helpers.mergeStats(local, bigger);
  assert.equal(helpers.statsTotal(m), 20);
  assert.equal(JSON.stringify([m.log, m.days]), '[[],{}]');
});

test('ago formats elapsed time in Hebrew', () => {
  assert.equal(helpers.ago(10 * 1000), 'רגע');
  assert.equal(helpers.ago(60 * 1000), 'דקה');
  assert.equal(helpers.ago(5 * 60 * 1000), '5 דקות');
  assert.equal(helpers.ago(3 * 3600 * 1000), '3 שעות');
  assert.equal(helpers.ago(2 * 86400 * 1000), '2 ימים');
});
