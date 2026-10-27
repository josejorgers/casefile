// Static tables and small utilities.
import type { AddressKind, BizType, Difficulty, DifficultyId, MotiveType, Person, Shift } from './types';

export interface Rng {
  next(): number; state(): number;
  int(a: number, b: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  shuffle<T>(arr: readonly T[]): T[];
}

// mulberry32 — its whole state is one integer, so it can be saved and resumed.
export function RNG(seed: number): Rng {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    state: () => s >>> 0,
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: arr => arr[Math.floor(next() * arr.length)],
    chance: p => next() < p,
    shuffle: arr => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    },
  };
}

export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export const FIRST_M = ['James', 'John', 'Robert', 'Michael', 'William', 'David', 'Richard', 'Joseph', 'Thomas', 'Charles',
  'Frank', 'Raymond', 'Walter', 'Harold', 'Eddie', 'Louis', 'Victor', 'Arthur', 'Leon', 'Marcus', 'Oscar', 'Felix',
  'Hugo', 'Ivan', 'Nathan', 'Dale', 'Gordon', 'Vincent', 'Carl', 'Roy', 'Stanley', 'Ruben', 'Tony', 'Elijah',
  'Samuel', 'Dominic', 'Wesley', 'Silas', 'Otis', 'Benny'];
export const FIRST_F = ['Mary', 'Patricia', 'Linda', 'Barbara', 'Elizabeth', 'Susan', 'Margaret', 'Dorothy', 'Helen', 'Ruth',
  'Alice', 'Grace', 'Irene', 'Vera', 'Lillian', 'Rosa', 'Nora', 'Edith', 'Clara', 'Hazel', 'Ingrid', 'Marlene',
  'Sylvia', 'Gloria', 'Joan', 'Diane', 'Carol', 'Judith', 'Ada', 'Mabel', 'Lucille', 'Frances', 'Ivy', 'Opal',
  'Pearl', 'Stella', 'Wanda', 'Yvonne', 'Theresa', 'Nadia'];
export const LAST = ['Abbott', 'Barker', 'Castillo', 'Dawson', 'Ellison', 'Fischer', 'Garrity', 'Holloway', 'Ingram', 'Jansen',
  'Kowalski', 'Lindqvist', 'Moreau', 'Novak', 'Okafor', 'Petrov', 'Quinlan', 'Reyes', 'Sato', 'Thorne', 'Ulrich',
  'Vance', 'Whitaker', 'Yates', 'Zimmer', 'Archer', 'Bishop', 'Crane', 'Delgado', 'Eastwood', 'Flynn', 'Grimaldi',
  'Hayes', 'Iverson', 'Jordan', 'Keane', 'Lombardi', 'Mercer', 'Nash', 'Ortega', 'Pike', 'Russo', 'Sullivan',
  'Tanaka', 'Valdez', 'Walsh', 'Becker', 'Cole', 'Dunn', 'Ferris', 'Gallo', 'Hart', 'Kerr', 'Lowe', 'Malone',
  'Neville', 'Osborne', 'Price', 'Ramsey', 'Stone', 'Tate', 'Underwood', 'Webb', 'Brandt', 'Calloway', 'Drake',
  'Fontaine', 'Greer', 'Hendricks', 'Kessler', 'Marsh', 'Quigley', 'Rourke', 'Sloane', 'Voss', 'Wolfe'];
export const STREETS = ['Elm Street', 'Oak Avenue', 'Harbor Road', 'Mercer Street', 'Kingsley Avenue', 'Fulton Street',
  'Ash Lane', 'Canal Street', 'Ridge Road', 'Pike Street', 'Delancey Avenue', 'Water Street'];

export const SOLES = ['Wave', 'Diamond', 'Chevron', 'Circle', 'Bar', 'Hex', 'Zigzag'];
export const WEAR = ['a nick across the left heel', 'a worn-down outer edge', 'a missing tread block near the toe',
  'a tack lodged in the sole', 'a diagonal cut across the ball', 'a cracked right heel', 'a patched toe', 'an even, barely-worn sole'];
export const HAIR = ['black', 'brown', 'blond', 'red', 'grey'];
export const HEIGHT = ['short', 'average height', 'tall'];
export const BUILD = ['slim', 'average', 'heavy'];
export const EYES = ['brown', 'blue', 'green', 'grey'];
export const GUNS: [string, string][] = [['.38', 'Revolver'], ['9mm', 'Pistol'], ['.45', 'Pistol'], ['.22', 'Pistol']];
export const MELEE: Record<'knife' | 'blunt', string[]> = {
  knife: ['Kitchen knife', 'Hunting knife', 'Switchblade'],
  blunt: ['Claw hammer', 'Tire iron', 'Pipe wrench', 'Brass candlestick'],
};
export const DRINKS = ['whiskey sour', 'gin rickey', 'draft beer', 'rye, neat', 'martini', 'bourbon & soda'];

export const BUSINESS_TYPES: Record<BizType, { label: string; names: string[]; jobs: [string, Shift][] }> = {
  diner: { label: 'Diner', names: ["{L}'s Diner", 'Blue Plate Diner', 'Sunrise Diner', 'Corner Diner'],
    jobs: [['Cook', [6, 15]], ['Waiter', [7, 15]], ['Cook', [14, 23]], ['Waiter', [15, 23]], ['Manager', [9, 17]]] },
  bar: { label: 'Bar', names: ['The Rusty Anchor', 'The Black Cat', 'Neon Lounge', 'The Last Call', "{L}'s Tavern"],
    jobs: [['Bartender', [18, 2]], ['Bouncer', [20, 3]], ['Manager', [12, 20]], ['Bartender', [12, 20]]] },
  office: { label: 'Office', names: ['{L} & {L} Law', '{L} Accounting', 'Metro Insurance', '{L} Realty', 'Harbor Shipping Co.'],
    jobs: [['Clerk', [9, 17]], ['Accountant', [9, 17]], ['Secretary', [8, 16]], ['Manager', [9, 18]], ['Clerk', [9, 17]]] },
  factory: { label: 'Factory', names: ['{L} Steelworks', 'Bayside Cannery', 'Union Textile Mill', '{L} Auto Parts'],
    jobs: [['Line Worker', [6, 14]], ['Foreman', [7, 15]], ['Line Worker', [14, 22]], ['Line Worker', [22, 6]], ['Night Guard', [22, 6]]] },
  clinic: { label: 'Clinic', names: ['St. Agnes Clinic', 'City Medical Center', '{L} Health Clinic'],
    jobs: [['Nurse', [7, 19]], ['Doctor', [8, 18]], ['Nurse', [19, 7]], ['Receptionist', [8, 16]]] },
  shop: { label: 'Shop', names: ['{L} Grocery', '{L} Hardware', 'Five & Dime', '{L} Books', 'Quick Mart'],
    jobs: [['Owner', [8, 18]], ['Clerk', [8, 16]], ['Clerk', [12, 20]]] },
  gunshop: { label: 'Gun shop', names: ['{L} Firearms'], jobs: [['Gunsmith', [9, 18]], ['Clerk', [10, 18]]] },
  pawnshop: { label: 'Pawn shop', names: ["{L}'s Pawn & Loan", 'Second Chance Pawn', 'Golden Pawn'], jobs: [['Pawnbroker', [9, 18]], ['Clerk', [10, 19]]] },
  cobbler: { label: 'Shoe repair', names: ['{L} Shoe Repair', 'Heel & Sole', 'Ace Shoe Repair'], jobs: [['Cobbler', [8, 17]], ['Clerk', [9, 18]]] },
};
/** Businesses that make staff clock in and out. The others keep no record of who worked late. */
export const CLOCKED: BizType[] = ['diner', 'bar', 'factory', 'clinic'];

export const SPOTS: Record<AddressKind, [string, string][]> = {
  home: [['entrance', 'Entrance'], ['living', 'Living room'], ['kitchen', 'Kitchen'], ['bedroom', 'Bedroom'],
    ['desk', 'Desk'], ['phone', 'Telephone'], ['trash', 'Trash can']],
  business: [['entrance', 'Entrance'], ['counter', 'Front counter'], ['office', 'Back office'], ['phone', 'Telephone'], ['alley', 'Alley dumpster']],
  lobby: [['entrance', 'Entrance'], ['mail', 'Mailboxes'], ['super', "Superintendent's office"]],
  payphone: [['booth', 'Phone booth']],
};

export const TYPE_DEFECTS = ["the lowercase 'e' sits noticeably high", "the 't' has a chipped crossbar", "the 'a' prints as a filled-in blot",
  "the capital 'R' leans to the right", "the 'o' punches clean through the paper", "the 's' always prints faint", "the 'n' drops below the line",
  "the 'h' is missing its serif", "the 'd' leaves a smudge to its left", "the 'i' never gets its dot", "the 'm' prints doubled",
  "the 'g' has a broken tail", "the 'k' is badly crooked", "the 'r' prints half-height", "the 'y' tilts left"];
export const KNIFE_BRANDS = ['Hartmann', 'Solingen Star', 'Carver & Sons', 'Regent', 'Bluebird', 'Keystone', 'Lindqvist Steel'];

export const MOTIVE_LABEL: Record<MotiveType, string> = {
  debt: 'an unpaid debt', jealousy: 'a jealous ex-lover', grudge: 'a workplace grudge', blackmail: 'blackmail',
};

export const DIFFICULTIES: Record<DifficultyId, Difficulty> = {
  easy: {
    id: 'easy', label: 'Easy', blurb: 'Everyone tells the truth. Bloody prints, signed letters, and a killer who cracks when cornered.',
    presence: ['bloodprint', 'shoesHome'], means: ['home', 'prints', 'register'], motive: ['signed', 'gossip'], motiveCount: [2, 3],
    opp: ['partner', 'timesheet'], dropPillar: 0, narrow: 0, minCost: 0,
    liarRate: 0, refuseRate: 0, silentRate: 0, killerRefusesPrints: 0, herrings: [1, 1], visitRate: 0.3,
    killerConfront: 'breaks', walletStolen: 0,
  },
  normal: {
    id: 'normal', label: 'Normal', blurb: 'Innocents lie about their own secrets. Initials instead of names, locked doors, broken alibis that need two cards.',
    presence: ['shoesHome', 'elimination', 'shoesTag', 'bloodprint'], means: ['register', 'knifeblock', 'prints', 'home'],
    motive: ['initialsBook', 'gossip', 'signed', 'typed'], motiveCount: [1, 2], opp: ['tabTime', 'ticket', 'timesheet', 'partner'],
    dropPillar: 0.3, narrow: 0, minCost: 11,
    liarRate: 0.2, refuseRate: 0.12, silentRate: 0, killerRefusesPrints: 0.5, herrings: [1, 2], visitRate: 0.6,
    killerConfront: 'secondLie', walletStolen: 0.2,
  },
  hard: {
    id: 'hard', label: 'Hard', blurb: 'One pillar is missing for good. Weapons change hands, alibis lean on accomplices, the time of death must be pinned down. The killer lawyers up.',
    presence: ['shoesTag', 'elimination'], means: ['pawn', 'knifeblock', 'prints'], motive: ['typed', 'hand', 'initialsBook'], motiveCount: [1, 2],
    opp: ['payphone', 'accomplice', 'ticket', 'tabTime'], dropPillar: 1, narrow: 1, minCost: 17,
    liarRate: 0.4, refuseRate: 0.25, silentRate: 0.1, killerRefusesPrints: 1, herrings: [2, 3], visitRate: 0.8,
    killerConfront: 'lawyer', walletStolen: 0.5,
  },
};

export function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
export const pad2 = (n: number) => String(n).padStart(2, '0');
export function fmtTime(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
}
export const fmtHour = (h: number) => `${pad2(h % 24)}:00`;
export function fmtDate(day: number): string {
  const d = new Date(1987, 9, 1 + day);
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== 1987 ? { year: 'numeric' } : {}) });
}
export function pron(p: Person) {
  return p.gender === 'm' ? { subj: 'he', obj: 'him', pos: 'his' } : { subj: 'she', obj: 'her', pos: 'her' };
}
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const initials = (p: Person) => `${p.first[0]}.${p.last[0]}.`;

/** Street name without the house number. */
export const streetName = (street: string) => street.replace(/^\d+\s+/, '');

/** Clock-in / clock-out minutes for a timesheet (out may pass midnight, i.e. exceed 1440). */
export function clockTimes(pid: string, shift: Shift, day: number): { in: number; out: number } {
  const s = shift[0];
  let e = shift[1];
  if (e <= s) e += 24;
  const j1 = (hash(pid + day + 'in') % 12) - 6, j2 = (hash(pid + day + 'out') % 15) - 3;
  return { in: s * 60 + j1, out: e * 60 + j2 };
}

/** Does a shift cover minute T of the crime day? T may exceed 1440 (after midnight). */
export function shiftCovers(shift: Shift, T: number): boolean {
  let [s, e] = shift;
  if (e <= s) e += 24;
  s *= 60; e *= 60;
  return (T >= s && T <= e) || (T >= s - 1440 && T <= e - 1440);
}
