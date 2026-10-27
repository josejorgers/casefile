// Procedural city generation. Pure data, no DOM.
import { BUILD, BUSINESS_TYPES, EYES, FIRST_F, FIRST_M, GUNS, HAIR, HEIGHT, KNIFE_BRANDS, LAST, RNG, SOLES, SPOTS, STREETS, TYPE_DEFECTS, WEAR, fmtHour, streetName } from './data';
import type { Rng } from './data';
import type { Address, AddressKind, BizType, Building, Item, Person, World } from './types';

export function nid(W: World, prefix: string): string { return prefix + (W.n++); }

export function addItem(W: World, spotId: string, o: Partial<Item> & Pick<Item, 'name'>): Item {
  const it: Item = { id: nid(W, 'i'), spot: spotId, kind: 'doc', text: '', data: {}, ...o };
  W.items[it.id] = it;
  W.spots[spotId].items.push(it.id);
  return it;
}

export function moveItem(W: World, it: Item, spotId: string) {
  const old = W.spots[it.spot];
  old.items = old.items.filter(x => x !== it.id);
  it.spot = spotId;
  W.spots[spotId].items.push(it.id);
}

export function addPrints(W: World, spotId: string, pids: (string | null | undefined)[]) {
  const s = W.spots[spotId];
  for (const p of pids) if (p && !s.prints.includes(p)) s.prints.push(p);
}

export function giveGun(W: World, rng: Rng, p: Person): Item {
  const [caliber, model] = rng.pick(GUNS);
  const serial = 'SN-' + rng.int(10000, 99999);
  const it = addItem(W, W.addresses[p.home].spotKeys.bedroom, {
    kind: 'weapon', name: `${model} (${caliber})`,
    text: `A ${caliber} ${model.toLowerCase()}, serial number ${serial}. Kept in {p:${p.id}}'s nightstand drawer.`,
    data: { weaponType: 'gun', caliber, owner: p.id, serial }, prints: [p.id],
  });
  W.gunSales.push({ pid: p.id, day: -rng.int(20, 1500), model, caliber, serial });
  p.gun = it.id;
  return it;
}

export function addContact(W: World, owner: Person, other: Person) {
  const book = Object.values(W.items).find(i => i.kind === 'addressbook' && i.data.owner === owner.id);
  if (book && !book.data.entries!.includes(other.id)) book.data.entries!.push(other.id);
}

export function generateWorld(seed: number): World {
  const rng = RNG(seed);
  const W: World = { seed, day: 0, rngState: 0, n: 1, buildings: {}, addresses: {}, people: {}, spots: {}, items: {}, calls: [], cases: [], gunSales: [], weather: {} };
  const streets = rng.shuffle(STREETS).slice(0, 7);
  const usedAddr = new Set<string>(), usedPhone = new Set<string>(), usedNames = new Set<string>(), usedBiz = new Set<string>(), usedShoes = new Set<string>();

  const newBuilding = (kind: Building['kind']): Building => {
    let street: string;
    do { street = `${rng.int(2, 180)} ${rng.pick(streets)}`; } while (usedAddr.has(street));
    usedAddr.add(street);
    const b: Building = { id: nid(W, 'b'), kind, street, addresses: [], lobby: null };
    W.buildings[b.id] = b;
    return b;
  };
  const newPhone = () => {
    let p: string;
    do { p = `555-${rng.int(1000, 9999)}`; } while (usedPhone.has(p));
    usedPhone.add(p);
    return p;
  };
  const newAddress = (b: Building, kind: AddressKind, o: Partial<Address>): Address => {
    const a: Address = { id: nid(W, 'a'), building: b.id, kind, spots: [], spotKeys: {}, residents: [], employees: [],
      phone: kind === 'lobby' ? null : newPhone(), ...o };
    W.addresses[a.id] = a;
    b.addresses.push(a.id);
    for (const [key, name] of SPOTS[kind]) {
      const s = { id: nid(W, 's'), addr: a.id, key, name, items: [], prints: [], bloodPrints: [] };
      W.spots[s.id] = s;
      a.spots.push(s.id);
      a.spotKeys[key] = s.id;
    }
    return a;
  };

  // --- Businesses
  const businesses: Address[] = [];
  const plan: BizType[] = ['diner', 'diner', 'bar', 'bar', 'bar', 'office', 'office', 'factory', 'clinic', 'shop', 'shop', 'gunshop', 'pawnshop', 'cobbler'];
  for (const type of plan) {
    let name: string;
    do { name = rng.pick(BUSINESS_TYPES[type].names).replace(/\{L\}/g, () => rng.pick(LAST)); } while (usedBiz.has(name));
    usedBiz.add(name);
    businesses.push(newAddress(newBuilding('business'), 'business', { name, biz: type }));
  }

  // --- Apartment buildings
  const homes: Address[] = [];
  for (let i = 0; i < 10; i++) {
    const b = newBuilding('apartments');
    b.lobby = newAddress(b, 'lobby', {}).id;
    const floors = rng.int(2, 3), per = rng.int(1, 2);
    for (let f = 1; f <= floors; f++) for (let u = 0; u < per; u++) homes.push(newAddress(b, 'home', { unit: `${f}${'AB'[u]}` }));
  }

  // --- People. Shoe size + sole + wear is unique per person, so a shoe print individualises.
  function makePerson(home: Address, gender: 'm' | 'f', lastHint?: string | null): Person {
    let first: string, last: string, tries = 0;
    do {
      first = rng.pick(gender === 'm' ? FIRST_M : FIRST_F);
      last = lastHint && tries < 10 ? lastHint : rng.pick(LAST);
      tries++;
    } while (usedNames.has(first + ' ' + last));
    usedNames.add(first + ' ' + last);
    let shoe;
    do { shoe = { size: gender === 'm' ? rng.int(8, 13) : rng.int(5, 10), sole: rng.pick(SOLES), wear: rng.pick(WEAR) }; }
    while (usedShoes.has(`${shoe.size}|${shoe.sole}|${shoe.wear}`));
    usedShoes.add(`${shoe.size}|${shoe.sole}|${shoe.wear}`);
    const p: Person = { id: nid(W, 'p'), first, last, gender, age: rng.int(21, 66), home: home.id, work: '', job: '', shift: [9, 17],
      look: { hair: rng.pick(HAIR), height: rng.pick(HEIGHT), build: rng.pick(BUILD), eyes: rng.pick(EYES) },
      shoe, partner: null, friends: [], gun: null, alive: true, arrested: false };
    W.people[p.id] = p;
    home.residents.push(p.id);
    return p;
  }
  const g = () => rng.pick(['m', 'f'] as const);
  for (const h of homes) {
    const r = rng.next();
    if (r < 0.58) makePerson(h, g());
    else if (r < 0.88) {
      const a = makePerson(h, g());
      const b = makePerson(h, rng.chance(0.8) ? (a.gender === 'm' ? 'f' : 'm') : a.gender, rng.chance(0.6) ? a.last : null);
      a.partner = b.id; b.partner = a.id;
    } else { makePerson(h, g()); makePerson(h, g()); }
  }
  const all = Object.values(W.people);
  const rids0 = (res: Person[]) => res.map(p => p.id);

  // --- Jobs: fill each business's first slots round-robin so every business has staff
  const slotsByBiz = businesses.map(a => BUSINESS_TYPES[a.biz!].jobs.map(([title, shift]) => ({ addr: a.id, title, shift })));
  const ordered: { addr: string; title: string; shift: [number, number] }[] = [];
  for (let i = 0; i < 6; i++) for (const s of slotsByBiz) if (s[i]) ordered.push(s[i]);
  rng.shuffle(all).forEach((p, i) => {
    const s = i < ordered.length ? ordered[i] : rng.pick(ordered);
    p.work = s.addr; p.job = s.title; p.shift = [s.shift[0], s.shift[1]];
    W.addresses[s.addr].employees.push(p.id);
  });

  // --- Friendships
  for (const p of all) {
    const want = rng.int(2, 3);
    for (let guard = 0; p.friends.length < want && guard < 40; guard++) {
      const pool = rng.chance(0.4) ? W.addresses[p.work].employees.map(id => W.people[id]) : all;
      const q = rng.pick(pool);
      if (q.id === p.id || q.id === p.partner || p.friends.includes(q.id) || q.friends.length >= 5) continue;
      p.friends.push(q.id); q.friends.push(p.id);
    }
  }

  // --- Home contents and everyday fingerprints
  const usedTags = new Set<string>();
  const newTag = () => { let t: string; do { t = String(rng.int(1000, 9999)); } while (usedTags.has(t)); usedTags.add(t); return t; };
  const repairs: { tag: string; pid: string; day: number; shoes: Item }[] = [];
  const brands = KNIFE_BRANDS;
  const diners = businesses.filter(b => b.biz === 'diner'), bars = businesses.filter(b => b.biz === 'bar');
  for (const h of homes) {
    const sp = (k: string) => h.spotKeys[k];
    const res = h.residents.map(id => W.people[id]);
    addItem(W, sp('phone'), { kind: 'phone', name: 'Telephone call log', data: { addr: h.id } });
    addItem(W, sp('desk'), { name: 'Phone bill',
      text: `METRO BELL — Monthly statement\n\nAccount holder: {p:${res[0].id}}\nService address: {a:${h.id}}\nNumber: {n:${h.phone}}\nAmount due: $${rng.int(9, 40)}.${rng.int(10, 99)}`,
      facts: [[res[0].id, 'home', 'phone']] });
    for (const p of res) {
      const coworkers = W.addresses[p.work].employees.filter(id => id !== p.id);
      const entries = [...new Set([p.partner, ...p.friends, ...rng.shuffle(coworkers).slice(0, rng.int(0, 2))].filter((x): x is string => !!x))];
      addItem(W, sp('desk'), { kind: 'addressbook', name: `Address book of ${p.first} ${p.last}`, data: { owner: p.id, entries } });
      addItem(W, sp('desk'), { name: `Employment letter (${p.first} ${p.last})`,
        text: `{a:${p.work}}\n\nDear {p:${p.id}},\n\nWe are pleased to confirm your position as ${p.job}. Your shift runs ${fmtHour(p.shift[0])}–${fmtHour(p.shift[1])}.\n\n— Management`,
        facts: [[p.id, 'work', 'job']] });
      const shoes = addItem(W, sp('bedroom'), { kind: 'shoes', name: `Shoes, size ${p.shoe.size} (${p.first} ${p.last})`,
        data: { owner: p.id, size: p.shoe.size, sole: p.shoe.sole, wear: p.shoe.wear }, prints: [p.id] });
      if (rng.chance(0.35)) repairs.push({ tag: newTag(), pid: p.id, day: -rng.int(5, 300), shoes });
      if (rng.chance(0.18)) giveGun(W, rng, p);
      if (p.friends.length && rng.chance(0.5)) {
        const f = rng.pick(p.friends);
        addItem(W, sp('living'), { name: 'Postcard',
          text: `Handwritten:\n\n${p.first}!\n\nThanks for having me over last weekend. Let's do it again soon — drinks at {a:${rng.pick(bars).id}}?\n\n— {p:${f}}`,
          data: { hand: true, author: f, signed: true }, prints: [f, p.id] });
      }
    }
    const p0 = rng.pick(res), f0 = p0.friends.length ? W.people[rng.pick(p0.friends)] : null;
    const trash: { name: string; text: string }[] = [
      { name: 'Grocery list', text: 'Coffee, eggs, bread, cigarettes, aspirin, dish soap.' },
      { name: 'Takeout receipt', text: `{a:${rng.pick(diners).id}}\n2× meatloaf special ... $6.40\nThank you, come again!` },
      { name: 'Ticket stub', text: 'The Rialto Theatre — "Night Train to Lisbon" — Saturday 8 PM, row F.' },
    ];
    if (f0) trash.push({ name: 'Crumpled note', text: `Call {p:${f0.id}} back — {n:${W.addresses[f0.home].phone}}` });
    addItem(W, sp('trash'), rng.pick(trash));
    if (rng.chance(0.55)) {
      const brand = rng.pick(brands);
      addItem(W, sp('kitchen'), { kind: 'knifeblock', name: `Knife block (${brand})`, data: { brand, owner: res[0].id }, prints: rids0(res) });
    }

    const rids = res.map(p => p.id);
    const visitors = [...new Set(res.flatMap(p => p.friends))].filter(() => rng.chance(0.45));
    addPrints(W, sp('entrance'), [...rids, ...visitors]);
    addPrints(W, sp('living'), [...rids, ...visitors.filter(() => rng.chance(0.7))]);
    for (const k of ['kitchen', 'bedroom', 'desk', 'phone', 'trash']) addPrints(W, sp(k), rids);
  }

  // --- Business contents
  for (const r of repairs) { r.shoes.data.tag = r.tag; }
  const defects = rng.shuffle(TYPE_DEFECTS);
  for (const b of businesses) {
    const sp = (k: string) => b.spotKeys[k];
    addItem(W, sp('phone'), { kind: 'phone', name: 'Telephone call log', data: { addr: b.id } });
    addItem(W, sp('office'), { kind: 'staff', name: 'Staff roster', data: { addr: b.id } });
    if (b.biz === 'gunshop') addItem(W, sp('office'), { kind: 'register', name: 'Firearms sales register' });
    addItem(W, sp('office'), { kind: 'typewriter', name: `Typewriter (${b.name})`, data: { addr: b.id, defect: defects.pop()! } });
    if (b.biz === 'pawnshop') {
      const pawns = Array.from({ length: rng.int(5, 8) }, () => {
        const what = rng.pick(['Wristwatch', 'Trumpet', 'Wedding ring', 'Radio set', 'Camera', 'Fur coat', 'Typewriter', 'Gold chain']);
        const dayIn = -rng.int(20, 400), sold = rng.chance(0.5);
        return { what, from: rng.pick(all).id, to: sold ? rng.pick(all).id : null, dayIn, dayOut: sold ? dayIn + rng.int(5, 15) : null };
      });
      addItem(W, sp('office'), { kind: 'pawnledger', name: 'Pawn ledger', data: { addr: b.id, pawns } });
    }
    if (b.biz === 'cobbler') addItem(W, sp('office'), { kind: 'repairs', name: 'Repair ledger', data: { addr: b.id, repairs: repairs.map(r => ({ tag: r.tag, pid: r.pid, day: r.day })) } });
    addPrints(W, sp('entrance'), [...b.employees, ...rng.shuffle(all).slice(0, 4).map(p => p.id)]);
    addPrints(W, sp('counter'), b.employees);
    addPrints(W, sp('office'), b.employees);
    addPrints(W, sp('phone'), b.employees);
    addPrints(W, sp('alley'), rng.shuffle(b.employees).slice(0, 2));
  }

  // --- Lobbies
  for (const b of Object.values(W.buildings)) {
    if (!b.lobby) continue;
    const L = W.addresses[b.lobby];
    addItem(W, L.spotKeys.mail, { kind: 'mailboxes', name: `Mailbox labels, ${b.street}`, data: { building: b.id } });
    const keyring: Record<string, string[]> = {};
    for (const aid of b.addresses) {
      const a = W.addresses[aid];
      if (a.kind !== 'home') continue;
      const circle = [...new Set(a.residents.flatMap(r => W.people[r].friends))].filter(f => !a.residents.includes(f));
      keyring[aid] = rng.shuffle(circle).slice(0, rng.int(0, 2));
    }
    addItem(W, L.spotKeys.super, { kind: 'keylog', name: `Spare key register, ${b.street}`, data: { building: b.id, keyring } });
    addPrints(W, L.spotKeys.entrance, b.addresses.flatMap(id => W.addresses[id].residents));
  }

  // --- One payphone on every street
  for (const st of [...new Set(Object.values(W.buildings).map(b => streetName(b.street)))]) {
    const b: Building = { id: nid(W, 'b'), kind: 'booth', street: st, addresses: [], lobby: null };
    W.buildings[b.id] = b;
    const a = newAddress(b, 'payphone', {});
    addPrints(W, a.spotKeys.booth, rng.shuffle(all).slice(0, 3).map(p => p.id));
  }

  // --- Phone history
  for (const h of homes) {
    const res = h.residents.map(id => W.people[id]);
    const contacts = res.flatMap(p => [...p.friends.map(f => W.people[f].home), p.work]).filter(x => x !== h.id);
    const n = rng.int(3, 7);
    for (let i = 0; i < n && contacts.length; i++) {
      const other = rng.pick(contacts), out = rng.chance(0.5);
      W.calls.push({ from: out ? h.id : other, to: out ? other : h.id, day: -rng.int(0, 4), t: rng.int(480, 1320), dur: rng.chance(0.8) ? rng.int(1, 15) : 0 });
    }
  }

  W.rngState = rng.state();
  return W;
}
