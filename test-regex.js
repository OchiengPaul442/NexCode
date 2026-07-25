const text = "```json\n{\n  \"name\": \"test-project\",\n  \"version\": \"1.0.0\",\n  \"scripts\": {\n    \"test\": \"echo Tests passed\",\n    \"lint\": \"echo linting\"\n  }\n}\n```";
console.log("Text:", JSON.stringify(text));
const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
console.log("Match:", fenceMatch ? JSON.stringify(fenceMatch[1]) : "null");
console.log("Match length:", fenceMatch ? fenceMatch[1].length : 0);

// Also test with the actual text from the model
const modelText = "```json\n{\n  \"name\": \"test-project\",\n  \"version\": \"1.0.0\",\n  \"scripts\": {\n    \"test\": \"echo Tests passed\",\n    \"lint\": \"echo linting\"\n  }\n}\n```";
console.log("\nModel text:", JSON.stringify(modelText));
const modelMatch = modelText.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
console.log("Model match:", modelMatch ? JSON.stringify(modelMatch[1]) : "null");

// Test if the JSON is valid
if (modelMatch) {
  try {
    const parsed = JSON.parse(modelMatch[1]);
    console.log("Parsed JSON:", JSON.stringify(parsed));
    console.log("Has scripts:", !!parsed.scripts);
  } catch (e) {
    console.log("Parse error:", e.message);
  }
}
