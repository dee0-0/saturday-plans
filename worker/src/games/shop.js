// Love shop: rewards we set up ourselves and buy with the hearts we earn by playing.
// The other one makes a bought reward happen ("Done"); the buyer can cancel an open one
// and gets the hearts back. Shop actions never earn hearts and don't count as playing.
import { GameError, parseAuthor, cleanLine, cleanId, newId, other, pointsView, spend, refund, AUTHORS } from "./common.js";

const KEY = "games:shop";
const MAX_ITEMS = 40;
const MAX_PURCHASES = 200;
const MAX_TITLE = 60;
const MIN_COST = 1;
const MAX_COST = 500;
const ACTIONS = ["add", "remove", "buy", "done", "cancel"];
// The icons a reward can have (the page shows them as a picker).
export const SHOP_ICONS = [
  "gift", "heart", "hand-heart", "utensils", "croissant", "coffee", "cake-slice", "ice-cream-cone",
  "pizza", "clapperboard", "sofa", "sparkles", "flower-2", "music", "car", "moon"
];
const DEFAULT_ICON = "gift";

const sameTitle = (a, b) => a.toLowerCase() === b.toLowerCase();

function cleanItem(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || typeof value.title !== "string") return null;
  const cost = Math.round(Number(value.cost));
  if (!Number.isFinite(cost) || cost < MIN_COST) return null;
  return {
    id: value.id,
    title: value.title,
    cost,
    icon: SHOP_ICONS.includes(value.icon) ? value.icon : DEFAULT_ICON,
    author: AUTHORS.includes(value.author) ? value.author : "her",
    at: typeof value.at === "string" ? value.at : ""
  };
}

function cleanPurchase(value) {
  if (!value || typeof value !== "object" || typeof value.id !== "string" || !AUTHORS.includes(value.buyer)) return null;
  return {
    id: value.id,
    itemId: typeof value.itemId === "string" ? value.itemId : "",
    title: typeof value.title === "string" ? value.title : "A reward",
    cost: Math.max(0, Math.round(Number(value.cost) || 0)),
    icon: SHOP_ICONS.includes(value.icon) ? value.icon : DEFAULT_ICON,
    buyer: value.buyer,
    at: typeof value.at === "string" ? value.at : "",
    doneAt: typeof value.doneAt === "string" ? value.doneAt : null,
    doneBy: AUTHORS.includes(value.doneBy) ? value.doneBy : null
  };
}

function normalize(value) {
  return {
    items: (Array.isArray(value?.items) ? value.items : []).map(cleanItem).filter(Boolean),
    purchases: (Array.isArray(value?.purchases) ? value.purchases : []).map(cleanPurchase).filter(Boolean)
  };
}

const byTime = (field, newestFirst = true) => (a, b) => (newestFirst ? -1 : 1) * String(a[field]).localeCompare(String(b[field]));

// Cheapest first, so it's easy to see what we can afford; open purchases first (newest on top),
// then the ones that happened (most recent first).
async function view(txn, doc) {
  const items = [...doc.items].sort((a, b) => a.cost - b.cost || a.title.localeCompare(b.title));
  const open = doc.purchases.filter((item) => !item.doneAt).sort(byTime("at"));
  const done = doc.purchases.filter((item) => item.doneAt).sort(byTime("doneAt"));
  return { items, purchases: [...open, ...done], points: await pointsView(txn) };
}

function parseCost(value) {
  const cost = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (!Number.isInteger(cost) || cost < MIN_COST || cost > MAX_COST) {
    throw new GameError(400, `Choose a price between ${MIN_COST} and ${MAX_COST} hearts.`);
  }
  return cost;
}

async function shop(ctx) {
  if (ctx.method === "GET") {
    parseAuthor(ctx.query("author"));
    return ctx.storage.transaction(async (txn) => view(txn, normalize(await txn.get(KEY))));
  }
  if (ctx.method !== "POST") throw new GameError(405, "Method not allowed.");

  const body = ctx.body || {};
  const author = parseAuthor(body.author);
  if (!ACTIONS.includes(body.action)) throw new GameError(400, "Unknown action.");
  let input = {};
  if (body.action === "add") {
    input = {
      title: cleanLine(body.title, MAX_TITLE, `Give the reward a name (up to ${MAX_TITLE} characters).`),
      cost: parseCost(body.cost),
      icon: SHOP_ICONS.includes(body.icon) ? body.icon : DEFAULT_ICON
    };
  } else {
    input.id = cleanId(body.id, body.action === "remove" || body.action === "buy" ? "That reward is gone." : "That purchase is gone.");
  }

  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));

    if (body.action === "add") {
      if (doc.items.some((item) => sameTitle(item.title, input.title))) throw new GameError(409, "That reward is already in the shop.");
      if (doc.items.length >= MAX_ITEMS) throw new GameError(409, "The shop is full. Remove a reward first.");
      doc.items.push({ id: newId(), ...input, author, at: ctx.now });
    }

    if (body.action === "remove") {
      // Already gone counts as removed; bought ones keep their title in the purchases.
      doc.items = doc.items.filter((item) => item.id !== input.id);
    }

    if (body.action === "buy") {
      const item = doc.items.find((entry) => entry.id === input.id);
      if (!item) throw new GameError(404, "That reward is gone.");
      // Make room by dropping the oldest finished purchases; open ones are never dropped.
      const done = doc.purchases.filter((entry) => entry.doneAt).sort(byTime("doneAt", false));
      while (doc.purchases.length >= MAX_PURCHASES && done.length) {
        const oldest = done.shift();
        doc.purchases = doc.purchases.filter((entry) => entry !== oldest);
      }
      if (doc.purchases.length >= MAX_PURCHASES) throw new GameError(409, "Too many rewards are waiting. Make a few happen first.");
      await spend(txn, author, item.cost);
      doc.purchases.push({
        id: newId(), itemId: item.id, title: item.title, cost: item.cost, icon: item.icon,
        buyer: author, at: ctx.now, doneAt: null, doneBy: null
      });
    }

    if (body.action === "done" || body.action === "cancel") {
      const purchase = doc.purchases.find((entry) => entry.id === input.id);
      if (!purchase) throw new GameError(404, "That purchase is gone.");
      if (purchase.doneAt) throw new GameError(409, "This one already happened.");
      if (body.action === "done") {
        if (purchase.buyer === author) throw new GameError(403, "The other one makes this happen for you.");
        purchase.doneAt = ctx.now;
        purchase.doneBy = author;
      } else {
        if (purchase.buyer !== author) throw new GameError(403, "Only the one who bought it can cancel it.");
        doc.purchases = doc.purchases.filter((entry) => entry !== purchase);
        await refund(txn, author, purchase.cost);
      }
    }

    await txn.put(KEY, doc);
    return view(txn, doc);
  });
}

export const routes = { "/games/shop": shop };

// For the games hub: "new" when the other one bought something I should make happen.
export async function summary(ctx) {
  const doc = normalize(await ctx.storage.get(KEY));
  const points = await pointsView(ctx.storage);
  const me = AUTHORS.includes(ctx.author) ? ctx.author : "her";
  const owed = doc.purchases.filter((item) => !item.doneAt && item.buyer === other(me)).sort(byTime("at"));
  const balance = points[me].balance;
  return {
    id: "shop",
    title: "Love shop",
    icon: "shopping-bag",
    step: "shop",
    status: owed.length ? "new" : "idle",
    line: owed.length === 1
      ? `{them} bought: ${owed[0].title}`
      : owed.length > 1
        ? `{them} bought ${owed.length} rewards`
        : `${balance} ${balance === 1 ? "heart" : "hearts"} to spend`,
    board: []
  };
}
