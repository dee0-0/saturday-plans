// Odd one out: 3 puzzles a day, 4 words each, one doesn't fit. The same puzzles for both
// of us; they stay hidden until you tap Start (the Worker notes when). More right answers
// wins, and with the same number right, the faster one wins. The answers and the reason
// show once you've played.
import { GameError, AUTHORS, parseAuthor, parseDay, award, markActive, other, dayNumber, seededShuffle } from "./common.js";

const KEY = "games:odd";
const MAX_DAYS = 400;
const PER_DAY = 3;
const HISTORY_DAYS = 7;
const MAX_MS = 5 * 60 * 1000;

// [four words, index of the odd one, why]
export const PUZZLES = [
  [["Apple", "Banana", "Carrot", "Mango"], 2, "A carrot is a vegetable, the rest are fruits."],
  [["Paris", "Rome", "Madrid", "Zurich"], 3, "Zurich isn't a capital city."],
  [["Dog", "Cat", "Eagle", "Rabbit"], 2, "An eagle is a bird, the rest are mammals."],
  [["Red", "Blue", "Yellow", "Square"], 3, "A square is a shape, the rest are colours."],
  [["Piano", "Guitar", "Violin", "Trumpet"], 3, "A trumpet is blown, the rest have strings."],
  [["Mercury", "Venus", "Moon", "Mars"], 2, "The Moon isn't a planet."],
  [["Shark", "Dolphin", "Whale", "Seal"], 0, "A shark is a fish, the rest are mammals."],
  [["Tea", "Coffee", "Milk", "Bread"], 3, "Bread isn't a drink."],
  [["Monday", "Friday", "June", "Sunday"], 2, "June is a month, the rest are days."],
  [["Rose", "Tulip", "Oak", "Daisy"], 2, "An oak is a tree, the rest are flowers."],
  [["Football", "Tennis", "Chess", "Basketball"], 2, "Chess is played without a ball."],
  [["Spoon", "Fork", "Knife", "Plate"], 3, "A plate isn't cutlery."],
  [["Snow", "Rain", "Hail", "Sun"], 3, "The sun doesn't fall from the sky."],
  [["Triangle", "Circle", "Cube", "Square"], 2, "A cube is 3D, the rest are flat shapes."],
  [["Penguin", "Ostrich", "Sparrow", "Emu"], 2, "A sparrow can fly, the others can't."],
  [["Spain", "Italy", "Brazil", "France"], 2, "Brazil isn't in Europe."],
  [["Lion", "Tiger", "Leopard", "Wolf"], 3, "A wolf isn't a big cat."],
  [["Hammer", "Saw", "Screwdriver", "Paintbrush"], 3, "A paintbrush isn't a building tool."],
  [["Gold", "Silver", "Bronze", "Diamond"], 3, "A diamond isn't a metal."],
  [["Bed", "Sofa", "Chair", "Fridge"], 3, "A fridge isn't for sitting or lying on."],
  [["Pizza", "Pasta", "Risotto", "Sushi"], 3, "Sushi isn't Italian."],
  [["Winter", "Summer", "Spring", "Morning"], 3, "Morning is a time of day, the rest are seasons."],
  [["Elbow", "Knee", "Ankle", "Nose"], 3, "A nose isn't a joint."],
  [["Bee", "Butterfly", "Spider", "Ant"], 2, "A spider has 8 legs, the rest are insects."],
  [["Gmail", "Instagram", "TikTok", "Snapchat"], 0, "Gmail is email, the rest are social apps."],
  [["Netflix", "Spotify", "Disney+", "Prime Video"], 1, "Spotify is for music, the rest are for films and series."],
  [["Euro", "Dollar", "Franc", "Gram"], 3, "A gram is a weight, the rest are money."],
  [["Kilometre", "Metre", "Litre", "Centimetre"], 2, "A litre measures volume, the rest length."],
  [["Salmon", "Tuna", "Trout", "Octopus"], 3, "An octopus isn't a fish."],
  [["Lemon", "Lime", "Orange", "Strawberry"], 3, "A strawberry isn't a citrus fruit."],
  [["Mozart", "Beethoven", "Picasso", "Bach"], 2, "Picasso was a painter, the rest were composers."],
  [["Van Gogh", "Monet", "Shakespeare", "Rembrandt"], 2, "Shakespeare wrote, the rest painted."],
  [["Everest", "Matterhorn", "Sahara", "Eiger"], 2, "The Sahara is a desert, the rest are mountains."],
  [["Nile", "Amazon", "Rhine", "Alps"], 3, "The Alps are mountains, the rest are rivers."],
  [["Jupiter", "Saturn", "Neptune", "Sirius"], 3, "Sirius is a star, the rest are planets."],
  [["Cow", "Sheep", "Goat", "Fox"], 3, "A fox isn't a farm animal."],
  [["Car", "Bus", "Train", "Bicycle"], 3, "A bicycle has no engine."],
  [["Boat", "Ship", "Submarine", "Helicopter"], 3, "A helicopter doesn't go on water."],
  [["Thumb", "Finger", "Toe", "Wrist"], 3, "A wrist isn't a digit."],
  [["Heart", "Lung", "Liver", "Bone"], 3, "A bone isn't an organ."],
  [["Happy", "Glad", "Joyful", "Angry"], 3, "Angry isn't a happy word."],
  [["Big", "Huge", "Tiny", "Giant"], 2, "Tiny means small, the rest mean big."],
  [["Fast", "Quick", "Rapid", "Slow"], 3, "Slow is the opposite."],
  [["Whisper", "Shout", "Yell", "Scream"], 0, "A whisper is quiet, the rest are loud."],
  [["Kiss", "Hug", "Cuddle", "Argue"], 3, "Arguing isn't affectionate."],
  [["Popcorn", "Nachos", "Chips", "Soup"], 3, "Soup isn't a movie snack."],
  [["Latte", "Espresso", "Cappuccino", "Lemonade"], 3, "Lemonade isn't a coffee."],
  [["Chocolate", "Candy", "Ice cream", "Broccoli"], 3, "Broccoli isn't a sweet."],
  [["Croissant", "Baguette", "Brioche", "Tortilla"], 3, "A tortilla isn't French."],
  [["Fondue", "Raclette", "Rösti", "Paella"], 3, "Paella isn't Swiss."],
  [["Bern", "Basel", "Geneva", "Munich"], 3, "Munich isn't in Switzerland."],
  [["Thun", "Interlaken", "Lucerne", "Milan"], 3, "Milan isn't in Switzerland."],
  [["Toblerone", "Lindt", "Cailler", "Nutella"], 3, "Nutella isn't Swiss."],
  [["Harry Potter", "Hermione", "Ron", "Frodo"], 3, "Frodo is from The Lord of the Rings."],
  [["Mickey", "Donald", "Goofy", "Shrek"], 3, "Shrek isn't a Disney character."],
  [["Elsa", "Anna", "Olaf", "Simba"], 3, "Simba isn't from Frozen."],
  [["Batman", "Superman", "Spider-Man", "Sherlock"], 3, "Sherlock isn't a superhero."],
  [["Titanic", "Avatar", "Inception", "Friends"], 3, "Friends is a series, the rest are films."],
  [["Pikachu", "Charmander", "Mario", "Bulbasaur"], 2, "Mario isn't a Pokémon."],
  [["Xbox", "PlayStation", "Switch", "iPad"], 3, "An iPad isn't a games console."],
  [["Apple", "Samsung", "Google", "Nike"], 3, "Nike doesn't make phones."],
  [["Adidas", "Nike", "Puma", "Rolex"], 3, "Rolex makes watches, not sportswear."],
  [["Gucci", "Prada", "Chanel", "IKEA"], 3, "IKEA isn't a fashion house."],
  [["Mars", "Snickers", "Twix", "Pringles"], 3, "Pringles aren't chocolate bars."],
  [["Ketchup", "Mustard", "Mayonnaise", "Jam"], 3, "Jam isn't a savoury sauce."],
  [["Salt", "Pepper", "Paprika", "Sugar"], 3, "Sugar is sweet, the rest are savoury spices."],
  [["Oven", "Microwave", "Toaster", "Freezer"], 3, "A freezer makes things cold."],
  [["Shirt", "Jeans", "Jacket", "Earring"], 3, "An earring is jewellery, not clothing."],
  [["Sneakers", "Boots", "Sandals", "Gloves"], 3, "You don't wear gloves on your feet."],
  [["Ring", "Necklace", "Bracelet", "Scarf"], 3, "A scarf isn't jewellery."],
  [["Lipstick", "Mascara", "Blush", "Shampoo"], 3, "Shampoo isn't make-up."],
  [["January", "March", "May", "Thursday"], 3, "Thursday is a day, the rest are months."],
  [["Christmas", "Easter", "Halloween", "Weekend"], 3, "A weekend isn't a holiday."],
  [["Cupid", "Rose", "Chocolate", "Pumpkin"], 3, "A pumpkin is Halloween, the rest are Valentine's."],
  [["Seven", "Eleven", "Thirteen", "Fifteen"], 3, "Fifteen isn't a prime number."],
  [["Two", "Four", "Six", "Nine"], 3, "Nine is odd, the rest are even."],
  [["Square", "Rectangle", "Rhombus", "Triangle"], 3, "A triangle has three sides, the rest four."],
  [["Hour", "Minute", "Second", "Mile"], 3, "A mile is a distance, the rest are time."],
  [["Hydrogen", "Oxygen", "Helium", "Water"], 3, "Water isn't an element."],
  [["Owl", "Bat", "Hedgehog", "Squirrel"], 3, "A squirrel is awake by day, the rest at night."],
  [["Frog", "Toad", "Salamander", "Lizard"], 3, "A lizard is a reptile, the rest are amphibians."],
  [["Crocodile", "Snake", "Turtle", "Frog"], 3, "A frog isn't a reptile."],
  [["Panda", "Koala", "Polar bear", "Grizzly"], 1, "A koala isn't a bear."],
  [["Mushroom", "Lettuce", "Spinach", "Cabbage"], 0, "A mushroom isn't a leafy vegetable (it's not even a plant)."],
  [["Tomato", "Cucumber", "Pepper", "Potato"], 3, "A potato grows underground."],
  [["Almond", "Walnut", "Cashew", "Raisin"], 3, "A raisin is a dried grape, not a nut."],
  [["Cheddar", "Gruyère", "Brie", "Tofu"], 3, "Tofu isn't cheese."],
  [["Beach", "Sand", "Waves", "Snowman"], 3, "A snowman isn't on a beach."],
  [["Ski", "Snowboard", "Sled", "Surfboard"], 3, "A surfboard is for water."],
  [["Tent", "Campfire", "Sleeping bag", "Elevator"], 3, "There's no elevator when camping."],
  [["Passport", "Suitcase", "Ticket", "Lawnmower"], 3, "You don't pack a lawnmower for a trip."],
  [["Doctor", "Nurse", "Surgeon", "Pilot"], 3, "A pilot doesn't work in a hospital."],
  [["Teacher", "Student", "Classroom", "Kitchen"], 3, "A kitchen isn't part of school."],
  [["Instagram", "Facebook", "WhatsApp", "Excel"], 3, "Excel isn't for chatting."],
  [["Selfie", "Filter", "Story", "Fax"], 3, "A fax isn't social media."],
  [["Laugh", "Giggle", "Chuckle", "Cry"], 3, "Crying isn't laughing."],
  [["Morning", "Noon", "Evening", "Tuesday"], 3, "Tuesday is a day, the rest are times of day."],
  [["Breakfast", "Lunch", "Dinner", "Dessert"], 3, "Dessert is part of a meal, not a meal."],
  [["Hug", "High five", "Handshake", "Wink"], 3, "A wink doesn't touch."],
  [["Moon", "Star", "Comet", "Cloud"], 3, "A cloud isn't in space."],
  [["Diamond", "Ruby", "Emerald", "Pearl"], 3, "A pearl isn't a stone (oysters make it)."],
  [["Harp", "Cello", "Flute", "Banjo"], 2, "A flute has no strings."],
  [["Ballet", "Salsa", "Tango", "Karate"], 3, "Karate isn't a dance."],
  [["Rome", "Venice", "Florence", "Lisbon"], 3, "Lisbon isn't in Italy."],
  [["Tokyo", "Kyoto", "Osaka", "Seoul"], 3, "Seoul isn't in Japan."],
  [["London", "Manchester", "Liverpool", "Dublin"], 3, "Dublin isn't in England."],
  [["Pancake", "Waffle", "Crêpe", "Pretzel"], 3, "A pretzel isn't made from batter."],
  [["Hamster", "Guinea pig", "Mouse", "Parrot"], 3, "A parrot isn't a rodent."],
  [["Ocean", "Sea", "Lake", "Desert"], 3, "A desert has no water."],
  [["Pen", "Pencil", "Marker", "Eraser"], 3, "An eraser doesn't write."],
  [["Book", "Magazine", "Newspaper", "Radio"], 3, "You don't read a radio."],
  [["Camera", "Phone", "Laptop", "Spoon"], 3, "A spoon isn't electronic."],
  [["Love", "Like", "Adore", "Ignore"], 3, "Ignore isn't affectionate."]
];

const ORDER = seededShuffle(PUZZLES.map((_, index) => index), "odd-one-out");

function normalize(value) {
  return { days: { ...(value?.days || {}) } };
}

function assignDay(doc, day, now) {
  if (doc.days[day]) return false;
  const start = (dayNumber(day) * PER_DAY) % ORDER.length;
  const puzzles = Array.from({ length: PER_DAY }, (_, index) => PUZZLES[ORDER[(start + index) % ORDER.length]])
    .map(([words, odd, why], index) => {
      // Mix the word order per day, so the odd one isn't always in the same place.
      const order = seededShuffle([0, 1, 2, 3], `${day}:${index}`);
      return { words: order.map((at) => words[at]), odd: order.indexOf(odd), why };
    });
  doc.days[day] = { puzzles, players: {}, at: now };
  const others = Object.keys(doc.days).filter((key) => key !== day).sort();
  for (const old of others.slice(0, Math.max(0, others.length + 1 - MAX_DAYS))) delete doc.days[old];
  return true;
}

const playerOf = (entry, author) => entry?.players?.[author] || null;
const doneOf = (entry, author) => Boolean(playerOf(entry, author)?.doneAt);
const rightOf = (entry, picks) => entry.puzzles.reduce((count, puzzle, index) => count + (picks[index] === puzzle.odd ? 1 : 0), 0);

export function oddResult(entry) {
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
    // The words only once I started; the answers only once I'm done.
    puzzles: started ? entry.puzzles.map((puzzle) => (done ? puzzle : { words: puzzle.words })) : null,
    mine: done ? { picks: mine.picks, ms: mine.ms, right: rightOf(entry, mine.picks) } : null,
    theirs: done && theirs?.doneAt ? { picks: theirs.picks, ms: theirs.ms, right: rightOf(entry, theirs.picks) } : null,
    theirsDone: Boolean(theirs?.doneAt),
    result: done ? oddResult(entry) : null
  };
}

export function oddStats(doc, today) {
  const played = Object.keys(doc.days).filter((day) => day <= today && oddResult(doc.days[day])).sort();
  const wins = { her: 0, sender: 0 };
  const right = { her: 0, sender: 0 };
  for (const day of played) {
    const result = oddResult(doc.days[day]);
    if (result.winner !== "tie") wins[result.winner] += 1;
    for (const author of AUTHORS) right[author] += result.right[author];
  }
  return { daysPlayed: played.length, wins, right };
}

function view(doc, day, author, today, now) {
  const history = Object.keys(doc.days)
    .filter((key) => key < day && doneOf(doc.days[key], author))
    .sort()
    .reverse()
    .slice(0, HISTORY_DAYS)
    .map((key) => ({ day: key, result: oddResult(doc.days[key]) }));
  return { ...dayView(doc.days[day], day, author, now), count: PER_DAY, stats: oddStats(doc, today), history };
}

function parsePicks(value) {
  if (!Array.isArray(value) || value.length !== PER_DAY || !value.every((pick) => pick === null || (Number.isInteger(pick) && pick >= 0 && pick < 4))) {
    throw new GameError(400, "Pick one word in each puzzle.");
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
      throw new GameError(404, "There was no odd one out that day.");
    }
    return view(doc, day, author, ctx.today, ctx.now);
  });
}

async function act(ctx) {
  const author = parseAuthor(ctx.body.author);
  const day = parseDay(ctx.body.day, ctx.today);
  if (day !== ctx.today) throw new GameError(409, "A new day started. Here are today's puzzles.");
  const action = ctx.body.action;
  if (!["start", "submit"].includes(action)) throw new GameError(400, "Unknown action.");
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    assignDay(doc, day, ctx.now);
    const entry = doc.days[day];
    const player = { ...(playerOf(entry, author) || {}) };
    if (player.doneAt) throw new GameError(409, "You already played today's odd one out.");
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
      awarded += await award(txn, `odd:${day}:play:${author}`, author, 1);
      const result = oddResult(entry);
      if (result) {
        for (const person of AUTHORS) {
          let hearts = result.winner === person ? 2 : result.winner === "tie" ? 1 : 0;
          if (result.right[person] === PER_DAY) hearts += 1;
          const delta = await award(txn, `odd:${day}:score:${person}`, person, hearts);
          if (person === author) awarded += delta;
        }
      }
      awarded += await markActive(txn, author, ctx.today);
    }
    return { ...view(doc, day, author, ctx.today, ctx.now), awarded };
  });
}

export const routes = {
  "/games/odd": async (ctx) => {
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
  let line = theirs ? "{them} played. Your turn" : "3 puzzles, fastest wins";
  if (mine && theirs) {
    const result = oddResult(entry);
    status = "done";
    line = result.winner === "tie" ? "A tie today" : `${result.winner === ctx.author ? "{me}" : "{them}"} won today`;
  } else if (mine) {
    status = "waiting";
    line = "Waiting for {them}";
  }
  const stats = oddStats(doc, ctx.today);
  return {
    id: "odd",
    title: "Odd one out",
    icon: "shapes",
    step: "odd",
    status,
    line,
    board: [
      { label: "Odd one out wins", her: stats.wins.her, sender: stats.wins.sender },
      { label: "Puzzles solved", her: stats.right.her, sender: stats.right.sender }
    ]
  };
}
