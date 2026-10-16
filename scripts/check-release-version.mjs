import {readFileSync} from "node:fs";

const tag = process.argv[2] || process.env.RELEASE_TAG;
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const manifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
const expectedTag = `v${packageJson.version}`;

if (!tag) {
  console.error("Укажите релизный тег, например: npm run release:check -- v1.1.0");
  process.exit(1);
}

if (manifest.version !== packageJson.version) {
  console.error(`Версии не совпадают: package.json=${packageJson.version}, manifest=${manifest.version}`);
  process.exit(1);
}

if (tag !== expectedTag) {
  console.error(`Тег ${tag} не совпадает с версией проекта ${expectedTag}`);
  process.exit(1);
}

console.log(`Версия релиза подтверждена: ${tag}`);
