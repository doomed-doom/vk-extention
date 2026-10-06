const button = document.getElementById("save-photos");
const status = document.getElementById("status");
const summary = document.getElementById("summary");
const jobId = new URL(location.href).searchParams.get("job");
let job;
let photos = [];
let savedCount = 0;

function cleanName(value) {
  return String(value || "Chat")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/, "") || "Chat";
}

function uniquePhotos(message) {
  const seen = new Set();
  return (message.photos || (message.urls || []).map((previewUrl) => ({ previewUrl }))).filter((photo) => {
    const url = photo.originalUrl || photo.previewUrl;
    if (/\.gif$/i.test(String(photo.filename || "")) || /\.gif(?:$|[?#])/i.test(url || "")) return false;
    if (!url || seen.has(url)) return false;
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || !/(^|\.)(vk\.com|vk\.ru|vkuserphoto\.ru|userapi\.com)$/.test(parsed.hostname)) {
      throw new Error("Недопустимый адрес фотографии");
    }
    seen.add(url);
    return true;
  });
}

async function nextPhotoIndex(directory) {
  let max = 0;
  for await (const entry of directory.values()) {
    max = Math.max(max, Number(entry.name.match(/^photo_(\d+)(?: \(\d+\))?\./)?.[1] || 0));
  }
  return max + 1;
}

async function photoBlob(photo) {
  const url = photo.originalUrl || photo.previewUrl;
  const format = (String(photo.filename || "").match(/\.(jpe?g|png|webp|heic|heif)$/i)?.[1]
    || new URL(url).pathname.match(/\.(jpe?g|png|webp|heic|heif)$/i)?.[1]
    || "jpg").toLowerCase();

  if (["heic", "heif"].includes(format)) {
    const result = await chrome.runtime.sendMessage({ type: "prepareHeic", url });
    if (result?.error) throw new Error(result.error);
    if (!result?.dataUrl) throw new Error("Не удалось преобразовать HEIC в JPEG");
    return { blob: await (await fetch(result.dataUrl)).blob(), extension: "jpg" };
  }

  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Не удалось получить изображение: HTTP ${response.status}`);
  const blob = await response.blob();
  if (!["png", "webp"].includes(format)) return { blob, extension: format };

  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    return { blob: await canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 }), extension: "jpg" };
  } finally {
    bitmap.close();
  }
}

async function savePhotos(root) {
  const chat = `${cleanName(job.chat?.name)}_${cleanName(job.chat?.id)}`;
  const directory = await root.getDirectoryHandle(chat, { create: true });
  let index = await nextPhotoIndex(directory);
  while (photos.length) {
    const { blob, extension } = await photoBlob(photos[0]);
    const file = await directory.getFileHandle(`photo_${index}.${extension}`, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
    photos.shift();
    index += 1;
    savedCount += 1;
    status.textContent = `Сохранено фотографий: ${savedCount}. Осталось: ${photos.length}.`;
  }
  status.textContent = `Сохранено фотографий: ${savedCount}. Папка: ${root.name}/${chat}.`;
  button.textContent = "Фотографии сохранены";
  await chrome.storage.session.remove(jobId);
}

button.addEventListener("click", async () => {
  button.disabled = true;
  let saving = false;
  try {
    const directory = await window.showDirectoryPicker({ id: "vk-photos", mode: "readwrite", startIn: "pictures" });
    saving = true;
    status.textContent = "Сохранение фотографий… Не закрывайте эту вкладку до завершения.";
    await navigator.locks.request("vk-photo-downloads", () => savePhotos(directory));
  } catch (error) {
    status.textContent = !saving && error.name === "AbortError"
      ? "Выбор папки отменён. Можно выбрать папку снова."
      : `Сохранено: ${savedCount}. Ошибка: ${error.message || String(error)}`;
  } finally {
    button.disabled = !photos.length;
  }
});

async function loadJob() {
  if (!jobId) return;
  job = (await chrome.storage.session.get(jobId))[jobId];
  if (!job) throw new Error("Задание недоступно. Выберите фотографии в VK заново.");
  photos = uniquePhotos(job);
  summary.textContent = `Чат: ${job.chat?.name || "Chat"}. Фотографий: ${photos.length}.`;
  if (!photos.length) {
    status.textContent = "Не обнаружено фотографий для сохранения.";
    await chrome.storage.session.remove(jobId);
  } else if (typeof window.showDirectoryPicker !== "function") {
    status.textContent = "Выбор папки недоступен. Откройте расширение в Chromium с поддержкой File System Access API.";
  } else {
    button.disabled = false;
  }
}

loadJob().catch((error) => { status.textContent = error.message || String(error); });
