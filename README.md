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

Edit `config.js` to change the greeting, name, closing note, and optional push-notification topic. The date, time, activity, and place are chosen in the page itself.

The repository and GitHub Pages site are public. Anyone who has the site URL can read or change the shared plan, so use it for this invitation rather than private information. The existing ntfy topic is also in the public client config; rotate it if you want to stop unsolicited notifications.

## Deploy

The site is plain HTML, CSS, and JavaScript. Google Maps directions use cross-platform Maps URLs and do not need an API key. GitHub Pages publishes changes pushed to `master`. The Cloudflare Worker is deployed separately by `.github/workflows/deploy-plan-api.yml`.
