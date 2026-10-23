// Connections for two: 16 words in 4 hidden groups of 4, from easy (yellow) to tricky
// (purple). The same puzzle for both of us; the words stay hidden until you tap Start (the
// Worker notes when). Every guess comes here and the Worker answers right, one away or
// wrong and keeps score, so a group only reaches the phone once you found it (or ran out
// of mistakes). More groups wins, then fewer mistakes, then the faster one.
import { GameError, AUTHORS, parseAuthor, parseDay, award, markActive, other, dayNumber, seededShuffle } from "./common.js";

const KEY = "games:connect";
const MAX_DAYS = 400;
const HISTORY_DAYS = 7;
const GROUPS = 4;
const MAX_MISTAKES = 4;
const MAX_MS = 30 * 60 * 1000;

// Each puzzle: four [group name, four words], easiest group first. No word fits two groups.
export const PUZZLES = [
  [["Fruits", ["Mango", "Peach", "Kiwi", "Plum"]], ["Swiss mountains", ["Eiger", "Pilatus", "Säntis", "Titlis"]], ["Things with teeth", ["Comb", "Saw", "Zipper", "Gear"]], ["Hidden numbers", ["Money", "Often", "Weight", "Stone"]]],
  [["Pasta", ["Penne", "Fusilli", "Farfalle", "Rigatoni"]], ["Dog breeds", ["Dalmatian", "Beagle", "Husky", "Corgi"]], ["French ___", ["Fries", "Toast", "Kiss", "Horn"]], ["Palindromes", ["Kayak", "Level", "Radar", "Civic"]]],
  [["Planets", ["Venus", "Mars", "Saturn", "Neptune"]], ["Coffee drinks", ["Latte", "Mocha", "Espresso", "Americano"]], ["Things with shells", ["Egg", "Snail", "Turtle", "Walnut"]], ["Sound like letters", ["Tea", "Bee", "Eye", "Queue"]]],
  [["Breakfast", ["Pancakes", "Porridge", "Cereal", "Omelette"]], ["Big cats", ["Leopard", "Cheetah", "Jaguar", "Panther"]], ["At a wedding", ["Veil", "Vows", "Bouquet", "Garter"]], ["Hidden RED", ["Credit", "Sacred", "Hundred", "Bored"]]],
  [["Weather", ["Sleet", "Fog", "Drizzle", "Hail"]], ["Disney princesses", ["Ariel", "Belle", "Mulan", "Moana"]], ["___ball", ["Foot", "Meat", "Eye", "Base"]], ["Sound like numbers", ["Won", "Too", "Ate", "For"]]],
  [["Kitchen tools", ["Whisk", "Ladle", "Grater", "Peeler"]], ["Hogwarts houses", ["Gryffindor", "Hufflepuff", "Ravenclaw", "Slytherin"]], ["Things you can break", ["Heart", "Record", "Promise", "Silence"]], ["Hidden CAT", ["Scatter", "Delicate", "Vacation", "Education"]]],
  [["Swiss cheeses", ["Gruyère", "Emmentaler", "Sbrinz", "Raclette"]], ["The Beatles", ["John", "Paul", "George", "Ringo"]], ["Ice ___", ["Cream", "Cube", "Skate", "Age"]], ["___fly", ["Butter", "Dragon", "Fire", "Horse"]]],
  [["Sea creatures", ["Octopus", "Squid", "Lobster", "Shrimp"]], ["Board games", ["Monopoly", "Cluedo", "Scrabble", "Risk"]], ["In a casino", ["Chips", "Dice", "Roulette", "Jackpot"]], ["Add an S in front", ["Nail", "Mile", "Wing", "Hop"]]],
  [["Instruments", ["Harp", "Cello", "Flute", "Tuba"]], ["Mexican food", ["Taco", "Burrito", "Nachos", "Fajita"]], ["Snow White’s dwarfs", ["Happy", "Sleepy", "Grumpy", "Dopey"]], ["Hidden OWL", ["Bowl", "Howl", "Growl", "Knowledge"]]],
  [["Body parts", ["Elbow", "Knee", "Ankle", "Wrist"]], ["Card games", ["Poker", "Bridge", "Snap", "Rummy"]], ["Things with rings", ["Saturn", "Onion", "Olympics", "Boxing"]], ["Rain___", ["Bow", "Coat", "Drop", "Forest"]]],
  [["Cocktails", ["Mojito", "Martini", "Negroni", "Daiquiri"]], ["Toy Story", ["Woody", "Buzz", "Jessie", "Slinky"]], ["Yellow things", ["Banana", "Lemon", "Canary", "Yolk"]], ["Famous Toms", ["Hanks", "Cruise", "Holland", "Hardy"]]],
  [["Herbs", ["Basil", "Mint", "Thyme", "Dill"]], ["European capitals", ["Lisbon", "Vienna", "Prague", "Dublin"]], ["Things you pop", ["Balloon", "Corn", "Question", "Bubble"]], ["Famous Chrises", ["Evans", "Pratt", "Pine", "Hemsworth"]]],
  [["Desserts", ["Tiramisu", "Brownie", "Pavlova", "Trifle"]], ["Social apps", ["Instagram", "TikTok", "Snapchat", "WhatsApp"]], ["Things with spines", ["Book", "Cactus", "Hedgehog", "Porcupine"]], ["Hidden RAT", ["Pirate", "Karate", "Crater", "Grateful"]]],
  [["Shoes", ["Sandal", "Boot", "Sneaker", "Loafer"]], ["James Bond actors", ["Connery", "Moore", "Craig", "Brosnan"]], ["Chess pieces", ["Rook", "Bishop", "Knight", "Pawn"]], ["Love ___", ["Letter", "Potion", "Triangle", "Handles"]]],
  [["Flowers", ["Rose", "Daisy", "Lily", "Orchid"]], ["Pixar films", ["Up", "Cars", "Coco", "Brave"]], ["Things with scales", ["Fish", "Snake", "Map", "Piano"]], ["Hidden body parts", ["Earth", "Shipping", "Elegant", "Chinese"]]],
  [["Zodiac signs", ["Leo", "Aries", "Libra", "Virgo"]], ["Nuts", ["Almond", "Cashew", "Pecan", "Pistachio"]], ["At the cinema", ["Popcorn", "Ticket", "Screen", "Trailer"]], ["___house", ["Light", "Green", "Tree", "Dog"]]],
  [["Winter sports", ["Skiing", "Curling", "Luge", "Biathlon"]], ["The Simpsons", ["Homer", "Marge", "Bart", "Lisa"]], ["Sweet ___", ["Heart", "Corn", "Tooth", "Dreams"]], ["Famous Harrys", ["Potter", "Styles", "Kane", "Houdini"]]],
  [["Vegetables", ["Carrot", "Leek", "Celery", "Spinach"]], ["Greek letters", ["Alpha", "Beta", "Gamma", "Delta"]], ["Things with stripes", ["Zebra", "Barcode", "Bee", "Tiger"]], ["Anagrams of each other", ["Post", "Spot", "Tops", "Pots"]]],
  [["Racket sports", ["Tennis", "Squash", "Badminton", "Padel"]], ["Shrek", ["Donkey", "Fiona", "Dragon", "Farquaad"]], ["Ways to kiss", ["Smooch", "Peck", "Snog", "Smack"]], ["Hidden ANT", ["Giant", "Pants", "Plant", "Want"]]],
  [["Colours", ["Turquoise", "Maroon", "Lilac", "Beige"]], ["Painters", ["Monet", "Picasso", "Dalí", "Rembrandt"]], ["Things you can catch", ["Cold", "Bus", "Feelings", "Breath"]], ["___light", ["Moon", "Candle", "Flash", "Spot"]]],
  [["Swiss cantons", ["Uri", "Zug", "Jura", "Glarus"]], ["Swiss food", ["Fondue", "Raclette", "Rösti", "Zopf"]], ["Swiss brands", ["Swatch", "Rivella", "Ricola", "Victorinox"]], ["Swiss ___", ["Roll", "Chard", "Franc", "Army"]]],
  [["Birds", ["Eagle", "Swan", "Parrot", "Owl"]], ["Ice cream flavours", ["Vanilla", "Caramel", "Coconut", "Raspberry"]], ["Batman villains", ["Joker", "Riddler", "Bane", "Scarecrow"]], ["___ bear", ["Teddy", "Polar", "Gummy", "Care"]]],
  [["Metals", ["Copper", "Iron", "Zinc", "Tin"]], ["Cheeses", ["Brie", "Feta", "Gouda", "Cheddar"]], ["Hot ___", ["Potato", "Tub", "Sauce", "Spot"]], ["___fish", ["Sword", "Cat", "Star", "Jelly"]]],
  [["Rooms", ["Kitchen", "Bathroom", "Attic", "Cellar"]], ["Composers", ["Mozart", "Bach", "Chopin", "Vivaldi"]], ["Fairy tale heroes", ["Rapunzel", "Cinderella", "Goldilocks", "Pinocchio"]], ["Backwards, a new word", ["Stressed", "Drawer", "Diaper", "Parts"]]],
  [["Pet names", ["Babe", "Darling", "Sweetie", "Pumpkin"]], ["Valentine’s Day", ["Roses", "Card", "Cupid", "Chocolates"]], ["First ___", ["Date", "Aid", "Class", "Sight"]], ["___ moon", ["Full", "Blue", "New", "Harvest"]]],
  [["Jewellery", ["Necklace", "Bracelet", "Earring", "Brooch"]], ["Martial arts", ["Karate", "Judo", "Kung fu", "Taekwondo"]], ["Things with wings", ["Plane", "Angel", "Bat", "Fairy"]], ["Hidden APE", ["Paper", "Grape", "Escape", "Shape"]]],
  [["Clothes", ["Jumper", "Blouse", "Hoodie", "Jacket"]], ["Sea___", ["Horse", "Shell", "Weed", "Gull"]], ["Detectives", ["Sherlock", "Poirot", "Marple", "Columbo"]], ["Start with PAN", ["Pancake", "Panda", "Pantry", "Panic"]]],
  [["Breads", ["Bagel", "Baguette", "Ciabatta", "Pretzel"]], ["Avengers", ["Thor", "Hulk", "Hawkeye", "Black Widow"]], ["Golden ___", ["Retriever", "Gate", "Globe", "Ticket"]], ["___ cream", ["Ice", "Sour", "Sun", "Whipped"]]],
  [["Spices", ["Cinnamon", "Nutmeg", "Paprika", "Saffron"]], ["Dances", ["Salsa", "Tango", "Waltz", "Samba"]], ["Pop ___", ["Corn", "Star", "Art", "Quiz"]], ["Famous Emmas", ["Watson", "Stone", "Thompson", "Roberts"]]],
  [["Trees", ["Oak", "Birch", "Willow", "Maple"]], ["Friends", ["Ross", "Rachel", "Monica", "Chandler"]], ["In a toolbox", ["Hammer", "Wrench", "Pliers", "Drill"]], ["___bug", ["Lady", "Bed", "Litter", "Jitter"]]],
  [["Baby animals", ["Kitten", "Puppy", "Foal", "Lamb"]], ["Video game heroes", ["Mario", "Sonic", "Luigi", "Kirby"]], ["Sun___", ["Flower", "Glasses", "Set", "Burn"]], ["___board", ["Key", "Skate", "Cup", "Dash"]]],
  [["South America", ["Peru", "Chile", "Brazil", "Bolivia"]], ["In the sky", ["Cloud", "Kite", "Rainbow", "Comet"]], ["Coffee words", ["Bean", "Grind", "Brew", "Roast"]], ["Hidden ICE", ["Office", "Notice", "Justice", "Advice"]]],
  [["Insects", ["Beetle", "Wasp", "Moth", "Ladybird"]], ["Playing cards", ["Ace", "Jack", "Joker", "Queen"]], ["Sports", ["Golf", "Rugby", "Hockey", "Polo"]], ["___cake", ["Cup", "Pan", "Cheese", "Fish"]]],
  [["Hats", ["Beret", "Beanie", "Fedora", "Sombrero"]], ["At the beach", ["Towel", "Spade", "Sunscreen", "Lifeguard"]], ["Disney villains", ["Ursula", "Scar", "Jafar", "Hades"]], ["Start with a body part", ["Legend", "Handsome", "Earnest", "Hipster"]]],
  [["Gemstones", ["Ruby", "Emerald", "Sapphire", "Opal"]], ["Scientists", ["Newton", "Darwin", "Curie", "Einstein"]], ["Things with faces", ["Clock", "Coin", "Cliff", "Watch"]], ["___ star", ["Movie", "Pop", "Shooting", "North"]]],
  [["Australian animals", ["Kangaroo", "Koala", "Wombat", "Emu"]], ["Italian food", ["Risotto", "Lasagne", "Gnocchi", "Bruschetta"]], ["In the kitchen", ["Oven", "Fridge", "Kettle", "Toaster"]], ["Famous Jacks", ["Nicholson", "Sparrow", "Black", "Frost"]]],
  [["Shades of blue", ["Teal", "Cobalt", "Azure", "Cyan"]], ["In space", ["Comet", "Asteroid", "Galaxy", "Nebula"]], ["Car brands", ["Tesla", "Ferrari", "Porsche", "Volvo"]], ["___ship", ["Friend", "Relation", "Champion", "Owner"]]],
  [["Pizza toppings", ["Ham", "Olive", "Mushroom", "Pepperoni"]], ["Winnie the Pooh", ["Piglet", "Eeyore", "Tigger", "Kanga"]], ["Things you blow", ["Kiss", "Whistle", "Bubble", "Trumpet"]], ["Start with a boy’s name", ["Danger", "Jackpot", "Samba", "Bobcat"]]],
  [["Units of time", ["Second", "Minute", "Hour", "Decade"]], ["Music styles", ["Jazz", "Reggae", "Techno", "Blues"]], ["Sticky things", ["Glue", "Honey", "Tape", "Gum"]], ["___ paper", ["News", "Wall", "Sand", "Toilet"]]],
  [["Farm animals", ["Goat", "Donkey", "Horse", "Hen"]], ["In a salad", ["Lettuce", "Cucumber", "Tomato", "Radish"]], ["Things you can draw", ["Bath", "Curtains", "Conclusion", "Crowd"]], ["Silent K", ["Knife", "Knot", "Knock", "Knit"]]],
  [["In a pencil case", ["Sharpener", "Crayon", "Eraser", "Ruler"]], ["Dog commands", ["Sit", "Stay", "Fetch", "Heel"]], ["Things with a cap", ["Bottle", "Knee", "Mushroom", "Ice"]], ["Start with an animal", ["Cathedral", "Dogma", "Ratio", "Pigment"]]],
  [["French desserts", ["Crêpe", "Éclair", "Macaron", "Soufflé"]], ["Tennis stars", ["Federer", "Nadal", "Djokovic", "Murray"]], ["Bubble ___", ["Gum", "Bath", "Tea", "Wrap"]], ["Anagrams of LISTEN", ["Silent", "Enlist", "Tinsel", "Inlets"]]],
  [["Tropical fruits", ["Pineapple", "Papaya", "Coconut", "Lychee"]], ["Asian capitals", ["Tokyo", "Seoul", "Bangkok", "Hanoi"]], ["Things with a tail", ["Kite", "Coin", "Plane", "Tadpole"]], ["Hidden PEA", ["Speak", "Peace", "Repeat", "Appeal"]]],
  [["Japanese food", ["Sushi", "Ramen", "Tempura", "Miso"]], ["In the garden", ["Shed", "Hose", "Lawn", "Hedge"]], ["___ ring", ["Ear", "Key", "Onion", "Nose"]], ["___man", ["Snow", "Bat", "Post", "Super"]]],
  [["Drinks", ["Juice", "Lemonade", "Smoothie", "Milkshake"]], ["Ballet", ["Tutu", "Pointe", "Pirouette", "Plié"]], ["Fluffy things", ["Cloud", "Kitten", "Pillow", "Cotton"]], ["Start with a vehicle", ["Carpet", "Vanilla", "Business", "Tramp"]]],
  [["In a classroom", ["Desk", "Chalk", "Whiteboard", "Globe"]], ["Chocolate bars", ["Twix", "Mars", "Bounty", "Snickers"]], ["Things you crack", ["Code", "Joke", "Egg", "Smile"]], ["___worm", ["Book", "Earth", "Silk", "Glow"]]],
  [["Pets", ["Hamster", "Rabbit", "Goldfish", "Parrot"]], ["Inside Out", ["Joy", "Sadness", "Anger", "Disgust"]], ["___ bag", ["Hand", "Sleeping", "Tea", "Bean"]], ["End with a number", ["Often", "Height", "Canine", "Phone"]]],
  [["Months", ["March", "May", "June", "August"]], ["Picnic things", ["Blanket", "Basket", "Sandwich", "Thermos"]], ["Things you set", ["Table", "Alarm", "Goal", "Trap"]], ["___ break", ["Jail", "Coffee", "Tie", "Wind"]]],
  [["In a hospital", ["Nurse", "Bandage", "Plaster", "Syringe"]], ["Disney sidekicks", ["Olaf", "Timon", "Pumbaa", "Mushu"]], ["Pop-up ___", ["Book", "Tent", "Shop", "Ad"]], ["___nail", ["Toe", "Finger", "Thumb", "Hang"]]],
  [["Rivers", ["Nile", "Amazon", "Rhine", "Danube"]], ["Kinds of tea", ["Green", "Chai", "Herbal", "Jasmine"]], ["Things you run", ["Marathon", "Bath", "Business", "Errand"]], ["Hidden ONE", ["Money", "Phone", "Honey", "Lonely"]]],
  [["At the bakery", ["Croissant", "Doughnut", "Bagel", "Pretzel"]], ["Muppets", ["Kermit", "Gonzo", "Fozzie", "Animal"]], ["Magic show", ["Wand", "Rabbit", "Top hat", "Cape"]], ["English ___", ["Muffin", "Breakfast", "Channel", "Bulldog"]]],
  [["In the ocean", ["Coral", "Plankton", "Shipwreck", "Seaweed"]], ["One-name singers", ["Adele", "Rihanna", "Shakira", "Beyoncé"]], ["Things you save", ["Face", "Energy", "Seat", "Lives"]], ["___line", ["Dead", "Head", "Punch", "Life"]]],
  [["Root vegetables", ["Carrot", "Beetroot", "Parsnip", "Turnip"]], ["Bags", ["Backpack", "Clutch", "Tote", "Satchel"]], ["Wild ___", ["Card", "Life", "Flower", "Child"]], ["___wood", ["Holly", "Bolly", "Drift", "Sandal"]]],
  [["In the park", ["Bench", "Swing", "Slide", "Fountain"]], ["Made from milk", ["Butter", "Yogurt", "Cheese", "Cream"]], ["Sharp things", ["Knife", "Needle", "Thorn", "Pencil"]], ["Anagrams of STAR", ["Arts", "Rats", "Tsar", "Star"]]],
  [["African countries", ["Kenya", "Egypt", "Ghana", "Morocco"]], ["In the bedroom", ["Pillow", "Duvet", "Wardrobe", "Lamp"]], ["Party ___", ["Animal", "Popper", "Favour", "Trick"]], ["Famous Johns", ["Lennon", "Travolta", "Legend", "Wick"]]],
  [["Car parts", ["Wheel", "Engine", "Bumper", "Mirror"]], ["Tea___", ["Pot", "Spoon", "Bag", "Cup"]], ["In a castle", ["Moat", "Tower", "Dungeon", "Drawbridge"]], ["Start with a drink", ["Alert", "Ginger", "Rumble", "Portrait"]]],
  [["Birthday party", ["Balloons", "Presents", "Confetti", "Streamers"]], ["Famous bears", ["Paddington", "Baloo", "Winnie", "Yogi"]], ["Things you roll", ["Dice", "Eyes", "Dough", "Credits"]], ["___stick", ["Lip", "Chop", "Drum", "Joy"]]],
  [["Rice dishes", ["Risotto", "Paella", "Biryani", "Pilaf"]], ["At the theatre", ["Stage", "Curtain", "Usher", "Interval"]], ["Fake ___", ["News", "Tan", "Lashes", "Smile"]], ["___fall", ["Water", "Night", "Rain", "Land"]]],
  [["Berries", ["Strawberry", "Raspberry", "Blueberry", "Blackberry"]], ["In a wallet", ["Cash", "Coins", "Receipt", "Photo"]], ["Things you pick", ["Lock", "Fight", "Winner", "Flowers"]], ["___land", ["Wonder", "Main", "Home", "Dream"]]],
  [["Boats", ["Canoe", "Yacht", "Ferry", "Kayak"]], ["Harry Potter", ["Hagrid", "Dobby", "Snape", "Hermione"]], ["Fruit with a stone", ["Cherry", "Olive", "Avocado", "Mango"]], ["___bird", ["Early", "Song", "Love", "Black"]]],
  [["Office supplies", ["Stapler", "Paperclip", "Folder", "Envelope"]], ["Christmas", ["Reindeer", "Stocking", "Mistletoe", "Sleigh"]], ["Grand ___", ["Piano", "Canyon", "Slam", "Prix"]], ["Famous Kates", ["Moss", "Winslet", "Middleton", "Bush"]]],
  [["At a restaurant", ["Menu", "Waiter", "Bill", "Napkin"]], ["Hairstyles", ["Bun", "Braid", "Ponytail", "Bob"]], ["Fried ___", ["Chicken", "Rice", "Egg", "Onion"]], ["___mark", ["Book", "Bench", "Land", "Trade"]]],
  [["Rainbow colours", ["Orange", "Yellow", "Indigo", "Violet"]], ["At the airport", ["Gate", "Runway", "Terminal", "Customs"]], ["___ fruit", ["Passion", "Dragon", "Star", "Grape"]], ["Hidden HEN", ["Athens", "Kitchen", "When", "Then"]]],
  [["Sandwich fillings", ["Ham", "Tuna", "Egg", "Cheese"]], ["Video games", ["Tetris", "Minecraft", "Fortnite", "Pac-Man"]], ["Things with buttons", ["Shirt", "Remote", "Elevator", "Coat"]], ["Hidden TIN", ["Destiny", "Martini", "Latin", "Satin"]]],
  [["In the bathroom", ["Toothbrush", "Towel", "Shampoo", "Mirror"]], ["Italian cities", ["Milan", "Rome", "Florence", "Naples"]], ["Soft ___", ["Spot", "Drink", "Toy", "Serve"]], ["Hidden ARM", ["Harmony", "Charming", "Pharmacy", "Alarm"]]],
  [["Garden flowers", ["Sunflower", "Poppy", "Lavender", "Peony"]], ["Snacks", ["Crackers", "Popcorn", "Crisps", "Peanuts"]], ["Things that go off", ["Alarm", "Milk", "Bomb", "Fireworks"]], ["Start with an insect", ["Antique", "Beetroot", "Mothball", "Flypaper"]]],
  [["In the fridge", ["Milk", "Butter", "Eggs", "Yogurt"]], ["Wizards", ["Merlin", "Gandalf", "Dumbledore", "Voldemort"]], ["Things you toss", ["Coin", "Salad", "Pancake", "Bouquet"]], ["___pool", ["Car", "Whirl", "Liver", "Rock"]]],
  [["Potato dishes", ["Fries", "Mash", "Wedges", "Gratin"]], ["On a farm", ["Tractor", "Barn", "Silo", "Scarecrow"]], ["Things you cast", ["Spell", "Vote", "Shadow", "Net"]], ["Hidden RAP", ["Grape", "Trapeze", "Scrape", "Drapes"]]],
  [["Fish to eat", ["Salmon", "Tuna", "Cod", "Trout"]], ["Swiss watches", ["Rolex", "Omega", "Swatch", "Tissot"]], ["Electric ___", ["Guitar", "Fence", "Blanket", "Chair"]], ["___ache", ["Head", "Tooth", "Belly", "Heart"]]],
  [["Toys", ["Yo-yo", "Doll", "Kite", "Marbles"]], ["Fashion houses", ["Gucci", "Prada", "Chanel", "Versace"]], ["Things you shuffle", ["Cards", "Feet", "Playlist", "Papers"]], ["Hidden EAR", ["Pearl", "Heart", "Learn", "Beard"]]],
  [["Spa day", ["Massage", "Facial", "Sauna", "Manicure"]], ["Sauces", ["Ketchup", "Pesto", "Gravy", "Mayo"]], ["Blind ___", ["Date", "Spot", "Fold", "Side"]], ["Famous Jennifers", ["Aniston", "Lopez", "Lawrence", "Garner"]]],
  [["At the zoo", ["Giraffe", "Zebra", "Hippo", "Gorilla"]], ["Card games", ["Solitaire", "Blackjack", "Uno", "Rummy"]], ["Shades of pink", ["Rose", "Coral", "Salmon", "Blush"]], ["Royal ___", ["Flush", "Family", "Wedding", "Mail"]]],
  [["Breakfast cereals", ["Muesli", "Granola", "Cornflakes", "Cheerios"]], ["Team positions", ["Goalkeeper", "Striker", "Pitcher", "Catcher"]], ["Flat ___", ["Tyre", "Pack", "Mate", "Screen"]], ["___ tie", ["Bow", "Neck", "Black", "Zip"]]],
  [["Reptiles", ["Gecko", "Iguana", "Python", "Tortoise"]], ["Ice cream shop", ["Cone", "Sprinkles", "Scoop", "Sundae"]], ["Things you keep", ["Secret", "Promise", "Calm", "Score"]], ["___nut", ["Dough", "Coco", "Pea", "Chest"]]],
  [["Fast food", ["Burger", "Pizza", "Hot dog", "Kebab"]], ["Shades of green", ["Lime", "Olive", "Mint", "Jade"]], ["Things with strings", ["Puppet", "Kite", "Guitar", "Yo-yo"]], ["___tail", ["Pig", "Dove", "Fish", "Pony"]]]
];

const ORDER = seededShuffle(PUZZLES.map((_, index) => index), "connections");
// Words compare without case or accents ("eclair" is "Éclair").
const fold = (word) => String(word ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const keyOf = (words) => words.map(fold).sort().join("|");

function normalize(value) {
  return { days: { ...(value?.days || {}) } };
}

function assignDay(doc, day, now) {
  if (doc.days[day]) return false;
  const puzzle = PUZZLES[ORDER[dayNumber(day) % ORDER.length]];
  const groups = puzzle.map(([name, words], index) => ({ level: index + 1, name, words: [...words] }));
  // The 16 words in a mixed order, the same on both phones.
  const words = seededShuffle(groups.flatMap((group) => group.words), `connect:${day}`);
  doc.days[day] = { groups, words, players: {}, at: now };
  const others = Object.keys(doc.days).filter((key) => key !== day).sort();
  for (const old of others.slice(0, Math.max(0, others.length + 1 - MAX_DAYS))) delete doc.days[old];
  return true;
}

const playerOf = (entry, author) => entry?.players?.[author] || null;
const doneOf = (entry, author) => Boolean(playerOf(entry, author)?.doneAt);
const levelOf = (entry, word) => entry.groups.find((group) => group.words.includes(word))?.level || 0;
const solvedOf = (player) => (Array.isArray(player?.solved) ? player.solved : []);
const guessesOf = (player) => (Array.isArray(player?.guesses) ? player.guesses : []);
const perfectOf = (player) => solvedOf(player).length === GROUPS && (player?.mistakes || 0) === 0;

export function connectResult(entry) {
  const her = playerOf(entry, "her");
  const sender = playerOf(entry, "sender");
  if (!her?.doneAt || !sender?.doneAt) return null;
  const solved = { her: solvedOf(her).length, sender: solvedOf(sender).length };
  const mistakes = { her: her.mistakes || 0, sender: sender.mistakes || 0 };
  const ms = { her: her.ms, sender: sender.ms };
  let winner = "tie";
  if (solved.her !== solved.sender) winner = solved.her > solved.sender ? "her" : "sender";
  else if (mistakes.her !== mistakes.sender) winner = mistakes.her < mistakes.sender ? "her" : "sender";
  else if (Math.abs(ms.her - ms.sender) >= 50) winner = ms.her < ms.sender ? "her" : "sender";
  return { solved, mistakes, ms, winner, perfect: { her: perfectOf(her), sender: perfectOf(sender) } };
}

// A finished round: how it went, and each guess as the levels of its 4 words (the coloured grid).
function roundView(entry, player) {
  return {
    solved: solvedOf(player).length,
    mistakes: player.mistakes || 0,
    ms: player.ms,
    perfect: perfectOf(player),
    pattern: guessesOf(player).map((guess) => guess.words.map((word) => levelOf(entry, word)))
  };
}

function dayView(entry, day, author, now) {
  const mine = playerOf(entry, author);
  const theirs = playerOf(entry, other(author));
  const started = Boolean(mine?.startedAt);
  const done = Boolean(mine?.doneAt);
  const group = (level) => entry.groups.find((item) => item.level === level);
  return {
    day,
    started,
    done,
    // Time already used in a round that's still going (a reload carries on from here).
    elapsedMs: started && !done && now ? Math.max(0, Date.parse(now) - Date.parse(mine.startedAt)) : null,
    // The words only once I started; a group's name only once I found it (all of them when I'm done).
    words: started ? entry.words : null,
    found: started ? solvedOf(mine).map(group) : [],
    mistakes: started ? mine.mistakes || 0 : 0,
    maxMistakes: MAX_MISTAKES,
    tried: started ? guessesOf(mine).filter((guess) => guess.result !== "right").map((guess) => guess.words) : [],
    groups: done ? entry.groups : null,
    mine: done ? roundView(entry, mine) : null,
    theirs: done && theirs?.doneAt ? roundView(entry, theirs) : null,
    theirsDone: Boolean(theirs?.doneAt),
    result: done ? connectResult(entry) : null
  };
}

export function connectStats(doc, today) {
  const days = Object.keys(doc.days).filter((day) => day <= today).sort();
  const wins = { her: 0, sender: 0 };
  const perfect = { her: 0, sender: 0 };
  const groups = { her: 0, sender: 0 };
  let daysPlayed = 0;
  for (const day of days) {
    const entry = doc.days[day];
    for (const author of AUTHORS) {
      const player = playerOf(entry, author);
      if (!player?.doneAt) continue;
      groups[author] += solvedOf(player).length;
      if (perfectOf(player)) perfect[author] += 1;
    }
    const result = connectResult(entry);
    if (!result) continue;
    daysPlayed += 1;
    if (result.winner !== "tie") wins[result.winner] += 1;
  }
  return { daysPlayed, wins, perfect, groups };
}

function view(doc, day, author, today, now) {
  const history = Object.keys(doc.days)
    .filter((key) => key < day && doneOf(doc.days[key], author))
    .sort()
    .reverse()
    .slice(0, HISTORY_DAYS)
    .map((key) => ({ day: key, result: connectResult(doc.days[key]) }));
  return { ...dayView(doc.days[day], day, author, now), stats: connectStats(doc, today), history };
}

// Four different words of today's sixteen, written as the puzzle writes them.
function parseWords(value, entry) {
  if (!Array.isArray(value) || value.length !== 4) throw new GameError(400, "Pick four words.");
  const words = value.map((word) => entry.words.find((item) => fold(item) === fold(word)));
  if (words.some((word) => !word) || new Set(words).size !== 4) throw new GameError(400, "Pick four different words from today’s puzzle.");
  return words;
}

function judge(entry, words) {
  const counts = {};
  for (const word of words) counts[levelOf(entry, word)] = (counts[levelOf(entry, word)] || 0) + 1;
  const [level, most] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  if (most === 4) return { result: "right", level: Number(level) };
  return { result: most === 3 ? "oneAway" : "wrong" };
}

async function read(ctx) {
  const author = parseAuthor(ctx.query("author"));
  const day = parseDay(ctx.query("day"), ctx.today);
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    if (day === ctx.today) {
      if (assignDay(doc, day, ctx.now)) await txn.put(KEY, doc);
    } else if (!doc.days[day]) {
      throw new GameError(404, "There was no connections puzzle that day.");
    }
    return view(doc, day, author, ctx.today, ctx.now);
  });
}

async function act(ctx) {
  const author = parseAuthor(ctx.body.author);
  const day = parseDay(ctx.body.day, ctx.today);
  if (day !== ctx.today) throw new GameError(409, "A new day started. Here’s today’s puzzle.");
  const action = ctx.body.action;
  if (!["start", "guess"].includes(action)) throw new GameError(400, "Unknown action.");
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    assignDay(doc, day, ctx.now);
    const entry = doc.days[day];
    const player = { ...(playerOf(entry, author) || {}) };
    player.guesses = [...guessesOf(player)];
    player.solved = [...solvedOf(player)];
    if (action === "start") {
      if (player.doneAt) throw new GameError(409, "You already played today’s connections.");
      if (!player.startedAt) {
        Object.assign(player, { startedAt: ctx.now, mistakes: 0 });
        entry.players = { ...(entry.players || {}), [author]: player };
        await txn.put(KEY, doc);
      }
      return { ...view(doc, day, author, ctx.today, ctx.now), awarded: 0 };
    }
    if (!player.startedAt) throw new GameError(409, "Tap Start first.");
    const words = parseWords(ctx.body.words, entry);
    const key = keyOf(words);
    const last = player.guesses[player.guesses.length - 1];
    // The same guess again (a retry after a lost answer) changes nothing.
    if (last && keyOf(last.words) === key) {
      return { ...view(doc, day, author, ctx.today, ctx.now), last: { result: last.result, level: last.level || null }, awarded: 0 };
    }
    if (player.doneAt) throw new GameError(409, "You already played today’s connections.");
    if (words.some((word) => player.solved.includes(levelOf(entry, word)))) throw new GameError(400, "You already found that group.");
    if (player.guesses.some((guess) => keyOf(guess.words) === key)) throw new GameError(409, "You already tried those four.");
    const verdict = judge(entry, words);
    player.guesses.push({ words, result: verdict.result, ...(verdict.level ? { level: verdict.level } : {}), at: ctx.now });
    if (verdict.result === "right") player.solved.push(verdict.level);
    else player.mistakes = (player.mistakes || 0) + 1;
    const finished = player.solved.length === GROUPS || player.mistakes >= MAX_MISTAKES;
    if (finished) {
      const seen = Date.parse(ctx.now) - Date.parse(player.startedAt);
      const told = Number(ctx.body.ms);
      player.ms = Math.round(Math.max(0, Math.min(MAX_MS, Number.isFinite(told) && told > 0 ? Math.min(told, seen) : seen)));
      player.doneAt = ctx.now;
    }
    entry.players = { ...(entry.players || {}), [author]: player };
    await txn.put(KEY, doc);
    let awarded = 0;
    if (finished) {
      awarded += await award(txn, `connect:${day}:play:${author}`, author, 1);
      const result = connectResult(entry);
      if (result) {
        for (const person of AUTHORS) {
          let hearts = result.winner === person ? 2 : result.winner === "tie" ? 1 : 0;
          if (result.perfect[person]) hearts += 1;
          const delta = await award(txn, `connect:${day}:score:${person}`, person, hearts);
          if (person === author) awarded += delta;
        }
      }
    }
    awarded += await markActive(txn, author, ctx.today);
    return { ...view(doc, day, author, ctx.today, ctx.now), last: { result: verdict.result, level: verdict.level || null }, awarded };
  });
}

export const routes = {
  "/games/connect": async (ctx) => {
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
  let line = theirs ? "{them} played. Your turn" : playerOf(entry, ctx.author)?.startedAt ? "Finish your puzzle" : "16 words, 4 groups";
  if (mine && theirs) {
    const result = connectResult(entry);
    status = "done";
    line = result.winner === "tie" ? "A tie today" : `${result.winner === ctx.author ? "{me}" : "{them}"} won today`;
  } else if (mine) {
    status = "waiting";
    line = "Waiting for {them}";
  }
  const stats = connectStats(doc, ctx.today);
  return {
    id: "connect",
    title: "Connections",
    icon: "layout-grid",
    step: "connect",
    status,
    line,
    board: [
      { label: "Connections wins", her: stats.wins.her, sender: stats.wins.sender },
      { label: "Perfect connections", her: stats.perfect.her, sender: stats.perfect.sender }
    ]
  };
}
