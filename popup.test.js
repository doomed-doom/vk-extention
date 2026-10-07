const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

async function main() {
  for (const checked of [true, false]) {
    const elements = new Map();
    const document = {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { addEventListener() {}, checked });
        return elements.get(id);
      },
    };
    const folders = [];
    const files = [];
    const writes = [];
    const directory = {
      async *values() { yield { name: "photo_7.jpg" }; },
      async getFileHandle(name, options) {
        assert.equal(options.create, true);
        files.push(name);
        return { async createWritable() {
          return { async write(blob) { writes.push(blob); }, async close() {} };
        } };
      },
    };
    const root = {
      ...directory, name: "Pictures",
      async getDirectoryHandle(name, options) {
        assert.equal(options.create, true);
        folders.push(name);
        return directory;
      },
    };
    const context = vm.createContext({
      document, URL, location: { href: "https://example.test/popup.html" },
      chrome: { storage: { session: { async remove() {} } } },
      window: { async showDirectoryPicker() {
        assert.equal(elements.get("chat-subfolder").disabled, true);
        return root;
      } },
      navigator: { locks: { async request(name, callback) { return callback(); } } },
      async fetch() { return { ok: true, async blob() { return "image"; } }; },
    });
    vm.runInContext(fs.readFileSync(`${__dirname}/popup.js`, "utf8"), context);
    vm.runInContext('job = { chat: { name: "A/B", id: 42 } }; photos = [{ originalUrl: "https://vk.com/photo.jpg" }];', context);
    await vm.runInContext("saveSelected(false)", context);
    assert.deepEqual(folders, checked ? ["A_B_42"] : []);
    assert.deepEqual(files, ["photo_8.jpg"]);
    assert.deepEqual(writes, ["image"]);
    assert.equal(elements.get("status").textContent,
      `Сохранено фотографий: 1. Папка: Pictures${checked ? "/A_B_42" : ""}.`);
    assert.equal(elements.get("chat-subfolder").disabled, false);
    context.window.showDirectoryPicker = async () => { throw { name: "AbortError" }; };
    vm.runInContext('photos = [{ originalUrl: "https://vk.com/photo.jpg" }];', context);
    await vm.runInContext("saveSelected(false)", context);
    assert.equal(elements.get("chat-subfolder").disabled, false);
    assert.match(elements.get("status").textContent, /Выбор папки отменён/);
  }
  console.log("Photo saving checks passed (with/without chat subfolder, picker cancellation).");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
