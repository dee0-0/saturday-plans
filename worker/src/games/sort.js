// Sort it: 5 things a day to put in order by a rule ("Oldest first", "Biggest first"…).
// The same set for both of us; it stays hidden until you tap Start (the Worker notes when).
// Each thing in its right place scores a point; more points wins, and with the same
// score the faster one wins. The right order, with the years or sizes, shows once you've played.
import { GameError, AUTHORS, parseAuthor, parseDay, award, markActive, other, dayNumber, seededShuffle } from "./common.js";

const KEY = "games:sort";
const MAX_DAYS = 400;
const HISTORY_DAYS = 7;
const COUNT = 5;
const MAX_MS = 10 * 60 * 1000;

const OLDEST = ["Oldest first", "Oldest", "Newest"];
const BIGGEST = ["Biggest first", "Biggest", "Smallest"];
const FAR = ["Furthest from Bern first", "Furthest", "Closest"];
const TALLEST = ["Tallest first", "Tallest", "Shortest"];
const LONGEST = ["Longest first", "Longest", "Shortest"];
const MOST = ["Most first", "Most", "Fewest"];
const HEAVIEST = ["Heaviest first", "Heaviest", "Lightest"];

// [rule, top label, bottom label] + what is measured + 5 × [thing, value, shown value]
// in the RIGHT order (the shown value defaults to the number itself, for years).
// Only well-known facts; the values are far enough apart that the order is certain.
const set = ([rule, top, bottom], about, items) => ({ rule, top, bottom, about, items });
export const SETS = [
  set(OLDEST, "When each company was founded", [["Amazon", 1994], ["Google", 1998], ["Facebook", 2004], ["YouTube", 2005], ["Instagram", 2010]]),
  set(OLDEST, "When each company was founded", [["Microsoft", 1975], ["Apple", 1976], ["Netflix", 1997], ["Spotify", 2006], ["WhatsApp", 2009]]),
  set(OLDEST, "When each one first came out", [["iMac", 1998], ["iPod", 2001], ["iPhone", 2007], ["iPad", 2010], ["Apple Watch", 2015]]),
  set(OLDEST, "When each console came out", [["Game Boy", 1989], ["PlayStation", 1994], ["Nintendo 64", 1996], ["Xbox", 2001], ["Wii", 2006]]),
  set(OLDEST, "When each console came out", [["PlayStation 2", 2000], ["Xbox 360", 2005], ["PlayStation 4", 2013], ["Nintendo Switch", 2017], ["PlayStation 5", 2020]]),
  set(OLDEST, "When each app launched", [["Twitter", 2006], ["WhatsApp", 2009], ["Instagram", 2010], ["Snapchat", 2011], ["Tinder", 2012]]),
  set(OLDEST, "When each one launched", [["eBay", 1995], ["Wikipedia", 2001], ["Skype", 2003], ["Gmail", 2004], ["Airbnb", 2008]]),
  set(OLDEST, "When each film came out", [["Titanic", 1997], ["The Matrix", 1999], ["Shrek", 2001], ["Avatar", 2009], ["Frozen", 2013]]),
  set(OLDEST, "When each Disney film came out", [["Snow White", 1937], ["Cinderella", 1950], ["The Jungle Book", 1967], ["The Little Mermaid", 1989], ["The Lion King", 1994]]),
  set(OLDEST, "When each Pixar film came out", [["Toy Story", 1995], ["Finding Nemo", 2003], ["Cars", 2006], ["Up", 2009], ["Coco", 2017]]),
  set(OLDEST, "The Harry Potter books", [["Philosopher’s Stone", 1997], ["Chamber of Secrets", 1998], ["Prisoner of Azkaban", 1999], ["Goblet of Fire", 2000], ["Order of the Phoenix", 2003]]),
  set(OLDEST, "When each Star Wars film came out", [["A New Hope", 1977], ["The Empire Strikes Back", 1980], ["Return of the Jedi", 1983], ["The Phantom Menace", 1999], ["The Force Awakens", 2015]]),
  set(OLDEST, "Each actor’s first James Bond film", [["Sean Connery", 1962, "1962 · Dr. No"], ["Roger Moore", 1973, "1973 · Live and Let Die"], ["Timothy Dalton", 1987, "1987 · The Living Daylights"], ["Pierce Brosnan", 1995, "1995 · GoldenEye"], ["Daniel Craig", 2006, "2006 · Casino Royale"]]),
  set(OLDEST, "When each love story came out", [["Pretty Woman", 1990], ["Notting Hill", 1999], ["Love Actually", 2003], ["The Notebook", 2004], ["La La Land", 2016]]),
  set(OLDEST, "When each film came out", [["Jaws", 1975], ["E.T.", 1982], ["Back to the Future", 1985], ["Home Alone", 1990], ["Jurassic Park", 1993]]),
  set(OLDEST, "When each Marvel film came out", [["Iron Man", 2008], ["The Avengers", 2012], ["Guardians of the Galaxy", 2014], ["Black Panther", 2018], ["Avengers: Endgame", 2019]]),
  set(OLDEST, "When each series started", [["The Simpsons", 1989], ["Friends", 1994], ["Breaking Bad", 2008], ["Game of Thrones", 2011], ["Stranger Things", 2016]]),
  set(OLDEST, "When each Netflix series started", [["House of Cards", 2013], ["The Crown", 2016], ["Bridgerton", 2020], ["Squid Game", 2021], ["Wednesday", 2022]]),
  set(OLDEST, "Taylor Swift albums", [["Fearless", 2008], ["Red", 2012], ["1989", 2014], ["Folklore", 2020], ["Midnights", 2022]]),
  set(OLDEST, "When each song came out", [["Bohemian Rhapsody", 1975], ["Billie Jean", 1983], ["Wonderwall", 1995], ["Crazy in Love", 2003], ["Shape of You", 2017]]),
  set(OLDEST, "When each one won Eurovision", [["ABBA", 1974], ["Céline Dion", 1988], ["Lordi", 2006], ["Måneskin", 2021], ["Nemo", 2024]]),
  set(OLDEST, "When each was invented", [["The telephone", 1876], ["The light bulb", 1879], ["The aeroplane", 1903], ["The World Wide Web", 1991], ["The iPhone", 2007]]),
  set(OLDEST, "When it happened", [["Columbus reaches America", 1492], ["The Titanic sinks", 1912], ["World War II ends", 1945], ["The Berlin Wall falls", 1989], ["Euro coins arrive", 2002]]),
  set(OLDEST, "When it happened", [["American independence", 1776], ["The French Revolution", 1789], ["The Battle of Waterloo", 1815], ["The Eiffel Tower opens", 1889], ["The first modern Olympics", 1896]]),
  set(OLDEST, "Swiss history", [["The Swiss Confederation", 1291], ["The Swiss federal state", 1848], ["Swiss women get the vote", 1971], ["Switzerland joins the UN", 2002], ["The Gotthard Base Tunnel", 2016]]),
  set(OLDEST, "When each was finished", [["Statue of Liberty", 1886], ["Empire State Building", 1931], ["Golden Gate Bridge", 1937], ["Sydney Opera House", 1973], ["The Shard, London", 2012]]),
  set(OLDEST, "When each was finished", [["The Colosseum", 80, "AD 80"], ["The Taj Mahal", 1650, "1600s"], ["Big Ben’s tower", 1859], ["Tower Bridge", 1894], ["Burj Khalifa", 2010]]),
  set(OLDEST, "Summer Olympics, by host city", [["Sydney", 2000], ["Athens", 2004], ["Beijing", 2008], ["London", 2012], ["Rio de Janeiro", 2016]]),
  set(OLDEST, "Football World Cups, by host", [["USA", 1994], ["France", 1998], ["Germany", 2006], ["Brazil", 2014], ["Qatar", 2022]]),
  set(OLDEST, "Firsts in space", [["Sputnik", 1957], ["First human in space", 1961], ["First Moon landing", 1969], ["First Space Shuttle flight", 1981], ["First piece of the ISS", 1998]]),
  set(BIGGEST, "How wide each planet is", [["Jupiter", 139820, "about 140,000 km"], ["Saturn", 116460, "about 116,000 km"], ["Earth", 12742, "about 12,700 km"], ["Mars", 6779, "about 6,800 km"], ["Mercury", 4879, "about 4,900 km"]]),
  set(["Furthest from the Sun first", "Furthest", "Closest"], "Average distance from the Sun", [["Neptune", 4500, "about 4.5 billion km"], ["Uranus", 2900, "about 2.9 billion km"], ["Saturn", 1430, "about 1.4 billion km"], ["Jupiter", 778, "about 780 million km"], ["Mars", 228, "about 230 million km"]]),
  set(BIGGEST, "Countries by area", [["Russia", 17.1, "17.1 million km²"], ["Canada", 9.98, "10 million km²"], ["Brazil", 8.5, "8.5 million km²"], ["Australia", 7.7, "7.7 million km²"], ["India", 3.3, "3.3 million km²"]]),
  set(BIGGEST, "Countries by area", [["France", 551000, "about 550,000 km²"], ["Spain", 506000, "about 506,000 km²"], ["Germany", 357000, "about 357,000 km²"], ["Italy", 301000, "about 301,000 km²"], ["Switzerland", 41300, "about 41,300 km²"]]),
  set(["Most people first", "Most", "Fewest"], "Countries by population", [["USA", 340, "about 340 million"], ["Brazil", 212, "about 212 million"], ["Japan", 124, "about 124 million"], ["Germany", 84, "about 84 million"], ["Switzerland", 9, "about 9 million"]]),
  set(["Most people first", "Most", "Fewest"], "Swiss cities by population", [["Zurich", 423000, "about 420,000"], ["Geneva", 204000, "about 200,000"], ["Basel", 174000, "about 175,000"], ["Winterthur", 118000, "about 120,000"], ["Lucerne", 83000, "about 85,000"]]),
  set(["Most people first", "Most", "Fewest"], "Swiss cantons by population", [["Zurich", 1600000, "about 1.6 million"], ["Bern", 1050000, "about 1.05 million"], ["Vaud", 830000, "about 830,000"], ["Aargau", 710000, "about 710,000"], ["St. Gallen", 520000, "about 520,000"]]),
  set(BIGGEST, "Swiss cantons by area", [["Graubünden", 7105, "7,105 km²"], ["Bern", 5959, "5,959 km²"], ["Valais", 5224, "5,224 km²"], ["Vaud", 3212, "3,212 km²"], ["Ticino", 2812, "2,812 km²"]]),
  set(BIGGEST, "Lakes by area", [["Lake Geneva", 580, "580 km²"], ["Lake Constance", 536, "536 km²"], ["Lake Neuchâtel", 218, "218 km²"], ["Lake Lucerne", 114, "114 km²"], ["Lake Zurich", 88, "88 km²"]]),
  set(["Highest first", "Highest", "Lowest"], "Swiss mountains", [["Matterhorn", 4478, "4,478 m"], ["Jungfrau", 4158, "4,158 m"], ["Eiger", 3967, "3,967 m"], ["Titlis", 3238, "3,238 m"], ["Pilatus", 2128, "2,128 m"]]),
  set(["Highest first", "Highest", "Lowest"], "Swiss mountains", [["Dufourspitze", 4634, "4,634 m"], ["Dom", 4545, "4,545 m"], ["Mönch", 4107, "4,107 m"], ["Säntis", 2502, "2,502 m"], ["Rigi", 1798, "1,798 m"]]),
  set(["Highest first", "Highest", "Lowest"], "Mountains of the world", [["Mount Everest", 8849, "8,849 m"], ["Kilimanjaro", 5895, "5,895 m"], ["Mont Blanc", 4806, "about 4,806 m"], ["Mount Fuji", 3776, "3,776 m"], ["Zugspitze", 2962, "2,962 m"]]),
  set(TALLEST, "Buildings and towers", [["Burj Khalifa", 828, "828 m"], ["One World Trade Center", 541, "541 m"], ["Empire State Building", 443, "443 m"], ["Eiffel Tower", 330, "330 m"], ["Big Ben’s tower", 96, "96 m"]]),
  set(HEAVIEST, "A grown-up animal", [["Blue whale", 150000, "up to 150 tonnes"], ["African elephant", 6000, "about 6 tonnes"], ["Polar bear", 450, "about 450 kg"], ["Lion", 190, "about 190 kg"], ["Cheetah", 50, "about 50 kg"]]),
  set(TALLEST, "A grown-up, standing", [["Giraffe", 5.5, "up to 5.5 m"], ["African elephant", 3.3, "about 3.3 m"], ["Ostrich", 2.5, "about 2.5 m"], ["An average person", 1.7, "about 1.7 m"], ["Emperor penguin", 1.1, "about 1.1 m"]]),
  set(["Fastest first", "Fastest", "Slowest"], "Top speed", [["Peregrine falcon, diving", 390, "about 390 km/h"], ["Cheetah", 110, "about 110 km/h"], ["Racehorse", 70, "about 70 km/h"], ["Usain Bolt", 44, "about 44 km/h"], ["Garden snail", 0.05, "about 0.05 km/h"]]),
  set(["Most calories first", "Most", "Fewest"], "Calories in 100 g", [["Butter", 717, "about 720 kcal"], ["Milk chocolate", 535, "about 535 kcal"], ["Cheddar", 403, "about 400 kcal"], ["White bread", 265, "about 265 kcal"], ["Apple", 52, "about 52 kcal"]]),
  set(["Most calories first", "Most", "Fewest"], "Calories in 100 g", [["Olive oil", 884, "about 880 kcal"], ["Almonds", 579, "about 580 kcal"], ["Sugar", 387, "about 390 kcal"], ["Cooked rice", 130, "about 130 kcal"], ["Strawberries", 32, "about 32 kcal"]]),
  set(FAR, "As the crow flies", [["New York", 6270, "about 6,270 km"], ["Moscow", 2290, "about 2,290 km"], ["London", 750, "about 750 km"], ["Paris", 435, "about 435 km"], ["Zurich", 95, "about 95 km"]]),
  set(FAR, "As the crow flies", [["Tokyo", 9670, "about 9,670 km"], ["Dubai", 4830, "about 4,830 km"], ["Cairo", 2780, "about 2,780 km"], ["Lisbon", 1630, "about 1,630 km"], ["Milan", 215, "about 215 km"]]),
  set(FAR, "As the crow flies", [["Sydney", 16660, "about 16,660 km"], ["Rio de Janeiro", 9280, "about 9,280 km"], ["Mumbai", 6620, "about 6,620 km"], ["Istanbul", 1840, "about 1,840 km"], ["Rome", 690, "about 690 km"]]),
  set(FAR, "As the crow flies", [["Los Angeles", 9500, "about 9,500 km"], ["Beijing", 8080, "about 8,080 km"], ["Reykjavik", 2610, "about 2,610 km"], ["Stockholm", 1540, "about 1,540 km"], ["Munich", 340, "about 340 km"]]),
  set(FAR, "As the crow flies", [["Cape Town", 9060, "about 9,060 km"], ["Athens", 1660, "about 1,660 km"], ["Edinburgh", 1240, "about 1,240 km"], ["Berlin", 750, "about 750 km"], ["Venice", 410, "about 410 km"]]),
  set(FAR, "Swiss places, as the crow flies", [["St. Moritz", 189, "about 190 km"], ["Geneva", 130, "about 130 km"], ["Zurich", 95, "about 95 km"], ["Interlaken", 43, "about 43 km"], ["Fribourg", 27, "about 27 km"]]),
  set(LONGEST, "Rivers", [["Nile", 6650, "about 6,650 km"], ["Danube", 2850, "about 2,850 km"], ["Rhine", 1230, "about 1,230 km"], ["Rhône", 813, "about 810 km"], ["Aare", 288, "about 290 km"]]),
  set(BIGGEST, "Oceans by area", [["Pacific", 165, "about 165 million km²"], ["Atlantic", 106, "about 106 million km²"], ["Indian", 70, "about 70 million km²"], ["Southern", 21, "about 21 million km²"], ["Arctic", 14, "about 14 million km²"]]),
  set(BIGGEST, "Continents by area", [["Asia", 44.6, "44.6 million km²"], ["Africa", 30.4, "30.4 million km²"], ["North America", 24.7, "24.7 million km²"], ["Antarctica", 14.2, "14.2 million km²"], ["Europe", 10.2, "10.2 million km²"]]),
  set(["Most people first", "Most", "Fewest"], "Continents by population", [["Asia", 4800, "about 4.8 billion"], ["Africa", 1500, "about 1.5 billion"], ["Europe", 745, "about 745 million"], ["North America", 600, "about 600 million"], ["South America", 440, "about 440 million"]]),
  set(["Most legs first", "Most", "Fewest"], "How many legs", [["Centipede", 30, "30 or more"], ["Spider", 8, "8"], ["Ant", 6, "6"], ["Cat", 4, "4"], ["Penguin", 2, "2"]]),
  set(BIGGEST, "Computer memory", [["Terabyte", 1e12, "a million million bytes"], ["Gigabyte", 1e9, "a billion bytes"], ["Megabyte", 1e6, "a million bytes"], ["Kilobyte", 1e3, "a thousand bytes"], ["Byte", 1, "one byte"]]),
  set(LONGEST, "Units of length", [["Mile", 1609, "1,609 m"], ["Kilometre", 1000, "1,000 m"], ["Metre", 1, "100 cm"], ["Foot", 0.3048, "30.5 cm"], ["Inch", 0.0254, "2.54 cm"]]),
  set(["Most players first", "Most", "Fewest"], "Players per team on the field", [["Rugby union", 15, "15"], ["Football", 11, "11"], ["Baseball", 9, "9"], ["Ice hockey", 6, "6"], ["Basketball", 5, "5"]]),
  set(["Most strings first", "Most", "Fewest"], "How many strings", [["Piano", 230, "about 230"], ["Concert harp", 47, "47"], ["Guitar", 6, "6"], ["Banjo", 5, "5"], ["Violin", 4, "4"]]),
  set(["Most sides first", "Most", "Fewest"], "How many sides", [["Octagon", 8, "8"], ["Hexagon", 6, "6"], ["Pentagon", 5, "5"], ["Square", 4, "4"], ["Triangle", 3, "3"]]),
  set(OLDEST, "The year each was born", [["Queen Elizabeth II", 1926], ["Barack Obama", 1961], ["Roger Federer", 1981], ["Taylor Swift", 1989], ["Emma Raducanu", 2002]]),
  set(OLDEST, "The year each was born", [["Madonna", 1958], ["Beyoncé", 1981], ["Rihanna", 1988], ["Ariana Grande", 1993], ["Billie Eilish", 2001]]),
  set(OLDEST, "The year each was born", [["Tom Hanks", 1956], ["Brad Pitt", 1963], ["Leonardo DiCaprio", 1974], ["Ryan Gosling", 1980], ["Zendaya", 1996]]),
  set(OLDEST, "The year each was born", [["Leonardo da Vinci", 1452], ["William Shakespeare", 1564], ["Isaac Newton", 1642], ["Mozart", 1756], ["Albert Einstein", 1879]]),
  set(OLDEST, "When each was invented", [["The printing press", 1440, "about 1440"], ["The telescope", 1608], ["The steam locomotive", 1804], ["The bicycle", 1817, "1817 (no pedals yet)"], ["The car", 1886, "1886 (Benz)"]]),
  set(OLDEST, "When each company was founded", [["Nestlé", 1866], ["Toblerone", 1908], ["Disney", 1923], ["LEGO", 1932], ["IKEA", 1943]]),
  set(OLDEST, "When each drink was created", [["Coca-Cola", 1886], ["Pepsi", 1893], ["Fanta", 1940], ["Rivella", 1952], ["Red Bull", 1987]]),
  set(["Spiciest first", "Spiciest", "Mildest"], "Scoville heat units", [["Carolina Reaper", 1600000, "about 1,600,000"], ["Ghost pepper", 1000000, "about 1,000,000"], ["Habanero", 200000, "about 200,000"], ["Jalapeño", 5000, "about 5,000"], ["Bell pepper", 0, "0"]]),
  set(["Hottest first", "Hottest", "Coldest"], "Temperature", [["The Sun’s surface", 5500, "about 5,500 °C"], ["Lava", 1100, "about 1,100 °C"], ["A hot oven", 220, "about 220 °C"], ["Boiling water", 100, "100 °C"], ["Your body", 37, "37 °C"]]),
  set(["Coldest first", "Coldest", "Warmest"], "Temperature", [["Liquid nitrogen", -196, "−196 °C"], ["Antarctica’s coldest day", -89, "−89 °C"], ["Dry ice", -78, "−78 °C"], ["A freezer", -18, "−18 °C"], ["A fridge", 4, "about 4 °C"]]),
  set(["Loudest first", "Loudest", "Quietest"], "How loud, up close", [["A jet taking off", 140, "about 140 dB"], ["A rock concert", 110, "about 110 dB"], ["A lawnmower", 90, "about 90 dB"], ["A normal chat", 60, "about 60 dB"], ["A whisper", 30, "about 30 dB"]]),
  set(LONGEST, "How long each one lasts", [["A decade", 3652, "10 years"], ["A leap year", 366, "366 days"], ["A month", 30, "28 to 31 days"], ["A fortnight", 14, "14 days"], ["A week", 7, "7 days"]]),
  set(["Deepest first", "Deepest", "Shallowest"], "At the deepest point", [["Mariana Trench", 10900, "about 10,900 m"], ["Lake Baikal", 1642, "1,642 m"], ["Lake Maggiore", 372, "372 m"], ["Lake Geneva", 310, "310 m"], ["Lake Zurich", 136, "136 m"]]),
  set(LONGEST, "Length of their border with Switzerland", [["Italy", 744, "about 744 km"], ["France", 572, "about 572 km"], ["Germany", 362, "about 362 km"], ["Austria", 180, "about 180 km"], ["Liechtenstein", 41, "about 41 km"]]),
  set(OLDEST, "Swiss inventions", [["Milk chocolate", 1875], ["The Swiss Army knife", 1891], ["Ovomaltine", 1904], ["Velcro", 1955, "1955 (patent)"], ["The web, at CERN", 1989]]),
  set(["Hardest first", "Hardest", "Softest"], "The Mohs hardness scale (1 to 10)", [["Diamond", 10, "10"], ["Sapphire", 9, "9"], ["Topaz", 8, "8"], ["Quartz", 7, "7"], ["Talc", 1, "1"]]),
  set(BIGGEST, "How wide each one is", [["The Sun", 1392000, "about 1.4 million km"], ["Jupiter", 139820, "about 140,000 km"], ["Earth", 12742, "about 12,700 km"], ["The Moon", 3474, "about 3,500 km"], ["Pluto", 2377, "about 2,400 km"]]),
  set(BIGGEST, "How wide each ball is", [["Basketball", 24, "about 24 cm"], ["Football", 22, "about 22 cm"], ["Tennis ball", 6.7, "about 6.7 cm"], ["Golf ball", 4.27, "4.3 cm"], ["Table tennis ball", 4, "4.0 cm"]]),
  set(["Earliest in the year first", "January", "December"], "The date", [["Valentine’s Day", 45, "14 February"], ["April Fools’ Day", 91, "1 April"], ["Swiss National Day", 213, "1 August"], ["Halloween", 304, "31 October"], ["Christmas Day", 359, "25 December"]]),
  set(["Earliest in the year first", "January", "December"], "When each star sign starts", [["Aries", 80, "21 March"], ["Taurus", 110, "20 April"], ["Leo", 204, "23 July"], ["Scorpio", 296, "23 October"], ["Capricorn", 356, "22 December"]]),
  set(["Earliest New Year first", "First", "Last"], "When midnight strikes on 31 December", [["Sydney", 10, "10 hours before us"], ["Tokyo", 8, "8 hours before us"], ["Dubai", 3, "3 hours before us"], ["Zurich", 0, "us"], ["New York", -6, "6 hours after us"]]),
  set(["Fastest first", "Fastest", "Slowest"], "Top speed", [["Light", 1080000000, "about 1 billion km/h"], ["Sound", 1235, "about 1,235 km/h"], ["A passenger jet", 900, "about 900 km/h"], ["A Formula 1 car", 350, "about 350 km/h"], ["A cheetah", 110, "about 110 km/h"]]),
  set(["Highest first", "Highest", "Lowest"], "Height above sea level", [["The space station", 400000, "about 400 km"], ["A plane at cruising height", 11000, "about 11 km"], ["Top of Mount Everest", 8849, "8,849 m"], ["Top of the Matterhorn", 4478, "4,478 m"], ["Top of Säntis", 2502, "2,502 m"]]),
  set(["Smallest first", "Smallest", "Biggest"], "Size", [["An atom", 1e-10, "about 0.1 nanometres"], ["A virus", 1e-7, "about 100 nanometres"], ["A bacterium", 2e-6, "about 2 micrometres"], ["A grain of sand", 5e-4, "about 0.5 mm"], ["An ant", 5e-3, "about 5 mm"]]),
  set(["Smallest first", "Smallest", "Biggest"], "Countries by area", [["Vatican City", 0.49, "under 1 km²"], ["Monaco", 2, "2 km²"], ["San Marino", 61, "61 km²"], ["Liechtenstein", 160, "160 km²"], ["Luxembourg", 2586, "2,586 km²"]]),
  set(OLDEST, "When each first appeared", [["Mickey Mouse", 1928], ["Bugs Bunny", 1940], ["Snoopy", 1950], ["Pikachu", 1996], ["SpongeBob", 1999]]),
  set(OLDEST, "When each game came out", [["Pong", 1972], ["Pac-Man", 1980], ["Tetris", 1984], ["Pokémon Red and Green", 1996], ["Fortnite", 2017]]),
  set(OLDEST, "When each toy was born", [["Teddy bear", 1902], ["Barbie", 1959], ["Rubik’s Cube", 1974], ["Game Boy", 1989], ["Tamagotchi", 1996]]),
  set(OLDEST, "When each fashion house was founded", [["Louis Vuitton", 1854], ["Chanel", 1910], ["Prada", 1913], ["Gucci", 1921], ["Zara", 1975]]),
  set(OLDEST, "When each car first came out", [["Ford Model T", 1908], ["VW Beetle", 1938], ["Fiat 500", 1957], ["Mini", 1959], ["Tesla Model S", 2012]]),
  set(HEAVIEST, "A typical grown-up dog", [["Great Dane", 60, "about 60 kg"], ["Labrador", 30, "about 30 kg"], ["Beagle", 10, "about 10 kg"], ["Pug", 7, "about 7 kg"], ["Chihuahua", 2, "about 2 kg"]]),
  set(HEAVIEST, "A typical grown-up bird", [["Ostrich", 110, "about 110 kg"], ["Emu", 40, "about 40 kg"], ["Mute swan", 11, "about 11 kg"], ["Chicken", 2.5, "about 2.5 kg"], ["Hummingbird", 0.004, "about 4 g"]]),
  set(LONGEST, "Swiss tunnels", [["Gotthard Base Tunnel", 57.1, "57 km"], ["Lötschberg Base Tunnel", 34.6, "35 km"], ["Simplon Tunnel", 19.8, "20 km"], ["Gotthard Road Tunnel", 16.9, "17 km"], ["Seelisberg Tunnel", 9.3, "9 km"]]),
  set(OLDEST, "When each park opened", [["Disneyland", 1955], ["Walt Disney World", 1971], ["Tokyo Disneyland", 1983], ["Disneyland Paris", 1992], ["Hong Kong Disneyland", 2005]]),
  set(["Most titles first", "Most", "Fewest"], "Grand Slam singles titles", [["Rafael Nadal", 22, "22"], ["Roger Federer", 20, "20"], ["Pete Sampras", 14, "14"], ["Björn Borg", 11, "11"], ["Andre Agassi", 8, "8"]])
];

const ORDER = seededShuffle(SETS.map((_, index) => index), "sort-it");

function normalize(value) {
  return { days: { ...(value?.days || {}) } };
}

function assignDay(doc, day, now) {
  if (doc.days[day]) return false;
  const chosen = SETS[ORDER[dayNumber(day) % ORDER.length]];
  const items = chosen.items.map(([label, value, shown]) => ({ label, shown: shown ?? String(value) }));
  // The order they show in at the start: mixed, and never already right.
  let shown = seededShuffle([0, 1, 2, 3, 4], `sort:${day}`);
  if (shown.every((at, index) => at === index)) shown = [1, 2, 3, 4, 0];
  doc.days[day] = { rule: chosen.rule, about: chosen.about, top: chosen.top, bottom: chosen.bottom, items, shown, players: {}, at: now };
  const others = Object.keys(doc.days).filter((key) => key !== day).sort();
  for (const old of others.slice(0, Math.max(0, others.length + 1 - MAX_DAYS))) delete doc.days[old];
  return true;
}

const playerOf = (entry, author) => entry?.players?.[author] || null;
const doneOf = (entry, author) => Boolean(playerOf(entry, author)?.doneAt);
// `placed` lists, top to bottom, where each thing really belongs (0 = first).
const rightOf = (placed) => placed.reduce((count, at, index) => count + (at === index ? 1 : 0), 0);

export function sortResult(entry) {
  const her = playerOf(entry, "her");
  const sender = playerOf(entry, "sender");
  if (!her?.doneAt || !sender?.doneAt) return null;
  const right = { her: rightOf(her.placed), sender: rightOf(sender.placed) };
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
    // The rule and the things only once I started (mixed up, no values); the right order once I'm done.
    puzzle: started ? { rule: entry.rule, about: entry.about, top: entry.top, bottom: entry.bottom, items: entry.shown.map((at) => entry.items[at].label) } : null,
    answer: done ? entry.items : null,
    mine: done ? { placed: mine.placed, ms: mine.ms, right: rightOf(mine.placed) } : null,
    theirs: done && theirs?.doneAt ? { placed: theirs.placed, ms: theirs.ms, right: rightOf(theirs.placed) } : null,
    theirsDone: Boolean(theirs?.doneAt),
    result: done ? sortResult(entry) : null
  };
}

export function sortStats(doc, today) {
  const days = Object.keys(doc.days).filter((day) => day <= today).sort();
  const wins = { her: 0, sender: 0 };
  const perfect = { her: 0, sender: 0 };
  let daysPlayed = 0;
  for (const day of days) {
    const entry = doc.days[day];
    for (const author of AUTHORS) {
      const player = playerOf(entry, author);
      if (player?.doneAt && rightOf(player.placed) === COUNT) perfect[author] += 1;
    }
    const result = sortResult(entry);
    if (!result) continue;
    daysPlayed += 1;
    if (result.winner !== "tie") wins[result.winner] += 1;
  }
  return { daysPlayed, wins, perfect };
}

function view(doc, day, author, today, now) {
  const history = Object.keys(doc.days)
    .filter((key) => key < day && doneOf(doc.days[key], author))
    .sort()
    .reverse()
    .slice(0, HISTORY_DAYS)
    .map((key) => ({ day: key, result: sortResult(doc.days[key]) }));
  return { ...dayView(doc.days[day], day, author, now), count: COUNT, stats: sortStats(doc, today), history };
}

// The order I sent: the 5 shown positions (0–4), top to bottom, each once.
function parseOrder(value) {
  if (!Array.isArray(value) || value.length !== COUNT || !value.every((at) => Number.isInteger(at) && at >= 0 && at < COUNT) || new Set(value).size !== COUNT) {
    throw new GameError(400, "Put all 5 in an order first.");
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
      throw new GameError(404, "There was no sort it that day.");
    }
    return view(doc, day, author, ctx.today, ctx.now);
  });
}

async function act(ctx) {
  const author = parseAuthor(ctx.body.author);
  const day = parseDay(ctx.body.day, ctx.today);
  if (day !== ctx.today) throw new GameError(409, "A new day started. Here’s today’s sort it.");
  const action = ctx.body.action;
  if (!["start", "submit"].includes(action)) throw new GameError(400, "Unknown action.");
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    assignDay(doc, day, ctx.now);
    const entry = doc.days[day];
    const player = { ...(playerOf(entry, author) || {}) };
    if (player.doneAt) throw new GameError(409, "You already played today’s sort it.");
    if (action === "start") {
      if (!player.startedAt) player.startedAt = ctx.now;
    } else {
      if (!player.startedAt) throw new GameError(409, "Tap Start first.");
      const order = parseOrder(ctx.body.order);
      const seen = Date.parse(ctx.now) - Date.parse(player.startedAt);
      const told = Number(ctx.body.ms);
      const ms = Math.round(Math.max(0, Math.min(MAX_MS, Number.isFinite(told) && told > 0 ? Math.min(told, seen) : seen)));
      Object.assign(player, { placed: order.map((at) => entry.shown[at]), ms, doneAt: ctx.now });
    }
    entry.players = { ...(entry.players || {}), [author]: player };
    await txn.put(KEY, doc);
    let awarded = 0;
    if (action === "submit") {
      awarded += await award(txn, `sort:${day}:play:${author}`, author, 1);
      const result = sortResult(entry);
      if (result) {
        for (const person of AUTHORS) {
          let hearts = result.winner === person ? 2 : result.winner === "tie" ? 1 : 0;
          if (result.right[person] === COUNT) hearts += 1;
          const delta = await award(txn, `sort:${day}:score:${person}`, person, hearts);
          if (person === author) awarded += delta;
        }
      }
      awarded += await markActive(txn, author, ctx.today);
    }
    return { ...view(doc, day, author, ctx.today, ctx.now), awarded };
  });
}

export const routes = {
  "/games/sort": async (ctx) => {
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
  let line = theirs ? "{them} played. Your turn" : "Put 5 things in order";
  if (mine && theirs) {
    const result = sortResult(entry);
    status = "done";
    line = result.winner === "tie" ? "A tie today" : `${result.winner === ctx.author ? "{me}" : "{them}"} won today`;
  } else if (mine) {
    status = "waiting";
    line = "Waiting for {them}";
  }
  const stats = sortStats(doc, ctx.today);
  return {
    id: "sort",
    title: "Sort it",
    icon: "arrow-down-up",
    step: "sort",
    status,
    line,
    board: [
      { label: "Sort it wins", her: stats.wins.her, sender: stats.wins.sender },
      { label: "Perfect sorts", her: stats.perfect.her, sender: stats.perfect.sender }
    ]
  };
}
