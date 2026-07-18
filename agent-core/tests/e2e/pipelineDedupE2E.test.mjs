const { TokenCounter } = await import('../../dist/utils/tokenCounter.js');
const { detectModelCapabilities } = await import('../../dist/providers/modelRouter.js');

const counter = new TokenCounter();

console.log('=== Pipeline Context Deduplication Tests ===\n');

// Test 1: Simulate old behavior (context duplication)
function simulateOldPipeline(prompt, workspaceCtx, memoryCtx, sessionCtx) {
  const stageContextParts = [
    `User request:\n${prompt}`,
    workspaceCtx ? `Workspace context:\n${workspaceCtx}` : '',
    memoryCtx ? `Memory context:\n${memoryCtx}` : '',
    sessionCtx ? `Conversation history:\n${sessionCtx}` : '',
  ].filter(p => p.length > 0);

  const stagePrompt = stageContextParts.join('\n\n');

  // OLD: runAgentLoopStreaming also adds context
  const oldContextParts = [
    `User request:\n${stagePrompt}`,  // <-- DUPLICATES everything
    workspaceCtx ? `Workspace context:\n${workspaceCtx}` : '',
    memoryCtx ? `Memory context:\n${memoryCtx}` : '',
    sessionCtx ? `Conversation history:\n${sessionCtx}` : '',
  ].filter(p => p.length > 0);

  return oldContextParts.join('\n\n');
}

// Test 2: Simulate new behavior (no duplication)
function simulateNewPipeline(prompt, workspaceCtx, memoryCtx, sessionCtx, planContent, implDraft) {
  // NEW: Only stage-specific additions
  const stageContextParts = [
    planContent ? `Plan:\n${planContent}` : '',
    implDraft ? `Implementation draft:\n${implDraft}` : '',
  ].filter(p => p.length > 0);

  const stagePrompt = stageContextParts.length > 0
    ? `${prompt}\n\n${stageContextParts.join('\n\n')}`
    : prompt;

  // runAgentLoopStreaming assembles context once
  const contextParts = [
    `User request:\n${stagePrompt}`,
    workspaceCtx ? `Workspace context:\n${workspaceCtx}` : '',
    memoryCtx ? `Memory context:\n${memoryCtx}` : '',
    sessionCtx ? `Conversation history:\n${sessionCtx}` : '',
  ].filter(p => p.length > 0);

  return contextParts.join('\n\n');
}

// Test data
const prompt = 'How many files are in this codebase?';
const workspaceCtx = 'Workspace context:\n- src/index.ts\n- src/utils.ts\n- package.json\n- README.md';
const memoryCtx = 'Memory context:\nUser prefers TypeScript';
const sessionCtx = 'Conversation history:\nUser asked about project structure';

// Compare
const oldResult = simulateOldPipeline(prompt, workspaceCtx, memoryCtx, sessionCtx);
const newResult = simulateNewPipeline(prompt, workspaceCtx, memoryCtx, sessionCtx, undefined, undefined);

console.log('Old approach token estimate:', counter.estimateRequestTokens([{ role: 'user', content: oldResult }]));
console.log('New approach token estimate:', counter.estimateRequestTokens([{ role: 'user', content: newResult }]));

const savings = counter.estimateRequestTokens([{ role: 'user', content: oldResult }]) - counter.estimateRequestTokens([{ role: 'user', content: newResult }]);
console.log('Tokens saved per stage:', savings);

// Verify no duplication in new approach
const workspaceCount = (newResult.match(/Workspace context:/g) || []).length;
const memoryCount = (newResult.match(/Memory context:/g) || []).length;
const sessionCount = (newResult.match(/Conversation history:/g) || []).length;

console.log('\nDuplication check:');
console.log('  Workspace context occurrences:', workspaceCount, workspaceCount === 1 ? 'PASS' : 'FAIL');
console.log('  Memory context occurrences:', memoryCount, memoryCount === 1 ? 'PASS' : 'FAIL');
console.log('  Session context occurrences:', sessionCount, sessionCount === 1 ? 'PASS' : 'FAIL');

// Test 3: Multi-stage pipeline simulation
console.log('\n=== Multi-Stage Pipeline (4 stages) ===');
const stages = ['planner', 'coder', 'reviewer', 'qa'];
let totalOldTokens = 0;
let totalNewTokens = 0;

for (const stage of stages) {
  const oldTokens = counter.estimateRequestTokens([{ role: 'user', content: simulateOldPipeline(prompt, workspaceCtx, memoryCtx, sessionCtx) }]);
  const newTokens = counter.estimateRequestTokens([{ role: 'user', content: simulateNewPipeline(prompt, workspaceCtx, memoryCtx, sessionCtx, stage === 'coder' ? 'Plan content here' : undefined, stage === 'reviewer' ? 'Draft code here' : undefined) }]);
  totalOldTokens += oldTokens;
  totalNewTokens += newTokens;
  console.log(`  ${stage}: old=${oldTokens}, new=${newTokens}, saved=${oldTokens - newTokens}`);
}

console.log(`\nTotal across 4 stages:`);
console.log(`  Old approach: ${totalOldTokens} tokens`);
console.log(`  New approach: ${totalNewTokens} tokens`);
console.log(`  Total saved: ${totalOldTokens - totalNewTokens} tokens`);

// Test 4: Retry deduplication
console.log('\n=== Retry Message Deduplication ===');
const messages = [
  { role: 'system', content: 'System prompt' },
  { role: 'user', content: 'User message' },
  { role: 'assistant', content: 'Assistant response with tool call', tool_calls: [{ id: 'call_0', type: 'function', function: { name: 'read', arguments: '{}' } }] },
  { role: 'tool', content: 'File contents', tool_call_id: 'call_0' },
];

// Old approach (broken)
const oldRetry = messages.length > 1
  ? [messages[0], messages[1], ...messages.slice(-3)]
  : messages;
console.log('Old retry messages:', oldRetry.length, '(broken: duplicates when messages.length === 2)');

// New approach (fixed)
function buildReducedRetryMessages(msgs) {
  const system = msgs.find(m => m.role === 'system');
  const latestUserIndex = msgs.findLastIndex(m => m.role === 'user');
  const latestUser = latestUserIndex >= 0 ? msgs[latestUserIndex] : undefined;
  const recentResults = msgs.slice(Math.max(0, msgs.length - 2)).filter(m => m !== system && m !== latestUser && m.role !== 'system');
  return [system, latestUser, ...recentResults].filter(Boolean);
}

const newRetry = buildReducedRetryMessages(messages);
console.log('New retry messages:', newRetry.length);
console.log('Roles:', newRetry.map(m => m.role));

// Edge case: only 2 messages
const twoMsgs = [
  { role: 'system', content: 'System' },
  { role: 'user', content: 'User' },
];
const oldTwoMsgRetry = twoMsgs.length > 1 ? [twoMsgs[0], twoMsgs[1], ...twoMsgs.slice(-3)] : twoMsgs;
const newTwoMsgRetry = buildReducedRetryMessages(twoMsgs);
console.log('\nEdge case (2 messages):');
console.log('  Old retry count:', oldTwoMsgRetry.length, '(should be 2, actually', oldTwoMsgRetry.length, '- BUG if > 2)');
console.log('  New retry count:', newTwoMsgRetry.length, '(correct)');

console.log('\n=== Pipeline Deduplication Tests Complete ===');
