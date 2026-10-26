import {vi} from "vitest";

type Listener = (...args: any[]) => any;

export const messageListeners: Listener[] = [];
export const storageListeners: Listener[] = [];
export let storageData: Record<string, any> = {};

const local = {
  get: vi.fn(async (keys?: string | string[] | Record<string, any> | null) => {
    if (keys == null) return {...storageData};
    if (typeof keys === "string") return {[keys]: storageData[keys]};
    if (Array.isArray(keys)) return Object.fromEntries(keys.map((key) => [key, storageData[key]]));
    return Object.fromEntries(Object.entries(keys).map(([key, fallback]) => [key, storageData[key] ?? fallback]));
  }),
  set: vi.fn(async (values: Record<string, any>) => {
    const changes: Record<string, {oldValue: any; newValue: any}> = {};
    Object.entries(values).forEach(([key, newValue]) => {
      changes[key] = {oldValue: storageData[key], newValue};
      storageData[key] = newValue;
    });
    storageListeners.forEach((listener) => listener(changes, "local"));
  }),
  remove: vi.fn(async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) delete storageData[key];
  }),
  clear: vi.fn(async () => { storageData = {}; })
};

export const browserMock = {
  i18n: {
    getUILanguage: vi.fn(() => "ru-RU")
  },
  storage: {
    local,
    onChanged: {addListener: vi.fn((listener: Listener) => storageListeners.push(listener))}
  },
  runtime: {
    onMessage: {addListener: vi.fn((listener: Listener) => messageListeners.push(listener))},
    sendMessage: vi.fn(async (message: any) => {
      for (const listener of messageListeners) {
        const result = listener(message, {});
        if (result !== undefined) return await result;
      }
      return undefined;
    }),
    openOptionsPage: vi.fn(async () => undefined),
    getURL: vi.fn((path: string) => `moz-extension://test/${path}`)
  },
  tabs: {create: vi.fn(async () => ({id: 1}))}
};

export function resetBrowserMock(data: Record<string, any> = {}) {
  storageData = structuredClone(data);
  messageListeners.splice(0);
  storageListeners.splice(0);
  local.get.mockClear();
  local.set.mockClear();
  local.remove.mockClear();
  local.clear.mockClear();
  browserMock.runtime.onMessage.addListener.mockClear();
  browserMock.runtime.sendMessage.mockReset();
  browserMock.runtime.sendMessage.mockImplementation(async (message: any) => {
    for (const listener of messageListeners) {
      const result = listener(message, {});
      if (result !== undefined) return await result;
    }
    return undefined;
  });
  browserMock.runtime.openOptionsPage.mockClear();
  browserMock.tabs.create.mockClear();
  browserMock.i18n.getUILanguage.mockClear();
}

export default browserMock;
