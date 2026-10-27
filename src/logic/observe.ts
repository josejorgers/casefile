// Evidence → base facts. The same code reads a detective's submitted cards (for the DA, the judge and
// confrontations) and the whole world at once (for the generator's checks), so both always agree on what a piece
// of evidence says.
//
// Costs model the effort to obtain a fact: 1 per document/statement, +1 when a lab test is needed, +3 when the
// person's fingerprints need a warrant, +2 for a statement that only comes out after a confrontation.
import { clockTimes, fmtDate, fmtTime, initials } from '../data';
import { coronerWindow } from '../story';
import type { Case, PrintLoc, Said, Statement, World } from '../types';
import type { DB } from './engine';

export interface Evidence {
  items: string[];
  prints: string[];
  statements: Statement[];
  gated: { st: Statement; after: string }[];
  lab(key: string): boolean;
  dusted(iid: string): boolean;
  sampled(pid: string): boolean;
  printLocs(pid: string): PrintLoc[];
  victimKnown: boolean;
  /** extra cost of a fingerprint sample (warrants) */
  sampleCost(pid: string): number;
}

export const LAB = 1, GATE = 2, WARRANT = 3;

export function nameOf(W: World, pid: string) { const p = W.people[pid]; return p ? `${p.first} ${p.last}` : '?'; }
export function placeName(W: World, place: string): string {
  if (place.startsWith('st:')) return place.slice(3);
  const a = W.addresses[place], b = W.buildings[a.building];
  if (a.kind === 'business') return a.name!;
  if (a.kind === 'payphone') return `the payphone on ${b.street}`;
  if (a.kind === 'lobby') return `${b.street} (lobby)`;
  return `Apt ${a.unit}, ${b.street}`;
}
const itemAddr = (W: World, iid: string) => W.spots[W.items[iid].spot].addr;

export function observe(W: World, c: Case, ev: Evidence, db: DB) {
  const N = (pid: string) => nameOf(W, pid), T = fmtTime;
  const V = c.victim;
  const base = (pred: string, args: (string | number)[], text: string, src: string, cost = 1) => db.add(pred, args, text, cost, 'evidence', [], src);
  if (ev.victimKnown) base('victim', [V], `The victim is ${N(V)}.`, 'victim', 1);
  const items = new Set(ev.items);

  for (const iid of items) {
    const it = W.items[iid], d = it.data, src = 'item:' + iid, addr = itemAddr(W, iid);
    switch (it.kind) {
      case 'weapon': {
        if (d.weaponType === 'gun') {
          if (c.bullet && ev.lab(`bal:${iid}:${c.bullet}`) && c.weapon === iid) base('weaponEst', [iid], `Ballistics: the ${it.name} fired the bullet that killed ${N(V)}.`, src, 1 + LAB);
        } else if (d.bloodOf === V && d.case === c.id) {
          if (addr === c.scene) base('weaponEst', [iid], `The bloodied ${it.name} lay beside the body.`, src);
          else if (ev.lab('blood:' + iid)) base('weaponEst', [iid], `The lab found ${N(V)}'s blood on the ${it.name}.`, src, 1 + LAB);
        }
        if (d.owner && W.people[d.owner] && addr === W.people[d.owner].home) base('possessed', [iid, d.owner], `The ${it.name} was found in ${N(d.owner)}'s home, where ${N(d.owner)} keeps it.`, src);
        if (d.serial) base('serial', [iid, d.serial], `The ${it.name} has serial number ${d.serial}.`, src);
        if (d.brand) base('brand', [iid, d.brand], `The ${it.name} is a ${d.brand}.`, src);
        if (ev.dusted(iid)) for (const pid of it.prints || []) if (ev.sampled(pid)) base('printOn', [iid, pid], `${N(pid)}'s fingerprints are on the ${it.name}.`, src, 1 + LAB + ev.sampleCost(pid));
        break;
      }
      case 'register':
        for (const s of W.gunSales) {
          if (s.pawnedAt) base('regPawned', [s.serial, s.pawnedAt], `Gun register: ${s.serial} was sold to ${N(s.pid)}, who later pawned it at ${placeName(W, s.pawnedAt)}.`, src);
          else base('reg', [s.serial, s.pid], `Gun register: ${s.serial} is registered to ${N(s.pid)}.`, src);
        }
        break;
      case 'pawnledger':
        for (const pw of d.pawns || []) if (pw.serial && pw.to) base('pawnSold', [pw.serial, pw.to], `Pawn ledger: ${pw.what} ${pw.serial}, pawned by ${N(pw.from)}, sold to ${N(pw.to)} on ${fmtDate(pw.dayOut!)}.`, src);
        break;
      case 'knifeblock':
        if (d.brand && d.empty) for (const r of W.addresses[addr].residents) base('block', [r, d.brand], `${N(r)}'s ${d.brand} knife block has one knife missing.`, src);
        break;
      case 'shoeprint':
        if (addr === c.scene && d.case === c.id) base('shoePrint', [iid, d.size!, d.sole!, d.wear!, d.blood ? 'blood' : 'mud'],
          `A ${d.blood ? "shoe print in the victim's blood" : 'muddy shoe print'} at the scene: size ${d.size}, ${d.sole} sole, ${d.wear}.`, src);
        break;
      case 'shoes':
        base('shoes', [iid, d.size!, d.sole!, d.wear!], `${it.name}: size ${d.size}, ${d.sole} sole, ${d.wear}.`, src);
        if (d.owner && addr === W.people[d.owner].home) base('shoesOwner', [iid, d.owner], `The ${it.name.toLowerCase()} were found in ${N(d.owner)}'s bedroom.`, src);
        if (d.tag) base('tag', [iid, d.tag], `The shoes carry repair tag #${d.tag}.`, src);
        break;
      case 'repairs':
        for (const r of d.repairs || []) base('repair', [r.tag, r.pid], `Repair ledger: tag #${r.tag} was issued to ${N(r.pid)}.`, src);
        break;
      case 'paper':
        if (d.day === c.day && W.weather[c.day] != null) base('rain', [W.weather[c.day]!], `The paper: rain began at ${T(W.weather[c.day]!)} that evening, after a dry week.`, src);
        break;
      case 'addressbook':
        if (d.owner === V) {
          base('bookList', [d.entries!.join('|')], `${N(V)}'s address book.`, src);
          for (const e of d.entries!) base('book', [e], `${N(e)} is in ${N(V)}'s address book.`, src);
        }
        break;
      case 'staff': {
        const staff = W.addresses[d.addr!].employees.filter(e => W.people[e].alive && !W.people[e].arrested);
        base('staffList', [d.addr!, staff.join('|')], `Staff roster of ${placeName(W, d.addr!)}.`, src);
        break;
      }
      case 'typewriter':
        base('twAt', [iid, d.addr!], `The typewriter at ${placeName(W, d.addr!)}: ${d.defect}.`, src);
        break;
      case 'keylog': {
        const holders = W.addresses[c.scene].building === d.building ? d.keyring?.[c.scene] : undefined;
        if (holders) {
          base('keyholders', [holders.join('|')], `Spare keys to ${placeName(W, c.scene)}: ${holders.length ? holders.map(N).join(', ') : 'none issued'}.`, src);
          for (const h of holders) base('keyholder', [h], `${N(h)} holds a spare key to the victim's apartment.`, src);
        }
        break;
      }
      case 'door':
        if (d.case === c.id && d.locked) base('locked', [c.scene], 'The apartment was locked with a key from outside; the victim\'s own keys were inside.', src);
        break;
      case 'watch':
        if (d.case === c.id) base('deadIn', [d.t! - 1, d.t! + 1], `The victim's watch stopped at ${T(d.t!)} when it was smashed.`, src);
        break;
      case 'body':
        if (d.case === c.id && ev.lab('coroner:' + iid)) { const [lo, hi] = coronerWindow(c); base('deadIn', [lo, hi], `Coroner: death between ${T(lo)} and ${T(hi)}.`, src, 1 + LAB); }
        break;
      case 'phone':
        for (const call of W.calls) {
          if (call.day !== c.day || (call.from !== d.addr && call.to !== d.addr)) continue;
          base('call', [call.from, call.to, call.t, call.dur], `${T(call.t)}: call from ${placeName(W, call.from)} to ${placeName(W, call.to)}${call.dur ? `, ${call.dur} min` : ', no answer'}.`, src);
          if (!call.dur) continue;
          for (const end of [call.from, call.to]) {
            if (end === c.scene) { if (call.t < c.time) base('aliveAt', [call.t + call.dur], `${N(V)} was on the phone until ${T(call.t + call.dur)}.`, src); continue; }
            const a = W.addresses[end];
            if (a.kind === 'home' && a.residents.length === 1) base('rec', [a.residents[0], end, call.t, call.t + call.dur], `${N(a.residents[0])}, who lives alone, was on the phone at home ${T(call.t)}–${T(call.t + call.dur)}.`, src);
          }
        }
        break;
      case 'tabs':
        if (d.day === c.day) {
          base('roll', [d.addr!, 18 * 60, 27 * 60, 'all'], `Every customer at ${placeName(W, d.addr!)} gets a tab — the book is complete.`, src);
          for (const t of d.tabs!) base('rec', [t.pid, d.addr!, t.t, t.close], `${N(t.pid)} ran a tab at ${placeName(W, d.addr!)} from ${T(t.t)} to ${T(t.close)}.`, src);
        }
        break;
      case 'timesheet':
        if (d.day === c.day) {
          base('roll', [d.addr!, 0, 31 * 60, 'staff'], `${placeName(W, d.addr!)}'s staff clock in and out.`, src);
          for (const e of W.addresses[d.addr!].employees) {
            const p = W.people[e];
            if ((p.diedDay !== undefined && p.diedDay < c.day) || (p.arrestedDay !== undefined && p.arrestedDay < c.day)) continue;
            const ct = clockTimes(e, p.shift, c.day);
            base('rec', [e, d.addr!, ct.in, ct.out], `Timesheet: ${N(e)} clocked in at ${T(ct.in)} and out at ${T(ct.out)}.`, src);
          }
        }
        break;
      case 'ticket':
        if (d.day === c.day) base('rec', [d.owner!, 'st:' + d.street, d.t!, d.t! + 1], `${N(d.owner!)}'s bus ticket was issued at the ${d.street} stop at ${T(d.t!)}.`, src);
        break;
      case 'doc': {
        if (d.hand) base('handwritten', [iid], `${it.name} is handwritten.`, src);
        if (d.hand && d.signed && d.author) base('signedBy', [iid, d.author], `${it.name} is signed by ${N(d.author)}.`, src);
        const m = it.motive;
        if (!m || m.case !== c.id || m.victim !== V) break;
        const w = m.weak ? 'weak' : 'strong';
        if (m.role === 'author') base('authorDoc', [iid], `${it.name} was written by the person with the grudge.`, src);
        if (!m.ident || m.ident === 'name') base('motiveRef', [iid, m.suspect, w], `${it.name} shows ${N(m.suspect)} had a quarrel with the victim.`, src);
        else if (m.ident === 'initials') base('motiveIni', [iid, initials(W.people[m.suspect]), w], `${it.name} shows a quarrel with someone signing "${initials(W.people[m.suspect])}".`, src);
        else base('motiveAnon', [iid, w], `${it.name} shows someone had a grudge against the victim, but names no one.`, src);
        break;
      }
    }
  }

  // Lab comparisons between submitted items
  for (const a of items) for (const b of items) {
    if (a === b) continue;
    const A = W.items[a], B = W.items[b];
    if (A.kind === 'doc' && A.data.typed && B.kind === 'typewriter' && ev.lab(`type:${a}:${b}`) && A.data.typed === b) {
      db.add('typeMatch', [a, b], `Lab: ${A.name} was typed on the typewriter at ${placeName(W, B.data.addr!)}.`, 1 + LAB, 'evidence', [], `lab:type:${a}:${b}`);
    }
    if (A.data.hand && B.data.hand && a < b && (ev.lab(`hand:${a}:${b}`) || ev.lab(`hand:${b}:${a}`)) && A.data.author === B.data.author) {
      db.add('handMatch', [a, b], `Lab: ${A.name} and ${B.name} are in the same handwriting.`, 1 + LAB, 'evidence', [], `lab:hand:${a}:${b}`);
      db.add('handMatch', [b, a], `Lab: ${B.name} and ${A.name} are in the same handwriting.`, 1 + LAB, 'evidence', [], `lab:hand:${a}:${b}`);
    }
  }

  // Fingerprint cards
  for (const pid of ev.prints) {
    if (!ev.sampled(pid)) continue;
    if (ev.printLocs(pid).some(l => l.blood && l.addr === c.scene)) {
      db.add('bloodPrint', [pid], `${N(pid)}'s fingerprint was found in the victim's blood.`, 1 + ev.sampleCost(pid), 'evidence', [], 'print:' + pid);
    }
  }

  for (const st of ev.statements) if (st.case === c.id) addStatement(W, c, db, st, 1, []);
}

/** A statement's assertions become facts. Testimony about others is only ever used to contradict, never to vouch. */
export function addStatement(W: World, c: Case, db: DB, st: Statement, cost: number, from: string[]) {
  const N = (pid: string) => nameOf(W, pid), T = fmtTime, src = 'stmt:' + st.id, who = N(st.pid);
  const add = (pred: string, args: (string | number)[], text: string) => db.add(pred, args, text, cost, from.length ? 'confrontation' : 'evidence', from, src);
  for (const s of st.said as Said[]) {
    switch (s.k) {
      case 'claim': add('claim', [st.pid, s.place, s.from, s.to, st.id], `${who} says they were at ${placeName(W, s.place)} from ${T(s.from)} to ${T(s.to)}.`); break;
      case 'out': add('testNot', [s.pid, s.place, s.from, s.to], `${who}: ${N(s.pid)} was not at ${placeName(W, s.place)} from ${T(s.from)} to ${T(s.to)}.`); break;
      case 'with': add('testAt', [s.pid, s.place, s.from, s.to], `${who}: ${N(s.pid)} was at ${placeName(W, s.place)} around ${T(s.from)}.`); break;
      case 'called': add('calledMe', [st.pid, s.pid, s.t], `${who}: ${N(s.pid)} phoned at about ${T(s.t)}.`); break;
      case 'motive':
        if (s.m.case === c.id && s.m.victim === c.victim) add('motiveSaid', [s.m.suspect, s.m.weak ? 'weak' : 'strong'], `${who} describes trouble between ${N(s.m.suspect)} and the victim.`);
        break;
      case 'alive': add('aliveAt', [s.t], `${who}: the victim was alive at ${T(s.t)}.`); break;
      case 'death': add('deadIn', [s.lo, s.hi], `${who} heard the killing around ${T((s.lo + s.hi) / 2)}.`); break;
      case 'leaving':
        if (s.locked) add('killerDesc', [s.look.height, s.look.build, s.look.hair], `${who}: whoever locked the door on the way out was ${s.look.height}, ${s.look.build} build, ${s.look.hair} hair.`);
        break;
      case 'admission': add('admission', [st.pid, s.t], `${who} admits being in the victim's apartment around ${T(s.t)}.`); break;
    }
  }
}
