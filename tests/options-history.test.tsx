import {describe, expect, it, vi} from "vitest";
import {screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {defaultSettings, SETTINGS_KEY} from "../src/settings";
import {record} from "./fixtures";

describe("options history and export", () => {
  it("renders, edits, deletes, restores and offers every export", async () => {
    vi.resetModules();
    const {browserMock, storageData} = await import("./mocks/browser");
    storageData[SETTINGS_KEY] = structuredClone(defaultSettings);
    storageData.translationRecords = [structuredClone(record)];
    browserMock.runtime.sendMessage.mockImplementation(async (message) => {
      return {ok: true};
    });
    document.body.innerHTML = '<div id="root"></div>';
    history.replaceState(null, "", "#settings");
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    await import("../src/options/options");

    await userEvent.click(await screen.findByRole("button", {name: /^История$/}));
    expect(await screen.findByText("Hello")).toBeTruthy();
    expect(screen.getByText("Здравствуйте")).toBeTruthy();
    expect(screen.getByText("Hello, world!").tagName).toBe("BLOCKQUOTE");

    await userEvent.click(screen.getByRole("button", {name: "Редактировать перевод «Hello»"}));
    const translation = screen.getByLabelText("Перевод");
    await userEvent.clear(translation);
    await userEvent.type(translation, "Добрый день");
    await userEvent.click(screen.getByRole("button", {name: "Сохранить"}));
    await waitFor(() => expect(browserMock.runtime.sendMessage.mock.calls.some(([message]) => (
      message.type === "update-record" && message.payload.record.translation === "Добрый день"
    ))).toBe(true));
    expect(await screen.findByText("Добрый день")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", {name: "Удалить перевод «Hello»"}));
    await waitFor(() => expect(screen.queryByText("Добрый день")).toBeNull());
    await userEvent.click(screen.getByRole("button", {name: "Отменить"}));
    expect(await screen.findByText("Добрый день")).toBeTruthy();

    await userEvent.click(document.querySelector(".open-export")!);
    expect(await screen.findByRole("heading", {name: "Экспорт"})).toBeTruthy();
    expect(screen.getAllByText("Скачать файл")).toHaveLength(10);
  });
});
