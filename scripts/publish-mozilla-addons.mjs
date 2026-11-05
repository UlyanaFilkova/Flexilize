import {createHmac, randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {basename} from "node:path";

const packagePaths = process.argv.slice(2);
if (packagePaths.length !== 2) throw new Error("Передайте пути к одному Firefox XPI и одному архиву исходного кода.");
const [packagePath, sourcePath] = packagePaths;

const requiredEnv = ["AMO_JWT_ISSUER", "AMO_JWT_SECRET", "AMO_ADDON_GUID"];
for (const name of requiredEnv) {
  if (!process.env[name]) throw new Error(`Не задана переменная окружения ${name}.`);
}

const manifest = JSON.parse(await readFile(new URL("../src/manifest.json", import.meta.url), "utf8"));
const manifestGuid = manifest["firefox:browser_specific_settings"]?.gecko?.id;
if (manifestGuid !== process.env.AMO_ADDON_GUID) {
  throw new Error(`AMO_ADDON_GUID (${process.env.AMO_ADDON_GUID}) должен совпадать с Firefox GUID в src/manifest.json (${manifestGuid || "не задан"}).`);
}

const apiBase = "https://addons.mozilla.org/api/v5";

function createJwt() {
  const issuedAt = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({alg: "HS256", typ: "JWT"});
  const payload = encode({iss: process.env.AMO_JWT_ISSUER, jti: randomUUID(), iat: issuedAt, exp: issuedAt + 60});
  const message = `${header}.${payload}`;
  const signature = createHmac("sha256", process.env.AMO_JWT_SECRET).update(message).digest("base64url");
  return `${message}.${signature}`;
}

function authHeaders() {
  return {authorization: `JWT ${createJwt()}`};
}

async function readJson(response, label) {
  const body = await response.text();
  let parsed = {};
  if (body) {
    try {
      parsed = JSON.parse(body);
    } catch {
      if (response.ok) throw new Error(`${label}: сервер вернул ответ не в формате JSON.`);
    }
  }
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}: ${JSON.stringify(parsed).slice(0, 3000)}`);
  return parsed;
}

async function uploadPackage(path, channel) {
  const form = new FormData();
  form.append("channel", channel);
  form.append("upload", new Blob([await readFile(path)]), basename(path));
  const response = await fetch(`${apiBase}/addons/upload/`, {
    method: "POST",
    headers: authHeaders(),
    body: form
  });
  return readJson(response, "Не удалось загрузить Firefox-пакет в AMO");
}

const upload = await uploadPackage(packagePath, "listed");
if (!upload.uuid) throw new Error("AMO не вернул UUID загруженного Firefox-пакета.");

let uploadStatus = upload;
for (let attempt = 0; attempt < 120 && !uploadStatus.processed; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const response = await fetch(`${apiBase}/addons/upload/${encodeURIComponent(upload.uuid)}/`, {headers: authHeaders()});
  uploadStatus = await readJson(response, "Не удалось проверить Firefox-пакет в AMO");
}

if (!uploadStatus.processed) throw new Error("AMO не завершил проверку пакета за 10 минут.");
if (!uploadStatus.valid) throw new Error(`AMO отклонил пакет при автоматической проверке: ${JSON.stringify(uploadStatus.validation || {}).slice(0, 3000)}`);

const versionForm = new FormData();
versionForm.append("upload", upload.uuid);
versionForm.append("source", new Blob([await readFile(sourcePath)]), basename(sourcePath));
const versionResponse = await fetch(`${apiBase}/addons/addon/${encodeURIComponent(process.env.AMO_ADDON_GUID)}/versions/`, {
  method: "POST",
  headers: authHeaders(),
  body: versionForm
});
const version = await readJson(versionResponse, "Не удалось отправить новую версию Firefox-дополнения на AMO");

console.log(`AMO: версия ${version.version || uploadStatus.version || "из манифеста"} отправлена на проверку.`);
