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
    expect(screen.getByRole("button", {name: /^Keyboard shortcuts$/})).toBeTruthy();
    await userEvent.click(screen.getByRole("button", {name: /^Language and translation$/}));
    expect(screen.getByRole("heading", {name: "Interface language"})).toBeTruthy();
    const interfaceSelect = screen.getAllByLabelText("Interface language").find((element) => element.tagName === "SELECT") as HTMLSelectElement;
    expect([...interfaceSelect.options].map((option) => option.textContent)).toEqual([
      "Arabic", "Chinese (China)", "Chinese (Taiwan)", "Czech", "Danish", "Dutch", "English", "Filipino", "Finnish", "French",
      "German", "Greek", "Hindi", "Hungarian", "Indonesian", "Italian", "Japanese", "Korean", "Malay", "Norwegian",
      "Persian", "Polish", "Portuguese", "Romanian", "Russian", "Spanish", "Swedish", "Turkish", "Vietnamese"
    ]);
    const collator = new Intl.Collator("en", {sensitivity: "base"});
    for (const select of [...document.querySelectorAll("select")]) {
      const labels = [...select.options].map((option) => option.textContent || "");
      if (labels.length > 20) expect(labels).toEqual([...labels].sort((left, right) => collator.compare(left, right)));
    }
    expect(screen.getAllByRole("option", {name: "German"})).toHaveLength(4);
    expect(document.querySelector("main")?.textContent).not.toMatch(/[А-Яа-яЁё]/u);
    for (const section of ["Keyboard shortcuts", "Sound", "Saving"]) {
      await userEvent.click(screen.getByRole("button", {name: new RegExp(`^${section}$`)}));
      await waitFor(() => expect(screen.getByRole("heading", {name: section})).toBeTruthy());
      expect(document.querySelector("main")?.textContent).not.toMatch(/[А-Яа-яЁё]/u);
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
