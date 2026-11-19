// iOS-only extras for the website's pages. build-web.js loads this on every
// page of the app; in a normal browser it does nothing.
//
// - Adds a Share button to every game card. It opens the iOS share sheet, so a
//   player can send the game to friends in Messages (or Mail, AirDrop, ...).

// The website's address, for links in shared games. Leave empty until the site is deployed.
export const SITE_URL = "";

const nativeApp = typeof window !== "undefined" ? window.Capacitor : undefined;

/** True when the page runs inside the iOS app rather than a browser. */
export const isNativeApp = () => Boolean(nativeApp?.isNativePlatform?.());

/**
 * The text of a shared game, from what its card shows.
 * "My distance" is left out because it means nothing to the person receiving it.
 *
 * @param {{ name: string, when: string, details?: string, siteUrl?: string }} game
 *   name "Basketball", when "Sat, Nov 21, 5:00 PM · Valmont Park",
 *   details "3 spots left · 2.1 mi away · Casual"
 */
export function shareMessage({ name, when, details = "", siteUrl = SITE_URL }) {
  const extra = details
    .split("·")
    .map((part) => part.trim())
    .filter((part) => part && !/\bmi away$/.test(part));
  const text =
    `Join me for pickup ${name.trim().toLowerCase()} on PickupFinder: ${when.trim()}.` +
    (extra.length ? ` ${extra.join(" · ")}.` : "");
  return {
    title: `${name.trim()} on PickupFinder`,
    text,
    url: siteUrl ? new URL("login-and-registration/home.html", siteUrl).href : undefined,
    dialogTitle: "Share this game",
  };
}

/** Read a game card's name, time and place, and details (see recommended.js gameCard). */
export function readGameCard(card) {
  const text = card.querySelector(".list-text");
  if (!text) return null;
  const [when, details] = [...text.querySelectorAll(":scope > .muted")].map((span) => span.textContent);
  const name = text.querySelector("strong")?.textContent;
  return name && when ? { name, when, details } : null;
}

function addShareButton(card) {
  if (card.querySelector(".share-btn")) return;
  const game = readGameCard(card);
  if (!game) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn share-btn";
  button.textContent = "Share";
  button.setAttribute("aria-label", `Share ${game.name}, ${game.when}`);
  button.addEventListener("click", async () => {
    try {
      // Read the card again: Join changes its spots-left line.
      await nativeApp.Plugins.Share.share(shareMessage(readGameCard(card) ?? game));
    } catch (err) {
      // Closing the share sheet without sending rejects too; that's not an error.
      if (!/cancel/i.test(String(err?.message ?? err))) console.error("Cannot share game:", err);
    }
  });
  // Stack Share under the card's Join button (or its Joined/Full tag) so the game's text keeps its width.
  const action = card.lastElementChild?.matches(".btn, .card-state") ? card.lastElementChild : null;
  const actions = document.createElement("div");
  actions.className = "card-actions";
  if (action) action.replaceWith(actions);
  actions.append(...[action, button].filter(Boolean));
  if (!action) card.append(actions);
}

const STYLES = `
  .ios-app .game-card .card-actions { display: flex; flex-direction: column; gap: 6px; margin-left: auto; flex-shrink: 0; }
  .ios-app .game-card .card-actions > * { text-align: center; }
`;

function addShareButtons(root) {
  if (root.matches?.(".game-card")) addShareButton(root);
  root.querySelectorAll?.(".game-card").forEach(addShareButton);
}

if (isNativeApp()) {
  document.documentElement.classList.add("ios-app");
  const style = document.createElement("style");
  style.textContent = STYLES;
  document.head.append(style);

  const start = () => {
    addShareButtons(document.body);
    // Game cards are drawn after the page loads (and again on every refresh).
    new MutationObserver((changes) => {
      for (const change of changes) change.addedNodes.forEach((node) => addShareButtons(node));
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
}
