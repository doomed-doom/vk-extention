const frame = document.getElementById("decoder");
const pending = new Map();
let nextId = 0;
const frameReady = new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));

function toDataUrl(bytes) {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow || event.data?.type !== "heicResult") return;
  const task = pending.get(event.data.id);
  if (!task) return;
  pending.delete(event.data.id);
  if (event.data.error) task.reject(new Error(event.data.error));
  else task.resolve(event.data.buffer);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "convertHeic") return;

  (async () => {
    const response = await fetch(message.url, { credentials: "include" });
    if (!response.ok) throw new Error(`Не удалось получить HEIC/HEIF: HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    await frameReady;

    const id = ++nextId;
    const converted = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Истекло время ожидания декодирования HEIC"));
      }, 60_000);
      pending.set(id, {
        resolve: (jpeg) => { clearTimeout(timer); resolve(jpeg); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
    });
    frame.contentWindow.postMessage({ type: "convertHeic", id, buffer }, "*", [buffer]);
    const jpeg = await converted;
    sendResponse({ dataUrl: toDataUrl(new Uint8Array(jpeg)) });
  })().catch((error) => sendResponse({ error: error.message || String(error) }));

  return true;
});
