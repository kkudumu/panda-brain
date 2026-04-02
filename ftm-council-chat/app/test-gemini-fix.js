const { spawn } = require('child_process');

async function testGeminiFix(prompt) {
  return new Promise((resolve) => {
    let assembledText = '';
    const child = spawn('gemini', ['-p', prompt, '-o', 'stream-json', '--yolo'], {
      stdio: ['pipe', 'pipe', 'inherit']
    });
    child.stdin.end();

    let lineBuffer = '';
    child.stdout.on('data', (chunk) => {
      lineBuffer += chunk.toString();
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop();

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'message' && obj.role === 'assistant') {
            const content = obj.content || obj.text || '';
            if (content) assembledText += content;
          } else if (obj.type === 'result') {
            const finalText = obj.content || obj.text || obj.response || '';
            if (finalText) assembledText = finalText || assembledText;
          }
        } catch (_) {}
      }
    });

    child.on('close', (code) => {
      console.log('--- Assembled Text ---');
      console.log(assembledText);
      console.log('--- End Assembled Text ---');
      resolve(assembledText);
    });
  });
}

const testPrompt = 'Hello, this is a test. Please reply with ONLY the word "ACK". Do not repeat this prompt.';
testGeminiFix(testPrompt);
