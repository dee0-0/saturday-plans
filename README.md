# Saturday?

A small, pink, one-question-at-a-time page that asks her whether she's free Saturday, what time, what she wants to do, and where — then sends you the answers the moment she hits **Send**.

## 1. Personalize it

Open [`config.js`](config.js) and edit:

- `herName` — used in the opening line ("Hey \_\_\_"). Leave blank for "Hey you".
- `dateLabel` — currently set to `"Saturday, October 3rd"`. Change this if you're reusing the page for a different date.

Leave `ntfyTopic` alone — it's already set up (see below).

## 2. Get the notification on your phone

This page notifies you through [ntfy](https://ntfy.sh), a free push-notification service — no account needed on either end.

1. Install the ntfy app: [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy) / [iOS](https://apps.apple.com/us/app/ntfy/id1625396347) (or just use [ntfy.sh/app](https://ntfy.sh/app) in a browser tab you leave open).
2. In the app, subscribe to this exact topic:

   ```
   saturday-ask-4c3d6ccdd98624e0f2f529ad
   ```

3. That's it. When she taps Send, you'll get a push notification with everything she picked.

**Keep that topic name private.** Anyone who has the exact string above could subscribe to it too, since ntfy topics aren't secured by an account, only by being hard to guess. Don't post it publicly or screenshot it anywhere.

## 3. Try it yourself first

Open `index.html` locally (or the live link once it's deployed), click through all five questions, and hit Send. Confirm the notification shows up on your phone before you send her the real link.

## 4. Send her the link

Once it's deployed (see below), just send her the URL.

## How it's built

Plain HTML/CSS/JS, no build step, no dependencies, no backend or database — answers go straight from her browser to your phone via ntfy. Nothing is stored anywhere.

## Deploying

This repo is set up to deploy for free with GitHub Pages. Once pushed, enable it under **Settings → Pages** (source: branch `main`, folder `/`), or it may already be live — check the repo's "About" section for the link.
