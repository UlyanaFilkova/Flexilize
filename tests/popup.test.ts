import {beforeEach, describe, expect, it, vi} from "vitest";
import {fireEvent, waitFor} from "@testing-library/dom";
import {record} from "./fixtures";

const popupMarkup = `
  <header><span id="counter"></span><button id="history"></button><button id="settings"></button><button id="clear"></button></header>
  <main><div id="empty"></div><ol id="records"></ol></main>
  <footer><select id="export-format"><option value="json">JSON</option><option value="csv">CSV</option></select><button id="export"></button></footer>
  <div id="notice"></div>`;

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
  });

  it("opens settings and full history", async () => {
    fireEvent.click(document.querySelector("#settings")!);
    expect(browserMock.runtime.openOptionsPage).toHaveBeenCalled();
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
  });
});
