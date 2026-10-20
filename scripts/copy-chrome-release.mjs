import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync
} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = join(projectRoot, "dist", "chrome");
const releaseRoot = join(projectRoot, "release");
const destinationDirectory = join(releaseRoot, "chrome");
const temporaryDirectory = join(releaseRoot, `.chrome-${process.pid}.tmp`);
const readyFile = join(projectRoot, "dist", "extension-js", "chrome", "ready.json");

const requiredFiles = [
  "manifest.json",
  "action/index.html",
  "action/index.js",
  "options/index.html",
  "options/index.js",
  "background/service_worker.js"
];

const forbiddenPaths = [
  /^hot(?:\/|$)/,
  /(?:^|\/)dev-registry\.json$/,
  /(?:^|\/)dev-stub[^/]*\.js$/,
  /^extension-js-control\.json$/
];

function listFiles(directory, baseDirectory = directory) {
  return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
    const absolutePath = join(directory, entry.name);
    return entry.isDirectory()
      ? listFiles(absolutePath, baseDirectory)
      : [relative(baseDirectory, absolutePath).replaceAll("\\", "/")];
  });
}

function validateProductionBuild(directory) {
  if (!existsSync(directory)) {
    throw new Error(`Не найдена сборка ${relative(projectRoot, directory)}. Сначала выполните npm run build:chrome.`);
  }

  const missingFiles = requiredFiles.filter((file) => !existsSync(join(directory, file)));
  if (missingFiles.length) {
    throw new Error(`Сборка Chrome неполная. Отсутствуют: ${missingFiles.join(", ")}`);
  }

  const files = listFiles(directory);
  const developmentFiles = files.filter((file) => forbiddenPaths.some((pattern) => pattern.test(file)));
  if (developmentFiles.length) {
    throw new Error(
      `Обнаружены файлы dev-сборки: ${developmentFiles.join(", ")}. `
      + "Остановите npm run dev:chrome и повторите npm run release:chrome."
    );
  }

  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  const contentScripts = manifest.content_scripts?.flatMap((entry) => entry.js || []) || [];
  const accessibleResources = manifest.web_accessible_resources?.flatMap((entry) => entry.resources || []) || [];
  if ([...contentScripts, ...accessibleResources].some((file) => /(?:^|\/)(?:dev-stub|hot\/)/.test(file))) {
    throw new Error("manifest.json ссылается на dev/HMR-файлы. Остановите dev-сервер и повторите сборку.");
  }
}

function developmentServerIsRunning() {
  if (!existsSync(readyFile)) return false;
  try {
    const ready = JSON.parse(readFileSync(readyFile, "utf8"));
    if (ready.command !== "dev" || !Number.isInteger(ready.pid)) return false;
    process.kill(ready.pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

if (process.argv.includes("--check-dev")) {
  if (developmentServerIsRunning()) {
    console.error("Сейчас запущен npm run dev:chrome. Остановите его через Ctrl+C и повторите npm run release:chrome.");
    process.exit(1);
  }
  process.exit(0);
}

try {
  validateProductionBuild(sourceDirectory);
  mkdirSync(releaseRoot, {recursive: true});
  rmSync(temporaryDirectory, {recursive: true, force: true});
  cpSync(sourceDirectory, temporaryDirectory, {recursive: true});
  validateProductionBuild(temporaryDirectory);
  rmSync(destinationDirectory, {recursive: true, force: true});
  renameSync(temporaryDirectory, destinationDirectory);
  console.log(`Стабильная Chrome-сборка готова: ${relative(projectRoot, destinationDirectory)}`);
} catch (error) {
  rmSync(temporaryDirectory, {recursive: true, force: true});
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
