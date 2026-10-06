// Run: node test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");

(async () => {
  const storage = {};
  const tabs = [];
  let listener;
  let action;
  let tabError = false;
  const chrome = {
    action: { onClicked: { addListener(fn) { action = fn; } } },
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      onMessage: { addListener(fn) { listener = fn; } },
      async sendMessage() { return { dataUrl: "data:image/jpeg;base64,anBlZw==" }; },
    },
    storage: { session: {
      async set(items) { Object.assign(storage, items); },
      async get(id) { return { [id]: storage[id] }; },
      async remove(id) { delete storage[id]; },
    } },
    tabs: { async create(tab) {
      if (tabError) throw new Error("Cannot open tab");
      tabs.push(tab);
    } },
  };
  vm.runInNewContext(fs.readFileSync("background.js", "utf8"), { chrome, crypto: { randomUUID } });
  const request = (message) => new Promise((resolve) => {
    assert.equal(listener(message, {}, resolve), true);
  });
  await action();
  assert.equal(tabs[0].url, chrome.runtime.getURL("popup.html"));
  const photo = (name) => ({ previewUrl: `https://sun.userapi.com/${name}` });
  const message = { type: "downloadPhotos", chat: { name: "Тест/чат", id: "42" },
    photos: [photo("one.jpg"), photo("one.jpg"), photo("skip.gif"), photo("two.png"), photo("three.heic")] };
  assert.equal((await request(message)).opened, true);
  const jobId = new URL(tabs[1].url).searchParams.get("job");
  assert.equal(storage[jobId], message);
  tabError = true;
  assert.match((await request(message)).error, /Cannot open tab/);
  assert.equal(Object.keys(storage).length, 1);

  const elements = Object.fromEntries(["save-photos", "status", "summary"].map((id) => [id, { disabled: true, textContent: "" }]));
  let click;
  elements["save-photos"].addEventListener = (_type, fn) => { click = fn; };
  let cancel = true;
  let failWrite = true;
  let aborted = 0;
  const files = new Map([["photo_7.jpg", "existing"], ["photo_9 (1).jpeg", "existing"]]);
  const directory = {
    async *values() { for (const name of files.keys()) yield { name }; },
    async getFileHandle(name) {
      return { async createWritable() {
        let contents;
        return {
          async write(blob) {
            if (name === "photo_11.jpg" && failWrite) throw new Error("Disk full");
            contents = await blob.text();
          },
          async close() { files.set(name, contents); },
          async abort() { aborted += 1; },
        };
      } };
    },
  };
  const root = { name: "Photos", async getDirectoryHandle(name, options) {
    assert.equal(name, "Тест_чат_42");
    assert.equal(options.create, true);
    return directory;
  } };
  let requests = 0;
  const context = vm.createContext({
    chrome, URL, Blob, location: { href: tabs[1].url },
    document: { getElementById: (id) => elements[id] },
    window: { async showDirectoryPicker(options) {
      assert.equal(options.mode, "readwrite");
      assert.equal(requests, 0); // The picker must precede network requests.
      if (cancel) throw Object.assign(new Error("Cancelled"), { name: "AbortError" });
      return root;
    } },
    navigator: { locks: { async request(_name, fn) { return fn(); } } },
    async fetch(url) {
      requests += 1;
      if (url.startsWith("data:")) return { blob: async () => new Blob(["heic-jpeg"]) };
      return { ok: true, blob: async () => new Blob(["original-jpeg"]) };
    },
    async createImageBitmap() { return { width: 1, height: 1, close() {} }; },
    OffscreenCanvas: class {
      getContext() { return { fillRect() {}, drawImage() {} }; }
      async convertToBlob(options) {
        assert.equal(options.type, "image/jpeg");
        return new Blob(["png-jpeg"]);
      }
    },
  });
  vm.runInContext(fs.readFileSync("popup.js", "utf8"), context);
  await new Promise(setImmediate);
  assert.match(elements.summary.textContent, /Фотографий: 3/);
  assert.equal(elements["save-photos"].disabled, false);
  await click();
  assert.equal(requests, 0);
  assert.match(elements.status.textContent, /отменён/);
  assert.equal(elements["save-photos"].disabled, false);
  cancel = false;
  await click();
  assert.equal(files.get("photo_10.jpg"), "original-jpeg");
  assert.equal(files.has("photo_11.jpg"), false);
  assert.equal(aborted, 1);
  assert.match(elements.status.textContent, /Сохранено: 1.*Disk full/);
  assert.equal(elements["save-photos"].disabled, false);
  requests = 0;
  failWrite = false;
  await click();
  assert.equal(files.get("photo_7.jpg"), "existing");
  assert.equal(files.get("photo_9 (1).jpeg"), "existing");
  assert.equal(files.get("photo_11.jpg"), "png-jpeg");
  assert.equal(files.get("photo_12.jpg"), "heic-jpeg");
  assert.equal(files.size, 5);
  assert.equal(elements["save-photos"].disabled, true);
  assert.equal(storage[jobId], undefined);
  assert.match(elements.status.textContent, /Сохранено фотографий: 3/);
  assert.throws(() => vm.runInContext('uniquePhotos({photos: [{previewUrl: "https://evil.example/photo.jpg"}]})', context), /Недопустимый/);
  console.log("OK: tab routing, folder picker cancellation, numbering, JPEG/PNG/HEIC saving, write failure and retry.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
