import {beforeEach, describe, expect, it, vi} from "vitest";
import {screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {defaultSettings, SETTINGS_KEY} from "../src/settings";

describe("English options interface", () => {
  beforeEach(async () => {
    vi.resetModules();
    const mock = await import("./mocks/browser");
    document.body.innerHTML = '<div id="root"></div>';
    mock.storageData[SETTINGS_KEY] = {...structuredClone(defaultSettings), interfaceLanguage: "en"};
    mock.browserMock.runtime.sendMessage.mockResolvedValue({ok: true, records: []});
    history.replaceState(null, "", "#settings");
    await import("../src/options/options");
    await screen.findByRole("heading", {name: "Settings"});
  });

  it("localizes navigation, settings, language names, and help", async () => {
    expect(screen.getByRole("button", {name: /^Activation$/})).toBeTruthy();
    expect(screen.getByRole("button", {name: /^Advanced settings$/})).toBeTruthy();
    expect(mainTextWithoutInterfaceLanguageNames()).not.toMatch(/[А-Яа-яЁё]/u);
    await userEvent.click(screen.getByRole("button", {name: /^Languages$/}));
    expect(screen.getByRole("heading", {name: "Interface language"})).toBeTruthy();
    const interfaceSelect = screen.getAllByLabelText("Interface language").find((element) => element.tagName === "SELECT") as HTMLSelectElement;
    expect([...interfaceSelect.options].map((option) => option.textContent)).toEqual([
      "čeština", "dansk", "Deutsch", "English", "español", "Filipino", "français", "hrvatski", "Indonesia", "italiano", "magyar",
      "Melayu", "Nederlands", "norsk", "polski", "português", "română", "shqip", "slovenčina", "slovenščina", "suomi",
      "svenska", "Tiếng Việt", "Türkçe", "Ελληνικά", "русский", "српски", "ქართული", "עברית", "العربية", "فارسی", "हिन्दी", "한국어", "中文（中国）", "中文（台灣）", "日本語"
    ]);
    const collator = new Intl.Collator("en", {sensitivity: "base"});
    for (const select of [...document.querySelectorAll("select")]) {
      const labels = [...select.options].map((option) => option.textContent || "");
      if (labels.length > 20) expect(labels).toEqual([...labels].sort((left, right) => collator.compare(left, right)));
    }
    expect(screen.getAllByRole("option", {name: "German"})).toHaveLength(3);
    expect(mainTextWithoutInterfaceLanguageNames()).not.toMatch(/[А-Яа-яЁё]/u);
    for (const section of ["Activation", "Sound", "Advanced settings"]) {
      await userEvent.click(screen.getByRole("button", {name: new RegExp(`^${section}$`)}));
      await waitFor(() => expect(screen.getByRole("heading", {name: section})).toBeTruthy());
      expect(mainTextWithoutInterfaceLanguageNames()).not.toMatch(/[А-Яа-яЁё]/u);
    }
    await userEvent.click(screen.getByRole("button", {name: /How to use/}));
    await waitFor(() => expect(screen.getByRole("heading", {name: "Frequently asked questions"})).toBeTruthy());
    expect(document.querySelectorAll(".help-visual-example")).toHaveLength(4);
    expect(screen.getByText("On-page example")).toBeTruthy();
    expect(screen.getByText("Standalone translator example")).toBeTruthy();
    const helpPage = document.querySelector(".help-page")!.cloneNode(true) as HTMLElement;
    helpPage.querySelectorAll(".brand-mark").forEach((element) => element.remove());
    expect(helpPage.textContent).not.toMatch(/[А-Яа-яЁё]/u);
  });
});

function mainTextWithoutInterfaceLanguageNames() {
  const main = document.querySelector("main")?.cloneNode(true) as HTMLElement | null;
  main?.querySelector('select[aria-label="Interface language"]')?.remove();
  return main?.textContent || "";
}
