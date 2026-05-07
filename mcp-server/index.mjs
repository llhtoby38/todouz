#!/usr/bin/env node
// todouz MCP server (stdio transport).
// Exposes todouz/data to MCP clients (Claude Code CLI, Claude Desktop, etc.).
//
// Add to a Claude Code session via:
//   claude mcp add todouz node /abs/path/to/todouz/mcp-server/index.mjs
//
// All paths are absolute relative to this file's location, so the server works from any cwd.

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { TOOLS, handleCall, safeReplacer } from './tools.mjs';

const server = new Server({ name: 'todouz', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const result = await handleCall(name, args || {});
    return {
      content: [{ type: 'text', text: JSON.stringify(result, safeReplacer, 2) }],
      isError: !!result?.error,
    };
  } catch (e) {
    return {
      content: [{ type: 'text', text: JSON.stringify({ error: String(e?.message || e) }) }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
