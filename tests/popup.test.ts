import {beforeEach, describe, expect, it, vi} from "vitest";
import {fireEvent, waitFor} from "@testing-library/dom";
import {record} from "./fixtures";

const popupMarkup = `
  <header><span id="counter"></span><button id="history"></button><button id="settings"></button><button id="clear"></button></header>
  <main><div id="empty"></div><ol id="records"></ol></main>
  <footer><div class="copy-all-control"><span>Copy all</span><button id="copy-all" aria-label="Копировать всё"></button></div><select id="export-format"><option value="json">JSON</option><option value="csv">CSV</option></select><button id="export"></button></footer>
  <div id="notice"></div>`;

it("collapses only records over 300 characters and copies their complete text", async () => {
  vi.resetModules();
  const {browserMock} = await import("./mocks/browser");
  const text = "Long selected text. ".repeat(20);
  document.body.innerHTML = popupMarkup;
  await browserMock.storage.local.set({translationRecords: [
    {...record, id: "at-limit", text: text.slice(0, 300)},
    {...record, id: "over-limit", text: text.slice(0, 301)}
  ]});
  const writeText = vi.fn(async () => undefined);
  Object.defineProperty(navigator, "clipboard", {configurable: true, value: {writeText}});
  await import("../src/popup/popup");
  document.dispatchEvent(new Event("DOMContentLoaded"));
  await waitFor(() => expect(document.querySelectorAll(".record")).toHaveLength(2));
  const [shortCard, longCard] = document.querySelectorAll<HTMLElement>(".record");
  expect(shortCard.querySelector(".toggle-record")).toBeNull();
  expect(longCard.classList.contains("collapsed")).toBe(true);
  writeText.mockClear();
  fireEvent.click(document.querySelector("#copy-all")!);
  const translations = [record.translation, ...record.translations.filter((value) => value !== record.translation)].join("\n");
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(
    `${text.slice(0, 300)}\n${translations}\n\n${text.slice(0, 301)}\n${translations}`
  ));
  const toggle = longCard.querySelector<HTMLButtonElement>(".toggle-record")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(toggle.textContent).toBe("Развернуть");
  expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toBe(longCard.querySelector(".record-content"));
  fireEvent.click(longCard.querySelector(".copy-record")!);
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(
    [text.slice(0, 301), record.translation, ...record.translations.filter((value) => value !== record.translation)].join("\n")
  ));
  fireEvent.click(toggle);
  expect(longCard.classList.contains("collapsed")).toBe(false);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(toggle.textContent).toBe("Свернуть");
  expect(longCard.querySelector(".original")?.textContent).toBe(text.slice(0, 301));
  fireEvent.click(toggle);
  expect(longCard.classList.contains("collapsed")).toBe(true);
});

describe("popup", () => {
  let browserMock: typeof import("./mocks/browser")["browserMock"];

  beforeEach(async () => {
    vi.resetModules();
    browserMock = (await import("./mocks/browser")).browserMock;
    document.body.innerHTML = popupMarkup;
    await browserMock.storage.local.set({translationRecords: [record]});
    browserMock.runtime.sendMessage.mockImplementation(async (message) => {
      return {ok: true};
    });
    vi.spyOn(window, "close").mockImplementation(() => undefined);
    await import("../src/popup/popup");
    document.dispatchEvent(new Event("DOMContentLoaded"));
    await waitFor(() => expect(document.querySelectorAll(".record")).toHaveLength(1));
  });

  it("renders records, alternatives, metadata and enabled actions", () => {
    expect(document.querySelector("#counter")?.textContent).toBe("1 запись");
    expect(document.querySelector(".original")?.textContent).toBe("Hello");
    expect(document.querySelector(".record-transcription")?.textContent).toBe(record.transcription);
    expect(document.querySelector(".translation-alternatives")?.textContent).toContain("Здравствуйте");
    expect((document.querySelector(".source-link") as HTMLAnchorElement).href).toBe(record.pageUrl);
    expect((document.querySelector("#clear") as HTMLButtonElement).disabled).toBe(false);
    expect((document.querySelector("#copy-all") as HTMLButtonElement).disabled).toBe(false);
  });

  it("opens settings and full history", async () => {
    fireEvent.click(document.querySelector("#settings")!);
    await waitFor(() => expect(browserMock.tabs.create).toHaveBeenCalledWith({url: "moz-extension://test/options/index.html#settings"}));
    fireEvent.click(document.querySelector("#history")!);
    await waitFor(() => expect(browserMock.tabs.create).toHaveBeenCalledWith({url: "moz-extension://test/options/index.html#history"}));
  });

  it("deletes and restores a record", async () => {
    fireEvent.click(document.querySelector(".delete-record")!);
    await waitFor(() => expect(document.querySelectorAll(".record")).toHaveLength(0));
    expect(document.querySelector("#notice")?.textContent).toContain("Запись удалена");
    fireEvent.click(document.querySelector(".undo-button")!);
    await waitFor(() => expect(document.querySelectorAll(".record")).toHaveLength(1));
    expect(browserMock.runtime.sendMessage.mock.calls.some(([message]) => message.type === "restore-record")).toBe(true);
  });

  it("clears all records after confirmation", async () => {
    fireEvent.click(document.querySelector("#clear")!);
    await waitFor(() => expect(document.querySelectorAll(".record")).toHaveLength(0));
    expect(confirm).toHaveBeenCalled();
    expect(document.querySelector("#counter")?.textContent).toBe("0 записей");
    expect((document.querySelector("#copy-all") as HTMLButtonElement).disabled).toBe(true);
  });
});
