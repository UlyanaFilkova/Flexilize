import {describe, expect, it} from "vitest";
import {errorMessage, isRuntimeMessage} from "../src/types";

describe("runtime types", () => {
  it("accepts every supported message and rejects malformed values", () => {
    const types = ["translate-selection", "translate-preview", "detect-language", "get-transcription", "get-speech-audio", "get-records", "delete-record", "update-record", "restore-record", "save-record", "clear-and-save-record", "clear-records"];
    types.forEach((type) => expect(isRuntimeMessage({type})).toBe(true));
    expect(isRuntimeMessage(null)).toBe(false);
    expect(isRuntimeMessage({})).toBe(false);
    expect(isRuntimeMessage({type: "unknown"})).toBe(false);
  });

  it("returns Error messages and fallbacks", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom");
    expect(errorMessage("boom", "fallback")).toBe("fallback");
  });
});
