function cleanName(value) {
  return String(value || "Chat")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "Chat";
}

function chatFolder(chat) {
  return `${cleanName(chat?.name)}_${cleanName(chat?.id)}`;
}

function downloadFolder(value) {
  const segments = String(value || "VK Photos")
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..");
  return segments.map(cleanName).join("/") || "VK Photos";
}

function photoIndex(name) {
  return Number(name.match(/^photo_(\d+)(?: \(\d+\))?\./)?.[1] || 0);
}

async function nextDownloadIndex(folder, chat) {
  const items = await chrome.downloads.search({});
  const prefix = `/${folder}/${chat}/`;
  return items.reduce((max, item) => {
    const path = String(item.filename || "").replace(/\\/g, "/");
    if (path.includes(prefix) && (item.exists !== false || item.state === "in_progress")) {
      max = Math.max(max, photoIndex(path.split("/").pop()));
    }
    return max;
  }, 0) + 1;
}

function downloadPhoto(url, path) {
  return chrome.downloads.download({
    url,
    filename: path,
    conflictAction: "uniquify",
    saveAs: false,
  });
}

async function pngAsJpegUrl(url) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Не удалось получить PNG: HTTP ${response.status}`);

  const bitmap = await createImageBitmap(await response.blob());
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 })).arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

async function startDownloads(message) {
  const photos = message.photos || (message.urls || []).map((url) => ({ previewUrl: url }));
  const seen = new Set();
  const uniquePhotos = photos.filter((photo) => {
    const url = photo.originalUrl || photo.previewUrl;
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });

  if (!uniquePhotos.length) return { count: 0 };

  const chat = chatFolder(message.chat);
  const folder = downloadFolder((await chrome.storage.local.get({ downloadFolder: "VK Photos" })).downloadFolder);
  const startIndex = await nextDownloadIndex(folder, chat);
  let count = 0;

  try {
    for (const [index, photo] of uniquePhotos.entries()) {
      const url = photo.originalUrl || photo.previewUrl;
      const sourceExtension = String(photo.filename || "").match(/\.(jpe?g|png|webp|gif)$/i)?.[1]
        || new URL(url).pathname.match(/\.(jpe?g|png|webp|gif)$/i)?.[1]
        || "jpg";
      const isPng = sourceExtension.toLowerCase() === "png";
      const downloadUrl = isPng ? await pngAsJpegUrl(url) : url;
      const extension = isPng ? "jpg" : sourceExtension;
      await downloadPhoto(downloadUrl, `${folder}/${chat}/photo_${startIndex + index}.${extension}`);
      count += 1;
    }
  } catch (error) {
    return { count, folder: `${folder}/${chat}`, error: error.message || String(error) };
  }

  return { count, folder: `${folder}/${chat}` };
}

let downloadQueue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "downloadPhotos") return;

  const task = downloadQueue.then(() => startDownloads(message));
  downloadQueue = task.catch(() => {});
  task.then(sendResponse).catch((error) => sendResponse({ count: 0, error: error.message || String(error) }));

  return true;
});
