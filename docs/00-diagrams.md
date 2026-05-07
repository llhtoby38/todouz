# 00 — Diagrams

Visual reference for the spec. Read this **before** the prose docs to get oriented.

All diagrams are Mermaid — render natively in GitHub, VS Code, Obsidian, and most markdown viewers.

---

## A. Entity-relationship diagram

The conceptual relational model. **On disk we denormalise** (sub-tasks live inside an issue's markdown, completion state is one JSON file, etc.) — see notes below.

```mermaid
erDiagram
    CATEGORY ||--o{ AGENT       : "owns 0..N"
    CATEGORY ||--o{ EPIC        : "groups 0..N"
    AGENT    ||--o{ EPIC        : "owns 1..N"
    AGENT    ||--o{ SESSION     : "drives 0..N"
    EPIC     ||--|{ ISSUE       : "contains 1..N"
    EPIC     ||--o| RECURRING_RULE : "has if recurring"
    ISSUE    ||--o{ SUBTASK     : "embedded 0..N"
    ISSUE    ||--o{ LOG_ENTRY   : "recurring only"
    ISSUE    ||--o| RECURRING_RULE : "has if recurring"
    ISSUE    }o--o{ SESSION     : "linked many-many"
    ISSUE    ||--o{ COMPLETION  : "one per instance"
    EVENT    }o--|| CATEGORY    : "tagged"
    EVENT    ||--o| COMPLETION  : "0..1"

    CATEGORY {
        enum name PK "studies | side-project | body | kitchen | future-planning | personal"
    }
    AGENT {
        string name PK
        enum category FK "nullable for cross-cutting (scheduler, compass)"
        text identity_md "data/agents/<name>/identity.md"
        text system_prompt_md "data/agents/<name>/system-prompt.md"
    }
    EPIC {
        string slug PK "category/short-name (e.g. studies/cs-401)"
        string title
        enum category FK
        string agent_owner FK
        text epic_md "long-form context: plan, progression, observations"
        json related_epics "string[] of other slugs"
    }
    ISSUE {
        string id PK "ISS-NNN — unique per epic"
        string epic_slug FK
        string title
        text description
        string agent FK
        date due "nullable"
        enum priority "high | medium | low"
        boolean recurring
        enum status "open | completed"
    }
    SUBTASK {
        string issue_id FK
        text text PK
        boolean done
        date due "nullable"
    }
    SESSION {
        uuid session_id PK
        string agent FK
        path jsonl_path "absolute under ~/.claude/projects/"
        timestamp last_updated
        text first_message_excerpt
        int turn_count
    }
    LOG_ENTRY {
        string issue_id FK
        date for_date PK
        text note
        json observations "duration_min, rpe, skipped, extras"
    }
    RECURRING_RULE {
        enum freq "daily | weekly | monthly"
        int dow "0–6, only if weekly"
        time time
        string issue_template "epic-level only — name of issue to clone per instance"
    }
    EVENT {
        string id PK "evt-NNN"
        string title
        date date
        time time "nullable"
        int duration_min "nullable"
        enum category FK
    }
    COMPLETION {
        string key PK "ISS-NNN | ISS-NNN#YYYY-MM-DD | evt-NNN"
        boolean completed
        timestamp completed_at
        text note "nullable"
    }
```

### How it actually lives on disk

The relational view is the **mental model**. The on-disk form is denormalised for hand-editability:

| Conceptual entity | On-disk form |
|---|---|
| `CATEGORY` | folder name under `data/epics/<category>/` and `data/agents/<name>/` |
| `AGENT` | `data/agents/<name>/{identity,system-prompt}.md` |
| `EPIC` | `data/epics/<cat>/<slug>/epic.md` (frontmatter + body) + sibling `issues.md` |
| `RECURRING_RULE` | YAML frontmatter inside `epic.md` (epic-level) or inside the issue's metadata block (issue-level) |
| `ISSUE` | one `## ISS-NNN` section inside the epic's `issues.md` |
| `SUBTASK` | `### Sub-tasks` block of nested `- [ ]` checkboxes inside the issue |
| `LOG_ENTRY` | `### Log` block inside the recurring issue, one bullet per date |
| `SESSION` | JSONL at `~/.claude/projects/<hashed-cwd>/<sid>.jsonl` (managed by Claude Code SDK) — referenced, not duplicated |
| `COMPLETION` | one entry in `data/state/completion.json` keyed by `id` or `id#date` or `evt-id` |
| `EVENT` | one entry in `data/state/events.json` |

We trade SQL JOINs for `git diff`-readability and crash-resilience. Acceptable for a single-user system.

---

## B. Architecture / components diagram

Two entry points (browser + external Claude session), one shared dispatcher, one filesystem.

```mermaid
flowchart TB
    classDef user fill:#fff8e0,stroke:#3d2817,color:#3d2817
    classDef ext fill:#e8e8f8,stroke:#3a3a8e,color:#3a3a8e
    classDef store fill:#f0e8d0,stroke:#3d2817,color:#3d2817
    classDef shared fill:#e6f0d8,stroke:#5a7a4a,color:#3d2817

    Toby_browser["👤 the user<br/>browser tab"]:::user
    Toby_term["👤 the user<br/>terminal at any cwd"]:::user
    OtherClaude["claude CLI<br/>session"]:::ext

    Toby_browser --> SPA
    Toby_term --> OtherClaude

    subgraph L6["Layer 6 — UI (browser, no build step)"]
        SPA["React SPA<br/>views/today, week, calendar, epics<br/>+ AgentsDrawer + IssueDrawer"]
    end

    subgraph L4a["Layer 4a — HTTP server (port 8765)"]
        REST["/api/&lt;tool&gt;<br/>(REST wrappers)"]
        CHAT["/api/chat<br/>(NDJSON stream)"]
        STATIC["/dashboard/*<br/>(static files)"]
    end

    subgraph L4b["Layer 4b — stdio MCP server"]
        STDIO["JSON-RPC over stdio<br/>mcp-server/index.mjs"]
    end

    SDK["@anthropic-ai/<br/>claude-agent-sdk<br/>query()"]:::shared

    subgraph L5["Layer 5 — Auth"]
        KC[("~/.claude/credentials<br/>(macOS Keychain)<br/>OAuth — Pro/Max subscription")]:::store
    end

    subgraph L3["Layer 3 — Tools (shared by L4a + L4b)"]
        DISP["handleCall(tool, args)<br/>tools.mjs<br/>(22 tool implementations)"]:::shared
    end

    subgraph L2["Layer 2 — Parsers (pure functions)"]
        PARSE["parsers.mjs<br/>(md ↔ AST, YAML frontmatter)"]
    end

    subgraph L1["Layer 1 — Storage"]
        STORE["store.mjs<br/>(read, write, atomic-rename)"]
        FS[("todouz/data/**<br/>+ ~/.claude/projects/**.jsonl")]:::store
    end

    SPA -->|fetch JSON| REST
    SPA -->|fetch + read NDJSON| CHAT
    SPA -.->|served from| STATIC
    CHAT -->|spawns| SDK
    SDK -.->|reads OAuth token| KC
    SDK -.->|spawns subprocess<br/>+ MCP stdio handshake| L4b

    OtherClaude -.->|claude mcp add todouz<br/>node /abs/path/index.mjs| L4b

    REST --> DISP
    STDIO --> DISP
    DISP --> PARSE
    DISP --> STORE
    PARSE --> STORE
    STORE --> FS
```

### Three running processes (worth being explicit)

1. **`todouz-server`** (long-running): the dashboard's HTTP server. Hosts L4a + L6 statics. Started by `node mcp-server/http-server.mjs` or via launch.json. Listens on 8765.
2. **stdio MCP subprocess** (per-chat or per-claude-session): spawned on demand. Two ways it gets spawned:
   - The dashboard's `/api/chat` calls `query()` from the SDK, which spawns one for the duration of that chat.
   - An external `claude` session at any cwd spawns one when `claude mcp` resolves the `todouz` server entry.
3. **External `claude` CLI** (when used): the user's terminal. Independent auth, independent cwd. Talks to its spawned MCP subprocess.

Crucially: **all three forms route through the same `tools.mjs` dispatcher**. There's no second copy of the business logic.

### Why both stdio MCP *and* HTTP?

Different consumers want different transports:

- The dashboard SPA can't speak stdio MCP. It needs HTTP/REST.
- An external `claude` CLI session can't easily talk to a long-running HTTP server (auth, port discovery, etc.). It speaks MCP stdio natively.

Same code, two adapters at L4. The dashboard's `/api/chat` is a special case because it needs to *spawn an agent* (the SDK), not just call a tool — so it's an extra adapter layered on top.

---

## C. Sequence — dashboard marks an issue done (F1)

```mermaid
sequenceDiagram
    participant T as 👤 the user
    participant SPA as React SPA
    participant API as HTTP /api/complete_issue
    participant D as handleCall<br/>(tools.mjs)
    participant FS as data/epics/.../issues.md<br/>+ state/completion.json

    T->>SPA: click "Mark Complete" on ISS-014
    SPA-->>T: optimistic strikethrough
    SPA->>API: POST {id: "ISS-014"}
    API->>D: complete_issue({id: "ISS-014"})
    D->>FS: read issues.md
    D->>FS: flip [ ]→[x] for ISS-014
    D->>FS: write state/completion.json[ISS-014] = {completed_at: now}
    D-->>API: {ok: true, completion_kind: "one-off"}
    API-->>SPA: 200 OK
    SPA->>API: GET /api/list_today (refetch)
    API-->>SPA: updated today payload
    SPA-->>T: dashboard reflects new state
```

---

## D. Sequence — external Claude session creates an issue (F5)

The MCP-as-tool flow. the user is in his terminal, working on something else, and asks his current Claude session to drop a note into todouz.

```mermaid
sequenceDiagram
    participant T as 👤 the user (terminal)
    participant CC as claude CLI<br/>(at ~/Documents/University/...)
    participant MCP as todouz stdio MCP<br/>(spawned subprocess)
    participant D as handleCall<br/>(tools.mjs)
    participant FS as data/epics/side-project/<br/>thetas/issues.md
    participant SPA as Dashboard SPA<br/>(separate browser tab)

    T->>CC: "todouz: add an issue under thetas to ship the<br/>Stripe integration by Friday, priority high"
    CC->>MCP: tool_use create_issue<br/>{epic: "side-project/thetas", title, due, priority}
    MCP->>D: handleCall("create_issue", args)
    D->>FS: bump state/issue-counter.json[side-project/thetas] → 22
    D->>FS: append "## ISS-022 — Ship Stripe integration..." to issues.md
    D-->>MCP: {ok: true, id: "ISS-022", epic_slug: "side-project/thetas"}
    MCP-->>CC: tool_result
    CC-->>T: "added ISS-022 under side-project/thetas, due Fri 2026-05-08"

    Note over SPA: minutes later, the user switches to dashboard tab
    SPA->>SPA: window.focus → refetch
    SPA-->>T: ISS-022 appears in the Thetas epic
```

This works *without the dashboard server running* — the stdio MCP touches the filesystem directly. When the dashboard does come back up, it sees the new state on first read.

---

## E. Sequence — capture-to-cards via dashboard agent chat (F2)

The "press space, dump a paragraph, watch the agent create the right issues" flow.

```mermaid
sequenceDiagram
    participant T as 👤 the user (browser)
    participant SPA as Dashboard SPA
    participant CHAT as HTTP /api/chat (NDJSON)
    participant SDK as claude-agent-sdk query()
    participant MCP as todouz stdio MCP<br/>(spawned by SDK)
    participant D as handleCall
    participant FS as data/epics/.../issues.md

    T->>SPA: press space → AgentsDrawer opens at scheduler
    T->>SPA: type "had sprint planning for CS-401,<br/>need to review architecture, finalize tech stack,<br/>build a diagram, write week 9 report by Tue"
    T->>SPA: press enter
    SPA->>CHAT: POST {message, agent: "scheduler"}
    CHAT->>SDK: query({prompt, mcpServers: {todouz: ...}})
    SDK->>MCP: spawn subprocess (stdio)
    SDK-->>CHAT: stream system event {sessionId}
    CHAT-->>SPA: NDJSON: system event
    SPA-->>T: render "scheduler is thinking..."

    SDK->>MCP: tool_use create_issue (architecture review)
    MCP->>D: create_issue
    D->>FS: ## ISS-015 ...
    MCP-->>SDK: result

    SDK->>MCP: tool_use create_issue (tech stack)
    MCP->>D: create_issue
    D->>FS: ## ISS-016 ...
    MCP-->>SDK: result

    SDK->>MCP: tool_use create_issue (architecture diagram)
    MCP->>D: create_issue
    D->>FS: ## ISS-017 ...
    MCP-->>SDK: result

    SDK->>MCP: tool_use create_issue (week 9 report, due Tue)
    MCP->>D: create_issue
    D->>FS: ## ISS-018 ...
    MCP-->>SDK: result

    SDK-->>CHAT: stream text "Created 4 issues under CS-401..."
    CHAT-->>SPA: NDJSON: text + done
    SPA->>SPA: refetch dashboard data
    SPA-->>T: 4 new issues visible in Studies / CS-401
```

---

## F. Storage map — where every byte lives

```mermaid
flowchart LR
    classDef store fill:#f0e8d0,stroke:#3d2817

    subgraph Todouz["todouz/ (this repo)"]
        direction TB
        subgraph Personal["data/personal/"]
            profile["profile.md"]
            roadmap["roadmap.md (optional)"]
        end
        subgraph Agents["data/agents/&lt;name&gt;/"]
            ident["identity.md"]
            sysp["system-prompt.md"]
        end
        subgraph Epics["data/epics/&lt;cat&gt;/&lt;slug&gt;/"]
            epicMd["epic.md (frontmatter + body)"]
            issuesMd["issues.md"]
        end
        subgraph LinkedDocs["data/linked-docs/"]
            linkfiles["*.md (reusable refs)"]
        end
        subgraph State["data/state/"]
            comp["completion.json"]
            evt["events.json"]
            sl["session-links.json"]
            ic["issue-counter.json"]
        end
    end

    subgraph Home["~/.claude/"]
        creds["credentials (Keychain entry)"]:::store
        sessions["projects/&lt;hashed-cwd&gt;/&lt;sid&gt;.jsonl"]:::store
    end

    Todouz -.->|reads OAuth| creds
    Todouz -.->|reads transcripts<br/>session_id from session-links.json| sessions
```

---

## What I want sign-off on (before any code lands)

1. **Diagram A (ER)** — does the entity model match how you think about your work?
2. **Diagram B (architecture)** — are the layers right? Anything missing?
3. The **two-entry-point design** in Diagram B (browser + external Claude CLI both hitting the same dispatcher). Worth the small extra complexity vs. just dashboard-only?
4. **Issue id scope** — `ISS-NNN` per-epic (readable, but cross-epic moves renumber) vs. global (`ISS-1042` everywhere, immutable). I picked per-epic. Easy to swap.
5. **Recurring issue model** — separate template + instance vs. one issue with embedded log + per-date completion key. I picked the latter. The body agent can `log_recurrence` to record a session and append to the epic's progression notes in one call.

If A + B match your model, I'll start in this order:
1. `parsers.mjs` (testable in isolation, no IO)
2. `store.mjs` + `tools.mjs` (the 15 MVP tools)
3. `mcp-server/index.mjs` (stdio entry — proves "claude mcp add todouz" works from another cwd)
4. `mcp-server/http-server.mjs` (REST + /api/chat)
5. Dashboard SPA — `today` view first, then `epics`, then drawers
6. Run `scripts/migrate-from-prototype.mjs` against real data
7. Cut over

Each step is observable end-to-end before the next starts.
