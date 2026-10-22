// Daily duel: 5 quick questions a day, one of each kind:
//   better  "Who's the better cook?"            -> pick a person (Me / You); same pick scores
//   did     "Who said 'I love you' first?"      -> pick a person (some days: "Who would rather…")
//   same    "Our next trip?" with 4 options     -> pick one; the same pick scores double
//   truth   "I checked my phone first thing…"   -> true or false for me, and a guess for you
//   mind    a colour, an animal and a number    -> every match scores (pure luck)
// A day's questions are chosen the first time either of us opens it and never change.
// Your answers show to the other only once they played too. Hearts are given once we
// both played: 1 for playing, then per question as listed in POINTS.
import { GameError, AUTHORS, parseAuthor, parseDay, award, markActive, other, dayNumber, pickForDay } from "./common.js";

const KEY = "games:duel";
const MAX_DAYS = 400;
const HISTORY_DAYS = 7;
const PLAY_HEARTS = 1;
// Hearts for each of us when we agree; the truth guess is personal (only the right guesser).
const POINTS = { better: 1, did: 1, same: 2, truth: 1, mind: 1 };

export const MIND = {
  colours: [["Pink", "#e85d8f"], ["Blue", "#4a7fd6"], ["Green", "#3ea56b"], ["Yellow", "#f0bf2f"], ["Purple", "#8a5cd1"], ["Red", "#d9443f"]],
  animals: [["Cat", "cat"], ["Dog", "dog"], ["Bunny", "rabbit"], ["Bird", "bird"], ["Fish", "fish"], ["Turtle", "turtle"]],
  numbers: ["1", "2", "3", "4", "5", "6"]
};

export const BETTER = [
  "Who's the better cook?", "Who's funnier?", "Who's the better kisser?", "Who's the better dancer?",
  "Who's the better singer?", "Who's the better driver?", "Who gives better hugs?", "Who's the better gift giver?",
  "Who's better at saying sorry?", "Who's the better listener?", "Who takes better photos?", "Who's better with money?",
  "Who's better at planning dates?", "Who's the better texter?", "Who's better at games?", "Who has better taste in music?",
  "Who has better taste in movies?", "Who's the better morning person?", "Who's better at keeping secrets?",
  "Who's the better navigator?", "Who's better at comforting the other?", "Who has the better laugh?",
  "Who's the better storyteller?", "Who's better at remembering dates?", "Who's the better baker?",
  "Who's better at flirting?", "Who's the better cuddler?", "Who's better at making up after a fight?",
  "Who's the better packer for a trip?", "Who's better at choosing restaurants?", "Who has better style?",
  "Who's better at surprises?", "Who's the calmer one?", "Who's better at keeping plants alive?",
  "Who's the better problem solver?", "Who's better at saving the last bite for the other?", "Who writes better messages?",
  "Who's better at waking up early?", "Who's the better host?", "Who gives better advice?",
  "Who's better at sports?", "Who's the better shopper?", "Who's better at making the other laugh?",
  "Who has the better memory?", "Who's the better compliment giver?", "Who's better at cheering the other up?",
  "Who's braver?", "Who's more patient?", "Who's more romantic?", "Who's the better kiss-goodnight giver?"
];

export const DID = [
  "Who said 'I love you' first?", "Who fell asleep first on the phone?", "Who texted first today?",
  "Who was more nervous on our first date?", "Who laughed first on our first date?", "Who made the first move?",
  "Who said sorry first last time?", "Who sends more voice messages?", "Who is usually late?",
  "Who ate more on our last date?", "Who checks their phone more on a date?", "Who picked the last movie?",
  "Who misses the other more during the week?", "Who sends more photos?", "Who started our last inside joke?",
  "Who blushes more?", "Who sends more hearts in chats?", "Who cried at a movie last?",
  "Who wanted to see the other first this week?", "Who stole the other's food last time?",
  "Who falls asleep first at movie night?", "Who says 'I miss you' more often?", "Who replied fastest yesterday?",
  "Who first suggested our next date?", "Who forgot something important last time?",
  "Who talks more on the phone?", "Who was the first to call the other cute?", "Who apologizes more?",
  "Who is more often hungry on a date?", "Who took the most photos last time we met?"
];

export const RATHER = [
  "Who would rather skip dessert than skip the movie?", "Who would rather stay in than go out tonight?",
  "Who would rather have a picnic than a restaurant date?", "Who would rather sleep in than watch the sunrise?",
  "Who would rather plan the whole trip than wing it?", "Who would rather cook than order food?",
  "Who would rather go to the beach than the mountains?", "Who would rather watch a horror movie than a romcom?",
  "Who would rather get a letter than a gift?", "Who would rather dance than sing karaoke?",
  "Who would rather have a cat than a dog?", "Who would rather do a road trip than fly?",
  "Who would rather eat pizza every day than never again?", "Who would rather go skydiving than bungee jumping?",
  "Who would rather spend a day in a spa than at a theme park?", "Who would rather text than call?",
  "Who would rather win an argument than get a hug?", "Who would rather live in a big city than the countryside?",
  "Who would rather have breakfast in bed than a fancy dinner?", "Who would rather give a surprise than get one?",
  "Who would rather be early than exactly on time?", "Who would rather go camping than stay in a hotel?",
  "Who would rather watch a series than a movie?", "Who would rather share dessert than get their own?",
  "Who would rather walk in the rain than stay inside?", "Who would rather play a board game than a video game?",
  "Who would rather try a new restaurant than go to a favourite?", "Who would rather do nothing all day together?",
  "Who would rather cuddle than go out?", "Who would rather know the ending of a movie first?"
];

export const SAME = [
  ["Our next trip?", ["Italy", "Paris", "The beach", "The mountains"]],
  ["Our perfect date night?", ["Cinema", "Cooking together", "Fancy dinner", "Long walk"]],
  ["Snack for movie night?", ["Popcorn", "Chips", "Chocolate", "Gummy bears"]],
  ["Our dream pet?", ["Cat", "Dog", "Bunny", "No pets"]],
  ["Best season for us?", ["Spring", "Summer", "Autumn", "Winter"]],
  ["Dinner tonight if we were together?", ["Pizza", "Sushi", "Burger", "Pasta"]],
  ["Our weekend away?", ["Spa hotel", "City trip", "Cabin in the woods", "Lake house"]],
  ["Movie genre for tonight?", ["Romcom", "Horror", "Action", "Animation"]],
  ["Best time of day for us?", ["Morning", "Afternoon", "Evening", "Late night"]],
  ["Our dream home?", ["City flat", "House with a garden", "By the lake", "In the mountains"]],
  ["Dessert to share?", ["Ice cream", "Tiramisu", "Brownies", "Crêpes"]],
  ["A rainy Sunday?", ["Movies in bed", "Baking", "Board games", "A long nap"]],
  ["Our dance song style?", ["Slow song", "Pop", "Latin", "Something silly"]],
  ["Our next activity?", ["Bowling", "Mini golf", "Escape room", "Ice skating"]],
  ["Drink on a date?", ["Coffee", "Bubble tea", "Hot chocolate", "Milkshake"]],
  ["Our holiday style?", ["Relax all day", "See everything", "Party", "Adventure"]],
  ["Breakfast together?", ["Croissants", "Pancakes", "Eggs and toast", "Fruit bowl"]],
  ["Our perfect picnic spot?", ["By the lake", "In the park", "On a hill", "On the balcony"]],
  ["Which couple costume?", ["Disney couple", "Food pair", "Superheroes", "Animals"]],
  ["Gift you'd love most?", ["Something handmade", "Flowers", "A trip", "A surprise date"]],
  ["Our perfect evening?", ["Candlelight dinner", "Stargazing", "Game night", "Concert"]],
  ["City for a weekend?", ["Rome", "Barcelona", "London", "Vienna"]],
  ["Our song mood?", ["Happy", "Romantic", "Dreamy", "Party"]],
  ["Which superpower for us?", ["Teleporting", "Flying", "Mind reading", "Time travel"]],
  ["Our favourite way to talk?", ["Calls", "Voice messages", "Texting", "Face to face only"]],
  ["Snow day plan?", ["Snowball fight", "Sledding", "Hot chocolate inside", "Build a snowman"]],
  ["Best kind of kiss?", ["Forehead kiss", "Cheek kiss", "Long kiss", "Surprise kiss"]],
  ["Our cooking night?", ["Homemade pizza", "Tacos", "Curry", "Fondue"]],
  ["Ideal first holiday together?", ["Greece", "Spain", "Japan", "Road trip"]],
  ["What we do best together?", ["Laugh", "Eat", "Talk for hours", "Be silly"]],
  ["Our Sunday morning?", ["Sleep in", "Brunch out", "Walk outside", "Cuddle and talk"]],
  ["Best place for a first kiss?", ["Under the stars", "In the rain", "At the door", "On a bench"]],
  ["A day at the fair?", ["Rollercoaster", "Ferris wheel", "Games stand", "Candy floss"]],
  ["Our date budget tonight?", ["Free", "Cheap and cute", "Medium", "Treat ourselves"]],
  ["Which animal are we as a couple?", ["Penguins", "Otters", "Swans", "Pandas"]],
  ["Perfect birthday surprise?", ["Party with friends", "Just the two of us", "A trip", "Breakfast surprise"]],
  ["The best Christmas tradition?", ["Cookies", "Christmas market", "Movies", "Gifts at midnight"]],
  ["Where should we live one day?", ["Switzerland", "Somewhere warm", "Big city abroad", "Wherever you are"]],
  ["Our music for a road trip?", ["Pop hits", "Old classics", "Rap", "Sing-along songs"]],
  ["Best way to make up?", ["A hug", "Talk it out", "Food", "A funny joke"]]
];

export const TRUTH = [
  "I checked my phone first thing this morning.", "I thought about you before getting out of bed.",
  "I ate something sweet today.", "I sang in the shower or in the car today.", "I'm wearing socks right now.",
  "I looked at a photo of us today.", "I had coffee today.", "I'm in bed right now.", "I'm hungry right now.",
  "I laughed out loud today.", "I scrolled TikTok or Instagram for more than an hour today.",
  "I skipped breakfast today.", "I already know what I'm wearing tomorrow.", "I took a selfie today.",
  "I told someone about you today.", "I drank enough water today.", "I'm wearing something pink right now.",
  "I took a nap today.", "I listened to a love song today.", "I had a dream about you this week.",
  "My room is tidy right now.", "I'm smiling right now.", "I watched a series today.",
  "I did something sporty today.", "I'm tired right now.", "I ate fast food this week.",
  "I'm looking forward to our next date right now.", "I said something embarrassing today.",
  "I wore headphones today.", "I sent a voice message today.", "I'm in a great mood today.",
  "I cooked something today.", "I bought something online this week.", "I woke up before 7 today.",
  "I'm cold right now.", "I talked to my mum today.", "I have more than 50% battery right now.",
  "I'm wearing my favourite hoodie right now.", "I made a to-do list today.", "I ate chocolate today.",
  "I re-read our chat today.", "I was a little grumpy today.", "I'm wearing perfume or cologne today.",
  "I stayed up too late yesterday.", "I danced today, even just a little.", "I want a hug right now.",
  "I watched a funny video today.", "I'm planning something for you.", "I had pasta this week.",
  "I'm thinking about you right now."
];

const KINDS = ["better", "did", "same", "truth", "mind"];
const PERSON_KINDS = ["better", "did"];

function normalize(value) {
  return { days: { ...(value?.days || {}) } };
}

// The day's 5 questions, the same for both of us. "did" days alternate between
// "Who did it?" and "Who would rather…?".
function questionsFor(day, dayIndex) {
  const did = dayIndex % 2 === 0 ? pickForDay(DID, day, "duel-did") : pickForDay(RATHER, day, "duel-rather");
  const [sameText, options] = pickForDay(SAME, day, "duel-same");
  return [
    { kind: "better", text: pickForDay(BETTER, day, "duel-better") },
    { kind: "did", text: did },
    { kind: "same", text: sameText, options: [...options] },
    { kind: "truth", text: pickForDay(TRUTH, day, "duel-truth") },
    { kind: "mind", text: "Pick a colour, an animal and a number. Same picks score." }
  ];
}

function assignDay(doc, day, now) {
  if (doc.days[day]) return false;
  doc.days[day] = { questions: questionsFor(day, dayNumber(day)), answers: {}, at: now };
  const others = Object.keys(doc.days).filter((key) => key !== day).sort();
  for (const old of others.slice(0, Math.max(0, others.length + 1 - MAX_DAYS))) delete doc.days[old];
  return true;
}

const isBool = (value) => value === true || value === false;
const inRange = (value, length) => Number.isInteger(value) && value >= 0 && value < length;

// Answers in question order: [person, person, optionIndex, { self, guess }, [colour, animal, number]].
function parseAnswers(value, questions) {
  const bad = () => new GameError(400, "Answer all 5 questions.");
  if (!Array.isArray(value) || value.length !== KINDS.length) throw bad();
  return questions.map((question, index) => {
    const answer = value[index];
    if (PERSON_KINDS.includes(question.kind)) {
      if (!AUTHORS.includes(answer)) throw bad();
      return answer;
    }
    if (question.kind === "same") {
      if (!inRange(answer, question.options.length)) throw bad();
      return answer;
    }
    if (question.kind === "truth") {
      if (!answer || !isBool(answer.self) || !isBool(answer.guess)) throw bad();
      return { self: answer.self, guess: answer.guess };
    }
    if (!Array.isArray(answer) || answer.length !== 3
      || !inRange(answer[0], MIND.colours.length) || !inRange(answer[1], MIND.animals.length) || !inRange(answer[2], MIND.numbers.length)) {
      throw bad();
    }
    return [...answer];
  });
}

const answersOf = (entry, author) => (Array.isArray(entry?.answers?.[author]) ? entry.answers[author] : null);

// Per question: did we agree, and the hearts each of us got from it.
function scoreDay(entry) {
  const her = answersOf(entry, "her");
  const sender = answersOf(entry, "sender");
  if (!her || !sender) return null;
  const rows = entry.questions.map((question, index) => {
    const a = her[index];
    const b = sender[index];
    if (question.kind === "truth") {
      // Each of us guessed the other's answer; only a right guess scores, for the guesser.
      const herRight = a.guess === b.self;
      const senderRight = b.guess === a.self;
      return { kind: question.kind, same: herRight && senderRight, hearts: { her: herRight ? POINTS.truth : 0, sender: senderRight ? POINTS.truth : 0 }, right: { her: herRight, sender: senderRight } };
    }
    if (question.kind === "mind") {
      const matches = a.reduce((count, pick, part) => count + (pick === b[part] ? 1 : 0), 0);
      return { kind: question.kind, same: matches === 3, matches, hearts: { her: matches * POINTS.mind, sender: matches * POINTS.mind } };
    }
    const same = a === b;
    const points = same ? POINTS[question.kind] : 0;
    return { kind: question.kind, same, hearts: { her: points, sender: points } };
  });
  const total = { her: 0, sender: 0 };
  for (const row of rows) for (const author of AUTHORS) total[author] += row.hearts[author];
  // Agreement out of 6: better, did and same, plus each of the 3 mind-reader picks.
  const agreements = rows.reduce((count, row) => count + (row.kind === "mind" ? row.matches : row.kind === "truth" ? 0 : row.same ? 1 : 0), 0);
  return { rows, total, agreements, possible: 6 };
}

function dayView(entry, day, author) {
  const mine = answersOf(entry, author);
  const theirs = answersOf(entry, other(author));
  return {
    day,
    questions: Array.isArray(entry?.questions) ? entry.questions : [],
    mine,
    theirs: mine ? theirs : null,
    theirsDone: Boolean(theirs),
    result: mine && theirs ? scoreDay(entry) : null
  };
}

// Agreement over every day we both played, truth guesses each of us got right, best day.
export function duelStats(doc, today) {
  const played = Object.keys(doc.days).filter((day) => day <= today && scoreDay(doc.days[day])).sort();
  let agreements = 0;
  let possible = 0;
  let bestDay = 0;
  const truthRight = { her: 0, sender: 0 };
  for (const day of played) {
    const result = scoreDay(doc.days[day]);
    agreements += result.agreements;
    possible += result.possible;
    bestDay = Math.max(bestDay, result.agreements);
    const truth = result.rows.find((row) => row.kind === "truth");
    for (const author of AUTHORS) if (truth?.right?.[author]) truthRight[author] += 1;
  }
  return {
    agreement: possible ? Math.round((100 * agreements) / possible) : null,
    daysPlayed: played.length,
    bestDay,
    truthRight
  };
}

function view(doc, day, author, today) {
  const history = Object.keys(doc.days)
    .filter((key) => key < day && AUTHORS.some((who) => answersOf(doc.days[key], who)))
    .sort()
    .reverse()
    .slice(0, HISTORY_DAYS)
    .map((key) => dayView(doc.days[key], key, author));
  return { ...dayView(doc.days[day], day, author), stats: duelStats(doc, today), mind: MIND, history };
}

async function read(ctx) {
  const author = parseAuthor(ctx.query("author"));
  const day = parseDay(ctx.query("day"), ctx.today);
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    if (day === ctx.today) {
      if (assignDay(doc, day, ctx.now)) await txn.put(KEY, doc);
    } else if (!doc.days[day]) {
      throw new GameError(404, "There was no duel that day.");
    }
    return view(doc, day, author, ctx.today);
  });
}

async function play(ctx) {
  const author = parseAuthor(ctx.body.author);
  const day = parseDay(ctx.body.day, ctx.today);
  if (day !== ctx.today) throw new GameError(409, "A new day started. Here are today's questions.");
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    assignDay(doc, day, ctx.now);
    const entry = doc.days[day];
    if (answersOf(entry, author)) throw new GameError(409, "You already played today's duel.");
    const answers = parseAnswers(ctx.body.answers, entry.questions);
    entry.answers = { ...(entry.answers || {}), [author]: answers };
    await txn.put(KEY, doc);
    let awarded = await award(txn, `duel:${day}:play:${author}`, author, PLAY_HEARTS);
    // The second of us to play settles the day's hearts for both.
    const result = scoreDay(entry);
    if (result) {
      for (const person of AUTHORS) {
        const delta = await award(txn, `duel:${day}:score:${person}`, person, result.total[person]);
        if (person === author) awarded += delta;
      }
    }
    awarded += await markActive(txn, author, ctx.today);
    return { ...view(doc, day, author, ctx.today), awarded };
  });
}

export const routes = {
  "/games/duel": async (ctx) => {
    if (ctx.method === "GET") return read(ctx);
    if (ctx.method === "POST") return play(ctx);
    throw new GameError(405, "Method not allowed.");
  }
};

// For the games hub.
export async function summary(ctx) {
  const doc = normalize(await ctx.storage.get(KEY));
  const entry = doc.days[ctx.today];
  const mine = answersOf(entry, ctx.author);
  const theirs = answersOf(entry, other(ctx.author));
  let status = "todo";
  let line = theirs ? "{them} played. Your turn" : "5 quick questions about us";
  if (mine && theirs) {
    const result = scoreDay(entry);
    status = "done";
    line = `${result.agreements} of ${result.possible} the same today`;
  } else if (mine) {
    status = "waiting";
    line = "Waiting for {them}";
  }
  const stats = duelStats(doc, ctx.today);
  return {
    id: "duel",
    title: "Daily duel",
    icon: "swords",
    step: "duel",
    status,
    line,
    board: [
      { label: "Duel agreement", value: stats.agreement === null ? "–" : `${stats.agreement}%` },
      { label: "Truth guesses right", her: stats.truthRight.her, sender: stats.truthRight.sender }
    ]
  };
}

// Exposed for tests.
export { scoreDay, parseAnswers, questionsFor };
