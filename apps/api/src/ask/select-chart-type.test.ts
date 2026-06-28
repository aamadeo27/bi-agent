import { describe, it, expect } from "vitest";
import {
  selectChartType,
  inferRole,
  countDistinct,
  ROW_CAP,
  type InputColumn,
} from "./select-chart-type.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRows(
  colName: string,
  values: Array<string | number | null>,
): Array<Record<string, string | number | null>> {
  return values.map((v) => ({ [colName]: v }));
}

function col(name: string, type: InputColumn["type"]): InputColumn {
  return { name, type };
}

// ── inferRole ─────────────────────────────────────────────────────────────────

describe("inferRole", () => {
  it("maps date → time", () => expect(inferRole("date")).toBe("time"));
  it("maps datetime → time", () => expect(inferRole("datetime")).toBe("time"));
  it("maps number → measure", () => expect(inferRole("number")).toBe("measure"));
  it("maps integer → measure", () =>
    expect(inferRole("integer")).toBe("measure"));
  it("maps string → dimension", () =>
    expect(inferRole("string")).toBe("dimension"));
  it("maps boolean → dimension", () =>
    expect(inferRole("boolean")).toBe("dimension"));
});

// ── countDistinct ──────────────────────────────────────────────────────────────

describe("countDistinct", () => {
  it("counts unique values", () => {
    const rows = makeRows("cat", ["A", "B", "A", "C"]);
    expect(countDistinct("cat", rows)).toBe(3);
  });

  it("ignores nulls", () => {
    const rows = makeRows("cat", ["A", null, "A"]);
    expect(countDistinct("cat", rows)).toBe(1);
  });

  it("handles empty rows", () => {
    expect(countDistinct("cat", [])).toBe(0);
  });

  it("handles all nulls", () => {
    const rows = makeRows("cat", [null, null]);
    expect(countDistinct("cat", rows)).toBe(0);
  });
});

// ── selectChartType ────────────────────────────────────────────────────────────

describe("selectChartType", () => {
  // ── 0 rows ──────────────────────────────────────────────────────────────────
  it("0 rows → table with note", () => {
    const result = selectChartType(
      [col("cat", "string"), col("val", "number")],
      [],
      0,
    );
    expect(result.chartType).toBe("table");
    expect(result.notes).toMatch(/no rows/);
  });

  // ── >2000 rows ──────────────────────────────────────────────────────────────
  it(">2000 rows → table with note", () => {
    const result = selectChartType(
      [col("cat", "string"), col("val", "number")],
      makeRows("cat", ["A"]), // rows array may be capped
      2001,
    );
    expect(result.chartType).toBe("table");
    expect(result.notes).toMatch(/2000/);
  });

  it("exactly 2000 rows → not table (bar in this case)", () => {
    const categories = Array.from({ length: 2000 }, (_, i) => `C${i}`);
    const rows = categories.map((c) => ({ cat: c, val: 1 }));
    const result = selectChartType(
      [col("cat", "string"), col("val", "number")],
      rows,
      2000,
    );
    // 2000 distinct → bar (>8), not table due to row count
    expect(result.chartType).toBe("bar");
  });

  // ── line: 1 time + 1+ measures ──────────────────────────────────────────────
  it("1 date + 1 measure → line", () => {
    const rows = [
      { dt: "2024-01-01", sales: 100 },
      { dt: "2024-01-02", sales: 200 },
    ];
    const result = selectChartType(
      [col("dt", "date"), col("sales", "number")],
      rows,
      2,
    );
    expect(result.chartType).toBe("line");
  });

  it("1 datetime + 2 measures → line", () => {
    const rows = [
      { ts: "2024-01-01T00:00:00Z", a: 1, b: 2 },
      { ts: "2024-01-02T00:00:00Z", a: 3, b: 4 },
    ];
    const result = selectChartType(
      [col("ts", "datetime"), col("a", "number"), col("b", "integer")],
      rows,
      2,
    );
    expect(result.chartType).toBe("line");
  });

  // ── pie: 1 dim with 3–8 distinct ────────────────────────────────────────────
  it("1 dim (3 distinct) + 1 measure → pie", () => {
    const rows = [
      { region: "North", rev: 100 },
      { region: "South", rev: 200 },
      { region: "East", rev: 150 },
    ];
    const result = selectChartType(
      [col("region", "string"), col("rev", "number")],
      rows,
      3,
    );
    expect(result.chartType).toBe("pie");
  });

  it("1 dim (8 distinct) + 1 measure → pie (boundary)", () => {
    const values = ["A", "B", "C", "D", "E", "F", "G", "H"];
    const rows = values.map((v) => ({ cat: v, val: 10 }));
    const result = selectChartType(
      [col("cat", "string"), col("val", "number")],
      rows,
      8,
    );
    expect(result.chartType).toBe("pie");
  });

  // ── bar: 1 dim > 8 distinct ──────────────────────────────────────────────────
  it("1 dim (9 distinct) + 1 measure → bar", () => {
    const values = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
    const rows = values.map((v) => ({ cat: v, val: 10 }));
    const result = selectChartType(
      [col("cat", "string"), col("val", "number")],
      rows,
      9,
    );
    expect(result.chartType).toBe("bar");
  });

  it("1 dim (2 distinct) + 1 measure → bar (below pie min)", () => {
    const rows = [
      { cat: "Yes", val: 10 },
      { cat: "No", val: 20 },
    ];
    const result = selectChartType(
      [col("cat", "string"), col("val", "number")],
      rows,
      2,
    );
    expect(result.chartType).toBe("bar");
  });

  it("1 dim (1 distinct) + 1 measure → bar", () => {
    const rows = [{ cat: "Only", val: 99 }];
    const result = selectChartType(
      [col("cat", "string"), col("val", "number")],
      rows,
      1,
    );
    expect(result.chartType).toBe("bar");
  });

  // ── table fallbacks ──────────────────────────────────────────────────────────
  it("2 dims + 1 measure → table", () => {
    const rows = [{ cat: "A", sub: "X", val: 1 }];
    const result = selectChartType(
      [col("cat", "string"), col("sub", "string"), col("val", "number")],
      rows,
      1,
    );
    expect(result.chartType).toBe("table");
  });

  it("1 dim + 2 measures → table", () => {
    const rows = [{ cat: "A", val1: 1, val2: 2 }];
    const result = selectChartType(
      [col("cat", "string"), col("val1", "number"), col("val2", "number")],
      rows,
      1,
    );
    expect(result.chartType).toBe("table");
  });

  it("all dimensions, no measures → table", () => {
    const rows = [{ a: "x", b: "y" }];
    const result = selectChartType(
      [col("a", "string"), col("b", "string")],
      rows,
      1,
    );
    expect(result.chartType).toBe("table");
  });

  it("1 time + 1 measure + 1 dim → table (mixed, no clear rule)", () => {
    const rows = [{ dt: "2024-01-01", cat: "A", val: 10 }];
    const result = selectChartType(
      [col("dt", "date"), col("cat", "string"), col("val", "number")],
      rows,
      1,
    );
    expect(result.chartType).toBe("table");
  });

  it("no columns → table", () => {
    const result = selectChartType([], [], 0);
    expect(result.chartType).toBe("table");
  });

  // ── column role annotation ───────────────────────────────────────────────────
  it("column roles correctly annotated on bar result", () => {
    const rows = [
      { cat: "A", val: 1 },
      { cat: "B", val: 2 },
      { cat: "C", val: 3 },
      { cat: "D", val: 4 },
      { cat: "E", val: 5 },
      { cat: "F", val: 6 },
      { cat: "G", val: 7 },
      { cat: "H", val: 8 },
      { cat: "I", val: 9 },
    ];
    const result = selectChartType(
      [col("cat", "string"), col("val", "number")],
      rows,
      9,
    );
    expect(result.columns).toEqual([
      { name: "cat", type: "string", role: "dimension" },
      { name: "val", type: "number", role: "measure" },
    ]);
  });

  it("column roles correctly annotated on line result", () => {
    const rows = [{ ts: "2024-01-01", v: 42 }];
    const result = selectChartType(
      [col("ts", "datetime"), col("v", "integer")],
      rows,
      1,
    );
    expect(result.columns).toEqual([
      { name: "ts", type: "datetime", role: "time" },
      { name: "v", type: "integer", role: "measure" },
    ]);
  });

  // ── tie-break: time present → line over bar ──────────────────────────────────
  it("1 time + 1 measure wins over dimension-only shape", () => {
    // Only a time + measure, no dim: must be line, not bar
    const rows = [
      { dt: "2024-01", sales: 500 },
      { dt: "2024-02", sales: 600 },
    ];
    const result = selectChartType(
      [col("dt", "date"), col("sales", "integer")],
      rows,
      2,
    );
    expect(result.chartType).toBe("line");
  });

  // ── ROW_CAP boundary ─────────────────────────────────────────────────────────
  it(`rowCount === ${ROW_CAP} is not downgraded`, () => {
    const rows = [{ cat: "X", val: 1 }]; // rows array shorter (capped), rowCount = cap
    const result = selectChartType(
      [col("cat", "string"), col("val", "number")],
      rows,
      ROW_CAP,
    );
    // 1 distinct → bar (below pie min)
    expect(result.chartType).toBe("bar");
    expect(result.notes).toBeUndefined();
  });

  it(`rowCount === ${ROW_CAP + 1} is downgraded`, () => {
    const rows = [{ cat: "X", val: 1 }];
    const result = selectChartType(
      [col("cat", "string"), col("val", "number")],
      rows,
      ROW_CAP + 1,
    );
    expect(result.chartType).toBe("table");
    expect(result.notes).toBeDefined();
  });
});
