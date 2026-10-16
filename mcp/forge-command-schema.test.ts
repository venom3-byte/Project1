import { describe, expect, it } from "vitest";
import { normalizeForgeCommand } from "./forge-command-schema.mjs";

describe("normalizeForgeCommand", () => {
  it("accepts deterministic scene inspections and creation commands", () => {
    expect(normalizeForgeCommand({ op: "diagnostics" })).toEqual({ op: "diagnostics" });
    expect(normalizeForgeCommand({ op: "create", kind: "sphere", name: "Probe", x: 1, y: 2, z: 3 }))
      .toEqual({ op: "create", kind: "sphere", name: "Probe", x: 1, y: 2, z: 3 });
  });

  it("rejects arbitrary evaluation and unknown operations", () => {
    expect(() => normalizeForgeCommand({ op: "eval", code: "alert(1)" })).toThrow(/Unsupported Forge command/);
    expect(() => normalizeForgeCommand({ op: "create", kind: "box", script: "return process.env" }))
      .toThrow(/Unsupported field/);
  });

  it("rejects non-finite coordinates, extreme values, and negative scale", () => {
    expect(() => normalizeForgeCommand({ op: "create", x: Infinity })).toThrow(/numeric range/);
    expect(() => normalizeForgeCommand({ op: "transform", id: "entity-1", sx: -1 })).toThrow(/greater than zero/);
    expect(() => normalizeForgeCommand({ op: "transform", id: "entity-1", x: 1e99 })).toThrow(/numeric range/);
  });

  it("requires stable target IDs for mutation commands", () => {
    expect(() => normalizeForgeCommand({ op: "delete" })).toThrow(/stable target id/);
    expect(() => normalizeForgeCommand({ op: "physics", id: "entity-1" })).toThrow(/requires mode/);
  });

  it("limits PCG work to bounded counts and known generator types", () => {
    expect(normalizeForgeCommand({ op: "pcg", kind: "trees", count: 300, seed: 42, area: 70 }).count).toBe(300);
    expect(() => normalizeForgeCommand({ op: "pcg", kind: "all-files", count: 999999 })).toThrow();
  });

  it("limits nested payloads and blocks unsafe prototype keys", () => {
    expect(() => normalizeForgeCommand({ op: "save-slot", slot: "autosave", data: { constructor: { polluted: true } } })).toThrow(/unsafe property/);
    expect(() => normalizeForgeCommand({ op: "terrain-generate", options: { data: "x".repeat(13000) } })).toThrow(/size limit/);
  });

  it("accepts JSON-only visual gameplay parameters without executable code", () => {
    expect(normalizeForgeCommand({ op: "animation-graph-param", graphId: "graph-1", key: "speed", value: 1.25 }))
      .toMatchObject({ op: "animation-graph-param", graphId: "graph-1", key: "speed", value: 1.25 });
  });
});
