import { describe, it, expect } from "vitest";
import { parseLifecyclePref, parseHookViewPref } from "./uiPrefsStore";

describe("parseLifecyclePref", () => {
  it("defaults to true when raw is missing", () => {
    expect(parseLifecyclePref(null)).toBe(true);
  });

  it("reads a persisted true value", () => {
    expect(parseLifecyclePref(JSON.stringify({ lifecycleView: true }))).toBe(true);
  });

  it("explicit false is false", () => {
    expect(parseLifecyclePref(JSON.stringify({ lifecycleView: false }))).toBe(false);
  });

  it("defaults to true on malformed JSON", () => {
    expect(parseLifecyclePref("{not json")).toBe(true);
  });

  it("defaults to true when the field is absent or non-boolean", () => {
    expect(parseLifecyclePref(JSON.stringify({}))).toBe(true);
    expect(parseLifecyclePref(JSON.stringify({ lifecycleView: "yes" }))).toBe(true);
  });
});

describe("parseHookViewPref", () => {
  it("unset (no key) defaults to true", () => {
    expect(parseHookViewPref(JSON.stringify({ lifecycleView: true }))).toBe(true);
    expect(parseHookViewPref(null)).toBe(true);
  });
  it("explicit false is false", () => {
    expect(parseHookViewPref(JSON.stringify({ hookView: false }))).toBe(false);
  });
  it("explicit true is true", () => {
    expect(parseHookViewPref(JSON.stringify({ hookView: true }))).toBe(true);
  });
  it("invalid JSON defaults to true", () => {
    expect(parseHookViewPref("{not json")).toBe(true);
  });
  it("hookView null (non-boolean) defaults to true", () => {
    expect(parseHookViewPref(JSON.stringify({ hookView: null }))).toBe(true);
  });
});
