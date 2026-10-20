// Daily match: 5 quick this-or-that picks a day for both of us. A day's pairs are chosen
// the first time either of us opens it and never change. Your picks show to the other
// only once they played too; then both see the match score ("4 of 5 the same"),
// our compatibility over every day we both played, and a match streak.
import { GameError, AUTHORS, parseAuthor, parseDay, award, markActive, other, addDays, seededShuffle } from "./common.js";

const KEY = "games:match";
const MAX_DAYS = 400;
const PAIRS_PER_DAY = 5;
const HISTORY_DAYS = 14;
// A day keeps the match streak going when we picked the same at least this often.
const STREAK_MIN_SAME = 3;
const PLAY_HEARTS = 1;
const PERFECT_BONUS = 2;

// [left, right, left icon, right icon] with lucide icon names. Grouped by theme here;
// days take them in a fixed shuffled order, so every day mixes themes.
export const PAIRS = [
  // Food and drinks
  ["Sweet", "Salty", "candy", "popcorn"],
  ["Coffee", "Tea", "coffee", "leaf"],
  ["Pizza", "Burger", "pizza", "hamburger"],
  ["Pancakes", "Waffles", "layers-2", "grid-3x3"],
  ["Chocolate", "Vanilla", "candy", "ice-cream-cone"],
  ["Ice cream", "Cake", "ice-cream-cone", "cake"],
  ["Sushi", "Pasta", "fish", "utensils"],
  ["Big breakfast", "Just coffee", "egg-fried", "coffee"],
  ["Cook at home", "Eat out", "cooking-pot", "store"],
  ["Spicy", "Mild", "flame", "leaf"],
  ["Wine", "Beer", "wine", "beer"],
  ["Cocktail", "Mocktail", "martini", "glass-water"],
  ["Burger", "Salad", "hamburger", "salad"],
  ["Croissant", "Bagel", "croissant", "donut"],
  ["Donut", "Cupcake", "donut", "cupcake"],
  ["Apples", "Bananas", "apple", "banana"],
  ["Grapes", "Cherries", "grape", "cherry"],
  ["Lemonade", "Iced tea", "citrus", "glass-water"],
  ["Hot chocolate", "Milkshake", "coffee", "milk"],
  ["Soup", "Sandwich", "soup", "sandwich"],
  ["Brunch", "Late dinner", "egg-fried", "moon-star"],
  ["Takeout", "Home-cooked", "package", "chef-hat"],
  ["Cereal", "Toast", "milk", "sandwich"],
  ["Pineapple on pizza", "Never", "pizza", "ban"],
  ["Sparkling water", "Still water", "bubbles", "glass-water"],
  ["Carrots", "Broccoli", "carrot", "broccoli"],
  ["Steak", "Fish", "beef", "fish"],
  ["Cookies", "Brownies", "cookie", "cake-slice"],
  ["Popsicle", "Ice cream cup", "popsicle", "ice-cream-bowl"],
  ["Fast food", "Fancy dinner", "hamburger", "wine"],
  ["Picnic", "Restaurant", "shopping-basket", "utensils"],
  ["Smoothie", "Fresh juice", "cup-soda", "citrus"],
  ["Ice in drinks", "No ice", "snowflake", "glass-water"],
  ["Lasagna", "Spaghetti", "layers", "utensils"],
  ["Honey", "Jam", "hexagon", "cherry"],
  ["Scrambled eggs", "Fried eggs", "egg", "egg-fried"],
  ["Peanut butter", "Chocolate spread", "nut", "candy"],
  ["Dessert first", "Dinner first", "dessert", "fork-knife"],
  ["Fondue", "Raclette", "cooking-pot", "flame"],
  ["Hot chocolate", "Mulled wine", "coffee", "wine"],
  ["Bubble tea", "Iced coffee", "cup-soda", "coffee"],
  ["Sushi", "Ramen", "fish", "soup"],
  ["Breakfast for dinner", "Pizza for breakfast", "egg-fried", "pizza"],
  ["Leftovers", "Cook fresh", "refrigerator", "chef-hat"],
  ["Bake cookies", "Buy cookies", "cookie", "store"],
  ["Strawberries", "Blueberries", "cherry", "grape"],
  ["Popcorn", "Nachos", "popcorn", "triangle"],
  ["Ketchup", "Mayo", "droplet", "droplets"],
  ["Pizza night", "Taco night", "pizza", "utensils-crossed"],
  ["Milk chocolate", "Dark chocolate", "candy", "candy-off"],
  ["Cheese board", "Fruit bowl", "slice", "apple"],
  ["Waffles", "Crepes", "grid-3x3", "circle"],
  ["Cappuccino", "Latte", "coffee", "milk"],
  ["Gummy bears", "Chocolate bar", "candy", "candy-cane"],
  ["Hot soup", "Cold salad", "soup", "salad"],
  ["Fries", "Mashed potatoes", "flame", "cooking-pot"],
  ["Mango", "Pineapple", "citrus", "tree-palm"],
  ["Cake", "Pie", "cake", "pie-chart"],
  ["Cinnamon roll", "Muffin", "cookie", "cupcake"],
  ["Pretzels", "Chips", "infinity", "popcorn"],
  ["Breakfast in bed", "Breakfast in a cafe", "bed-double", "coffee"],

  // Seasons, weather and time of day
  ["Summer", "Winter", "sun", "snowflake"],
  ["Spring", "Autumn", "flower-2", "leaf"],
  ["Sunrise", "Sunset", "sunrise", "sunset"],
  ["Rain", "Snow", "cloud-rain", "cloud-snow"],
  ["Morning", "Night", "sun", "moon"],
  ["Early bird", "Night owl", "sunrise", "moon-star"],
  ["Thunderstorm", "Sunny day", "cloud-lightning", "sun"],
  ["Hot weather", "Cold weather", "thermometer-sun", "thermometer-snowflake"],
  ["Christmas", "Birthday", "tree-pine", "cake"],
  ["Halloween", "Easter", "ghost", "egg"],
  ["New Year's Eve", "Valentine's Day", "party-popper", "heart"],
  ["Rainy day inside", "Sunny day outside", "umbrella", "sun"],
  ["Foggy morning", "Windy evening", "cloud-fog", "wind"],
  ["Stargazing", "Cloud watching", "telescope", "cloud"],
  ["Snowman", "Sandcastle", "snowflake", "castle"],
  ["Full moon", "Starry sky", "moon", "stars"],
  ["Rainbow", "Shooting star", "rainbow", "sparkle"],
  ["First snow", "First warm day", "cloud-snow", "sun"],
  ["Sleep in", "Up early", "bed", "sunrise"],
  ["Weekday date", "Weekend date", "calendar", "calendar-heart"],
  ["Christmas market", "Summer festival", "tree-pine", "tickets"],
  ["Autumn walk", "Spring picnic", "leaf", "flower"],
  ["Cozy winter night", "Warm summer night", "snowflake", "moon-star"],
  ["Hot summer", "Snowy winter", "thermometer-sun", "snowflake"],

  // Places and travel
  ["Beach", "City", "tree-palm", "building-2"],
  ["Mountains", "Sea", "mountain", "waves"],
  ["Road trip", "Flight", "car", "plane"],
  ["Camping", "Hotel", "tent", "hotel"],
  ["Train", "Car", "train-front", "car-front"],
  ["Window seat", "Aisle seat", "plane-takeoff", "armchair"],
  ["Backpack", "Suitcase", "backpack", "luggage"],
  ["Pack light", "Pack everything", "backpack", "luggage"],
  ["Paper map", "Phone GPS", "map", "navigation"],
  ["Get lost in a city", "Guided tour", "compass", "flag"],
  ["Souvenirs", "Photos", "gift", "camera"],
  ["Postcards", "Selfies", "mail", "smartphone"],
  ["Museum", "Shopping", "landmark", "shopping-bag"],
  ["Island", "Snowy cabin", "tree-palm", "mountain-snow"],
  ["Lake", "Ocean", "droplets", "waves"],
  ["Forest", "Desert", "trees", "sun"],
  ["Waterfall", "Volcano", "droplets", "mountain"],
  ["Lake swim", "Pool swim", "waves", "waves-ladder"],
  ["Hot springs", "Cold plunge", "bath", "snowflake"],
  ["Train ride", "Boat ride", "train-front", "ship"],
  ["Cable car", "Hike up", "cable-car", "footprints"],
  ["Big city trip", "Tiny village trip", "building-2", "house"],
  ["Sunny beach", "Snowy mountain", "tree-palm", "mountain-snow"],
  ["Hotel breakfast", "Cafe around the corner", "hotel", "coffee"],
  ["Plan the trip", "Pack the bags", "list-checks", "luggage"],
  ["Driver", "DJ in the car", "car", "list-music"],
  ["Navigator", "Driver", "map", "car"],
  ["Long trip", "Many short trips", "plane", "calendar-days"],
  ["Abroad", "Explore nearby", "globe", "map-pin"],
  ["Night train", "Morning flight", "train-front", "plane-takeoff"],
  ["Treehouse", "Lighthouse", "trees", "lighthouse"],
  ["Castle", "Boat", "castle", "sailboat"],
  ["Tiny house", "Big villa", "house", "building"],
  ["City apartment", "Country house", "building", "house"],
  ["Our first date spot", "Somewhere new", "map-pin-check", "compass"],
  ["Rooftop bar", "Cozy pub", "building-2", "beer"],
  ["Big hotel", "Little guesthouse", "hotel", "house-heart"],
  ["Tent", "Camper van", "tent", "caravan"],
  ["Boat trip", "Bike tour", "sailboat", "bike"],
  ["Sightseeing", "Relaxing", "camera", "sofa"],

  // Things to do together
  ["Movie night", "Game night", "clapperboard", "dices"],
  ["Movie at home", "Cinema", "tv", "film"],
  ["Dancing", "Karaoke", "music", "mic-vocal"],
  ["Museum", "Zoo", "landmark", "paw-print"],
  ["Hiking", "Biking", "footprints", "bike"],
  ["Swimming", "Skiing", "waves", "mountain-snow"],
  ["Bowling", "Mini golf", "circle-dot", "flag"],
  ["Concert", "Theater", "guitar", "drama"],
  ["Board games", "Video games", "dices", "gamepad-2"],
  ["Spa day", "Adventure day", "bath", "compass"],
  ["Stay in", "Go out", "sofa", "door-open"],
  ["Cook together", "Bake together", "cooking-pot", "cake"],
  ["Puzzle", "Card game", "puzzle", "playing-cards"],
  ["Escape room", "Arcade", "key", "joystick"],
  ["Ice skating", "Sledding", "snowflake", "mountain-snow"],
  ["Amusement park", "Water park", "roller-coaster", "waves"],
  ["Ferris wheel", "Roller coaster", "ferris-wheel", "roller-coaster"],
  ["Kayak", "Sailboat", "kayak", "sailboat"],
  ["Yoga", "Gym", "person-standing", "dumbbell"],
  ["Jogging", "Long walk", "timer", "footprints"],
  ["Bookstore", "Flower market", "book-open", "flower"],
  ["Farmers market", "Mall", "carrot", "shopping-bag"],
  ["Photo booth", "Selfie", "camera", "smartphone"],
  ["Painting", "Pottery", "palette", "amphora"],
  ["Zoo", "Aquarium", "paw-print", "fish"],
  ["Camping", "Glamping", "tent", "sparkles"],
  ["Theme park", "Festival", "roller-coaster", "tickets"],
  ["Stargazing", "Sunrise hike", "telescope", "sunrise"],
  ["Picnic", "Brunch", "shopping-basket", "croissant"],
  ["Candlelight dinner", "Picnic under the stars", "flame", "stars"],
  ["Dance in the kitchen", "Dance in the rain", "cooking-pot", "cloud-rain"],
  ["Sleep in a tent", "Sleep under the stars", "tent", "stars"],
  ["Cozy weekend", "Adventure weekend", "sofa", "compass"],
  ["Big group", "Just us two", "users", "heart"],
  ["Party", "Quiet night", "party-popper", "moon"],
  ["Tickle fight", "Pillow fight", "hand", "cloud"],
  ["Snowball fight", "Water fight", "snowflake", "droplets"],
  ["Window shopping", "Real shopping", "store", "shopping-cart"],
  ["Cuddle on the couch", "Walk outside", "sofa", "trees"],
  ["Beach volleyball", "Frisbee", "volleyball", "disc"],
  ["Karaoke duet", "Karaoke solo", "users", "mic-vocal"],
  ["Paint each other", "Photograph each other", "palette", "camera"],
  ["Sunset walk", "Sunrise coffee", "sunset", "coffee"],
  ["Bike ride", "Boat ride", "bike", "sailboat"],
  ["Gardening", "Baking", "sprout", "cake"],
  ["Fishing", "Birdwatching", "fishing-rod", "binoculars"],
  ["Comedy show", "Magic show", "laugh", "wand-sparkles"],
  ["Live music", "Silent disco", "guitar", "headphones"],
  ["Hot air balloon", "Helicopter ride", "wind", "helicopter"],

  // Home and habits
  ["Cats", "Dogs", "cat", "dog"],
  ["Bunny", "Turtle", "rabbit", "turtle"],
  ["Hot shower", "Cold shower", "flame", "snowflake"],
  ["Bath", "Shower", "bath", "shower-head"],
  ["Alarm clock", "Wake up naturally", "alarm-clock", "sun"],
  ["Snooze", "Up right away", "alarm-clock-off", "zap"],
  ["Plants", "Pets", "sprout", "paw-print"],
  ["Candles", "Fairy lights", "flame", "sparkles"],
  ["Tidy", "Cozy chaos", "sparkles", "shapes"],
  ["Movie on the couch", "Movie in bed", "sofa", "bed-double"],
  ["Pajamas all day", "Dressed up", "moon", "shirt"],
  ["Do the dishes", "Do the laundry", "utensils", "washing-machine"],
  ["Cook", "Clean up after", "chef-hat", "sparkles"],
  ["Early to bed", "Late to bed", "bed", "moon-star"],
  ["Lights on", "Lights off", "lightbulb", "lightbulb-off"],
  ["Silence", "Music on", "volume-x", "music"],
  ["Heater", "Big blanket", "heater", "bed"],
  ["Window open at night", "Window closed", "wind", "door-closed"],
  ["Socks in bed", "No socks", "footprints", "ban"],
  ["One big blanket", "Two blankets", "bed-double", "layers"],
  ["Soft pillow", "Firm pillow", "cloud", "square"],
  ["Left side of the bed", "Right side", "arrow-left", "arrow-right"],
  ["Vacuum", "Mop", "robot-vacuum", "mop"],
  ["Morning shower", "Evening shower", "sun", "moon"],
  ["Bubble bath", "Long shower", "bath", "shower-head"],
  ["Make the bed", "Leave it messy", "bed-double", "shuffle"],
  ["Ironed shirt", "Wrinkles are fine", "shirt", "smile"],
  ["Big mug", "Small cup", "coffee", "cup-soda"],
  ["Sneakers", "Boots", "sport-shoe", "footprints"],
  ["Hoodie", "Cozy sweater", "shirt", "heart"],
  ["Dress up", "Dress down", "sparkles", "shirt"],
  ["Pink", "Blue", "flower", "droplet"],
  ["Gold", "Silver", "medal", "award"],
  ["Paper books", "E-reader", "book", "tablet"],
  ["Polaroid", "Phone camera", "camera", "smartphone"],
  ["Cash", "Card", "banknote", "credit-card"],
  ["Save it", "Spend it", "piggy-bank", "wallet"],
  ["Handmade gift", "Bought gift", "scissors", "shopping-bag"],
  ["Wrapping paper", "Gift bag", "gift", "shopping-bag"],
  ["Open presents early", "Wait for the day", "gift", "hourglass"],
  ["Birthday party", "Birthday trip", "party-popper", "plane"],
  ["Flowers", "Chocolates", "flower", "candy"],
  ["Roses", "Sunflowers", "rose", "sun"],
  ["Shells", "Pebbles", "shell", "stone"],
  ["Flowers", "Trees", "flower", "tree-deciduous"],
  ["Indoor plants", "Garden", "plant-pot", "shovel"],

  // Watching, listening, reading
  ["Comedy", "Horror", "laugh", "ghost"],
  ["Romance", "Action", "heart", "zap"],
  ["Books", "Movies", "book-open", "film"],
  ["Series", "Movie", "tv", "clapperboard"],
  ["Animated", "Live action", "wand-sparkles", "video"],
  ["Pop", "Rock", "music", "guitar"],
  ["Headphones", "Speakers", "headphones", "speaker"],
  ["Vinyl", "Streaming", "disc-3", "smartphone"],
  ["Sing", "Dance", "mic", "music-2"],
  ["Reading", "Podcasts", "book", "podcast"],
  ["Sci-fi", "Fantasy", "rocket", "wand"],
  ["Mystery", "Romance", "search", "heart"],
  ["Subtitles", "Dubbed", "captions", "mic"],
  ["Old songs", "New songs", "cassette-tape", "radio"],
  ["Rewatch a favorite", "Something new", "repeat", "sparkles"],
  ["Spoilers are fine", "No spoilers", "eye", "eye-off"],
  ["Read the book first", "Watch the movie first", "book-open", "film"],
  ["Happy ending", "Twist ending", "smile", "shuffle"],
  ["Chess", "Cards", "chess-knight", "playing-cards"],
  ["Quiz show", "Talent show", "circle-help", "star"],
  ["Documentary", "Reality show", "globe", "tv"],
  ["Musical", "Thriller", "music-4", "eye"],
  ["Love songs", "Party songs", "heart", "party-popper"],
  ["Sing in the car", "Sing in the shower", "car", "shower-head"],
  ["Road trip playlist", "Podcast", "list-music", "podcast"],
  ["Audiobook", "Paperback", "headphones", "book"],
  ["Binge it all", "One episode a night", "tv", "moon"],
  ["Cartoons", "Sitcoms", "sparkles", "laugh"],
  ["Superhero movie", "Love story", "zap", "heart"],
  ["Classic movie", "Brand new movie", "film", "sparkles"],

  // Us two
  ["Call", "Text", "phone", "message-circle"],
  ["Voice notes", "Texts", "mic", "message-square-text"],
  ["Photos", "Videos", "camera", "video"],
  ["Video call", "Phone call", "video", "phone"],
  ["Long call", "Short call", "clock", "timer"],
  ["Good morning text", "Good night text", "sun", "moon"],
  ["Text back fast", "Take your time", "zap", "hourglass"],
  ["Plan everything", "Go with the flow", "list-checks", "waves"],
  ["Spontaneous", "Planned", "shuffle", "calendar-check"],
  ["Big party", "Small dinner", "party-popper", "utensils"],
  ["Love letter", "Love song", "mail", "music"],
  ["Surprise", "Plan it together", "gift", "calendar-heart"],
  ["Handwritten", "Typed", "pen-line", "keyboard"],
  ["Hugs", "Kisses", "heart-handshake", "heart"],
  ["Big spoon", "Little spoon", "heart-handshake", "heart"],
  ["Holding hands", "Arm in arm", "hand-heart", "link"],
  ["Morning cuddles", "Night cuddles", "sun", "moon"],
  ["Slow dance", "Silly dance", "music", "party-popper"],
  ["Pet names", "Real names", "heart", "user"],
  ["Matching outfits", "No way", "shirt", "ban"],
  ["Share a dessert", "Own dessert each", "users", "cake-slice"],
  ["Talk it out now", "Sleep on it", "messages-square", "moon"],
  ["Love notes", "Surprise visits", "sticky-note", "door-open"],
  ["Slow morning", "Busy day out", "coffee", "map"],
  ["Plan a trip", "Surprise trip", "calendar-check", "gift"],
  ["Couple photos", "Funny selfies", "camera", "laugh"],
  ["Cook for you", "Get cooked for", "chef-hat", "utensils"],
  ["Give a massage", "Get a massage", "hand-heart", "sparkles"],
  ["Back rub", "Foot rub", "hand", "footprints"],
  ["Sweet words", "Small gestures", "message-circle-heart", "gift"],
  ["Quality time", "Little gifts", "clock", "gift"],
  ["Remember dates", "Remember details", "calendar-heart", "sticky-note"],
  ["Say sorry first", "Hug first", "message-circle-heart", "heart-handshake"],
  ["Laugh together", "Talk all night", "laugh", "messages-square"],
  ["Inside jokes", "New adventures", "laugh", "compass"],
  ["Breakfast date", "Dinner date", "croissant", "wine"],
  ["Matching keychains", "Matching bracelets", "key", "link"],
  ["Mixtape", "Photo album", "list-music", "images"],
  ["Hold the umbrella", "Share the rain", "umbrella", "cloud-rain"],
  ["Your playlist", "My playlist", "list-music", "music"],
  ["Pick the movie", "Pick the snacks", "film", "popcorn"],
  ["Plan the date", "Be surprised", "calendar-heart", "gift"],

  // Just imagine
  ["Fly", "Be invisible", "bird", "eye-off"],
  ["Read minds", "Teleport", "brain", "zap"],
  ["Visit the past", "Visit the future", "history", "rocket"],
  ["Live in the sea", "Fly in the sky", "fish", "bird"],
  ["Dragon", "Unicorn", "flame", "sparkles"],
  ["Live in a castle", "Live on a boat", "castle", "sailboat"],
  ["Robot butler", "Personal chef", "bot", "chef-hat"],
  ["Free food forever", "Free travel forever", "utensils", "plane"],
  ["Be famous", "Be rich", "star", "gem"],
  ["Talk to animals", "Speak every language", "paw-print", "languages"],
  ["Pause time", "Rewind time", "pause", "rewind"],
  ["Trip to space", "Deep sea dive", "rocket", "anchor"],
  ["Dinosaurs", "Aliens", "bone", "orbit"],
  ["Pirate ship", "Spaceship", "ship", "rocket"],
  ["Zombies", "Vampires", "skull", "moon"],
  ["Mermaid", "Fairy", "fish", "sparkles"],
  ["Knight", "Princess", "sword", "crown"],
  ["Detective", "Spy", "search", "glasses"],
  ["Magic wand", "Superpowers", "wand-sparkles", "zap"],
  ["Win the lottery", "Win a dream trip", "ticket", "plane"],
  ["Live by the sea", "Live in the mountains", "waves", "mountain"],
  ["Never be cold", "Never be tired", "thermometer-sun", "battery-full"],
  ["Unlimited books", "Unlimited movies", "library", "film"],
  ["Be a chef", "Be a singer", "chef-hat", "mic-vocal"],
  ["Own a bakery", "Own a flower shop", "croissant", "flower"],
  ["Own a cafe", "Own a bookshop", "coffee", "book-open"],
  ["Ten kittens", "One huge dog", "cat", "dog"],
  ["Pet penguin", "Pet panda", "bird", "panda"],
  ["Super speed", "Super strength", "zap", "biceps-flexed"],
  ["Breathe underwater", "Talk to plants", "fish", "sprout"],
  ["Time machine", "Teleporter", "history", "orbit"],
  ["Be a cat for a day", "Be a bird for a day", "cat", "bird"],
  ["Always summer", "Always Christmas", "sun", "tree-pine"],
  ["Live in a movie", "Live in a book", "clapperboard", "book-open"],
  ["Know the future", "Change the past", "telescope", "history"],

  // Little things
  ["Cozy", "Adventurous", "sofa", "compass"],
  ["Silly jokes", "Clever puns", "laugh", "message-circle-more"],
  ["Truth", "Dare", "circle-help", "flame"],
  ["Ask for directions", "Figure it out", "map", "compass"],
  ["Loud laugh", "Quiet giggle", "laugh", "smile"],
  ["Bright colors", "Soft pastels", "palette", "flower-2"],
  ["Sunglasses", "Sun hat", "glasses", "sun"],
  ["Thick blanket", "Thin sheet", "layers", "feather"],
  ["Dance wildly", "Watch and cheer", "music", "eye"],
  ["Lists", "Sticky notes", "list-todo", "sticky-note"],
  ["Calendar on paper", "Calendar on phone", "notebook", "smartphone"],
  ["Plan the day", "Wing it", "list-checks", "shuffle"],
  ["Pen", "Pencil", "pen", "pencil"],
  ["Hammock", "Sun lounger", "trees", "sun"],
  ["Stars", "Hearts", "star", "heart"],
  ["Sunshine", "Moonlight", "sun", "moon"],
  ["Ocean waves", "Rain on the window", "waves", "cloud-rain"],
  ["Fireplace", "Campfire", "flame", "flame-kindling"],
  ["Dance party", "Movie marathon", "party-popper", "film"],
  ["Coffee date", "Ice cream date", "coffee", "ice-cream-cone"],
  ["Photos on the wall", "Photos in an album", "frame", "images"],
  ["Rollercoaster", "Carousel", "roller-coaster", "ferris-wheel"],
  ["Thunder", "Lightning", "cloud-lightning", "zap"],
  ["Fresh flowers", "Potted plant", "flower-2", "plant-pot"],
  ["Hot drink", "Cold drink", "coffee", "glass-water"],
  ["Kiss in the rain", "Kiss at sunset", "cloud-rain", "sunset"]
];

const ORDER = seededShuffle(PAIRS.map((_, index) => index), "daily-match");

const isPicks = (value) => Array.isArray(value) && value.length === PAIRS_PER_DAY && value.every((pick) => pick === 0 || pick === 1);

function normalize(value) {
  return {
    days: { ...(value?.days || {}) },
    next: Number.isInteger(value?.next) && value.next >= 0 ? value.next : 0
  };
}

// Gives a day its 5 pairs the first time anyone opens it. True when it assigned them.
function assignDay(doc, day, now) {
  if (doc.days[day]) return false;
  const chosen = Array.from({ length: PAIRS_PER_DAY }, (_, index) => PAIRS[ORDER[(doc.next + index) % ORDER.length]]);
  doc.next = (doc.next + PAIRS_PER_DAY) % ORDER.length;
  doc.days[day] = {
    pairs: chosen.map(([left, right]) => [left, right]),
    icons: chosen.map(([, , left = "", right = ""]) => [left, right]),
    picks: {},
    at: now
  };
  // Keep the newest days, and always the one just opened.
  const others = Object.keys(doc.days).filter((key) => key !== day).sort();
  for (const old of others.slice(0, Math.max(0, others.length + 1 - MAX_DAYS))) delete doc.days[old];
  return true;
}

const picksOf = (entry, author) => (isPicks(entry?.picks?.[author]) ? entry.picks[author] : null);

function sameCount(a, b) {
  return a.reduce((count, pick, index) => count + (pick === b[index] ? 1 : 0), 0);
}

// The day's score once both of us played, else null.
function scoreOf(entry) {
  const her = picksOf(entry, "her");
  const sender = picksOf(entry, "sender");
  return her && sender ? sameCount(her, sender) : null;
}

// My picks always; theirs only once I played too.
function dayView(entry, day, author) {
  const mine = picksOf(entry, author);
  const theirs = picksOf(entry, other(author));
  return {
    day,
    pairs: Array.isArray(entry?.pairs) ? entry.pairs : [],
    icons: Array.isArray(entry?.icons) ? entry.icons : [],
    mine,
    theirs: mine ? theirs : null,
    theirsDone: Boolean(theirs),
    score: mine && theirs ? sameCount(mine, theirs) : null
  };
}

// Compatibility over every day we both played, perfect days, and the match streak:
// days in a row we both played with at least 3 the same, ending today (or yesterday
// while today isn't finished yet).
export function matchStats(doc, today) {
  const played = Object.keys(doc.days).filter((day) => day <= today && scoreOf(doc.days[day]) !== null).sort();
  let same = 0;
  let perfectDays = 0;
  for (const day of played) {
    const score = scoreOf(doc.days[day]);
    same += score;
    if (score === PAIRS_PER_DAY) perfectDays += 1;
  }
  const good = (day) => (scoreOf(doc.days[day]) ?? -1) >= STREAK_MIN_SAME;
  const runEndingAt = (day) => {
    let count = 0;
    for (let cursor = day; good(cursor); cursor = addDays(cursor, -1)) count += 1;
    return count;
  };
  const todayScore = scoreOf(doc.days[today]);
  const streak = todayScore === null ? runEndingAt(addDays(today, -1)) : runEndingAt(today);
  let best = streak;
  for (const day of played) {
    if (good(day) && !good(addDays(day, 1))) best = Math.max(best, runEndingAt(day));
  }
  return {
    compatibility: played.length ? Math.round((100 * same) / (played.length * PAIRS_PER_DAY)) : null,
    daysTogether: played.length,
    perfectDays,
    streak,
    best
  };
}

function view(doc, day, author, today) {
  const history = Object.keys(doc.days)
    .filter((key) => key < day && Object.keys(doc.days[key]?.picks || {}).some((who) => picksOf(doc.days[key], who)))
    .sort()
    .reverse()
    .slice(0, HISTORY_DAYS)
    .map((key) => dayView(doc.days[key], key, author));
  return { ...dayView(doc.days[day], day, author), stats: matchStats(doc, today), history };
}

function parsePicks(value) {
  if (!isPicks(value)) throw new GameError(400, "Pick one side for all 5.");
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
      throw new GameError(404, "There was no match that day.");
    }
    return view(doc, day, author, ctx.today);
  });
}

async function play(ctx) {
  const author = parseAuthor(ctx.body.author);
  const day = parseDay(ctx.body.day, ctx.today);
  if (day !== ctx.today) throw new GameError(409, "A new day started. Here are today's pairs.");
  const picks = parsePicks(ctx.body.picks);
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    assignDay(doc, day, ctx.now);
    const entry = doc.days[day];
    if (picksOf(entry, author)) throw new GameError(409, "You already played today's match.");
    entry.picks = { ...(entry.picks || {}), [author]: picks };
    await txn.put(KEY, doc);
    // A heart for playing, and 2 more each when the second of us makes it 5 of 5.
    let awarded = await award(txn, `match:${day}:${author}`, author, PLAY_HEARTS);
    const theirs = picksOf(entry, other(author));
    if (theirs && sameCount(picks, theirs) === PAIRS_PER_DAY) {
      for (const person of AUTHORS) {
        const delta = await award(txn, `match:${day}:bonus:${person}`, person, PERFECT_BONUS);
        if (person === author) awarded += delta;
      }
    }
    awarded += await markActive(txn, author, ctx.today);
    return { ...view(doc, day, author, ctx.today), awarded };
  });
}

export const routes = {
  "/games/match": async (ctx) => {
    if (ctx.method === "GET") return read(ctx);
    if (ctx.method === "POST") return play(ctx);
    throw new GameError(405, "Method not allowed.");
  }
};

// For the games hub: my turn, waiting, or today's score; compatibility and perfect days.
export async function summary(ctx) {
  const doc = normalize(await ctx.storage.get(KEY));
  const entry = doc.days[ctx.today];
  const mine = picksOf(entry, ctx.author);
  const theirs = picksOf(entry, other(ctx.author));
  let status = "todo";
  let line = theirs ? "{them} played. Your turn" : "Your turn";
  if (mine && theirs) {
    const score = sameCount(mine, theirs);
    status = "done";
    line = score === PAIRS_PER_DAY ? "A perfect match today" : `${score} of ${PAIRS_PER_DAY} the same today`;
  } else if (mine) {
    status = "waiting";
    line = "Waiting for {them}";
  }
  const stats = matchStats(doc, ctx.today);
  return {
    id: "match",
    title: "Daily match",
    icon: "split",
    step: "match",
    status,
    line,
    board: [
      { label: "Compatibility", value: stats.compatibility === null ? "–" : `${stats.compatibility}%` },
      { label: "Perfect matches", value: String(stats.perfectDays) }
    ]
  };
}
