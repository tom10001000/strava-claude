# strava-claude

A personal MCP (Model Context Protocol) server that gives Claude access to your Strava training data. Built for personal use with Claude.ai and the Claude mobile app.

---

## What it does

Exposes a single tool — `get_strava_activities` — that Claude can call to fetch your recent Strava activities directly from the Strava API. Each activity includes:

- Date, sport type, name, and description
- Distance (miles), moving time, elapsed time, elevation
- Average and max heart rate (where recorded)
- Average pace per mile (for runs)
- Lap-by-lap breakdown

When added to a Claude project with the instruction to call this tool at the start of each conversation, Claude automatically loads your latest data without you having to upload or paste anything.

## What it can't do

- **Write to Strava** — read-only, no creating or modifying activities
- **Fetch more than 20 activities** by default (configurable via `num_activities` parameter)
- **Authenticate via OAuth** — uses no auth; intended for personal/private deployment only
- **Run without a server** — requires a VPS or other always-on host to work with Claude.ai and the mobile app (a local stdio version for the Claude desktop app is also included)

## Project structure

```
strava_sync.py              # Syncs activities to activities.txt (used by local/desktop version)
strava_mcp_server.js        # Local MCP server (stdio) — for Claude desktop app only
strava_mcp_server_http.js   # Remote MCP server (HTTP) — for Claude.ai and mobile app
deploy.sh                   # Deploys HTTP server to VPS
.env.example                # Required environment variables
```

## Setup

### Requirements

- Node.js 18+
- A Strava API app ([create one here](https://www.strava.com/settings/api))
- For remote use: a VPS with nginx and a domain or sslip.io address

### Environment variables

Copy `.env.example` to `.env` and fill in your values:

```
STRAVA_CLIENT_ID=your_client_id
STRAVA_CLIENT_SECRET=your_client_secret
STRAVA_REFRESH_TOKEN=your_refresh_token
```

### Run locally (Claude desktop app)

```bash
npm install
```

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "strava": {
      "command": "node",
      "args": ["/path/to/strava_mcp_server.js"]
    }
  }
}
```

### Deploy remotely (Claude.ai + mobile)

```bash
./deploy.sh
```

Requires nginx and certbot configured on the VPS. The MCP endpoint will be available at `https://yourdomain.com/mcp`.

Add as a custom connector in Claude.ai under **Settings → Connectors → Add custom connector**.

### Claude project instructions

Add this to your Claude project instructions so Claude fetches data automatically at the start of each conversation:

> At the start of every new conversation, call the `get_strava_activities` tool to fetch my latest training data. Do this before responding to anything else. Then provide a brief training summary.
