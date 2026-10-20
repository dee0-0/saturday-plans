// Wordle for two: the same five-letter word for both of us each day. Each of us plays
// alone (6 tries). Until you've finished, you only see the colours of the other one's
// guesses, never their letters or the word. Solving earns a heart; once both of us are
// done, the one who needed fewer tries gets 2 more (a tie: 1 each).
import { GameError, parseAuthor, award, markActive, other, pickForDay, addDays, isValidDay, AUTHORS } from "./common.js";

// Common, friendly words (no plurals, nothing obscure or rude). The day's word is picked
// from a fixed shuffle of this list and stored with the day, so editing the list later
// never changes a day that was already played.
export const ANSWERS = [
  "abbey", "abide", "acorn", "actor", "acute", "adapt", "admit", "adopt", "adore", "adorn", "adult", "after", "again",
  "agile", "agree", "ahead", "aisle", "alarm", "album", "alert", "alien", "alike", "alive", "alley", "allow", "alone",
  "along", "aloud", "amaze", "amber", "amuse", "angel", "angle", "angry", "apart", "apple", "apply", "arena", "argue",
  "arise", "aroma", "arrow", "aside", "attic", "audio", "avoid", "await", "awake", "award", "aware", "azure", "bacon",
  "badge", "bagel", "baker", "balmy", "banjo", "basic", "basil", "bathe", "baton", "beach", "beard", "beast", "begin",
  "beige", "belly", "below", "bench", "beret", "berry", "bingo", "birch", "birth", "black", "blade", "blame", "blank",
  "blast", "blaze", "blend", "bless", "blind", "blink", "bliss", "block", "blond", "bloom", "bluff", "blush", "board",
  "boost", "booth", "bossy", "bound", "brace", "braid", "brain", "brake", "brand", "brave", "bread", "break", "brick",
  "bride", "brief", "bring", "broad", "brook", "broom", "broth", "brown", "brush", "buddy", "bugle", "build", "bumpy",
  "bunch", "bunny", "burst", "cabin", "cable", "camel", "cameo", "canal", "candy", "canoe", "cargo", "carol", "carry",
  "carve", "catch", "cause", "cedar", "cello", "chain", "chair", "chalk", "champ", "chant", "charm", "chart", "chase",
  "cheap", "check", "cheek", "cheer", "chess", "chest", "chewy", "chick", "chief", "child", "chili", "chill", "chime",
  "chimp", "chirp", "choir", "chord", "chore", "chunk", "churn", "cider", "cinch", "civic", "civil", "claim", "clamp",
  "class", "clean", "clear", "clerk", "click", "cliff", "climb", "cling", "cloak", "clock", "close", "cloth", "cloud",
  "clove", "clown", "coach", "coast", "cobra", "cocoa", "comet", "comfy", "comic", "coral", "corny", "couch", "count",
  "court", "cover", "crack", "craft", "crane", "crash", "crate", "crave", "crawl", "crazy", "cream", "creek", "crepe",
  "crest", "crisp", "cross", "crowd", "crown", "crumb", "crush", "crust", "curly", "curry", "curve", "cutie", "cycle",
  "daily", "dairy", "daisy", "dance", "decoy", "delay", "denim", "dense", "depot", "depth", "diary", "diner", "dirty",
  "disco", "diver", "dizzy", "dodge", "dorky", "doubt", "dough", "dozen", "draft", "drain", "drama", "drape", "dream",
  "dress", "drift", "drill", "drink", "drive", "dryer", "dusty", "duvet", "dwarf", "dwell", "eager", "eagle", "early",
  "earth", "easel", "ebony", "eerie", "eight", "elbow", "elder", "elect", "elite", "email", "ember", "empty", "enjoy",
  "enter", "entry", "equal", "erase", "error", "essay", "event", "every", "exact", "exist", "extra", "fable", "faint",
  "fairy", "faith", "false", "fancy", "fault", "feast", "fence", "ferry", "fetch", "fever", "field", "fiery", "fifth",
  "fifty", "fight", "final", "finch", "first", "fishy", "fizzy", "flair", "flake", "flaky", "flame", "flare", "flash",
  "flask", "fleet", "flick", "fling", "flirt", "float", "flock", "flood", "floor", "flora", "floss", "flour", "fluff",
  "fluid", "flush", "flute", "flyer", "foamy", "foggy", "force", "forge", "forth", "forty", "found", "frame", "frank",
  "fresh", "front", "frost", "froth", "frown", "fruit", "fudge", "funny", "furry", "fussy", "fuzzy", "gamer", "gauge",
  "gecko", "geese", "genie", "ghost", "giant", "giddy", "glade", "glass", "glaze", "gleam", "glide", "globe", "glory",
  "gloss", "glove", "gnome", "gooey", "goofy", "goose", "grace", "grade", "grain", "grand", "grant", "grape", "graph",
  "grasp", "grass", "gravy", "graze", "great", "green", "greet", "grill", "grind", "groan", "groom", "group", "grove",
  "growl", "guard", "guess", "guest", "guide", "habit", "hairy", "handy", "happy", "hardy", "harsh", "hasty", "hatch",
  "haunt", "haven", "havoc", "hazel", "heart", "heavy", "hedge", "hello", "heron", "hiker", "hilly", "hobby", "holly",
  "honey", "horse", "hotel", "house", "hover", "human", "humid", "hurry", "husky", "icing", "ideal", "igloo", "image",
  "index", "inner", "input", "itchy", "ivory", "jelly", "jewel", "jiffy", "joint", "joker", "jolly", "judge", "juice",
  "juicy", "jumbo", "jumpy", "kayak", "kebab", "khaki", "kiosk", "kitty", "knack", "knead", "kneel", "knife", "knock",
  "koala", "label", "ladle", "lapel", "large", "laser", "latch", "later", "latte", "laugh", "layer", "leafy", "learn",
  "leash", "least", "leave", "ledge", "legal", "lemon", "lemur", "level", "lever", "light", "lilac", "limbo", "limit",
  "linen", "lingo", "liver", "llama", "lobby", "local", "lodge", "lofty", "logic", "loose", "lover", "lower", "loyal",
  "lucid", "lucky", "lunar", "lunch", "lyric", "magic", "major", "mango", "manor", "maple", "march", "marry", "marsh",
  "match", "maybe", "mayor", "medal", "media", "melon", "mercy", "merge", "merit", "merry", "messy", "metal", "metro",
  "milky", "mimic", "mince", "miner", "minor", "misty", "mixer", "mocha", "model", "moist", "money", "month", "moody",
  "moose", "moral", "mossy", "motel", "motif", "motor", "motto", "mound", "mount", "mouse", "mouth", "movie", "muddy",
  "mural", "music", "nacho", "naive", "nerve", "never", "nifty", "night", "ninth", "noble", "noise", "noisy", "nomad",
  "north", "novel", "nurse", "nutty", "nylon", "occur", "ocean", "offer", "often", "olive", "onion", "opera", "orbit",
  "order", "organ", "other", "otter", "ounce", "outer", "owner", "paint", "panda", "panel", "panic", "paper", "party",
  "pasta", "paste", "patch", "patio", "pause", "peace", "peach", "pearl", "pecan", "pedal", "penny", "peony", "perch",
  "perky", "pesky", "pesto", "petal", "phase", "phone", "photo", "piano", "picky", "piece", "pilot", "pinch", "pinky",
  "pitch", "pivot", "pixie", "pizza", "place", "plaid", "plain", "plane", "plank", "plant", "plate", "plaza", "pluck",
  "plume", "plump", "plush", "point", "poker", "polar", "polka", "poppy", "porch", "pouch", "pound", "power", "prank",
  "prawn", "press", "price", "pride", "prime", "print", "prior", "prism", "prize", "probe", "proof", "proud", "prove",
  "prune", "pulse", "punch", "pupil", "puppy", "purse", "quack", "quail", "quake", "queen", "quest", "queue", "quick",
  "quiet", "quilt", "quirk", "quite", "quote", "radar", "radio", "rainy", "raise", "rally", "ranch", "range", "rapid",
  "ratio", "raven", "razor", "reach", "react", "ready", "realm", "rebel", "relax", "relay", "relic", "renew", "reply",
  "rhino", "rhyme", "rider", "ridge", "right", "rinse", "ripen", "risky", "rival", "river", "roast", "robin", "robot",
  "rocky", "rodeo", "roomy", "rough", "round", "route", "royal", "rugby", "rural", "rusty", "salad", "salon", "salty",
  "sandy", "satin", "sauce", "saucy", "sauna", "savvy", "scale", "scare", "scarf", "scary", "scene", "scent", "scoop",
  "scoot", "scope", "score", "scout", "scrap", "scrub", "sense", "serve", "seven", "shade", "shady", "shake", "shaky",
  "shape", "share", "shark", "sharp", "shave", "shawl", "sheep", "sheet", "shelf", "shell", "shift", "shine", "shiny",
  "shirt", "shock", "shoot", "shore", "short", "shout", "showy", "shrug", "sight", "silly", "skate", "skill", "skirt",
  "slate", "sleek", "sleep", "slice", "slick", "slide", "slope", "sloth", "small", "smart", "smell", "smile", "smirk",
  "smoke", "smoky", "snack", "snail", "snake", "sneak", "sniff", "snore", "snowy", "soapy", "sober", "soggy", "solar",
  "solid", "solve", "sonic", "sorry", "sound", "south", "space", "spare", "spark", "speak", "spell", "spend", "spice",
  "spicy", "spike", "spill", "spine", "split", "spoil", "spoon", "sport", "spray", "spree", "sprig", "squad", "stack",
  "staff", "stage", "stair", "stalk", "stamp", "stand", "stare", "start", "state", "steak", "steam", "steel", "steep",
  "stick", "stiff", "still", "sting", "stock", "stomp", "stone", "stool", "store", "stork", "storm", "story", "stove",
  "strap", "straw", "strip", "strum", "strut", "study", "stuff", "stump", "style", "suede", "sugar", "sunny", "super",
  "surge", "sushi", "swamp", "swarm", "sweat", "sweep", "sweet", "swell", "swift", "swing", "swirl", "swoop", "sword",
  "syrup", "tabby", "table", "tacky", "tango", "taste", "tasty", "teach", "tease", "teddy", "teeth", "tempo", "tempt",
  "tense", "thank", "theme", "thick", "thing", "think", "third", "thorn", "three", "throw", "thumb", "thyme", "tiara",
  "tidal", "tiger", "tight", "timid", "tipsy", "title", "toast", "today", "token", "tooth", "topaz", "topic", "torch",
  "total", "touch", "tough", "towel", "tower", "trace", "track", "trade", "trail", "train", "trait", "treat", "trend",
  "trial", "tribe", "trick", "trout", "truce", "truck", "truly", "trunk", "trust", "truth", "tulip", "tummy", "tunic",
  "tutor", "tweak", "tweet", "twice", "twirl", "twist", "uncle", "union", "unite", "unity", "upper", "upset", "urban",
  "usual", "valet", "valid", "value", "vault", "venue", "verse", "video", "villa", "vinyl", "viola", "visit", "visor",
  "vista", "vital", "vivid", "vocal", "vogue", "voice", "vowel", "wafer", "wagon", "waist", "waltz", "waste", "watch",
  "water", "weary", "weave", "wedge", "weigh", "weird", "whale", "wheel", "whisk", "white", "whole", "width", "windy",
  "witch", "witty", "woman", "woody", "world", "worry", "worth", "woven", "wreck", "wrist", "write", "wrong", "yacht",
  "yearn", "yeast", "yield", "yodel", "young", "youth", "zebra"
];

export const MAX_TRIES = 6;
const KEEP_DAYS = 60;
const STATS_KEY = "games:wordle:stats";
const dayKey = (day) => `games:wordle:${day}`;
const WORD = /^[a-z]{5}$/;
const MARKS = /^[gyb]{5}$/;
const RANK = { b: 1, y: 2, g: 3 };

export const answerForDay = (day) => pickForDay(ANSWERS, day, "wordle");

// One mark per letter: g = right spot, y = in the word but elsewhere, b = not in the word.
// Repeated letters follow the usual rules: right spots are taken first, then each copy of
// the letter still left in the answer turns one more guessed copy yellow, left to right.
export function scoreGuess(guess, answer) {
  const marks = Array(5).fill("b");
  const left = {};
  for (let index = 0; index < 5; index += 1) {
    if (guess[index] === answer[index]) marks[index] = "g";
    else left[answer[index]] = (left[answer[index]] || 0) + 1;
  }
  for (let index = 0; index < 5; index += 1) {
    if (marks[index] === "g" || !left[guess[index]]) continue;
    marks[index] = "y";
    left[guess[index]] -= 1;
  }
  return marks.join("");
}

// ---- Stored data ------------------------------------------------------------------

function normalizeDay(value, day) {
  const guesses = {};
  const finished = {};
  for (const author of AUTHORS) {
    const list = Array.isArray(value?.guesses?.[author]) ? value.guesses[author] : [];
    guesses[author] = list.filter((item) => WORD.test(item?.word) && MARKS.test(item?.marks))
      .slice(0, MAX_TRIES)
      .map((item) => ({ word: item.word, marks: item.marks }));
    const done = value?.finished?.[author];
    if (done) finished[author] = { solved: Boolean(done.solved), tries: Number(done.tries) || 0, at: done.at || null };
  }
  return {
    answer: WORD.test(value?.answer) ? value.answer : answerForDay(day),
    guesses,
    finished,
    result: value?.result || null
  };
}

const emptyPerson = () => ({
  played: 0, solved: 0, wins: 0, ties: 0, totalTries: 0, streak: 0, maxStreak: 0, lastSolved: null,
  dist: [0, 0, 0, 0, 0, 0]
});

function normalizeStats(value) {
  const people = {};
  for (const author of AUTHORS) {
    const raw = value?.people?.[author] || {};
    const person = emptyPerson();
    for (const field of ["played", "solved", "wins", "ties", "totalTries", "streak", "maxStreak"]) {
      person[field] = Math.max(0, Math.round(Number(raw[field]) || 0));
    }
    person.lastSolved = isValidDay(raw.lastSolved) ? raw.lastSolved : null;
    if (Array.isArray(raw.dist)) person.dist = person.dist.map((_, index) => Math.max(0, Math.round(Number(raw.dist[index]) || 0)));
    people[author] = person;
  }
  // The days that still have a stored day doc, so old ones can be deleted.
  const stored = Array.isArray(value?.stored) ? value.stored.filter(isValidDay) : [];
  return { people, stored };
}

// ---- Views --------------------------------------------------------------------------

function winnerOf(doc) {
  const her = doc.finished.her;
  const sender = doc.finished.sender;
  if (!her || !sender) return undefined;
  if (her.solved !== sender.solved) return her.solved ? "her" : "sender";
  if (!her.solved) return null;
  if (her.tries === sender.tries) return "tie";
  return her.tries < sender.tries ? "her" : "sender";
}

function personStats(person, today) {
  return {
    played: person.played,
    solved: person.solved,
    wins: person.wins,
    ties: person.ties,
    winRate: person.played ? Math.round((person.solved / person.played) * 100) : 0,
    avgTries: person.solved ? Math.round((person.totalTries / person.solved) * 10) / 10 : null,
    // A solve streak lives on until a day is missed or lost.
    streak: person.lastSolved && person.lastSolved >= addDays(today, -1) ? person.streak : 0,
    maxStreak: person.maxStreak,
    dist: [...person.dist]
  };
}

function playerState(doc, author) {
  const guesses = doc.guesses[author];
  const done = doc.finished[author];
  return { guesses, done: Boolean(done), solved: Boolean(done?.solved), tries: done ? done.tries : guesses.length };
}

function view(doc, author, stats, day) {
  const mine = playerState(doc, author);
  const theirs = playerState(doc, other(author));
  const keyboard = {};
  for (const { word, marks } of mine.guesses) {
    for (let index = 0; index < 5; index += 1) {
      const letter = word[index];
      if (!keyboard[letter] || RANK[marks[index]] > RANK[keyboard[letter]]) keyboard[letter] = marks[index];
    }
  }
  const winner = winnerOf(doc);
  return {
    day,
    maxTries: MAX_TRIES,
    mine: { guesses: mine.guesses, done: mine.done, solved: mine.solved, tries: mine.tries },
    // Only colours until I'm done; after that their words too (the word is no secret to me then).
    theirs: {
      marks: theirs.guesses.map((item) => item.marks),
      done: theirs.done,
      solved: theirs.solved,
      tries: theirs.tries,
      ...(mine.done ? { words: theirs.guesses.map((item) => item.word) } : {})
    },
    answer: mine.done ? doc.answer : null,
    result: winner === undefined ? null : { winner },
    stats: Object.fromEntries(AUTHORS.map((person) => [person, personStats(stats.people[person], day)])),
    keyboard
  };
}

// ---- Routes ---------------------------------------------------------------------------

async function read(ctx) {
  const author = parseAuthor(ctx.query("author"));
  const day = ctx.today;
  return ctx.storage.transaction(async (txn) => {
    const doc = normalizeDay(await txn.get(dayKey(day)), day);
    const stats = normalizeStats(await txn.get(STATS_KEY));
    return view(doc, author, stats, day);
  });
}

async function play(ctx) {
  const body = ctx.body || {};
  const author = parseAuthor(body.author);
  const word = typeof body.word === "string" ? body.word.trim().toLowerCase() : "";
  if (!WORD.test(word)) throw new GameError(400, "Guess a word with 5 letters.");
  const day = ctx.today;
  // A guess typed just before midnight must not land on the next day's word.
  if (body.day !== undefined && body.day !== day) throw new GameError(409, "A new day started, with a new word.", { day });

  return ctx.storage.transaction(async (txn) => {
    const doc = normalizeDay(await txn.get(dayKey(day)), day);
    const stats = normalizeStats(await txn.get(STATS_KEY));
    if (doc.finished[author]) throw new GameError(409, "You already finished today’s word.");
    const guesses = doc.guesses[author];
    if (guesses.some((item) => item.word === word)) throw new GameError(400, "You already tried that word.");

    const marks = scoreGuess(word, doc.answer);
    guesses.push({ word, marks });
    let awarded = await markActive(txn, author, day);
    const solved = marks === "ggggg";
    const finishedNow = solved || guesses.length >= MAX_TRIES;

    if (finishedNow) {
      const tries = guesses.length;
      doc.finished[author] = { solved, tries, at: ctx.now };
      const person = stats.people[author];
      person.played += 1;
      if (solved) {
        person.solved += 1;
        person.totalTries += tries;
        person.dist[tries - 1] += 1;
        person.streak = person.lastSolved === addDays(day, -1) ? person.streak + 1 : 1;
        person.lastSolved = day;
        person.maxStreak = Math.max(person.maxStreak, person.streak);
        awarded += await award(txn, `wordle:${day}:${author}`, author, 1);
      } else {
        person.streak = 0;
      }

      // The second one to finish settles the day.
      const winner = winnerOf(doc);
      if (winner !== undefined && !doc.result) {
        doc.result = { winner, at: ctx.now };
        for (const someone of AUTHORS) {
          const amount = winner === "tie" ? 1 : winner === someone ? 2 : 0;
          if (!amount) continue;
          const delta = await award(txn, `wordle:${day}:win:${someone}`, someone, amount);
          if (someone === author) awarded += delta;
          if (winner === "tie") stats.people[someone].ties += 1;
          else stats.people[someone].wins += 1;
        }
      }
    }

    // Keep about two months of days; the stats doc keeps the totals.
    if (!stats.stored.includes(day)) stats.stored.push(day);
    const oldest = addDays(day, -KEEP_DAYS);
    for (const old of stats.stored.filter((item) => item < oldest)) await txn.delete(dayKey(old));
    stats.stored = stats.stored.filter((item) => item >= oldest).sort();

    await txn.put(dayKey(day), doc);
    await txn.put(STATS_KEY, stats);
    return { ...view(doc, author, stats, day), awarded };
  });
}

export const routes = {
  "/games/wordle": async (ctx) => {
    if (ctx.method === "GET") return read(ctx);
    if (ctx.method === "POST") return play(ctx);
    throw new GameError(405, "Method not allowed.");
  }
};

// For the games hub: my move today, the duel result and the wins leaderboard.
export async function summary(ctx) {
  const author = AUTHORS.includes(ctx.author) ? ctx.author : "her";
  const day = ctx.today;
  const doc = normalizeDay(await ctx.storage.get(dayKey(day)), day);
  const stats = normalizeStats(await ctx.storage.get(STATS_KEY));
  const mine = playerState(doc, author);
  const theirs = playerState(doc, other(author));
  const winner = winnerOf(doc);

  let status = "todo";
  let line = "Your turn";
  if (!mine.done && theirs.done) {
    line = theirs.solved ? `{them} got it in ${theirs.tries}. Your turn` : "{them} missed it. Your turn";
  } else if (mine.done && !theirs.done) {
    status = "waiting";
    line = "Waiting for {them}";
  } else if (mine.done) {
    status = "done";
    if (winner === author) line = "{me} won today";
    else if (winner === other(author)) line = "{them} won today";
    else if (winner === "tie") line = "Tie today";
    else line = "Nobody got it today";
  }

  const her = personStats(stats.people.her, day);
  const sender = personStats(stats.people.sender, day);
  const board = [{ label: "Wordle wins", her: her.wins, sender: sender.wins }];
  if (her.avgTries !== null && sender.avgTries !== null) {
    board.push({ label: "Avg tries", her: her.avgTries, sender: sender.avgTries, lowerWins: true });
  }
  return { id: "wordle", title: "Wordle for two", icon: "grid-3x3", step: "wordle", status, line, board };
}
