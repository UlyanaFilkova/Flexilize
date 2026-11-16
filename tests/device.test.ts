import {describe, expect, it, vi} from "vitest";
import {isMobileDevice} from "../src/device";

describe("mobile-device detection", () => {
  it.each([
    {compact: false, touchPoints: 5, coarse: true, expected: false},
    {compact: true, touchPoints: 0, coarse: false, expected: false},
    {compact: true, touchPoints: 1, coarse: false, expected: true},
    {compact: true, touchPoints: 0, coarse: true, expected: true},
    {compact: false, touchPoints: 0, coarse: true, expected: false}
  ])("requires both a compact screen and touch input", ({compact, touchPoints, coarse, expected}) => {
    Object.defineProperty(navigator, "maxTouchPoints", {configurable: true, value: touchPoints});
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({matches: query.includes("max-width") ? compact : coarse}))
    });

    expect(isMobileDevice()).toBe(expected);
  });

  it("returns false when browser globals are unavailable", () => {
    vi.stubGlobal("window", undefined);
    expect(isMobileDevice()).toBe(false);
  });
});
