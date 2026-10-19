// Guess my answer: the summary for the games hub. The guesses themselves live in the
// daily question (worker/src/index.js): with your answer you guess what the other one
// says, and once you both answered each of you judges the other's guess (hearts kind "guess").
import { QUESTIONS_KEY, addDays, awardTotals, other } from "./common.js";

// Guesses this old no longer wait for a verdict on the hub.
const PENDING_DAYS = 60;

const hasText = (answer) => typeof answer?.text === "string" && answer.text.trim() !== "";
const hasGuess = (answer) => typeof answer?.guess === "string" && answer.guess.trim() !== "";

export const routes = {};

export async function summary(ctx) {
  const me = ctx.author;
  const them = other(me);
  const days = (await ctx.storage.get(QUESTIONS_KEY))?.days || {};
  const today = days[ctx.today]?.answers || {};
  const since = addDays(ctx.today, -PENDING_DAYS);
  // Days where both of us answered, they guessed my answer and I haven't judged it yet.
  const pending = Object.keys(days).filter((day) => {
    const entry = days[day];
    return day >= since && day <= ctx.today && hasText(entry?.answers?.[me]) && hasText(entry?.answers?.[them])
      && hasGuess(entry?.answers?.[them]) && !entry?.verdicts?.[them]?.verdict;
  }).length;

  let status = "waiting";
  let line = "Waiting for {them}";
  if (!hasText(today[me])) {
    status = "todo";
    line = "Answer and guess {them}'s answer";
  } else if (pending) {
    status = "new";
    line = pending === 1 ? "Judge {them}'s guess" : `Judge ${pending} guesses from {them}`;
  } else if (hasText(today[them])) {
    status = "done";
    line = "Both answered today";
  }
  const totals = (await awardTotals(ctx.storage)).guess || {};
  return {
    id: "guess",
    title: "Guess my answer",
    icon: "target",
    step: "question",
    status,
    line,
    board: [{ label: "Guess points", her: totals.her || 0, sender: totals.sender || 0 }]
  };
}
