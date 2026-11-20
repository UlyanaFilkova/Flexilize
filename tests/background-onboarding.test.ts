import {beforeEach, describe, expect, it, vi} from "vitest";
import {ONBOARDING_COMPLETED_KEY} from "../src/settings";

describe("onboarding after installation", () => {
  let mock: typeof import("./mocks/browser");

  beforeEach(async () => {
    vi.resetModules();
    mock = await import("./mocks/browser");
    await import("../src/background");
  });

  it.each([undefined, false, true])("opens quick setup on a fresh installation with previous completion %s", async (completed) => {
    mock.storageData[ONBOARDING_COMPLETED_KEY] = completed;
    mock.installedListeners.forEach((listener) => listener({reason: "install"}));
    await vi.waitFor(() => expect(mock.browserMock.tabs.create).toHaveBeenCalledWith({
      url: "moz-extension://test/options/index.html#welcome"
    }));
    expect(mock.storageData[ONBOARDING_COMPLETED_KEY]).toBe(false);
    expect(mock.browserMock.tabs.create).toHaveBeenCalledTimes(1);
  });

  it.each(["update", "browser_update"])("preserves completion and does not open quick setup on %s", async (reason) => {
    mock.storageData[ONBOARDING_COMPLETED_KEY] = true;
    mock.installedListeners.forEach((listener) => listener({reason}));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mock.storageData[ONBOARDING_COMPLETED_KEY]).toBe(true);
    expect(mock.browserMock.tabs.create).not.toHaveBeenCalled();
  });
});
