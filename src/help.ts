// Optional help for stuck detectives: the next step (with its reason), the killer's name, or the full proof.
// The next step comes from the cheapest proof of guilt that exists in the world, re-costed so that evidence the
// detective already holds is free. The first piece of that proof the detective still lacks becomes a concrete action.
// Nothing here changes the world, the board or the DA.
import { cardTitle, playerEvidence } from './da';
import { analyse, omniscientEvidence } from './logic/analyse';
import type { DB, Fact } from './logic/engine';
import { sources } from './logic/engine';
import { WARRANT } from './logic/observe';
import { connections } from './logic/rules';
import { K, W, caseKey, curCase, findCard, fullName } from './state';
import type { Card, Case, QKind, StatementKind } from './types';

/** A concrete action, in machine form (for tests) and prose (for the player; `{p:id}`/`{a:id}` mark pinnable names). */
export type HelpAction =
  | { do: 'take'; item: string }
  | { do: 'bodyprints'; item: string }
  | { do: 'lab'; test: 'bal' | 'blood' | 'coroner' | 'type' | 'hand' | 'dust'; a: string; b?: string }
  | { do: 'dust-spot'; spot: string }
  | { do: 'pin-print'; pid: string }
  | { do: 'pin-statement'; id: string }
  | { do: 'ask'; pid: string; q: QKind }
  | { do: 'warrant'; pid: string; cards: string[] }
  | { do: 'confront'; stmt: string; cards: string[] }
  | { do: 'file'; cards: string[] }
  | { do: 'none' };

export interface Hint { action: HelpAction; text: string; reason: string }

/** "Spare key register, 33 Harbor Road" → "spare key register, 33 Harbor Road" */
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const onBoard = (type: Card['type'], ref: string) => !!findCard(type, ref);
const itemAt = (iid: string) => W.spots[W.items[iid].spot];

// ---------- What one missing piece of evidence needs next (null = the detective has it)

const HELD_NOT: Hint = { action: { do: 'none' }, text: '', reason: '' };

/** `db` null = only checking whether the detective holds the evidence (cheap). */
function sampleStep(c: Case, pid: string, db: DB | null): Hint | null {
  if (K.samples[pid]) return null;
  if (!db) return HELD_NOT;
  if (!c.refusers.includes(pid) || K.warrants[caseKey(c, pid)]) {
    return { action: { do: 'ask', pid, q: 'prints' }, text: `Ask {p:${pid}} for their fingerprints.`, reason: 'A known sample is the only way to put a name to a print.' };
  }
  return warrantStep(c, pid, db);
}

function warrantStep(c: Case, pid: string, db: DB): Hint {
  const reason = `{p:${pid}} refuses to give fingerprints. The judge orders them when you show two connections between them and the victim.`;
  const boardIds = Object.values(K.board.cards).filter(x => x.type === 'item' || x.type === 'statement').map(x => x.id);
  const boardDb = analyse(W, c, playerEvidence(boardIds));
  const conns = connections(boardDb, pid);
  if (conns.length >= 2) {
    // Name only the cards the first two connections rest on.
    const used = new Set<string>();
    for (const cn of conns.slice(0, 2)) sources(boardDb, cn.fact.key, used);
    const cards = [...used].map(cardFor).filter((x): x is Card => !!x);
    const ids = [...new Set(cards.map(x => x.id))];
    return { action: { do: 'warrant', pid, cards: ids }, text: `Talk to {p:${pid}}, ask for their prints and request a warrant with: ${ids.map(id => cardTitle(K.board.cards[id])).join('; ')}.`, reason };
  }
  // Not enough on the board yet: work towards the cheapest connection the board doesn't show.
  const have = new Set(conns.map(cn => cn.text));
  const missing = connections(db, pid).filter(cn => !have.has(cn.text)).sort((a, b) => a.fact.cost - b.fact.cost);
  for (const cn of missing) {
    const h = firstMissing(c, db, cn.fact.key, new Set());
    if (h) return { ...h, reason: `${reason} ${h.reason}` };
  }
  return { action: { do: 'none' }, text: `You need two cards connecting {p:${pid}} to the victim before the judge will order their fingerprints.`, reason };
}

/** The next action towards one piece of evidence, or null if the detective has it on the board already. */
function evidenceStep(c: Case, db: DB | null, f: Fact): Hint | null {
  const src = f.src!;
  const take = (iid: string, reason = ''): Hint => {
    const s = itemAt(iid);
    return { action: { do: 'take', item: iid }, text: `Go to {a:${s.addr}}, search the ${low(s.name)} and take the ${low(W.items[iid].name)}.`, reason };
  };
  if (src === 'victim') {
    if (K.victimId[c.id]) return null;
    if (c.wallet) return take(c.wallet, "The DA can't charge anyone until the victim is identified, and the wallet says who it is.");
    if (!onBoard('item', c.body)) return take(c.body, 'The DA needs the victim identified; start with the body.');
    return { action: { do: 'bodyprints', item: c.body }, text: 'Select the body on the board and take its fingerprints.', reason: "The DA can't charge anyone until the victim is identified." };
  }
  const [kind, a, b, d] = src.split(':');
  if (kind === 'item') {
    const it = W.items[a];
    if (!onBoard('item', a)) return take(a);
    if (f.pred === 'weaponEst' && it.data.weaponType === 'gun') {
      if (!onBoard('item', c.bullet!)) return take(c.bullet!, 'Ballistics needs the bullet as well as the gun.');
      if (!K.lab[`bal:${a}:${c.bullet}`]) return { action: { do: 'lab', test: 'bal', a, b: c.bullet! }, text: `Select the ${low(it.name)} on the board and run ballistics against the bullet.`, reason: '' };
    }
    if (f.pred === 'weaponEst' && it.data.weaponType !== 'gun' && itemAt(a).addr !== c.scene && !K.lab['blood:' + a]) {
      return { action: { do: 'lab', test: 'blood', a }, text: `Select the ${low(it.name)} on the board and order a blood analysis.`, reason: '' };
    }
    if (f.pred === 'deadIn' && it.kind === 'body' && !K.lab['coroner:' + a]) {
      return { action: { do: 'lab', test: 'coroner', a }, text: "Select the body on the board and request the coroner's report.", reason: '' };
    }
    if (f.pred === 'printOn') {
      if (!K.itemDusted[a]) return { action: { do: 'lab', test: 'dust', a }, text: `Select the ${low(it.name)} on the board and dust it for prints.`, reason: '' };
      return sampleStep(c, String(f.args[1]), db);
    }
    return null;
  }
  if (kind === 'lab') {
    // lab:type:<doc>:<typewriter> or lab:hand:<doc>:<doc>
    const [x, y] = [b, d];
    if (!onBoard('item', x)) return take(x);
    if (!onBoard('item', y)) return take(y);
    const done = a === 'type' ? K.lab[`type:${x}:${y}`] : K.lab[`hand:${x}:${y}`] || K.lab[`hand:${y}:${x}`];
    if (done) return null;
    return a === 'type'
      ? { action: { do: 'lab', test: 'type', a: x, b: y }, text: `Select the ${low(W.items[x].name)} on the board and compare its typeface with the ${low(W.items[y].name)}.`, reason: '' }
      : { action: { do: 'lab', test: 'hand', a: x, b: y }, text: `Select the ${low(W.items[x].name)} on the board and compare its handwriting with the ${low(W.items[y].name)}.`, reason: '' };
  }
  if (kind === 'print') {
    const pid = a;
    const spot = W.addresses[c.scene].spots.find(sid => W.spots[sid].bloodPrints.includes(pid))!;
    if (!K.dusted[spot]) return { action: { do: 'dust-spot', spot }, text: `At the crime scene, dust the ${low(W.spots[spot].name)} for prints.`, reason: '' };
    if (!onBoard('print', pid)) return { action: { do: 'pin-print', pid }, text: `Pin print ${K.printLabels[pid] ?? ''} (the one in blood) to the board.`.replace('  ', ' '), reason: '' };
    return sampleStep(c, pid, db);
  }
  if (kind === 'stmt') {
    const id = src.slice(5);
    const [, pid, sk] = id.split('-') as [string, string, StatementKind];
    if (K.statements[id]) return onBoard('statement', id) ? null : { action: { do: 'pin-statement', id }, text: `Pin {p:${pid}}'s statement (${label(sk)}) to the board.`, reason: '' };
    if (f.rule === 'confrontation') {
      if (!db) return HELD_NOT;
      const lied = db.facts.get(f.from[0])!;
      const prev = String(lied.args[1]);
      const cards = [...sources(db, lied.key)].filter(s => s !== 'stmt:' + prev).map(cardFor).filter((x): x is Card => !!x);
      return { action: { do: 'confront', stmt: prev, cards: cards.map(x => x.id) }, text: `Talk to {p:${pid}} and confront their ${label(prev.split('-')[2] as StatementKind)} with: ${cards.map(cardTitle).join('; ')}.`, reason: 'Shown the lie, they will tell a different story.' };
    }
    const where = W.people[pid];
    return { action: { do: 'ask', pid, q: sk as QKind }, text: `Talk to {p:${pid}} (home: {a:${where.home}}, work: {a:${where.work}}) and ask: "${QUESTION_TEXT[sk as 'alibi'](c)}" Pin the answer.`, reason: '' };
  }
  return null;
}

const label = (k: StatementKind) => ({ alibi: 'alibi', alibi2: 'revised alibi', victim: 'statement about the victim', enemies: "statement about the victim's enemies", saw: 'statement about what they noticed', admission: 'admission' }[k]);
const QUESTION_TEXT: Record<'alibi' | 'victim' | 'enemies' | 'saw', (c: Case) => string> = {
  alibi: () => 'Where were you that night?',
  victim: c => `How did you know ${fullName(c.victim)}?`,
  enemies: c => `Did ${fullName(c.victim)} have trouble with anyone?`,
  saw: () => 'Did you see or hear anything unusual?',
};

function cardFor(src: string): Card | undefined {
  const [kind, ...rest] = src.split(':');
  if (kind === 'item') return findCard('item', rest[0]);
  if (kind === 'stmt') return findCard('statement', rest.join(':'));
  if (kind === 'print') return findCard('print', rest[0]);
  if (kind === 'lab') return findCard('item', rest[1]);
  return undefined;
}

// ---------- Why a piece of evidence matters: from the rule that uses it (never names anyone)
const WHY: Record<string, string> = {
  payphone: 'A payphone call, with whoever answered it, places the caller on that street.',
  'shoe-owner': 'It shows whose shoes they are.',
  'shoe-match': 'Shoes can be matched to the print at the scene.',
  mud: 'A muddy print after the rain dates a visit to the scene.',
  contradiction: "It can prove someone's account of the night false.",
  'time-of-death': 'It narrows down the time of death.',
  alibi: 'It shows where someone really was at the time of death.',
  near: 'It can place someone near the scene around the time of death.',
  presence: 'It can put the killer in the apartment during the killing (Presence).',
  elimination: 'The door was locked with a key: rule out the key holders who were elsewhere (Presence).',
  'weapon-tie': 'It can tie the murder weapon to a person (Means).',
  means: 'It establishes the murder weapon (Means).',
  motive: 'It can show who had a motive (Motive).',
  opportunity: 'It can show who had the opportunity (Opportunity).',
  confrontation: 'Shown the lie, they will tell a different story.',
};
const RELABEL = new Set(['record', 'testimony', 'evidence']);

/** Depth-first: prerequisites before the evidence that needs them. Returns the first step the detective lacks. */
function firstMissing(c: Case, db: DB, key: string, seen: Set<string>, why = ''): Hint | null {
  if (seen.has(key)) return null;
  seen.add(key);
  const f = db.facts.get(key);
  if (!f) return null;
  const mine = f.src ? evidenceStep(c, db, f) : null;
  if (f.src && !mine) return null; // held: nothing below it matters
  const nextWhy = RELABEL.has(f.rule) ? why : WHY[f.rule] ?? why;
  for (const k of f.from) {
    const h = firstMissing(c, db, k, seen, nextWhy);
    if (h) return h;
  }
  if (mine) return { ...mine, reason: [mine.reason, why].filter(Boolean).join(' ') };
  return null;
}

/** Evidence the detective holds costs nothing, so the cheapest proof is the one closest to their board. */
function helpDB(c: Case): DB {
  const ev = omniscientEvidence(W, c);
  const reachable = (st: { id: string; pid: string }) => !!K.statements[st.id] || !K.lawyered[caseKey(c, st.pid)];
  ev.statements = ev.statements.filter(reachable);
  ev.gated = ev.gated.filter(g => reachable(g.st));
  ev.sampleCost = pid => (K.samples[pid] || !c.refusers.includes(pid) || K.warrants[caseKey(c, pid)] ? 0 : WARRANT);
  let db!: DB;
  db = analyse(W, c, ev, d => {
    db = d;
    let changed = false;
    for (const f of d.facts.values()) if (f.src && f.cost > 0 && !evidenceStep(c, null, f)) { f.cost = 0; changed = true; }
    return changed;
  });
  return db;
}

export function nextStep(): Hint {
  const c = curCase();
  if (c.solved) return { action: { do: 'none' }, text: 'This case is closed.', reason: '' };
  const db = helpDB(c);
  const g = db.get('guilty', c.killer);
  if (!g) return { action: { do: 'none' }, text: "With what's left to find, this case can no longer be proven. Take the next case.", reason: '' };
  const h = firstMissing(c, db, g.key, new Set());
  if (h) return h;
  const cards = [...sources(db, g.key)].map(cardFor).filter((x): x is Card => !!x);
  const ids = [...new Set(cards.map(x => x.id))];
  return {
    action: { do: 'file', cards: ids },
    text: `You have enough. File the case with the DA. The cards that make it: ${ids.map(id => cardTitle(K.board.cards[id])).join('; ')}.`,
    reason: 'Everything the DA needs is already on your board.',
  };
}

// ---------- Recording help use (saved with the case)
export type HelpLevel = 'step' | 'killer' | 'proof';
export function recordHelp(level: HelpLevel) {
  const c = curCase();
  const h = (c.help ||= { steps: 0, killer: false, proof: false });
  if (level === 'step') h.steps++;
  else h[level] = true;
}
export function helpSummary(c: Case): string {
  const h = c.help;
  if (!h || (!h.steps && !h.killer && !h.proof)) return 'Solved without help.';
  const parts: string[] = [];
  if (h.steps) parts.push(`${h.steps} hint${h.steps > 1 ? 's' : ''}`);
  if (h.killer) parts.push('the killer revealed');
  if (h.proof) parts.push('the full proof revealed');
  return `Solved with ${parts.join(', ')}.`;
}
