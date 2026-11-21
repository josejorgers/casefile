// Soundness of generated cases, per difficulty:
//  1. Omniscient check: with every document, lab test, statement and confrontation in the world, the case
//     language proves the killer and nobody else, and the shortest proof is as long as the difficulty asks.
//  2. Play-through: a detective who follows the shortest proof using real game actions (taking items, lab work,
//     asking, confronting with cards, warrants) gets charges filed by the DA.
//  3. The same detective, naming each innocent person instead with every card they gathered, never succeeds.
//  4. Optional help: a detective who only follows the "next step" hints gets charges filed, and no hint ever
//     points at something unreachable or repeats without progress.
import { describe, expect, it } from 'vitest';
import { checkCase } from '../src/crime';
import { DIFFICULTIES } from '../src/data';
import { evaluateCase, evaluateWarrant, submitCase } from '../src/da';
import { nextStep } from '../src/help';
import { ask, confront } from '../src/interview';
import { analyse, omniscientEvidence } from '../src/logic/analyse';
import { sources } from '../src/logic/engine';
import {
  K, W, ballistics, bloodTest, bodyPrints, compareHand, compareType, coronerReport, curCase, dustItem, dustSpot, newWorld,
  readItem, samplePerson, startNewCase,
} from '../src/state';
import type { CardType, DifficultyId, StatementKind } from '../src/types';

// Cards created directly: the board's placement search is too slow for thousands of cards.
function card(type: CardType, ref: string): string {
  const found = Object.values(K.board.cards).find(c => c.type === type && c.ref === ref);
  if (found) return found.id;
  const id = 'c' + K.nextCard++;
  K.board.cards[id] = { id, type, ref, x: 0, y: 0, title: '', notes: '' };
  return id;
}

/** Follow the shortest proof with game actions. Returns the evidence card ids. */
function playShortestProof(): string[] {
  const c = curCase();
  const db = analyse(W, c, omniscientEvidence(W, c));
  const srcs = [...sources(db, db.get('guilty', c.killer)!.key)];
  const cards: string[] = [];
  const takeItem = (iid: string) => { readItem(iid); K.taken[iid] = true; cards.push(card('item', iid)); };
  const sample = (pid: string) => {
    if (c.refusers.includes(pid)) K.warrants[`${c.id}:${pid}`] = true;
    expect(ask(pid, 'prints').refused).toBeFalsy();
    samplePerson(pid);
  };
  if (c.wallet) readItem(c.wallet); else bodyPrints(c.body);
  for (const s of srcs) {
    const [kind, ...rest] = s.split(':');
    if (kind === 'item') {
      const it = W.items[rest[0]];
      takeItem(it.id);
      if (it.kind === 'weapon') {
        if (it.data.weaponType === 'gun' && c.bullet) { takeItem(c.bullet); ballistics(it.id, c.bullet); } else bloodTest(it.id);
        dustItem(it.id);
        for (const p of it.prints || []) sample(p);
      }
      if (it.kind === 'body') coronerReport(it.id);
    } else if (kind === 'lab') {
      const [test, a, b] = rest;
      takeItem(a); takeItem(b);
      if (test === 'type') compareType(a, b); else compareHand(a, b);
    } else if (kind === 'print') {
      for (const sid of W.addresses[c.scene].spots) dustSpot(sid);
      sample(rest[0]);
      cards.push(card('print', rest[0]));
    }
  }
  // Statements: ask first, then confront liars with everything gathered until the needed stories come out.
  const stmts = srcs.filter(s => s.startsWith('stmt:')).map(s => s.slice(5));
  for (const id of stmts) {
    const [, pid, kind] = id.split('-') as [string, string, StatementKind];
    if (['alibi', 'victim', 'enemies', 'saw'].includes(kind)) { ask(pid, kind as 'alibi'); cards.push(card('statement', id)); }
  }
  for (let round = 0; round < 3; round++) {
    for (const id of stmts) {
      if (K.statements[id]) { cards.push(card('statement', id)); continue; }
      const [, pid] = id.split('-');
      const prev = [`s${c.id}-${pid}-alibi2`, `s${c.id}-${pid}-alibi`].find(x => K.statements[x] && !K.confronted[x]);
      if (!prev) { ask(pid, 'alibi'); continue; }
      confront(prev, [...new Set(cards)]);
    }
  }
  for (const id of stmts) expect(K.statements[id], `statement ${id} obtainable`).toBeTruthy();
  return [...new Set(cards)];
}

const DIFFS: DifficultyId[] = ['easy', 'normal', 'hard'];

describe('Case soundness', () => {
  for (const diff of DIFFS) {
    it(`${diff}: killer provable by play, nobody else ever`, () => {
      let cases = 0;
      for (let seed = 1; seed <= 30; seed++) {
        newWorld(seed * 7919);
        for (let round = 0; round < 3; round++) {
          const c = startNewCase(diff);
          if (!c) break;
          cases++;
          // 1. survives a save/load round trip and still checks out
          const chk = checkCase(JSON.parse(JSON.stringify(W)), JSON.parse(JSON.stringify(c)));
          expect(chk.ok, `seed ${seed} case ${c.id}: ${chk.why}`).toBe(true);
          expect(chk.cost).toBeGreaterThanOrEqual(DIFFICULTIES[diff].minCost);

          // 2. play the shortest proof
          const evidence = playShortestProof();
          const victim = card('person', c.victim);
          // 3. innocents, with the same evidence
          for (const p of Object.values(W.people)) {
            if (p.id === c.killer || p.id === c.victim || !p.alive) continue;
            K.form = { victim, suspect: card('person', p.id), weapon: null, evidence };
            expect(evaluateCase().ok, `seed ${seed}: innocent ${p.id} charged`).toBe(false);
          }
          K.form = { victim, suspect: card('person', c.killer), weapon: null, evidence };
          const r = submitCase();
          expect(r.ok, `seed ${seed} case ${c.id} (${diff}) plan ${JSON.stringify(c.plan)}: ${JSON.stringify(r.notes)}`).toBe(true);
        }
      }
      expect(cases).toBeGreaterThan(60);
    }, 600_000);
  }
});

/** Carry out one hint with real game actions. */
function follow(a: ReturnType<typeof nextStep>['action'], label: string) {
  const c = curCase();
  switch (a.do) {
    case 'take': readItem(a.item); K.taken[a.item] = true; card('item', a.item); return;
    case 'bodyprints': bodyPrints(a.item); return;
    case 'lab':
      if (a.test === 'bal') ballistics(a.a, a.b!);
      else if (a.test === 'blood') bloodTest(a.a);
      else if (a.test === 'coroner') coronerReport(a.a);
      else if (a.test === 'type') compareType(a.a, a.b!);
      else if (a.test === 'hand') compareHand(a.a, a.b!);
      else dustItem(a.a);
      return;
    case 'dust-spot': dustSpot(a.spot); return;
    case 'pin-print': expect(K.printFound[a.pid], `${label}: print not found yet`).toBeTruthy(); card('print', a.pid); return;
    case 'pin-statement': expect(K.statements[a.id], label).toBeTruthy(); card('statement', a.id); return;
    case 'ask': {
      const r = ask(a.pid, a.q);
      expect(r.refused, `${label}: ${a.pid} refused ${a.q}`).toBeFalsy();
      if (r.statement) card('statement', r.statement.id);
      return;
    }
    case 'warrant':
      expect(evaluateWarrant(a.pid, a.cards).granted, `${label}: warrant denied`).toBe(true);
      K.warrants[`${c.id}:${a.pid}`] = true;
      return;
    case 'confront': {
      const r = confront(a.stmt, a.cards);
      expect(r.ok, `${label}: confrontation failed`).toBe(true);
      if (r.statement) card('statement', r.statement.id);
      return;
    }
    default: throw new Error(`${label}: unexpected hint ${JSON.stringify(a)}`);
  }
}

describe('Optional help', () => {
  for (const diff of DIFFS) {
    it(`${diff}: following the next-step hints solves the case`, () => {
      let cases = 0;
      for (let seed = 1; seed <= 8; seed++) {
        newWorld(seed * 104729);
        for (let round = 0; round < 2; round++) {
          const c = startNewCase(diff);
          if (!c) break;
          cases++;
          let prev = '';
          for (let step = 0; ; step++) {
            const label = `seed ${seed} case ${c.id} (${diff}) step ${step}`;
            expect(step, `${label}: too many hints`).toBeLessThan(150);
            const h = nextStep();
            const key = JSON.stringify(h.action);
            expect(key, `${label}: hint repeated without progress: ${h.text}`).not.toBe(prev);
            prev = key;
            if (h.action.do === 'file') {
              // Survives a save/load round trip: the hint is the same after reloading.
              K.board = JSON.parse(JSON.stringify(K.board));
              expect(JSON.stringify(nextStep().action)).toBe(key);
              K.form = { victim: card('person', c.victim), suspect: card('person', c.killer), weapon: null, evidence: h.action.cards };
              const r = submitCase();
              expect(r.ok, `${label}: DA declined: ${JSON.stringify(r.notes)}`).toBe(true);
              break;
            }
            follow(h.action, `${label}: ${h.text}`);
          }
        }
      }
      expect(cases).toBeGreaterThan(10);
    }, 600_000);
  }
});
