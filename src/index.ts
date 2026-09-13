#!/usr/bin/env node
/**
 * A minimal MCP server.
 *
 * MCP (Model Context Protocol) lets an AI "host" (Claude Code, the Claude
 * desktop app, etc.) discover and call tools that YOU expose from a server.
 *
 * This server:
 *   1. Speaks over "stdio" — the host launches this process and talks to it
 *      over stdin/stdout using JSON-RPC. (There's also an HTTP transport, but
 *      stdio is the simplest for a local server and is all we need here.)
 *   2. Exposes exactly ONE tool: `get_current_time`.
 *
 * IMPORTANT for stdio servers: never write logs to stdout with console.log —
 * stdout is the JSON-RPC channel and stray text will corrupt it. Use
 * console.error (stderr) for any logging/debugging.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// 1. Create the server. `name` and `version` identify it to the host.
const server = new McpServer({
  name: "my-first-mcp-server",
  version: "1.0.0",
});

// 2. Register a single tool.
//    - The first arg is the tool name the model will call.
//    - `inputSchema` is a Zod "shape" (plain object of Zod validators). The SDK
//      turns it into a JSON Schema the host shows the model, AND validates every
//      incoming call against it before your handler runs.
//    - The handler returns a result whose `content` is an array of parts
//      (text, image, etc.). Here we just return one text part.
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
    // outputSchema makes the tool return typed, machine-readable data. When it's
    // present, the handler MUST return `structuredContent` matching this shape;
    // the SDK validates it. We also return `content` as a human/LLM-readable
    // fallback (allowed, and good practice).
    outputSchema: {
      iso: z.string().describe("ISO 8601 timestamp"),
      unixSeconds: z.number().describe("Seconds since the Unix epoch"),
      timezone: z.string().describe("The IANA timezone the result is expressed in"),
    },
  },
  async ({ timezone }) => {
    try {
      const now = new Date();
      // Resolve to a concrete timezone so structuredContent.timezone is never
      // empty (falls back to the server's local zone).
      const tz = timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      const formatted = new Intl.DateTimeFormat("en-US", {
        timeZone: timezone, // undefined => server local time
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
      // A bad timezone throws a RangeError. Report it back as a tool error
      // rather than crashing the server.
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

// 3. Connect the server to the stdio transport and start listening.
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("my-first-mcp-server running on stdio"); // stderr, safe to log
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
