/**
 * Shared server factory.
 *
 * The tool definition lives here so BOTH transports — stdio (src/index.ts) and
 * Streamable HTTP (src/http.ts) — reuse the exact same server. This is the key
 * lesson: the tool code is transport-agnostic. Only the `connect(transport)`
 * call differs between entrypoints.
 *
 * For the stateless HTTP pattern we build a *fresh* server per request, so this
 * is a factory function rather than a singleton.
 */

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

// A small, static list of common IANA timezones used by the resource below.
const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Kolkata',
  'Asia/Tokyo',
  'Australia/Sydney',
];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'my-first-mcp-server',
    version: '1.0.0',
  });

  server.registerTool(
    'get_current_time',
    {
      title: 'Get current time',
      description:
        'Returns the current date and time. Optionally pass an IANA timezone ' +
        "(e.g. 'Asia/Kolkata', 'America/New_York') to get the time there.",
      inputSchema: {
        timezone: z
          .string()
          .optional()
          .describe(
            "IANA timezone name, e.g. 'Asia/Kolkata'. Defaults to the server's local time.",
          ),
      },
      outputSchema: {
        iso: z.string().describe('ISO 8601 timestamp'),
        unixSeconds: z.number().describe('Seconds since the Unix epoch'),
        timezone: z.string().describe('The IANA timezone the result is expressed in'),
      },
    },
    async ({ timezone }) => {
      try {
        const now = new Date();
        const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const formatted = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          dateStyle: 'full',
          timeStyle: 'long',
        }).format(now);

        return {
          structuredContent: {
            iso: now.toISOString(),
            unixSeconds: Math.floor(now.getTime() / 1000),
            timezone: tz,
          },
          content: [
            {
              type: 'text',
              text: timezone
                ? `Current time in ${timezone}: ${formatted}`
                : `Current local time: ${formatted}`,
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `Invalid timezone "${timezone}". Use an IANA name like 'Asia/Kolkata'.`,
            },
          ],
        };
      }
    },
  );

  // ---------------------------------------------------------------------------
  // STREAMING TOOL — emits a progress notification per step ("streaming text
  // loading"), then returns a final result.
  //
  // Over HTTP (Streamable HTTP, SSE mode) these notifications arrive as live
  // Server-Sent Events on the open POST connection, before the final result.
  // Over stdio they arrive as interleaved JSON-RPC notifications.
  //
  // Streaming requires the CLIENT to opt in with a progressToken. The SDK
  // client sends one automatically when you pass an `onprogress` callback to
  // callTool; we read it from extra._meta.progressToken and only emit if set.
  // ---------------------------------------------------------------------------
  server.registerTool(
    'stream_load',
    {
      title: 'Streaming load demo',
      description:
        'Simulates loading in steps, streaming one progress notification per step, then returns a final message.',
      inputSchema: {
        steps: z
          .number()
          .int()
          .min(1)
          .max(20)
          .optional()
          .describe('Number of progress steps to emit (default 5).'),
      },
    },
    async ({ steps }, extra) => {
      const total = steps ?? 5;
      const progressToken = extra._meta?.progressToken;

      for (let i = 1; i <= total; i++) {
        if (progressToken !== undefined) {
          await extra.sendNotification({
            method: 'notifications/progress',
            params: {
              progressToken,
              progress: i,
              total,
              message: `Loading chunk ${i} of ${total}…`,
            },
          });
        }
        await sleep(1000); // simulate work between chunks
      }

      return {
        content: [{ type: 'text', text: `Done — loaded ${total} chunks.` }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // RESOURCE (static) — read-only data the model/host can fetch by URI.
  //
  // Tools are actions the model *calls*; resources are data the host *reads*
  // (like files). This one is a fixed URI returning a JSON list of timezones.
  // ---------------------------------------------------------------------------
  server.registerResource(
    'common-timezones',
    'timezone://common', // fixed URI
    {
      title: 'Common timezones',
      description: 'A curated list of common IANA timezone names.',
      mimeType: 'application/json',
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'application/json',
          text: JSON.stringify(COMMON_TIMEZONES, null, 2),
        },
      ],
    }),
  );

  // ---------------------------------------------------------------------------
  // RESOURCE (dynamic template) — a URI *pattern* with a variable. Reading
  // time://Asia/Tokyo returns the current time there. `list` is required (even
  // as undefined) so you don't accidentally forget resource enumeration.
  // ---------------------------------------------------------------------------
  server.registerResource(
    'time-by-zone',
    new ResourceTemplate('time://{+timezone}', { list: undefined }),
    {
      title: 'Current time by timezone',
      description: 'Read time://{timezone} to get the current time in that IANA zone.',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const timezone = String(variables.timezone);
      let text: string;
      try {
        text = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          dateStyle: 'full',
          timeStyle: 'long',
        }).format(new Date());
      } catch {
        text = `Invalid timezone "${timezone}". Use an IANA name like 'Asia/Tokyo'.`;
      }
      return {
        contents: [{ uri: uri.href, mimeType: 'text/plain', text }],
      };
    },
  );

  // ---------------------------------------------------------------------------
  // PROMPT — a reusable, parameterized message template the user can invoke
  // (e.g. a slash command in the host). Returns messages, not data.
  // ---------------------------------------------------------------------------
  server.registerPrompt(
    'time_report',
    {
      title: 'Time report',
      description: 'Ask for the current time in a city and report it clearly.',
      argsSchema: {
        city: z.string().describe("City or place name, e.g. 'Tokyo'"),
      },
    },
    ({ city }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `What is the current time in ${city}? Use the get_current_time tool to find out, then state it clearly with the timezone.`,
          },
        },
      ],
    }),
  );

  return server;
}
