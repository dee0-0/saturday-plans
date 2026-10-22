// Personalize this file. Everything here is safe to edit — none of it is secret except the topic below.
const CONFIG = {
  // Set this to the deployed Cloudflare Worker origin (without /plan).
  // The site needs this endpoint to share one plan across devices.
  // Locally it talks to `npx wrangler dev` (see README.md).
  planApiUrl: (typeof location !== "undefined" && (location.hostname === "localhost" || location.hostname === "127.0.0.1"))
    ? "http://localhost:8787"
    : "https://saturday-plans-sync.wittwerdee.workers.dev",

  // Her name, used in the notification and default greeting.
  herName: "ℬ𝓁ℴ𝓃𝒹𝒾ℯ🥐",

  // Your name. It "writes itself" as the signature at the end of the letter
  // and labels your side of the date journal.
  yourName: "Dee",

  // The custom greeting shown on the first screen.
  greeting: "Lazy Ass ℬ𝓁ℴ𝓃𝒹𝒾ℯ🥐",

  // Use {name} to personalize this note for her.
  closingNote: "I can't wait to annoy you in real life, and you need to buy me McDonald's.",

  // Hidden under the silver scratch card on the plan screen.
  scratchSecret: "Plot twist: you get one wish. Ask me for anything you want ✨",

  // Revealed when she taps the little wax seal next to your signature 5 times.
  secretMessage: "You found the secret! I smiled the whole time I was making this for you.",

  // Coupons she can redeem. You get a notification each time.
  // Keep each id short, lowercase, with dashes only, and never reuse one.
  coupons: [
    { id: "mcdonalds", icon: "🍟", title: "McDonald's on me", detail: "One McDonald's run, my treat. Large fries included." },
    { id: "movie-pick", icon: "🎬", title: "You pick the movie", detail: "No complaining, no phone, full attention." },
    { id: "long-hug", icon: "🤗", title: "One extra-long hug", detail: "Valid anytime. Minimum 30 seconds." },
    { id: "croissant-breakfast", icon: "🥐", title: "Croissant breakfast", detail: "Fresh croissants, delivered by me." },
    { id: "carry-bag", icon: "👜", title: "I carry your bag", detail: "All day, without a single complaint." },
    { id: "win-argument", icon: "🏆", title: "Win one argument", detail: "Instantly. No discussion. Use wisely." }
  ],

  // The prize for winning the fry game.
  bonusCoupon: { id: "fry-champion", icon: "👑", title: "Fry champion prize", detail: "A surprise treat of your choice, for winning the fry game." },

  // Points needed in 20 seconds to win the fry game.
  gameTarget: 15,

  // ---- Secret hunt ----
  // 16 easter eggs are hidden around the letter. A "Secret hunt" tracker with a
  // progress bar and hints shows up on the plan page once she finds the first
  // one, and finding all of them unlocks secretsCoupon.

  // Tapping the big heart above "The plan is set!" five times.
  heartMessage: "You stole my heart. Please return it in person.",

  // Holding your signature for two seconds rewrites it as this.
  signatureNickname: "Yours ♡",

  // Tapping the weather card three times shows this forecast instead.
  fakeForecast: "100% chance of me annoying you",

  // Five taps on the scratch card's message (after it's scratched) add this line.
  scratchSecretTwo: "P.S. The wish never expires.",

  // A secret high score in the fry game (higher than gameTarget) shows this message.
  gameSecretScore: 30,
  gameSecretMessage: "Okay, you're officially better at this than me. Next McDonald's run, you get my fries too.",

  // Shown when she opens the letter between midnight and 4 a.m.
  lateNightMessage: "Shouldn't you be asleep? …thinking about me?",

  // Shaking her phone on the plan page throws petals and shows one of these.
  compliments: [
    "You're annoyingly easy to like.",
    "You're the reason I keep smiling at my phone.",
    "You're cuter than a fresh croissant.",
    "Talking to you is my favorite part of the day.",
    "I'd share my fries with you. That's how serious this is.",
    "Even your lazy days are cute.",
    "10/10, no notes.",
    "Stop shaking your phone and text me instead.",
    "Shaking your phone won't make me stop thinking about you."
  ],

  // Unlocked only when she finds every secret. Keep the id unused, like the coupons above.
  secretsCoupon: { id: "secret-hunter", icon: "🗝️", title: "Secret hunter prize", detail: "For finding every secret: a whole date planned by me, every detail a surprise." },
  allSecretsMessage: "You found every single secret. I knew you would, you little detective.",

  // Season 2 of the hunt (hunt.js, where its 20 riddles live) opens once all 16 are found.
  // This message shows on the final reveal when the two of you have found all 20.
  season2Message: "All twenty, found together. Turns out we make a pretty great team. Next date: my treat.",

  // Background music. Leave empty for the built-in music-box melody, or put an
  // .mp3 in the assets folder and set e.g. "assets/our-song.mp3" to loop that instead.
  musicUrl: "",

  // Optional ntfy.sh notification channel. This client-side value is visible
  // in the public repository; see README.md for the privacy implications.
  ntfyTopic: "saturday-ask-4c3d6ccdd98624e0f2f529ad"
};
