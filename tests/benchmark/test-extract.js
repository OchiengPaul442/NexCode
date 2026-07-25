const { OllamaProvider } = require('./agent-core/dist/providers/ollamaProvider');
const p = new OllamaProvider('http://localhost:11434');

// Test 1: TOOL: format
const text1 = 'TOOL: write_file\npath: utils.ts\ncontent: export function sum(a: number, b: number): number { return a + b; }';
console.log('Test 1 - TOOL: format:', JSON.stringify(p.extractToolCallsFromText(text1)));

// Test 2: JSON code block
const text2 = 'Here is the code:\n```json\n{"name":"write","arguments":{"path":"test.ts","content":"const x = 1;"}}\n```';
console.log('Test 2 - JSON code block:', JSON.stringify(p.extractToolCallsFromText(text2)));

// Test 3: Plain text with tool call
const text3 = 'I will read the package.json file for you.';
console.log('Test 3 - Plain text:', JSON.stringify(p.extractToolCallsFromText(text3)));
