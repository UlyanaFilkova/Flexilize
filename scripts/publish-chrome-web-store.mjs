import {readFile} from "node:fs/promises";

const packagePaths = process.argv.slice(2);
if (packagePaths.length !== 1) throw new Error("Передайте один путь к Chrome ZIP.");
const [packagePath] = packagePaths;

const requiredEnv = ["CWS_CLIENT_ID", "CWS_CLIENT_SECRET", "CWS_REFRESH_TOKEN", "CWS_PUBLISHER_ID", "CWS_EXTENSION_ID"];
for (const name of requiredEnv) {
  if (!process.env[name]) throw new Error(`Не задана переменная окружения ${name}.`);
}

async function request(url, options, label) {
  const response = await fetch(url, options);
  const body = await response.text();
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}: ${body.slice(0, 2000)}`);
  return body ? JSON.parse(body) : {};
}

const tokenResponse = await request("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: {"content-type": "application/x-www-form-urlencoded"},
  body: new URLSearchParams({
    client_id: process.env.CWS_CLIENT_ID,
    client_secret: process.env.CWS_CLIENT_SECRET,
    refresh_token: process.env.CWS_REFRESH_TOKEN,
    grant_type: "refresh_token"
  })
}, "Не удалось получить OAuth access token");

if (!tokenResponse.access_token) throw new Error("Google не вернул access token.");

const itemPath = `publishers/${encodeURIComponent(process.env.CWS_PUBLISHER_ID)}/items/${encodeURIComponent(process.env.CWS_EXTENSION_ID)}`;
const headers = {authorization: `Bearer ${tokenResponse.access_token}`};
const initialUpload = await request(`https://chromewebstore.googleapis.com/upload/v2/${itemPath}:upload`, {
  method: "POST",
  headers: {...headers, "content-type": "application/zip"},
  body: await readFile(packagePath)
}, "Не удалось загрузить Chrome ZIP");

let uploadState = initialUpload.uploadState;
if (uploadState === "IN_PROGRESS") {
  const statusUrl = `https://chromewebstore.googleapis.com/v2/${itemPath}:fetchStatus`;
  for (let attempt = 0; attempt < 60 && uploadState === "IN_PROGRESS"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    const status = await request(statusUrl, {headers}, "Не удалось проверить состояние загрузки в Chrome Web Store");
    uploadState = status.lastAsyncUploadState || status.uploadState;
  }
}

if (uploadState !== "SUCCEEDED") {
  throw new Error(`Chrome Web Store загрузка завершилась со статусом ${uploadState || "неизвестно"}.`);
}

await request(`https://chromewebstore.googleapis.com/v2/${itemPath}:publish`, {
  method: "POST",
  headers
}, "Не удалось отправить обновление в Chrome Web Store на проверку");

console.log("Chrome Web Store: обновление загружено и отправлено на проверку.");
