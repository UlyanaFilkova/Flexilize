import {describe, expect, it} from "vitest";
import {detectBrowserFamily, getReviewStore} from "../src/review-store";

describe("review-store links", () => {
  it.each([
    ["Mozilla/5.0 YaBrowser/24.1", "yandex"],
    ["Mozilla/5.0 OPR/110.0", "opera"],
    ["Mozilla/5.0 Edg/124.0", "edge"],
    ["Mozilla/5.0 EdgA/124.0", "edge"],
    ["Mozilla/5.0 EdgiOS/124.0", "edge"],
    ["Mozilla/5.0 Firefox/125.0", "firefox"],
    ["Mozilla/5.0 Chrome/124.0", "chrome"],
    ["Mozilla/5.0 CriOS/124.0", "chrome"],
    ["Unknown browser", "other"]
  ])("detects %s as %s", (userAgent, expected) => {
    expect(detectBrowserFamily(userAgent)).toBe(expected);
  });

  it("uses a localized Firefox Add-ons link", () => {
    expect(getReviewStore("Firefox/125", "en")).toEqual({
      browser: "firefox",
      browserLabel: "Firefox",
      storeLabel: "Firefox Add-ons",
      url: "https://addons.mozilla.org/en-US/firefox/addon/ctx-translator/"
    });
    expect(getReviewStore("Firefox/125", "fr").url)
      .toBe("https://addons.mozilla.org/fr/firefox/addon/ctx-translator/");
  });

  it("uses a translated Chrome Web Store link for other browsers", () => {
    const store = getReviewStore("Chrome/125", "zh-CN");
    expect(store.browser).toBe("chrome");
    expect(store.storeLabel).toBe("Chrome Web Store");
    expect(store.url).toContain("?hl=zh-CN");
  });
});
