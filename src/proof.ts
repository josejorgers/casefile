// The shortest proof, explained for the player: grouped by the DA's pillars, each piece of evidence marked with what
// it is and where to find it, deductions marked as conclusions, and shared facts shown once.
import { analyse, omniscientEvidence } from './logic/analyse';
import { explain } from './logic/engine';
import type { ProofNode } from './logic/engine';
import { QUESTIONS } from './interview';
import { W, fullName } from './state';
import type { Case, StatementKind } from './types';

export interface ProofLine {
  depth: number;
  kind: 'evidence' | 'deduction' | 'seen';
  text: string;
  /** evidence only: what it is and where to get it. `{a:id}`/`{p:id}` mark pinnable names. */
  where?: string;
}
export interface ProofSection { title: string; how: string; conclusion: string; lines: ProofLine[] }

/** The proof tree with evidence sources. Open cases from older saves get it computed (and kept) on demand. */
export function proofTree(c: Case): ProofNode | null {
  if (c.proofTree) return c.proofTree;
  if (c.solved) return null; // the world has moved on (the killer is in custody); keep the plain proof
  const db = analyse(W, c, omniscientEvidence(W, c));
  const g = db.get('guilty', c.killer);
  if (!g) return null;
  c.proofTree = explain(db, g.key) ?? undefined;
  return c.proofTree ?? null;
}

const SECTION: Record<string, { title: string; how: string }> = {
  means: { title: 'Means', how: 'The murder weapon is established (ballistics, blood, or found by the body), then traced to the person who had it.' },
  presence: { title: 'Presence', how: 'Evidence that only someone in the apartment during the killing could leave.' },
  elimination: { title: 'Presence', how: 'The door was locked from outside with a key, so the killer had one. Every other key holder was somewhere else at the time of death.' },
  motive: { title: 'Motive', how: 'A document or a witness shows the conflict. Initials only count once you show they fit exactly one person who could have written it.' },
  opportunity: { title: 'Opportunity', how: "The suspect's account of the night is proven false, or they were placed near the scene close to the time of death." },
};

/** What a piece of evidence is and where to get it, from its source key. */
export function whereIs(c: Case, src: string | undefined): string {
  if (!src) return '';
  if (src === 'victim') return c.wallet
    ? `The victim's wallet: ${place(W.items[c.wallet].spot)}.`
    : `Take fingerprints from the body: ${place(W.items[c.body].spot)}.`;
  const [kind, a, b, d] = src.split(':');
  if (kind === 'item') {
    const it = W.items[a];
    return `${it.name}: ${place(it.spot)}.`;
  }
  if (kind === 'lab') return `Lab: compare the ${low(W.items[b].name)} with the ${low(W.items[d].name)} (select one on the board).`;
  if (kind === 'print') {
    const sid = W.addresses[c.scene].spots.find(s => W.spots[s].bloodPrints.includes(a));
    return `Fingerprint in blood: dust the ${sid ? low(W.spots[sid].name) : 'scene'} at the crime scene, then get a sample from {p:${a}}.`;
  }
  if (kind === 'stmt') {
    const [, pid, sk] = src.slice(5).split('-') as [string, string, StatementKind];
    if (sk === 'alibi2' || sk === 'admission') return `${fullName(pid)}'s ${sk === 'admission' ? 'admission' : 'revised story'}: comes out when you confront {p:${pid}} with the lie shown under it.`;
    return `Talk to {p:${pid}} and ask: "${QUESTIONS[sk as 'alibi'](c)}"`;
  }
  return '';
}
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const place = (spot: string) => `${low(W.spots[spot].name)}, {a:${W.spots[spot].addr}}`;

export function explainProof(c: Case): ProofSection[] | null {
  const root = proofTree(c);
  if (!root) return null;
  const shown = new Set<string>(), sourced = new Set<string>();
  const where = (src: string) => { if (sourced.has(src)) return 'Same as above.'; sourced.add(src); return whereIs(c, src); };
  const sections: ProofSection[] = [];
  const walk = (n: ProofNode, depth: number, out: ProofLine[]) => {
    if (shown.has(n.text)) { out.push({ depth, kind: 'seen', text: n.text }); return; }
    shown.add(n.text);
    if (n.src) out.push({ depth, kind: 'evidence', text: n.text, where: where(n.src) });
    else out.push({ depth, kind: 'deduction', text: n.text });
    for (const ch of n.children) walk(ch, depth + 1, out);
  };
  // The victim first, then one section per pillar.
  const kids = [...root.children].sort((x, y) => Number(!!SECTION[x.rule]) - Number(!!SECTION[y.rule]));
  for (const k of kids) {
    const sec = SECTION[k.rule];
    const lines: ProofLine[] = [];
    if (!sec) { walk(k, 0, lines); sections.push({ title: 'Victim', how: 'The DA needs the victim formally identified.', conclusion: k.text, lines }); continue; }
    shown.add(k.text);
    for (const ch of k.children) walk(ch, 0, lines);
    if (!k.children.length && k.src) lines.push({ depth: 0, kind: 'evidence', text: k.text, where: where(k.src) });
    sections.push({ title: sec.title, how: sec.how, conclusion: k.text, lines });
  }
  return sections;
}
