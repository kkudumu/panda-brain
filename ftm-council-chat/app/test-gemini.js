const { spawn } = require('child_process');

async function testGemini(prompt) {
  return new Promise((resolve) => {
    let output = '';
    const child = spawn('gemini', ['-p', prompt, '-o', 'stream-json', '--yolo'], {
      stdio: ['pipe', 'pipe', 'inherit']
    });
    child.stdin.end();

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      console.log(`Exit code: ${code}`);
      console.log('--- Raw Output ---');
      console.log(output);
      console.log('--- End Raw Output ---');
      resolve(output);
    });
  });
}

const testPrompt = 'Hello, this is a test. Please reply with only the word "ACK".';
testGemini(testPrompt);
