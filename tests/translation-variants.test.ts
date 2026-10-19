import {describe, expect, it} from "vitest";
import {areRussianInflectionVariants, uniqueTranslationForms} from "../src/translation-variants";

describe("translation variants", () => {
  it.each([
    ["кот", "Кот", true],
    ["машина", "машины", true],
    ["синий", "синего", true],
    ["ёж", "ежа", false],
    ["дом", "работа", false],
    ["go", "going", false],
    ["", "", false],
    ["два слова", "два слова", true]
  ])("compares %s and %s", (left, right, expected) => {
    expect(areRussianInflectionVariants(left, right)).toBe(expected);
  });

  it("removes blanks, duplicates and Russian inflection duplicates while preserving order", () => {
    expect(uniqueTranslationForms([" Привет ", "", "привет", "машина", "машины", "авто", "авто  "]))
      .toEqual(["Привет", "машина", "авто"]);
  });
});
