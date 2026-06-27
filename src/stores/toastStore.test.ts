import { describe, it, expect, beforeEach } from "vitest";
import { useToastStore } from "./toastStore";

describe("toastStore", () => {
  beforeEach(() => useToastStore.getState().clear());

  it("show sets the message", () => {
    useToastStore.getState().show("Failed");
    expect(useToastStore.getState().message).toBe("Failed");
  });

  it("clear resets to null", () => {
    useToastStore.getState().show("x");
    useToastStore.getState().clear();
    expect(useToastStore.getState().message).toBeNull();
  });
});
