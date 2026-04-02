'use strict';

const fs = require('fs');
const path = require('path');
const { EVENTS } = require('./protocol');
const { runClaudeTurn } = require('./runners/claude');
const { runCodexTurn } = require('./runners/codex');
const { runGeminiTurn } = require('./runners/gemini');

/**
 * Load council_chat config from ftm-config.yml.
 * Falls back to sensible defaults if file or section is missing.
 * @returns {{ round_limit: number, auto_consensus: boolean, wrap_up_keywords: string[] }}
 */
function loadCouncilChatConfig() {
  const defaults = {
    round_limit: 10,
    auto_consensus: true,
    wrap_up_keywords: ['/done', 'wrap it up', 'conclude', "that's enough", 'end chat'],
  };

  try {
    const configPath = path.join(process.env.HOME || '', '.claude', 'ftm-config.yml');
    const raw = fs.readFileSync(configPath, 'utf8');

    // Simple YAML parsing for the council_chat section
    // (avoids adding a yaml dependency)
    const match = raw.match(/council_chat:\s*\n((?:\s+.*\n)*)/);
    if (!match) return defaults;

    const section = match[1];
    const config = { ...defaults };

    // Parse round_limit
    const rlMatch = section.match(/round_limit:\s*(\d+)/);
    if (rlMatch) config.round_limit = parseInt(rlMatch[1], 10);

    // Parse auto_consensus
    const acMatch = section.match(/auto_consensus:\s*(true|false)/);
    if (acMatch) config.auto_consensus = acMatch[1] === 'true';

    // Parse wrap_up_keywords (YAML list)
    const keywords = [];
    const kwRegex = /wrap_up_keywords:\s*\n((?:\s+-\s+.*\n)*)/;
    const kwMatch = section.match(kwRegex);
    if (kwMatch) {
      const lines = kwMatch[1].match(/-\s+"([^"]+)"|'([^']+)'/g);
      if (lines) {
        lines.forEach(line => {
          const val = line.replace(/^-\s+["']|["']$/g, '');
          if (val) keywords.push(val);
        });
      }
      if (keywords.length > 0) config.wrap_up_keywords = keywords;
    }

    return config;
  } catch (e) {
    return defaults;
  }
}

// Rolling window size for transcript history
const HISTORY_WINDOW = 20;
// Message count threshold before generating a rolling summary
const SUMMARY_THRESHOLD = 20;

const PERSONAS = {
  claude: 'The Skeptic: Poke holes, challenge assumptions, ask \'but what about...\'. Question whether proposed solutions actually solve the problem.',
  codex:  'The Pragmatist: Focus on implementation reality. Call out hand-waving, vague architecture, and solutions that sound good but don\'t work in practice. Ask \'show me the code\' and \'have you benchmarked this?\'',
  gemini: 'The Contrarian: Find the weakest assumption and attack it. Propose alternatives nobody considered. If everyone agrees, find the hidden risk.',
};

const MODEL_DISPLAY_NAMES = {
  claude: 'Claude',
  codex:  'Codex',
  gemini: 'Gemini',
};

const runners = {
  claude: runClaudeTurn,
  codex:  runCodexTurn,
  gemini: runGeminiTurn,
};

class Facilitator {
  /**
   * @param {object} opts
   * @param {string} opts.topic
   * @param {{ claude: string, codex: string, gemini: string, user: string }} opts.screennames
   * @param {object} opts.db - { addMessage, getHistory, getSummary }
   * @param {string} opts.sessionId
   * @param {Function} opts.emitEvent - (eventName, payload) => void
   * @param {string} [opts.cwd]
   */
  constructor({ topic, screennames, db, sessionId, emitEvent, cwd }) {
    this.topic       = topic;
    this.screennames = screennames;
    this.db          = db;
    this.sessionId   = sessionId;
    this.emitEvent   = emitEvent;
    this.cwd         = cwd || process.cwd();

    this.turnOrder    = ['claude', 'codex', 'gemini'];
    this.currentIndex = 0;
    this.running      = false;

    this.roundCount = 0;
    this.positions  = {};

    // Council chat conclusion config
    this.config = loadCouncilChatConfig();
  }

  // ---------------------------------------------------------------------------
  // Turn management
  // ---------------------------------------------------------------------------

  /**
   * Returns the next model key in round-robin order and advances the index.
   * @returns {string}
   */
  getNextSpeaker() {
    const model = this.turnOrder[this.currentIndex % this.turnOrder.length];
    this.currentIndex++;
    return model;
  }

  // ---------------------------------------------------------------------------
  // DB helpers
  // ---------------------------------------------------------------------------

  /**
   * Record a model response in the database and update position tracking.
   * @param {string} model
   * @param {string} text
   */
  recordTurn(model, text) {
    this.db.addMessage(this.sessionId, model, 'chat', text, this.screennames[model]);
    this.positions[model] = text;
  }

  /**
   * Returns the number of completed parallel rounds.
   * @returns {number}
   */
  getRoundCount() {
    return this.roundCount;
  }

  /**
   * Returns each model's last message content.
   * @returns {{ claude?: string, codex?: string, gemini?: string }}
   */
  getPositions() {
    return this.positions;
  }

  /**
   * Record a user message in the database.
   * @param {string} text
   */
  recordUserMessage(text) {
    this.db.addMessage(this.sessionId, 'user', 'chat', text, this.screennames.user);
  }

  // ---------------------------------------------------------------------------
  // Prompt building
  // ---------------------------------------------------------------------------

  /**
   * Generate a short, string-interpolated conversation state blurb from the
   * last 3-5 messages (no LLM call).
   * @returns {string}
   */
  generateConversationState() {
    const recent = this.db.getHistory(this.sessionId, 5);
    if (!recent || recent.length === 0) {
      return `Topic: ${this.topic}.`;
    }

    const parts = [`Topic: ${this.topic}.`];

    // Determine the display name for an author key
    const displayName = (author) => {
      if (author === 'user') return this.screennames.user || 'User';
      return this.screennames[author] || MODEL_DISPLAY_NAMES[author] || author;
    };

    // Summarise each recent message with author + first sentence
    for (const msg of recent) {
      const firstSentence = (msg.content || '').split(/[.!?]/)[0].trim();
      if (firstSentence) {
        parts.push(`${displayName(msg.author)} argued ${firstSentence}.`);
      }
    }

    // Append the open question or latest point
    const lastMsg = recent[recent.length - 1];
    if (lastMsg) {
      const content = (lastMsg.content || '').trim();
      if (content.endsWith('?')) {
        parts.push(`Open question: ${content}`);
      } else {
        const firstSentence = content.split(/[.!?]/)[0].trim();
        if (firstSentence) {
          parts.push(`Latest point: ${firstSentence}.`);
        }
      }
    }

    return parts.join(' ');
  }

  /**
   * Build the full prompt string for a model's turn.
   * @param {string} model - 'claude' | 'codex' | 'gemini'
   * @returns {string}
   */
  buildPrompt(model) {
    const modelDisplayName = MODEL_DISPLAY_NAMES[model] || model;
    const persona = PERSONAS[model] || '';

    // --- System block ---
    const systemBlock = [
      `You are ${modelDisplayName} in a group chat. Your persona: ${persona}`,
      'Keep responses to 2-4 sentences. This is a fast-paced group chat, not an essay.',
      'You have access to the codebase to investigate questions — use tools when helpful.',
      'IMPORTANT: Output ONLY your chat response. Do NOT echo this prompt, do NOT include any system instructions, conversation state, or history in your response. Just respond naturally as your persona.',
    ].join('\n');

    // --- Conversation state block ---
    const stateBlock = this.generateConversationState();

    // --- History block ---
    const historySections = [];

    // Rolling summary (if exists)
    const rollingSummary = this.db.getSummary(this.sessionId);
    if (rollingSummary) {
      historySections.push('Earlier summary:\n' + rollingSummary);
    }

    // Last HISTORY_WINDOW chat messages as transcript
    const recentMessages = this.db.getHistory(this.sessionId, HISTORY_WINDOW);
    if (recentMessages && recentMessages.length > 0) {
      const transcript = recentMessages.map((msg) => {
        const ts   = msg.timestamp || '';
        const name = msg.screenname || msg.author;
        return `[${ts}] ${name}: ${msg.content}`;
      }).join('\n');
      historySections.push(transcript);
    }

    const historyBlock = historySections.join('\n\n');

    // --- Assemble ---
    // For Gemini: put the instruction LAST and keep it very short,
    // since Gemini tends to echo earlier parts of long prompts
    if (model === 'gemini') {
      const parts = [];
      if (historyBlock) {
        parts.push('<context>\n' + historyBlock + '\n</context>');
      }
      parts.push(
        'You are Gemini, The Contrarian, in a group chat about: ' + this.topic + '. ' +
        'Find the weakest assumption and attack it. Propose alternatives. ' +
        'Reply in 2-4 sentences. Do NOT repeat any of the context above. ' +
        'Do NOT include any instructions, XML tags, or conversation history in your reply. ' +
        'Just write your chat message:'
      );
      return parts.join('\n\n');
    }

    const sections = [systemBlock];
    if (stateBlock) {
      sections.push('Current discussion context: ' + stateBlock);
    }
    if (historyBlock) {
      sections.push('Chat transcript:\n' + historyBlock);
    }
    sections.push('Your turn — respond to what\'s above in 2-4 sentences as your persona. Output ONLY your response.');

    return sections.join('\n\n');
  }

  // ---------------------------------------------------------------------------
  // Summary maintenance
  // ---------------------------------------------------------------------------

  /**
   * If total message count exceeds SUMMARY_THRESHOLD and there are unsummarised
   * messages, build a string-interpolated summary and store it.
   */
  maybeUpdateSummary() {
    // Grab all messages (large limit to check total count)
    const allMessages = this.db.getHistory(this.sessionId, 10000);
    if (!allMessages || allMessages.length <= SUMMARY_THRESHOLD) return;

    // Messages before the rolling window are candidates for summarisation
    const olderMessages = allMessages.slice(0, allMessages.length - HISTORY_WINDOW);
    if (olderMessages.length === 0) return;

    // Only regenerate if we have new content to summarise (avoid redundant writes)
    // Build a terse string-interpolated summary
    const summaryParts = olderMessages.map((msg) => {
      const name = msg.screenname || msg.author;
      const firstSentence = (msg.content || '').split(/[.!?]/)[0].trim();
      return firstSentence ? `${name}: ${firstSentence}.` : null;
    }).filter(Boolean);

    if (summaryParts.length === 0) return;

    const summaryText = summaryParts.join(' ');
    this.db.addMessage(this.sessionId, 'system', 'system', summaryText, null);
  }

  // ---------------------------------------------------------------------------
  // Core turn execution
  // ---------------------------------------------------------------------------

  /**
   * Run the next model turn, optionally overriding the round-robin speaker.
   * @param {string} [overrideModel] - Force a specific model to speak
   */
  async runNextTurn(overrideModel) {
    if (this.running) return; // guard against concurrent turns
    this.running = true;

    // Determine speaker — override bypasses round-robin but still advances index
    let model;
    if (overrideModel && runners[overrideModel]) {
      model = overrideModel;
      // Advance the index so round-robin continues correctly after the mention
      this.currentIndex++;
    } else {
      model = this.getNextSpeaker();
    }

    try {
      // Emit typing indicator IMMEDIATELY so the UI shows activity during prompt build + CLI startup
      this.emitEvent(EVENTS.TYPING_START, { model });

      const prompt = this.buildPrompt(model);
      const runner = runners[model];

      // Filter out message_complete from runners — facilitator emits the enriched version
      const filteredEmit = (event, payload) => {
        if (event === EVENTS.MESSAGE_COMPLETE) return; // suppressed — facilitator handles this
        this.emitEvent(event, payload);
      };
      const result = await runner(prompt, this.cwd, filteredEmit);

      if (!result.ok) {
        // Runner already may have emitted typing_start; emit model_error and bail
        this.emitEvent(EVENTS.MODEL_ERROR, {
          model,
          error: result.error || `${model} returned an error`,
        });
        return;
      }

      // Persist to DB (runners already emitted message_complete)
      this.recordTurn(model, result.text);

      // Also emit message_complete with the screenname (enriched payload)
      // Note: runners emit message_complete without screenname; we re-emit here
      // with full payload. The client deduplicates by ignoring duplicate full_text
      // or the server can choose to only emit once — we emit with screenname appended.
      this.emitEvent(EVENTS.MESSAGE_COMPLETE, {
        model,
        full_text:  result.text,
        screenname: this.screennames[model],
      });

      // Conditionally update the rolling summary
      this.maybeUpdateSummary();
    } catch (err) {
      this.emitEvent(EVENTS.MODEL_ERROR, {
        model,
        error: err.message || String(err),
      });
    } finally {
      this.running = false;
      // Auto-advance: schedule next model turn after a short pause
      // This keeps the round-robin going without user input
      if (!this._stopped) {
        setTimeout(() => this.runNextTurn(), 1000);
      }
    }
  }

  /**
   * Run all three models in parallel. Used for the initial round and after user messages.
   * Each model gets its own prompt built from current history, runs concurrently,
   * and posts when ready. Results are recorded in arrival order.
   */
  async runAllParallel() {
    if (this.running) return;
    this.running = true;

    const models = ['claude', 'codex', 'gemini'];

    // Emit typing for all 3 immediately
    for (const m of models) {
      this.emitEvent(EVENTS.TYPING_START, { model: m });
    }

    // Build prompts (these read from DB, fast)
    const prompts = {};
    for (const m of models) {
      prompts[m] = this.buildPrompt(m);
    }

    // Launch all 3 in parallel
    const tasks = models.map(async (model) => {
      const filteredEmit = (event, payload) => {
        if (event === EVENTS.MESSAGE_COMPLETE) return;
        this.emitEvent(event, payload);
      };

      try {
        const result = await runners[model](prompts[model], this.cwd, filteredEmit);

        if (!result.ok) {
          this.emitEvent(EVENTS.MODEL_ERROR, {
            model,
            error: result.error || `${model} returned an error`,
          });
          return;
        }

        this.recordTurn(model, result.text);
        this.emitEvent(EVENTS.MESSAGE_COMPLETE, {
          model,
          full_text: result.text,
          screenname: this.screennames[model],
        });
      } catch (err) {
        this.emitEvent(EVENTS.MODEL_ERROR, {
          model,
          error: err.message || String(err),
        });
      }
    });

    await Promise.allSettled(tasks);
    this.roundCount++;
    this.maybeUpdateSummary();
    this.running = false;

    // Check for auto-consensus (skip round 1 — too early)
    if (this.config.auto_consensus && this.roundCount > 1) {
      const consensus = this.checkConsensus();
      if (consensus.detected) {
        const names = consensus.agreed_by.map((m) => MODEL_DISPLAY_NAMES[m] || m);
        this.db.addMessage(this.sessionId, 'system', 'system',
          `Consensus detected — ${names.join(' and ')} appear to agree. Wrapping up...`, null);
        this.emitEvent(EVENTS.MESSAGE_COMPLETE, {
          model: 'system',
          full_text: `Consensus detected — ${names.join(' and ')} appear to agree. Wrapping up...`,
          screenname: 'System',
        });
        this.wrapUp('auto_consensus');
        return;
      }
    }

    // Check round limit
    if (this.roundCount >= this.config.round_limit) {
      this.db.addMessage(this.sessionId, 'system', 'system',
        `Round limit reached (${this.roundCount}/${this.config.round_limit}). Wrapping up...`, null);
      this.emitEvent(EVENTS.MESSAGE_COMPLETE, {
        model: 'system',
        full_text: `Round limit reached (${this.roundCount}/${this.config.round_limit}). Wrapping up...`,
        screenname: 'System',
      });
      this.wrapUp('round_limit');
      return;
    }

    // After parallel round, schedule next parallel round
    if (!this._stopped) {
      this._autoAdvanceTimer = setTimeout(() => this.runAllParallel(), 3000);
    }
  }

  // ---------------------------------------------------------------------------
  // Conclusion / wrap-up
  // ---------------------------------------------------------------------------

  /**
   * Initiate the wrap-up flow. Stops auto-advance, collects final positions,
   * generates a verdict, writes it to disk, and shuts down the server.
   * @param {'user_command' | 'auto_consensus' | 'round_limit'} reason
   */
  async wrapUp(reason) {
    // Prevent re-entry and stop auto-advance
    if (this._wrappingUp) return;
    this._wrappingUp = true;
    this.stop();

    // Emit system message about wrap-up starting
    this.emitEvent(EVENTS.WRAP_UP_START, { reason });
    this.db.addMessage(this.sessionId, 'system', 'system',
      `--- Wrapping up: ${reason} ---`, null);

    // Collect final 1-sentence positions from each model in parallel
    const models = ['claude', 'codex', 'gemini'];
    const finalPrompt = `Summarize your final position on "${this.topic}" in exactly one sentence.`;
    const finalPositions = {};

    const positionTasks = models.map(async (model) => {
      try {
        const filteredEmit = (event, payload) => {
          if (event === EVENTS.MESSAGE_COMPLETE) return;
          this.emitEvent(event, payload);
        };
        this.emitEvent(EVENTS.TYPING_START, { model });
        const result = await runners[model](finalPrompt, this.cwd, filteredEmit);
        if (result.ok) {
          finalPositions[model] = result.text;
          this.db.addMessage(this.sessionId, model, 'chat',
            `[Final position] ${result.text}`, this.screennames[model]);
          this.emitEvent(EVENTS.MESSAGE_COMPLETE, {
            model,
            full_text: `[Final position] ${result.text}`,
            screenname: this.screennames[model],
          });
        } else {
          finalPositions[model] = this.positions[model] || '(no response)';
        }
      } catch (err) {
        finalPositions[model] = this.positions[model] || '(error)';
      }
    });

    await Promise.allSettled(positionTasks);

    // Determine consensus
    const consensusResult = this._detectConsensusFromPositions(finalPositions);

    // Build verdict JSON
    const verdict = {
      topic: this.topic,
      rounds: this.roundCount,
      reason,
      positions: finalPositions,
      consensus: consensusResult,
      timestamp: new Date().toISOString(),
    };

    // Write verdict to /tmp
    const verdictPath = `/tmp/council-chat-verdict-${this.sessionId}.json`;
    try {
      fs.writeFileSync(verdictPath, JSON.stringify(verdict, null, 2));
    } catch (e) {
      console.error('Failed to write verdict file:', e.message);
    }

    // Emit verdict to browser
    this.emitEvent(EVENTS.VERDICT, verdict);

    // Print verdict to stdout
    console.log('\n=== COUNCIL CHAT VERDICT ===');
    console.log(`Topic: ${verdict.topic}`);
    console.log(`Rounds: ${verdict.rounds}`);
    console.log(`Reason: ${verdict.reason}`);
    console.log('Positions:');
    for (const [model, pos] of Object.entries(verdict.positions)) {
      console.log(`  ${MODEL_DISPLAY_NAMES[model] || model}: ${pos}`);
    }
    if (verdict.consensus.detected) {
      console.log(`Consensus: ${verdict.consensus.agreed_by.join(' & ')} agree`);
      if (verdict.consensus.dissent) {
        console.log(`Dissent: ${verdict.consensus.dissent}`);
      }
    } else {
      console.log('Consensus: No clear consensus reached');
    }
    console.log(`Verdict file: ${verdictPath}`);
    console.log('============================\n');

    // Shut down server after 5s delay (let browser render the verdict)
    setTimeout(() => {
      console.log('Shutting down council chat server...');
      process.exit(0);
    }, 5000);
  }

  /**
   * Check if 2-of-3 models' positions indicate consensus.
   * Uses keyword overlap heuristic on the last sentence of each position.
   * @returns {{ detected: boolean, agreed_by: string[], dissent: string|null }}
   */
  checkConsensus() {
    if (!this.config.auto_consensus) return { detected: false, agreed_by: [], dissent: null };
    if (this.roundCount <= 1) return { detected: false, agreed_by: [], dissent: null };

    const positions = this.getPositions();
    return this._detectConsensusFromPositions(positions);
  }

  /**
   * Detect consensus from a set of model positions.
   * @param {{ claude?: string, codex?: string, gemini?: string }} positions
   * @returns {{ detected: boolean, agreed_by: string[], dissent: string|null }}
   */
  _detectConsensusFromPositions(positions) {
    const models = ['claude', 'codex', 'gemini'];
    const available = models.filter((m) => positions[m]);
    if (available.length < 2) return { detected: false, agreed_by: [], dissent: null };

    // Extract keywords from each position (lowercase, deduped, stop words removed)
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by',
      'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
      'between', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
      'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either', 'neither',
      'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some', 'such',
      'no', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'because', 'if',
      'that', 'this', 'these', 'those', 'it', 'its', 'i', 'we', 'you', 'they', 'he',
      'she', 'my', 'our', 'your', 'their', 'his', 'her', 'what', 'which', 'who',
      'whom', 'how', 'when', 'where', 'why', 'about', 'up']);

    const agreementWords = new Set(['agree', 'correct', 'right', 'valid', 'recommend',
      'suggest', 'prefer', 'best', 'should', 'better', 'optimal', 'yes', 'concur',
      'support', 'endorse', 'favor', 'aligned']);

    const extractKeywords = (text) => {
      const words = (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/);
      return new Set(words.filter((w) => w.length > 2 && !stopWords.has(w)));
    };

    const keywordSets = {};
    for (const m of available) {
      keywordSets[m] = extractKeywords(positions[m]);
    }

    // Check pairwise overlap
    const pairs = [
      ['claude', 'codex'], ['claude', 'gemini'], ['codex', 'gemini'],
    ].filter(([a, b]) => keywordSets[a] && keywordSets[b]);

    let bestPair = null;
    let bestOverlap = 0;

    for (const [a, b] of pairs) {
      const setA = keywordSets[a];
      const setB = keywordSets[b];
      const intersection = new Set([...setA].filter((w) => setB.has(w)));
      const union = new Set([...setA, ...setB]);
      const overlap = union.size > 0 ? intersection.size / union.size : 0;

      // Also check for agreement words
      const hasAgreement = [...intersection].some((w) => agreementWords.has(w));
      const effectiveOverlap = hasAgreement ? overlap + 0.15 : overlap;

      if (effectiveOverlap > bestOverlap) {
        bestOverlap = effectiveOverlap;
        bestPair = [a, b];
      }
    }

    if (bestPair && bestOverlap >= 0.3) {
      const dissenter = models.find((m) => !bestPair.includes(m)) || null;
      return {
        detected: true,
        agreed_by: bestPair,
        dissent: dissenter,
      };
    }

    return { detected: false, agreed_by: [], dissent: null };
  }

  /**
   * Stop the auto-advance loop (e.g., on shutdown).
   */
  stop() {
    this._stopped = true;
    clearTimeout(this._autoAdvanceTimer);
  }

  // ---------------------------------------------------------------------------
  // User message entry-point
  // ---------------------------------------------------------------------------

  /**
   * Handle an incoming user message: persist it, detect @mentions, fire next turn.
   * @param {string} text
   */
  handleUserMessage(text) {
    this.recordUserMessage(text);

    // Cancel any pending auto-advance — user input takes priority
    clearTimeout(this._autoAdvanceTimer);

    // Check for wrap-up keywords (case-insensitive, trimmed)
    const trimmed = text.trim().toLowerCase();
    const isWrapUp = this.config.wrap_up_keywords.some(
      (kw) => trimmed === kw.toLowerCase()
    );
    if (isWrapUp) {
      this.wrapUp('user_command');
      return;
    }

    // Parse @mentions — match @claude, @codex, @gemini (case-insensitive)
    const mentionedModel = this._parseMention(text);

    // Wait for any running round to finish, then trigger response
    const triggerResponse = () => {
      if (this.running) {
        // A round is in progress — wait and retry
        setTimeout(triggerResponse, 500);
        return;
      }
      if (mentionedModel) {
        this.runNextTurn(mentionedModel);
      } else {
        this.runAllParallel();
      }
    };

    triggerResponse();
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Parse an @mention from message text and return the canonical model key.
   * Checks canonical names (@claude, @codex, @gemini) and current screennames.
   * @param {string} text
   * @returns {string|null}
   */
  _parseMention(text) {
    const lower = text.toLowerCase();

    // Check canonical model names first
    for (const model of this.turnOrder) {
      const pattern = new RegExp(`@${model}\\b`, 'i');
      if (pattern.test(text)) return model;
    }

    // Check against assigned screennames (e.g. @xXClaude97Xx)
    for (const model of this.turnOrder) {
      const sn = this.screennames[model];
      if (sn) {
        const pattern = new RegExp(`@${escapeRegex(sn)}\\b`, 'i');
        if (pattern.test(text)) return model;
      }
    }

    return null;
  }
}

/**
 * Escape special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { Facilitator };
