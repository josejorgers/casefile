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

export function analyse(W: World, c: Case, ev: Evidence): DB {
  setContext(W, c);
  const db = new DB();
  observe(W, c, ev, db);
  saturate(db, [...RULES, gateRule(W, c, ev.gated)]);
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
