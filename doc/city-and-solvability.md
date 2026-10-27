# The city, its people, and why every case is solvable

This document describes how a Casefile city is generated (`src/world.ts`), what each case adds to it (`src/crime.ts`, `src/story.ts`), the roles people play in a case, and the layers of guarantees that make every case solvable and never solvable *against the wrong person*.

For the case language and the generator's planning, see [case-generation.md](case-generation.md).

---

## 1. The world model

`World` (in `src/types.ts`) is the hidden truth. The player never sees it directly. Everything they learn goes through `Knowledge` (prints lifted, items taken, statements heard, lab results).

```ts
export interface World {
  seed: number; day: number; rngState: number; n: number;
  buildings: Record<string, Building>; addresses: Record<string, Address>; people: Record<string, Person>;
  spots: Record<string, Spot>; items: Record<string, Item>;
  calls: Call[]; cases: Case[]; gunSales: GunSale[];
  weather: Record<number, number | null>; // day -> minute the rain began that evening
}
```

- **Building** → one or more **addresses** (an apartment, a business, a lobby, a payphone).
- **Address** → **spots** (entrance, desk, alley dumpster…), each holding **items** and **fingerprints**.
- All randomness comes from a seeded `mulberry32` generator. Its state (`W.rngState`) is saved, so a city and its future cases are reproducible from the seed.

---

## 2. Generating the city (`generateWorld`)

### 2.1 Places

| What | How many | Notes |
|---|---|---|
| Streets | 7 of 12 names | e.g. "Elm Street", "Delancey Avenue" |
| Businesses | 14, one building each | 2 diners, 3 bars, 2 offices, a factory, a clinic, 2 shops, a gun shop, a pawn shop, a cobbler |
| Apartment buildings | 10 | 2–3 floors × 1–2 units, plus a lobby |
| Payphones | one per street | a `booth` building with a listed number |

Every home and business gets a unique phone number. Business names come from templates (`"{L} Accounting"`, `"The Rusty Anchor"`) and are unique.

Spots by address kind (`SPOTS` in `src/data.ts`):

| Kind | Spots |
|---|---|
| home | entrance, living room, kitchen, bedroom, desk, telephone, trash can |
| business | entrance, front counter, back office, telephone, alley dumpster |
| lobby | entrance, mailboxes, superintendent's office |
| payphone | phone booth |

### 2.2 People

Each home gets a household: 58% one person, 30% a couple (80% mixed-gender, 60% sharing a surname), 12% two flatmates.

```ts
const p: Person = { id, first, last, gender, age: rng.int(21, 66), home, work: '', job: '', shift: [9, 17],
  look: { hair, height, build, eyes }, shoe, partner: null, friends: [], gun: null, alive: true, arrested: false };
```

- **Names** are unique across the city.
- **Shoes** are unique: size + sole pattern + wear mark is never repeated. A shoe print matched on all three identifies exactly one pair.
- **Jobs:** every business's slots are filled round-robin before any business gets a second person in a role. Each job has a shift (`Bartender 18–02`, `Night Guard 22–06`, `Clerk 9–17`…).
- **Friendships:** 2–3 per person (up to 5 with reciprocation), 40% drawn from co-workers.
- **Looks** (hair, height, build, eyes) are random. They only matter for witness descriptions.

### 2.3 What every home contains

| Item | Where | Used for |
|---|---|---|
| Call log | telephone | calls, numbers to look up, time of death, "was home at t" |
| Phone bill | desk | name ↔ address ↔ number |
| Address book, one per resident | desk | contacts; warrants; resolving initials |
| Employment letter | desk | workplace and shift |
| Shoes, one pair per resident | bedroom | matching shoe prints; 35% carry a cobbler's repair tag |
| Gun (18% of people) | bedroom nightstand | registered in the gun shop's register |
| Knife block (55% of homes) | kitchen | a brand, all slots filled unless a case says otherwise |
| Postcard from a friend (50%) | living room | handwritten and signed: a handwriting sample of the friend |
| Something in the trash | trash can | flavour: receipts, ticket stubs, a note to call someone |

**Fingerprints:** residents everywhere in their home, visiting friends at the entrance and living room, employees all over their workplace, two employees on the alley dumpster, random passers-by on payphones.

### 2.4 What every business contains

| Item | Where |
|---|---|
| Call log, staff roster | telephone, back office |
| Typewriter with a unique defect ("the 't' has a chipped crossbar") | back office |
| Firearms sales register | gun shop |
| Pawn ledger, pre-filled with watches, trumpets, rings… | pawn shop |
| Repair ledger listing every repair tag in the city | cobbler |

### 2.5 Lobbies and payphones

Each lobby has **mailbox labels** (who lives in which apartment) and a **spare key register**: for every apartment, 0–2 friends of the residents who hold a key. Each street has a payphone listed in the directory as "Payphone, <street>".

### 2.6 Phone history

3–7 calls per home over the previous days, between friends' homes and workplaces, 80% answered with a duration.

---

## 3. What a case adds

The city persists between cases. Victims die, killers are arrested, and the day advances by 1–3. Each case adds:

- **the night's timelines** for everyone whose evening differs from their routine (`c.timeline`);
- **traces at the scene:** body, wallet (unless stolen), bullet or weapon, front door, possibly a smashed watch, a bloody shoe print, a blood fingerprint, muddy prints from earlier visitors;
- **records of the night:** a timesheet for each business that clocks its staff (diners, bars, factory, clinic), a tab book for each bar, the morning paper with the weather (75% chance of rain starting 20:00–20:50), and the day's calls;
- **documents and rumours** for the motive, and weak motives for red herrings;
- **who refuses** fingerprints and who refuses to give an alibi.

### 3.1 Roles in a case

| Role | Who | What they do |
|---|---|---|
| **Victim** | lives alone, not working around the time of death | dies between 22:00 and 00:30 |
| **Killer** | doesn't live with the victim, free that evening; motive debt, jealousy, grudge (co-worker) or blackmail | leaves home, goes to the scene, leaves; lies about it as the plan dictates |
| **Killer's partner** | if they share a home | honest: reports when the killer went out and came back, and any call from them |
| **Accomplice** (`accomplice`) | a friend of the killer who lives alone | vouches for the killer while actually at a bar; gives them up when their own lie is exposed |
| **Key holders** (`elimination`) | friends or co-workers of the victim | hold spare keys; were at a bar during the killing, so the tab book clears them once the time of death is narrow enough |
| **Red herrings** | 1–3 from the victim's circle | weak motive (a car-repair debt); may have visited that evening, leaving a muddy print; may lie about it |
| **Innocent liars** | 0–40% of people, more among those close to the victim | hide an affair or a bar visit; their partner or lover contradicts them; confronted, they tell the truth |
| **Lovers** | live alone | honest: "she was here with me from 21:10 until 23:40 — please keep it quiet" |
| **Early drinkers** | 2–4 per bar | ran a tab in the early evening, so tab books aren't just liars |
| **Neighbours / witnesses** | in the victim's building, home at the time | heard the shot or thud (time of death), saw someone leave (description; lock heard except on Hard), saw a herring arrive |
| **Gossips** | the victim's friends, co-workers and neighbours | carry rumours about motives |
| **Refusers / silent** | random, by difficulty | refuse fingerprints without a warrant / refuse to give an alibi. Never anyone whose word the case needs (partners, lovers, witnesses, key holders, the accomplice) |

Roles are exclusive: a `taken` set makes sure nobody is both a key holder and a liar, for instance.

---

## 4. How we make sure every case is solvable

Solvability rests on five layers. The first three make wrong conclusions impossible, the fourth checks every generated case, and the fifth tests the whole pipeline.

### Layer 1 — One source of truth: timelines

Everything about the night derives from timelines:

- **Records** are generated from them. Tab books list every bar segment with exact open and close times. Calls are answered only if someone is at home (`answered()` in `crime.ts`). Timesheets follow shifts, with jitter under 10 minutes.
- **Honest statements** are read from them (`honestAccount` in `story.ts`).
- **Witness accounts** are only given by people who were at home at that minute (`homeAt(n.id, T)`).

So records and honest statements always agree. A contradiction between a claim and a record can only come from a lie. Nobody has to hand-check consistency: the rule is enforced by construction.

### Layer 2 — Valid rules

Every rule in the case language is a valid inference over true facts (see "the validity principle" in `case-generation.md`). In particular:

- **Testimony only contradicts.** It can expose a lie, but only records can clear someone. A lying accomplice therefore can't give the killer an alibi, and a lying herring can't clear themselves.
- **Absence needs completeness.** "Not in the tab book" proves something only because the book declares itself complete, and the generator makes that true: every bar segment goes into the book.
- **Identifying routes are exclusive to the killer.** Shoes are unique per person. A knife block only points at the killer when they live alone. The pawn chain overrides the original buyer, because the register marks the gun as pawned. Elimination needs every *other* key holder covered by a record.

Because rules are valid and facts are true, the engine can't derive `guilty(innocent)` from any subset of the evidence. It can only fail to derive `guilty(killer)`.

### Layer 3 — Monotone judging

The DA uses the same rules on a **subset** of the evidence (the cards submitted, the lab work done). More evidence can only add facts. The non-monotone parts (uniqueness of initials, "the only key holder not accounted for") are computed over lists that are complete in themselves (an address book, a staff roster, a key register). Fewer facts only make them *less* likely to fire. So what can't be proven against an innocent person with all the evidence can't be proven with less.

### Layer 4 — `checkCase` on every generated case

After building, `checkCase` runs the rules over **the entire world**, playing an omniscient detective who has every item, every lab result, everyone's prints and every statement, including those that only come out after confrontations. The case is accepted only if:

| Check | Why |
|---|---|
| no `guilty(X)` for anyone but the killer | catches any accidental coincidence (a namesake, a same-brand knife block, a housemate…) |
| `guilty(killer)` is derivable | the planned chain was actually realised |
| shortest proof cost ≥ `minCost` | no shortcut makes a Hard case easy |
| dropped pillars really are unprovable | "one pillar is missing" on Hard is true |
| if the killer refuses prints, ≥ 2 warrant connections exist | the warrant is obtainable when prints matter |

On failure the world is restored and the generator tries again (up to 40 attempts). Accepted cases store their shortest proof, shown to the player after closing.

### Layer 5 — Play-through tests (`tests/soundness.test.ts`)

For about 90 cases per difficulty (30 seeds × 3 consecutive cases), the test:

1. Re-runs `checkCase` on a JSON round-trip copy of the world (saves can't break a case).
2. **Plays the shortest proof with real game actions:** takes the items, runs ballistics, blood, typeface and handwriting tests, dusts weapons, samples prints (serving warrants when someone refuses), asks the questions, and **confronts liars with the gathered cards** until the gated statements come out. Then it submits to the DA and expects charges to be filed.
3. With the same evidence, names **every innocent person** as the suspect and expects the DA to refuse.

### What is *not* machine-checked: discoverability

The checks prove that a proof exists in the evidence. They don't prove the player can *find* each piece. That is handled by design: each link in a chain points at the next.

| Chain step | The pointer |
|---|---|
| victim → contacts | wallet or body prints; address book; call log numbers → directory |
| typed letter → typewriter | "Looking closely, the 't' has a chipped crossbar"; typewriters are in every business office, and grudges point at the victim's workplace |
| initials → person | the victim's address book; staff rosters |
| dumped weapon/shoes → found | always in the alley dumpster of the killer's workplace |
| shoes → owner | the repair tag names the cobbler |
| gun → buyer | the serial → the gun register (gun shop) → "pawned at …" names the pawn shop |
| payphone → place | the call log shows a number; the directory lists it as "Payphone, <street>" |
| alibi → record | people name their bar or workplace; tab books and timesheets are at those places |
| locked door → suspects | the door says it was locked with a key; the key register is in the building lobby |
| time of death | coroner (lab request on the body), the victim's call log, the watch, neighbours |
| accomplice → their lie | the killer names the friend; the friend's tab book is at the bar they don't mention, found by asking around or checking bars |

When you add a strategy, give each step such a pointer (checklist in `case-generation.md`, section 6.3).

---

## 5. Tuning knobs

All in `DIFFICULTIES` (`src/data.ts`):

| Knob | Effect |
|---|---|
| `presence`, `means`, `motive`, `opp` | which deduction chains may be planned |
| `motiveCount` | how many motive sources exist |
| `dropPillar` | chance one pillar is left unprovable (Hard: always) |
| `narrow` | locked-door cases need the time of death narrowed |
| `minCost` | minimum shortest-proof cost (Normal 11, Hard 17) |
| `liarRate`, `refuseRate`, `silentRate`, `killerRefusesPrints` | how obstructive people are |
| `herrings`, `visitRate` | red herrings, and how often they visited that night |
| `killerConfront` | `breaks` (admission) / `secondLie` / `lawyer` |
| `walletStolen` | the victim must be identified from body prints |

To see how a change affects generation, count `rejections` (exported from `crime.ts`) and look at `c.minCost` across many seeds. Then run `npm test`.
