# Casefile

A procedural detective game inspired by the investigation side of *Shadows of Doubt*. Every new city has its own buildings, businesses and residents, and murders are committed in it. You build a case on a corkboard, and the District Attorney files charges only when the evidence proves who did it.

## Running
```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # soundness tests (Vitest)
npm run build      # typecheck + production build into dist/
```
Progress saves in the browser automatically.

## How cases are made: proof first
Crimes are described in a small **case language**: facts (`claim(P, place, from, to)`, `rec(P, bar, 21:10, 23:40)`, `shoePrint(I, 10, Hex, wear)`…) and inference rules over them (`src/logic/rules.ts`). For each case the generator:
1. **Plans the proof.** For each pillar it picks a chain of deductions allowed by the difficulty (e.g. presence by elimination of key holders; means through the gun register and a pawn ledger). On Hard one pillar is left unprovable on purpose.
2. **Builds the world around it.** Everyone's timeline for the night, the traces at the scene, the records (tab books, timesheets, call logs, tickets), the lies and rumours. Honest statements are read straight off the timelines, so they never contradict a record.
3. **Checks the whole world** with the same rules (`checkCase`): the killer must be provable, nobody else may be, the dropped pillar must really be unprovable, and the *shortest* proof must cost at least the difficulty's minimum. Otherwise it rolls again.

The DA, the judge and confrontations all run the same rules over the cards you submit, so anything the language can derive, the game understands. Once a case is closed you can see the shortest proof that existed.

## Deductions in the language
- **Time of death**: the coroner's wide window, narrowed by a call the victim answered, a smashed watch, a neighbour who heard the shot.
- **Locked doors and elimination**: the door was locked with a key, so the killer is a key holder. Rule out every other key holder with a record that covers the time of death, optionally filtered by a witness's description.
- **Dated traces**: mud prints dated by the rain in the morning paper, bus tickets, payphone calls.
- **Object chains**: bullet → gun → register → pawn shop → buyer; bloody shoe print → dumped shoes → repair tag → cobbler's ledger; the gap in a knife block; typed letters → typewriter → staff roster + initials; handwriting comparisons.
- **Payphones**: a call from the payphone on the victim's street, plus the partner who says who called, puts the killer there.
- **Accomplices**: a friend vouches for the killer. Break the friend's own story first; their revised statement breaks the killer's.
- **Complete records**: tab books and timesheets list everyone, so absence from them is evidence. Testimony only ever counts *against* an account, never as an alibi.

## Difficulty
| | Easy | Normal | Hard |
|---|---|---|---|
| Typical chains | blood prints, shoes at home, signed letters, partner contradicts | dumped shoes + repair tag, locked doors, initials, tab-book close times, bus tickets | pawn chains, accomplices, payphones, typewriters, handwriting, narrowed time of death |
| Innocent people who lie | none | some | many |
| Pillars available | all four | sometimes one missing | one always missing |
| Shortest proof cost | any (~7–11) | ≥ 11 | ≥ 17 |
| Killer when confronted | admits being there | tells a second lie | lawyers up |

## Documentation
- [doc/case-generation.md](doc/case-generation.md): the case language, the proof-first generator, and how to add new evidence and deductions
- [doc/city-and-solvability.md](doc/city-and-solvability.md): how the city and its people are generated, the roles in a case, and why every case is solvable

## Code
- `src/types.ts`: model types (`World` = hidden truth, `Knowledge` = what the detective knows)
- `src/data.ts`: tables, difficulty profiles, utilities
- `src/world.ts`: city generation
- `src/story.ts`: timelines of the night and everything people say
- `src/crime.ts`: the proof-first generator and `checkCase`
- `src/logic/engine.ts`: forward-chaining engine with cheapest-derivation tracking
- `src/logic/rules.ts`: the case language (rules)
- `src/logic/observe.ts`: evidence → base facts (shared by the DA and the generator)
- `src/logic/analyse.ts`: glue, plus the omniscient detective used for checking
- `src/state.ts`: game state, board cards, investigation actions
- `src/docs.ts`: document text
- `src/interview.ts`: questions, statements, confrontation
- `src/da.ts`: the DA's verdict and the judge's warrants
- `src/ui/board.ts`, `src/ui/view.ts`: the corkboard and the rest of the UI

## Contributing
Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License
[MIT](LICENSE) © José Jorge Rodríguez
