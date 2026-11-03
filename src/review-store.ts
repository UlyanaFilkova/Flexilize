export type BrowserFamily = "yandex" | "opera" | "edge" | "firefox" | "chrome" | "other";

export type ReviewStore = {
  browser: BrowserFamily
  browserLabel: string
  storeLabel: string
  url: string
}

const chromeWebStoreUrl = "https://chromewebstore.google.com/detail/context-translator/cggjiomkfpkgmndhkjlilopgiffelpad";
const firefoxAddonsUrl = "https://addons.mozilla.org/en/firefox/addon/ctx-translator/";

export function detectBrowserFamily(userAgent: string): BrowserFamily {
  if (/YaBrowser\//i.test(userAgent)) return "yandex";
  if (/OPR\//i.test(userAgent) || /Opera/i.test(userAgent)) return "opera";
  if (/Edg(?:A|iOS)?\//i.test(userAgent)) return "edge";
  if (/Firefox\//i.test(userAgent)) return "firefox";
  if (/Chrome\//i.test(userAgent) || /CriOS\//i.test(userAgent)) return "chrome";
  return "other";
}

export function getReviewStore(userAgent: string, language = "ru"): ReviewStore {
  const browser = detectBrowserFamily(userAgent);
  if (browser === "firefox") {
    const locale = language === "en" ? "en-US" : language;
    return {browser, browserLabel: "Firefox", storeLabel: "Firefox Add-ons", url: firefoxAddonsUrl.replace("/ru/", `/${encodeURIComponent(locale)}/`)};
  }
  const browserLabels: Record<Exclude<BrowserFamily, "firefox">, string> = {
    yandex: "Яндекс Браузер",
    opera: "Opera",
    edge: "Microsoft Edge",
    chrome: "Google Chrome",
    other: "browser"
  };
  return {
    browser,
    browserLabel: browserLabels[browser],
    storeLabel: "Chrome Web Store",
    url: `${chromeWebStoreUrl}?hl=${encodeURIComponent(language)}`
  };
}
