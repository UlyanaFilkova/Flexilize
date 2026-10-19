import {describe, expect, it} from "vitest";
import manifest from "../src/manifest.json";
import packageJson from "../package.json";

describe("extension manifest", () => {
  it("keeps package and extension versions synchronized", () => {
    expect(manifest.version).toBe(packageJson.version);
  });

  it("registers content, background, popup and options entry points", () => {
    expect(manifest.content_scripts).toEqual(expect.arrayContaining([
      expect.objectContaining({matches: ["<all_urls>"], js: ["content.ts"]})
    ]));
    expect(manifest.background).toMatchObject({"chromium:service_worker": "background.ts", "firefox:scripts": ["background.ts"]});
    expect(manifest.options_ui.page).toBe("options/index.html");
    expect(manifest["chromium:action"].default_popup).toBe("popup/index.html");
    expect(manifest["firefox:browser_action"].default_popup).toBe("popup/index.html");
  });

  it("declares storage and every remote provider used by the extension", () => {
    expect(manifest.permissions).toEqual(expect.arrayContaining(["storage", "unlimitedStorage"]));
    ["api.mymemory.translated.net", "api.dictionaryapi.dev", "api.datamuse.com", "translate.googleapis.com", "translate.google.com"]
      .forEach((host) => expect(manifest.host_permissions.some((permission) => permission.includes(host))).toBe(true));
  });

  it("exposes runnable local test commands without changing the CI command", () => {
    expect(packageJson.scripts.test).toContain("vitest");
    expect(packageJson.scripts["test:coverage"]).toContain("--coverage");
    expect(packageJson.scripts.ci).toBe("npm run typecheck && npm run build:chrome && npm run build:firefox");
  });
});
