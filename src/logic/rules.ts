// The case language: inference rules over facts. Every rule is a valid deduction about the true world, given that
// records are accurate, honest testimony is true, and testimony is only ever used to contradict someone (an
// accomplice's word can't vouch for anyone). The generator builds each crime as a chain of these rules, then
// builds the world so the chain holds; the DA re-derives it from whatever the detective submits.
import { fmtTime, initials, streetName } from '../data';
import type { Case, World } from '../types';
import type { DB, Fact, Rule } from './engine';
import { nameOf, placeName } from './observe';

let W: World, C: Case;
export function setContext(w: World, c: Case) { W = w; C = c; }

const N = (pid: string) => nameOf(W, pid);
const T = fmtTime;
const num = (f: Fact, i: number) => f.args[i] as number;
const str = (f: Fact, i: number) => f.args[i] as string;
const TOL = 10, ROLL_TOL = 15, NEAR = 60;

function streetOf(place: string): string {
  if (place.startsWith('st:')) return place.slice(3);
  return streetName(W.buildings[W.addresses[place].building].street);
}
/** Could someone be at both places at once? Exact addresses must match; street-level sightings only need the street. */
function differ(a: string, b: string): boolean {
  if (a === b) return false;
  const loose = (p: string) => p.startsWith('st:') || W.addresses[p]?.kind === 'payphone';
  if (loose(a) || loose(b)) return streetOf(a) !== streetOf(b);
  return true;
}
/** Do [a,b] and [c,d] overlap meaningfully? Short sightings must fall well inside the other interval. */
function clash(a: number, b: number, c: number, d: number): boolean {
  if (d - c < TOL) return c >= a + 5 && d <= b - 5;
  return Math.min(b, d) - Math.max(a, c) >= TOL;
}
const list = (f: Fact | undefined) => (f ? (str(f, f.args.length - 1) || '').split('|').filter(Boolean) : []);

export const RULES: Rule[] = [
  // ---------------- Where people were
  { id: 'payphone', formula: 'rec(P, booth, t) ⇐ call(booth → home(W), t) ∧ calledMe(W, P, ≈t)',
    run(db, emit) {
      for (const call of db.all('call')) {
        const from = str(call, 0), to = str(call, 1), t = num(call, 2), dur = num(call, 3);
        if (!dur || W.addresses[from]?.kind !== 'payphone') continue;
        for (const cm of db.all('calledMe')) {
          const w = str(cm, 0), p = str(cm, 1);
          if (W.people[w].home !== to || Math.abs(num(cm, 2) - t) > 15) continue;
          emit('rec', [p, from, t, t + dur], `${N(p)} phoned home from ${placeName(W, from)} at ${T(t)}.`, [call, cm]);
        }
      }
    } },
  { id: 'record', step: 0, formula: 'seen(P, X, a, b) ⇐ rec(P, X, a, b)',
    run(db, emit) { for (const r of db.all('rec')) emit('seen', r.args, r.text, [r]); } },
  { id: 'testimony', step: 0, formula: 'seen(P, X, a, b) ⇐ testAt(P, X, a, b)',
    run(db, emit) { for (const r of db.all('testAt')) emit('seen', r.args, r.text, [r]); } },

  // ---------------- Shoes
  { id: 'shoe-owner', formula: 'shoesOf(S, P) ⇐ shoesOwner(S, P)  |  tag(S, n) ∧ repair(n, P)',
    run(db, emit) {
      for (const o of db.all('shoesOwner')) emit('shoesOf', o.args, `The shoes are ${N(str(o, 1))}'s.`, [o]);
      for (const t of db.all('tag')) for (const r of db.where('repair', str(t, 1))) emit('shoesOf', [str(t, 0), str(r, 1)], `Repair tag #${str(t, 1)} puts the shoes in ${N(str(r, 1))}'s hands.`, [t, r]);
    } },
  { id: 'shoe-match', formula: 'printBy(I, P) ⇐ shoePrint(I, size, sole, wear) ∧ shoes(S, size, sole, wear) ∧ shoesOf(S, P)',
    run(db, emit) {
      for (const sp of db.all('shoePrint')) for (const s of db.all('shoes')) {
        if ([1, 2, 3].some(i => sp.args[i] !== s.args[i])) continue;
        for (const o of db.where('shoesOf', str(s, 0))) {
          const p = str(o, 1), blood = sp.args[4] === 'blood';
          emit('printBy', [str(sp, 0), p, blood ? 'blood' : 'mud'], `${N(p)}'s shoes left the ${blood ? 'bloody' : 'muddy'} print at the scene.`, [sp, s, o]);
        }
      }
    } },
  { id: 'mud', formula: 'sometimeAt(P, scene, rain, morning) ⇐ printBy(mud I, P) ∧ rain(t)',
    run(db, emit) {
      for (const pb of db.all('printBy')) {
        if (pb.args[2] !== 'mud') continue;
        for (const r of db.all('rain')) emit('sometimeAt', [str(pb, 1), C.scene, num(r, 0), 31 * 60], `${N(str(pb, 1))} was in the victim's apartment some time after the rain began at ${T(num(r, 0))}.`, [pb, r]);
      }
    } },

  // ---------------- Lies
  { id: 'contradiction', formula: 'lied(P, s) ⇐ claim(P, X, a, b, s) ∧ ( seen(P, Y≠X, overlapping) | testNot(P, X, overlapping) | roll(X) without P )',
    run(db, emit) {
      for (const cl of db.all('claim')) {
        const p = str(cl, 0), x = str(cl, 1), a = num(cl, 2), b = num(cl, 3), s = str(cl, 4);
        const where = `${N(p)}'s account of being at ${placeName(W, x)} (${T(a)}–${T(b)}) is false`;
        for (const sn of db.where('seen', p)) if (differ(x, str(sn, 1)) && clash(a, b, num(sn, 2), num(sn, 3))) emit('lied', [p, s], `${where}.`, [cl, sn]);
        for (const tn of db.where('testNot', p, x)) if (clash(a, b, num(tn, 2), num(tn, 3))) emit('lied', [p, s], `${where}.`, [cl, tn]);
        for (const so of db.where('sometimeAt', p)) if (differ(x, str(so, 1)) && num(so, 2) >= a && num(so, 3) <= b) emit('lied', [p, s], `${where}.`, [cl, so]);
        for (const ro of db.where('roll', x)) {
          if (ro.args[3] === 'staff' && !W.addresses[x].employees.includes(p)) continue;
          const lo = Math.max(a, num(ro, 1)), hi = Math.min(b, num(ro, 2));
          if (hi - lo < ROLL_TOL) continue;
          const recs = db.where('rec', p, x).map(r => [Math.max(lo, num(r, 2)), Math.min(hi, num(r, 3))]).filter(([u, v]) => v > u).sort((u, v) => u[0] - v[0]);
          let covered = 0, t = lo;
          for (const [u, v] of recs) { if (v > t) { covered += v - Math.max(u, t); t = v; } }
          if (hi - lo - covered >= ROLL_TOL) emit('lied', [p, s], `${where}: ${placeName(W, x)}'s records don't have ${N(p)} there the whole time.`, [cl, ro]);
        }
      }
    } },

  // ---------------- Time of death
  { id: 'time-of-death', formula: 'window(lo, hi) ⇐ deadIn(…)+ ∧ aliveAt(t)?   (intersection)',
    run(db, emit) {
      const ds = db.all('deadIn').slice().sort((a, b) => a.cost - b.cost).slice(0, 5);
      const as: (Fact | null)[] = [null, ...db.all('aliveAt')];
      for (let mask = 1; mask < 1 << ds.length; mask++) {
        const used = ds.filter((_, i) => mask & (1 << i));
        const lo0 = Math.max(...used.map(d => num(d, 0))), hi = Math.min(...used.map(d => num(d, 1)));
        for (const al of as) {
          const lo = al ? Math.max(lo0, num(al, 0)) : lo0;
          if (lo > hi) continue;
          emit('window', [lo, hi], `${N(C.victim)} died between ${T(lo)} and ${T(hi)}.`, al ? [...used, al] : used);
        }
      }
    } },
  { id: 'alibi', formula: 'accounted(P, lo, hi) ⇐ rec(P, X≠scene, a, b) ∧ window(lo, hi) ∧ a ≤ lo ∧ hi ≤ b',
    run(db, emit) {
      const ws = db.all('window');
      for (const r of db.all('rec')) {
        if (str(r, 1) === C.scene) continue;
        for (const w of ws) if (num(r, 2) <= num(w, 0) && num(r, 3) >= num(w, 1)) {
          emit('accounted', [str(r, 0), num(w, 0), num(w, 1)], `${N(str(r, 0))} was at ${placeName(W, str(r, 1))} the whole time (${T(num(r, 2))}–${T(num(r, 3))}).`, [r, w]);
        }
      }
    } },
  { id: 'near', formula: 'near(P) ⇐ seen(P, X on the victim\'s street, t) ∧ window(lo, hi) ∧ t ≈ [lo, hi]  |  sometimeAt(P, scene)',
    run(db, emit) {
      const st = streetOf(C.scene);
      const ws = db.all('window');
      for (const sn of db.all('seen')) {
        const p = str(sn, 0), x = str(sn, 1);
        if (p === C.victim || x === W.people[p].home || (x !== C.scene && streetOf(x) !== st)) continue;
        for (const w of ws) if (num(sn, 3) >= num(w, 0) - NEAR && num(sn, 2) <= num(w, 1) + NEAR) {
          emit('near', [p], `${N(p)} was ${x === C.scene ? "at the victim's apartment" : `on ${st}, the victim's street`}, around ${T(num(sn, 2))} — close to the time of death.`, [sn, w]);
        }
      }
      for (const so of db.all('sometimeAt')) if (str(so, 1) === C.scene) emit('near', [str(so, 0)], `${N(str(so, 0))} was at the scene that night.`, [so]);
    } },

  // ---------------- The four pillars
  { id: 'presence', step: 0, formula: 'presence(P) ⇐ bloodPrint(P)  |  printBy(blood I, P)  |  admission(P)',
    run(db, emit) {
      for (const f of db.all('bloodPrint')) emit('presence', [str(f, 0)], `${N(str(f, 0))} left a fingerprint in the victim's blood.`, [f]);
      for (const f of db.all('printBy')) if (f.args[2] === 'blood') emit('presence', [str(f, 1)], `${N(str(f, 1))} stood in the victim's blood.`, [f]);
      for (const f of db.all('admission')) emit('presence', [str(f, 0)], `${N(str(f, 0))} admits being in the apartment that night.`, [f]);
    } },
  { id: 'elimination', formula: 'presence(P) ⇐ locked(scene) ∧ keyholders(K) ∧ killerDesc(d)? ∧ window(w) ∧ ∀Q ∈ K∖{P} matching d: accounted(Q, w)',
    run(db, emit) {
      const locked = db.get('locked', C.scene), kh = db.all('keyholders')[0];
      if (!locked || !kh) return;
      const holders = list(kh);
      const descs: (Fact | null)[] = [null, ...db.all('killerDesc')];
      for (const d of descs) {
        const cands = holders.filter(h => !d || (W.people[h].look.height === d.args[0] && W.people[h].look.build === d.args[1] && W.people[h].look.hair === d.args[2]));
        for (const w of db.all('window')) {
          const out = cands.map(h => db.get('accounted', h, num(w, 0), num(w, 1)));
          const left = cands.filter((_, i) => !out[i]);
          if (left.length !== 1) continue;
          const others = out.filter((x): x is Fact => !!x);
          const by = d ? 'matches the description and ' : '';
          emit('presence', [left[0]], `Whoever left locked the door with a key. ${N(left[0])} is the only key holder who ${by}can't account for the time of death.`, [locked, kh, w, ...(d ? [d] : []), ...others]);
        }
      }
    } },
  { id: 'weapon-tie', formula: 'tie(I, P) ⇐ possessed(I, P) | printOn(I, P) | serial(I, n) ∧ reg(n, P) | serial(I, n) ∧ regPawned(n) ∧ pawnSold(n, P) | brand(I, b) ∧ block(P, b)',
    run(db, emit) {
      for (const f of db.all('possessed')) emit('tie', f.args, f.text, [f]);
      for (const f of db.all('printOn')) emit('tie', f.args, f.text, [f]);
      for (const s of db.all('serial')) {
        const n = str(s, 1);
        for (const r of db.where('reg', n)) emit('tie', [str(s, 0), str(r, 1)], `Serial ${n} is registered to ${N(str(r, 1))}.`, [s, r]);
        for (const r of db.where('regPawned', n)) for (const ps of db.where('pawnSold', n)) emit('tie', [str(s, 0), str(ps, 1)], `Serial ${n} went through ${placeName(W, str(r, 1))} to ${N(str(ps, 1))}.`, [s, r, ps]);
      }
      for (const b of db.all('brand')) for (const k of db.all('block')) if (k.args[1] === b.args[1]) emit('tie', [str(b, 0), str(k, 0)], `The ${str(b, 1)} knife is missing from ${N(str(k, 0))}'s knife block.`, [b, k]);
    } },
  { id: 'means', formula: 'means(P) ⇐ weaponEst(I) ∧ tie(I, P)',
    run(db, emit) {
      for (const we of db.all('weaponEst')) for (const t of db.where('tie', str(we, 0))) emit('means', [str(t, 1)], `${N(str(t, 1))} had the murder weapon.`, [we, t]);
    } },
  { id: 'motive', formula: 'motive(P) ⇐ motiveRef(D, P) | motiveSaid(P) | motiveIni(note by victim D, i) ∧ unique i in victim\'s book | motiveIni(D, i) ∧ typeMatch(D, tw) ∧ twAt(tw, X) ∧ unique i in staff(X) | authorDoc(D) ∧ handMatch(D, E) ∧ signedBy(E, P)',
    run(db, emit) {
      const lbl = (f: Fact) => (f.args[f.args.length - 1] === 'weak' ? 'a quarrel' : 'a motive');
      for (const f of db.all('motiveRef')) emit('motive', [str(f, 1)], `${N(str(f, 1))} had ${lbl(f)} against the victim.`, [f]);
      for (const f of db.all('motiveSaid')) emit('motive', [str(f, 0)], `${N(str(f, 0))} had ${lbl(f)} against the victim.`, [f]);
      const book = db.all('bookList')[0];
      for (const mi of db.all('motiveIni')) {
        const ini = str(mi, 1);
        // The victim's own notes name people the victim knew; a threat from outside could come from anyone.
        if (book && !db.get('authorDoc', str(mi, 0))) {
          const m = list(book).filter(e => initials(W.people[e]) === ini);
          if (m.length === 1) emit('motive', [m[0]], `${N(m[0])} is the only "${ini}" in the victim's address book, so ${N(m[0])} had ${lbl(mi)} against the victim.`, [mi, book]);
        }
        for (const tm of db.where('typeMatch', str(mi, 0))) for (const tw of db.where('twAt', str(tm, 1))) {
          const staff = db.where('staffList', str(tw, 1))[0];
          const m = list(staff).filter(e => initials(W.people[e]) === ini);
          if (m.length === 1) emit('motive', [m[0]], `Typed at ${placeName(W, str(tw, 1))}, where ${N(m[0])} is the only "${ini}" on staff: ${N(m[0])} had ${lbl(mi)} against the victim.`, [mi, tm, tw, staff]);
        }
      }
      for (const ad of db.all('authorDoc')) for (const hm of db.where('handMatch', str(ad, 0))) for (const sb of db.where('signedBy', str(hm, 1))) {
        const m = db.where('motiveIni', str(ad, 0))[0] || db.where('motiveAnon', str(ad, 0))[0];
        if (m) emit('motive', [str(sb, 1)], `The handwriting is ${N(str(sb, 1))}'s, so ${N(str(sb, 1))} had ${lbl(m)} against the victim.`, [ad, m, hm, sb]);
      }
    } },
  { id: 'opportunity', step: 0, formula: 'opportunity(P) ⇐ lied(P, s) | near(P)',
    run(db, emit) {
      for (const f of db.all('lied')) emit('opportunity', [str(f, 0)], `${N(str(f, 0))} lied about where they were that night.`, [f]);
      for (const f of db.all('near')) emit('opportunity', [str(f, 0)], f.text, [f]);
    } },
  { id: 'guilt', step: 0, formula: 'guilty(P) ⇐ victim(V) ∧ 3 of {means, presence, motive, opportunity}(P), including means or presence',
    run(db, emit) {
      const v = db.get('victim', C.victim);
      if (!v) return;
      const who = new Set([...db.all('means'), ...db.all('presence')].map(f => str(f, 0)));
      for (const p of who) {
        const pil = (['means', 'presence', 'motive', 'opportunity'] as const).map(k => db.get(k, p));
        // Any three of the four pillars always include means or presence, the two only the killer can have.
        for (let skip = 0; skip < 4; skip++) {
          const use = pil.filter((_, i) => i !== skip);
          if (use.every(x => x)) emit('guilty', [p], `${N(p)} killed ${N(C.victim)}.`, [v, ...use]);
        }
      }
    } },
];

export const PILLARS = ['means', 'presence', 'motive', 'opportunity'] as const;
export type Pillar = typeof PILLARS[number];

/** Connections the judge accepts for a fingerprint warrant. */
export function connections(db: DB, pid: string): { text: string; fact: Fact }[] {
  const out: { text: string; fact: Fact }[] = [];
  const p = W.people[pid];
  const add = (text: string, f: Fact | undefined) => { if (f && !out.some(o => o.text === text)) out.push({ text, fact: f }); };
  add("Listed in the victim's address book.", db.get('book', pid));
  add('Holds a spare key to the victim\'s apartment.', db.get('keyholder', pid));
  for (const call of db.all('call')) {
    const ends = [str(call, 0), str(call, 1)];
    if (ends.includes(C.scene) && (ends.includes(p.home) || ends.includes(p.work))) add("Phone records show a call between their home or workplace and the victim's on the day of the murder.", call);
  }
  add('Something points to a conflict with the victim.', db.get('motive', pid));
  add('They lied to police about where they were.', db.where('lied', pid)[0]);
  add('Their shoes match a print at the scene.', db.all('printBy').find(f => f.args[1] === pid));
  add('They were near the scene around the time of death.', db.get('near', pid));
  return out;
}
