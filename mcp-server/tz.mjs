// tz.mjs — import FIRST in every entry point.
//
// The prod container runs on UTC, so without this "today" on the server is the
// UTC date: a brief written at 06:30 local time (the evening before in UTC)
// was built from yesterday's items, and due-today and overdue lists drifted by
// a day around midnight. Pinning the process to the user's timezone makes every
// local-time date (startOfDay, fmtISO, getDay…) mean the user's day. Reminders
// already convert explicitly with TODOUZ_TZ, so they are unaffected.
// Defaults to the machine's own timezone; set TODOUZ_TZ on a UTC server.
process.env.TZ = process.env.TODOUZ_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone;
