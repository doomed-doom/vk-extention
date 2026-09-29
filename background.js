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
      const extension = String(photo.filename || "").match(/\.(jpe?g|png|webp|gif)$/i)?.[1]
        || new URL(url).pathname.match(/\.(jpe?g|png|webp|gif)$/i)?.[1]
        || "jpg";
      await downloadPhoto(url, `${folder}/${chat}/photo_${startIndex + index}.${extension}`);
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
