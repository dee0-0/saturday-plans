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
  yourName: "",

  // The custom greeting shown on the first screen.
  greeting: "Lazy Ass ℬ𝓁ℴ𝓃𝒹𝒾ℯ🥐",

  // Use {name} to personalize this note for her.
  closingNote: "I can't wait to annoy you in real life, and you need to buy me McDonald's.",

  // Hidden under the silver scratch card on the plan screen.
  scratchSecret: "Plot twist: dessert is on me. Any dessert. Choose wisely. 🍰",

  // Revealed when she taps the little wax seal next to your signature 5 times.
  secretMessage: "You found the secret! 🤫 I smiled the whole time I was making this for you.",

  // Love coupons she can redeem. You get a notification each time.
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

  // Background music. Leave empty for the built-in music-box melody, or put an
  // .mp3 in the assets folder and set e.g. "assets/our-song.mp3" to loop that instead.
  musicUrl: "",

  // Optional ntfy.sh notification channel. This client-side value is visible
  // in the public repository; see README.md for the privacy implications.
  ntfyTopic: "saturday-ask-4c3d6ccdd98624e0f2f529ad"
};
