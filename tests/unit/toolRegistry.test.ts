import { expect } from "chai";
import { toolRegistry } from "../../src/tools/toolRegistry";

describe("ToolRegistry", () => {
  it("registers, lists, and retrieves tools", () => {
    toolRegistry.clear();
    const t = {
      id: "t1",
      name: "Tool One",
      description: "desc",
      requiredPermissions: ["run"],
    };
    toolRegistry.register(t);
    const listed = toolRegistry.list();
    expect(listed.length).to.equal(1);
    const got = toolRegistry.get("t1");
    expect(got).to.deep.equal(t);
  });

  it("checks permissions correctly", () => {
    toolRegistry.clear();
    toolRegistry.register({
      id: "t2",
      name: "Tool Two",
      requiredPermissions: ["admin", "run"],
    });
    expect(toolRegistry.checkPermissions("t2", ["admin", "run"])).to.equal(
      true,
    );
    expect(toolRegistry.checkPermissions("t2", ["run"])).to.equal(false);
  });

  it("records audit log entries", () => {
    toolRegistry.clear();
    toolRegistry.register({ id: "t3", name: "Tool Three" });
    toolRegistry.log("invoke", { tool: "t3", user: "u1" });
    const audit = toolRegistry.getAudit();
    expect(audit.length).to.be.greaterThan(0);
  });
});
