import { describe, expect, it } from "vitest";

import { ROLE_PERMISSIONS } from "./config.js";

describe("ROLE_PERMISSIONS", () => {
  it("grants bank to admin and manager without giving settings to manager", () => {
    expect(ROLE_PERMISSIONS.manager).toContain("bank");
    expect(ROLE_PERMISSIONS.manager).not.toContain("settings");
    expect(ROLE_PERMISSIONS.editor).not.toContain("bank");
    expect(ROLE_PERMISSIONS.admin).toContain("bank");
    expect(ROLE_PERMISSIONS.admin).toContain("settings");
  });
});
