import {expect, it, vi} from "vitest";
import {screen, waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

it("localizes the settings illustration, help, and every export preview in all interface languages", async () => {
  vi.resetModules();
  const {storageData, browserMock} = await import("./mocks/browser");
  const {defaultSettings, SETTINGS_KEY} = await import("../src/settings");
  const {INTERFACE_LANGUAGES, formatMessage, translate} = await import("../src/i18n");
  const {helpExamples} = await import("../src/options/help-examples");
  document.body.innerHTML = '<div id="root"></div>';
  storageData[SETTINGS_KEY] = {...structuredClone(defaultSettings), interfaceLanguage: "en"};
  browserMock.runtime.sendMessage.mockResolvedValue({ok: true, records: []});
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  history.replaceState(null, "", "#settings");
  await import("../src/options/options");
  await screen.findByRole("heading", {name: "Settings"});

  for (const language of INTERFACE_LANGUAGES) {
    await userEvent.click(screen.getByRole("button", {name: translate("Языки")}));
    const select = screen.getAllByLabelText(translate("Язык интерфейса")).find(element => element.tagName === "SELECT") as HTMLSelectElement;
    await userEvent.selectOptions(select, language);
    const foreignLanguage = language === "en" ? "es" : "en";
    await waitFor(() => {
      expect(document.documentElement.lang, language).toBe(language);
      expect(document.querySelector(".banner-demo-source strong")?.getAttribute("lang"), language).toBe(foreignLanguage);
      expect(document.querySelector(".banner-demo-translation")?.textContent, language).toBe(helpExamples(language).banner.translation);
      expect(document.querySelector(".banner-demo-context")?.textContent, language).toBe(helpExamples(language).banner.contextTranslation);
    });
    expect(document.querySelector(".banner-demo-source strong")?.textContent).toBe(language === "en" ? "adquirir un significado diferente" : "take on a different meaning");

    await userEvent.click(screen.getByRole("button", {name: translate("Как пользоваться")}));
    await screen.findByRole("heading", {name: translate("Частые вопросы")});
    await waitFor(() => {
      for (const [detail, id, placeholder, label] of [
        ["speech-rate", "ui.help-transcription-and-speech-description", "speed", "скорости"],
        ["translator-shortcuts", "ui.help-translator-shortcut-instructions", "settings", "настройках"],
        ["translator-languages", "ui.help-default-languages-instructions", "languages", "языки по умолчанию"]
      ]) {
        const link = document.querySelector<HTMLAnchorElement>(`.help-page a[href="#settings/${detail}"]`)!;
        expect(link, `${language}: ${detail}`).toBeTruthy();
        expect(link.textContent, `${language}: ${detail}`).toBe(translate(label));
        expect(link.closest("p")?.textContent, `${language}: ${detail}`).toBe(formatMessage(id, {[placeholder]: translate(label)}));
      }
    });
    expect(document.querySelector(".visual-long-speech-text")?.getAttribute("lang"), language).toBe(foreignLanguage);
    expect(document.querySelector(".visual-long-speech-text")?.textContent?.startsWith(language === "en" ? "Cada día" : "Every day"), language).toBe(true);
    if (language !== "ru") expect(document.querySelector(".visual-history-heading small")?.textContent, language).not.toMatch(/записи/u);
    if (language === "ru") expect(document.querySelector(".visual-history-heading small")?.textContent).toBe("24 записи");

    for (const [index, kind] of ["anki", "table", "document", "json"].entries()) {
      await userEvent.click(document.querySelectorAll<HTMLButtonElement>(".visual-export-formats button")[index]);
      await waitFor(() => {
        expect(document.querySelector(`.visual-export-sample-${kind}`), `${language}: ${kind}`).toBeTruthy();
        const page = document.querySelector(".help-page")!.cloneNode(true) as HTMLElement;
        page.querySelectorAll('[translate="no"], .brand-mark').forEach(element => element.remove());
        expect(page.textContent, `${language}: ${kind}`).not.toMatch(/ui\.help-|ZXQ|QXZ|\{(?:count|language)\}/u);
        if (language !== "ru" && language !== "sr") expect(page.textContent, `${language}: ${kind}`).not.toMatch(/[А-Яа-яЁё]/u);
      });
      const sample = document.querySelector(`.visual-export-sample-${kind}`)!;
      expect(sample.textContent, `${language}: ${kind}`).toContain(language === "en" ? "viaje" : "journey");
      expect(sample.textContent, `${language}: ${kind}`).toContain(helpExamples(language).exportSample.words[0].translation);
    }
  }
}, 120_000);
