// Price is right: 3 things a day (a croissant in Paris, a flight to Tokyo…). We both guess
// what each costs in Swiss francs; the closer guess wins the item, and whoever wins more
// items wins the day. Prices are rough real-world prices ("about"), and they only show,
// along with the other one's guesses, once you've sent yours.
import { GameError, AUTHORS, parseAuthor, parseDay, award, markActive, other, dayNumber, seededShuffle } from "./common.js";

const KEY = "games:price";
const MAX_DAYS = 400;
const PER_DAY = 3;
const HISTORY_DAYS = 7;
const MAX_GUESS = 10_000_000;
// Within this share of the real price counts as "spot on" (a bonus heart).
const SPOT_ON = 0.1;

// [what, price in CHF (about), lucide icon]
export const ITEMS = [
  ["A croissant in a Paris bakery", 1.4, "croissant"],
  ["A Big Mac in Switzerland (just the burger)", 7.1, "hamburger"],
  ["A cappuccino in a Zurich café", 5.5, "coffee"],
  ["A scoop of gelato in Rome", 3, "ice-cream-cone"],
  ["A pizza Margherita in Naples", 6, "pizza"],
  ["A 100 g Toblerone at Coop", 3, "candy"],
  ["1 kg of bananas at Migros", 2.3, "banana"],
  ["A bubble tea in Zurich", 8, "cup-soda"],
  ["A döner kebab in Berlin", 7, "sandwich"],
  ["A kebab in Bern", 12, "sandwich"],
  ["A coffee from a Tokyo vending machine", 1, "coffee"],
  ["A bottle of Moët champagne", 50, "wine"],
  ["Cheese fondue for two in a Swiss restaurant", 60, "utensils"],
  ["A whole raclette cheese wheel (5 kg)", 120, "circle"],
  ["A large popcorn at a Swiss cinema", 9.5, "popcorn"],
  ["A 200 g bag of Lindor balls", 9, "candy"],
  ["12 free-range eggs in Switzerland", 8, "egg"],
  ["A Happy Meal in Switzerland", 7.5, "hamburger"],
  ["A 1.5 l Coca-Cola at Coop", 2.6, "cup-soda"],
  ["One avocado in a Swiss supermarket", 1.9, "apple"],
  ["A whole watermelon in Switzerland", 8, "cherry"],
  ["A Kinder Surprise egg", 1.7, "egg"],
  ["A box of 24 Ferrero Rocher", 13, "gift"],
  ["A Starbucks Frappuccino (grande) in Switzerland", 7.9, "cup-soda"],
  ["A slice of cake in a Bern café", 6.5, "cake-slice"],
  ["A cinema ticket in Bern", 19, "ticket"],
  ["A flight Zurich–Paris, one way, booked early", 80, "plane"],
  ["A return flight Zurich–Tokyo, economy", 1100, "plane"],
  ["A train ticket Bern–Zurich, 2nd class, full price, one way", 51, "train-front"],
  ["A night in a 3-star hotel in Paris", 180, "hotel"],
  ["A return train ticket to the Jungfraujoch from Interlaken", 240, "mountain-snow"],
  ["A 30-minute gondola ride in Venice", 90, "sailboat"],
  ["A one-day ticket to Disneyland Paris", 105, "castle"],
  ["A ticket to the top of the Eiffel Tower (by lift)", 34, "landmark"],
  ["A taxi from JFK airport to Manhattan", 85, "car-taxi-front"],
  ["A 10 km taxi ride in Zurich", 45, "car-taxi-front"],
  ["A one-day ticket to Tokyo Disneyland", 60, "castle"],
  ["A ticket to the Louvre", 21, "landmark"],
  ["A one-day ticket to Europa-Park", 68, "ferris-wheel"],
  ["A day ski pass in Zermatt", 92, "snowflake"],
  ["A tandem paragliding flight in Interlaken", 180, "wind"],
  ["A tandem skydive in Interlaken", 460, "plane"],
  ["A bungee jump at the Verzasca dam", 255, "mountain-snow"],
  ["A hot-air balloon ride over Switzerland (per person)", 390, "wind"],
  ["An escape room for two in Bern", 90, "key"],
  ["One game of bowling in Bern (per person)", 10, "trophy"],
  ["A round of mini golf in Switzerland", 9, "flag"],
  ["The newest iPhone Pro (256 GB) in Switzerland", 1200, "smartphone"],
  ["AirPods Pro", 249, "headphones"],
  ["A PlayStation 5", 499, "gamepad-2"],
  ["A Nintendo Switch 2", 470, "gamepad-2"],
  ["A dozen red roses at a florist", 60, "flower"],
  ["A classic small Swiss Army knife", 19, "scissors"],
  ["An IKEA Billy bookcase", 59, "library"],
  ["The big LEGO Millennium Falcon", 849, "rocket"],
  ["A month of Netflix Standard in Switzerland", 18.9, "tv"],
  ["A month of Spotify Premium in Switzerland", 14, "music"],
  ["A pair of white Nike Air Force 1", 130, "footprints"],
  ["A new Rolex Submariner", 10600, "watch"],
  ["A Swatch watch", 95, "watch"],
  ["A new Tesla Model 3 in Switzerland", 40000, "car"],
  ["A Dyson Supersonic hair dryer", 449, "wind"],
  ["A Labubu blind box", 30, "gift"],
  ["A 40 oz Stanley cup", 50, "cup-soda"],
  ["Chanel No. 5, 50 ml", 150, "sparkles"],
  ["A women's haircut with blow-dry in Bern", 95, "scissors"],
  ["A men's haircut in Bern", 45, "scissors"],
  ["A goldfish at a pet shop", 4, "fish"],
  ["A 2 m real Christmas tree in Switzerland", 70, "tree-pine"],
  ["An hour of parking in central Zurich", 4.5, "parking-meter"],
  ["An A-Post stamp for a letter in Switzerland", 1.2, "stamp"],
  ["The Swiss motorway vignette for a year", 40, "car"],
  ["A litre of petrol in Switzerland", 1.85, "fuel"],
  ["A Swiss half-fare travelcard for a year", 190, "train-front"],
  ["Monthly rent for a 3.5-room flat in Bern", 1900, "house"],
  ["A one-year Disney+ subscription in Switzerland", 120, "tv"],
  ["A tent for two at a sports shop", 150, "tent"],
  ["A hardcover bestseller novel in a Swiss bookshop", 33, "book-open"],
  ["A big IKEA sofa (3 seats, a popular model)", 600, "sofa"],
  ["A Polaroid instant camera", 120, "camera"],
  ["A pack of instant film for 8 Polaroid photos", 22, "camera"]
];

const ORDER = seededShuffle(ITEMS.map((_, index) => index), "price-is-right");

function normalize(value) {
  return { days: { ...(value?.days || {}) } };
}

function assignDay(doc, day, now) {
  if (doc.days[day]) return false;
  const start = (dayNumber(day) * PER_DAY) % ORDER.length;
  const items = Array.from({ length: PER_DAY }, (_, index) => ITEMS[ORDER[(start + index) % ORDER.length]])
    .map(([name, price, icon]) => ({ name, price, icon }));
  doc.days[day] = { items, guesses: {}, at: now };
  const others = Object.keys(doc.days).filter((key) => key !== day).sort();
  for (const old of others.slice(0, Math.max(0, others.length + 1 - MAX_DAYS))) delete doc.days[old];
  return true;
}

const guessesOf = (entry, author) => (Array.isArray(entry?.guesses?.[author]) ? entry.guesses[author] : null);
const spotOn = (guess, price) => (price === 0 ? guess === 0 : Math.abs(guess - price) <= price * SPOT_ON);

export function priceResult(entry) {
  const her = guessesOf(entry, "her");
  const sender = guessesOf(entry, "sender");
  if (!her || !sender) return null;
  const items = entry.items.map((item, index) => {
    const off = { her: Math.abs(her[index] - item.price), sender: Math.abs(sender[index] - item.price) };
    const winner = Math.abs(off.her - off.sender) < 1e-9 ? "tie" : off.her < off.sender ? "her" : "sender";
    return { winner, spotOn: { her: spotOn(her[index], item.price), sender: spotOn(sender[index], item.price) } };
  });
  const points = { her: 0, sender: 0 };
  for (const item of items) {
    if (item.winner === "tie") { points.her += 0.5; points.sender += 0.5; } else points[item.winner] += 1;
  }
  const winner = points.her === points.sender ? "tie" : points.her > points.sender ? "her" : "sender";
  return { items, points, winner };
}

function dayView(entry, day, author) {
  const mine = guessesOf(entry, author);
  const theirs = guessesOf(entry, other(author));
  return {
    day,
    // The real prices only once I guessed.
    items: (entry?.items || []).map((item) => ({ name: item.name, icon: item.icon, price: mine ? item.price : null })),
    mine,
    theirs: mine ? theirs : null,
    theirsDone: Boolean(theirs),
    result: mine && theirs ? priceResult(entry) : null
  };
}

export function priceStats(doc, today) {
  const played = Object.keys(doc.days).filter((day) => day <= today && priceResult(doc.days[day])).sort();
  const wins = { her: 0, sender: 0 };
  const spot = { her: 0, sender: 0 };
  for (const day of played) {
    const result = priceResult(doc.days[day]);
    if (result.winner !== "tie") wins[result.winner] += 1;
    for (const item of result.items) for (const author of AUTHORS) if (item.spotOn[author]) spot[author] += 1;
  }
  return { daysPlayed: played.length, wins, spotOn: spot };
}

function view(doc, day, author, today) {
  const history = Object.keys(doc.days)
    .filter((key) => key < day && guessesOf(doc.days[key], author))
    .sort()
    .reverse()
    .slice(0, HISTORY_DAYS)
    .map((key) => dayView(doc.days[key], key, author));
  return { ...dayView(doc.days[day], day, author), stats: priceStats(doc, today), history };
}

function parseGuesses(value) {
  if (!Array.isArray(value) || value.length !== PER_DAY) throw new GameError(400, "Guess all 3 prices.");
  return value.map((guess) => {
    const number = typeof guess === "string" ? Number(guess.replace(",", ".")) : guess;
    if (typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > MAX_GUESS) {
      throw new GameError(400, "Guess all 3 prices (in francs).");
    }
    return Math.round(number * 100) / 100;
  });
}

async function read(ctx) {
  const author = parseAuthor(ctx.query("author"));
  const day = parseDay(ctx.query("day"), ctx.today);
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    if (day === ctx.today) {
      if (assignDay(doc, day, ctx.now)) await txn.put(KEY, doc);
    } else if (!doc.days[day]) {
      throw new GameError(404, "There was no price game that day.");
    }
    return view(doc, day, author, ctx.today);
  });
}

async function play(ctx) {
  const author = parseAuthor(ctx.body.author);
  const day = parseDay(ctx.body.day, ctx.today);
  if (day !== ctx.today) throw new GameError(409, "A new day started. Here are today's prices to guess.");
  const guesses = parseGuesses(ctx.body.guesses);
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    assignDay(doc, day, ctx.now);
    const entry = doc.days[day];
    if (guessesOf(entry, author)) throw new GameError(409, "You already guessed today's prices.");
    entry.guesses = { ...(entry.guesses || {}), [author]: guesses };
    await txn.put(KEY, doc);
    let awarded = await award(txn, `price:${day}:play:${author}`, author, 1);
    const result = priceResult(entry);
    if (result) {
      for (const person of AUTHORS) {
        let hearts = result.winner === person ? 2 : result.winner === "tie" ? 1 : 0;
        hearts += result.items.filter((item) => item.spotOn[person]).length;
        const delta = await award(txn, `price:${day}:score:${person}`, person, hearts);
        if (person === author) awarded += delta;
      }
    }
    awarded += await markActive(txn, author, ctx.today);
    return { ...view(doc, day, author, ctx.today), awarded };
  });
}

export const routes = {
  "/games/price": async (ctx) => {
    if (ctx.method === "GET") return read(ctx);
    if (ctx.method === "POST") return play(ctx);
    throw new GameError(405, "Method not allowed.");
  }
};

export async function summary(ctx) {
  const doc = normalize(await ctx.storage.get(KEY));
  const entry = doc.days[ctx.today];
  const mine = guessesOf(entry, ctx.author);
  const theirs = guessesOf(entry, other(ctx.author));
  let status = "todo";
  let line = theirs ? "{them} guessed. Your turn" : "Guess 3 prices";
  if (mine && theirs) {
    const result = priceResult(entry);
    status = "done";
    line = result.winner === "tie" ? "A tie today" : `${result.winner === ctx.author ? "{me}" : "{them}"} won today`;
  } else if (mine) {
    status = "waiting";
    line = "Waiting for {them}";
  }
  const stats = priceStats(doc, ctx.today);
  return {
    id: "price",
    title: "Price is right",
    icon: "tag",
    step: "price",
    status,
    line,
    board: [
      { label: "Price is right wins", her: stats.wins.her, sender: stats.wins.sender },
      { label: "Spot-on guesses", her: stats.spotOn.her, sender: stats.spotOn.sender }
    ]
  };
}
