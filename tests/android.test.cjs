const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const localDirectory = path.join(root, ".local-data");

async function main() {
  const directory = await fs.mkdtemp(path.join(localDirectory, "verify-android-"));
  const server = spawn(process.execPath, ["server.js", "--port", "0", "--data-dir", directory], { cwd: root, windowsHide: true });
  const exited = once(server, "exit");
  let browser;
  try {
    const origin = await new Promise((resolve, reject) => {
      let log = "";
      const timer = setTimeout(() => reject(new Error("Temporary server did not start")), 10000);
      server.stdout.on("data", (chunk) => {
        log += chunk.toString();
        const match = log.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      server.once("error", reject);
    });
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const context = await browser.newContext({ viewport: { width: 320, height: 640 } });
    await context.addInitScript(() => {
      window.testServerUrl = "";
      window.testSettingsOpened = false;
      window.PointsCardAndroid = {
        getServerUrl: () => window.testServerUrl,
        showSettings: () => { window.testSettingsOpened = true; },
        requestState: (id, method, body, etag) => {
          fetch("/api/state", {
            method,
            headers: { "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) },
            ...(method === "PUT" ? { body } : {})
          }).then(async (response) => {
            window.dispatchEvent(new CustomEvent("android-state-response", { detail: {
              id, status: response.status, body: await response.text(), headers: { ETag: response.headers.get("ETag") }
            } }));
          }).catch(() => window.dispatchEvent(new CustomEvent("android-state-response", { detail: { id, error: "offline" } })));
        }
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin);
    assert.equal(await page.locator("#android-sync-button").isVisible(), true);
    assert.equal(await page.locator("#install-app-button").isVisible(), false);
    assert.equal(await page.locator("#sync-status").isVisible(), false);
    await page.locator("#android-sync-button").click();
    assert.equal(await page.evaluate(() => window.testSettingsOpened), true);
    await page.locator("#add-course-button").click();
    await page.locator("#course-title").fill("Android 本机核验");
    await page.locator("#save-course-button").click();
    await page.locator("[data-toggle-course]").click();
    assert.equal(await page.locator("#total-points").textContent(), "1");
    assert.equal(await (await fetch(`${origin}/api/state`)).json(), null, "Standalone mode must not write shared data");
    await page.reload();
    assert.equal(await page.locator("#total-points").textContent(), "1");
    assert.equal(await page.locator(".course-main strong").textContent(), "Android 本机核验");

    const date = await page.evaluate(() => new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0"));
    const desktopState = { courses: [], customCourses: [{ id: "desktop-course", title: "电脑课程", date, note: "", completed: false, points: 1 }], activities: [] };
    await fetch(`${origin}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(desktopState) });
    await page.evaluate((url) => { window.testServerUrl = url; window.dispatchEvent(new Event("android-sync-config-changed")); }, origin);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("little-progress-v2-pending")).length === 0);
    const merged = await (await fetch(`${origin}/api/state`)).json();
    assert.equal(merged.customCourses.length, 2);
    assert.equal(merged.activities.length, 1);
    assert.equal(await page.locator(".course-row").count(), 2);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: path.join(localDirectory, "android-shell-phone.png"), fullPage: true });

    await context.setOffline(true);
    await page.locator("[data-edit-course]").first().click();
    await page.locator("#course-note").fill("离线内容");
    await page.locator("#save-course-button").click();
    assert.match(await page.locator("#sync-status").textContent(), /待同步/);
    await context.setOffline(false);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("little-progress-v2-pending")).length === 0);
    assert.equal((await (await fetch(`${origin}/api/state`)).json()).customCourses[0].note, "离线内容");
    assert.deepEqual(errors, []);
    console.log("PASS: Android bridge, standalone persistence, optional shared sync, offline recovery, native install controls and 320px layout.");
  } finally {
    if (browser) await browser.close();
    server.kill();
    await exited;
    assert.equal(path.dirname(directory), path.resolve(localDirectory));
    assert.ok(path.basename(directory).startsWith("verify-android-"));
    await fs.rm(directory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
