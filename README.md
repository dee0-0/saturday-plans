# The little date letter

A mobile-friendly, one-question-at-a-time date invitation in a soft rose envelope theme. It opens as a sealed letter, lets her choose a future date and time, activity, place, and optional note, then shows the confirmed plan whenever the site is opened again.

## What it does

- On phones, opens as a large pink envelope over the softly visible lily background; larger screens keep the rose stationery layout.
- Accepts any future date and time in Bern time.
- Adds the confirmed two-hour plan to a calendar from an `.ics` file.
- Opens walking directions to the selected meeting place in Google Maps.
- Lets either person share a 5, 10, 15, or 30 minute late update, then mark that they have arrived. Updates appear on the other device and send a notification to the configured ntfy topic.
- Shows a countdown and the saved date details.
- Stores one shared plan. Once submitted, the invitation becomes a plan viewer with cancel and reschedule controls; it will not create a second plan.
- Refreshes the shared plan while the page is open so changes made on another phone appear automatically.
- Asks "Will you go out with me?" right after the envelope opens. The No button runs away from her finger or cursor, and you get a notification saying how many times she tried.
- Shows the weather forecast for the date's hour and place on the plan screen (Open-Meteo, no key needed), with a tip like "bring an umbrella". Towns and areas near Bern (Thun, Gurten, Murten…) get their own forecast; venue names and the generic choices use Bern. It appears about 16 days ahead.
- Has a silver scratch card hiding `scratchSecret`, your name written as an animated signature, and a wax seal that reveals `secretMessage` after 5 taps.
- Love coupons she can redeem once each (you get a notification), plus a 20-second "Catch the fries" game that unlocks a prize coupon.
- A date journal that works like a scrapbook: every date gets a card with both of your heart ratings and notes, its outfit pick, and a gallery of photos and videos either of you can add once the date has started (photos are resized on the phone; videos up to 80 MB). Tap a photo or video to open it full screen. Rating opens once the date has started, and every past date keeps a "Write my review" button, so a date can still be rated after the next one is planned.
- "What's next?": after a date, either of you can pick the next activity and plan the next date. The date that just happened moves into the journal with everything on it, and the new plan starts. Rescheduling or cancelling a date that already happened keeps it in the journal too.
- Outfit vote: either of you posts outfit photos for the upcoming date, you both rate them with hearts, comment, and tap "My pick". You get a notification when she posts one or picks her favorite. Rescheduling the date keeps its outfits.
- Snack wishlist: one shared list. Add snacks (or tap a quick-add chip), tick them off when you have them, clear the done ones.
- Movie night: one shared movie list. Search for a movie and tap it to add it with its poster (or just type a title if posters are off), heart the ones you want to see, and "Spin the wheel" over all movies or only the ones you both hearted. The wheel lands on the same movie on both phones, and either of you can mark it watched.
- Ideas jar: drop date ideas into a shared jar. "Pull one out" picks a random one, and once a date has happened, "Plan it" opens "What's next?" with that idea filled in. The next-date page also has its own "Pull from the jar" button. Saving a plan from the jar marks its idea used in the same transaction. Used ideas move to their own list and can be put back.
- Question of the day: you both get the same question each day and only see each other's answer after answering it yourself. Earlier questions stay in a history below. You can also add your own questions; they come up before the built-in ones (there are 117 built in). The server returns your own queued question texts and only a count for the other person's waiting questions, keeping those a surprise until selected.
- An activity bell at the top right shows what the other one did (rated a date, posted an outfit, spun the wheel, answered the question, planned or moved the date…), with a red badge for new things and a small pop-up while the letter is open. Tap an item to jump to that page.
- Phone notifications: in the bell's panel, "Turn on" sends a real notification to the other phone whenever one of you does something. On an iPhone this needs iOS 16.4 or later and the letter added to the Home Screen: open it from the Home Screen icon, tap the bell, then "Turn on". Each phone turns it on once. Choosing who is writing in the journal immediately updates notification ownership. Phone push is disabled in preview so testing cannot replace a real subscription. The existing ntfy notifications to you keep working as before.
- Games: the "Games" tile on the plan page opens a games page with today's games, a leaderboard between the two of you, your couple streak and your badges. From there:
  - Daily match: 5 quick this-or-that picks each day. Once you've both played you see how many you picked the same, plus your all-time compatibility and match streak.
  - Guess my answer: on the question of the day you can also guess what the other one will answer. Once you've both answered, each of you rates the other's guess (Spot on, Close or Not quite). Earlier answers can be edited from the history.
  - Daily duel: 5 quick questions about the two of you each day: "Who's the better…?", "Who did it?" or "Who would rather…?", a "same answer" pick (double hearts), a truth meter (true or false for you, plus a guess for the other one) and a mind reader (a colour, an animal and a number). Once you've both played you see what you agreed on, and every shared answer earns hearts.
  - Speed round: 10 this-or-that picks in 15 seconds, no time to think. The pairs only show once you tap Start. Then you see how many you picked the same and who was faster.
  - Price is right: 3 things a day (a croissant in Paris, a flight to Tokyo…). You both guess what they cost in Swiss francs; the closer guess wins each one. Prices are rough real-world prices.
  - Odd one out: 3 puzzles of 4 words where one doesn't fit, the same for both of you. More right answers wins, and the faster one wins a tie.
  - Wordle for two: the same five-letter word for both of you each day. You see the other one's guesses only as coloured squares until you're done; fewer tries wins the day.
  - Daily doodle: the same drawing prompt for both of you. Draw it with your finger; both drawings show side by side (with a replay) once you've both finished.
  - Icon story: pick 3 to 5 icons that tell a movie, song or memory; the other one has 3 tries to guess it.
  - Weekly challenges: 3 small challenges each week (like "send a photo of something pink"). Tick yours off with a note or photo; when you've both done one, you unlock its badge.
  - Couple streak: a flame counter for the days in a row you've both played something (the question of the day counts too). If the other one hasn't played yet today, you can send a "Don't break our streak!" nudge.
  - Hearts and the love shop: playing earns hearts (answering the question 1, winning Wordle 2, a spot-on guess 3, a finished challenge 3, every 7-day streak 5, and so on; the full list is under "How to earn hearts"). Spend them in the love shop on rewards you set up yourselves, like "Breakfast in bed"; the other one gets a notification and marks it done when it happened.
- Everything is shared through the Worker, and open pages refresh by themselves (journal every 20 s, outfits, movies and ideas every 10 s, snacks every 8 s, the question, the games and the activity bell every 10 to 15 s).
- A secret hunt with 16 easter eggs hidden around the letter, like tapping the wax seal or the big heart, holding the signature, shaking the phone, tapping the weather card or countdown, a secret fry-game score, catching broccoli, and opening the letter after midnight. After her first find, a "Secret hunt" tracker on the plan page shows a progress bar, how many are left, and a hint for any secret she taps "Hint" on. Only finding all 16 unlocks the hidden prize coupon. You get a notification for each find.
- Secret hunt season 2: once all 16 are found, 20 new, much harder easter eggs open up, this time for both of you. Either phone can find them, the list is shared through the Worker (each find remembers who found it, and the other phone gets a notification), and four of them only work with both phones at the same time. The "Secret hunt · Season 2" page (from the games page, or "Season 2 is open" in the first hunt's tracker) shows the progress and a card per secret: every secret has a free riddle, and a clearer hint costs 5 hearts (bought once, both of you see it). Each find is worth 2 hearts, and finding all 20 gives you both 20 more and a final message (`season2Message` in `config.js`). The riddles and hints are at the top of `hunt.js`; the Worker side is `worker/src/games/hunt.js`.
- Can be added to the home screen like an app, with its own icon. Sending the link in Snapchat, WhatsApp or iMessage shows a pink envelope preview card.

## Connect cross-device storage

The static GitHub Pages site stores the shared plan and late updates in a Cloudflare Worker using SQLite-backed Durable Object storage. The Worker is deployed at `https://saturday-plans-sync.wittwerdee.workers.dev` and its origin is set in `config.js`.

1. In the GitHub repository, open **Settings → Secrets and variables → Actions** and add these repository secrets if you are setting up a new copy:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN` (create a scoped token with Cloudflare's **Edit Cloudflare Workers** permission)
2. Push changes to `worker/` on `master`. The `Deploy shared plan API` workflow deploys it and prints its URL in the job log.
3. If the Worker URL changes, update `planApiUrl` in `config.js` with only the origin; do not add `/plan`.
4. Push the change to `master` so GitHub Pages republishes the connected site.

Movie posters come from TMDB. To turn them on, add a free TMDB "API Read Access Token" as the repository secret `TMDB_TOKEN`; the deploy workflow passes it to the Worker. Without it, the movie list still works and you just type titles.

Phone notifications need no setup: the Worker creates its own push keys the first time someone turns them on.

Keep the Cloudflare API token and the TMDB token in GitHub Secrets; do not put them in `config.js` or commit them. The storage service uses a single SQLite-backed Durable Object, so creation of the first plan is atomic and subsequent submissions cannot create another record.

## Personalize

Edit `config.js` to change the greeting, her name, your name (`yourName`, used for the signature and the journal), the closing note, the scratch-card and secret messages, the coupons, the fry-game target, and the optional push-notification topic. The date, time, activity, and place are chosen in the page itself.

Coupon redemptions are saved by `id`, so give every coupon its own short id and don't reuse an old one for a different coupon.

The secret hunt is set up in the "Secret hunt" part of `config.js`: the heart message, the signature nickname, the fake forecast, the scratch-card P.S., the secret fry score and its message, the late-night message, the shake compliments, and the prize coupon (`secretsCoupon`) with its last message. The list of secrets, with their hints, is at the top of `secrets.js`. The countdown and weather secrets only work before the date, and the journal-hearts secret only after it. On iPhones, Safari only shares motion after she reveals the shake hint, taps "Allow shaking" and says yes. Android phones don't need to ask. Secrets she finds are remembered on her phone, but the prize coupon is saved for both of you. If you open the letter on your own phone and pick your name in the journal, your own finds don't send notifications.

The link-preview image (`assets/og-preview.jpg`) and app icons (`assets/icon-*.png`, `assets/apple-touch-icon.png`) are plain image files; replace them with same-sized images if you want a different look.

Background music: leave `musicUrl` empty for the built-in music-box melody, or drop an `.mp3` into `assets/` and set e.g. `"assets/our-song.mp3"` to loop your own song. It starts on her first tap (browsers block sound before that), and the speaker button in the top-right corner turns it off.

The repository and GitHub Pages site are public. Anyone who has the site URL can read or change the shared plan, the coupons, the journal, the outfit vote, the snack list, the movie list, the ideas jar, the activity list, the daily question answers and the games. Normal question responses hide the other person's answers until you answer, and hide their queued question texts, but the server still trusts the selected identity rather than authenticating it. Photos and videos can be opened by anyone who has their link, so only add photos and videos you'd be fine with someone else seeing. They are stored in the Worker's Durable Object storage (Cloudflare's free plan allows 5 GB in total). The existing ntfy topic is also in the public client config; rotate it if you want to stop unsolicited notifications.

## Try it without touching her letter

Open **https://dee0-0.github.io/saturday-plans/?preview** to test everything (saying yes, setting a plan, redeeming coupons, the game, the journal) against a separate sandbox. The activity bell works in preview, but phone push is disabled there to protect the real site's subscriptions. Existing ntfy updates to you still arrive, labelled "🧪 Preview". The dark bar at the bottom has a Reset button that wipes the sandbox so you can start over. Her normal link never sees any of it.

## Run it locally

1. In `worker/`, run `npx wrangler dev --port 8787 --var DEV_ORIGIN:http://localhost:5185`. This runs the Worker with its own local test data, separate from the real plan.
2. Serve the site folder on port 5185, for example with `npx serve . -l 5185`, and open `http://localhost:5185`. On localhost, `config.js` talks to the local Worker automatically.

## Deploy

The site is plain HTML, CSS, and JavaScript. Google Maps directions use cross-platform Maps URLs and do not need an API key. GitHub Pages publishes changes pushed to `master`. The Cloudflare Worker is deployed separately by `.github/workflows/deploy-plan-api.yml`.

For a feature branch that introduces new API routes, run **Deploy shared plan API** against that branch and wait for it to succeed before merging into `master`. This makes the backend available before GitHub Pages publishes the new frontend.
