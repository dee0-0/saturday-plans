// Map pin: 3 Swiss places a day (one easy, one medium, one hard). We both tap the map where
// we think each one is; the closer pin wins the place, and whoever wins more places wins the
// day. One place at a time: the real spot (and a little clue) shows right after you pinned
// it, and the other one's pins only once we both pinned all three.
import { GameError, AUTHORS, parseAuthor, parseDay, award, markActive, other, dayNumber, seededShuffle } from "./common.js";

const KEY = "games:pin";
const MAX_DAYS = 400;
const PER_DAY = 3;
const HISTORY_DAYS = 7;
// A pin this close to the real spot earns a bonus heart.
export const NEAR_KM = 10;
// Where a pin may go: Switzerland and a generous margin around it (the map shows a bit more).
const AREA = { south: 45, north: 48.6, west: 5, east: 11.4 };

// [name, lat, lng, kind, clue]. Points checked against OpenStreetMap (to well under 1 km);
// a lake's point is out on the water, a glacier's on the ice, a town's in its centre.
export const PLACES = {
  easy: [
    ["Bern", 46.948, 7.447, "city", "The capital, in a loop of the Aare"],
    ["Zurich", 47.377, 8.540, "city", "The biggest city, at the end of Lake Zurich"],
    ["Geneva", 46.204, 6.143, "city", "Where the Rhône leaves Lake Geneva"],
    ["Basel", 47.558, 7.588, "city", "On the Rhine, right next to France and Germany"],
    ["Lausanne", 46.520, 6.633, "city", "Hilly city on Lake Geneva, home of the Olympic Museum"],
    ["Lucerne", 47.050, 8.309, "city", "Chapel Bridge city on Lake Lucerne"],
    ["Lugano", 46.004, 8.951, "city", "The biggest city in Ticino, on Lake Lugano"],
    ["St. Gallen", 47.424, 9.377, "city", "Abbey library city in eastern Switzerland"],
    ["Winterthur", 47.500, 8.724, "city", "Big city just north-east of Zurich"],
    ["Biel/Bienne", 47.137, 7.247, "city", "Bilingual watch city at the end of Lake Biel"],
    ["Thun", 46.758, 7.628, "town", "Castle town where the Aare leaves Lake Thun"],
    ["Fribourg", 46.806, 7.162, "city", "Bilingual old town on the Saane"],
    ["Neuchâtel", 46.990, 6.931, "city", "On the north-west shore of Lake Neuchâtel"],
    ["Sion", 46.233, 7.360, "town", "Capital of Valais, with two castle hills"],
    ["Chur", 46.850, 9.532, "town", "Capital of Graubünden, one of the oldest towns in the country"],
    ["Schaffhausen", 47.697, 8.634, "town", "Munot fortress town on the Rhine"],
    ["Zug", 47.172, 8.517, "town", "Cherry cake town on Lake Zug"],
    ["Bellinzona", 46.195, 9.024, "town", "Capital of Ticino, guarded by three castles"],
    ["Locarno", 46.170, 8.795, "town", "Film festival town on Lake Maggiore"],
    ["Montreux", 46.433, 6.911, "town", "Jazz festival town on Lake Geneva"],
    ["Interlaken", 46.686, 7.863, "town", "Between Lake Thun and Lake Brienz"],
    ["Zermatt", 46.020, 7.749, "village", "Car-free village below the Matterhorn"],
    ["St. Moritz", 46.498, 9.838, "village", "Engadin resort, host of the 1928 and 1948 Winter Olympics"],
    ["Davos", 46.800, 9.830, "town", "Mountain town of the World Economic Forum"],
    ["Grindelwald", 46.624, 8.034, "village", "Glacier village below the Eiger"],
    ["Lauterbrunnen", 46.594, 7.909, "village", "The valley of 72 waterfalls"],
    ["Gruyères", 46.584, 7.082, "village", "Hilltop castle town, famous for its cheese"],
    ["Appenzell", 47.331, 9.409, "village", "Painted houses, cheese and a vote in the open air"],
    ["Engelberg", 46.821, 8.401, "village", "Monastery village below the Titlis"],
    ["Matterhorn", 45.976, 7.659, "mountain", "4,478 m, on the border with Italy"],
    ["Eiger", 46.578, 8.005, "mountain", "Famous for its north face, above Grindelwald"],
    ["Pilatus", 46.979, 8.254, "mountain", "Lucerne's mountain, with the steepest cogwheel railway in the world"],
    ["Rigi", 47.056, 8.485, "mountain", "The queen of the mountains, above Lake Lucerne"],
    ["Säntis", 47.249, 9.343, "mountain", "Highest peak of the Alpstein, 2,502 m"],
    ["Titlis", 46.772, 8.437, "mountain", "Glacier peak above Engelberg, with a rotating gondola"],
    ["Jungfraujoch", 46.548, 7.983, "sight", "Top of Europe: the highest railway station in Europe"],
    ["Schilthorn", 46.557, 7.835, "mountain", "Piz Gloria, the revolving James Bond restaurant"],
    ["Gornergrat", 45.983, 7.785, "sight", "Cogwheel railway up to a Matterhorn view"],
    ["Rhine Falls", 47.678, 8.615, "waterfall", "The great waterfall of the Rhine, near Schaffhausen"],
    ["Château de Chillon", 46.414, 6.928, "castle", "Castle on a rock in Lake Geneva, near Montreux"],
    ["Oeschinensee", 46.498, 7.727, "lake", "Turquoise mountain lake above Kandersteg"],
    ["Aletsch Glacier", 46.452, 8.078, "glacier", "The longest glacier in the Alps"],
    ["CERN", 46.234, 6.053, "sight", "The particle physics lab on the French border near Geneva"],
    ["Lake Geneva", 46.450, 6.550, "lake", "Shared with France, from Geneva past Montreux"],
    ["Lake Constance", 47.610, 9.430, "lake", "Shared with Germany and Austria"],
    ["Lake Lucerne", 46.983, 8.505, "lake", "The lake of the four forest cantons"],
    ["Lake Zurich", 47.245, 8.685, "lake", "Long lake from Zurich towards Rapperswil"],
    ["Lake Thun", 46.709, 7.674, "lake", "Between Thun and Interlaken"],
    ["Lake Neuchâtel", 46.875, 6.813, "lake", "The biggest lake entirely in Switzerland"],
    ["Lake Brienz", 46.724, 7.961, "lake", "Turquoise lake east of Interlaken"],
    ["Lake Lugano", 45.985, 8.965, "lake", "Winding lake in Ticino, partly in Italy"],
    ["Murten", 46.928, 7.117, "town", "Walled medieval town on Lake Murten"],
    ["Stein am Rhein", 47.659, 8.859, "town", "Old town of painted houses on the Rhine"],
    ["Einsiedeln", 47.128, 8.752, "village", "Big baroque abbey with the Black Madonna"],
    ["Gstaad", 46.475, 7.286, "village", "Chic resort in the Bernese Oberland"],
    ["Creux du Van", 46.932, 6.723, "sight", "A huge rock amphitheatre in the Jura"],
    ["Rütli", 46.968, 8.593, "sight", "The meadow on Lake Uri where Switzerland was founded, says the legend"],
    ["Ascona", 46.157, 8.773, "town", "Lakeside town next to Locarno"],
    ["Vevey", 46.461, 6.843, "town", "A giant fork in the lake and a Charlie Chaplin statue"],
    ["Solothurn", 47.208, 7.537, "town", "Baroque town that loves the number 11"],
    ["Nyon", 46.383, 6.239, "town", "Lake Geneva town with UEFA's headquarters"],
    ["Mürren", 46.559, 7.892, "village", "Car-free cliff village above Lauterbrunnen"],
    ["Wengen", 46.605, 7.922, "village", "Car-free village of the Lauberhorn ski race"],
    ["Saas-Fee", 46.108, 7.928, "village", "Car-free glacier village, the pearl of the Alps"],
    ["Andermatt", 46.636, 8.594, "village", "Village at the crossroads of the Gotthard, Furka and Oberalp"],
    ["Gotthard Pass", 46.559, 8.561, "pass", "The historic pass between Uri and Ticino"],
    ["Landwasser Viaduct", 46.681, 9.676, "sight", "Curved railway bridge that runs straight into a cliff tunnel"]
  ],
  medium: [
    ["Aarau", 47.392, 8.044, "town", "Capital of Aargau, the town of beautiful gables"],
    ["Olten", 47.350, 7.903, "town", "The railway hub between Bern, Basel and Zurich"],
    ["Baden", 47.473, 8.307, "town", "Spa town on the Limmat"],
    ["Rapperswil", 47.226, 8.818, "town", "Town of roses on Lake Zurich"],
    ["Schwyz", 47.021, 8.653, "town", "Gave Switzerland its name and its flag"],
    ["Altdorf", 46.881, 8.644, "town", "William Tell's town, capital of Uri"],
    ["Glarus", 47.040, 9.068, "town", "Capital of the canton that votes in the open air"],
    ["Delémont", 47.364, 7.344, "town", "Capital of Jura, the youngest canton"],
    ["La Chaux-de-Fonds", 47.100, 6.826, "town", "Watchmaking town, birthplace of Le Corbusier"],
    ["Yverdon-les-Bains", 46.778, 6.641, "town", "Spa town at the south-west end of Lake Neuchâtel"],
    ["Martigny", 46.100, 7.073, "town", "Roman town at the big bend of the Rhône"],
    ["Brig", 46.316, 7.988, "town", "Stockalper Palace town at the foot of the Simplon"],
    ["Kandersteg", 46.495, 7.675, "village", "Mountain village at the Lötschberg car train"],
    ["Adelboden", 46.492, 7.560, "village", "Ski World Cup village in the Bernese Oberland"],
    ["Spiez", 46.686, 7.680, "town", "Castle bay on Lake Thun"],
    ["Brienz", 46.754, 8.037, "village", "Woodcarving village on Lake Brienz"],
    ["Leukerbad", 46.379, 7.627, "village", "Thermal baths below the Gemmi cliffs"],
    ["Verbier", 46.096, 7.228, "village", "Big ski resort in Valais"],
    ["Crans-Montana", 46.311, 7.481, "village", "Sunny ski resort above Sierre"],
    ["Arosa", 46.778, 9.679, "village", "Resort at the end of a winding valley above Chur"],
    ["Laax", 46.806, 9.258, "village", "Snowboard paradise in Graubünden"],
    ["Klosters", 46.870, 9.880, "village", "Village next to Davos, a favourite of the British royals"],
    ["Scuol", 46.797, 10.299, "village", "Spa village in the Lower Engadin"],
    ["Bad Ragaz", 47.006, 9.503, "village", "Thermal spa town in the Rhine valley"],
    ["Maienfeld", 47.009, 9.530, "village", "Heidi's home, among the vineyards"],
    ["Chiasso", 45.832, 9.032, "town", "The southernmost town, on the Italian border"],
    ["Kreuzlingen", 47.650, 9.175, "town", "Twin town of Konstanz on Lake Constance"],
    ["Brunnen", 46.994, 8.606, "village", "Lakeside village where Lake Lucerne turns south"],
    ["Pontresina", 46.491, 9.902, "village", "Engadin village at the foot of the Bernina"],
    ["Mönch", 46.558, 7.997, "mountain", "The monk, between the Eiger and the Jungfrau"],
    ["Jungfrau", 46.537, 7.963, "mountain", "4,158 m, the maiden of the Bernese Alps"],
    ["Dufourspitze", 45.937, 7.867, "mountain", "The highest summit in Switzerland, 4,634 m"],
    ["Piz Bernina", 46.382, 9.908, "mountain", "The only 4,000 m peak of the Eastern Alps"],
    ["Niesen", 46.645, 7.651, "mountain", "The pyramid mountain above Lake Thun"],
    ["Stanserhorn", 46.929, 8.340, "mountain", "Up by an open-top double-decker cable car"],
    ["Brienzer Rothorn", 46.787, 8.047, "mountain", "Steam cogwheel railway up from Brienz"],
    ["Kleine Scheidegg", 46.585, 7.961, "pass", "Train stop right below the Eiger north face"],
    ["Monte San Salvatore", 45.977, 8.947, "mountain", "Funicular mountain above Lugano"],
    ["Uetliberg", 47.349, 8.491, "mountain", "Zurich's home mountain"],
    ["Gurten", 46.918, 7.444, "mountain", "Bern's home hill, with a summer festival"],
    ["Moléson", 46.548, 7.018, "mountain", "The peak above Gruyères"],
    ["Chasseral", 47.133, 7.059, "mountain", "Top of the Bernese Jura, with a big antenna"],
    ["Furka Pass", 46.573, 8.415, "pass", "James Bond drove here in Goldfinger"],
    ["Grimsel Pass", 46.561, 8.338, "pass", "Pass from the Haslital down to the Goms"],
    ["Susten Pass", 46.729, 8.447, "pass", "Pass between Bern and Uri"],
    ["Great St Bernard Pass", 45.869, 7.170, "pass", "The hospice of the famous rescue dogs"],
    ["Simplon Pass", 46.250, 8.031, "pass", "Napoleon's road from Brig towards Italy"],
    ["Julier Pass", 46.472, 9.729, "pass", "Road pass into the Upper Engadin"],
    ["Bernina Pass", 46.411, 10.027, "pass", "The Bernina Express crosses it"],
    ["Lake Zug", 47.100, 8.490, "lake", "Lake between Zug and the Rigi"],
    ["Lake Walen", 47.122, 9.210, "lake", "Below the steep Churfirsten cliffs"],
    ["Lake Murten", 46.935, 7.075, "lake", "Small lake next to Lake Neuchâtel"],
    ["Lake Biel", 47.090, 7.180, "lake", "St. Peter's Island lies in it"],
    ["Lake Sils", 46.415, 9.730, "lake", "Upper Engadin lake below the Maloja"],
    ["Blausee", 46.532, 7.665, "lake", "Tiny blue lake in a forest near Kandersteg"],
    ["Caumasee", 46.820, 9.296, "lake", "Turquoise forest lake near Flims"],
    ["Verzasca Dam", 46.196, 8.847, "sight", "The GoldenEye bungee jump"],
    ["Trümmelbach Falls", 46.569, 7.913, "waterfall", "Glacier waterfalls inside the mountain"],
    ["Reichenbach Falls", 46.714, 8.183, "waterfall", "Where Sherlock Holmes fell"],
    ["Aare Gorge", 46.719, 8.212, "gorge", "A narrow gorge near Meiringen"],
    ["Rhône Glacier", 46.619, 8.400, "glacier", "The source of the Rhône, by the Furka Pass road"],
    ["Swissminiatur", 45.955, 8.950, "sight", "All of Switzerland in miniature, on Lake Lugano"],
    ["Ballenberg", 46.749, 8.080, "sight", "Open-air museum of old Swiss houses"],
    ["Lavaux vineyards", 46.491, 6.748, "sight", "Vineyard terraces above Lake Geneva"],
    ["Aescher", 47.283, 9.415, "sight", "The guesthouse built into a cliff"],
    ["Seealpsee", 47.268, 9.401, "lake", "Alpstein lake below the Ebenalp"],
    ["Lindt Home of Chocolate", 47.318, 8.552, "sight", "Chocolate museum with a giant chocolate fountain, on Lake Zurich"]
  ],
  hard: [
    ["Frauenfeld", 47.557, 8.899, "town", "Capital of Thurgau"],
    ["Herisau", 47.386, 9.279, "town", "Capital of Appenzell Ausserrhoden"],
    ["Liestal", 47.484, 7.734, "town", "Capital of Basel-Country"],
    ["Sarnen", 46.896, 8.246, "town", "Capital of Obwalden, on Lake Sarnen"],
    ["Stans", 46.958, 8.366, "town", "Capital of Nidwalden"],
    ["Burgdorf", 47.059, 7.628, "town", "Castle town at the gate to the Emmental"],
    ["Langenthal", 47.215, 7.786, "town", "Biggest town of the Upper Aargau, in canton Bern"],
    ["Bulle", 46.619, 7.057, "town", "Main town of the Gruyère region"],
    ["Estavayer-le-Lac", 46.849, 6.846, "town", "Medieval town on the south shore of Lake Neuchâtel"],
    ["Mendrisio", 45.870, 8.982, "town", "Wine town in the far south of Ticino"],
    ["Morges", 46.511, 6.498, "town", "Tulip festival town on Lake Geneva"],
    ["Le Locle", 47.056, 6.749, "town", "Watchmaking town near the French border"],
    ["Porrentruy", 47.416, 7.075, "town", "Castle town of the Ajoie, deep in the Jura"],
    ["Sierre", 46.292, 7.535, "town", "Sunny wine town where French meets German in Valais"],
    ["Visp", 46.294, 7.882, "town", "Valais town where the valley to Zermatt begins"],
    ["Champéry", 46.177, 6.870, "village", "Village below the Dents du Midi"],
    ["Aigle", 46.318, 6.970, "town", "Wine town with a castle among the vines"],
    ["Wil", 47.461, 9.045, "town", "Old town in canton St. Gallen"],
    ["Rorschach", 47.478, 9.493, "town", "Harbour town on Lake Constance"],
    ["Disentis", 46.704, 8.852, "village", "Big Benedictine monastery in the Surselva"],
    ["Airolo", 46.529, 8.610, "village", "The Ticino end of the Gotthard road tunnel"],
    ["Biasca", 46.359, 8.970, "town", "Ticino town where the Blenio valley meets the Leventina"],
    ["Lenzburg", 47.388, 8.177, "town", "Castle on a hill, home of Hero jam"],
    ["Zofingen", 47.288, 7.946, "town", "Old town in western Aargau"],
    ["Uster", 47.348, 8.719, "town", "Town near Lake Greifen"],
    ["Langnau im Emmental", 46.940, 7.787, "village", "The main village of the Emmental"],
    ["Lenk", 46.457, 7.443, "village", "At the end of the Simmental valley"],
    ["Château-d'Œx", 46.475, 7.131, "village", "Hot-air balloon festival every winter"],
    ["Les Diablerets", 46.349, 7.159, "village", "Village below Glacier 3000"],
    ["Soglio", 46.341, 9.537, "village", "Stone village on a sunny terrace in the Bregaglia"],
    ["Guarda", 46.776, 10.152, "village", "Engadin village of the Schellen-Ursli story"],
    ["Morcote", 45.924, 8.917, "village", "Pretty lakeside village south of Lugano"],
    ["Saint-Ursanne", 47.364, 7.155, "village", "Medieval town on a loop of the Doubs"],
    ["Avenches", 46.882, 7.042, "town", "Roman capital of Helvetia, with an amphitheatre"],
    ["Romont", 46.697, 6.919, "town", "Hilltop town with a stained-glass museum"],
    ["Payerne", 46.821, 6.938, "town", "Abbey town with an air force base"],
    ["Vallorbe", 46.712, 6.379, "town", "Jura town with caves, at the French border"],
    ["Rheinfelden", 47.554, 7.794, "town", "Old town on the Rhine, home of Feldschlösschen beer"],
    ["Wädenswil", 47.229, 8.672, "town", "Town on the south shore of Lake Zurich"],
    ["Küssnacht", 47.085, 8.442, "village", "Where William Tell shot Gessler, says the legend"],
    ["Vitznau", 47.010, 8.484, "village", "Start of Europe's first mountain railway"],
    ["Flüelen", 46.902, 8.623, "village", "Port at the southern end of Lake Lucerne"],
    ["Göschenen", 46.668, 8.587, "village", "The Uri end of the Gotthard tunnels"],
    ["Ilanz", 46.774, 9.205, "town", "The first town on the Rhine"],
    ["Thusis", 46.697, 9.440, "village", "Village at the start of the Viamala gorge"],
    ["Zernez", 46.698, 10.093, "village", "Gateway to the Swiss National Park"],
    ["Samedan", 46.533, 9.872, "village", "Upper Engadin village with the highest airport in Europe"],
    ["Maloja", 46.404, 9.695, "village", "Pass village at the head of the Engadin"],
    ["Müstair", 46.629, 10.448, "village", "UNESCO monastery at the Italian border"],
    ["Brusio", 46.259, 10.124, "village", "The spiral viaduct of the Bernina railway"],
    ["Poschiavo", 46.326, 10.059, "village", "Italian-speaking valley town on the Bernina line"],
    ["Wildhaus", 47.205, 9.354, "village", "Toggenburg village where Zwingli was born"],
    ["Piz Palü", 46.379, 9.960, "mountain", "The three-pillared peak of the Bernina range"],
    ["Finsteraarhorn", 46.537, 8.126, "mountain", "Highest peak of the Bernese Alps, 4,274 m"],
    ["Weisshorn", 46.101, 7.716, "mountain", "4,506 m pyramid above the valley to Zermatt"],
    ["Dent Blanche", 46.034, 7.612, "mountain", "4,357 m peak between Val d'Hérens and Zermatt"],
    ["Grand Combin", 45.937, 7.299, "mountain", "Huge glacier massif in Lower Valais"],
    ["Dents du Midi", 46.161, 6.923, "mountain", "The seven-peaked ridge above Champéry"],
    ["Tödi", 46.811, 8.915, "mountain", "Highest peak of the Glarus Alps"],
    ["Napf", 47.005, 7.940, "mountain", "Hill between the Emmental and the Entlebuch"],
    ["Hoher Kasten", 47.284, 9.485, "mountain", "Revolving restaurant above the Rhine valley"],
    ["Grosser Mythen", 47.030, 8.689, "mountain", "Rocky horn above Schwyz"],
    ["Weissenstein", 47.250, 7.510, "mountain", "Solothurn's Jura mountain"],
    ["Monte Generoso", 45.931, 9.020, "mountain", "Ticino peak with a stone-flower restaurant"],
    ["Corvatsch", 46.409, 9.816, "mountain", "Ski peak above Silvaplana"],
    ["Klausen Pass", 46.868, 8.855, "pass", "Pass between Uri and Glarus"],
    ["Oberalp Pass", 46.659, 8.671, "pass", "Pass with a lighthouse near the source of the Rhine"],
    ["Albula Pass", 46.580, 9.837, "pass", "Road pass from Bergün over to the Engadin"],
    ["Flüela Pass", 46.750, 9.947, "pass", "Pass from Davos to the Engadin"],
    ["Nufenen Pass", 46.477, 8.387, "pass", "The highest road pass entirely in Switzerland"],
    ["Brünig Pass", 46.758, 8.138, "pass", "Low pass between Lucerne and Brienz"],
    ["Lukmanier Pass", 46.574, 8.801, "pass", "Pass from Disentis down to Ticino"],
    ["Gemmi Pass", 46.398, 7.613, "pass", "Cliff path high above Leukerbad"],
    ["San Bernardino Pass", 46.495, 9.170, "pass", "Pass into the Italian-speaking Misox valley"],
    ["Grande Dixence", 46.081, 7.403, "sight", "The tallest gravity dam in the world"],
    ["Pyramides d'Euseigne", 46.173, 7.418, "sight", "Earth pillars wearing stone hats"],
    ["Saut du Doubs", 47.087, 6.714, "waterfall", "Waterfall on the French border in the Jura"],
    ["Ponte dei Salti", 46.258, 8.837, "sight", "Double-arched stone bridge in the Verzasca valley"],
    ["Giessbach Falls", 46.732, 8.021, "waterfall", "Waterfalls with a grand hotel above Lake Brienz"],
    ["Devil's Bridge", 46.647, 8.590, "sight", "Bridge in the Schöllenen gorge"],
    ["Augusta Raurica", 47.535, 7.722, "sight", "Roman town near Basel"],
    ["Habsburg Castle", 47.463, 8.183, "castle", "Where the Habsburgs got their name"],
    ["Tarasp Castle", 46.776, 10.262, "castle", "White castle on a hill in the Lower Engadin"],
    ["Lake Sihl", 47.118, 8.785, "lake", "The biggest reservoir in Switzerland, next to Einsiedeln"],
    ["Lake Lungern", 46.798, 8.159, "lake", "Turquoise lake below the Brünig"],
    ["Lac de Joux", 46.640, 6.288, "lake", "The biggest lake in the Jura, it often freezes in winter"],
    ["Lake Hallwil", 47.282, 8.216, "lake", "Lake in Aargau with a moated castle"],
    ["Lake Sempach", 47.145, 8.155, "lake", "Lake near Lucerne, known for a battle in 1386"],
    ["Klöntalersee", 47.028, 8.987, "lake", "Fjord-like lake above Glarus"],
    ["Morteratsch Glacier", 46.392, 9.927, "glacier", "Glacier you can walk to from the Bernina line"],
    ["Muottas Muragl", 46.522, 9.903, "sight", "Funicular viewpoint over the Engadin lakes"],
    ["Viamala Gorge", 46.663, 9.447, "gorge", "Deep gorge on the old road to the San Bernardino"],
    ["Rhine Gorge", 46.807, 9.310, "gorge", "The Ruinaulta, Switzerland's Grand Canyon"]
  ]
};

// Each day: one place from each list, easy first. Every list has its own fixed order,
// so a place only comes back once its whole list was used.
const TIERS = [PLACES.easy, PLACES.medium, PLACES.hard];
const ORDERS = TIERS.map((list, tier) => seededShuffle(list.map((_, index) => index), `map-pin:${tier}`));

// Great-circle distance in km.
export function distanceKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Distances are shown and compared to 0.1 km, so what you see is what decides.
const kmOf = (pin, place) => Math.round(distanceKm({ lat: pin[0], lng: pin[1] }, place) * 10) / 10;

function normalize(value) {
  return { days: { ...(value?.days || {}) } };
}

function assignDay(doc, day, now) {
  if (doc.days[day]) return false;
  const number = dayNumber(day);
  const places = TIERS.map((list, tier) => {
    const order = ORDERS[tier];
    const [name, lat, lng, kind, clue] = list[order[((number % order.length) + order.length) % order.length]];
    return { name, lat, lng, kind, clue };
  });
  doc.days[day] = { places, players: {}, at: now };
  const others = Object.keys(doc.days).filter((key) => key !== day).sort();
  for (const old of others.slice(0, Math.max(0, others.length + 1 - MAX_DAYS))) delete doc.days[old];
  return true;
}

const playerOf = (entry, author) => entry?.players?.[author] || null;
const pinsOf = (entry, author) => (Array.isArray(playerOf(entry, author)?.pins) ? playerOf(entry, author).pins : []);
const doneOf = (entry, author) => Boolean(playerOf(entry, author)?.doneAt);

function pinsView(entry, author) {
  const pins = pinsOf(entry, author).map((pin, index) => {
    const km = kmOf(pin, entry.places[index]);
    return { lat: pin[0], lng: pin[1], km, near: km <= NEAR_KM };
  });
  return { pins, near: pins.filter((pin) => pin.near).length, km: Math.round(pins.reduce((sum, pin) => sum + pin.km, 0) * 10) / 10 };
}

export function pinResult(entry) {
  if (!doneOf(entry, "her") || !doneOf(entry, "sender")) return null;
  const her = pinsView(entry, "her");
  const sender = pinsView(entry, "sender");
  const places = entry.places.map((_, index) => {
    const km = { her: her.pins[index].km, sender: sender.pins[index].km };
    const winner = km.her === km.sender ? "tie" : km.her < km.sender ? "her" : "sender";
    return { winner, km, near: { her: her.pins[index].near, sender: sender.pins[index].near } };
  });
  const points = { her: 0, sender: 0 };
  for (const place of places) {
    if (place.winner === "tie") { points.her += 0.5; points.sender += 0.5; } else points[place.winner] += 1;
  }
  const winner = points.her === points.sender ? "tie" : points.her > points.sender ? "her" : "sender";
  return { places, points, km: { her: her.km, sender: sender.km }, near: { her: her.near, sender: sender.near }, winner };
}

function dayView(entry, day, author) {
  const pinned = pinsOf(entry, author).length;
  const done = doneOf(entry, author);
  const theirsDone = doneOf(entry, other(author));
  return {
    day,
    // A place's name once it's my turn for it; the real spot and the clue once I pinned it.
    places: (entry?.places || []).map((place, index) => {
      if (index < pinned) return { name: place.name, kind: place.kind, clue: place.clue, lat: place.lat, lng: place.lng };
      return index === pinned ? { name: place.name, kind: place.kind } : null;
    }),
    next: done ? null : pinned,
    mine: { ...pinsView(entry, author), done },
    // Their pins only once we both pinned all three.
    theirs: done && theirsDone ? pinsView(entry, other(author)) : null,
    theirsDone,
    result: done ? pinResult(entry) : null
  };
}

export function pinStats(doc, today) {
  const played = Object.keys(doc.days).filter((day) => day <= today && pinResult(doc.days[day])).sort();
  const wins = { her: 0, sender: 0 };
  const near = { her: 0, sender: 0 };
  for (const day of played) {
    const result = pinResult(doc.days[day]);
    if (result.winner !== "tie") wins[result.winner] += 1;
    for (const author of AUTHORS) near[author] += result.near[author];
  }
  return { daysPlayed: played.length, wins, near };
}

function view(doc, day, author, today) {
  const history = Object.keys(doc.days)
    .filter((key) => key < day && doneOf(doc.days[key], author))
    .sort()
    .reverse()
    .slice(0, HISTORY_DAYS)
    .map((key) => ({ day: key, places: doc.days[key].places.map((place) => place.name), result: pinResult(doc.days[key]) }));
  return { ...dayView(doc.days[day], day, author), count: PER_DAY, nearKm: NEAR_KM, stats: pinStats(doc, today), history };
}

function parsePin(body) {
  const index = body.index;
  if (!Number.isInteger(index) || index < 0 || index >= PER_DAY) throw new GameError(400, "Choose which place you're pinning.");
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (typeof body.lat !== "number" || typeof body.lng !== "number" || !Number.isFinite(lat) || !Number.isFinite(lng)
    || lat < AREA.south || lat > AREA.north || lng < AREA.west || lng > AREA.east) {
    throw new GameError(400, "Drop your pin on the map of Switzerland.");
  }
  return { index, pin: [Math.round(lat * 10000) / 10000, Math.round(lng * 10000) / 10000] };
}

async function read(ctx) {
  const author = parseAuthor(ctx.query("author"));
  const day = parseDay(ctx.query("day"), ctx.today);
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    if (day === ctx.today) {
      if (assignDay(doc, day, ctx.now)) await txn.put(KEY, doc);
    } else if (!doc.days[day]) {
      throw new GameError(404, "There was no map pin that day.");
    }
    return view(doc, day, author, ctx.today);
  });
}

async function play(ctx) {
  const author = parseAuthor(ctx.body.author);
  const day = parseDay(ctx.body.day, ctx.today);
  if (day !== ctx.today) throw new GameError(409, "A new day started. Here are today's places.");
  const { index, pin } = parsePin(ctx.body);
  return ctx.storage.transaction(async (txn) => {
    const doc = normalize(await txn.get(KEY));
    assignDay(doc, day, ctx.now);
    const entry = doc.days[day];
    const player = { ...(playerOf(entry, author) || {}) };
    const pins = Array.isArray(player.pins) ? [...player.pins] : [];
    if (player.doneAt) throw new GameError(409, "You already pinned today's places.");
    if (index < pins.length) throw new GameError(409, "You already pinned that place.");
    if (index > pins.length) throw new GameError(409, "Pin the places in order.");
    pins.push(pin);
    Object.assign(player, { pins }, pins.length === PER_DAY ? { doneAt: ctx.now } : {});
    entry.players = { ...(entry.players || {}), [author]: player };
    await txn.put(KEY, doc);
    let awarded = 0;
    if (player.doneAt) {
      awarded += await award(txn, `pin:${day}:play:${author}`, author, 1);
      const result = pinResult(entry);
      if (result) {
        for (const person of AUTHORS) {
          let hearts = result.winner === person ? 2 : result.winner === "tie" ? 1 : 0;
          hearts += result.near[person];
          const delta = await award(txn, `pin:${day}:score:${person}`, person, hearts);
          if (person === author) awarded += delta;
        }
      }
    }
    awarded += await markActive(txn, author, ctx.today);
    return { ...view(doc, day, author, ctx.today), awarded };
  });
}

export const routes = {
  "/games/pin": async (ctx) => {
    if (ctx.method === "GET") return read(ctx);
    if (ctx.method === "POST") return play(ctx);
    throw new GameError(405, "Method not allowed.");
  }
};

export async function summary(ctx) {
  const doc = normalize(await ctx.storage.get(KEY));
  const entry = doc.days[ctx.today];
  const mine = doneOf(entry, ctx.author);
  const theirs = doneOf(entry, other(ctx.author));
  let status = "todo";
  let line = theirs ? "{them} played. Your turn" : "Your turn";
  if (mine && theirs) {
    const result = pinResult(entry);
    status = "done";
    line = result.winner === "tie" ? "A tie today" : `${result.winner === ctx.author ? "{me}" : "{them}"} won today`;
  } else if (mine) {
    status = "waiting";
    line = "Waiting for {them}";
  }
  const stats = pinStats(doc, ctx.today);
  return {
    id: "pin",
    title: "Map pin",
    icon: "map-pin",
    step: "pin",
    status,
    line,
    board: [
      { label: "Map pin wins", her: stats.wins.her, sender: stats.wins.sender },
      { label: "Pins within 10 km", her: stats.near.her, sender: stats.near.sender }
    ]
  };
}
