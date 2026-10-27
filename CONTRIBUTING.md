# Contributing to Casefile

Thanks for your interest! Casefile is a procedural detective game where every case is generated as a proof and the District Attorney only accepts real evidence. Contributions of all sizes are welcome: bug reports, balance feedback, new kinds of evidence, UI polish and documentation.

## Getting started

You need Node.js 20 or newer.

```bash
git clone https://github.com/josejorgers/casefile.git
cd casefile
npm install
npm run dev        # play at http://localhost:5173
npm test           # soundness tests
npm run build      # typecheck + production build
```

In development, the browser console has a `window.__cf` handle with the hidden world (`__cf.W`) and the detective's knowledge (`__cf.K`). It's handy for debugging, but please don't rely on it in game code. It's stripped from production builds.

## Before you start

Read the two design documents. They explain how everything fits together:

- [doc/case-generation.md](doc/case-generation.md): the case language, the proof-first generator, and a step-by-step guide to adding new evidence and deductions
- [doc/city-and-solvability.md](doc/city-and-solvability.md): how the city is generated and why every case is solvable

For anything bigger than a bug fix, please **open an issue first** describing what you'd like to do, so we can agree on the approach before you spend time on it.

## Design principles

These are the things that make Casefile what it is. Changes that break them are unlikely to be merged:

1. **Crime solving only.** No rent, lockpicks or life simulation. The detective investigates; that's the game.
2. **No lucky guesses.** The DA files charges only when the submitted evidence proves the case. Every case must be solvable, and no innocent person may ever be chargeable.
3. **The board is free-form.** Cards and strings are the player's own notes. Game logic must never depend on how cards are linked.
4. **Every rule is a valid inference.** Records are accurate, honest testimony is true, testimony only contradicts and never vouches, and absence only counts in records that say they are complete. See "The validity principle" in `doc/case-generation.md`.
5. **Honest statements come from timelines.** If a feature changes where someone was, change their timeline, not just their words.
6. **Minimal dependencies.** Plain TypeScript, no UI framework, no runtime dependencies. Vite and Vitest are the only tooling.

## Making changes

1. Fork the repository and create a branch from `main` (`feature/parking-tickets`, `fix/tab-book-times`…).
2. Make your change. Match the style of the surrounding code: strict TypeScript, small pure functions where possible, comments that explain *why*.
3. Make sure all of these pass:
   ```bash
   npm run typecheck
   npm test
   npm run build
   ```
4. Play at least one case of the affected difficulty in the browser.
5. Open a pull request. Describe what changed and why, how you tested it, and include screenshots for UI changes.

### Adding a new kind of evidence or deduction

Follow section 6 of `doc/case-generation.md`. In short:

- **types:** the new item kind, data fields or strategy name (`src/types.ts`)
- **observation:** what the evidence asserts, as base facts (`src/logic/observe.ts`)
- **rule:** only if existing rules can't already use those facts (`src/logic/rules.ts`)
- **generator strategy:** plants every link, with a feasibility check (`src/crime.ts`), added to a difficulty profile (`src/data.ts`)
- **text and UI:** document text (`src/docs.ts`), item label and any lab action (`src/ui/view.ts`, `src/state.ts`)

The soundness test generates about 90 cases per difficulty and plays the shortest proof of each one with real game actions. If your change lets an innocent person be proven guilty, or makes a case unprovable, the test will tell you which seed and case failed.

### Balancing difficulty

Difficulty is set in `DIFFICULTIES` (`src/data.ts`). When you change it, report how the shortest-proof costs moved (`c.minCost` over many seeds) and how often cases were rejected (`rejections` exported from `src/crime.ts`).

## Reporting bugs

Please open an issue with:

- the difficulty and what you expected versus what happened;
- the DA's verdict text, if it's about a verdict;
- if possible, the city seed and case number. In a dev build, run `__cf.W.seed` and `__cf.W.cases.length` in the console. Cities are reproducible from their seed.

Unfair cases are bugs too: if you believe a case couldn't be solved, or the DA accepted something it shouldn't have, please report it.

## Code of conduct

Be kind and constructive. Assume good intent, keep discussions about the work, and help newcomers find their way around. Harassment of any kind isn't tolerated.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
