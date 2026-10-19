// Daily doodle: the same prompt for both of us each day. Each of us draws it once on
// the phone (strokes stored as small vectors), and the other's drawing only shows once
// you've drawn yours, so the two can be compared side by side.
import { GameError, AUTHORS, parseAuthor, parseDay, award, markActive, pickForDay, addDays, isValidDay, other } from "./common.js";

const INDEX_KEY = "games:doodle";
const strokesKey = (day, author) => `games:doodle:${day}:${author}`;
const KEEP_DAYS = 120;
const HISTORY_DAYS = 30;
const DOODLE_HEART = 1;

// Drawing limits (the page enforces the same ones while drawing).
export const MAX_STROKES = 400;
export const MAX_POINTS = 8000;
export const MAX_BYTES = 150 * 1024;
export const CANVAS_SIZE = 1000;
// The page's six pens; a stroke's colour has to be one of them.
export const PALETTE = ["#29252f", "#dc4f83", "#f28b30", "#f2c641", "#2e9e83", "#3f7fd8"];

// Easy, fun things to draw (add new ones at the end).
export const PROMPTS = [
  "a cat on a skateboard", "our first date", "a snowman at the beach", "a dog wearing sunglasses",
  "a croissant with a face", "the two of us as potatoes", "a dragon eating pizza", "a house on a cloud",
  "a penguin on holiday", "your dream breakfast", "a snail in a hurry", "a fish riding a bike",
  "a happy little volcano", "a cactus who needs a hug", "a robot in love", "the moon having a snack",
  "a bear at the cinema", "a giraffe in a tiny car", "your favourite sandwich", "a cloud that is raining hearts",
  "a frog king", "a hamburger with legs", "a lighthouse at night", "an octopus doing the dishes",
  "a castle made of cake", "a cow on the moon", "our next date", "a sleepy sun",
  "a mermaid at a picnic", "a duck with an umbrella", "a hot air balloon", "a pineapple on a surfboard",
  "a ghost who is shy", "a tree house", "a bunny astronaut", "an ice cream cone melting",
  "a tiny monster under the bed", "a whale in a bathtub", "a pig in a tutu", "a flower wearing a hat",
  "the best pizza ever", "a cupcake party", "a spider knitting a scarf", "a hedgehog with balloons",
  "an alien on a road trip", "a lion at the hairdresser", "a train going through the mountains", "a mouse with a huge cheese",
  "a parrot pirate", "a sheep who can't sleep", "a turtle racing a rabbit", "a sock monster",
  "a koala on a swing", "a rainbow over a city", "a fox reading a book", "a teapot with feet",
  "a dinosaur birthday party", "your happy place", "a pumpkin carriage", "a jellyfish disco",
  "a donut planet", "a bee carrying flowers", "an owl teacher", "a picnic in the park",
  "a squirrel with a backpack", "a boat in a storm", "a camel in the snow", "a unicorn eating spaghetti",
  "a baby elephant in the rain", "a cozy fireplace", "a crab on the beach", "a watermelon smile",
  "a superhero cat", "a dragon knitting", "a kangaroo with a full pocket", "a sandcastle",
  "a carrot in sunglasses", "a bird building a nest", "a rocket made of fruit", "a sloth on a rollercoaster",
  "a starry night", "a flamingo on one leg", "a busy bakery", "a dog walking a human",
  "a lemon with a mustache", "a fairy in a teacup", "a raccoon chef", "a bicycle for two",
  "a little cottage in the woods", "a polar bear on an iceberg", "a strawberry house", "an angry cloud",
  "a goldfish in space", "a pancake tower", "a giraffe wearing a scarf", "a hippo ballerina",
  "a bouquet of flowers", "a submarine full of fish", "a mushroom village", "a chicken on a motorbike",
  "your favourite animal", "a love letter", "a panda eating noodles", "a train made of sausages",
  "a lonely sock", "a seal playing guitar", "a tiny dragon in a cup", "a tent under the stars",
  "a big hug", "a hot chocolate with marshmallows", "a gingerbread house", "a llama with a haircut",
  "a beach umbrella", "a worm in an apple", "a cat stuck in a box", "a happy toaster",
  "a bear catching fish", "a windmill", "a balloon animal", "a dog in a raincoat",
  "an ant carrying a sandwich", "a skyscraper with a garden", "a moose in a canoe", "a broccoli forest",
  "a hamster on a wheel", "a wizard hat", "a tiger in pajamas", "a sunflower field",
  "a snowy mountain", "a fancy cake", "a dancing banana", "a cat on a laptop",
  "a crocodile at the dentist", "a goat on a roof", "a cheese moon", "a heart with arms and legs",
  "a couch potato", "a deer in the forest", "a magic lamp", "a monkey in a tree",
  "a pirate ship", "a cookie jar", "a dog chasing its tail", "a beach at sunset",
  "a caterpillar becoming a butterfly", "a hedgehog in a mitten", "a bowl of ramen", "a cat with a fish bowl",
  "a fire truck", "a sushi party", "a zebra without stripes", "a magic carpet ride",
  "a scarecrow", "a bunny in a teacup", "a lost balloon", "a puppy and a kitten",
  "a frog on a lily pad", "a carousel", "a tiny house on a big rock", "a chef's kiss",
  "a fox in the snow", "a bowl of fruit", "a robot dog", "an elephant painting",
  "a storm in a teacup", "a picnic basket", "a dragon guarding cookies", "a koala sleeping",
  "a gnome with a wheelbarrow", "a seahorse family", "a vending machine of hugs", "a lemonade stand",
  "a dog in a bathtub", "a magic wand", "a big pile of leaves", "a garden full of vegetables",
  "a bat who is afraid of the dark", "a cat watching the rain", "a giant strawberry", "a tiny boat in a huge sea",
  "a sunny day at the lake", "a peacock showing off", "a cow in a field", "a hot dog in a bun bed",
  "a waffle with too much syrup", "a cute plant pot", "a sleepy cat in the sun", "an owl at night",
  "a city skyline", "a pair of sneakers", "a pizza slice surfing", "a lamb in a sweater",
  "a big wave", "a birthday present", "a candle on a cake", "a rubber duck",
  "a pig in the mud", "a camping trip", "a tiny planet with one tree", "a snowman with a scarf",
  "a happy avocado", "a fish tank", "a bird on a wire", "a squirrel stealing a nut",
  "a cat in a sweater", "a burger and fries", "a fox and a rabbit being friends", "a rain boot with flowers",
  "a cozy bed", "a shooting star", "a bunch of grapes", "a dog with a bone",
  "a beehive", "a moon with a nightcap", "a snail with a tiny house", "a toaster launching toast",
  "a horse with wings", "a tower of books", "a lighthouse keeper cat", "a bowl of popcorn at the movies",
  "a pair of glasses", "a street lamp in the rain", "a giant cookie", "a baby chick hatching",
  "a rainbow cake", "a parrot on a shoulder", "a hedgehog eating an apple", "a rabbit in a magic hat",
  "a sandwich that is too big", "a fishing trip", "a spaceship", "a little red car",
  "a cat in a shopping bag", "a dog at the beach", "a pretzel", "a coffee cup with steam",
  "a mountain cabin", "a cartoon version of you", "a cartoon version of me", "the two of us in ten years",
  "where we met", "our dream holiday", "a souvenir from our last trip", "what you had for lunch today",
  "the view from your window", "your favourite snack", "your favourite song as a picture", "a dessert you'd share with me",
  "a cute monster", "a happy cloud", "a smiling sun and a sleepy moon", "a teddy bear picnic",
  "a pizza with every topping", "a cat napping on a keyboard", "a sunrise over the sea", "a heart-shaped balloon",
  "a cozy rainy day", "a lucky four-leaf clover", "a bear in a bubble bath", "a chocolate fountain"
];

const emptyIndex = () => ({ days: {}, counts: { her: 0, sender: 0 } });

function normalizeIndex(value) {
  const index = emptyIndex();
  for (const [day, entry] of Object.entries(value?.days || {})) {
    if (!isValidDay(day) || !entry || typeof entry !== "object") continue;
    index.days[day] = {
      prompt: typeof entry.prompt === "string" ? entry.prompt : "",
      ...(entry.her ? { her: String(entry.her) } : {}),
      ...(entry.sender ? { sender: String(entry.sender) } : {})
    };
  }
  for (const author of AUTHORS) index.counts[author] = Math.max(0, Number(value?.counts?.[author]) || 0);
  return index;
}

export const promptFor = (index, day) => index.days[day]?.prompt || pickForDay(PROMPTS, day, "doodle");

// Checks the strokes from a page: { w: 0|1 (thin or thick pen), c: a palette colour,
// p: [x, y, x, y, …] whole numbers 0..1000 }. Returns a clean copy.
export function cleanStrokes(value) {
  if (!Array.isArray(value) || !value.length) throw new GameError(400, "Draw something first.");
  if (value.length > MAX_STROKES) throw new GameError(400, `That's more than ${MAX_STROKES} lines. Undo a few and try again.`);
  let points = 0;
  const strokes = value.map((stroke) => {
    if (!stroke || typeof stroke !== "object" || Array.isArray(stroke)) throw new GameError(400, "That drawing couldn't be read.");
    const colour = typeof stroke.c === "string" ? stroke.c.toLowerCase() : "";
    if (!PALETTE.includes(colour)) throw new GameError(400, "That drawing uses an unknown colour.");
    if (stroke.w !== 0 && stroke.w !== 1) throw new GameError(400, "That drawing uses an unknown pen size.");
    const path = stroke.p;
    if (!Array.isArray(path) || path.length < 2 || path.length % 2 !== 0) throw new GameError(400, "That drawing couldn't be read.");
    if (!path.every((n) => Number.isInteger(n) && n >= 0 && n <= CANVAS_SIZE)) throw new GameError(400, "That drawing couldn't be read.");
    points += path.length / 2;
    return { w: stroke.w, c: colour, p: path.slice() };
  });
  if (points > MAX_POINTS) throw new GameError(400, "That drawing is too detailed. Undo a few lines and try again.");
  if (JSON.stringify(strokes).length > MAX_BYTES) throw new GameError(400, "That drawing is too big. Undo a few lines and try again.");
  return strokes;
}

function drawingView(value) {
  if (!value || !Array.isArray(value.strokes)) return null;
  return { strokes: value.strokes, at: value.at || null };
}

// What `author` may see of `day`: their own drawing, and the other's only once they drew theirs.
async function view(txn, author, day, index = null) {
  const doc = index || normalizeIndex(await txn.get(INDEX_KEY));
  const entry = doc.days[day] || {};
  const mine = entry[author] ? drawingView(await txn.get(strokesKey(day, author))) : null;
  const theirsDone = Boolean(entry[other(author)]);
  const theirs = mine && theirsDone ? drawingView(await txn.get(strokesKey(day, other(author)))) : null;
  const history = Object.keys(doc.days).sort().reverse().slice(0, HISTORY_DAYS).map((item) => ({
    day: item,
    prompt: promptFor(doc, item),
    mine: Boolean(doc.days[item][author]),
    theirs: Boolean(doc.days[item][other(author)])
  }));
  return {
    day,
    prompt: promptFor(doc, day),
    mine,
    theirs,
    theirsDone,
    history,
    counts: { ...doc.counts }
  };
}

async function doodle(ctx) {
  if (ctx.method === "GET") {
    const author = parseAuthor(ctx.query("author"));
    const day = parseDay(ctx.query("day"), ctx.today);
    return ctx.storage.transaction((txn) => view(txn, author, day));
  }
  if (ctx.method !== "POST") throw new GameError(405, "Method not allowed.");
  const body = ctx.body || {};
  const author = parseAuthor(body.author);
  const day = ctx.today;
  // A drawing started before midnight belongs to yesterday's prompt.
  if (body.day !== undefined && body.day !== null && body.day !== "" && body.day !== day) {
    throw new GameError(409, "A new day just started, with a new prompt. Your drawing is still on the pad.", { day });
  }
  const strokes = cleanStrokes(body.strokes);
  return ctx.storage.transaction(async (txn) => {
    const index = normalizeIndex(await txn.get(INDEX_KEY));
    const entry = { ...(index.days[day] || {}) };
    if (entry[author]) throw new GameError(409, "You already drew today's doodle.");
    const at = ctx.now || new Date().toISOString();
    entry.prompt = promptFor(index, day);
    entry[author] = at;
    index.days[day] = entry;
    index.counts[author] += 1;
    await txn.put(strokesKey(day, author), { strokes, at });
    // Keep the last KEEP_DAYS days (and their drawings).
    const cutoff = addDays(day, -(KEEP_DAYS - 1));
    for (const old of Object.keys(index.days).filter((item) => item < cutoff)) {
      for (const person of AUTHORS) if (index.days[old][person]) await txn.delete(strokesKey(old, person));
      delete index.days[old];
    }
    await txn.put(INDEX_KEY, index);
    let awarded = await award(txn, `doodle:${day}:${author}`, author, DOODLE_HEART);
    awarded += await markActive(txn, author, day);
    return { ...(await view(txn, author, day, index)), awarded };
  });
}

export const routes = { "/games/doodle": doodle };

export async function summary(ctx) {
  const author = AUTHORS.includes(ctx.author) ? ctx.author : "her";
  const index = normalizeIndex(await ctx.storage.get(INDEX_KEY));
  const entry = index.days[ctx.today] || {};
  const mine = Boolean(entry[author]);
  const theirs = Boolean(entry[other(author)]);
  const prompt = promptFor(index, ctx.today);
  let status = "todo";
  let line = `Draw: ${prompt}`;
  if (mine && theirs) { status = "done"; line = "Both drawings are ready"; }
  else if (mine) { status = "waiting"; line = "Waiting for {them}"; }
  return {
    id: "doodle",
    title: "Daily doodle",
    icon: "brush",
    step: "doodle",
    status,
    line,
    board: [{ label: "Doodles drawn", her: index.counts.her, sender: index.counts.sender }]
  };
}
