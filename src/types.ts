// Shared model types. `World` is the hidden truth; `Knowledge` is what the detective has learned.

export type Shift = [number, number]; // [startHour, endHour]; end <= start means it runs past midnight
export type BizType = 'diner' | 'bar' | 'office' | 'factory' | 'clinic' | 'shop' | 'gunshop' | 'pawnshop' | 'cobbler';
export type AddressKind = 'home' | 'business' | 'lobby' | 'payphone';
export type MotiveType = 'debt' | 'jealousy' | 'grudge' | 'blackmail';
export type WeaponType = 'gun' | 'knife' | 'blunt';
export type DifficultyId = 'easy' | 'normal' | 'hard';
export type FactKey = 'home' | 'phone' | 'work' | 'job' | 'look' | 'shoes';

export interface Look { hair: string; height: string; build: string; eyes: string }
export interface Shoe { size: number; sole: string; wear: string }

export interface Person {
  id: string; first: string; last: string; gender: 'm' | 'f'; age: number;
  home: string; work: string; job: string; shift: Shift;
  look: Look; shoe: Shoe;
  partner: string | null; friends: string[]; gun: string | null;
  alive: boolean; arrested: boolean; diedDay?: number; arrestedDay?: number;
}

export interface Building { id: string; kind: 'business' | 'apartments' | 'booth'; street: string; addresses: string[]; lobby: string | null }

export interface Address {
  id: string; building: string; kind: AddressKind;
  spots: string[]; spotKeys: Record<string, string>;
  residents: string[]; employees: string[]; phone: string | null;
  name?: string; biz?: BizType; unit?: string;
}

export interface Spot { id: string; addr: string; key: string; name: string; items: string[]; prints: string[]; bloodPrints: string[] }

/** How a document names the person it is about: in full, by initials only, or not at all. */
export type Ident = 'name' | 'initials' | 'anon';
export interface Motive {
  suspect: string; victim: string; case: number; weak?: boolean;
  ident?: Ident;
  /** 'author': the suspect wrote it. 'subject': someone else wrote about the suspect. */
  role?: 'author' | 'subject';
}

export type ItemKind = 'doc' | 'weapon' | 'body' | 'bullet' | 'shoeprint' | 'shoes' | 'wallet' | 'phone' | 'addressbook'
  | 'staff' | 'timesheet' | 'mailboxes' | 'register' | 'tabs'
  | 'paper' | 'keylog' | 'door' | 'watch' | 'ticket' | 'typewriter' | 'pawnledger' | 'repairs' | 'knifeblock';

export interface TabEntry { pid: string; t: number; close: number; order: string }
export interface PawnEntry { what: string; serial?: string; from: string; to: string | null; dayIn: number; dayOut: number | null }

export interface ItemData {
  owner?: string; entries?: string[]; addr?: string; day?: number; building?: string;
  size?: number; sole?: string; wear?: string; case?: number;
  weaponType?: WeaponType; caliber?: string; serial?: string; bloodOf?: string; brand?: string;
  tabs?: TabEntry[];
  /** shoe print left in blood (during the killing) rather than mud */
  blood?: boolean;
  /** cobbler's repair tag number on a pair of shoes */
  tag?: string;
  repairs?: { tag: string; pid: string; day: number }[];
  pawns?: PawnEntry[];
  /** typed document: the typewriter it came from. handwritten: true, with its real author */
  typed?: string; hand?: boolean; author?: string; signed?: boolean;
  defect?: string;
  /** key register: apartment address -> holders of a spare key */
  keyring?: Record<string, string[]>;
  /** door found locked from outside / knife block with a knife missing */
  locked?: boolean; empty?: boolean;
  t?: number; street?: string;
}

export interface Item {
  id: string; spot: string; kind: ItemKind; name: string; text: string; data: ItemData;
  prints?: string[]; facts?: [string, ...FactKey[]][]; motive?: Motive;
}

/** A phone call. dur = 0 means nobody answered. `by` is who physically placed it, when that matters. */
export interface Call { from: string; to: string; day: number; t: number; dur: number; by?: string }
export interface GunSale { pid: string; day: number; model: string; caliber: string; serial: string; pawnedAt?: string; pawnDay?: number }

/** Where someone was. place is an address id, `st:<street>` for a bus stop, or null for "out, nowhere on record". */
export type Place = string;
export interface Seg { place: Place | null; from: number; to: number }

/** An innocent person with something to hide about where they were. */
export interface Liar { secret: 'bar' | 'affair' | 'visit'; place: string; lover?: string; out: number; back: number }
export interface Gossip { text: string; motive?: Motive }

export type PresenceStrat = 'bloodprint' | 'shoesHome' | 'shoesTag' | 'elimination';
export type MeansStrat = 'home' | 'prints' | 'register' | 'pawn' | 'knifeblock';
export type MotiveStrat = 'signed' | 'gossip' | 'initialsBook' | 'typed' | 'hand';
export type OppStrat = 'partner' | 'timesheet' | 'tabTime' | 'ticket' | 'payphone' | 'accomplice';

/** The proof the generator committed to before building the world around it. null = that pillar is unprovable. */
export interface Plan {
  presence: PresenceStrat | null; means: MeansStrat | null; motive: MotiveStrat[]; opp: OppStrat | null;
  narrow: boolean;
}

/** A special alibi (killer, accomplice) — everyone else's alibi follows from their timeline. */
export interface ClaimSpec { place: Place; from: number; text: string }

export type Witness =
  | { kind: 'noise'; t: number }
  | { kind: 'leaving'; t: number; locked: boolean }
  | { kind: 'visit'; pid: string; t: number };

export interface Case {
  id: number; difficulty: DifficultyId; day: number; time: number;
  victim: string; killer: string; motive: MotiveType; scene: string;
  solved: boolean; attempts: number;
  weaponType: WeaponType; weaponName: string; weapon: string | null; bullet: string | null; caliber?: string; weaponAtScene: boolean;
  body: string; wallet: string | null; shoeprint: string | null; watch: string | null; door: string;
  gloves: boolean; rain: number | null;
  plan: Plan;
  timeline: Record<string, Seg[]>;  // only people whose night differs from their usual routine
  claims: Record<string, ClaimSpec>;
  secondLieBar: string;
  accomplice: string | null;
  keyholders: string[]; locked: boolean;
  witnesses: Record<string, Witness[]>;
  gossip: Record<string, Gossip[]>;
  liars: Record<string, Liar>;
  lovers: Record<string, string>; // lover pid -> liar pid
  refusers: string[];  // refuse fingerprints without a warrant
  silent: string[];    // refuse to give an alibi at all
  herrings: string[];
  tabBooks: Record<string, string>;   // bar address -> tab book item
  timesheets: Record<string, string>; // business address -> timesheet item
  /** The shortest proof of guilt that exists in the world, rendered as indented lines (shown once the case is closed). */
  proof: string[];
  minCost: number;
  /** Optional help the detective used on this case (next-step hints, killer revealed, full proof revealed). */
  help?: { steps: number; killer: boolean; proof: boolean };
}

export interface World {
  seed: number; day: number; rngState: number; n: number;
  buildings: Record<string, Building>; addresses: Record<string, Address>; people: Record<string, Person>;
  spots: Record<string, Spot>; items: Record<string, Item>;
  calls: Call[]; cases: Case[]; gunSales: GunSale[];
  weather: Record<number, number | null>; // day -> minute the rain began that evening (null = dry)
}

export type QKind = 'who' | 'alibi' | 'victim' | 'enemies' | 'saw' | 'prints';
export type StatementKind = 'alibi' | 'alibi2' | 'victim' | 'enemies' | 'saw' | 'admission';

/** What a statement asserts, in machine-readable form. The DA reasons over these, not over the prose. */
export type Said =
  | { k: 'claim'; place: Place; from: number; to: number }          // the speaker says they were here
  | { k: 'out'; pid: string; place: Place; from: number; to: number } // pid was NOT at place
  | { k: 'with'; pid: string; place: Place; from: number; to: number } // pid was at place
  | { k: 'called'; pid: string; t: number }                          // pid phoned the speaker at about t
  | { k: 'motive'; m: Motive }
  | { k: 'alive'; t: number }                                        // the victim was alive at t
  | { k: 'death'; lo: number; hi: number }                           // heard the killing between lo and hi
  | { k: 'leaving'; t: number; look: Look; locked: boolean }         // saw someone leave the scene
  | { k: 'admission'; t: number };                                   // the speaker was at the scene at t

export interface Statement {
  id: string; pid: string; case: number; kind: StatementKind; text: string;
  lie: boolean;
  said: Said[];
}

export type CardType = 'person' | 'address' | 'item' | 'print' | 'statement' | 'note' | 'unknown';
export interface Card { id: string; type: CardType; ref: string | null; x: number; y: number; title: string; notes: string }
export interface Link { a: string; b: string }
export interface PrintLoc { spot?: string; item?: string; addr: string; blood?: boolean }
export interface CaseForm { victim: string | null; suspect: string | null; weapon: string | null; evidence: string[] }

export interface Knowledge {
  board: { cards: Record<string, Card>; links: Link[]; view: { x: number; y: number; z: number } };
  nextCard: number;
  printLabels: Record<string, string>; nextLabel: number;
  samples: Record<string, boolean>; printFound: Record<string, PrintLoc[]>;
  searched: Record<string, boolean>; dusted: Record<string, boolean>; itemDusted: Record<string, boolean>;
  taken: Record<string, boolean>; lab: Record<string, string>;
  facts: Record<string, Partial<Record<FactKey, boolean>>>;
  statements: Record<string, Statement>;
  answers: Record<string, string>;     // non-statement answers (who / prints), keyed like statements
  victimId: Record<number, boolean>;
  visited: Record<string, boolean>;
  warrants: Record<string, boolean>;   // `${case}:${pid}`
  lawyered: Record<string, boolean>;   // `${case}:${pid}`
  confronted: Record<string, boolean>; // statement id -> exposed
  current: string;
  form: CaseForm;
  log: { day: number; msg: string }[];
}

export interface Difficulty {
  id: DifficultyId; label: string; blurb: string;
  presence: PresenceStrat[]; means: MeansStrat[]; motive: MotiveStrat[]; motiveCount: [number, number]; opp: OppStrat[];
  /** chance that one pillar is left unprovable (never both identifying ones) */
  dropPillar: number;
  /** elimination cases need the time of death narrowed beyond the coroner's estimate */
  narrow: number;
  /** the shortest possible proof must cost at least this much (see logic/observe.ts for the costs) */
  minCost: number;
  liarRate: number; refuseRate: number; silentRate: number; killerRefusesPrints: number;
  herrings: [number, number]; visitRate: number;
  killerConfront: 'breaks' | 'secondLie' | 'lawyer'; walletStolen: number;
}
