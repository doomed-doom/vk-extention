const chooseButton = document.getElementById("choose-folder");
const grantButton = document.getElementById("grant-access");
const folderName = document.getElementById("folder-name");
const status = document.getElementById("status");

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("vk-photo-extension", 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("settings")) {
        request.result.createObjectStore("settings");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getHandle() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("settings").objectStore("settings").get("directoryHandle");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function setHandle(handle) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction("settings", "readwrite")
      .objectStore("settings")
      .put(handle, "directoryHandle");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function updateFolder() {
  const handle = await getHandle();
  folderName.textContent = handle ? handle.name : "Папка не выбрана";
  grantButton.hidden = !handle || await handle.queryPermission({ mode: "readwrite" }) === "granted";
}

chooseButton.addEventListener("click", async () => {
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await setHandle(handle);
    await updateFolder();
    status.textContent = "Папка выбрана. Оставь эту вкладку открытой для загрузок.";
  } catch (error) {
    if (error.name !== "AbortError") status.textContent = error.message;
  }
});

grantButton.addEventListener("click", async () => {
  try {
    const handle = await getHandle();
    if (handle && await handle.requestPermission({ mode: "readwrite" }) === "granted") {
      status.textContent = "Доступ восстановлен.";
    } else {
      status.textContent = "Браузер не выдал доступ к папке.";
    }
    await updateFolder();
  } catch (error) {
    status.textContent = error.message;
  }
});

function extensionFromUrl(url) {
  try {
    return new URL(url).pathname.match(/\.(jpe?g|png|webp|gif)$/i)?.[1] || "jpg";
  } catch {
    return "jpg";
  }
}

function extensionFromName(name) {
  return String(name || "").match(/(?:\.|\b)(jpe?g|png|webp|gif)\b/i)?.[1]?.toLowerCase();
}

function photoIndex(name) {
  return Number(name.match(/^photo_(\d+)(?: \(\d+\))?\./)?.[1] || 0);
}

async function savePhotos({ photos, folder }) {
  const handle = await getHandle();
  if (!handle || await handle.queryPermission({ mode: "readwrite" }) !== "granted") {
    throw new Error("Нет доступа к папке. Нажми «Возобновить доступ» в открытой вкладке расширения.");
  }

  const directory = await handle.getDirectoryHandle(folder, { create: true });
  let maxIndex = 0;
  for await (const [name] of directory.entries()) {
    maxIndex = Math.max(maxIndex, photoIndex(name));
  }

  let count = 0;
  try {
    for (const photo of photos) {
      const url = photo.originalUrl || photo.previewUrl;
      const filename = `photo_${maxIndex + count + 1}.${extensionFromName(photo.filename) || extensionFromUrl(url)}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error(`Не удалось получить фото (${response.status}).`);

      const file = await directory.getFileHandle(filename, { create: true });
      const writable = await file.createWritable();
      await writable.write(await response.blob());
      await writable.close();
      count += 1;
    }
  } catch (error) {
    return { count, folder, error: error.message || String(error) };
  }

  return { count, folder };
}

let saveQueue = Promise.resolve();
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "savePhotosToFolder") return;

  const task = saveQueue.then(() => savePhotos(message));
  saveQueue = task.catch(() => {});
  task.then(sendResponse).catch((error) => sendResponse({ count: 0, error: error.message || String(error) }));
  return true;
});

updateFolder().catch((error) => {
  status.textContent = error.message || String(error);
});
