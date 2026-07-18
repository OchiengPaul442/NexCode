const OLLAMA_URL = 'http://localhost:11434';
const MODEL = 'gpt-oss:120b-cloud';

async function testBasicGenerate() {
  console.log('=== Test 1: Basic Generate ===');
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a helpful coding assistant.' },
        { role: 'user', content: 'What is 2+2? Reply with just the number.' }
      ],
      stream: false,
      options: { temperature: 0, num_predict: 100 }
    }),
    signal: AbortSignal.timeout(60000)
  });
  
  if (!response.ok) {
    const err = await response.text();
    console.log('FAIL:', response.status, err.slice(0, 200));
    return false;
  }
  
  const data = await response.json();
  console.log('Response:', data.message?.content?.trim());
  console.log('PASS');
  return true;
}

async function testToolCalling() {
  console.log('\n=== Test 2: Tool Calling ===');
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a helpful assistant. Use tools when needed.' },
        { role: 'user', content: 'What files are in the current directory?' }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'terminal',
            description: 'Run a terminal command',
            parameters: {
              type: 'object',
              properties: { command: { type: 'string', description: 'Command to run' } },
              required: ['command']
            }
          }
        }
      ],
      stream: false,
      options: { temperature: 0, num_predict: 300 }
    }),
    signal: AbortSignal.timeout(60000)
  });
  
  if (!response.ok) {
    const err = await response.text();
    console.log('FAIL:', response.status, err.slice(0, 200));
    return false;
  }
  
  const data = await response.json();
  console.log('Content:', data.message?.content?.slice(0, 200));
  console.log('Tool calls:', JSON.stringify(data.message?.tool_calls, null, 2));
  console.log('PASS');
  return true;
}

async function testStreaming() {
  console.log('\n=== Test 3: Streaming ===');
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: 'Count from 1 to 5, one number per line.' }],
      stream: true,
      options: { temperature: 0, num_predict: 50 }
    }),
    signal: AbortSignal.timeout(60000)
  });
  
  if (!response.ok) {
    const err = await response.text();
    console.log('FAIL:', response.status, err.slice(0, 200));
    return false;
  }
  
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let tokens = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (const line of chunk.split('\n').filter(l => l.trim())) {
      try {
        const json = JSON.parse(line);
        if (json.message?.content) tokens.push(json.message.content);
      } catch {}
    }
  }
  
  console.log('Streamed tokens:', tokens.length);
  console.log('Output:', tokens.join(''));
  console.log('PASS');
  return true;
}

async function testWorkspaceStats() {
  console.log('\n=== Test 4: Workspace Stats Question ===');
  const response = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: 'You are a helpful coding assistant. When asked about file counts, suggest using the workspace-stats tool.' },
        { role: 'user', content: 'How many files are in this codebase?' }
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'workspace-stats',
            description: 'Get workspace file statistics',
            parameters: { type: 'object', properties: {} }
          }
        }
      ],
      stream: false,
      options: { temperature: 0, num_predict: 300 }
    }),
    signal: AbortSignal.timeout(60000)
  });
  
  if (!response.ok) {
    const err = await response.text();
    console.log('FAIL:', response.status, err.slice(0, 200));
    return false;
  }
  
  const data = await response.json();
  console.log('Content:', data.message?.content?.slice(0, 200));
  console.log('Tool calls:', JSON.stringify(data.message?.tool_calls, null, 2));
  console.log('PASS');
  return true;
}

let allPassed = true;
allPassed = await testBasicGenerate() && allPassed;
allPassed = await testToolCalling() && allPassed;
allPassed = await testStreaming() && allPassed;
allPassed = await testWorkspaceStats() && allPassed;

console.log('\n=== Summary ===');
console.log(allPassed ? 'All tests passed!' : 'Some tests failed');
process.exit(allPassed ? 0 : 1);
