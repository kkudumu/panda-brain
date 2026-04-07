// Stdio-based MCP server entry point
// This file is invoked by AI CLIs (claude, codex, gemini) as a subprocess
// It reads JSON-RPC messages from stdin and writes responses to stdout

import { FtmMcpServer } from './server.js';
import { getDbPath, ensureDataDir } from '@ftm/daemon/config';
import * as readline from 'readline';

// Parse --db flag from args, or use default
function getDbPathFromArgs(): string {
  const dbIndex = process.argv.indexOf('--db');
  if (dbIndex !== -1 && process.argv[dbIndex + 1]) {
    return process.argv[dbIndex + 1];
  }
  ensureDataDir();
  return getDbPath();
}

const dbPath = getDbPathFromArgs();
const server = new FtmMcpServer(dbPath);

// JSON-RPC message handling
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function sendResponse(response: JsonRpcResponse): void {
  const json = JSON.stringify(response);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  switch (request.method) {
    case 'initialize': {
      sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'ftm',
            version: '0.1.0',
          },
        },
      });
      break;
    }

    case 'tools/list': {
      sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          tools: server.getToolDefinitions(),
        },
      });
      break;
    }

    case 'tools/call': {
      const name = request.params?.name as string;
      const args = (request.params?.arguments as Record<string, unknown>) ?? {};
      const result = await server.handleToolCall(name, args);
      sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        result,
      });
      break;
    }

    case 'notifications/initialized': {
      // Client acknowledged initialization — no response needed
      break;
    }

    default: {
      sendResponse({
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32601, message: `Method not found: ${request.method}` },
      });
    }
  }
}

// Read JSON-RPC messages from stdin (Content-Length framed)
let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  buffer += chunk;

  while (true) {
    const headerEnd = buffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = buffer.substring(0, headerEnd);
    const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i);
    if (!contentLengthMatch) {
      buffer = buffer.substring(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(contentLengthMatch[1], 10);
    const bodyStart = headerEnd + 4;

    if (buffer.length < bodyStart + contentLength) break;

    const body = buffer.substring(bodyStart, bodyStart + contentLength);
    buffer = buffer.substring(bodyStart + contentLength);

    try {
      const request: JsonRpcRequest = JSON.parse(body);
      handleRequest(request).catch(err => {
        sendResponse({
          jsonrpc: '2.0',
          id: request.id,
          error: { code: -32603, message: err.message },
        });
      });
    } catch (err) {
      // Invalid JSON — skip
    }
  }
});

process.on('SIGINT', () => {
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  server.close();
  process.exit(0);
});

// Suppress the unused import warning — readline is imported for its side effects
// (sets up proper TTY handling on some platforms) but not used directly here
void readline;
