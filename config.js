// Personalize this file. Everything here is safe to edit — none of it is secret except the topic below.
const CONFIG = {
  // Set this to the deployed Cloudflare Worker origin (without /plan).
  // The site needs this endpoint to share one plan across devices.
  planApiUrl: "https://saturday-plans-sync.wittwerdee.workers.dev",

  // Her name, used in the notification and default greeting.
  herName: "ℬ𝓁ℴ𝓃𝒹𝒾ℯ🥐",

  // The custom greeting shown on the first screen.
  greeting: "Lazy Ass ℬ𝓁ℴ𝓃𝒹𝒾ℯ🥐",

  // Use {name} to personalize this note for her.
  closingNote: "I can't wait to annoy you in real life, and you need to buy me McDonald's.",

  // Optional ntfy.sh notification channel. This client-side value is visible
  // in the public repository; see README.md for the privacy implications.
  ntfyTopic: "saturday-ask-4c3d6ccdd98624e0f2f529ad"
};
