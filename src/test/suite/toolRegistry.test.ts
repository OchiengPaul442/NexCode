import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";

describe("Tool Registry Schema", () => {
  it("schema file exists and has required structure", () => {
    const schemaPath = path.join(
      __dirname,
      "..",
      "..",
      "..",
      "schemas",
      "tool-registry.schema.json",
    );
    assert.ok(fs.existsSync(schemaPath), "schema file missing");
    const raw = fs.readFileSync(schemaPath, "utf8");
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.type, "object");
    assert.ok(
      parsed.properties && parsed.properties.tools,
      "schema must define tools property",
    );
    const items = parsed.properties.tools.items;
    assert.ok(
      items && items.required && items.required.indexOf("id") >= 0,
      "tool items must require id",
    );
    assert.ok(
      items && items.required && items.required.indexOf("name") >= 0,
      "tool items must require name",
    );
    assert.ok(
      items && items.required && items.required.indexOf("commands") >= 0,
      "tool items must require commands",
    );
  });
});
