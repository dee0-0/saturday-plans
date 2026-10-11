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
- A date journal: after the date has started, each of you can rate it with hearts, write a note and add a photo. Past dates stay as a shared history.
- Can be added to the home screen like an app, with its own icon. Sending the link in Snapchat, WhatsApp or iMessage shows a pink envelope preview card.

## Connect cross-device storage

The static GitHub Pages site stores the shared plan and late updates in a Cloudflare Worker using SQLite-backed Durable Object storage. The Worker is deployed at `https://saturday-plans-sync.wittwerdee.workers.dev` and its origin is set in `config.js`.

1. In the GitHub repository, open **Settings → Secrets and variables → Actions** and add these repository secrets if you are setting up a new copy:
   - `CLOUDFLARE_ACCOUNT_ID`
   - `CLOUDFLARE_API_TOKEN` (create a scoped token with Cloudflare's **Edit Cloudflare Workers** permission)
2. Push changes to `worker/` on `master`. The `Deploy shared plan API` workflow deploys it and prints its URL in the job log.
3. If the Worker URL changes, update `planApiUrl` in `config.js` with only the origin; do not add `/plan`.
4. Push the change to `master` so GitHub Pages republishes the connected site.

Keep the Cloudflare API token in GitHub Secrets; do not put it in `config.js` or commit it. The storage service uses a single SQLite-backed Durable Object, so creation of the first plan is atomic and subsequent submissions cannot create another record.

## Personalize

Edit `config.js` to change the greeting, her name, your name (`yourName`, used for the signature and the journal), the closing note, the scratch-card and secret messages, the coupons, the fry-game target, and the optional push-notification topic. The date, time, activity, and place are chosen in the page itself.

Coupon redemptions are saved by `id`, so give every coupon its own short id and don't reuse an old one for a different coupon.

The link-preview image (`assets/og-preview.jpg`) and app icons (`assets/icon-*.png`, `assets/apple-touch-icon.png`) are plain image files; replace them with same-sized images if you want a different look.

Background music: leave `musicUrl` empty for the built-in music-box melody, or drop an `.mp3` into `assets/` and set e.g. `"assets/our-song.mp3"` to loop your own song. It starts on her first tap (browsers block sound before that), and the speaker button in the top-right corner turns it off.

The repository and GitHub Pages site are public. Anyone who has the site URL can read or change the shared plan, the coupons and the journal, including journal photos, so only add photos you'd be fine with someone else seeing. The existing ntfy topic is also in the public client config; rotate it if you want to stop unsolicited notifications.

## Try it without touching her letter

Open **https://dee0-0.github.io/saturday-plans/?preview** to test everything (saying yes, setting a plan, redeeming coupons, the game, the journal) against a separate sandbox. Notifications still arrive, labelled "🧪 Preview". The dark bar at the bottom has a Reset button that wipes the sandbox so you can start over. Her normal link never sees any of it.

## Run it locally

1. In `worker/`, run `npx wrangler dev --port 8787 --var DEV_ORIGIN:http://localhost:5185`. This runs the Worker with its own local test data, separate from the real plan.
2. Serve the site folder on port 5185, for example with `npx serve . -l 5185`, and open `http://localhost:5185`. On localhost, `config.js` talks to the local Worker automatically.

## Deploy

The site is plain HTML, CSS, and JavaScript. Google Maps directions use cross-platform Maps URLs and do not need an API key. GitHub Pages publishes changes pushed to `master`. The Cloudflare Worker is deployed separately by `.github/workflows/deploy-plan-api.yml`.
