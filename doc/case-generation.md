# Case generation and the case language

This document explains how Casefile builds a murder case, how the **case language** works, and how to extend it with new kinds of evidence and deduction.

The idea in one sentence: **a case is a proof.** We choose a chain of deductions first, then build the world so that chain holds, then check the whole world mechanically. The same rules that check the world also judge the player.

```
 difficulty ──► plan (one strategy per pillar) ──► build the night ──► checkCase ──► accepted case
                                                        ▲                   │
                                                        └──── reroll ◄──────┘ (innocent provable, too easy, …)
```

| File | Role |
|---|---|
| `src/logic/engine.ts` | Forward-chaining engine: facts, rules, cheapest derivations, proof trees |
| `src/logic/rules.ts` | **The case language**: every inference rule |
| `src/logic/observe.ts` | Evidence → base facts (items, prints, statements, lab results) |
| `src/logic/analyse.ts` | Glue, plus the *omniscient* evidence used to check cases |
| `src/story.ts` | Timelines of the night and every statement people make |
| `src/crime.ts` | The generator: plan, build, `checkCase` |
| `src/da.ts`, `src/interview.ts` | The DA, the judge and confrontations, all using the same rules |

---

## 1. The language

### 1.1 Facts

A fact is a ground predicate: a name plus arguments (ids, numbers, strings).

```
claim(p12, a40, 1245, 1500, s3-p12-alibi)   p12 says they were at address a40 from 20:45 to 01:00
rec(p12, a7, 1290, 1420)                    a record (tab book) puts p12 at a7 from 21:30 to 23:40
shoePrint(i88, 10, Hex, a nick…, blood)     a bloody shoe print at the scene
lied(p12, s3-p12-alibi)                     derived: that alibi is false
guilty(p12)                                 derived: the case is proven
```

Facts live in a `DB`. Each fact remembers how it was **cheapest** to obtain:

```ts
// src/logic/engine.ts
export interface Fact {
  key: string; pred: string; args: Arg[];
  text: string;      // human-readable, shown in the DA's reasoning tree
  cost: number;      // effort: evidence costs at the leaves, summed up the derivation
  rule: string;      // which rule derived it ('evidence' for base facts)
  from: string[];    // premise keys
  src?: string;      // for base facts: "item:i12", "stmt:s1-p3-alibi", "print:p3", "lab:type:i4:i9"
}
```

When the same fact is derived again more cheaply, `DB.add` replaces its derivation. This makes the fact base a shortest-proof finder (Knuth's generalisation of Dijkstra to sum-of-costs rules).

### 1.2 Base facts: what evidence says

`observe()` in `src/logic/observe.ts` turns evidence into base facts. One function serves both the player's submitted cards and the omniscient check, so they always agree.

```ts
// src/logic/observe.ts (excerpt)
case 'tabs':
  if (d.day === c.day) {
    base('roll', [d.addr!, 18 * 60, 27 * 60, 'all'], `Every customer at ${placeName(W, d.addr!)} gets a tab — the book is complete.`, src);
    for (const t of d.tabs!) base('rec', [t.pid, d.addr!, t.t, t.close], `${N(t.pid)} ran a tab … from ${T(t.t)} to ${T(t.close)}.`, src);
  }
  break;
```

Statements are not read as prose. Each statement carries machine-readable assertions (`Said`, in `src/types.ts`), and `addStatement()` turns them into facts:

| `Said` | Fact | Meaning |
|---|---|---|
| `claim` | `claim(P, X, a, b, stmt)` | the speaker says they were at X |
| `out` | `testNot(P, X, a, b)` | P was **not** at X (e.g. "he went out at 21:40") |
| `with` | `testAt(P, X, a, b)` | P was at X (a lover's or neighbour's account) |
| `called` | `calledMe(W, P, t)` | P phoned the speaker at about t |
| `motive` | `motiveSaid(P, weak)` | a rumour about a conflict |
| `alive` / `death` | `aliveAt(t)` / `deadIn(lo, hi)` | time-of-death evidence |
| `leaving` | `killerDesc(h, b, hair)` | description of whoever locked the door |
| `admission` | `admission(P, t)` | the speaker admits being at the scene |

The main base predicates, by source:

| Source | Facts |
|---|---|
| Weapon + lab | `weaponEst(I)`, `possessed(I,P)`, `serial(I,n)`, `brand(I,b)`, `printOn(I,P)` |
| Gun register / pawn ledger | `reg(n,P)`, `regPawned(n,shop)`, `pawnSold(n,P)` |
| Shoes, prints, cobbler | `shoePrint(I,…)`, `shoes(S,…)`, `shoesOwner(S,P)`, `tag(S,n)`, `repair(n,P)`, `bloodPrint(P)` |
| Records | `rec(P,X,a,b)` (tab, timesheet, ticket, call at a one-person home), `roll(X,from,to,who)` (record is complete) |
| Calls | `call(from,to,t,dur)`, `aliveAt(t)` (victim answered) |
| Scene | `locked(scene)`, `keyholders(list)`, `keyholder(P)`, `deadIn(lo,hi)` (coroner, watch), `rain(t)` |
| Documents | `motiveRef`, `motiveIni(D, "G.R.")`, `motiveAnon`, `authorDoc`, `handwritten`, `signedBy`, `typeMatch`, `handMatch`, `twAt`, `staffList`, `bookList`, `book` |

### 1.3 Rules

A rule has an id, a formula (documentation, shown in listings) and a `run` function that reads facts and `emit`s new ones:

```ts
// src/logic/rules.ts
{ id: 'means', formula: 'means(P) ⇐ weaponEst(I) ∧ tie(I, P)',
  run(db, emit) {
    for (const we of db.all('weaponEst')) for (const t of db.where('tie', str(we, 0)))
      emit('means', [str(t, 1)], `${N(str(t, 1))} had the murder weapon.`, [we, t]);
  } },
```

`emit(pred, args, text, premises)` computes the cost as the sum of the premises plus the rule's `step` (default 1; pure relabelling rules use `step: 0`). If any premise is `undefined`, `emit` silently does nothing, so optional lookups can be passed straight in.

`saturate()` runs every rule repeatedly until a pass adds nothing new and no cost improves.

### 1.4 The current rule set

```
rec(P, booth, t)     ⇐ call(booth → home(W), t) ∧ calledMe(W, P, ≈t)                       payphone
seen(P, X, a, b)     ⇐ rec(P, X, a, b)  |  testAt(P, X, a, b)                                record, testimony
shoesOf(S, P)        ⇐ shoesOwner(S, P)  |  tag(S, n) ∧ repair(n, P)                          shoe-owner
printBy(I, P)        ⇐ shoePrint(I, size, sole, wear) ∧ shoes(S, size, sole, wear) ∧ shoesOf(S, P)
sometimeAt(P, scene) ⇐ printBy(mud I, P) ∧ rain(t)                                            mud
lied(P, s)           ⇐ claim(P, X, a, b, s) ∧ ( seen(P, Y≠X, overlapping)                     contradiction
                                              | testNot(P, X, overlapping)
                                              | roll(X) that doesn't cover P )
window(lo, hi)       ⇐ deadIn(…)+ ∧ aliveAt(t)?   (intersection of any subset)                 time-of-death
accounted(P, lo, hi) ⇐ rec(P, X≠scene, a, b) ∧ window(lo, hi) ∧ a ≤ lo ∧ hi ≤ b               alibi
near(P)              ⇐ seen(P, on the victim's street, ≈window)  |  sometimeAt(P, scene)       near
presence(P)          ⇐ bloodPrint(P) | printBy(blood I, P) | admission(P)                      presence
presence(P)          ⇐ locked ∧ keyholders(K) ∧ killerDesc? ∧ window(w) ∧
                       every other matching key holder is accounted(·, w)                      elimination
tie(I, P)            ⇐ possessed | printOn | serial ∧ reg | serial ∧ regPawned ∧ pawnSold
                       | brand(I, b) ∧ block(P, b)                                             weapon-tie
means(P)             ⇐ weaponEst(I) ∧ tie(I, P)
motive(P)            ⇐ motiveRef | motiveSaid
                       | motiveIni(victim's own note) ∧ unique initials in the victim's address book
                       | motiveIni ∧ typeMatch ∧ twAt(tw, X) ∧ unique initials on X's staff roster
                       | authorDoc ∧ handMatch(D, E) ∧ signedBy(E, P)
opportunity(P)       ⇐ lied(P, s) | near(P)
guilty(P)            ⇐ victim(V) ∧ any 3 of {means, presence, motive, opportunity}(P)
statement′(P)        ⇐ lied(P, s)        (confrontation: the revised statement becomes available)
```

Any three of the four pillars always include **means** or **presence**. Those are the *identifying* pillars, because only the killer can have them. Motive and lies are common among innocent people.

### 1.5 The validity principle

Every rule must be a **valid inference about the true world**, given that:

1. **Records are accurate.** Tab books, timesheets, registers, call logs and tickets never lie.
2. **Honest testimony is true.** Only liars, accomplices and the killer say false things, and they only lie about their own whereabouts (accomplices also about the killer's).
3. **Testimony only contradicts; it never vouches.** `testAt` and `testNot` can prove that someone lied. Only records (`rec`) can *exclude* someone through `accounted`. An accomplice's false "she was with me" therefore can never clear the killer.
4. **Completeness is explicit.** Absence from a record only counts when the record says it is complete (`roll`): "every customer gets a tab", or "staff clock in and out".

If a rule follows these principles, the engine can never prove something false. The generator's check (section 4) then confirms it per case.

Tolerances in `rules.ts` keep honest people safe from rounding: overlaps must be at least `TOL = 10` minutes, uncovered time against a complete record at least `ROLL_TOL = 15`, and "near the time of death" means within `NEAR = 60` minutes of the window.

---

## 2. Statements and timelines (`src/story.ts`)

Nothing anyone says is written by hand. Every person has a **timeline** for the night (18:00 → 07:00):

```ts
export interface Seg { place: Place | null; from: number; to: number } // place: address id, 'st:<street>', or null = out
```

By default a timeline is "at work during the shift, home otherwise" (`defaultTimeline`). The generator overlays segments for anyone whose night is special (`overlay` cuts and inserts). Only those people are stored in `c.timeline`.

Honest statements are **read off the timeline**:

```ts
// story.ts — honestAccount (excerpt)
const segs = clip(timeline(W, c, pid), CLAIM_FROM, ASK_TO).filter(s => s.to - s.from >= 5);
const said: Said[] = segs.filter(s => s.place).map(s => ({ k: 'claim', place: s.place!, from: s.from, to: s.to }));
```

The same function reports what the speaker could see from home:
- a housemate leaving and returning (merged into a single "out from … until …", since you can't see where they went);
- a visitor in their home (a lover);
- a housemate phoning them (`called`).

Records are generated from the same timelines (tab books from bar segments, calls only when someone is home to answer). This is the core guarantee: **an honest statement can never contradict a record**, so a contradiction always means a lie.

Lies come from three places:
- `c.claims[pid]`: special alibis (the killer's lie, the accomplice's cover story);
- `c.liars[pid]`: innocent people hiding an affair, a bar visit, or a visit to the victim;
- `revisedStatement()`: what someone says once confronted. Innocent people tell the truth. The killer admits being there (Easy), tells a second lie (Normal) or asks for a lawyer (Hard). An accomplice gives the killer up (`out(K, home)`).

---

## 3. The generator (`src/crime.ts`)

### 3.1 Strategies and the plan

Each pillar has a set of **strategies**: a chain of deductions the generator knows how to build in the world.

```ts
// src/types.ts
export type PresenceStrat = 'bloodprint' | 'shoesHome' | 'shoesTag' | 'elimination';
export type MeansStrat    = 'home' | 'prints' | 'register' | 'pawn' | 'knifeblock';
export type MotiveStrat   = 'signed' | 'gossip' | 'initialsBook' | 'typed' | 'hand';
export type OppStrat      = 'partner' | 'timesheet' | 'tabTime' | 'ticket' | 'payphone' | 'accomplice';

export interface Plan { presence: PresenceStrat | null; means: MeansStrat | null; motive: MotiveStrat[]; opp: OppStrat | null; narrow: boolean }
```

| Strategy | Chain the player must follow |
|---|---|
| `bloodprint` | fingerprint in blood → sample the suspect (maybe with a warrant) |
| `shoesHome` | bloody shoe print → shoes in the killer's bedroom |
| `shoesTag` | bloody shoe print → shoes dumped in an alley → repair tag → cobbler's ledger |
| `elimination` | door locked with a key → key register → every other key holder's record covers the time of death (narrowed by the call log, a watch or a neighbour) |
| `home` | gun in the killer's nightstand → ballistics |
| `prints` | bloodied weapon hidden or dumped → blood test → dust → sample the killer |
| `register` | dumped gun → ballistics → serial → gun register |
| `pawn` | dumped gun → ballistics → register says *pawned* → pawn ledger → buyer |
| `knifeblock` | kitchen knife at the scene, wiped → brand → the gap in the killer's knife block |
| `signed` / `gossip` | signed document / a rumour from the victim's circle |
| `initialsBook` | victim's ledger or diary with initials → the only match in the victim's address book |
| `typed` | typed threat with initials → typeface test → typewriter at the killer's work → staff roster |
| `hand` | anonymous handwritten threat → handwriting test against the killer's signed letter |
| `partner` | "home with my partner" → partner says they went out |
| `timesheet` | "working late" → the timesheet clocks them out at 17:00 |
| `tabTime` | "at the bar until midnight" → the tab was closed at 21:58 |
| `ticket` | "home alone" → bus ticket from the victim's street in their coat |
| `payphone` | "at work, called home" → home call log shows a payphone number → directory → victim's street, and the partner confirms who called |
| `accomplice` | "at my friend's" → the friend backs it up → the friend's own alibi is broken by a tab book → confronted, the friend gives the killer up |

Each difficulty profile (`DIFFICULTIES` in `src/data.ts`) lists the strategies it may use:

```ts
hard: {
  presence: ['shoesTag', 'elimination'], means: ['pawn', 'knifeblock', 'prints'], motive: ['typed', 'hand', 'initialsBook'],
  motiveCount: [1, 2], opp: ['payphone', 'accomplice', 'ticket', 'tabTime'],
  dropPillar: 1,   // one pillar is always left unprovable
  narrow: 1,       // locked-door cases need a narrowed time of death
  minCost: 17,     // the shortest proof must cost at least this
  …
}
```

Choosing the plan, with a feasibility check per strategy and a fallback that always works:

```ts
const plan: Plan = {
  presence: choose(D.presence, feasible.presence, ['shoesHome']),
  means: choose(D.means, feasible.means, ['register', 'prints']),
  motive: [],
  opp: choose(D.opp, feasible.opp, ['tabTime']),
  narrow: rng.chance(D.narrow),
};
…
if (rng.chance(D.dropPillar)) {
  const drop = rng.pick(['means', 'presence', 'motive', 'opp'] as const);
  if (drop === 'motive') plan.motive = []; else plan[drop] = null;
}
```

Feasibility depends on the chosen victim and killer. For example, `payphone` needs a partner at home, a workplace without a time clock and a workplace on a different street from the scene. `knifeblock` needs a killer who lives alone, otherwise the knife block would point at the housemate too.

### 3.2 Building the night

`build()` realises the plan in this order (each step reads the earlier ones):

1. **Victim and killer.** The victim lives alone and isn't working around the time of death. The killer isn't working from 3½ hours before to 1½ hours after. The motive is picked (a grudge needs co-workers).
2. **The killer's timeline and lie**, shaped by the opportunity strategy:
   ```ts
   } else if (plan.opp === 'payphone') {
     const booth = Object.values(A).find(a => a.kind === 'payphone' && streetOf(a.id) === sceneStreet)!;
     const ph = arrive - rng.int(8, 14);
     depart = EVE;
     special.push(seg(booth.id, ph, ph + 2));
     W.calls.push({ from: booth.id, to: kh.id, day, t: ph, dur: 2, by: kil.id });
     c.claims[kil.id] = { place: kil.work, from: CLAIM_FROM, text: `I was at {a:${kil.work}} doing paperwork until after one. Called home to say I'd be late.` };
   }
   setTl(kil, [seg(null, depart, arrive), seg(null, leave, back), ...special, seg(vh.id, arrive, leave)]);
   ```
3. **Key holders.** For `elimination`, 1–3 innocent key holders get bar visits covering the death. On Hard (`narrow`) the visits cover only a few minutes either side, so the coroner's estimate isn't enough. The key register is rewritten to `[killer, …holders]`.
4. **Red herrings.** These are people with a weak motive (a car-repair debt). Some visited the victim that evening after the rain, which leaves a muddy print. If a neighbour saw them, they may lie about the visit.
5. **Innocent liars.** People with an affair or a drinking secret get matching timelines, plus a call to the lover. Their partners and lovers become the contradiction.
6. **Early drinkers**, so tab books aren't made only of liars.
7. **The weapon**, by means strategy (pawn chain, knife block, dumped gun…). If means is dropped, the weapon is never found.
8. **The scene:** body, wallet, smashed watch, door (locked or not), bloody shoe print, blood fingerprint, dumped shoes with a repair tag.
9. **Motive documents and rumours.** The herrings get weak motives too.
10. **Calls**, consistent with the timelines: the killer's earlier call, the victim's last answered call (time of death), an unanswered call after death, ordinary daytime calls.
11. **Records:** timesheets for clocked businesses, tab books from the timelines, the morning paper with the weather.
12. **Witnesses:** a neighbour who heard the killing, one who saw someone leave (and heard the lock, except on Hard), sightings of herrings arriving.
13. **Stonewalling.** Some people refuse fingerprints (always the killer on Hard). Some refuse to give an alibi, but never anyone whose word the case needs.

---

## 4. The check (`checkCase`)

After `build()` the case is pushed and checked against **everything in the world**:

```ts
export function checkCase(W: World, c: Case): CaseCheck {
  const db = analyse(W, c, omniscientEvidence(W, c));
  const wrong = db.all('guilty').find(f => f.args[0] !== c.killer);
  if (wrong) return fail(`innocent ${wrong.args[0]} provable`);
  const g = db.get('guilty', c.killer);
  if (!g) return fail('killer not provable');
  if (g.cost < D.minCost) return fail(`too easy (${g.cost})`);
  if (!pl.means && db.get('means', c.killer)) return fail('dropped means is provable');
  … same for the other dropped pillars …
  if (c.refusers.includes(c.killer) && connections(db, c.killer).length < 2) return fail('no warrant possible');
  return { ok: true, why: '', cost: g.cost, proof: proofLines(explain(db, g.key)) };
}
```

`omniscientEvidence` is a detective who has read every item, run every lab test, sampled everyone (warrants cost extra) and heard every statement. Statements that only come out after a confrontation are **gated**: they enter the fact base only once the original lie is derivable, at that cost plus 2.

```ts
// analyse.ts
run(db) {
  for (const g of gated) {
    const l = db.get('lied', g.st.pid, g.after);
    if (l) addStatement(W, c, db, g.st, l.cost + GATE, [l.key]);
  }
}
```

If the check fails, the world is restored from a `structuredClone` snapshot and the generator tries again (up to 40 attempts, continuing the same random stream). In practice almost every attempt passes.

Accepted cases store `c.proof`, the shortest proof rendered as indented lines. The player can see it after closing the case.

### 4.1 Cost model

| Thing | Cost |
|---|---|
| A document, record, statement or item fact | 1 |
| Needs a lab test (ballistics, blood, coroner, typeface, handwriting, prints) | +1 |
| Needs a fingerprint warrant | +3 |
| A statement only obtainable by confronting a lie | lie's cost + 2 |
| Each inference step | +1 (relabelling rules 0) |

Measured shortest-proof costs: Easy 7–11, Normal 7–20 (median 12), Hard 12–29 (median 19). The thresholds (`minCost` Normal 11, Hard 17) cut off accidental shortcuts.

---

## 5. How the player is judged

The DA (`evaluateCase`), the judge (`evaluateWarrant`) and confrontations (`confront`) all call `analyse()` with `playerEvidence(cardIds)`: only the submitted cards, and only lab work actually done.

- **DA:** `guilty(suspect)` must be derivable. The verdict shows each pillar's derivation as a tree, plus notes on dead ends (e.g. "the shoes match the print, but nothing shows whose shoes they are"; "key holders not ruled out: …").
- **Judge:** at least two `connections()` facts (address book, key holder, call on the day, motive, proven lie, matching shoes, near the scene).
- **Confrontation:** `lied(P, statement)` must be derivable from the statement plus the chosen cards.

The board itself is free-form. Links between cards mean nothing to the game.

### 5.1 Optional help (`src/help.ts`)

The "Stuck? Get help" button offers three levels, each behind a confirmation: the next step, the killer's name, and the full proof (`Case.proof`). Use is recorded in `Case.help` and shown on the closed case; nothing else changes.

**Next step** runs the omniscient analysis again, but with every piece of evidence the detective already holds (on the board, with its lab work done) costed at 0, via the `discount` hook of `analyse()`. The cheapest proof of `guilty(killer)` is then the one closest to the detective's board. A depth-first walk of that proof, prerequisites first, finds the first piece of evidence still missing and turns it into one concrete action: take an item, run a lab test, dust a spot, pin a print, ask a question, confront a statement with the cards that break it, or apply for a warrant (working towards the judge's two connections if the board doesn't have them yet). The reason comes from the rule that consumes the evidence and never names anyone. Statements from people who have lawyered up are left out, so the hint never points at something unreachable. When nothing is missing, the hint says to file with the DA and lists the cards.

**Full proof** (`src/proof.ts`): the generator stores the proof as a `ProofNode` tree (`Case.proofTree`), which keeps each fact's evidence source. `explainProof` groups it by pillar, marks evidence (with the item and its spot and address, the question to ask, or the lab comparison) apart from deductions, and shows a shared fact once. Saves from before this get the tree built for open cases on load. Closed old cases keep the plain `Case.proof` lines, because once the killer is in custody the world no longer matches the case.

The soundness test follows the hints alone with real game actions until the DA charges, and fails if a hint ever repeats without progress.

---

## 6. Extending the language

A new kind of evidence touches up to four places:

1. **Data model** (`src/types.ts`): new item kind or data fields, new `Said` variant, new strategy name.
2. **Observation** (`src/logic/observe.ts`): what the new evidence asserts, as base facts.
3. **Rules** (`src/logic/rules.ts`): only if existing rules can't already use those facts.
4. **Generator** (`src/crime.ts` + `DIFFICULTIES`): a strategy that plants the evidence, plus its feasibility test.

Then add document text in `src/docs.ts`, an `ITEM_TYPE` label in `src/ui/view.ts`, and any new lab action in `src/state.ts` and the inspector.

### 6.1 Example A — no new rule needed: a parking ticket

*"I was home all night."* But the killer's car was ticketed on the victim's street at 22:41.

The existing `rec → seen → lied` and `seen → near` rules already handle "a record places P on a street at t". Only an observation and a strategy are needed.

```ts
// types.ts
export type ItemKind = … | 'parking';
export type OppStrat = … | 'parking';

// observe.ts — in the item switch
case 'parking':
  if (d.day === c.day) base('rec', [d.owner!, 'st:' + d.street, d.t!, d.t! + 1],
    `A parking ticket for ${N(d.owner!)}'s car on ${d.street} at ${T(d.t!)}.`, src);
  break;

// crime.ts — in the killer-timeline block
} else if (plan.opp === 'parking') {
  const tt = arrive + rng.int(2, 6);
  addItem(W, ks('desk'), { kind: 'parking', name: 'Parking ticket',
    text: `A parking ticket issued on ${sceneStreet} at ${fmtTime(tt)}, made out to {p:${kil.id}}'s car.`,
    data: { owner: kil.id, street: sceneStreet, t: tt, day } });
  c.claims[kil.id] = { place: kh.id, from: CLAIM_FROM, text: 'I was home all night. Never went out.' };
}
// feasibility: kCo.length === 0 (a housemate would contradict "home" more cheaply) && streetOf(kh.id) !== sceneStreet

// data.ts — allow it
normal: { …, opp: ['tabTime', 'ticket', 'timesheet', 'partner', 'parking'] }
```

Nothing else changes. The DA, confrontations and the shortest-proof check understand it automatically. Run `npm test` to confirm it stays sound.

### 6.2 Example B — a new rule: property stolen from the victim

*The victim's watch was taken. It turns up in the pawn ledger, pawned by P the morning after.* Holding property taken during the killing is identifying, so this is a new route to **presence**.

**1. Base facts.** The victim's belongings list (found at the victim's home, e.g. an insurance inventory) and the pawn ledger:

```ts
// observe.ts
case 'inventory':
  if (d.owner === c.victim) for (const what of d.entries!) base('ownedBy', [what, V], `${N(V)}'s inventory lists ${what}.`, src);
  break;
case 'pawnledger':   // extend the existing case
  for (const pw of d.pawns || []) if (pw.dayIn >= c.day)
    base('pawnedAfter', [pw.what, pw.from], `Pawn ledger: ${pw.what} pawned by ${N(pw.from)} on ${fmtDate(pw.dayIn)}.`, src);
  break;
case 'body':         // the scene shows it was taken
  if (d.case === c.id && c.stolen) base('missing', [c.stolen], `${c.stolen} is missing from the body.`, src);
  break;
```

**2. The rule:**

```ts
// rules.ts
{ id: 'stolen-goods', formula: 'presence(P) ⇐ missing(x) ∧ ownedBy(x, V) ∧ pawnedAfter(x, P)',
  run(db, emit) {
    for (const m of db.all('missing')) for (const o of db.where('ownedBy', str(m, 0)))
      for (const pa of db.where('pawnedAfter', str(m, 0)))
        emit('presence', [str(pa, 1)], `${N(str(pa, 1))} pawned the ${str(m, 0)} taken from the body.`, [m, o, pa]);
  } },
```

**3. Is it valid?** The validity principle must hold in the world. An innocent fence could pawn the watch, so the generator must make the killer pawn it personally, and items must be unique enough (e.g. "gold watch engraved J.K.") that nobody else's pawned watch matches. If the realisation can't guarantee that, the check will catch it: an innocent who becomes provable makes `checkCase` fail.

**4. Strategy:**

```ts
} else if (plan.presence === 'stolen') {
  const what = `gold watch engraved ${initials(vic)}`;
  c.stolen = what;
  ledger.data.pawns!.push({ what, from: kil.id, to: null, dayIn: day + 1, dayOut: null });
  addItem(W, vh.spotKeys.desk, { kind: 'inventory', name: 'Insurance inventory', data: { owner: vic.id, entries: [what, 'fur coat', 'radio set'] } });
}
```

The pawn entry dated `day + 1` lies in the future of the crime night. That's fine: the detective arrives the next morning, and the dispatch is dated `day + 1`.

### 6.3 Checklist for a new deduction

- [ ] Every fact it emits is **true in the world**. Records are never wrong, and testimony is only used to contradict.
- [ ] If it uses **absence** ("not in the book"), the source carries an explicit completeness fact (`roll`, `bookList`, `staffList`, `keyholders`).
- [ ] If it makes someone **identifying** (means/presence), it can only ever be true of the killer. Think about housemates, previous owners, fences and namesakes.
- [ ] The generator **plants every link** and gives the player a pointer to each next step: the tag names the cobbler, the register names the pawn shop, the call log shows a number the directory can resolve.
- [ ] Honest statements still come from timelines. If the strategy moves someone, update their timeline, not just their words.
- [ ] Add it to a difficulty profile and run `npm test`. The soundness test generates about 90 cases per difficulty and plays each shortest proof with real game actions.

### 6.4 Ideas the language is ready for

- **Alibi witnesses with records:** a cinema stub with seat and showing time (`rec` at the cinema), contradicted by an usher's seating chart (`roll`).
- **Vehicles:** a car seen near the scene by plate fragment, plus the vehicle registry (a uniqueness rule like the initials ones).
- **Chains of custody:** a weapon bought legally, reported stolen, recovered at the scene. A new `regStolen` fact would make the register *not* tie the gun to the reporter.
- **Two-person crimes:** an accomplice with their own presence pillar. `guilty` would be emitted for both, and `checkCase` would accept a set of culprits.
- **Workplace or alley crime scenes:** the scene is just an address. Rules referring to "the victim's apartment" (locked door, keyholders) would need a scene-kind check.
