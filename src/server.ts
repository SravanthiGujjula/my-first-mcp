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

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "my-first-mcp-server",
    version: "1.0.0",
  });

  server.registerTool(
    "get_current_time",
    {
      title: "Get current time",
      description:
        "Returns the current date and time. Optionally pass an IANA timezone " +
        "(e.g. 'Asia/Kolkata', 'America/New_York') to get the time there.",
      inputSchema: {
        timezone: z
          .string()
          .optional()
          .describe("IANA timezone name, e.g. 'Asia/Kolkata'. Defaults to the server's local time."),
      },
      outputSchema: {
        iso: z.string().describe("ISO 8601 timestamp"),
        unixSeconds: z.number().describe("Seconds since the Unix epoch"),
        timezone: z.string().describe("The IANA timezone the result is expressed in"),
      },
    },
    async ({ timezone }) => {
      try {
        const now = new Date();
        const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
        const formatted = new Intl.DateTimeFormat("en-US", {
          timeZone: timezone,
          dateStyle: "full",
          timeStyle: "long",
        }).format(now);

        return {
          structuredContent: {
            iso: now.toISOString(),
            unixSeconds: Math.floor(now.getTime() / 1000),
            timezone: tz,
          },
          content: [
            {
              type: "text",
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
              type: "text",
              text: `Invalid timezone "${timezone}". Use an IANA name like 'Asia/Kolkata'.`,
            },
          ],
        };
      }
    }
  );

  return server;
}
