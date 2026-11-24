import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {act, fireEvent, screen, within} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

interface PreviewObserver {
  callback: IntersectionObserverCallback;
  target?: Element;
  disconnected: boolean;
  disconnect: ReturnType<typeof vi.fn>;
}

interface RecordedAnimation {
  element: Element;
  frames: Keyframe[];
  timing: KeyframeAnimationOptions;
  cancel: ReturnType<typeof vi.fn>;
}

const originalAnimate = Object.getOwnPropertyDescriptor(Element.prototype, "animate");

describe("interactive extension demonstrations", () => {
  afterEach(() => {
    if (originalAnimate) Object.defineProperty(Element.prototype, "animate", originalAnimate);
    else Reflect.deleteProperty(Element.prototype, "animate");
  });
  let observers: PreviewObserver[];
  let motionListeners: Set<() => void>;
  let reducedMotion: boolean;
  let animations: RecordedAnimation[];
  let storageData: Record<string, unknown>;

  beforeEach(async () => {
    vi.resetModules();
    observers = [];
    motionListeners = new Set();
    reducedMotion = false;
    animations = [];
    const preference = {
      get matches() { return reducedMotion; },
      addEventListener: (_event: string, listener: () => void) => motionListeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => motionListeners.delete(listener)
    };
    vi.stubGlobal("matchMedia", vi.fn((query: string) => query.includes("prefers-reduced-motion") ? preference : {matches: false}));
    vi.stubGlobal("IntersectionObserver", class implements PreviewObserver {
      target?: Element;
      disconnected = false;
      disconnect = vi.fn(() => { this.disconnected = true; });
      constructor(public callback: IntersectionObserverCallback) { observers.push(this); }
      observe(target: Element) { this.target = target; }
    });
    Object.defineProperty(Element.prototype, "animate", {configurable: true, value: vi.fn(function (this: Element, frames: Keyframe[], timing: KeyframeAnimationOptions) {
      const animation = {element: this, frames: frames as Keyframe[], timing: timing as KeyframeAnimationOptions, cancel: vi.fn()};
      animations.push(animation);
      return animation as unknown as Animation;
    })});
    const mock = await import("./mocks/browser");
    const {defaultSettings, SETTINGS_KEY} = await import("../src/settings");
    storageData = mock.storageData;
    storageData[SETTINGS_KEY] = structuredClone(defaultSettings);
    mock.browserMock.runtime.sendMessage.mockResolvedValue({ok: true, records: []});
    document.body.innerHTML = '<div id="root"></div>';
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    history.replaceState(null, "", "#settings");
    await import("../src/options/options");
    await screen.findByRole("heading", {name: "Настройки"});
    await userEvent.click(screen.getByRole("button", {name: /Как пользоваться/}));
  });

  function visibility(selector: string, ratio: number) {
    const target = document.querySelector(selector)!;
    const observer = observers.findLast(item => item.target === target && !item.disconnected)!;
    expect(observer, selector).toBeTruthy();
    act(() => observer.callback([{target, isIntersecting: ratio > 0, intersectionRatio: ratio} as IntersectionObserverEntry], {} as IntersectionObserver));
  }

  function advance(milliseconds: number) {
    act(() => vi.advanceTimersByTime(milliseconds));
  }

  function expectExport(kind: string) {
    expect(document.querySelector(`.visual-export-sample-${kind}`)).toBeTruthy();
    expect(document.querySelectorAll('.visual-export-formats [aria-pressed="true"]')).toHaveLength(1);
  }

  it("cycles through formats only while visible and cancels its timer on navigation", () => {
    vi.useFakeTimers();
    expectExport("anki");
    advance(10_000);
    expectExport("anki");
    visibility(".help-export-example", 0.1);
    advance(4000);
    expectExport("anki");
    visibility(".help-export-example", 0.5);
    advance(3599);
    expectExport("anki");
    advance(1);
    expectExport("table");
    for (const kind of ["document", "json", "anki"]) {
      advance(3600);
      expectExport(kind);
    }
    visibility(".help-export-example", 0);
    advance(20_000);
    expectExport("anki");
    expect(vi.getTimerCount()).toBe(0);
    visibility(".help-export-example", 0.5);
    expect(vi.getTimerCount()).toBe(1);
    fireEvent.click(screen.getByRole("button", {name: /^Все настройки$/}));
    expect(vi.getTimerCount()).toBe(0);
    expect(observers.filter(item => item.target?.classList.contains("help-export-example")).every(item => item.disconnected)).toBe(true);
  });

  it("restarts the reading interval after manual selection without changing saved settings", () => {
    vi.useFakeTimers();
    const saved = structuredClone(storageData);
    visibility(".help-export-example", 0.5);
    advance(3500);
    const buttons = within(document.querySelector(".visual-export-formats") as HTMLElement).getAllByRole("button");
    fireEvent.click(buttons[3]);
    expectExport("json");
    advance(200);
    expectExport("json");
    advance(3399);
    expectExport("json");
    advance(1);
    expectExport("anki");

    // Clicking an already selected format also gives the reader a full interval.
    advance(3500);
    fireEvent.click(buttons[0]);
    advance(200);
    expectExport("anki");
    advance(3400);
    expectExport("table");
    expect(storageData).toEqual(saved);
    visibility(".help-export-example", 0);
  });

  it("supports keyboard selection and keeps focus on the chosen format", async () => {
    const buttons = within(document.querySelector(".visual-export-formats") as HTMLElement).getAllByRole("button");
    buttons[2].focus();
    await userEvent.keyboard(" ");
    expectExport("document");
    expect(document.activeElement).toBe(buttons[2]);
    await userEvent.tab();
    expect(document.activeElement).toBe(buttons[3]);
    await userEvent.keyboard("{Enter}");
    expectExport("json");
    expect(document.activeElement).toBe(buttons[3]);
  });

  it("stops automatic playback when reduced motion changes and preserves manual format selection", () => {
    vi.useFakeTimers();
    visibility(".help-export-example", 0.5);
    advance(3600);
    expectExport("table");
    act(() => {
      reducedMotion = true;
      [...motionListeners].forEach(listener => listener());
    });
    expect(document.querySelector(".help-export-example")?.classList.contains("help-demo-playing")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(document.querySelectorAll(".visual-export-formats button")[3]);
    expectExport("json");
    advance(20_000);
    expectExport("json");
    act(() => {
      reducedMotion = false;
      [...motionListeners].forEach(listener => listener());
    });
    advance(4000);
    expectExport("json");
    visibility(".help-export-example", 0.5);
    advance(3600);
    expectExport("anki");
    visibility(".help-export-example", 0);
  });

  it("highlights words sequentially with the progress slider and cancels playback outside the viewport", () => {
    expect(animations).toHaveLength(0);
    visibility(".help-long-speech-example", 0.5);
    const words = animations.filter(animation => animation.element.matches(".visual-long-speech-text > span"));
    expect(words.length).toBeGreaterThan(10);
    const spans = document.querySelectorAll(".visual-long-speech-text > span");
    expect(words.map(animation => animation.element.textContent).join("")).toBe([...spans].map(span => span.textContent).join(""));
    const starts = words.map(animation => animation.frames.filter(frame => frame.backgroundSize === "0% 100%").at(-1)!.offset!);
    const ends = words.map(animation => animation.frames.find(frame => frame.backgroundSize === "100% 100%")!.offset!);
    expect(starts[0]).toBeGreaterThan(0);
    expect(ends.at(-1)).toBeLessThan(1);
    for (let index = 0; index < words.length; index++) {
      expect(starts[index]).toBeLessThan(ends[index]);
      if (index) expect(starts[index]).toBeCloseTo(ends[index - 1]);
    }
    for (const selector of [".visual-long-speech-track > span", ".visual-long-speech-track > i"]) {
      const progress = animations.find(animation => animation.element.matches(selector))!;
      expect(progress.timing.duration).toBe(words[0].timing.duration);
      expect(progress.frames[1].offset).toBe(starts[0]);
      expect(progress.frames[2].offset).toBe(ends.at(-1));
    }
    const firstPlayback = [...animations];
    visibility(".help-long-speech-example", 0);
    expect(firstPlayback.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true);
    visibility(".help-long-speech-example", 0.5);
    const secondPlayback = animations.slice(firstPlayback.length);
    expect(secondPlayback.length).toBe(firstPlayback.length);
    act(() => {
      reducedMotion = true;
      [...motionListeners].forEach(listener => listener());
    });
    expect(secondPlayback.every(animation => animation.cancel.mock.calls.length === 1)).toBe(true);
  });
});
