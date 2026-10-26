import {beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {record} from "./fixtures";

describe("background message handling", () => {
  let handle: (message: any) => any;
  let storageData: Record<string, any>;

  beforeAll(async () => {
    vi.resetModules();
    const mock = await import("./mocks/browser");
    storageData = mock.storageData;
    await import("../src/background");
    handle = mock.messageListeners[0];
  });

  beforeEach(() => {
    Object.keys(storageData).forEach((key) => delete storageData[key]);
  });

  it("supports the complete record lifecycle", async () => {
    expect(await handle({type: "get-records"})).toEqual({ok: true, records: []});
    expect((await handle({type: "save-record", payload: {record}})).saved).toBe(true);
    expect((await handle({type: "get-records"})).records).toHaveLength(1);

    const updated = {...record, translation: "Добрый день"};
    expect(await handle({type: "update-record", payload: {
      original: {createdAt: record.createdAt, sentence: record.sentence, text: record.text}, record: updated
    }})).toEqual({ok: true});
    expect((await handle({type: "get-records"})).records[0].translation).toBe("Добрый день");

    expect(await handle({type: "delete-record", payload: {
      createdAt: record.createdAt, sentence: record.sentence, text: record.text
    }})).toEqual({ok: true});
    expect((await handle({type: "get-records"})).records).toEqual([]);

    await handle({type: "restore-record", payload: {index: 0, record}});
    expect((await handle({type: "get-records"})).records).toHaveLength(1);
    await handle({type: "clear-records"});
    expect((await handle({type: "get-records"})).records).toEqual([]);
  });

  it("translates arbitrary language pairs and caches the result", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(["Hallo"]), {
      status: 200, headers: {"content-type": "application/json"}
    }));
    vi.stubGlobal("fetch", fetchMock);
    const message = {type: "translate-preview", payload: {text: "Hello unique", sentence: "Hello unique", sourceLanguage: "en", targetLanguage: "de"}};
    await expect(handle(message)).resolves.toMatchObject({ok: true, translation: "Hallo", sourceLanguage: "en"});
    await expect(handle(message)).resolves.toMatchObject({translation: "Hallo"});
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toContain("clients5.google.com/translate_a/t");
  });

  it("creates and saves a selection translation without a transcription request", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(["Тестовый перевод"]), {status: 200})));
    const result = await handle({type: "translate-selection", payload: {
      text: "Unique integration phrase", sentence: "Unique integration phrase.",
      sourceLanguage: "en", targetLanguage: "ru", transcription: null, transcriptionLoaded: true,
      pageTitle: "Test", pageUrl: "https://example.com", save: true
    }});
    expect(result).toMatchObject({ok: true, translation: "Тестовый перевод", saved: true});
    expect((await handle({type: "get-records"})).records[0]).toMatchObject({
      text: "Unique integration phrase", transcription: null, targetLanguage: "ru"
    });
  });

  it("returns base64 speech chunks with source offsets", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), {
      status: 200, headers: {"content-type": "audio/mpeg"}
    })));
    const result = await handle({type: "get-speech-audio", payload: {language: "en", text: "Hello world"}});
    expect(result).toMatchObject({ok: true});
    expect(result.chunks[0]).toMatchObject({audio: "AQID", start: 0, end: 11, mimeType: "audio/mpeg"});
  });

  it("loads English IPA transcription from pronunciation providers", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("api.datamuse.com")) {
        return new Response(JSON.stringify([{word: "testing", tags: ["pron:tɛstɪŋ"]}]), {status: 200});
      }
      if (url.includes("dictionaryapi.dev")) return new Response(JSON.stringify([]), {status: 200});
      return new Response(null, {status: 404});
    }));
    await expect(handle({type: "get-transcription", payload: {language: "en", text: "testing"}}))
      .resolves.toEqual({ok: true, transcription: "/tɛstɪŋ/"});
  });

  it("loads romanization for non-English text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([
      [["привет", null, null, "privet"]]
    ]), {status: 200})));
    await expect(handle({type: "get-transcription", payload: {language: "ru", text: "привет"}}))
      .resolves.toEqual({ok: true, transcription: "privet"});
  });

  it("detects an explicitly labelled language without a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(handle({type: "detect-language", payload: {text: "bonjour", sentence: "Французский: bonjour"}}))
      .resolves.toEqual({ok: true, sourceLanguage: "fr"});
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to MyMemory translation when Google fails", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        responseStatus: 200,
        responseData: {translatedText: "резервный перевод"},
        matches: []
      }), {status: 200}));
    vi.stubGlobal("fetch", fetchMock);
    await expect(handle({type: "translate-preview", payload: {
      text: "fallback unique phrase", sentence: "fallback unique phrase", sourceLanguage: "en", targetLanguage: "ru"
    }})).resolves.toMatchObject({ok: true, translation: "резервный перевод"});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("clients5.google.com/translate_a/t");
    expect(String(fetchMock.mock.calls[1][0])).toContain("api.mymemory.translated.net/get");
  });

  it("clears history and saves the supplied current record atomically", async () => {
    await handle({type: "restore-record", payload: {index: 0, record: {...record, text: "old"}}});
    await expect(handle({type: "clear-and-save-record", payload: {record}})).resolves.toEqual({ok: true});
    expect((await handle({type: "get-records"})).records).toEqual([record]);
  });

  it("returns readable errors for invalid payloads", async () => {
    await expect(handle({type: "translate-preview", payload: {text: ""}})).resolves.toMatchObject({ok: false});
    await expect(handle({type: "get-speech-audio", payload: {text: ""}})).resolves.toMatchObject({ok: false});
    await expect(handle({type: "delete-record", payload: {text: "missing"}})).resolves.toMatchObject({ok: false});
    await expect(handle({type: "save-record", payload: {record: {text: ""}}})).resolves.toMatchObject({ok: false});
  });
});
