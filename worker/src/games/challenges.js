// Weekly challenges with badges: three little challenges per week, the same on both phones.
// Each of us ticks our part "Done" (with an optional note and photo). When both did it, the
// challenge is complete: its badge unlocks and we both get hearts; all three of a week make
// a "Perfect week" with a bonus on top.
import {
  GameError, parseAuthor, cleanId, cleanText, award, markActive, seededShuffle, dayNumber, addDays,
  weekStart, isValidDay, AUTHORS, FIRST_GAME_DAY
} from "./common.js";

const KEY = "games:challenges";
const PER_WEEK = 3;
const MAX_WEEKS = 104;
const PAST_WEEKS = 8;
const MAX_NOTE = 200;
const ACTIONS = ["done", "undo"];
// Hearts for each of us: a challenge we both finished, and all three of a week on top.
export const COMPLETE_HEARTS = 3;
export const PERFECT_HEARTS = 5;
export const PERFECT_BADGE = { name: "Perfect week", icon: "crown" };
// The Monday of the week the games started in (week number 0).
const FIRST_WEEK = weekStart(FIRST_GAME_DAY);

// Cute things to do in a week, for two people who live apart on weekdays and meet on weekends.
// Only ever add to the END of this list and never change an id: past weeks keep their ids.
export const CHALLENGES = [
  { id: "pink-photo", title: "Send a photo of something pink", detail: "Spot something pink out in the world and send it over.", icon: "camera", badge: { name: "Pink spotter", icon: "flower" } },
  { id: "three-compliments", title: "Compliment each other 3 times", detail: "Three real compliments this week. Make them count.", icon: "message-circle-heart", badge: { name: "Sweet talker", icon: "heart" } },
  { id: "new-food", title: "Try a food you've never had", detail: "Order or cook something new and tell the other how it was.", icon: "utensils", badge: { name: "Brave taster", icon: "chef-hat" } },
  { id: "selfie-together", title: "Take a selfie together", detail: "Next time we meet, snap one together. Silly faces allowed.", icon: "camera", badge: { name: "Picture perfect", icon: "image" } },
  { id: "cook-together", title: "Cook something together", detail: "Pick a recipe and make it as a team this weekend.", icon: "cooking-pot", badge: { name: "Kitchen crew", icon: "chef-hat" } },
  { id: "sunset", title: "Watch the sunset", detail: "Together, or apart at the same time. Send a photo of yours.", icon: "sunset", badge: { name: "Golden hour", icon: "sun" } },
  { id: "little-poem", title: "Write a 3-line poem for each other", detail: "Three lines, any style. Rhymes optional, love required.", icon: "feather", badge: { name: "Little poets", icon: "pen-tool" } },
  { id: "good-morning", title: "Say good morning first", detail: "Be the first to say good morning on one day this week.", icon: "sunrise", badge: { name: "Early birds", icon: "bird" } },
  { id: "voice-note", title: "Send a voice message", detail: "Record a little voice note instead of typing.", icon: "mic", badge: { name: "Sweet voices", icon: "audio-lines" } },
  { id: "our-song", title: "Share a song that reminds you of us", detail: "Send one song and tell the other why.", icon: "music", badge: { name: "Mixtape", icon: "disc-3" } },
  { id: "walk-together", title: "Go for a walk together", detail: "A slow walk with no destination needed.", icon: "footprints", badge: { name: "Wanderers", icon: "map" } },
  { id: "throwback", title: "Send an old photo of us", detail: "Dig a favorite memory out of your camera roll.", icon: "images", badge: { name: "Memory keepers", icon: "book-heart" } },
  { id: "breakfast-together", title: "Have breakfast together", detail: "At the same table, or on a video call.", icon: "coffee", badge: { name: "Breakfast club", icon: "croissant" } },
  { id: "thank-you", title: "Say thank you for something small", detail: "Thank each other for one little thing the other did.", icon: "hand-heart", badge: { name: "Grateful hearts", icon: "heart-handshake" } },
  { id: "sky-photo", title: "Send a photo of the sky", detail: "Wherever you are, look up and share it.", icon: "cloud-sun", badge: { name: "Sky watchers", icon: "cloud" } },
  { id: "tiny-surprise", title: "Plan a tiny surprise", detail: "A snack, a note, a little something for the next time we meet.", icon: "gift", badge: { name: "Surprise squad", icon: "party-popper" } },
  { id: "goodnight-call", title: "Call before falling asleep", detail: "One good-night call this week.", icon: "phone", badge: { name: "Night owls", icon: "moon" } },
  { id: "dance", title: "Dance together to one song", detail: "Kitchen, living room, anywhere. One full song.", icon: "music-2", badge: { name: "Dance partners", icon: "sparkles" } },
  { id: "favorite-thing", title: "Name your favorite thing about each other", detail: "Say it out loud or write it down.", icon: "star", badge: { name: "Biggest fans", icon: "star" } },
  { id: "new-place", title: "Visit a place we've never been", detail: "A café, a park, a street. New for both of us.", icon: "map-pin", badge: { name: "Explorers", icon: "compass" } },
  { id: "no-phones", title: "Spend an hour without phones", detail: "One hour together with both phones out of sight.", icon: "phone-off", badge: { name: "Unplugged", icon: "hourglass" } },
  { id: "share-dessert", title: "Share a dessert", detail: "One dessert, two spoons.", icon: "cake-slice", badge: { name: "Sweet tooth", icon: "ice-cream-cone" } },
  { id: "game-night", title: "Play a game together", detail: "A board game, a card game, or one of ours in here.", icon: "dices", badge: { name: "Game night", icon: "gamepad-2" } },
  { id: "hidden-note", title: "Hide a little note for the other", detail: "On paper, somewhere the other will find it.", icon: "mail", badge: { name: "Love letters", icon: "mail-open" } },
  { id: "movie-together", title: "Watch a movie together", detail: "Same couch, or the same time on two screens.", icon: "clapperboard", badge: { name: "Movie buffs", icon: "popcorn" } },
  { id: "give-flower", title: "Give each other a flower", detail: "Picked, bought or drawn. Every flower counts.", icon: "flower-2", badge: { name: "Flower power", icon: "flower" } },
  { id: "outfit-day", title: "Show your outfit of the day", detail: "Send a mirror picture of your look one day.", icon: "shirt", badge: { name: "Style icons", icon: "sparkles" } },
  { id: "lunch-photo", title: "Send a photo of your lunch", detail: "Show what you ate today, fancy or not.", icon: "sandwich", badge: { name: "Lunch buddies", icon: "utensils" } },
  { id: "stars", title: "Look at the stars", detail: "Find a clear night and look up. Together counts double.", icon: "moon-star", badge: { name: "Stargazers", icon: "star" } },
  { id: "dream-trip", title: "Plan a dream trip", detail: "Pick a place you'd love to visit together one day.", icon: "plane", badge: { name: "Dreamers", icon: "globe" } },
  { id: "bake", title: "Bake something", detail: "Cookies, a cake, banana bread. Share it or show it.", icon: "cookie", badge: { name: "Bake off", icon: "cake" } },
  { id: "long-hug", title: "Give one extra-long hug", detail: "At least 20 seconds. Count it out loud.", icon: "heart-handshake", badge: { name: "Hug champions", icon: "heart" } },
  { id: "favorite-memory", title: "Tell your favorite memory of us", detail: "Share the moment you'd love to live again.", icon: "book-heart", badge: { name: "Storytellers", icon: "book-open" } },
  { id: "draw-each-other", title: "Draw each other", detail: "Quick portraits. No talent needed.", icon: "pencil", badge: { name: "Portrait artists", icon: "palette" } },
  { id: "playlist", title: "Make a playlist for the other", detail: "Five songs, picked just for them.", icon: "list-music", badge: { name: "DJ duo", icon: "headphones" } },
  { id: "picnic", title: "Have a picnic", detail: "A blanket, snacks and sunshine (or the living room floor).", icon: "apple", badge: { name: "Picnic pros", icon: "sun" } },
  { id: "cozy-night", title: "Have a cozy night in", detail: "Blankets, tea and something nice to watch.", icon: "sofa", badge: { name: "Cozy club", icon: "coffee" } },
  { id: "favorite-snack", title: "Bring the other their favorite snack", detail: "Show up with exactly the right thing.", icon: "popcorn", badge: { name: "Snack heroes", icon: "candy" } },
  { id: "daily-questions", title: "Answer the daily question 5 times", detail: "Each of us, on five days this week.", icon: "message-circle-heart", badge: { name: "Deep talkers", icon: "message-square-heart" } },
  { id: "heart-hunt", title: "Find a heart shape out there", detail: "A leaf, a cloud, a puddle. Snap a heart you find.", icon: "search", badge: { name: "Heart hunters", icon: "heart" } },
  { id: "new-word", title: "Learn a word in a new language", detail: "Teach the other the word you learned.", icon: "languages", badge: { name: "Word nerds", icon: "book-a" } },
  { id: "workout", title: "Work out together", detail: "A run, a home workout or a long bike ride.", icon: "dumbbell", badge: { name: "Fit together", icon: "bike" } },
  { id: "coffee-date", title: "Go on a coffee date", detail: "Find a café and take your time.", icon: "coffee", badge: { name: "Coffee lovers", icon: "cup-soda" } },
  { id: "future-plans", title: "Talk about our future plans", detail: "Share one thing you'd love to do together this year.", icon: "calendar-heart", badge: { name: "Future planners", icon: "calendar-check" } },
  { id: "kind-act", title: "Do something kind for a stranger", detail: "Hold a door, buy a coffee, leave a nice note.", icon: "hand-heart", badge: { name: "Kind souls", icon: "sparkles" } },
  { id: "cute-animal", title: "Send a photo of a cute animal", detail: "A dog, a cat in a window, a pigeon with attitude.", icon: "dog", badge: { name: "Animal spotters", icon: "cat" } },
  { id: "laugh", title: "Make each other laugh out loud", detail: "A joke, a meme, a silly face. Real laughs only.", icon: "laugh", badge: { name: "Comedians", icon: "smile" } },
  { id: "jar-ideas", title: "Drop 3 ideas in our jar", detail: "Each of us adds three date ideas to the ideas jar.", icon: "lightbulb", badge: { name: "Idea machines", icon: "lightbulb" } },
  { id: "book-club", title: "Read the same thing", detail: "A chapter, an article or a poem. Then talk about it.", icon: "book-open", badge: { name: "Book club", icon: "library" } },
  { id: "sing", title: "Sing a song to each other", detail: "Off-key is the best key.", icon: "mic-vocal", badge: { name: "Duet stars", icon: "music-4" } },
  { id: "your-view", title: "Send a photo of your view", detail: "Show the other what you're looking at right now.", icon: "mountain-snow", badge: { name: "Window views", icon: "mountain" } },
  { id: "nickname", title: "Come up with a new nickname", detail: "Invent a cute new nickname for each other.", icon: "tag", badge: { name: "Name givers", icon: "badge" } },
  { id: "plan-next-date", title: "Plan our next date", detail: "Pick the next date together right here in the letter.", icon: "calendar-days", badge: { name: "Date planners", icon: "calendar-heart" } },
  { id: "breakfast-for-you", title: "Make breakfast for the other", detail: "Coffee and toast totally counts.", icon: "egg-fried", badge: { name: "Morning chefs", icon: "sunrise" } },
  { id: "first-messages", title: "Read our first messages again", detail: "Scroll back to the very beginning and share a favorite.", icon: "message-square-heart", badge: { name: "Time travelers", icon: "history" } },
  { id: "tidy-up", title: "Tidy up together", detail: "Twenty minutes, one room, two people, music on.", icon: "spray-can", badge: { name: "Clean team", icon: "sparkles" } },
  { id: "ice-cream", title: "Get ice cream", detail: "Any weather, any flavor.", icon: "ice-cream-cone", badge: { name: "Scoop squad", icon: "ice-cream-bowl" } },
  { id: "make-a-wish", title: "Make a wish together", detail: "At 11:11, on a shooting star or with a dandelion.", icon: "wand-sparkles", badge: { name: "Wish makers", icon: "sparkles" } },
  { id: "then-and-now", title: "Recreate an old photo of us", detail: "Pick an old picture and pose it again.", icon: "images", badge: { name: "Then and now", icon: "camera" } },
  { id: "love-list", title: "Write 3 things you love about us", detail: "Swap the lists when we meet.", icon: "list-checks", badge: { name: "List lovers", icon: "heart" } },
  { id: "adventure", title: "Go on a little adventure", detail: "A bike ride, a hike or a train to somewhere new.", icon: "bike", badge: { name: "Adventurers", icon: "mountain" } },
  { id: "puzzle", title: "Solve a puzzle together", detail: "A jigsaw, a crossword or a tricky riddle.", icon: "puzzle", badge: { name: "Puzzle masters", icon: "brain" } },
  { id: "teach-something", title: "Teach each other something", detail: "A recipe, a skill, a trick. Five minutes is enough.", icon: "graduation-cap", badge: { name: "Little teachers", icon: "school" } },
  { id: "spa-night", title: "Have a spa night", detail: "Face masks, candles and slow music.", icon: "bath", badge: { name: "Self-care stars", icon: "sparkle" } },
  { id: "pizza-night", title: "Make a pizza night", detail: "Homemade or delivered. Each of us picks a topping.", icon: "pizza", badge: { name: "Pizza party", icon: "party-popper" } },
  { id: "leaf-photo", title: "Collect something from nature", detail: "A leaf, a stone, a flower. Show it to the other.", icon: "leaf", badge: { name: "Nature lovers", icon: "tree-pine" } }
];
const BY_ID = new Map(CHALLENGES.map((item) => [item.id, item]));

// Weeks since the games started (0 = the week of January 1, 2026).
const weekNumber = (monday) => Math.round((dayNumber(monday) - dayNumber(FIRST_WEEK)) / 7);

// The week's challenges: one fixed shuffle of the whole list per cycle, three per week,
// so nothing repeats until every challenge had its turn. The same on every phone.
export function pickWeek(monday) {
  const perCycle = Math.max(1, Math.floor(CHALLENGES.length / PER_WEEK));
  const number = weekNumber(monday);
  const cycle = Math.floor(number / perCycle);
  const slot = number - cycle * perCycle;
  const order = seededShuffle(CHALLENGES.map((item) => item.id), `challenges:${cycle}`);
  return order.slice(slot * PER_WEEK, slot * PER_WEEK + PER_WEEK);
}

// Days left this week, counting today: 7 on Monday, 1 on Sunday.
export const daysLeft = (today, monday) => Math.max(1, 7 - (dayNumber(today) - dayNumber(monday)));
const daysLeftText = (count) => (count <= 1 ? "last day" : `${count} days left`);

function info(id) {
  return BY_ID.get(id) || { id, title: "A little challenge", detail: "", icon: "badge-check", badge: { name: "Challenge done", icon: "award" } };
}

function cleanPart(value) {
  if (!value || typeof value !== "object" || typeof value.at !== "string") return null;
  return {
    at: value.at,
    note: typeof value.note === "string" ? value.note : "",
    mediaId: typeof value.mediaId === "string" && value.mediaId ? value.mediaId : null
  };
}

function normalize(value) {
  const weeks = {};
  for (const [monday, week] of Object.entries(value?.weeks || {})) {
    if (!isValidDay(monday) || !Array.isArray(week?.ids)) continue;
    const ids = week.ids.filter((id) => typeof id === "string").slice(0, PER_WEEK);
    const done = {};
    for (const id of ids) {
      const parts = Object.fromEntries(AUTHORS.map((author) => [author, cleanPart(week.done?.[id]?.[author])]).filter(([, part]) => part));
      if (Object.keys(parts).length) done[id] = parts;
    }
    weeks[monday] = { ids, done };
  }
  return { weeks };
}

// Stores the week's picks the first time anyone opens it, so they never change afterwards.
function ensureWeek(doc, monday) {
  if (doc.weeks[monday]) return false;
  doc.weeks[monday] = { ids: pickWeek(monday), done: {} };
  const keys = Object.keys(doc.weeks).sort();
  for (const old of keys.slice(0, Math.max(0, keys.length - MAX_WEEKS))) delete doc.weeks[old];
  return true;
}

const isComplete = (done) => AUTHORS.every((author) => Boolean(done?.[author]?.at));
const latest = (values) => values.filter(Boolean).sort().pop() || null;

function weekView(monday, week) {
  const challenges = week.ids.map((id) => {
    const item = info(id);
    const done = week.done[id] || {};
    const complete = isComplete(done);
    return {
      id,
      title: item.title,
      detail: item.detail,
      icon: item.icon,
      badge: { ...item.badge },
      done: { her: done.her ? { ...done.her } : null, sender: done.sender ? { ...done.sender } : null },
      complete,
      completedAt: complete ? latest([done.her.at, done.sender.at]) : null
    };
  });
  const perfect = challenges.length === PER_WEEK && challenges.every((item) => item.complete);
  return { challenges, perfect, perfectAt: perfect ? latest(challenges.map((item) => item.completedAt)) : null };
}

function challengeBadge(monday, challenge) {
  return { id: `${monday}:${challenge.id}`, name: challenge.badge.name, icon: challenge.badge.icon, at: challenge.completedAt, week: monday, challenge: challenge.title };
}

function perfectBadge(monday, at) {
  return { id: `${monday}:perfect`, name: PERFECT_BADGE.name, icon: PERFECT_BADGE.icon, at, week: monday, challenge: "All three challenges of a week" };
}

const isPerfectBadge = (badge) => badge.id.endsWith(":perfect");

// Every badge we unlocked, newest first (a perfect week before the challenge that made it).
function badgesOf(doc) {
  const badges = [];
  for (const [monday, week] of Object.entries(doc.weeks)) {
    const view = weekView(monday, week);
    for (const challenge of view.challenges) if (challenge.complete) badges.push(challengeBadge(monday, challenge));
    if (view.perfect) badges.push(perfectBadge(monday, view.perfectAt));
  }
  return badges.sort((a, b) => String(b.at).localeCompare(String(a.at))
    || Number(isPerfectBadge(b)) - Number(isPerfectBadge(a))
    || b.id.localeCompare(a.id));
}

function view(doc, ctx) {
  const current = weekView(ctx.week, doc.weeks[ctx.week]);
  const past = Object.keys(doc.weeks).filter((monday) => monday < ctx.week).sort().reverse().slice(0, PAST_WEEKS).map((monday) => {
    const week = weekView(monday, doc.weeks[monday]);
    return {
      week: monday,
      weekEnd: addDays(monday, 6),
      challenges: week.challenges.map((item) => ({
        id: item.id,
        title: item.title,
        icon: item.icon,
        complete: item.complete,
        done: { her: Boolean(item.done.her), sender: Boolean(item.done.sender) }
      })),
      completed: week.challenges.filter((item) => item.complete).length,
      perfect: week.perfect
    };
  });
  const badges = badgesOf(doc);
  return {
    week: ctx.week,
    weekEnd: addDays(ctx.week, 6),
    today: ctx.today,
    daysLeft: daysLeft(ctx.today, ctx.week),
    challenges: current.challenges,
    perfect: current.perfect,
    past,
    badges,
    stats: {
      completed: badges.filter((badge) => !isPerfectBadge(badge)).length,
      perfectWeeks: badges.filter(isPerfectBadge).length
    }
  };
}

function cleanMediaId(value) {
  if (value === undefined || value === null || value === "") return null;
  return cleanId(value, "That photo didn’t come through. Try adding it again.");
}

async function challenges(ctx) {
  if (ctx.method === "GET") {
    parseAuthor(ctx.query("author"));
    return ctx.storage.transaction(async (txn) => {
      const doc = normalize(await txn.get(KEY));
      if (ensureWeek(doc, ctx.week)) await txn.put(KEY, doc);
      return view(doc, ctx);
    });
  }
  if (ctx.method !== "POST") throw new GameError(405, "Method not allowed.");

  const body = ctx.body || {};
  const author = parseAuthor(body.author);
  if (!ACTIONS.includes(body.action)) throw new GameError(400, "Unknown action.");
  const id = cleanId(body.id, "That challenge is gone.");
  const note = body.action === "done" ? cleanText(body.note, MAX_NOTE, `Keep the note under ${MAX_NOTE} characters.`, { optional: true }) : "";
  const mediaId = body.action === "done" ? cleanMediaId(body.mediaId) : null;

  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    ensureWeek(doc, ctx.week);
    const week = doc.weeks[ctx.week];
    if (!week.ids.includes(id)) throw new GameError(409, "That challenge isn’t on this week’s list anymore.");
    const done = { ...(week.done[id] || {}) };
    if (isComplete(done)) throw new GameError(409, "You both did this one already.");

    let awarded = 0;
    const unlocked = [];
    if (body.action === "undo") {
      if (!done[author]) return { ...view(doc, ctx), awarded: 0, unlocked };
      delete done[author];
      if (Object.keys(done).length) week.done[id] = done;
      else delete week.done[id];
      await txn.put(KEY, doc);
      return { ...view(doc, ctx), awarded: 0, unlocked };
    }

    // Done again before the other one is: the note and photo are replaced, the time is kept.
    done[author] = { at: done[author]?.at || ctx.now, note, mediaId };
    week.done[id] = done;
    await txn.put(KEY, doc);
    awarded += await markActive(txn, author, ctx.today);
    const current = weekView(ctx.week, week);
    if (isComplete(done)) {
      for (const person of AUTHORS) {
        const delta = await award(txn, `challenges:${ctx.week}:${id}:${person}`, person, COMPLETE_HEARTS);
        if (person === author) awarded += delta;
      }
      unlocked.push(challengeBadge(ctx.week, current.challenges.find((item) => item.id === id)));
      if (current.perfect) {
        for (const person of AUTHORS) {
          const delta = await award(txn, `challenges:${ctx.week}:perfect:${person}`, person, PERFECT_HEARTS);
          if (person === author) awarded += delta;
        }
        unlocked.push(perfectBadge(ctx.week, current.perfectAt));
      }
    }
    return { ...view(doc, ctx), awarded, unlocked };
  });
}

export const routes = { "/games/challenges": challenges };

// For the games hub: this week's progress, the number of challenges done and every badge.
export async function summary(ctx) {
  const doc = normalize(await ctx.storage.get(KEY));
  const week = doc.weeks[ctx.week] || { ids: pickWeek(ctx.week), done: {} };
  const current = weekView(ctx.week, week);
  const completed = current.challenges.filter((item) => item.complete).length;
  const needsMe = current.challenges.some((item) => !item.done[ctx.author]);
  const badges = badgesOf(doc);
  return {
    id: "challenges",
    title: "Weekly challenges",
    icon: "badge-check",
    step: "challenges",
    status: current.perfect ? "done" : needsMe ? "todo" : "waiting",
    line: current.perfect
      ? "Perfect week! All 3 done"
      : `${completed} of ${current.challenges.length} done this week · ${daysLeftText(daysLeft(ctx.today, ctx.week))}`,
    board: [{ label: "Challenges done", value: String(badges.filter((badge) => !isPerfectBadge(badge)).length) }],
    badges
  };
}
