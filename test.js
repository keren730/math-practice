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

const ctx = vm.createContext({ console, URLSearchParams });
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
const helpers = vm.runInContext('({subStat, streak, statsTotal, mergeStats, dkey, esc, cleanName, CLASS_RE, normClass, familyFrom, inviteFrom, inviteUrl, weekStartOf, weekKeyOf, weekPts, memberDoc, rankBoard, tierOf})', ctx);
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


test('pickRun: the newer copy of an unfinished practice wins', () => {
  const { pickRun } = vm.runInContext('({pickRun})', ctx);
  assert.equal(pickRun(0, null), 'none');                 // nothing anywhere
  assert.equal(pickRun(500, null), 'push');               // only local -> upload
  assert.equal(pickRun(0, { u: 700, p: '{}' }), 'adopt');  // only cloud -> download
  assert.equal(pickRun(500, { u: 700, p: '{}' }), 'adopt');
  assert.equal(pickRun(900, { u: 700, p: '{}' }), 'push');
  assert.equal(pickRun(700, { u: 700, p: '{}' }), 'none');
  assert.equal(pickRun(500, { u: 700, p: '' }), 'adopt'); // finished elsewhere -> clear local
});

test('mergeStats carries the name and level from the cloud copy', () => {
  const local = { a: {}, log: [], days: {} };
  const cloud = { a: { x: { c: 1, t: 9, r: '' } }, log: [], days: {}, name: 'נועה', lv: 2 };
  const m = helpers.mergeStats(local, cloud);
  assert.equal(m.name, 'נועה');
  assert.equal(m.lv, 2);
});

test('esc neutralises HTML in a typed name', () => {
  assert.equal(helpers.esc('<img src=x onerror=alert(1)>"&\''), '&lt;img src=x onerror=alert(1)&gt;&quot;&amp;&#39;');
});

test('cleanName trims, collapses spaces and limits length', () => {
  assert.equal(helpers.cleanName('  נועה   כהן '), 'נועה כהן');
  assert.equal(helpers.cleanName('x'.repeat(40)).length, 16);
  assert.equal(helpers.cleanName('   '), '');
  assert.equal(helpers.cleanName(null), '');
});

test('week starts on Sunday and weekPts sums only that week', () => {
  const wed = new Date(2026, 10, 25);                     // Wed 25 Nov 2026
  assert.equal(helpers.dkey(helpers.weekStartOf(wed)), '2026-11-22'); // Sunday
  assert.equal(helpers.weekKeyOf(new Date(2026, 10, 22)), '2026-11-22');
  assert.equal(helpers.weekKeyOf(new Date(2026, 10, 28)), '2026-11-22'); // Saturday
  assert.equal(helpers.weekKeyOf(new Date(2026, 10, 29)), '2026-11-29'); // next Sunday
  const st = { pts: { '2026-11-21': 50, '2026-11-22': 3, '2026-11-25': 4, '2026-11-28': 2, '2026-11-29': 9 } };
  assert.equal(helpers.weekPts(st, wed), 9);              // 3 + 4 + 2, not the neighbours
  assert.equal(helpers.weekPts({}, wed), 0);
});

test('memberDoc shares only a nickname and numbers, within the rules limits', () => {
  const now = new Date(2026, 10, 25, 12);
  const st = { name: '  נועה  ', a: { place: { c: 8, t: 10, r: '1111111100' } }, log: [], days: { '2026-11-25': 10 }, pts: { '2026-11-25': 8 }, cls: 'abcd2345', mid: 'secretmemberidsecretmemberid' };
  const d = helpers.memberDoc(st, now);
  assert.deepEqual(Object.keys(d).sort(), ['a', 'k', 'n', 's', 't', 'u', 'w']);
  assert.equal(d.n, 'נועה');
  assert.equal(d.w, 8);
  assert.equal(d.a, 80);
  assert.equal(d.t, 10);
  assert.equal(d.k, '2026-11-22');
  assert.ok(!JSON.stringify(d).includes('secretmemberid') && !JSON.stringify(d).includes('abcd2345'));
  assert.equal(helpers.memberDoc({ a: {}, days: {} }, now).n, 'חבר');   // never an empty nickname
  assert.ok(helpers.memberDoc({ name: 'x'.repeat(50), a: {}, days: {} }, now).n.length <= 16);
});

test('rankBoard sorts by this week only, then accuracy', () => {
  const wk = '2026-11-22';
  const ranked = helpers.rankBoard([
    { id: 'a', n: 'דנה', w: 10, a: 90, k: wk },
    { id: 'b', n: 'איתי', w: 10, a: 95, k: wk },
    { id: 'c', n: 'גיא', w: 99, a: 99, k: '2026-11-15' },   // last week's points do not count
    { id: 'd', n: 'מיה', w: 30, a: 70, k: wk },
  ], wk);
  assert.deepEqual(ranked.map(m => m.id), ['d', 'b', 'a', 'c']);
  assert.equal(ranked[3].w, 0);
});

test('tierOf gives playful ranks with progress to the next one', () => {
  assert.equal(helpers.tierOf(0).name, 'ניצוץ');
  assert.equal(helpers.tierOf(14).name, 'ניצוץ');
  assert.equal(helpers.tierOf(15).name, 'להבה');
  assert.equal(helpers.tierOf(40).name, 'כוכב');
  assert.equal(helpers.tierOf(80).name, 'מטאור');
  assert.equal(helpers.tierOf(150).name, 'גלקסיה');
  const t = helpers.tierOf(25);                           // halfway להבה -> כוכב
  assert.equal(t.next, 'כוכב'); assert.equal(t.need, 15); assert.equal(t.pct, 40);
  assert.equal(helpers.tierOf(1000).next, null);
});

test('class codes: 4-20 Hebrew letters, Latin letters or digits', () => {
  for (const ok of ['abcd2345', 'ד2נבו', 'כיתה4', 'ab12', 'a'.repeat(20), 'ךםןףץ12']) assert.ok(helpers.CLASS_RE.test(ok), ok);
  for (const bad of ['abc', 'a'.repeat(21), 'ab cd', 'ab-cd', 'ab/cd', 'ab.cd', '', 'ABCD', 'דנה!!']) assert.ok(!helpers.CLASS_RE.test(bad), JSON.stringify(bad));
});

test('normClass makes typed and pasted codes comparable', () => {
  assert.equal(helpers.normClass(' ד 2 נבו '), 'ד2נבו');
  assert.equal(helpers.normClass('ABCD-2345'), 'abcd2345');
  assert.equal(helpers.normClass('a/b\\c<d>'), 'abcd');
  assert.equal(helpers.normClass(null), '');
  assert.ok(helpers.CLASS_RE.test(helpers.normClass('78ff-S4UJ')));
});

test('mergeStats keeps class membership and weekly points from the cloud', () => {
  const m = helpers.mergeStats({ a: {}, log: [], days: {} }, { a: { x: { c: 1, t: 9, r: '' } }, pts: { '2026-11-25': 5 }, cls: 'abcd2345', mid: 'm'.repeat(24) });
  assert.equal(m.cls, 'abcd2345'); assert.equal(m.pts['2026-11-25'], 5); assert.equal(m.mid.length, 24);
});

test('invite links carry the class code, including Hebrew codes', () => {
  assert.equal(helpers.inviteUrl('https://x.test/app/', 'ד2נבו'), 'https://x.test/app/?class=%D7%932%D7%A0%D7%91%D7%95');
  assert.equal(helpers.inviteFrom('?class=%D7%932%D7%A0%D7%91%D7%95'), 'ד2נבו');   // round trip
  assert.equal(helpers.inviteFrom('?family=abc&class=ABCD-2345'), 'abcd2345');     // normalised
  assert.equal(helpers.inviteFrom('?class=ab'), '');                               // too short -> ignored
  assert.equal(helpers.inviteFrom('?class=%3Cscript%3E'), 'script');               // markup characters stripped
  assert.equal(helpers.inviteFrom(''), '');
  for (const c of ['ד2נבו', 'abcd2345', 'כיתה4']) assert.equal(helpers.inviteFrom(helpers.inviteUrl('', c).slice(0)), c);
});

test('mergeStats restores identity from the cloud even when it has no answers', () => {
  const cloud = { a: {}, log: [], days: {}, name: 'דנה', lv: 2, cls: 'ד2נבו', mid: 'm'.repeat(24) };
  const m = helpers.mergeStats({ a: {}, log: [], days: {} }, cloud);          // fresh device, nothing answered anywhere
  assert.equal(m.name, 'דנה'); assert.equal(m.lv, 2); assert.equal(m.cls, 'ד2נבו'); assert.equal(m.mid.length, 24);
});

test('mergeStats never replaces richer local progress, but fills missing identity', () => {
  const local = { a: { place: { c: 5, t: 9, r: '' } }, log: [], days: {}, name: 'נועה' };
  const cloud = { a: { place: { c: 1, t: 2, r: '' } }, log: [], days: {}, name: 'דנה', cls: 'abcd2345', mid: 'm'.repeat(24) };
  const m = helpers.mergeStats(local, cloud);
  assert.equal(helpers.statsTotal(m), 9);          // local answers kept
  assert.equal(m.name, 'נועה');                    // local name kept
  assert.equal(m.cls, 'abcd2345');                 // missing class filled from the cloud
  assert.equal(helpers.mergeStats(local, null), local);
  const same = { a: { place: { c: 5, t: 9, r: '' } }, log: [], days: {}, name: 'נועה', cls: 'x', mid: 'y' };
  assert.equal(helpers.mergeStats(same, { a: {}, name: 'ללא', cls: 'z', mid: 'w' }), same); // nothing to fill -> same object
});

test('familyFrom reads the personal code from a pasted link, not the invite code', () => {
  const code = 'abcdefghjkmnpqrstuvwxyz2';
  assert.equal(helpers.familyFrom('https://keren730.github.io/math-practice/?family=' + code), code);
  assert.equal(helpers.familyFrom('  https://x.test/?family=' + code.toUpperCase() + '&class=%D7%93  '), code);
  assert.equal(helpers.familyFrom(code), code);                                   // the bare code works too
  assert.equal(helpers.familyFrom('https://x.test/?class=%D7%932%D7%A0%D7%91%D7%95'), '');   // an invite link is not a personal link
  assert.equal(helpers.familyFrom('?family=short'), '');
  assert.equal(helpers.familyFrom(''), '');
  assert.equal(helpers.familyFrom(null), '');
});
