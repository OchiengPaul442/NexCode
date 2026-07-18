const { TokenCounter } = await import('../../dist/utils/tokenCounter.js');
const { detectModelCapabilities } = await import('../../dist/providers/modelRouter.js');

const counter = new TokenCounter();
const OLLAMA_URL = 'http://localhost:11434';

async function testBudgetWithModel(model) {
  console.log(`\n=== Budget Test: ${model} ===`);
  const caps = detectModelCapabilities(model, 'ollama');
  const budget = counter.calculateInputBudget(caps.contextWindow);
  console.log(`Context: ${caps.contextWindow}, Budget: ${budget}`);

  // Test 1: Small request
  const smallMsg = [{ role: 'user', content: 'Hello' }];
  const smallEst = counter.estimateRequestTokens(smallMsg);
  console.log(`Small request: ${smallEst} tokens (${smallEst < budget ? 'OK' : 'OVERFLOW'})`);

  // Test 2: Medium request (add tool schemas)
  const tools = Array(10).fill(null).map((_, i) => ({
    name: `tool${i}`,
    description: `Tool ${i} description with some extra text to make it longer`,
    inputSchema: { type: 'object', properties: { param: { type: 'string' } } }
  }));
  const medEst = counter.estimateRequestTokens(smallMsg, tools);
  console.log(`Medium request (10 tools): ${medEst} tokens (${medEst < budget ? 'OK' : 'OVERFLOW'})`);

  // Test 3: Large request
  const largeMsg = [{ role: 'user', content: 'x'.repeat(30000) }];
  const largeEst = counter.estimateRequestTokens(largeMsg);
  console.log(`Large request (30K chars): ${largeEst} tokens (${largeEst < budget ? 'OK' : 'OVERFLOW'})`);

  // Test 4: Overflow request
  const overflowMsg = [{ role: 'user', content: 'x'.repeat(100000) }];
  const overflowEst = counter.estimateRequestTokens(overflowMsg);
  console.log(`Overflow request (100K chars): ${overflowEst} tokens (${overflowEst < budget ? 'OK' : 'OVERFLOW - should compress'})`);

  return { budget, smallEst, medEst, largeEst, overflowEst };
}

async function testRealRequestWithContext(model, contextSize) {
  console.log(`\n=== Real Request: ${model}, context=${contextSize} chars ===`);
  const context = 'x'.repeat(contextSize);

  try {
    const response = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: context + '\n\nWhat is 1+1? Reply with just the number.' }
        ],
        stream: false,
        options: { temperature: 0, num_predict: 50 }
      }),
      signal: AbortSignal.timeout(60000)
    });

    if (response.ok) {
      const data = await response.json();
      console.log('Response:', data.message?.content?.trim());
      return true;
    } else {
      const err = await response.text();
      console.log('Error:', response.status, err.slice(0, 200));
      return false;
    }
  } catch (err) {
    console.log('Timeout/Error:', err.message);
    return false;
  }
}

// Run budget tests for each model
for (const model of ['gpt-oss:120b-cloud']) {
  await testBudgetWithModel(model);
}

// Run real requests with increasing context sizes
for (const size of [1000, 5000, 10000, 20000]) {
  await testRealRequestWithContext('gpt-oss:120b-cloud', size);
}

console.log('\n=== Context Budget Stress Test Complete ===');
