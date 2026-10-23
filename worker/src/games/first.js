// Which came first? 5 pairs a day (inventions, films, songs, history…): tap the one that
// happened first. The same pairs for both of us; they stay hidden until you tap Start (the
// Worker notes when). More right answers wins, and with the same number right, the faster
// one wins. Both years show once you've played.
import { GameError, AUTHORS, parseAuthor, parseDay, award, markActive, other, dayNumber, seededShuffle } from "./common.js";

const KEY = "games:first";
const MAX_DAYS = 400;
const PER_DAY = 5;
const HISTORY_DAYS = 7;
const MAX_MS = 5 * 60 * 1000;
// The two things of a pair are at least this many years apart.
const MIN_GAP = 2;

// The lucide icon shown with each kind of event.
export const KINDS = {
  tech: "smartphone",
  web: "globe",
  games: "gamepad-2",
  toys: "puzzle",
  film: "clapperboard",
  tv: "tv",
  music: "music",
  history: "landmark",
  science: "flask-conical",
  space: "rocket",
  sport: "trophy",
  food: "utensils",
  brand: "shopping-bag",
  travel: "train-front",
  building: "building-2",
  books: "book-open",
  art: "palette",
  swiss: "mountain-snow"
};

// [what, year, kind]: only things whose year is certain (first release, opening, founding).
export const EVENTS = [
  ["The first iPhone", 2007, "tech"],
  ["The first iPad", 2010, "tech"],
  ["The first iPod", 2001, "tech"],
  ["The Apple Watch", 2015, "tech"],
  ["The first Macintosh", 1984, "tech"],
  ["Windows 95", 1995, "tech"],
  ["The first text message", 1992, "tech"],
  ["Microsoft is founded", 1975, "tech"],
  ["Apple is founded", 1976, "tech"],
  ["ChatGPT is released", 2022, "tech"],
  ["The Sony Walkman", 1979, "music"],
  ["The first CD goes on sale", 1982, "music"],
  ["Amazon is founded", 1994, "web"],
  ["eBay is founded", 1995, "web"],
  ["Google is founded", 1998, "web"],
  ["Wikipedia launches", 2001, "web"],
  ["Skype launches", 2003, "web"],
  ["Facebook launches", 2004, "web"],
  ["Gmail launches", 2004, "web"],
  ["YouTube launches", 2005, "web"],
  ["Twitter launches", 2006, "web"],
  ["Netflix starts streaming", 2007, "web"],
  ["Spotify launches", 2008, "web"],
  ["Airbnb is founded", 2008, "web"],
  ["WhatsApp launches", 2009, "web"],
  ["Uber is founded", 2009, "web"],
  ["Instagram launches", 2010, "web"],
  ["Snapchat launches", 2011, "web"],
  ["Tinder launches", 2012, "web"],
  ["The World Wide Web goes public", 1991, "web"],
  ["Pong", 1972, "games"],
  ["Pac-Man", 1980, "games"],
  ["Tetris", 1984, "games"],
  ["Super Mario Bros.", 1985, "games"],
  ["The Game Boy", 1989, "games"],
  ["The first PlayStation", 1994, "games"],
  ["Pokémon Red and Green", 1996, "games"],
  ["The Sims", 2000, "games"],
  ["The first Xbox", 2001, "games"],
  ["The Nintendo Wii", 2006, "games"],
  ["Angry Birds", 2009, "games"],
  ["Candy Crush Saga", 2012, "games"],
  ["Grand Theft Auto V", 2013, "games"],
  ["Pokémon Go", 2016, "games"],
  ["The Nintendo Switch", 2017, "games"],
  ["Fortnite", 2017, "games"],
  ["The PlayStation 5", 2020, "games"],
  ["Wordle", 2021, "games"],
  ["The teddy bear", 1902, "toys"],
  ["The LEGO company is founded", 1932, "toys"],
  ["Monopoly goes on sale", 1935, "toys"],
  ["Barbie", 1959, "toys"],
  ["The Rubik’s Cube", 1974, "toys"],
  ["The Tamagotchi", 1996, "toys"],
  ["Snow White (Disney)", 1937, "film"],
  ["The Wizard of Oz", 1939, "film"],
  ["Casablanca", 1942, "film"],
  ["Cinderella (Disney)", 1950, "film"],
  ["Breakfast at Tiffany’s", 1961, "film"],
  ["Dr. No, the first Bond film", 1962, "film"],
  ["The Sound of Music", 1965, "film"],
  ["The Jungle Book (Disney)", 1967, "film"],
  ["The Godfather", 1972, "film"],
  ["Jaws", 1975, "film"],
  ["Star Wars", 1977, "film"],
  ["Grease", 1978, "film"],
  ["E.T.", 1982, "film"],
  ["Back to the Future", 1985, "film"],
  ["Top Gun", 1986, "film"],
  ["Dirty Dancing", 1987, "film"],
  ["The Little Mermaid (Disney)", 1989, "film"],
  ["Pretty Woman", 1990, "film"],
  ["Home Alone", 1990, "film"],
  ["Beauty and the Beast (Disney)", 1991, "film"],
  ["Aladdin (Disney)", 1992, "film"],
  ["Jurassic Park", 1993, "film"],
  ["The Lion King (Disney)", 1994, "film"],
  ["Forrest Gump", 1994, "film"],
  ["Toy Story", 1995, "film"],
  ["Titanic (the film)", 1997, "film"],
  ["The Matrix", 1999, "film"],
  ["Notting Hill", 1999, "film"],
  ["Gladiator", 2000, "film"],
  ["Shrek", 2001, "film"],
  ["Finding Nemo", 2003, "film"],
  ["Love Actually", 2003, "film"],
  ["The first Pirates of the Caribbean", 2003, "film"],
  ["Mean Girls", 2004, "film"],
  ["The Notebook", 2004, "film"],
  ["Casino Royale (Daniel Craig)", 2006, "film"],
  ["Cars (Pixar)", 2006, "film"],
  ["Ratatouille", 2007, "film"],
  ["Mamma Mia! (the film)", 2008, "film"],
  ["Iron Man", 2008, "film"],
  ["Up (Pixar)", 2009, "film"],
  ["Avatar", 2009, "film"],
  ["Inception", 2010, "film"],
  ["The Avengers", 2012, "film"],
  ["Frozen", 2013, "film"],
  ["Inside Out", 2015, "film"],
  ["La La Land", 2016, "film"],
  ["Moana", 2016, "film"],
  ["Coco", 2017, "film"],
  ["Black Panther", 2018, "film"],
  ["Avengers: Endgame", 2019, "film"],
  ["Encanto", 2021, "film"],
  ["Oppenheimer", 2023, "film"],
  ["Sesame Street", 1969, "tv"],
  ["MTV goes on air", 1981, "tv"],
  ["The Simpsons", 1989, "tv"],
  ["Friends", 1994, "tv"],
  ["Teletubbies", 1997, "tv"],
  ["Sex and the City", 1998, "tv"],
  ["Who Wants to Be a Millionaire?", 1998, "tv"],
  ["SpongeBob SquarePants", 1999, "tv"],
  ["Gilmore Girls", 2000, "tv"],
  ["Peppa Pig", 2004, "tv"],
  ["Grey’s Anatomy", 2005, "tv"],
  ["The Office (US)", 2005, "tv"],
  ["How I Met Your Mother", 2005, "tv"],
  ["The Big Bang Theory", 2007, "tv"],
  ["Breaking Bad", 2008, "tv"],
  ["Modern Family", 2009, "tv"],
  ["Game of Thrones", 2011, "tv"],
  ["House of Cards", 2013, "tv"],
  ["Stranger Things", 2016, "tv"],
  ["The Crown", 2016, "tv"],
  ["Bridgerton", 2020, "tv"],
  ["Squid Game", 2021, "tv"],
  ["Wednesday (the series)", 2022, "tv"],
  ["The Beatles’ first single", 1962, "music"],
  ["The first Montreux Jazz Festival", 1967, "music"],
  ["Woodstock", 1969, "music"],
  ["ABBA win Eurovision", 1974, "music"],
  ["Bohemian Rhapsody", 1975, "music"],
  ["Michael Jackson’s Thriller", 1982, "music"],
  ["Madonna’s Like a Virgin", 1984, "music"],
  ["Live Aid", 1985, "music"],
  ["Céline Dion wins Eurovision for Switzerland", 1988, "music"],
  ["Smells Like Teen Spirit", 1991, "music"],
  ["Wonderwall", 1995, "music"],
  ["Wannabe by the Spice Girls", 1996, "music"],
  ["…Baby One More Time", 1998, "music"],
  ["Napster", 1999, "music"],
  ["The iTunes Store opens", 2003, "music"],
  ["Crazy in Love", 2003, "music"],
  ["Lordi win Eurovision", 2006, "music"],
  ["Poker Face", 2008, "music"],
  ["Rolling in the Deep", 2010, "music"],
  ["Gangnam Style", 2012, "music"],
  ["Taylor Swift’s 1989", 2014, "music"],
  ["Shape of You", 2017, "music"],
  ["Despacito", 2017, "music"],
  ["Bad Guy by Billie Eilish", 2019, "music"],
  ["Måneskin win Eurovision", 2021, "music"],
  ["Nemo wins Eurovision for Switzerland", 2024, "music"],
  ["Magna Carta", 1215, "history"],
  ["The Swiss Confederation is founded", 1291, "swiss"],
  ["Columbus reaches America", 1492, "history"],
  ["Luther’s 95 theses", 1517, "history"],
  ["The Mayflower lands in America", 1620, "history"],
  ["American independence", 1776, "history"],
  ["The French Revolution begins", 1789, "history"],
  ["Napoleon becomes emperor", 1804, "history"],
  ["The Battle of Waterloo", 1815, "history"],
  ["Switzerland becomes a federal state", 1848, "swiss"],
  ["Abraham Lincoln becomes president", 1861, "history"],
  ["The Red Cross is founded in Geneva", 1863, "swiss"],
  ["The Titanic sinks", 1912, "history"],
  ["World War I begins", 1914, "history"],
  ["Tutankhamun’s tomb is found", 1922, "history"],
  ["World War II ends", 1945, "history"],
  ["India’s independence", 1947, "history"],
  ["Queen Elizabeth II is crowned", 1953, "history"],
  ["The “I Have a Dream” speech", 1963, "history"],
  ["Swiss women get the vote", 1971, "swiss"],
  ["Charles and Diana marry", 1981, "history"],
  ["Chernobyl", 1986, "history"],
  ["The Berlin Wall falls", 1989, "history"],
  ["Nelson Mandela is freed", 1990, "history"],
  ["Euro coins and notes arrive", 2002, "history"],
  ["Switzerland joins the UN", 2002, "swiss"],
  ["Barack Obama becomes president", 2009, "history"],
  ["William and Kate marry", 2011, "history"],
  ["Harry and Meghan marry", 2018, "history"],
  ["The UK leaves the EU", 2020, "history"],
  ["Mont Blanc is first climbed", 1786, "history"],
  ["The Matterhorn is first climbed", 1865, "swiss"],
  ["The Eiger north face is first climbed", 1938, "swiss"],
  ["Mount Everest is first climbed", 1953, "history"],
  ["Newton’s Principia", 1687, "science"],
  ["The first vaccine (smallpox)", 1796, "science"],
  ["Darwin’s On the Origin of Species", 1859, "science"],
  ["The periodic table", 1869, "science"],
  ["The telephone", 1876, "science"],
  ["Edison’s light bulb", 1879, "science"],
  ["X-rays are discovered", 1895, "science"],
  ["The first powered flight", 1903, "science"],
  ["Einstein’s E = mc²", 1905, "science"],
  ["Penicillin is discovered", 1928, "science"],
  ["DNA’s double helix", 1953, "science"],
  ["The first heart transplant", 1967, "science"],
  ["The first test-tube baby", 1978, "science"],
  ["Dolly the cloned sheep", 1996, "science"],
  ["The Higgs boson is found", 2012, "science"],
  ["The first photo of a black hole", 2019, "science"],
  ["Sputnik", 1957, "space"],
  ["The first human in space", 1961, "space"],
  ["The first woman in space", 1963, "space"],
  ["Apollo 8 flies around the Moon", 1968, "space"],
  ["The first Moon landing", 1969, "space"],
  ["Voyager 1 launches", 1977, "space"],
  ["The first Space Shuttle flight", 1981, "space"],
  ["The Hubble telescope launches", 1990, "space"],
  ["The first part of the ISS", 1998, "space"],
  ["Pluto stops being a planet", 2006, "space"],
  ["Curiosity lands on Mars", 2012, "space"],
  ["The James Webb telescope launches", 2021, "space"],
  ["The first Wimbledon", 1877, "sport"],
  ["The first modern Olympics", 1896, "sport"],
  ["The first Tour de France", 1903, "sport"],
  ["St. Moritz’s first Winter Olympics", 1928, "sport"],
  ["The first football World Cup", 1930, "sport"],
  ["The first Super Bowl", 1967, "sport"],
  ["France wins its first World Cup", 1998, "sport"],
  ["Federer’s first Wimbledon title", 2003, "sport"],
  ["Alinghi wins the America’s Cup", 2003, "swiss"],
  ["Italy wins the World Cup in Germany", 2006, "sport"],
  ["Michael Phelps wins 8 golds", 2008, "sport"],
  ["Euro 2008 in Switzerland and Austria", 2008, "sport"],
  ["Usain Bolt runs 9.58", 2009, "sport"],
  ["Spain wins the World Cup", 2010, "sport"],
  ["Germany wins the World Cup in Brazil", 2014, "sport"],
  ["Argentina wins the World Cup with Messi", 2022, "sport"],
  ["Coca-Cola", 1886, "food"],
  ["Pepsi", 1893, "food"],
  ["Fanta", 1940, "food"],
  ["Rivella", 1952, "swiss"],
  ["Red Bull", 1987, "food"],
  ["Nutella", 1964, "food"],
  ["Toblerone", 1908, "swiss"],
  ["Milk chocolate (Daniel Peter)", 1875, "swiss"],
  ["Ovomaltine", 1904, "swiss"],
  ["Haribo is founded", 1920, "food"],
  ["Sliced bread", 1928, "food"],
  ["Instant noodles", 1958, "food"],
  ["The first Starbucks", 1971, "food"],
  ["Ben & Jerry’s", 1978, "food"],
  ["The first Michelin Guide", 1900, "food"],
  ["Post-it notes", 1980, "brand"],
  ["Levi’s blue jeans", 1873, "brand"],
  ["Nestlé is founded", 1866, "swiss"],
  ["The Swiss Army knife", 1891, "swiss"],
  ["Rolex is founded", 1905, "brand"],
  ["Chanel is founded", 1910, "brand"],
  ["Gucci is founded", 1921, "brand"],
  ["Disney is founded", 1923, "brand"],
  ["IKEA is founded", 1943, "brand"],
  ["Adidas is founded", 1949, "brand"],
  ["The Nike name", 1971, "brand"],
  ["The first Zara shop", 1975, "brand"],
  ["The first Swatch", 1983, "swiss"],
  ["Louis Vuitton is founded", 1854, "brand"],
  ["The first Swiss railway", 1847, "travel"],
  ["The London Underground", 1863, "travel"],
  ["The Gotthard rail tunnel", 1882, "swiss"],
  ["The first car (Benz)", 1886, "travel"],
  ["The Ford Model T", 1908, "travel"],
  ["The Jungfrau Railway reaches the top", 1912, "swiss"],
  ["The Glacier Express", 1930, "swiss"],
  ["The VW Beetle", 1938, "travel"],
  ["The Mini", 1959, "travel"],
  ["The Boeing 747’s first flight", 1969, "travel"],
  ["Concorde’s first passenger flight", 1976, "travel"],
  ["The Channel Tunnel opens", 1994, "travel"],
  ["The Airbus A380 starts flying", 2007, "travel"],
  ["The Tesla Model S", 2012, "travel"],
  ["The Gotthard Base Tunnel opens", 2016, "swiss"],
  ["Big Ben’s tower", 1859, "building"],
  ["Work starts on the Sagrada Família", 1882, "building"],
  ["The Statue of Liberty", 1886, "building"],
  ["The Eiffel Tower", 1889, "building"],
  ["Tower Bridge", 1894, "building"],
  ["The Empire State Building", 1931, "building"],
  ["The Golden Gate Bridge", 1937, "building"],
  ["CERN is founded", 1954, "swiss"],
  ["Disneyland opens", 1955, "building"],
  ["Walt Disney World opens", 1971, "building"],
  ["The Sydney Opera House", 1973, "building"],
  ["Europa-Park opens", 1975, "building"],
  ["Tokyo Disneyland opens", 1983, "building"],
  ["Disneyland Paris opens", 1992, "building"],
  ["The Guggenheim Bilbao", 1997, "building"],
  ["Burj Khalifa", 2010, "building"],
  ["The Shard in London", 2012, "building"],
  ["The Elbphilharmonie", 2017, "building"],
  ["Pride and Prejudice", 1813, "books"],
  ["Frankenstein", 1818, "books"],
  ["Alice in Wonderland", 1865, "books"],
  ["Heidi", 1880, "swiss"],
  ["The first Sherlock Holmes story", 1887, "books"],
  ["The Great Gatsby", 1925, "books"],
  ["The Hobbit", 1937, "books"],
  ["The Little Prince", 1943, "books"],
  ["Anne Frank’s diary is published", 1947, "books"],
  ["Orwell’s 1984", 1949, "books"],
  ["The first Lord of the Rings book", 1954, "books"],
  ["Charlie and the Chocolate Factory", 1964, "books"],
  ["The Very Hungry Caterpillar", 1969, "books"],
  ["The first Harry Potter book", 1997, "books"],
  ["The Da Vinci Code", 2003, "books"],
  ["Twilight", 2005, "books"],
  ["The Hunger Games", 2008, "books"],
  ["Michelangelo’s David", 1504, "art"],
  ["The Sistine Chapel ceiling", 1512, "art"],
  ["Van Gogh’s The Starry Night", 1889, "art"],
  ["Munch’s The Scream", 1893, "art"],
  ["Picasso’s Guernica", 1937, "art"],
  ["Warhol’s Campbell’s Soup Cans", 1962, "art"],
  ["Banksy’s shredded painting", 2018, "art"]
];

// A round of pairs: every event once, each paired with one of a near year where possible
// (close calls are more fun), never with one less than MIN_GAP years apart, and not
// with the same partner as in the round before.
const pairKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);

function pairsFor(round, before = []) {
  const order = seededShuffle(EVENTS.map((_, index) => index), `first:${round}`);
  const old = new Set(before.map(([a, b]) => pairKey(a, b)));
  const used = new Uint8Array(EVENTS.length);
  const pairs = [];
  for (let at = 0; at < order.length; at += 1) {
    const a = order[at];
    if (used[a]) continue;
    // The first free partner within 25 years; else within 80; else any (a repeat only if nothing else is left).
    let near;
    let far;
    let any;
    let repeat;
    for (let next = at + 1; next < order.length && near === undefined; next += 1) {
      const b = order[next];
      const gap = Math.abs(EVENTS[a][1] - EVENTS[b][1]);
      if (used[b] || gap < MIN_GAP) continue;
      if (old.has(pairKey(a, b))) repeat ??= b;
      else if (gap <= 25) near = b;
      else if (gap <= 80) far ??= b;
      else any ??= b;
    }
    const b = near ?? far ?? any ?? repeat;
    if (b === undefined) continue;
    used[a] = 1;
    used[b] = 1;
    pairs.push([a, b]);
  }
  return pairs;
}

// Days per round: a round's pairs are used 5 a day, then a new round re-pairs everything.
export const DAYS_PER_ROUND = Math.floor((Math.floor(EVENTS.length / 2) - 8) / PER_DAY);
const rounds = [];

function roundPairs(round) {
  while (rounds.length <= round) rounds.push(pairsFor(rounds.length, rounds[rounds.length - 1]));
  return rounds[round];
}

export function pairsForDay(day) {
  const number = Math.max(0, dayNumber(day));
  const round = Math.floor(number / DAYS_PER_ROUND);
  const start = (number % DAYS_PER_ROUND) * PER_DAY;
  return roundPairs(round).slice(start, start + PER_DAY).map((pair, index) => {
    // Which side shows on the left is mixed per day too.
    const [left, right] = seededShuffle(pair, `${day}:${index}`).map((at) => {
      const [label, year, kind] = EVENTS[at];
      return { label, year, icon: KINDS[kind] || "history" };
    });
    return { options: [left, right], first: left.year < right.year ? 0 : 1 };
  });
}

function normalize(value) {
  return { days: { ...(value?.days || {}) } };
}

function assignDay(doc, day, now) {
  if (doc.days[day]) return false;
  doc.days[day] = { pairs: pairsForDay(day), players: {}, at: now };
  const others = Object.keys(doc.days).filter((key) => key !== day).sort();
  for (const old of others.slice(0, Math.max(0, others.length + 1 - MAX_DAYS))) delete doc.days[old];
  return true;
}

const playerOf = (entry, author) => entry?.players?.[author] || null;
const doneOf = (entry, author) => Boolean(playerOf(entry, author)?.doneAt);
const rightOf = (entry, picks) => entry.pairs.reduce((count, pair, index) => count + (picks[index] === pair.first ? 1 : 0), 0);

export function firstResult(entry) {
  const her = playerOf(entry, "her");
  const sender = playerOf(entry, "sender");
  if (!her?.doneAt || !sender?.doneAt) return null;
  const right = { her: rightOf(entry, her.picks), sender: rightOf(entry, sender.picks) };
  let winner = "tie";
  if (right.her !== right.sender) winner = right.her > right.sender ? "her" : "sender";
  else if (Math.abs(her.ms - sender.ms) >= 50) winner = her.ms < sender.ms ? "her" : "sender";
  return { right, ms: { her: her.ms, sender: sender.ms }, winner };
}

function dayView(entry, day, author, now) {
  const mine = playerOf(entry, author);
  const theirs = playerOf(entry, other(author));
  const started = Boolean(mine?.startedAt);
  const done = Boolean(mine?.doneAt);
  return {
    day,
    started,
    done,
    // Time already used in a round that's still going (a reload carries on from here).
    elapsedMs: started && !done && now ? Math.max(0, Date.parse(now) - Date.parse(mine.startedAt)) : null,
    // The pairs only once I started; the years and answers only once I'm done.
    pairs: started
      ? entry.pairs.map((pair) => (done ? pair : { options: pair.options.map(({ label, icon }) => ({ label, icon })) }))
      : null,
    mine: done ? { picks: mine.picks, ms: mine.ms, right: rightOf(entry, mine.picks) } : null,
    theirs: done && theirs?.doneAt ? { picks: theirs.picks, ms: theirs.ms, right: rightOf(entry, theirs.picks) } : null,
    theirsDone: Boolean(theirs?.doneAt),
    result: done ? firstResult(entry) : null
  };
}

export function firstStats(doc, today) {
  const days = Object.keys(doc.days).filter((day) => day <= today).sort();
  const wins = { her: 0, sender: 0 };
  const perfect = { her: 0, sender: 0 };
  const right = { her: 0, sender: 0 };
  let daysPlayed = 0;
  for (const day of days) {
    const entry = doc.days[day];
    for (const author of AUTHORS) {
      const player = playerOf(entry, author);
      if (!player?.doneAt) continue;
      const count = rightOf(entry, player.picks);
      right[author] += count;
      if (count === PER_DAY) perfect[author] += 1;
    }
    const result = firstResult(entry);
    if (!result) continue;
    daysPlayed += 1;
    if (result.winner !== "tie") wins[result.winner] += 1;
  }
  return { daysPlayed, wins, perfect, right };
}

function view(doc, day, author, today, now) {
  const history = Object.keys(doc.days)
    .filter((key) => key < day && doneOf(doc.days[key], author))
    .sort()
    .reverse()
    .slice(0, HISTORY_DAYS)
    .map((key) => ({ day: key, result: firstResult(doc.days[key]) }));
  return { ...dayView(doc.days[day], day, author, now), count: PER_DAY, stats: firstStats(doc, today), history };
}

function parsePicks(value) {
  if (!Array.isArray(value) || value.length !== PER_DAY || !value.every((pick) => pick === null || pick === 0 || pick === 1)) {
    throw new GameError(400, "Pick one in each pair.");
  }
  return [...value];
}

async function read(ctx) {
  const author = parseAuthor(ctx.query("author"));
  const day = parseDay(ctx.query("day"), ctx.today);
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    if (day === ctx.today) {
      if (assignDay(doc, day, ctx.now)) await txn.put(KEY, doc);
    } else if (!doc.days[day]) {
      throw new GameError(404, "There was no which came first that day.");
    }
    return view(doc, day, author, ctx.today, ctx.now);
  });
}

async function act(ctx) {
  const author = parseAuthor(ctx.body.author);
  const day = parseDay(ctx.body.day, ctx.today);
  if (day !== ctx.today) throw new GameError(409, "A new day started. Here are today’s pairs.");
  const action = ctx.body.action;
  if (!["start", "submit"].includes(action)) throw new GameError(400, "Unknown action.");
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    assignDay(doc, day, ctx.now);
    const entry = doc.days[day];
    const player = { ...(playerOf(entry, author) || {}) };
    if (player.doneAt) throw new GameError(409, "You already played today’s which came first.");
    if (action === "start") {
      if (!player.startedAt) player.startedAt = ctx.now;
    } else {
      if (!player.startedAt) throw new GameError(409, "Tap Start first.");
      const picks = parsePicks(ctx.body.picks);
      const seen = Date.parse(ctx.now) - Date.parse(player.startedAt);
      const told = Number(ctx.body.ms);
      const ms = Math.round(Math.max(0, Math.min(MAX_MS, Number.isFinite(told) && told > 0 ? Math.min(told, seen) : seen)));
      Object.assign(player, { picks, ms, doneAt: ctx.now });
    }
    entry.players = { ...(entry.players || {}), [author]: player };
    await txn.put(KEY, doc);
    let awarded = 0;
    if (action === "submit") {
      awarded += await award(txn, `first:${day}:play:${author}`, author, 1);
      const result = firstResult(entry);
      if (result) {
        for (const person of AUTHORS) {
          let hearts = result.winner === person ? 2 : result.winner === "tie" ? 1 : 0;
          if (result.right[person] === PER_DAY) hearts += 1;
          const delta = await award(txn, `first:${day}:score:${person}`, person, hearts);
          if (person === author) awarded += delta;
        }
      }
      awarded += await markActive(txn, author, ctx.today);
    }
    return { ...view(doc, day, author, ctx.today, ctx.now), awarded };
  });
}

export const routes = {
  "/games/first": async (ctx) => {
    if (ctx.method === "GET") return read(ctx);
    if (ctx.method === "POST") return act(ctx);
    throw new GameError(405, "Method not allowed.");
  }
};

export async function summary(ctx) {
  const doc = normalize(await ctx.storage.get(KEY));
  const entry = doc.days[ctx.today];
  const mine = doneOf(entry, ctx.author);
  const theirs = doneOf(entry, other(ctx.author));
  let status = "todo";
  let line = theirs ? "{them} played. Your turn" : "5 pairs: which came first?";
  if (mine && theirs) {
    const result = firstResult(entry);
    status = "done";
    line = result.winner === "tie" ? "A tie today" : `${result.winner === ctx.author ? "{me}" : "{them}"} won today`;
  } else if (mine) {
    status = "waiting";
    line = "Waiting for {them}";
  }
  const stats = firstStats(doc, ctx.today);
  return {
    id: "first",
    title: "Which came first?",
    icon: "history",
    step: "first",
    status,
    line,
    board: [
      { label: "Which came first wins", her: stats.wins.her, sender: stats.wins.sender },
      { label: "Perfect days", her: stats.perfect.her, sender: stats.perfect.sender }
    ]
  };
}
