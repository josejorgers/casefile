// The night of a murder as it really happened (everyone's timeline), and everything people say about it.
// Honest accounts are read straight off the timeline, so they can never contradict a record; lies are the only
// statements that don't match it. Pure functions of (World, Case): no detective knowledge involved.
import { DIFFICULTIES, cap, fmtHour, fmtTime, hash, pron } from './data';
import type { Case, Person, Place, Said, Seg, Statement, StatementKind, World } from './types';

export const EVE = 18 * 60, MORNING = 31 * 60;          // timelines run 18:00 → 07:00 next day
export const ASK_FROM = 21 * 60, ASK_TO = 25 * 60;       // "between 21:00 and 01:00"
export const CLAIM_FROM = 20 * 60 + 45;                  // accounts start a little before that

// ---------- Timelines
export function workSegs(p: Person): [number, number][] {
  let [s, e] = p.shift;
  if (e <= s) e += 24;
  const out: [number, number][] = [];
  for (const off of [-1440, 0, 1440]) {
    const a = Math.max(EVE, s * 60 + off), b = Math.min(MORNING, e * 60 + off);
    if (a < b) out.push([a, b]);
  }
  return out;
}

export function defaultTimeline(p: Person): Seg[] {
  const out: Seg[] = [];
  let t = EVE;
  for (const [a, b] of workSegs(p)) {
    if (a > t) out.push({ place: p.home, from: t, to: a });
    out.push({ place: p.work, from: a, to: b });
    t = b;
  }
  if (t < MORNING) out.push({ place: p.home, from: t, to: MORNING });
  return out;
}

function merge(segs: Seg[]): Seg[] {
  const out: Seg[] = [];
  for (const s of segs) {
    if (s.to <= s.from) continue;
    const last = out[out.length - 1];
    if (last && last.place === s.place && last.to >= s.from) last.to = Math.max(last.to, s.to);
    else out.push({ ...s });
  }
  return out;
}

/** Lay `over` on top of a timeline, cutting whatever was there. */
export function overlay(base: Seg[], over: Seg[]): Seg[] {
  let segs = base.map(s => ({ ...s }));
  for (const o of over) {
    const next: Seg[] = [];
    for (const s of segs) {
      if (s.to <= o.from || s.from >= o.to) { next.push(s); continue; }
      if (s.from < o.from) next.push({ ...s, to: o.from });
      if (s.to > o.to) next.push({ ...s, from: o.to });
    }
    next.push({ ...o });
    segs = next.sort((a, b) => a.from - b.from);
  }
  return merge(segs);
}

export function timeline(W: World, c: Case, pid: string): Seg[] { return c.timeline[pid] || defaultTimeline(W.people[pid]); }

export function placeAt(W: World, c: Case, pid: string, t: number): Place | null | undefined {
  if (pid === c.victim && t >= c.time) return undefined;
  for (const s of timeline(W, c, pid)) if (s.from <= t && t < s.to) return s.place;
  return undefined;
}

const living = (W: World, c: Case, pid: string) => { const p = W.people[pid]; return (p.alive || pid === c.victim) && !p.arrested; };

/** Everybody physically at `addr` at minute t. */
export function presentAt(W: World, c: Case, addr: string, t: number): string[] {
  const a = W.addresses[addr];
  const cands = new Set([...a.residents, ...Object.keys(c.timeline)]);
  return [...cands].filter(pid => living(W, c, pid) && placeAt(W, c, pid, t) === addr);
}

/** Is the whole interval spent at one place? */
export function wholeAt(W: World, c: Case, pid: string, place: Place, a: number, b: number): boolean {
  return timeline(W, c, pid).some(s => s.place === place && s.from <= a && s.to >= b);
}

export function clip(segs: Seg[], a: number, b: number): Seg[] {
  return segs.filter(s => s.to > a && s.from < b).map(s => ({ ...s, from: Math.max(a, s.from), to: Math.min(b, s.to) }));
}

/** The coroner's estimate is deliberately wide. */
export function coronerWindow(c: Case): [number, number] {
  const a = c.time - 25 - (hash(c.id + 'a') % 20), b = c.time + 20 + (hash(c.id + 'b') % 20);
  return [a - (a % 5), b - (b % 5) + 5];
}

// ---------- Statements
export const sid = (c: Case, pid: string, kind: StatementKind) => `s${c.id}-${pid}-${kind}`;
const P = (pid: string) => `{p:${pid}}`;
const round5 = (t: number) => Math.round(t / 5) * 5;

function make(c: Case, pid: string, kind: StatementKind, text: string, said: Said[], lie = false): Statement {
  return { id: sid(c, pid, kind), pid, case: c.id, kind, text, lie, said };
}

function placePhrase(W: World, c: Case, p: Person, place: Place | null): string {
  if (place === null) return 'out';
  if (place === p.home) return 'home';
  if (place.startsWith('st:')) return `on ${place.slice(3)}`;
  if (place === p.work) return `at work at {a:${place}}`;
  if (place === c.scene) return `at ${W.people[c.victim].first}'s place, {a:${place}}`;
  return `at {a:${place}}`;
}

/** What an honest person says about their night: their own movements plus what they saw of their household. */
export function honestAccount(W: World, c: Case, pid: string): { text: string; said: Said[] } {
  const p = W.people[pid];
  const segs = clip(timeline(W, c, pid), CLAIM_FROM, ASK_TO).filter(s => s.to - s.from >= 5);
  const said: Said[] = segs.filter(s => s.place).map(s => ({ k: 'claim', place: s.place!, from: s.from, to: s.to }));
  const partner = p.partner && living(W, c, p.partner) && W.people[p.partner].home === p.home ? p.partner : null;
  let text: string;
  if (segs.length === 1 && segs[0].place === p.home) {
    if (partner && wholeAt(W, c, partner, p.home, CLAIM_FROM, ASK_TO)) text = `I was at home with ${P(partner)} all evening.`;
    else {
      const alone = ['I was home. Read for a while and went to bed early.', 'Home. Listened to the radio and fell asleep.',
        'At home, asleep by eleven. Nobody can vouch for that, I suppose.'];
      text = alone[hash(pid + c.id) % alone.length];
    }
  } else if (segs.length === 1 && segs[0].place === p.work) {
    text = `I was at work at {a:${p.work}}. My shift runs ${fmtHour(p.shift[0])}–${fmtHour(p.shift[1])}. Ask anyone.`;
  } else {
    text = segs.map((s, i) => {
      const ph = placePhrase(W, c, p, s.place);
      if (i === 0) return `I was ${ph} until ${fmtTime(s.to)}`;
      return `${i === segs.length - 1 ? 'and then' : 'then'} ${ph} from ${fmtTime(s.from)}${i === segs.length - 1 ? '' : ` until ${fmtTime(s.to)}`}`;
    }).join(', ') + '.';
  }
  const visit = segs.find(s => s.place === c.scene);
  if (visit) {
    said.push({ k: 'alive', t: visit.to });
    text += ` ${W.people[c.victim].first} was alive and well when I left.`;
  }

  // What they saw of others while they were at home
  const home = segs.filter(s => s.place === p.home);
  const others = new Set([...W.addresses[p.home].residents, ...Object.keys(c.timeline)]);
  for (const y of others) {
    if (y === pid || y === c.victim || !living(W, c, y)) continue;
    const resident = W.people[y].home === p.home;
    // From home you only see someone leave and come back, not where they went in between.
    const spans: { from: number; to: number; work: boolean }[] = [];
    for (const s of clip(timeline(W, c, y), CLAIM_FROM, ASK_TO)) {
      if (resident ? s.place === p.home : s.place !== p.home) continue;
      const last = spans[spans.length - 1], work = s.place === W.people[y].work;
      if (last && last.to >= s.from) { last.to = s.to; last.work &&= work; } else spans.push({ from: s.from, to: s.to, work });
    }
    const away = resident;
    for (const ys of spans) {
      for (const hs of home) {
        const a = Math.max(ys.from, hs.from), b = Math.min(ys.to, hs.to);
        if (b - a < 10) continue;
        if (away) {
          said.push({ k: 'out', pid: y, place: p.home, from: a, to: b });
          const why = ys.work ? 'was at work' : 'was out';
          text += ` ${P(y)} ${why} from ${fmtTime(a)} until ${b >= ASK_TO ? 'after one' : fmtTime(b)}.`;
        } else {
          said.push({ k: 'with', pid: y, place: p.home, from: a, to: b });
          text += ` ${P(y)} was here with me from ${fmtTime(a)} until ${fmtTime(b)}.${c.lovers[pid] === y ? ' Please — keep that quiet.' : ''}`;
        }
      }
    }
  }
  for (const call of W.calls) {
    if (call.day !== c.day || call.to !== p.home || !call.by || call.dur === 0 || call.by === pid) continue;
    if (W.people[call.by].home !== p.home || placeAt(W, c, pid, call.t) !== p.home) continue;
    said.push({ k: 'called', pid: call.by, t: call.t });
    text += ` ${P(call.by)} phoned me around ${fmtTime(round5(call.t))} to say ${pron(W.people[call.by]).subj} would be home late.`;
  }
  return { text, said };
}

export function alibiStatement(W: World, c: Case, pid: string): Statement {
  const p = W.people[pid];
  const spec = c.claims[pid];
  if (spec) return make(c, pid, 'alibi', spec.text, [{ k: 'claim', place: spec.place, from: spec.from, to: ASK_TO }], true);
  if (c.silent.includes(pid) || (pid === c.killer && !c.plan.opp)) {
    return make(c, pid, 'alibi', "I don't have to tell you where I was. Am I under arrest? No? Then we're done here.", []);
  }
  if (c.liars[pid]) {
    const partner = p.partner && W.people[p.partner].alive && W.people[p.partner].home === p.home ? p.partner : null;
    const text = partner && wholeAt(W, c, partner, p.home, CLAIM_FROM, ASK_TO) ? `I was at home with ${P(partner)} all evening.` : 'I was home alone all night. Went to bed early.';
    return make(c, pid, 'alibi', text, [{ k: 'claim', place: p.home, from: CLAIM_FROM, to: ASK_TO }], true);
  }
  const acc = honestAccount(W, c, pid);
  return make(c, pid, 'alibi', acc.text, acc.said);
}

/** What someone says once their lie has been exposed. null = they ask for a lawyer instead. */
export function revisedStatement(W: World, c: Case, pid: string, exposed: StatementKind): Statement | null {
  const V = W.people[c.victim], vp = pron(V);
  if (pid === c.killer) {
    const mode = DIFFICULTIES[c.difficulty].killerConfront;
    if (exposed === 'alibi2' || mode === 'lawyer') return null;
    if (mode === 'breaks') {
      const at = timeline(W, c, pid).find(s => s.place === c.scene)!.from;
      return make(c, pid, 'admission', `All right! I went to see ${V.first} that night — I got there around ${fmtTime(round5(at))}. We argued, but ${vp.subj} was alive when I left, I swear it!`,
        [{ k: 'admission', t: at }]);
    }
    return make(c, pid, 'alibi2', `Okay, okay — I lied. I was at {a:${c.secondLieBar}}, drinking alone until past midnight. Ask the bartender.`,
      [{ k: 'claim', place: c.secondLieBar, from: CLAIM_FROM, to: ASK_TO }], true);
  }
  const acc = honestAccount(W, c, pid);
  if (pid === c.accomplice) {
    const k = W.people[c.killer];
    return make(c, pid, 'alibi2', `…Fine. ${acc.text} ${P(k.id)} asked me to say we were together all evening. ${cap(pron(k).subj)} wasn't here. I don't know where ${pron(k).subj} was.`,
      [...acc.said, { k: 'out', pid: k.id, place: W.people[pid].home, from: CLAIM_FROM, to: ASK_TO }]);
  }
  const l = c.liars[pid];
  if (!l) return null;
  const pre = { affair: "…All right. I wasn't home.", bar: 'Fine.', visit: `All right, I went to see ${V.first} that evening. I was scared you'd think I did it.` }[l.secret];
  const post = { affair: 'Please — nobody can find out.', bar: "I didn't want anyone to know I'm drinking again.", visit: '' }[l.secret];
  return make(c, pid, 'alibi2', `${pre} ${acc.text} ${post}`.trim(), acc.said);
}

export function victimStatement(W: World, c: Case, pid: string): Statement {
  const p = W.people[pid], V = W.people[c.victim], vp = pron(V);
  let text: string;
  if (pid === c.killer) text = `${V.first}? Barely knew ${vp.obj}. We'd run into each other now and then.`;
  else if (c.herrings.includes(pid)) {
    const visited = timeline(W, c, pid).some(s => s.place === c.scene);
    text = `${V.first} was a friend. All right — we argued about money ${vp.subj} lent me for my car.${visited && !c.liars[pid] ? ' I went over that evening to sort it out.' : ''} But I'd never hurt ${vp.obj}.`;
  } else if (V.friends.includes(pid)) text = `${V.first} was a friend of mine. I can't believe this.`;
  else if (p.work === V.work) text = `We worked together at {a:${V.work}}. Kept to ${vp.obj}self mostly.`;
  else if (W.addresses[p.home].building === W.addresses[V.home].building) text = `${cap(vp.subj)} lived in my building. We said hello in the hallway, that's all.`;
  else text = `Never heard of ${vp.obj}.`;
  return make(c, pid, 'victim', text, []);
}

export function enemiesStatement(W: World, c: Case, pid: string): Statement {
  const V = W.people[c.victim], g = c.gossip[pid];
  if (g?.length) return make(c, pid, 'enemies', g.map(x => x.text).join(' '), g.filter(x => x.motive).map(x => ({ k: 'motive', m: x.motive! })));
  if (pid === c.killer) return make(c, pid, 'enemies', `How would I know? Like I said, I barely knew ${pron(V).obj}.`, []);
  const p = W.people[pid];
  return make(c, pid, 'enemies', V.friends.includes(pid) || p.work === V.work ? `Not that I know of. ${V.first} got along with most people.` : "I wouldn't know.", []);
}

export function sawStatement(W: World, c: Case, pid: string): Statement {
  const ws = c.witnesses[pid];
  if (!ws?.length) return make(c, pid, 'saw', pid === c.killer ? "No. I wasn't anywhere near there." : 'No, nothing. Sorry.', []);
  const V = W.people[c.victim], K = W.people[c.killer], L = K.look;
  const parts: string[] = [], said: Said[] = [];
  for (const w of ws.slice().sort((a, b) => a.t - b.t)) {
    if (w.kind === 'visit') {
      parts.push(`Around ${fmtTime(round5(w.t))} I saw ${P(w.pid)} going up to ${V.first}'s.`);
      said.push({ k: 'with', pid: w.pid, place: c.scene, from: w.t, to: w.t + 5 });
    } else if (w.kind === 'noise') {
      const r = round5(w.t);
      parts.push(c.weaponType === 'gun' ? `At about ${fmtTime(r)} I heard a loud bang from {a:${c.scene}} — I thought it was a car backfiring.`
        : `At about ${fmtTime(r)} I heard shouting from {a:${c.scene}}, then a heavy thud. Then nothing.`);
      said.push({ k: 'death', lo: r - 5, hi: r + 5 });
    } else {
      parts.push(`A little after ${fmtTime(round5(w.t) - 5)}, someone came out of {a:${c.scene}}${w.locked ? ' and locked the door behind them — I heard the key turn' : ''}. They hurried past me on the stairs: ${L.height}, ${L.build} build, ${L.hair} hair. I didn't see the face.`);
      said.push({ k: 'leaving', t: w.t, look: { ...L }, locked: w.locked });
    }
  }
  return make(c, pid, 'saw', parts.join(' '), said);
}

export function initialStatement(W: World, c: Case, pid: string, kind: 'alibi' | 'victim' | 'enemies' | 'saw'): Statement {
  if (kind === 'alibi') return alibiStatement(W, c, pid);
  if (kind === 'victim') return victimStatement(W, c, pid);
  if (kind === 'enemies') return enemiesStatement(W, c, pid);
  return sawStatement(W, c, pid);
}

/** Everything anyone could ever say in this case. Revised statements only come out once `after` is shown to be a lie. */
export function allStatements(W: World, c: Case): { initial: Statement[]; gated: { st: Statement; after: string }[] } {
  const initial: Statement[] = [], gated: { st: Statement; after: string }[] = [];
  for (const p of Object.values(W.people)) {
    if (!p.alive || p.arrested) continue;
    for (const k of ['alibi', 'victim', 'enemies', 'saw'] as const) initial.push(initialStatement(W, c, p.id, k));
    const a = initial[initial.length - 4];
    if (!a.lie) continue;
    const r = revisedStatement(W, c, p.id, 'alibi');
    if (!r) continue;
    gated.push({ st: r, after: a.id });
    if (r.lie) {
      const r2 = revisedStatement(W, c, p.id, 'alibi2');
      if (r2) gated.push({ st: r2, after: r.id });
    }
  }
  return { initial, gated };
}
