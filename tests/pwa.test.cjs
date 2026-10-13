const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const output = path.join(root, ".local-data");

async function waitFor(check, message) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function addCourse(page, title) {
  await page.locator("#add-course-button").click();
  if (!(await page.locator("#course-title").isVisible())) {
    await page.screenshot({ path: path.join(output, "pwa-modal-failure.png"), fullPage: true });
    throw new Error(JSON.stringify(await page.evaluate(() => ({
      modalClass: document.querySelector("#course-modal").className,
      display: getComputedStyle(document.querySelector("#course-modal")).display,
      dialogOpen: document.querySelector("#install-help").open,
      titleRect: document.querySelector("#course-title").getBoundingClientRect().toJSON()
    }))));
  }
  await page.locator("#course-title").fill(title);
  await page.locator("#course-note").fill("PWA verification only");
  await page.locator("#save-course-button").click();
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const testDirectory = await fs.mkdtemp(path.join(output, "verify-pwa-"));
  const server = spawn(process.execPath, ["server.js", "--host", "127.0.0.1", "--port", "0", "--data-dir", testDirectory], { cwd: root, windowsHide: true });
  let browser;
  const exited = once(server, "exit");
  try {
    let log = "";
    const origin = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Temporary server did not start")), 10000);
      server.stdout.on("data", (chunk) => {
        log += chunk.toString();
        const match = log.match(/http:\/\/127\.0\.0\.1:(\d+)/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      server.once("error", reject);
      server.stderr.on("data", (chunk) => process.stderr.write(chunk));
    });
    const readState = async () => (await fetch(`${origin}/api/state`)).json();
    const initial = await fetch(`${origin}/api/state`);
    const firstTag = initial.headers.get("etag");
    const empty = { courses: [], customCourses: [], activities: [] };
    assert.equal((await fetch(`${origin}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": firstTag }, body: JSON.stringify(empty) })).status, 200);
    assert.equal((await fetch(`${origin}/api/state`, { method: "PUT", headers: { "Content-Type": "application/json", "If-Match": firstTag }, body: JSON.stringify(empty) })).status, 412);
    for (const privatePath of ["/server.js", "/NOTES.md", "/.local-data/child-progress.json", "/scripts/generate-icons.cjs"]) {
      assert.equal((await fetch(`${origin}${privatePath}`)).status, 404);
    }

    const manifestResponse = await fetch(`${origin}/manifest.webmanifest`);
    assert.match(manifestResponse.headers.get("content-type"), /application\/manifest\+json/);
    const manifest = await manifestResponse.json();
    assert.equal(manifest.name, "积分卡");
    assert.equal(manifest.display, "standalone");
    for (const icon of [...manifest.icons, { src: "icons/apple-touch-icon.png", sizes: "180x180" }]) {
      const response = await fetch(`${origin}/${icon.src}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      const data = Buffer.from(await response.arrayBuffer());
      const size = Number(icon.sizes.split("x")[0]);
      assert.equal(data.readUInt32BE(16), size);
      assert.equal(data.readUInt32BE(20), size);
    }

    const context = await chromium.launchPersistentContext(path.join(testDirectory, "browser-profile"), { channel: "chrome", headless: true, viewport: { width: 1280, height: 850 } });
    browser = context.browser();
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => { errors.push(error.message); console.error("Browser error:", error.message); });
    page.setDefaultTimeout(10000);
    await page.goto(origin);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    const cdp = await context.newCDPSession(page);
    const installability = await cdp.send("Page.getInstallabilityErrors");
    assert.deepEqual(installability.installabilityErrors, [], "Chromium installability requirements");
    assert.equal(await page.locator("#install-app-button").isVisible(), true);
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      event.prompt = async () => {};
      event.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(event);
    });
    await page.locator("#install-app-button").click();
    await page.evaluate(() => {
      const event = new Event("appinstalled");
      window.dispatchEvent(event);
    });
    assert.equal(await page.locator("#install-app-button").isVisible(), false);
    await page.evaluate(() => document.querySelector("#install-help").close());

    await addCourse(page, "临时核验课程");
    await waitFor(async () => (await readState()).customCourses.length === 1, "Online course save");
    const courseId = (await readState()).customCourses[0].id;
    await page.locator(`[data-toggle-course="${courseId}"]`).click();
    await waitFor(async () => (await readState()).activities.length === 1, "Online check-in save");
    assert.equal(await page.locator("#total-points").textContent(), "1");

    await context.setOffline(true);
    await page.reload();
    await page.locator(`[data-edit-course="${courseId}"]`).click();
    await page.locator("#course-title").fill("离线修改课程");
    await page.locator("#save-course-button").click();
    await page.locator(`[data-toggle-course="${courseId}"]`).click();
    await page.locator(`[data-toggle-course="${courseId}"]`).click();
    await page.reload();
    assert.equal(await page.locator(".course-main strong").textContent(), "离线修改课程");
    assert.equal(await page.locator("#total-points").textContent(), "1");
    assert.match(await page.locator("#sync-status").textContent(), /待同步/);

    const secondContext = await browser.newContext();
    const secondPage = await secondContext.newPage();
    await secondPage.goto(origin);
    await secondPage.waitForSelector(`[data-toggle-course="${courseId}"]`);
    await addCourse(secondPage, "另一设备课程");
    await waitFor(async () => (await readState()).customCourses.length === 2, "Second device course save");
    const secondId = (await readState()).customCourses.find((course) => course.id !== courseId).id;
    await secondPage.locator(`[data-toggle-course="${secondId}"]`).click();
    await waitFor(async () => (await readState()).activities.length === 2, "Second device check-in save");
    await context.setOffline(false);
    await waitFor(async () => {
      const saved = await readState();
      return saved.customCourses.length === 2 && saved.customCourses.find((course) => course.id === courseId)?.title === "离线修改课程";
    }, "Offline edits merge with second device updates");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("little-progress-v2-pending") || "[]").length === 0);
    assert.equal((await readState()).activities.length, 2, "No duplicate points after replay");
    await page.waitForFunction(() => document.querySelector("#total-points").textContent === "2");

    page.once("dialog", (dialog) => dialog.accept());
    await page.locator(`[data-delete-course="${courseId}"]`).click();
    await waitFor(async () => (await readState()).activities.length === 1 && (await readState()).customCourses.length === 1, "Deletion also removes points");
    await page.waitForFunction(() => document.querySelector("#total-points").textContent === "1");

    for (const [name, width, height] of [["desktop", 1280, 850], ["phone", 390, 844], ["small-phone", 320, 640]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: path.join(output, `pwa-${name}.png`), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${name} must not overflow`);
      await page.locator("#add-course-button").click();
      assert.equal(await page.locator("#course-form").isVisible(), true);
      assert.equal(await page.locator("#course-subject").count(), 0);
      assert.equal(await page.locator("#course-time").count(), 0);
      await page.locator("#cancel-modal").click();
    }

    await page.setViewportSize({ width: 320, height: 640 });
    await context.setOffline(true);
    await page.reload();
    await page.screenshot({ path: path.join(output, "pwa-phone-offline.png"), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

    const appleContext = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" });
    const applePage = await appleContext.newPage();
    await applePage.goto(origin);
    await applePage.locator("#install-app-button").click();
    await applePage.waitForSelector("#install-help[open]");
    assert.match(await applePage.locator("#install-help-copy").textContent(), /Safari.*添加到主屏幕/);
    await appleContext.close();

    const installedContext = await browser.newContext();
    await installedContext.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
    const installedPage = await installedContext.newPage();
    await installedPage.goto(origin);
    assert.equal(await installedPage.locator("#install-app-button").isVisible(), false);
    await installedContext.close();
    const caches = await page.evaluate(async () => {
      const cache = await window.caches.open("points-card-shell-v2");
      return (await cache.keys()).map((request) => new URL(request.url).pathname);
    });
    assert.equal(caches.some((pathname) => pathname.startsWith("/api/")), false, "API responses are never cached by the service worker");
    assert.deepEqual(errors, []);
    console.log("PASS: PWA installability, PNG icons, offline reload/edit/check-in, durable queue, two-device merge, point deletion, mobile layouts and standalone install controls.");
  } finally {
    if (browser) await browser.close();
    server.kill();
    await exited;
    assert.equal(path.dirname(testDirectory), path.resolve(output));
    assert.ok(path.basename(testDirectory).startsWith("verify-pwa-"));
    await fs.rm(testDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
