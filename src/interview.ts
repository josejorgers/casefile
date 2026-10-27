// Interviews: questions, statements, refusals and confrontations. What people say comes from story.ts; this module
// records what the detective has heard.
import { fmtDate } from './data';
import { analyse } from './logic/analyse';
import { playerEvidence } from './da';
import { initialStatement, revisedStatement } from './story';
import { K, W, caseById, caseKey, curCase, fact, fullName, log, person, samplePerson } from './state';
import type { Case, QKind, Statement, StatementKind } from './types';

export { sid } from './story';

export const QUESTIONS: Record<QKind, (c: Case) => string> = {
  who: () => 'Who are you, and what do you do?',
  alibi: c => `Where were you on the night of ${fmtDate(c.day)}, between 21:00 and 01:00?`,
  victim: c => `How did you know ${fullName(c.victim)}?`,
  enemies: c => `Did ${fullName(c.victim)} have trouble with anyone?`,
  saw: () => 'Did you see or hear anything unusual that night?',
  prints: () => 'Would you let me take your fingerprints?',
};
export const QUESTION_ORDER: QKind[] = ['who', 'alibi', 'victim', 'enemies', 'saw', 'prints'];
export const STATEMENT_LABEL: Record<StatementKind, string> = {
  alibi: 'Alibi', alibi2: 'Revised alibi', victim: 'About the victim', enemies: "Victim's enemies", saw: 'What they noticed',
  admission: 'Admission',
};

export interface Answer { id: string; text: string; refused?: boolean; statement?: Statement }

export const isLawyered = (pid: string) => !!K.lawyered[caseKey(curCase(), pid)];
export const hasWarrant = (pid: string) => !!K.warrants[caseKey(curCase(), pid)];
export const refusesPrints = (pid: string) => curCase().refusers.includes(pid) && !hasWarrant(pid);

export function ask(pid: string, q: QKind): Answer {
  const c = curCase(), p = person(pid), id = `s${c.id}-${pid}-${q}`;
  fact(pid, 'look');
  if (q === 'prints') {
    if (K.samples[pid]) return { id, text: K.answers[id] || 'You already have my prints on file.' };
    if (refusesPrints(pid)) {
      const text = pid === c.killer ? 'Not without a warrant, detective.' : "No. I know my rights — get a warrant if you want my prints.";
      K.answers[id] = text;
      return { id, text, refused: true };
    }
    samplePerson(pid);
    K.answers[id] = hasWarrant(pid) ? 'Fine. You have your warrant.' : pid === c.killer ? 'Fine. Whatever gets you out of here faster.' : 'Sure, if it helps.';
    return { id, text: K.answers[id] };
  }
  if (isLawyered(pid)) return { id, text: 'My lawyer says I have nothing more to say to you.', refused: true };
  if (q === 'who') {
    fact(pid, 'work', 'job', 'home', 'phone');
    K.answers[id] = `I'm {p:${pid}}, ${p.age}. I live at {a:${p.home}}. I work as a ${p.job.toLowerCase()} at {a:${p.work}}.`;
    return { id, text: K.answers[id] };
  }
  const st = K.statements[id] || (K.statements[id] = initialStatement(W, c, pid, q));
  return { id, text: st.text, statement: st };
}

// ---------- Confrontation: show someone the cards that prove their story false.
export interface ConfrontResult { ok: boolean; text: string; statement?: Statement; lawyer?: boolean }

export function confront(stmtId: string, cardIds: string[]): ConfrontResult {
  const st = K.statements[stmtId];
  const c = caseById(st.case), p = person(st.pid);
  if (K.confronted[stmtId]) return { ok: false, text: 'You already caught that one.' };
  const db = analyse(W, c, playerEvidence(cardIds, [st]));
  if (!db.get('lied', st.pid, st.id)) {
    const shrug = ["So? That doesn't prove anything.", "I don't see what that has to do with me.", "What's that supposed to mean?", 'I told you where I was.'];
    return { ok: false, text: shrug[(cardIds.length + stmtId.length) % shrug.length] };
  }
  K.confronted[stmtId] = true;
  const r = revisedStatement(W, c, p.id, st.kind);
  if (!r) {
    K.lawyered[caseKey(c, p.id)] = true;
    log(`${fullName(p.id)} stopped talking and asked for a lawyer.`);
    return { ok: true, lawyer: true, text: "I'm done talking. I want my lawyer." };
  }
  K.statements[r.id] = r;
  log(`${fullName(p.id)} changed their story.`);
  return { ok: true, text: r.text, statement: r };
}
