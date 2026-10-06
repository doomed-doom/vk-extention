// Run: node test.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { randomUUID } = require("node:crypto");

(async () => {
  for (const chrome of [undefined, {}, { runtime: {} }]) {
    assert.doesNotThrow(() => vm.runInNewContext(fs.readFileSync("content.js", "utf8"), {
      chrome, window: {}, document: { createElement() { throw new Error("Page world must not create extension buttons"); } },
    }));
  }
  const storage = {};
  const tabs = [];
  let listener;
  let action;
  let installed;
  const injections = [];
  let tabError = false;
  const chrome = {
    action: { onClicked: { addListener(fn) { action = fn; } } },
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      onMessage: { addListener(fn) { listener = fn; } },
      onInstalled: { addListener(fn) { installed = fn; } },
      getManifest: () => ({ content_scripts: [{ matches: ["https://vk.ru/*"] }] }),
      async sendMessage() { return { dataUrl: "data:image/jpeg;base64,anBlZw==" }; },
    },
    storage: { session: {
      async set(items) { Object.assign(storage, items); },
      async get(id) { return { [id]: storage[id] }; },
      async remove(id) { delete storage[id]; },
    } },
    scripting: { async executeScript(options) { injections.push(options); } },
    tabs: { async query() { return [{ id: 42 }]; }, async create(tab) {
      if (tabError) throw new Error("Cannot open tab");
      tabs.push(tab);
    } },
  };
  vm.runInNewContext(fs.readFileSync("background.js", "utf8"), { chrome, crypto: { randomUUID } });
  await installed();
  assert.equal(injections[0].target.tabId, 42);
  assert.equal(injections[0].world, "ISOLATED");
  assert.equal(injections[0].files[0], "content.js");
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

  const elements = Object.fromEntries(["save-photos", "save-zip", "status", "summary", "select-all", "sort-order", "retry"].map((id) => [id, {
    disabled: true, textContent: "", addEventListener(_type, fn) { this.handler = fn; },
  }]));
  let click;
  let zipClick;
  elements["save-photos"].addEventListener = (_type, fn) => { click = fn; };
  elements["save-zip"].addEventListener = (_type, fn) => { zipClick = fn; };
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
  let failArchive = true;
  let archive = Buffer.from("existing archive");
  const archiveFile = { name: "Photos.zip", async createWritable() {
    const chunks = [];
    return {
      async write(data) {
        if (failArchive && chunks.length === 1) throw new Error("Disk full");
        chunks.push(Buffer.from(data));
      },
      async close() { archive = Buffer.concat(chunks); },
      async abort() { aborted += 1; },
    };
  } };
  const context = vm.createContext({
    chrome, URL, Blob, TextEncoder, location: { href: tabs[1].url },
    document: { getElementById: (id) => elements[id] },
    window: { async showSaveFilePicker(options) {
      assert.equal(requests, 0);
      assert.equal(options.suggestedName, "Тест_чат_42.zip");
      if (cancel) throw Object.assign(new Error("Cancelled"), { name: "AbortError" });
      return archiveFile;
    }, async showDirectoryPicker(options) {
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
  vm.runInContext(fs.readFileSync("zip.js", "utf8"), context);
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
  assert.match(elements.status.textContent, /Сохранено фотографий: 2/);
  assert.throws(() => vm.runInContext('uniquePhotos({photos: [{previewUrl: "https://evil.example/photo.jpg"}]})', context), /Недопустимый/);
  const normalize = (type, data) => vm.runInContext(`downloadableAttachment(${JSON.stringify({
    date: 1700000000, cmid: 42, position: 1, attachment: { type, [type]: data },
  })})`, context);
  const image = normalize("photo", { sizes: [
    { width: 100, height: 100, url: "https://sun.userapi.com/small.jpg" },
    { width: 1000, height: 1000, url: "https://sun.userapi.com/full.jpg" },
  ] });
  assert.equal(image.originalUrl, "https://sun.userapi.com/full.jpg");
  assert.equal(image.date, 1700000000);
  for (const ext of ["jpg", "jpeg", "png", "webp", "heic", "heif"]) {
    assert.equal(normalize("doc", { title: `photo.${ext}`, ext, url: "https://vk.ru/doc1?dl=download&no_preview=1" }).filename, `photo.${ext}`);
  }
  for (const ext of ["pdf", "gif", "mp4", "zip"]) {
    assert.equal(normalize("doc", { title: `file.${ext}`, ext, url: "https://vk.ru/doc1?dl=download&no_preview=1" }), null);
  }
  assert.equal(normalize("doc", { url: "https://evil.example/file.pdf" }), null);
  assert.equal(normalize("audio", { url: "https://audio.vkuseraudio.ru/index.m3u8" }), null);
  assert.equal(normalize("video", { download: { can_download_to_device: false }, files: { mp4_720: "https://video.okcdn.ru/720" } }), null);
  assert.equal(normalize("video", { files: { mp4_720: "https://video.okcdn.ru/720" } }), null);
  assert.equal(normalize("audio_message", { link_mp3: "https://sun.userapi.com/voice.mp3" }), null);
  vm.runInContext('photos = uniquePhotos(JSON.parse(JSON.stringify(job))).map(p => ({...p, saved: false})); savedCount = 0;', context);
  requests = 0;
  cancel = true;
  await zipClick();
  assert.equal(requests, 0);
  assert.match(elements.status.textContent, /отменён/);
  cancel = false;
  const previousAborts = aborted;
  await zipClick();
  assert.equal(archive.toString(), "existing archive");
  assert.equal(aborted, previousAborts + 1);
  assert.equal(vm.runInContext('photos.length', context), 3);
  assert.equal(vm.runInContext('photos.some(p => p.saved)', context), false);
  requests = 0;
  failArchive = false;
  await zipClick();
  assert.match(elements.status.textContent, /Архив Photos.zip сохранён.*3/);
  assert.equal(elements["save-zip"].disabled, true);
  // Independent parser and CRC validation using the system ZIP reader.
  const { spawnSync } = require("node:child_process");
  const result = spawnSync("python3", ["-c", `
import io, sys, zipfile
with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
    assert archive.testzip() is None
    assert archive.namelist() == ['photo_1.jpg', 'photo_2.jpg', 'photo_3.jpg']
    assert [archive.read(name) for name in archive.namelist()] == [b'original-jpeg', b'png-jpeg', b'heic-jpeg']
`], { input: archive, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || String(result.error || ""));
  assert.equal(vm.runInContext('photoDay({date: new Date(2026, 9, 5, 23, 59).getTime() / 1000})', context), "2026-10-05");
  assert.equal(vm.runInContext('photoDay({date: new Date(2026, 9, 6, 0, 1).getTime() / 1000})', context), "2026-10-06");
  assert.equal(vm.runInContext('photoDay({date: 0})', context), "");
  vm.runInContext(`
    job.type = 'openAttachments';
    attachments = uniquePhotos(job).map(photo => ({...photo, saved: true, selected: false}));
    renderGallery = () => updateSelection();
  `, context);
  for (let attempt = 0; attempt < 2; attempt++) {
    elements["select-all"].checked = true;
    elements["select-all"].handler();
    assert.equal(elements["save-zip"].disabled, false);
    assert.equal(vm.runInContext('attachments.every(photo => photo.selected)', context), true);
    requests = 0;
    await zipClick();
    assert.match(elements.status.textContent, /Архив Photos.zip сохранён.*3/);
    assert.equal(elements["select-all"].disabled, false);
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    vm.runInContext('attachments[0].selected = true; updateSelection();', context);
    requests = 0;
    const previousFiles = files.size;
    await click();
    assert.match(elements.status.textContent, /Сохранено фотографий: 1\./);
    assert.equal(files.size, previousFiles + 1);
  }
  console.log("OK: photo saving, ZIP, daily selection and local dates across midnight.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
