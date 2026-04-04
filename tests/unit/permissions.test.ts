import { expect } from "chai";
import { permissionManager } from "../../src/tools/permissions";

describe("PermissionManager", () => {
  beforeEach(() => permissionManager.clear());

  it("sets and retrieves permissions", () => {
    permissionManager.setPermissions("u1", ["run", "read"]);
    expect(permissionManager.getPermissions("u1")).to.deep.equal([
      "run",
      "read",
    ]);
  });

  it("checks required permissions correctly", () => {
    permissionManager.setPermissions("u2", ["admin", "run"]);
    expect(permissionManager.check("u2", ["admin"])).to.equal(true);
    expect(permissionManager.check("u2", ["run", "admin"])).to.equal(true);
    expect(permissionManager.check("u2", ["write"])).to.equal(false);
  });
});
