# Configuration

Everything is optional for a local run. Set these as environment variables, or copy [`.env.example`](../.env.example) and export it.

## Server

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8765` | HTTP port for the dashboard and API. |
| `HOST` | `127.0.0.1` without accounts, `0.0.0.0` with | Address to listen on. With no accounts, auth is off, so todouz only accepts connections from this machine unless you set `HOST` yourself. |
| `TODOUZ_DATA_DIR` | `./data` | Folder that holds your markdown and state. Point it at a synced or git-tracked folder if you like. |
| `TODOUZ_TZ` | the machine's timezone | Timezone for "today", reminders and routine schedules. Set it on servers that run in UTC. |
| `TODOUZ_PUBLIC_URL` | `http://localhost:$PORT` | Base URL used in links the agent writes into items and the feed. |
| `NODE_ENV` | — | `production` never runs without auth: with no accounts it stays locked until `TODOUZ_USERS` is set. |

## Accounts and access

| Variable | What it does |
|---|---|
| `TODOUZ_USERS` | `name:password,name2:password2`. Creates any listed account that doesn't exist yet. Change passwords later in Settings → Account. |
| `TODOUZ_ADMINS` | Comma-separated usernames that get the admin role (default: the install owner, else the first user). |
| `TODOUZ_LEGACY_OWNER` | Username that owns data created before accounts existed, and the identity of `TODOUZ_API_KEY`. Default `owner`. |
| `TODOUZ_SECRET` | Signs session cookies. Set it so logins survive restarts. |
| `TODOUZ_API_KEY` | An admin bearer key for scripts. People can also make personal `tdz_…` keys in Settings → Account. |
| `TODOUZ_USER_KEYS` | `name:key` pairs for headless setups. |
| `TODOUZ_SIGNUP` | `open` adds self-service sign-up to `/login`. |

Each person has their own lists, calendar, Brain, feed and chats. A category is private to its owner unless shared from its settings; Brain notes are private unless written with `shared: true`. Every tool call runs as the caller (`mcp-server/access.mjs`), which covers the dashboard, the HTTP API, MCP clients started by the server, the in-app agent and routines.

## AI

| Variable | Default | What it does |
|---|---|---|
| `TODOUZ_MODEL` | `claude-sonnet-5` | Model for Ask agent and routines (also selectable in Settings). |
| `CLAUDE_CODE_PATH` | bundled | Path to a Claude Code binary, if you want a specific one. |
| `ANTHROPIC_API_KEY` | — | Only used when Settings is switched to API-key billing. With the default mode, Ask agent uses your signed-in Claude Code CLI. |
| `TODOUZ_ROUTINES` | `off` | `on` runs the routines in `data/routines/` on their schedules. Manual runs from Settings always work. |
| `TODOUZ_LINKER` | `off` | `on` lets the Brain link new notes to related ones every few minutes. |
| `TODOUZ_LINKER_MODEL` | as above | A cheaper model for the linker, if you like. |
| `TODOUZ_JOURNEY` | `off` | `on` unlocks one practice-journey lesson per day. |
| `TODOUZ_REFILL_AI` | `off` | `on` writes fresh feed posts when you reach the end of the feed. |

All background AI is off by default because it uses your Claude plan without you asking each time.

## Outside workspaces

`workspace_read` gives routines and the agent read-only access to another system (a team's task board or docs). Configure it in Settings → Connected sources, or with `TODOUZ_WORKSPACE_URL` and `TODOUZ_WORKSPACE_KEY`. The service must answer `POST <url>/<op>` with JSON; see `mcp-server/sources.mjs` to add your own.

## Push reminders

| Variable | What it does |
|---|---|
| `TODOUZ_PUSH_CONTACT` | `mailto:` or URL sent to push services, as the Web Push spec requires. |

VAPID keys are generated on first boot into `data/state/vapid.json`. Turn reminders on per device in Settings.
