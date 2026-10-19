import {afterEach, beforeEach, vi} from "vitest";
import {resetBrowserMock} from "./mocks/browser";

beforeEach(() => {
  resetBrowserMock();
  document.body.replaceChildren();
  document.documentElement.removeAttribute("data-context-translator-instance");
  vi.stubGlobal("confirm", vi.fn(() => true));
  if (!URL.createObjectURL) URL.createObjectURL = vi.fn(() => "blob:test");
  if (!URL.revokeObjectURL) URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
