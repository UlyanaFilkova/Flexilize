import {existsSync} from "node:fs"

const systemChrome = process.env.CHROME_BIN
  || (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : undefined)

/** @type {import('extension').FileConfig} */
export default {
  browser: {
    chrome: {
      startingUrl: "https://en.wikipedia.org/wiki/Main_Page"
    },
    firefox: {
      startingUrl: "https://en.wikipedia.org/wiki/Main_Page"
    }
  },
  commands: {
    dev: {
      chromiumBinary: systemChrome,
      excludeBrowserFlags: [
        "--mute-audio",
        "--disable-component-extensions-with-background-pages",
        "--disable-background-networking",
        "--disable-component-update"
      ]
    },
    preview: {
      chromiumBinary: systemChrome,
      excludeBrowserFlags: [
        "--mute-audio",
        "--disable-component-extensions-with-background-pages",
        "--disable-background-networking",
        "--disable-component-update"
      ]
    }
  }
}
