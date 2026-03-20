import 'dotenv/config';
import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// ── Strava API ────────────────────────────────────────────────────────────────

async function getAccessToken() {
  const res = await fetch('https://www.strava.com/api/v3/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      refresh_token: process.env.STRAVA_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error(`Strava auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

async function stravaGet(token, path) {
  const res = await fetch(`https://www.strava.com/api/v3${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.json();
}

function formatActivity(a, laps) {
  const lines = [];
  const date = a.start_date_local.slice(0, 10);
  lines.push(`\n${'='.repeat(60)}`);
  lines.push(`Date: ${date} | Sport: ${a.sport_type} | Name: ${a.name}`);

  if (a.description) lines.push(`Description: ${a.description}`);

  const distMi   = (a.distance / 1609.34).toFixed(2);
  const movingMin  = (a.moving_time / 60).toFixed(1);
  const elapsedMin = (a.elapsed_time / 60).toFixed(1);
  const elevFt   = Math.round((a.total_elevation_gain || 0) * 3.28084);
  lines.push(`Distance: ${distMi} mi | Moving Time: ${movingMin} min | Elapsed Time: ${elapsedMin} min | Elevation: ${elevFt} ft`);

  if (a.average_heartrate) {
    lines.push(`Heart Rate: avg ${a.average_heartrate} bpm | max ${a.max_heartrate} bpm`);
  }

  if (a.sport_type === 'Run' && a.distance > 0) {
    const paceSecPerMile = a.moving_time / (a.distance / 1609.34);
    const paceMin = Math.floor(paceSecPerMile / 60);
    const paceSec = Math.floor(paceSecPerMile % 60);
    lines.push(`Avg Pace: ${paceMin}:${String(paceSec).padStart(2, '0')} /mi`);
  }

  if (laps && laps.length > 1) {
    lines.push(`Laps (${laps.length}):`);
    laps.forEach((lap, i) => {
      const lapDist = (lap.distance / 1609.34).toFixed(2);
      const lapMin  = (lap.moving_time / 60).toFixed(1);
      const lapElev = Math.round((lap.total_elevation_gain || 0) * 3.28084);
      const hrStr   = lap.average_heartrate ? ` | HR: ${lap.average_heartrate} bpm` : '';
      lines.push(`  Lap ${i + 1}: ${lapDist} mi | ${lapMin} min | ${lapElev} ft${hrStr}`);
    });
  }

  return lines.join('\n');
}

async function fetchStravaActivities(num = 20) {
  const token = await getAccessToken();

  const perPage = 50;
  const pages = Math.ceil(num / perPage);
  let allActivities = [];

  for (let page = 1; page <= pages; page++) {
    const needed = num - allActivities.length;
    const pageSize = Math.min(perPage, needed);

    const batch = await stravaGet(token, `/athlete/activities?per_page=${pageSize}&page=${page}`);

    if (!Array.isArray(batch) || batch.length === 0) break;

    allActivities = allActivities.concat(batch);
    if (allActivities.length >= num) break;

    if (page < pages) await new Promise(r => setTimeout(r, 300));
  }

  const lines = [`STRAVA ACTIVITIES — Last ${allActivities.length} activities\n`];

  for (let i = 0; i < allActivities.length; i++) {
    const a = allActivities[i];
    const [detail, laps] = await Promise.all([
      stravaGet(token, `/activities/${a.id}`),
      stravaGet(token, `/activities/${a.id}/laps`),
    ]);
    a.description = detail.description;
    lines.push(formatActivity(a, laps));

    if (i % 10 === 9) await new Promise(r => setTimeout(r, 500));
  }

  return lines.join('\n');
}

// ── MCP server factory ────────────────────────────────────────────────────────

function createMCPServer() {
  const server = new Server(
    { name: 'strava-ringo', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [{
      name: 'get_strava_activities',
      description: 'Fetch the latest Strava training activities. Always call this at the start of a conversation to load fresh data before any analysis.',
      inputSchema: {
        type: 'object',
        properties: {
          num_activities: {
            type: 'number',
            description: 'Number of recent activities to fetch (default: 20)',
          },
        },
      },
    }],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'get_strava_activities') {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }
    const num = request.params.arguments?.num_activities ?? 20;
    const data = await fetchStravaActivities(num);
    return { content: [{ type: 'text', text: data }] };
  });

  return server;
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.post('/mcp', async (req, res) => {
  const server = createMCPServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  res.on('close', () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP error:', err);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Strava MCP server listening on 0.0.0.0:${PORT}`);
});
