// The Join button on game cards in the home page panels (Recommended, and
// Friends' games in the Friends panel). Unlike panel-helpers.js, this talks
// to Firebase, so it isn't unit tested on its own.

import { friendlyEventError, rsvpToEvent } from "../firebase/events.js";
import { el, formatDayTime, gameName } from "./panel-helpers.js";

/** A short word in place of the button: "Joined", "Full", ... */
export function stateTag(text) {
  return el("span", { class: "card-state" }, text);
}

/**
 * A Join button for a game card, or a tag saying why you can't join.
 *
 * @param {object} game  as events.js returns it
 * @param {object} [options]
 * @param {(game: object) => void} [options.onJoined]  gets the game as it is
 *   after joining, to update the card
 * @param {(text: string, ok?: boolean) => void} [options.showMessage]  shows
 *   the panel's message line
 */
export function joinButton(game, { onJoined = () => {}, showMessage = () => {} } = {}) {
  if (game.status === "cancelled") return stateTag("Cancelled");
  if (game.startTime <= new Date()) return stateTag("Started");
  if (game.isGoing) return stateTag("Joined");
  if (game.isFull) return stateTag("Full");

  const button = el(
    "button",
    {
      type: "button",
      class: "btn primary",
      "aria-label": `Join ${gameName(game)}, ${formatDayTime(game.startTime)}`,
    },
    "Join",
  );
  button.addEventListener("click", async () => {
    button.disabled = true;
    button.textContent = "Joining…";
    showMessage("");
    try {
      onJoined(await rsvpToEvent(game.id));
      button.replaceWith(stateTag("Joined"));
      showMessage(
        `You're in: ${gameName(game)} at ${game.location?.name ?? "the game"}, ${formatDayTime(game.startTime)}.`,
        true,
      );
    } catch (err) {
      console.error(`Cannot join game ${game.id}:`, err);
      button.disabled = false;
      button.textContent = "Join";
      showMessage(friendlyEventError(err));
    }
  });
  return button;
}
