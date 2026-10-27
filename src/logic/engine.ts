// A tiny forward-chaining engine. Facts are ground predicates such as `lied(p12,s3-p12-alibi)`; rules derive new
// facts from old ones until nothing changes. Every fact remembers its cheapest derivation (rule + premises), so the
// same machinery checks a player's case, explains the DA's reasoning and measures the shortest proof in the world.

export type Arg = string | number;

export interface Fact {
  key: string; pred: string; args: Arg[];
  /** human-readable statement of the fact */
  text: string;
  /** effort to establish it: evidence costs at the leaves, summed up the derivation */
  cost: number;
  rule: string;
  from: string[];
  /** for base facts: the evidence it came from ("item:i12", "stmt:s1-p3-alibi", "print:p3", "lab:bal:i4:i9") */
  src?: string;
}

export const factKey = (pred: string, args: Arg[]) => `${pred}(${args.join(',')})`;

export class DB {
  readonly facts = new Map<string, Fact>();
  private byPred = new Map<string, Fact[]>();
  changed = false;

  add(pred: string, args: Arg[], text: string, cost: number, rule: string, from: string[], src?: string): Fact {
    const key = factKey(pred, args);
    const f = this.facts.get(key);
    if (f) {
      if (cost < f.cost - 1e-9) { f.cost = cost; f.rule = rule; f.from = from; f.text = text; f.src = src; this.changed = true; }
      return f;
    }
    const nf: Fact = { key, pred, args, text, cost, rule, from, src };
    this.facts.set(key, nf);
    let arr = this.byPred.get(pred);
    if (!arr) this.byPred.set(pred, arr = []);
    arr.push(nf);
    this.changed = true;
    return nf;
  }
  all(pred: string): Fact[] { return this.byPred.get(pred) || []; }
  get(pred: string, ...args: Arg[]): Fact | undefined { return this.facts.get(factKey(pred, args)); }
  /** facts of `pred` whose leading arguments equal `args` */
  where(pred: string, ...args: Arg[]): Fact[] { return this.all(pred).filter(f => args.every((a, i) => f.args[i] === a)); }
  cheapest(pred: string, ...args: Arg[]): Fact | undefined {
    let best: Fact | undefined;
    for (const f of this.where(pred, ...args)) if (!best || f.cost < best.cost) best = f;
    return best;
  }
}

export interface Rule {
  id: string;
  /** the rule as a formula of the case language, for the help page and proof listings */
  formula: string;
  /** what one application of the rule adds to a proof's cost (default 1; pure relabelling rules are free) */
  step?: number;
  run(db: DB, emit: Emit): void;
}
export type Emit = (pred: string, args: Arg[], text: string, premises: (Fact | undefined)[], extra?: number) => void;

export function saturate(db: DB, rules: Rule[], maxPasses = 40) {
  for (let pass = 0; pass < maxPasses; pass++) {
    db.changed = false;
    for (const r of rules) {
      const emit: Emit = (pred, args, text, premises, extra = 0) => {
        if (premises.some(p => !p)) return;
        const ps = premises as Fact[];
        db.add(pred, args, text, ps.reduce((s, p) => s + p.cost, 0) + (r.step ?? 1) + extra, r.id, [...new Set(ps.map(p => p.key))]);
      };
      r.run(db, emit);
    }
    if (!db.changed) return;
  }
}

export interface ProofNode { text: string; rule: string; cost: number; src?: string; children: ProofNode[] }

export function explain(db: DB, key: string, seen = new Set<string>()): ProofNode | null {
  const f = db.facts.get(key);
  if (!f) return null;
  if (seen.has(key)) return { text: f.text, rule: f.rule, cost: f.cost, src: f.src, children: [] };
  seen.add(key);
  // A step that only restates its premise (a record becoming a sighting) adds nothing to read: lift its premises up.
  const children = f.from.map(k => explain(db, k, seen)).filter((x): x is ProofNode => !!x)
    .flatMap(ch => (ch.text === f.text ? (ch.children.length ? ch.children : [ch]) : [ch]));
  if (children.length === 1 && children[0].text === f.text && !children[0].children.length) return { text: f.text, rule: f.rule, cost: f.cost, src: children[0].src ?? f.src, children: [] };
  return { text: f.text, rule: f.rule, cost: f.cost, src: f.src, children };
}

/** Every piece of evidence (base-fact source) a derivation rests on. */
export function sources(db: DB, key: string, out = new Set<string>(), seen = new Set<string>()): Set<string> {
  if (seen.has(key)) return out;
  seen.add(key);
  const f = db.facts.get(key);
  if (!f) return out;
  if (f.src) out.add(f.src);
  for (const k of f.from) sources(db, k, out, seen);
  return out;
}

export function proofLines(node: ProofNode | null, depth = 0, out: string[] = []): string[] {
  if (!node) return out;
  out.push('  '.repeat(depth) + node.text);
  for (const ch of node.children) proofLines(ch, depth + 1, out);
  return out;
}
