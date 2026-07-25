const { createNexcodeOrchestrator } = require('./agent-core/dist');
const fs = require('fs');
const path = require('path');
const os = require('os');

const MODEL = 'gemma4:31b-cloud';
const WORKSPACE = path.join(os.tmpdir(), 'nexcode-debug-' + Date.now());

async function collectEvents(gen) { 
  const e = []; 
  for await (const x of gen) {
    e.push(x);
    if (x.type === 'toolExecuted') {
      console.log('  TOOL EVENT:', x.toolName, x.status, x.command?.substring(0, 100), x.message?.substring(0, 100));
    }
    if (x.type === 'status') {
      console.log('  STATUS:', x.message);
    }
  }
  return e;
}

async function test() {
  fs.mkdirSync(WORKSPACE, { recursive: true });
  fs.writeFileSync(path.join(WORKSPACE, 'package.json'), JSON.stringify({name:'test-project',version:'1.0.0',scripts:{test:'echo Tests passed'}},null,2));
  
  const orch = createNexcodeOrchestrator({ workspaceRoot: WORKSPACE, defaultProvider: 'ollama', defaultModel: MODEL, ollamaBaseUrl: 'http://localhost:11434' });
  
  console.log('\n=== Test: Edit package.json ===');
  const events = await collectEvents(orch.stream({
    prompt:'Add a new script called lint to package.json that runs echo linting', 
    mode:'coder',
    allowTools:true
  }));
  
  const fin = events.find(e=>e.type==='final');
  const tools = events.filter(e=>e.type==='toolExecuted');
  console.log('\nResult: tools=' + tools.length + ' response=' + (fin?.response?.text?.substring(0, 200) || 'none'));
  
  // Check if package.json was modified
  try {
    const content = fs.readFileSync(path.join(WORKSPACE, 'package.json'), 'utf8');
    console.log('package.json:', content);
  } catch(e) {
    console.log('Error reading package.json:', e.message);
  }
  
  console.log('\n=== Test: Write utility function ===');
  const events2 = await collectEvents(orch.stream({
    prompt:'Create a new file called utils.ts with a function that takes two numbers and returns their sum', 
    mode:'coder',
    allowTools:true
  }));
  
  const fin2 = events2.find(e=>e.type==='final');
  const tools2 = events2.filter(e=>e.type==='toolExecuted');
  console.log('\nResult: tools=' + tools2.length + ' response=' + (fin2?.response?.text?.substring(0, 200) || 'none'));
  
  try {
    const files = fs.readdirSync(WORKSPACE);
    console.log('Files:', files);
  } catch(e) {}
  
  try { fs.rmSync(WORKSPACE, {recursive:true,force:true}); } catch {}
}

test().catch(console.error);
