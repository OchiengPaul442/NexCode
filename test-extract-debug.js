const { extractToolCallFromMalformedJson, repairTruncatedJson } = require('./agent-core/dist/utils/jsonRepair');

// Simulate what the model might produce
const testCases = [
  // Case 1: TOOL: format with multiline content
  "TOOL: write\nPATH: utils.ts\nCONTENT: export function sum(a: number, b: number): number {\n  return a + b;\n}",
  // Case 2: JSON format with multiline content
  '{"name": "write", "arguments": {"path": "utils.ts", "content": "export function sum(a: number, b: number): number {\n  return a + b;\n}"}}',
  // Case 3: Truncated JSON
  '{"name": "write", "arguments": {"path": "utils.ts", "content": "export function sum(a: number, b: number): number {\n  return a + b;\n}',
  // Case 4: Truncated JSON without closing brace
  '{"name": "write", "arguments": {"path": "utils.ts", "content": "const x = 1;"',
  // Case 5: Model output with TOOL: format but extra text
  'I will create a utility function with a sum function.\n\nTOOL: write\nPATH: utils.ts\nCONTENT: export function sum(a: number, b: number): number {\n  return a + b;\n}',
];

console.log('Testing extractToolCallFromMalformedJson:');
for (const text of testCases) {
  console.log('\nTesting:', text.substring(0, 100) + '...');
  const result = extractToolCallFromMalformedJson(text);
  console.log('  Result:', result ? JSON.stringify(result).substring(0, 200) : 'null');
}

console.log('\n\nTesting repairTruncatedJson:');
const repairCases = [
  '{"name": "write", "arguments": {"path": "utils.ts", "content": "const x = 1;"',
  '{"name": "write", "arguments": {"path": "utils.ts", "content": "const x = 1;"}}',
  '{"name": "read", "arguments": {"path": "utils.ts"',
];

for (const text of repairCases) {
  console.log('\nTesting:', text);
  const repaired = repairTruncatedJson(text);
  console.log('  Repaired:', repaired);
  try {
    const parsed = JSON.parse(repaired);
    console.log('  Parsed:', JSON.stringify(parsed));
  } catch (e) {
    console.log('  Parse error:', e.message);
  }
}
