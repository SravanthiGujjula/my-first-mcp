#!/usr/bin/env node
/**
 * stdio entrypoint.
 *
 * The host (Claude Code, Claude desktop) launches this as a child process and
 * talks JSON-RPC over stdin/stdout. The tool itself lives in ./server.ts and is
 * shared with the HTTP entrypoint (./http.ts).
 *
 * stdio rule: never write to stdout with console.log — stdout is the JSON-RPC
 * channel. Log to stderr with console.error.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("my-first-mcp-server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
