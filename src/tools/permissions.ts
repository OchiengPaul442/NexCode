export class PermissionManager {
  private users = new Map<string, string[]>();

  setPermissions(userId: string, permissions: string[]) {
    this.users.set(userId, permissions.slice());
  }

  getPermissions(userId: string): string[] {
    return this.users.get(userId) ?? [];
  }

  check(userId: string, required: string[] | undefined): boolean {
    if (!required || required.length === 0) return true;
    const have = this.getPermissions(userId);
    return required.every((r) => have.includes(r));
  }

  clear() {
    this.users.clear();
  }
}

export const permissionManager = new PermissionManager();
export default permissionManager;
