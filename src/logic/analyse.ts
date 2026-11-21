// Glue: load evidence into a fact base, run the case language over it.
import { allStatements } from '../story';
import type { Case, PrintLoc, Statement, World } from '../types';
import { DB, saturate } from './engine';
import type { Rule } from './engine';
import { GATE, WARRANT, addStatement, observe } from './observe';
import type { Evidence } from './observe';
import { RULES, setContext } from './rules';

function gateRule(W: World, c: Case, gated: { st: Statement; after: string }[]): Rule {
  return {
    id: 'confrontation', formula: "statement′(P) ⇐ lied(P, s)   — shown the lie, P tells a different story",
    run(db) {
      for (const g of gated) {
        const l = db.get('lied', g.st.pid, g.after);
        if (l) addStatement(W, c, db, g.st, l.cost + GATE, [l.key]);
      }
    },
  };
}

/**
 * `discount` (optional) may lower the cost of facts after each saturation, e.g. to 0 for evidence the detective
 * already holds; derived facts are then re-costed so the cheapest derivation prefers that evidence.
 */
export function analyse(W: World, c: Case, ev: Evidence, discount?: (db: DB) => boolean): DB {
  setContext(W, c);
  const db = new DB();
  observe(W, c, ev, db);
  const rules = [...RULES, gateRule(W, c, ev.gated)];
  saturate(db, rules);
  for (let i = 0; discount && i < 10 && discount(db); i++) saturate(db, rules);
  return db;
}

/** The detective who has seen, tested and asked everything. Used to check generated cases. */
export function omniscientEvidence(W: World, c: Case): Evidence {
  const { initial, gated } = allStatements(W, c);
  const scene = W.addresses[c.scene];
  const bloodLocs: Record<string, PrintLoc[]> = {};
  for (const sid of scene.spots) for (const pid of W.spots[sid].bloodPrints) (bloodLocs[pid] ||= []).push({ spot: sid, addr: c.scene, blood: true });
  return {
    items: Object.keys(W.items),
    prints: Object.keys(bloodLocs),
    statements: initial,
    gated,
    lab: () => true,
    dusted: () => true,
    sampled: () => true,
    printLocs: pid => bloodLocs[pid] || [],
    victimKnown: true,
    sampleCost: pid => (c.refusers.includes(pid) ? WARRANT : 0),
  };
}
