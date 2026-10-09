# Saturday?

A small, pink, one-question-at-a-time page that asks her whether she's free Saturday, what time, what she wants to do, and where — then sends you the answers the moment she hits **Send**.

## 1. Personalize it

Open [`config.js`](config.js) and edit:

- `herName` — used in the notification and default greeting.
- `greeting` — the custom first-screen greeting.
- `dateLabel` — currently set to `"Saturday, October 10th"`. Change this if you're reusing the page for a different date.
- `dateISO` — the matching `YYYY-MM-DD` date used by the live countdown. It counts down to 2:30 p.m. in the visitor's local time. Keep it in sync with `dateLabel`.
- `closingNote` — the personal note on the final screen. Use `{name}` wherever you want her name to appear.

Leave `ntfyTopic` alone — it's already set up (see below).

## 2. Get the notification on your phone

This page notifies you through [ntfy](https://ntfy.sh), a free push-notification service — no account needed on either end.

1. Install the ntfy app: [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iOS](https://apps.apple.com/us/app/ntfy/id1625396347) (or just use [ntfy.sh/app](https://ntfy.sh/app) in a browser tab you leave open).
2. In the app, subscribe to this exact topic:

   ```
   saturday-ask-4c3d6ccdd98624e0f2f529ad
   ```

3. That's it. When she taps Send, you'll get a push notification with everything she picked.

**Heads up on privacy:** ntfy topics aren't secured by an account, only by being hard to guess — and this repo is public, so the topic string above is technically visible to anyone who finds this GitHub repo (not just people you send the page link to). The practical risk is low (nobody stumbles onto a random personal repo by accident), but it's not truly private. Don't additionally post the topic anywhere yourself. If you want it properly private, the clean fix is moving the topic into a GitHub Actions secret instead of this file — ask Claude to set that up if you want it.

## 3. Try it yourself first

Open `index.html` locally (or the live link once it's deployed), click through all five questions, and hit Send. Confirm the notification shows up on your phone before you send her the real link.

## 4. Send her the link

**https://dee0-0.github.io/saturday-plans/**

That's the live page — it's already deployed via GitHub Pages. Just send her that URL once you've personalized `config.js` and tested it yourself (step 3).

## How it's built

Plain HTML/CSS/JS, no build step, no dependencies, no backend or database — answers go straight from her browser to your phone via ntfy. Nothing is stored anywhere.

Note: this repo is **public** (required for free GitHub Pages), but nothing sensitive lives in the code — the only thing worth keeping private is the ntfy topic string above.

## Deploying changes

Any edit you push to `master` (e.g. after personalizing `config.js`) redeploys automatically within a minute or two — no extra step needed.
