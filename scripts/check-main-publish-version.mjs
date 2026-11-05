import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";

const previousSha = process.env.PREVIOUS_SHA;
if (!previousSha || /^0+$/.test(previousSha)) {
  throw new Error("Не удалось определить предыдущий commit main для проверки версии.");
}

const currentPackage = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const currentManifest = JSON.parse(readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8"));
const previousPackage = JSON.parse(execFileSync("git", ["show", `${previousSha}:package.json`], {encoding: "utf8"}));

function versionParts(version) {
  if (typeof version !== "string" || !/^\d+(?:\.\d+){1,3}$/.test(version)) {
    throw new Error(`Некорректная версия расширения: ${version}`);
  }
  return version.split(".").map(Number);
}

function compareVersions(left, right) {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

if (currentPackage.version !== currentManifest.version) {
  throw new Error(`Версии не совпадают: package.json=${currentPackage.version}, src/manifest.json=${currentManifest.version}`);
}

if (compareVersions(currentPackage.version, previousPackage.version) <= 0) {
  throw new Error(`Для публикации версия должна быть выше предыдущей: ${previousPackage.version} → ${currentPackage.version}`);
}

console.log(`Версия для публикации подтверждена: ${previousPackage.version} → ${currentPackage.version}`);
