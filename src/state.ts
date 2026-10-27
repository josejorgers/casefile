// Game state (W = world truth, K = what the detective knows), board cards and investigation actions.
import { generateCase } from './crime';
import { generateWorld } from './world';
import type { Address, Card, CardType, Case, DifficultyId, FactKey, Knowledge, Person, PrintLoc, World } from './types';

export let W: World;
export let K: Knowledge;
export function setState(w: World, k: Knowledge) { W = w; K = k; }

export function newKnowledge(): Knowledge {
  return {
    board: { cards: {}, links: [], view: { x: 0, y: 0, z: 1 } }, nextCard: 1,
    printLabels: {}, nextLabel: 0, samples: {}, printFound: {},
    searched: {}, dusted: {}, itemDusted: {}, taken: {}, lab: {}, facts: {},
    statements: {}, answers: {}, victimId: {}, visited: {}, warrants: {}, lawyered: {}, confronted: {},
    current: '', form: { victim: null, suspect: null, weapon: null, evidence: [] }, log: [],
  };
}

export const person = (id: string): Person => W.people[id];
export const addr = (id: string): Address => W.addresses[id];
export const curCase = (): Case => W.cases[W.cases.length - 1];
export const caseById = (id: number): Case => W.cases[id - 1];
export const fullName = (id: string) => { const p = W.people[id]; return p ? `${p.first} ${p.last}` : '?'; };
export const itemAddr = (iid: string) => W.spots[W.items[iid].spot].addr;
export const caseKey = (c: Case, pid: string) => `${c.id}:${pid}`;

export function addrName(id: string): string {
  const a = W.addresses[id], b = W.buildings[a.building];
  if (a.kind === 'business') return `${a.name}, ${b.street}`;
  if (a.kind === 'lobby') return `${b.street} (lobby)`;
  if (a.kind === 'payphone') return `Payphone, ${b.street}`;
  return `Apt ${a.unit}, ${b.street}`;
}
export function shortAddr(id: string): string { const a = addr(id); return a.kind === 'business' ? a.name! : addrName(id); }

export function caseOfItem(iid: string): Case | undefined {
  return W.cases.find(c => [c.body, c.wallet, c.bullet, c.weapon, c.shoeprint, c.watch, c.door].includes(iid));
}

export function log(msg: string) { K.log.unshift({ day: W.day, msg }); if (K.log.length > 150) K.log.pop(); }
export function fact(pid: string, ...keys: FactKey[]) { const f = (K.facts[pid] ||= {}); for (const k of keys) f[k] = true; }
export const knows = (pid: string, key: FactKey) => !!K.facts[pid]?.[key];

export function printLabel(pid: string): string {
  if (!(pid in K.printLabels)) {
    const n = K.nextLabel++;
    K.printLabels[pid] = String.fromCharCode(65 + (n % 26)) + (n >= 26 ? Math.floor(n / 26) + 1 : '');
  }
  return K.printLabels[pid];
}
function recordPrint(pid: string, loc: PrintLoc) {
  printLabel(pid);
  const arr = (K.printFound[pid] ||= []);
  if (!arr.some(x => x.spot === loc.spot && x.item === loc.item && !!x.blood === !!loc.blood)) arr.push(loc);
}
export function printWhere(loc: PrintLoc): string {
  if (loc.spot) { const s = W.spots[loc.spot]; return `${loc.blood ? 'IN BLOOD — ' : ''}${s.name}, ${addrName(s.addr)}`; }
  return `on ${W.items[loc.item!].name}`;
}

// ---------- Board cards (pure state; the board view renders them)
let placeHint = () => ({ x: 400, y: 300 });
export function setPlaceHint(f: () => { x: number; y: number }) { placeHint = f; }

export function findCard(type: CardType, ref: string): Card | undefined {
  return Object.values(K.board.cards).find(c => c.type === type && c.ref === ref);
}
export function addCard(type: CardType, ref: string | null, opts: { near?: string | null; title?: string } = {}): Card {
  let c = ref != null ? findCard(type, ref) : undefined;
  if (!c) {
    const near = opts.near ? K.board.cards[opts.near] : undefined;
    const h = placeHint();
    const origin = near ? { x: near.x, y: near.y } : { x: h.x - 85, y: h.y - 50 };
    const others = Object.values(K.board.cards);
    const isFree = (q: { x: number; y: number }) => others.every(o => Math.abs(o.x - q.x) > 185 || Math.abs(o.y - q.y) > 115);
    let pos: { x: number; y: number } | null = null;
    // Spiral outwards until we find a spot that doesn't cover another card.
    for (let i = 0; i < 80 && !pos; i++) {
      const ang = Math.random() * Math.PI * 2, r = (near ? 200 : 0) + i * 14;
      const q = { x: origin.x + Math.cos(ang) * r, y: origin.y + Math.sin(ang) * r * 0.7 };
      if (isFree(q)) pos = q;
    }
    pos ||= { x: origin.x + 200, y: origin.y };
    c = { id: 'c' + K.nextCard++, type, ref, x: Math.round(pos.x), y: Math.round(pos.y), title: opts.title || '', notes: '' };
    K.board.cards[c.id] = c;
  }
  if (opts.near) addLink(c.id, opts.near);
  return c;
}
export function addLink(a: string, b: string) {
  if (!a || !b || a === b || !K.board.cards[a] || !K.board.cards[b]) return;
  if (!K.board.links.some(l => (l.a === a && l.b === b) || (l.a === b && l.b === a))) K.board.links.push({ a, b });
}
export function toggleLink(a: string, b: string) {
  const i = K.board.links.findIndex(l => (l.a === a && l.b === b) || (l.a === b && l.b === a));
  if (i >= 0) K.board.links.splice(i, 1); else addLink(a, b);
}
export function removeCard(cid: string) {
  delete K.board.cards[cid];
  K.board.links = K.board.links.filter(l => l.a !== cid && l.b !== cid);
  const f = K.form;
  if (f.victim === cid) f.victim = null;
  if (f.suspect === cid) f.suspect = null;
  if (f.weapon === cid) f.weapon = null;
  f.evidence = f.evidence.filter(x => x !== cid);
}
/** The reference a card stands for, as used in statement contradictions. */
export function cardRef(c: Card): string | null {
  if (c.type === 'item') return `item:${c.ref}`;
  if (c.type === 'statement') return `stmt:${c.ref}`;
  return null;
}

// ---------- Investigation actions
export function visit(aid: string) { K.current = aid; if (!K.visited[aid]) log(`Went to ${addrName(aid)}.`); K.visited[aid] = true; }
export function searchSpot(sid: string) { K.searched[sid] = true; }
export function dustSpot(sid: string) {
  K.dusted[sid] = true;
  const s = W.spots[sid];
  for (const pid of s.prints) recordPrint(pid, { spot: sid, addr: s.addr });
  for (const pid of s.bloodPrints) recordPrint(pid, { spot: sid, addr: s.addr, blood: true });
}
export function dustItem(iid: string) {
  K.itemDusted[iid] = true;
  for (const pid of W.items[iid].prints || []) recordPrint(pid, { item: iid, addr: itemAddr(iid) });
}
export function takeItem(iid: string): Card {
  readItem(iid);
  K.taken[iid] = true;
  const ac = findCard('address', itemAddr(iid));
  return addCard('item', iid, { near: ac?.id });
}
export function readItem(iid: string) {
  const it = W.items[iid], d = it.data;
  if (it.facts) for (const [pid, ...keys] of it.facts) fact(pid, ...keys);
  if (it.kind === 'addressbook') for (const e of d.entries!) fact(e, 'home', 'phone');
  if (it.kind === 'staff') for (const e of addr(d.addr!).employees) fact(e, 'work', 'job');
  if (it.kind === 'mailboxes') for (const aid of W.buildings[d.building!].addresses) for (const r of addr(aid).residents) fact(r, 'home');
  if (it.kind === 'shoes') fact(d.owner!, 'shoes');
  if (it.kind === 'wallet') {
    fact(d.owner!, 'home', 'phone', 'look');
    if (!K.victimId[d.case!]) log(`Identified the victim as ${fullName(d.owner!)}.`);
    identifyVictim(caseById(d.case!));
  }
}
// Once the body has a name, the victim gets a person card tied to the body.
function identifyVictim(c: Case) {
  K.victimId[c.id] = true;
  const bc = findCard('item', c.body);
  addCard('person', c.victim, { near: bc?.id });
}
export function samplePerson(pid: string) { K.samples[pid] = true; printLabel(pid); }
export function bodyPrints(iid: string) {
  const c = caseOfItem(iid)!;
  K.lab['bodyprints:' + iid] = 'done';
  samplePerson(c.victim);
  fact(c.victim, 'home', 'phone');
  if (!K.victimId[c.id]) log(`Body prints matched city records: ${fullName(c.victim)}.`);
  identifyVictim(c);
}
export function coronerReport(iid: string) { K.lab['coroner:' + iid] = 'done'; }
export function ballistics(gunId: string, bulletId: string): boolean {
  const c = caseOfItem(bulletId);
  const match = !!c && c.weapon === gunId;
  K.lab[`bal:${gunId}:${bulletId}`] = match ? 'match' : 'nomatch';
  log(`Ballistics: ${W.items[gunId].name} vs ${W.items[bulletId].name} — ${match ? 'MATCH' : 'no match'}.`);
  return match;
}
export function bloodTest(iid: string) { K.lab['blood:' + iid] = 'done'; }
/** Compare a typed document with a typewriter. */
export function compareType(docId: string, twId: string): boolean {
  const match = W.items[docId].data.typed === twId;
  K.lab[`type:${docId}:${twId}`] = match ? 'match' : 'nomatch';
  log(`Typeface: ${W.items[docId].name} vs ${W.items[twId].name} — ${match ? 'MATCH' : 'no match'}.`);
  return match;
}
/** Compare two handwritten documents. */
export function compareHand(a: string, b: string): boolean {
  const A = W.items[a], B = W.items[b];
  const match = !!A.data.author && A.data.author === B.data.author;
  K.lab[`hand:${a}:${b}`] = match ? 'match' : 'nomatch';
  log(`Handwriting: ${A.name} vs ${B.name} — ${match ? 'same writer' : 'different writers'}.`);
  return match;
}
export function lookup(pid: string) { fact(pid, 'home', 'phone'); }

// ---------- Lifecycle
export function startNewCase(difficulty: DifficultyId): Case | null {
  const c = generateCase(W, difficulty);
  if (!c) return null;
  K.form = { victim: null, suspect: null, weapon: null, evidence: [] };
  K.current = c.scene;
  K.visited[c.scene] = true;
  for (const sid of addr(c.scene).spots) { delete K.searched[sid]; delete K.dusted[sid]; }
  addCard('address', c.scene);
  log(`Case #${c.id} (${difficulty}): body reported at ${addrName(c.scene)}.`);
  return c;
}

export function newWorld(seed: number) {
  setState(generateWorld(seed), newKnowledge());
}
