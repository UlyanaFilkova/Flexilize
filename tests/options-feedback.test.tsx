import {beforeEach, describe, expect, it, vi} from "vitest";
import {screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {defaultSettings, SETTINGS_KEY} from "../src/settings";

describe("feedback form", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    const mock = await import("./mocks/browser");
    mock.storageData[SETTINGS_KEY] = {...structuredClone(defaultSettings), interfaceLanguage: "ru"};
    mock.browserMock.runtime.sendMessage.mockResolvedValue({ok: true, records: []});
    document.body.innerHTML = '<div id="root"></div>';
    history.replaceState(null, "", "#review");
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await import("../src/options/options");
    await screen.findByRole("heading", {name: "Оценка и отзыв"});
  });
  it("sends arbitrary contact text with a localized label and clears after success", async () => {
    fetchMock.mockResolvedValue({ok: true, status: 200});
    const message = screen.getByRole("textbox", {name: "Сообщение"});
    const contact = screen.getByRole("textbox", {name: "Ваш email или контакт для ответа (необязательно)"});
    await userEvent.type(message, "Please improve the dictionary.");
    await userEvent.type(contact, "@translator in Telegram");
    await userEvent.click(screen.getByRole("button", {name: "Отправить"}));

    expect(await screen.findByText("Спасибо! Сообщение отправлено.")).toBeTruthy();
    await waitFor(() => {
      expect((message as HTMLTextAreaElement).value).toBe("");
      expect((contact as HTMLInputElement).value).toBe("");
    });
    const options = fetchMock.mock.calls[0][1] as RequestInit;
    expect(options.method).toBe("POST");
    expect(options.body).toBeInstanceOf(FormData);
    expect((options.body as FormData).get("contact")).toBe("@translator in Telegram");
    expect((options.body as FormData).get("contactLabel")).toBe("Контактная информация");
  });

  it("keeps the message and contact when sending fails", async () => {
    fetchMock.mockResolvedValue({ok: false, status: 429});
    const message = screen.getByRole("textbox", {name: "Сообщение"});
    const contact = screen.getByRole("textbox", {name: "Ваш email или контакт для ответа (необязательно)"});
    await userEvent.type(message, "I still need help.");
    await userEvent.type(contact, "@helper");
    await userEvent.click(screen.getByRole("button", {name: "Отправить"}));

    expect((await screen.findByRole("alert")).textContent).toContain("Не удалось отправить сообщение. Попробуйте позже.");
    expect((message as HTMLTextAreaElement).value).toBe("I still need help.");
    expect((contact as HTMLInputElement).value).toBe("@helper");
  });
});
