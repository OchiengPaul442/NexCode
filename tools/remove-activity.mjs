const fs = require('fs');
const content = fs.readFileSync('D:/projects/extensions/NexCode/agent-core/src/orchestrator.ts', 'utf8');

const lines = content.split('\n');
const result = [];
let i = 0;
let removed = 0;

while (i < lines.length) {
  const line = lines[i];
  
  // Check if this line starts a yield { type: "activity" block
  if (line.includes('yield {') && lines.slice(i, i + 5).join('\n').includes('"activity"')) {
    // Count braces to find the end
    let depth = 0;
    let j = i;
    let found = false;
    
    while (j < lines.length) {
      for (const ch of lines[j]) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }
      if (depth === 0) {
        found = true;
        break;
      }
      j++;
    }
    
    if (found) {
      // Also skip the semicolon line if present
      let end = j + 1;
      if (end < lines.length && lines[end].trim() === ';') {
        end++;
      }
      removed++;
      i = end;
      continue;
    }
  }
  
  result.push(line);
  i++;
}

fs.writeFileSync('D:/projects/extensions/NexCode/agent-core/src/orchestrator.ts', result.join('\n'));
console.log(`Removed ${removed} activity yields.`);
