import { describe, expect, it } from "vitest";

import {
  nextRitualStep,
  RITUAL_ANCHOR_STALE_DAYS,
  RITUAL_STEP,
} from "./ritualStep.js";

const TODAY = "2026-07-10";

const currentAnchor = { date: "2026-07-01", balance: 1200 };

const readyAnchors = ({
  anchor = currentAnchor,
  importGap = { hasGap: false },
  anchorDrift = [],
} = {}) => ({
  cashSource: "anchors",
  cashMeta: {
    status: "ready",
    anchor,
    importGap,
    anchorDrift,
  },
  pendingInboxCount: 0,
  pendingRemesasCount: 0,
  today: TODAY,
});

describe("nextRitualStep — constants", () => {
  it("exports the 45-day stale threshold used by Resumen alerts", () => {
    expect(RITUAL_ANCHOR_STALE_DAYS).toBe(45);
  });

  it("exports step ids for the first-match sequencer", () => {
    expect(RITUAL_STEP).toEqual({
      unavailable: "unavailable",
      import: "import",
      anchor: "anchor",
      drift: "drift",
      classify: "classify",
      remesas: "remesas",
      done: "done",
    });
  });
});

describe("nextRitualStep — first-match order", () => {
  it("lets an import gap win even if inbox and remesas are full", () => {
    const step = nextRitualStep({
      ...readyAnchors({
        importGap: {
          hasGap: true,
          lastMovementDate: "2026-06-01",
          quietBusinessDays: 8,
        },
      }),
      pendingInboxCount: 12,
      pendingRemesasCount: 4,
    });

    expect(step).toEqual({
      id: "import",
      href: "/banco",
      count: null,
      reason: null,
    });
  });

  it("routes current anchors + empty inbox + pending remesa to remesas", () => {
    const step = nextRitualStep({
      ...readyAnchors(),
      pendingInboxCount: 0,
      pendingRemesasCount: 3,
    });

    expect(step).toEqual({
      id: "remesas",
      href: "/cxc/remesas",
      count: 3,
      reason: null,
    });
  });

  it.each([
    [
      "cashSource unavailable",
      { cashSource: "unavailable", cashMeta: { status: "ready" } },
    ],
    [
      "cashMeta loading",
      {
        cashSource: "anchors",
        cashMeta: { status: "loading", anchor: currentAnchor },
      },
    ],
    ["cashMeta error", { cashSource: "legacy", cashMeta: { status: "error" } }],
  ])(
    "returns unavailable with a null href for %s — never /banco",
    (_label, extra) => {
      const step = nextRitualStep({
        cashSource: extra.cashSource,
        cashMeta: extra.cashMeta,
        pendingInboxCount: 9,
        pendingRemesasCount: 2,
        today: TODAY,
      });

      expect(step).toEqual({
        id: "unavailable",
        href: null,
        count: null,
        reason: null,
      });
      expect(step.href).not.toBe("/banco");
    },
  );

  it("classifies only when pendingInboxCount > 0 and ignores missing invoices", () => {
    expect(
      nextRitualStep({
        ...readyAnchors(),
        pendingInboxCount: 0,
      }).id,
    ).toBe("done");

    expect(
      nextRitualStep({
        ...readyAnchors(),
        pendingInboxCount: 5,
      }),
    ).toEqual({
      id: "classify",
      href: "/clasificar",
      count: 5,
      reason: null,
    });
  });

  it("asks for an anchor when cashSource is legacy even if inbox is full", () => {
    const step = nextRitualStep({
      cashSource: "legacy",
      cashMeta: {
        status: "ready",
        anchor: null,
        importGap: { hasGap: false },
        anchorDrift: [],
      },
      pendingInboxCount: 20,
      pendingRemesasCount: 1,
      today: TODAY,
    });

    expect(step).toEqual({
      id: "anchor",
      href: "/banco",
      count: null,
      reason: "missing",
    });
  });

  it("treats a missing usable anchor as missing even when cashSource is anchors", () => {
    const step = nextRitualStep({
      ...readyAnchors({ anchor: null }),
      pendingInboxCount: 8,
    });

    expect(step).toEqual({
      id: "anchor",
      href: "/banco",
      count: null,
      reason: "missing",
    });
  });
});

describe("nextRitualStep — stale anchor", () => {
  it("treats an anchor 46 days before today as stale, and 45 days as current", () => {
    const stale = nextRitualStep(
      readyAnchors({
        anchor: { date: "2026-05-25", balance: 100 },
      }),
    );
    expect(stale).toEqual({
      id: "anchor",
      href: "/banco",
      count: null,
      reason: "stale",
    });

    const current = nextRitualStep(
      readyAnchors({
        anchor: { date: "2026-05-26", balance: 100 },
      }),
    );
    expect(current.id).toBe("done");
    expect(current.reason).toBe(null);
  });

  it("does not treat a future anchor date as stale", () => {
    const step = nextRitualStep(
      readyAnchors({
        anchor: { date: "2026-08-01", balance: 100 },
      }),
    );
    expect(step.id).toBe("done");
  });
});

describe("nextRitualStep — drift, done, and malformed input", () => {
  it("routes non-empty anchorDrift after a current anchor and no import gap to drift", () => {
    const step = nextRitualStep(
      readyAnchors({
        anchorDrift: [
          {
            fromDate: "2026-05-31",
            toDate: "2026-06-30",
            expected: 100,
            derived: 90,
            drift: 10,
          },
        ],
      }),
    );

    expect(step).toEqual({
      id: "drift",
      href: "/configuracion",
      count: null,
      reason: null,
    });
  });

  it("returns done with a null href when the ritual is all clear", () => {
    expect(nextRitualStep(readyAnchors())).toEqual({
      id: "done",
      href: null,
      count: null,
      reason: null,
    });
  });

  it("does not throw on malformed or missing cashMeta and behaves as no gap / no drift / no anchor", () => {
    expect(() =>
      nextRitualStep({
        cashSource: "anchors",
        cashMeta: null,
        pendingInboxCount: 0,
        pendingRemesasCount: 0,
        today: TODAY,
      }),
    ).not.toThrow();

    expect(
      nextRitualStep({
        cashSource: "anchors",
        cashMeta: null,
        pendingInboxCount: 0,
        pendingRemesasCount: 0,
        today: TODAY,
      }),
    ).toEqual({
      id: "anchor",
      href: "/banco",
      count: null,
      reason: "missing",
    });

    expect(
      nextRitualStep({
        cashSource: "anchors",
        cashMeta: undefined,
        pendingInboxCount: 2,
        pendingRemesasCount: 1,
        today: TODAY,
      }),
    ).toMatchObject({ id: "anchor", reason: "missing" });

    expect(
      nextRitualStep({
        cashSource: "anchors",
        cashMeta: { status: "ready", anchor: { date: "not-a-date" } },
        today: TODAY,
      }),
    ).toMatchObject({ id: "anchor", reason: "missing" });

    expect(
      nextRitualStep({
        cashSource: "anchors",
        cashMeta: {
          status: "ready",
          anchor: currentAnchor,
          importGap: null,
          anchorDrift: null,
        },
        pendingInboxCount: 0,
        pendingRemesasCount: 0,
        today: TODAY,
      }),
    ).toEqual({
      id: "done",
      href: null,
      count: null,
      reason: null,
    });
  });
});
