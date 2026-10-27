// The District Attorney (charging decisions) and the judge (warrants). Both run the case language over the cards
// the detective submits — nothing else. The board itself is free-form: links mean whatever the detective wants.
import { initials } from './data';
import { analyse } from './logic/analyse';
import { explain, sources } from './logic/engine';
import type { DB, ProofNode } from './logic/engine';
import type { Evidence } from './logic/observe';
import { PILLARS, connections } from './logic/rules';
import type { Pillar } from './logic/rules';
import { K, W, curCase, fullName, person, printLabel } from './state';
import type { Card, Statement } from './types';

export type { Pillar };
export const PILLAR_LABEL: Record<Pillar, string> = { means: 'Means', presence: 'Presence', motive: 'Motive', opportunity: 'Opportunity' };
export const IDENTIFYING: Pillar[] = ['means', 'presence'];

/** Everything the detective has established that these cards carry. */
export function playerEvidence(cardIds: string[], extra: Statement[] = []): Evidence {
  const c = curCase(), cards = cardIds.map(id => K.board.cards[id]).filter((x): x is Card => !!x);
  return {
    items: cards.filter(x => x.type === 'item').map(x => x.ref!),
    prints: cards.filter(x => x.type === 'print').map(x => x.ref!),
    statements: [...cards.filter(x => x.type === 'statement').map(x => K.statements[x.ref!]).filter(Boolean), ...extra],
    gated: [],
    lab: key => !!K.lab[key],
    dusted: iid => !!K.itemDusted[iid],
    sampled: pid => !!K.samples[pid],
    printLocs: pid => K.printFound[pid] || [],
    victimKnown: !!K.victimId[c.id],
    sampleCost: () => 0,
  };
}

export interface Verdict {
  victimOk: boolean; suspect: string | null;
  pillars: Record<Pillar, ProofNode | null>;
  count: number; ok: boolean; notes: string[];
}

export function cardTitle(x: Card): string {
  if (x.type === 'item') return W.items[x.ref!].name;
  if (x.type === 'statement') return `${fullName(K.statements[x.ref!].pid)}'s statement`;
  if (x.type === 'print') return `Print ${printLabel(x.ref!)}`;
  if (x.type === 'person') return fullName(x.ref!);
  return x.title || 'That card';
}
const cardSrc = (x: Card) => x.type === 'item' ? 'item:' + x.ref : x.type === 'print' ? 'print:' + x.ref : x.type === 'statement' ? 'stmt:' + x.ref : null;

export function evaluateCase(): Verdict {
  const c = curCase(), f = K.form, cards = K.board.cards;
  const r: Verdict = { victimOk: false, suspect: null, pillars: { means: null, presence: null, motive: null, opportunity: null }, count: 0, ok: false, notes: [] };
  const vc = f.victim ? cards[f.victim] : undefined, sc = f.suspect ? cards[f.suspect] : undefined;
  if (!vc || vc.type !== 'person') r.notes.push('No victim named.');
  else if (!K.victimId[c.id]) r.notes.push('The victim has not been formally identified (check the body for ID, or take its fingerprints).');
  else if (vc.ref !== c.victim) r.notes.push(`The identified victim is not ${fullName(vc.ref!)}.`);
  else r.victimOk = true;
  if (!sc || sc.type !== 'person') { r.notes.push('No suspect named.'); return r; }
  const S = sc.ref!;
  r.suspect = S;
  if (S === c.victim) { r.notes.push('The suspect cannot be the victim.'); return r; }

  const ids = [...new Set([f.weapon, ...f.evidence].filter((x): x is string => !!x))];
  const db = analyse(W, c, playerEvidence(ids));
  for (const k of PILLARS) { const fk = db.get(k, S); r.pillars[k] = fk ? explain(db, fk.key) : null; }
  r.count = PILLARS.filter(k => r.pillars[k]).length;
  r.ok = r.victimOk && !!db.get('guilty', S) && S === c.killer;
  r.notes.push(...hints(db, S, ids));
  return r;
}

/** Why the case falls short: dead ends in what was submitted. */
function hints(db: DB, S: string, ids: string[]): string[] {
  const out: string[] = [], N = fullName;
  const used = new Set<string>();
  for (const k of PILLARS) { const f = db.get(k, S); if (f) sources(db, f.key, used); }
  const weapon = K.form.weapon ? K.board.cards[K.form.weapon] : undefined;
  if (weapon && weapon.type === 'item') {
    const it = W.items[weapon.ref!];
    if (it.kind !== 'weapon') out.push(`The ${it.name} is not a weapon.`);
    else if (!db.get('weaponEst', it.id)) out.push(`Nothing submitted establishes the ${it.name} as the murder weapon (ballistics, blood analysis…).`);
    else if (!db.where('tie', it.id).some(t => t.args[1] === S)) out.push(`The ${it.name} is the murder weapon, but nothing submitted ties it to ${N(S)}.`);
  }
  for (const sp of db.all('shoePrint')) {
    const matching = db.all('shoes').filter(s => [1, 2, 3].every(i => s.args[i] === sp.args[i]));
    if (matching.length && !matching.some(s => db.where('shoesOf', s.args[0]).length)) out.push('The shoes match the print, but nothing submitted shows whose shoes they are.');
    else if (!matching.length && db.all('shoes').some(s => s.args[1] === sp.args[1] && s.args[2] === sp.args[2])) out.push('Some shoes have the same size and sole as the print, but the wear marks differ.');
  }
  if (db.get('locked', curCase().scene) && db.all('keyholders').length && !db.get('presence', S)) {
    const holders = String(db.all('keyholders')[0].args[0]).split('|').filter(Boolean);
    const ws = db.all('window').sort((a, b) => (Number(a.args[1]) - Number(a.args[0])) - (Number(b.args[1]) - Number(b.args[0])));
    const w = ws[0];
    const left = holders.filter(h => !w || !db.get('accounted', h, w.args[0], w.args[1]));
    if (!w) out.push('The door was locked with a key, but the DA has nothing establishing the time of death.');
    else if (left.length > 1) out.push(`The door was locked with a key. Key holders not ruled out for the time of death: ${left.map(N).join(', ')}.`);
  }
  for (const mi of db.all('motiveIni')) if (!db.get('motive', S) || !sources(db, db.get('motive', S)!.key).has(mi.src!)) {
    const ini = String(mi.args[1]);
    if (ini === initials(person(S)) && !db.get('motive', S)) out.push(`A document is signed "${ini}" — nothing submitted shows that's ${N(S)} and nobody else.`);
  }
  if (db.all('motiveAnon').length && !db.get('motive', S)) out.push('An anonymous letter shows a grudge, but nothing submitted shows who wrote it.');
  if (db.where('claim', S).length && !db.where('lied', S).length) out.push(`${N(S)}'s account of the night is not contradicted by anything submitted.`);
  for (const cid of ids) {
    const x = K.board.cards[cid], src = x && cardSrc(x);
    if (!src || used.has(src) || cid === K.form.weapon) continue;
    if (x.type === 'item' && ['bullet', 'body'].includes(W.items[x.ref!].kind)) continue; // lab results are credited to the weapon
    out.push(`${cardTitle(x)}: adds nothing to the case against ${N(S)}.`);
  }
  return out;
}

export function submitCase(): Verdict {
  const c = curCase(), r = evaluateCase();
  c.attempts++;
  if (r.ok) {
    c.solved = true;
    const k = person(c.killer);
    k.arrested = true; k.arrestedDay = W.day;
    K.log.unshift({ day: W.day, msg: `Case #${c.id} closed: ${fullName(c.killer)} charged with murder.` });
  } else K.log.unshift({ day: W.day, msg: `Case #${c.id}: the DA declined to file charges.` });
  return r;
}

// ---------- Warrants: the judge wants two independent connections between the person and the victim.
export interface WarrantRuling { granted: boolean; reasons: string[]; notes: string[] }

export function evaluateWarrant(pid: string, cids: string[]): WarrantRuling {
  const c = curCase();
  const db = analyse(W, c, playerEvidence(cids));
  const conns = connections(db, pid);
  const used = new Set<string>();
  for (const cn of conns) sources(db, cn.fact.key, used);
  const notes: string[] = [];
  for (const cid of cids) {
    const x = K.board.cards[cid], src = x && cardSrc(x);
    if (src && !used.has(src)) notes.push(`${cardTitle(x)} doesn't connect ${fullName(pid)} to the victim.`);
  }
  return { granted: conns.length >= 2, reasons: conns.map(cn => cn.text), notes };
}
