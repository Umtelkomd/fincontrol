import { describe, expect, it } from "vitest";
import { ritualBadgeFor } from "./useRitualStep.js";

describe("ritualBadgeFor", () => {
  it("maps import and anchor steps to the Banco nav item", () => {
    expect(ritualBadgeFor("/banco", { id: "import" })).toBe(1);
    expect(ritualBadgeFor("/banco", { id: "anchor" })).toBe(1);
    expect(ritualBadgeFor("/clasificar", { id: "import" })).toBe(0);
  });

  it("maps classify and remesas counts to their owning nav items", () => {
    expect(ritualBadgeFor("/clasificar", { id: "classify", count: 4 })).toBe(4);
    expect(ritualBadgeFor("/cxc", { id: "remesas", count: 3 })).toBe(3);
    expect(ritualBadgeFor("/cxc/remesas", { id: "remesas", count: 3 })).toBe(0);
    expect(ritualBadgeFor("/banco", { id: "classify", count: 4 })).toBe(0);
  });

  it("returns only finite, non-negative integer counts", () => {
    expect(ritualBadgeFor("/clasificar", { id: "classify", count: 4.9 })).toBe(
      4,
    );
    expect(ritualBadgeFor("/clasificar", { id: "classify", count: -2 })).toBe(
      0,
    );
    expect(
      ritualBadgeFor("/clasificar", { id: "classify", count: Infinity }),
    ).toBe(0);
    expect(
      ritualBadgeFor("/clasificar", { id: "classify", count: "bad" }),
    ).toBe(0);
    expect(ritualBadgeFor(null, null)).toBe(0);
  });
});
