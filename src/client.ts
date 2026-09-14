#!/usr/bin/env node
/**
 * Demo MCP client (the "host" side).
 *
 * Connects to the HTTP server over Streamable HTTP, lists its tools, and calls
 * get_current_time. This is the other half of the protocol — what Claude Code /
 * the Claude desktop app do internally, shown explicitly.
 *
 * Run the HTTP server first (npm run start:http), then: npm run client
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = new URL(process.env.MCP_URL ?? "http://localhost:3000/mcp");

const client = new Client({ name: "demo-client", version: "1.0.0" });

await client.connect(new StreamableHTTPClientTransport(url));
console.log(`Connected to ${url.href}\n`);

// Discover tools (the client SDK does the initialize handshake for us).
const { tools } = await client.listTools();
console.log("Tools:");
for (const t of tools) console.log(`  - ${t.name}: ${t.description}`);

// Call the tool.
const result = await client.callTool({
  name: "get_current_time",
  arguments: { timezone: "Asia/Kolkata" },
});
console.log("\nCall result:");
console.log(JSON.stringify(result, null, 2));

// Streaming demo: passing `onprogress` makes the SDK attach a progressToken,
// so the server's notifications/progress arrive live — one line per chunk —
// BEFORE the final result. Over HTTP these come in as SSE events.
console.log("\nStreaming load (progress arrives live):");
const streamed = await client.callTool(
  { name: "stream_load", arguments: { steps: 5 } },
  undefined,
  {
    onprogress: (p) =>
      console.log(`  [${p.progress}/${p.total ?? "?"}] ${p.message ?? ""}`),
  }
);
console.log("Final:", JSON.stringify(streamed.content));

await client.close();
