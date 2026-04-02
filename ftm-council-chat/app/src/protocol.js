(function (exports) {
  'use strict';

  exports.EVENTS = {
    // Server -> Browser
    SESSION_START:    'session_start',
    TYPING_START:     'typing_start',
    RESEARCHING:      'researching',
    TOKEN:            'token',
    MESSAGE_COMPLETE: 'message_complete',
    MODEL_JOINED:     'model_joined',
    MODEL_ERROR:      'model_error',
    WRAP_UP_START:    'wrap_up_start',
    VERDICT:          'verdict',

    // Browser -> Server
    USER_MESSAGE:     'user_message',
    USER_MENTION:     'user_mention',
  };

  exports.PAYLOADS = {
    session_start: {
      screennames: '{ claude, codex, gemini, user }',
      topic: 'string',
    },
    typing_start: {
      model: 'string — claude | codex | gemini',
    },
    researching: {
      model: 'string',
      tool_name: 'string',
    },
    token: {
      model: 'string',
      text_delta: 'string',
    },
    message_complete: {
      model: 'string',
      full_text: 'string',
      screenname: 'string',
    },
    model_joined: {
      model: 'string',
      screenname: 'string',
    },
    model_error: {
      model: 'string',
      error: 'string',
    },
    wrap_up_start: {
      reason: 'string — user_command | auto_consensus | round_limit',
    },
    verdict: {
      topic: 'string',
      rounds: 'number',
      reason: 'string',
      positions: '{ claude: string, codex: string, gemini: string }',
      consensus: '{ detected: boolean, agreed_by: string[], dissent: string|null }',
      timestamp: 'string — ISO 8601',
    },
    user_message: {
      text: 'string',
    },
    user_mention: {
      target_model: 'string',
      text: 'string',
    },
  };

})(typeof module !== 'undefined' ? module.exports : (window.PROTOCOL = {}));
