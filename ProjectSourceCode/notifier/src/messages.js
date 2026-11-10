// The words in every notification, in one place so they're easy to change.

const SPORT_NAMES = {
  basketball: "Basketball",
  soccer: "Soccer",
  volleyball: "Volleyball",
  tennis: "Tennis",
  pickleball: "Pickleball",
  football: "Football",
};

// Where each notification takes you. The game and rating pages aren't built
// yet: change these paths when they are.
export const LINKS = {
  match: (id) => `/game.html?id=${encodeURIComponent(id)}`,
  reminder: (id) => `/game.html?id=${encodeURIComponent(id)}`,
  feedback: (id) => `/rate-players.html?id=${encodeURIComponent(id)}`,
};

export const sportName = (sportId) => SPORT_NAMES[sportId] ?? sportId;

// Intl puts a narrow no-break space before "PM". Text messages can't encode
// it cheaply (it makes a 160-character text cost three), so use a plain space.
const plain = (text) => text.replace(/[  ]/g, " ");

/** "Sat, Nov 14, 6:00 PM" in the given time zone. */
export function formatDayTime(date, timeZone) {
  return plain(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(date),
  );
}

/** "6:00 PM" in the given time zone. */
export function formatTime(date, timeZone) {
  return plain(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(date));
}

/** "Sat, Nov 28" in the given time zone. */
export function formatDay(date, timeZone) {
  return plain(
    new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(date),
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Everything one notification needs, for every channel.
 *
 * @param {"match"|"reminder"|"feedback"} type
 * @param {object} game  an events document plus `id`, with times as Dates
 * @param {object} options
 * @param {string} options.appUrl    the site's address, for links
 * @param {string} options.timeZone  e.g. "America/Denver"
 * @param {number} [options.averageScore]  match: the players' average sportsmanship score
 * @param {Date} [options.deadline]        feedback: when rating closes
 * @returns {{title: string, body: string, link: string, sms: string, emailText: string}}
 */
export function buildMessage(type, game, { appUrl, timeZone, averageScore, deadline }) {
  const sport = sportName(game.sportId);
  const place = game.location?.name || "the game";
  const what = game.title ? `${sport} (${game.title})` : sport;
  let title;
  let body;

  switch (type) {
    case "match": {
      const spots = game.playerLimit - game.participantIds.length;
      title = `New game for you: ${sport} at ${place}`;
      body = `${what} on ${formatDayTime(game.startTime, timeZone)}, ${plural(spots, "spot")} left.`;
      if (averageScore != null) body += ` The players' average sportsmanship score is ${averageScore}.`;
      break;
    }
    case "reminder":
      title = `${sport} starts in about an hour`;
      body = `${what} at ${place}, ${formatTime(game.startTime, timeZone)}. ${plural(game.participantIds.length, "player")} going.`;
      break;
    case "feedback":
      title = `How was ${sport.toLowerCase()} at ${place}?`;
      body = `Rate the other players by ${formatDay(deadline, timeZone)}. Your ratings make everyone's sportsmanship score fair.`;
      break;
    default:
      throw new Error(`Unknown notification type "${type}"`);
  }

  const link = appUrl + LINKS[type](game.id);
  const headline = /[.?!]$/.test(title) ? title : `${title}.`;
  return {
    title,
    body,
    link,
    sms: `Pickup-Finder: ${headline} ${body} ${link}`,
    emailText: [
      body,
      "",
      link,
      "",
      "You're getting this because you turned on email notifications in Pickup-Finder.",
      "You can turn them off in your notification settings.",
    ].join("\n"),
  };
}
