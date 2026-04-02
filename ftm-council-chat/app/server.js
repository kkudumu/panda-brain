'use strict';

const express = require('express');
const http    = require('http');
const path    = require('path');
const { Server } = require('socket.io');

const { EVENTS }            = require('./src/protocol');
const db                    = require('./src/db');
const { generateScreennames } = require('./src/screennames');
const { Facilitator }       = require('./src/facilitator');

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

let topic       = null;
let contextPayload = null;
let startPort   = 3000;

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--topic' && argv[i + 1]) {
    topic = argv[++i];
  } else if (argv[i] === '--context' && argv[i + 1]) {
    try {
      contextPayload = JSON.parse(argv[++i]);
    } catch (e) {
      console.error('Warning: --context value is not valid JSON, ignoring.', e.message);
      i++; // still advance
    }
  } else if (argv[i] === '--port' && argv[i + 1]) {
    startPort = parseInt(argv[++i], 10) || 3000;
  }
}

if (!topic) {
  console.error('Error: --topic is required.\nUsage: node server.js --topic "Redis vs SQLite" [--context \'{"positions":...}\'] [--port 3000]');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Express + Socket.IO setup
// ---------------------------------------------------------------------------

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/src',    express.static(path.join(__dirname, 'src')));
app.use('/98.css', express.static(path.join(__dirname, 'node_modules', '98.css')));

// ---------------------------------------------------------------------------
// Initialize components
// ---------------------------------------------------------------------------

const screennames = generateScreennames();
const sessionId   = db.createSession(topic, contextPayload || null);

const facilitator = new Facilitator({
  topic,
  screennames,
  db,
  sessionId,
  emitEvent: (eventName, payload) => io.emit(eventName, payload),
  cwd: process.cwd(),
});

// ---------------------------------------------------------------------------
// Socket.IO connection handler
// ---------------------------------------------------------------------------

io.on('connection', (socket) => {
  console.log('Browser connected:', socket.id);

  // 1. Emit session_start immediately
  socket.emit(EVENTS.SESSION_START, { screennames, topic });

  // 2. Staggered model_joined sign-on sequence
  setTimeout(() => {
    io.emit(EVENTS.MODEL_JOINED, { model: 'claude', screenname: screennames.claude });
  }, 500);

  setTimeout(() => {
    io.emit(EVENTS.MODEL_JOINED, { model: 'codex', screenname: screennames.codex });
  }, 1000);

  setTimeout(() => {
    io.emit(EVENTS.MODEL_JOINED, { model: 'gemini', screenname: screennames.gemini });
  }, 1500);

  // 3. Start first round after sign-on completes (all 3 models in parallel)
  setTimeout(() => {
    facilitator.runAllParallel();
  }, 2000);

  // Handle user messages
  socket.on(EVENTS.USER_MESSAGE, (data) => {
    if (data && typeof data.text === 'string') {
      facilitator.handleUserMessage(data.text);
    }
  });

  socket.on('disconnect', () => {
    console.log('Browser disconnected:', socket.id);
  });
});

// ---------------------------------------------------------------------------
// Browser auto-open helper (ESM-only open package)
// ---------------------------------------------------------------------------

const openBrowser = async (url) => {
  try {
    const { default: open } = await import('open');
    open(url);
  } catch (e) {
    console.log('Could not auto-open browser:', e.message);
  }
};

// ---------------------------------------------------------------------------
// Port selection with retry
// ---------------------------------------------------------------------------

// Find an available port, then listen once
const net = require('net');

function findAvailablePort(start, maxTries) {
  return new Promise((resolve, reject) => {
    let port = start;
    let tries = 0;

    function tryPort() {
      if (tries >= maxTries) {
        reject(new Error('No available port found'));
        return;
      }
      const tester = net.createServer();
      tester.once('error', () => {
        tries++;
        port++;
        tryPort();
      });
      tester.once('listening', () => {
        tester.close(() => resolve(port));
      });
      tester.listen(port);
    }

    tryPort();
  });
}

findAvailablePort(startPort, 11).then((port) => {
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log('');
    console.log('AIM Council Chat');
    console.log(`Topic: "${topic}"`);
    console.log(`Screennames: ${screennames.claude}, ${screennames.codex}, ${screennames.gemini}, ${screennames.user}`);
    console.log(`Server: ${url}`);
    console.log('');
    openBrowser(url);
  });
}).catch((err) => {
  console.error('Could not find an available port:', err.message);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------

process.on('SIGINT', () => {
  console.log('\nShutting down...');
  facilitator.stop();
  server.close();
  process.exit(0);
});
