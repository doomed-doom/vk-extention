const button = document.getElementById("save-photos");
const zipButton = document.getElementById("save-zip");
const status = document.getElementById("status");
const summary = document.getElementById("summary");
const jobId = new URL(location.href).searchParams.get("job");
let job;
let photos = [];
let savedCount = 0;
const gallery = document.getElementById("gallery");
const selectAll = document.getElementById("select-all");
const sortOrder = document.getElementById("sort-order");
const retry = document.getElementById("retry");
let attachments = [];
let loading = false;
let busy = false;
let daySelections = [];

function photoDay(photo) {
  const date = new Date(photo.date * 1000);
  if (!photo.date || !Number.isFinite(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function selectedDay() {
  const days = new Set(photos.map(photoDay));
  return days.size === 1 ? [...days][0] : "";
}

function allowedUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)(vk\.com|vk\.ru|vkuserphoto\.ru|userapi\.com)$/.test(url.hostname);
  } catch {
    return false;
  }
}

function photoFormat(photo) {
  const format = (String(photo.filename || "").match(/\.([a-z0-9]+)$/i)?.[1]
    || new URL(photo.originalUrl || photo.previewUrl).pathname.match(/\.([a-z0-9]+)$/i)?.[1]
    || "jpg").toLowerCase();
  return /^(jpe?g|png|webp|heic|heif)$/.test(format) ? format : null;
}

function largestImage(sizes = []) {
  return [...sizes].sort((a, b) => b.width * b.height - a.width * a.height)
    .map((size) => size.url || size.src).find(allowedUrl);
}

function downloadableAttachment(item) {
  const type = item.attachment?.type;
  const data = item.attachment?.[type];
  if (!data) return null;
  let url;
  let filename;
  let previewUrl;
  if (type === "photo") {
    url = largestImage([...(data.sizes || []), data.orig_photo].filter(Boolean));
    previewUrl = largestImage((data.sizes || []).filter((size) => size.width <= 640)) || url;
    if (!allowedUrl(url)) return null;
    filename = `Фотография.${new URL(url).pathname.match(/\.([a-z0-9]+)$/i)?.[1] || "jpg"}`;
  } else if (type === "doc") {
    if (!/^(jpe?g|png|webp|heic|heif)$/i.test(data.ext || "")) return null;
    url = data.url;
    filename = data.title || `Документ.${data.ext || "bin"}`;
    if (data.ext && !filename.toLowerCase().endsWith(`.${data.ext.toLowerCase()}`)) filename += `.${data.ext}`;
    previewUrl = largestImage(data.preview?.photo?.sizes);
  } else return null;
  if (!allowedUrl(url) || !photoFormat({ filename, originalUrl: url })) return null;
  return {
    key: `${item.cmid || item.message_id}:${item.position}:${type}:${data.owner_id}:${data.id}`,
    type, filename, originalUrl: url, previewUrl: allowedUrl(previewUrl) ? previewUrl : "",
    date: Number(item.date) || 0, selected: false, saved: false,
  };
}

function updateSelection() {
  const available = attachments;
  const count = available.filter((item) => item.selected).length;
  selectAll.checked = count > 0 && count === available.length;
  selectAll.indeterminate = count > 0 && count < available.length;
  selectAll.disabled = busy || !available.length;
  sortOrder.disabled = busy;
  retry.disabled = busy;
  button.textContent = `Выбрать папку и сохранить (${count})`;
  button.disabled = busy || loading || !count || typeof window.showDirectoryPicker !== "function";
  zipButton.textContent = `Сохранить ZIP (${count})`;
  zipButton.disabled = busy || loading || !count || typeof window.showSaveFilePicker !== "function";
  for (const group of daySelections) {
    const available = group.items;
    const selected = available.filter((item) => item.selected).length;
    group.checkbox.checked = selected > 0 && selected === available.length;
    group.checkbox.indeterminate = selected > 0 && selected < available.length;
    group.checkbox.disabled = busy || !available.length;
  }
}

function renderGallery() {
  attachments.sort((a, b) => sortOrder.value === "oldest" ? a.date - b.date : b.date - a.date);
  const fragment = document.createDocumentFragment();
  const dateFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long", timeStyle: "short" });
  const dayFormat = new Intl.DateTimeFormat("ru-RU", { dateStyle: "long" });
  daySelections = [];
  let group;
  let grid;
  for (const item of attachments) {
    const day = photoDay(item);
    if (!group || group.day !== day) {
      const section = document.createElement("section");
      section.className = "photo-day";
      section.dataset.day = day;
      const header = document.createElement("div");
      header.className = "photo-day-header";
      const title = document.createElement("h2");
      const label = document.createElement("label");
      const dayCheckbox = document.createElement("input");
      dayCheckbox.type = "checkbox";
      dayCheckbox.className = "day-select";
      const dayTitle = day ? dayFormat.format(new Date(item.date * 1000)) : "Дата неизвестна";
      dayCheckbox.setAttribute("aria-label", `Выбрать все фотографии: ${dayTitle}`);
      label.append(dayCheckbox, document.createTextNode(dayTitle));
      title.append(label);
      const count = document.createElement("span");
      count.className = "day-count";
      group = { day, items: [], photoCheckboxes: [], checkbox: dayCheckbox, count };
      daySelections.push(group);
      const currentGroup = group;
      dayCheckbox.addEventListener("change", () => {
        currentGroup.items.forEach((photo) => { photo.selected = dayCheckbox.checked; });
        currentGroup.photoCheckboxes.forEach((checkbox, index) => { checkbox.checked = currentGroup.items[index].selected; });
        updateSelection();
      });
      grid = document.createElement("div");
      grid.className = "day-photos";
      header.append(title, count);
      section.append(header, grid);
      fragment.append(section);
    }
    group.items.push(item);
    group.count.textContent = `Фото: ${group.items.length}`;
    const card = document.createElement("label");
    card.className = "attachment";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    group.photoCheckboxes.push(checkbox);
    checkbox.checked = item.selected;
    checkbox.disabled = busy;
    checkbox.setAttribute("aria-label", `Выбрать: ${item.filename}`);
    checkbox.addEventListener("change", () => { item.selected = checkbox.checked; updateSelection(); });
    const preview = document.createElement(item.previewUrl ? "img" : "span");
    preview.className = "attachment-preview";
    if (item.previewUrl) {
      preview.src = item.previewUrl;
      preview.alt = "";
      preview.loading = "lazy";
      preview.addEventListener("error", () => { preview.removeAttribute("src"); }, { once: true });
    } else {
      preview.classList.add("attachment-placeholder");
      preview.textContent = "Фото";
    }
    const name = document.createElement("span");
    name.className = "attachment-name";
    name.textContent = item.filename;
    const date = document.createElement("span");
    date.className = "attachment-date";
    date.textContent = `${item.date ? dateFormat.format(new Date(item.date * 1000)) : "Дата неизвестна"}${item.saved ? " · Сохранено" : ""}`;
    card.append(checkbox, preview, name, date);
    grid.append(card);
  }
  gallery.replaceChildren(fragment);
  summary.textContent = `Чат: ${job.chat?.name || "Chat"}. Фотографий: ${attachments.length}.`;
  updateSelection();
}

async function loadAttachments() {
  if (loading || busy) return;
  loading = true;
  retry.hidden = true;
  const seen = new Set(attachments.map((item) => item.key));
  try {
    for (const mediaType of ["photo", "doc"]) {
      let startFrom = "";
      const cursors = new Set();
      do {
        status.textContent = `Загрузка фотографий из всей истории чата… Найдено: ${attachments.length}. Оставьте вкладку VK открытой.`;
        const page = await chrome.runtime.sendMessage({ type: "attachmentPage", jobId, mediaType, startFrom });
        if (page?.error) throw new Error(page.error);
        if (!Array.isArray(page?.items)) throw new Error("VK не вернул список вложений");
        for (const raw of page.items) {
          const item = downloadableAttachment(raw);
          if (item && !seen.has(item.key)) { seen.add(item.key); attachments.push(item); }
        }
        renderGallery();
        const next = page.next_from || "";
        if (next && cursors.has(next)) throw new Error("VK повторил страницу вложений. Повторите загрузку.");
        cursors.add(next);
        startFrom = next;
        // VK limits API request frequency; pace history pages instead of firing them in parallel.
        await new Promise((resolve) => setTimeout(resolve, 350));
      } while (startFrom);
    }
    status.textContent = attachments.length ? "Все фотографии загружены. Выберите фотографии для сохранения." : "В этом чате нет фотографий поддерживаемого формата.";
  } catch (error) {
    status.textContent = `Загружено: ${attachments.length}. ${error.message || String(error)}`;
    retry.hidden = false;
  } finally {
    loading = false;
    updateSelection();
  }
}

selectAll?.addEventListener("change", () => {
  attachments.forEach((item) => { item.selected = selectAll.checked; });
  renderGallery();
});
sortOrder?.addEventListener("change", renderGallery);
retry?.addEventListener("click", loadAttachments);

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
    if (!url || seen.has(url)) return false;
    if (!allowedUrl(url)) {
      throw new Error("Недопустимый адрес фотографии");
    }
    if (!photoFormat(photo)) return false;
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
  if (!allowedUrl(url)) throw new Error("Недопустимый адрес вложения");
  const format = photoFormat(photo);
  if (!format) throw new Error("Неподдерживаемый формат фотографии");

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
    const photo = photos[0];
    const { blob, extension } = await photoBlob(photo);
    const file = await directory.getFileHandle(`photo_${index}.${extension}`, { create: true });
    const writable = await file.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => {});
      throw error;
    }
    photo.saved = true;
    photo.selected = false;
    photos.shift();
    index += 1;
    savedCount += 1;
    status.textContent = `Сохранено фотографий: ${savedCount}. Осталось: ${photos.length}.`;
  }
  status.textContent = `Сохранено фотографий: ${savedCount}. Папка: ${root.name}/${chat}.`;
  button.textContent = "Фотографии сохранены";
  if (job.type !== "openAttachments") await chrome.storage.session.remove(jobId);
}

async function saveZip(file) {
  const selected = photos.slice();
  const writable = await file.createWritable();
  async function* entries() {
    for (let index = 0; index < selected.length; index++) {
      const photo = selected[index];
      const { blob, extension } = await photoBlob(photo);
      yield { name: `photo_${index + 1}.${extension}`, blob, date: photo.date ? new Date(photo.date * 1000) : new Date() };
      status.textContent = `Упаковка фотографий: ${index + 1} из ${selected.length}.`;
    }
  }
  try {
    await writeZip(writable, entries());
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  selected.forEach((photo) => { photo.saved = true; photo.selected = false; });
  photos = [];
  savedCount += selected.length;
  status.textContent = `Архив ${file.name} сохранён. Фотографий: ${selected.length}.`;
  if (job.type !== "openAttachments") await chrome.storage.session.remove(jobId);
}

async function saveSelected(asZip) {
  if (busy || loading) return;
  if (job.type === "openAttachments") photos = attachments.filter((item) => item.selected);
  if (!photos.length) return;
  savedCount = 0;
  busy = true;
  button.disabled = true;
  zipButton.disabled = true;
  if (job.type === "openAttachments") renderGallery();
  let saving = false;
  try {
    const destination = asZip
      ? await window.showSaveFilePicker({
        id: "vk-photo-zip", startIn: "pictures",
        suggestedName: `${cleanName(job.chat?.name)}_${cleanName(job.chat?.id)}${selectedDay() ? `_${selectedDay()}` : ""}.zip`,
        types: [{ description: "ZIP-архив", accept: { "application/zip": [".zip"] } }],
        excludeAcceptAllOption: true,
      })
      : await window.showDirectoryPicker({ id: "vk-photos", mode: "readwrite", startIn: "pictures" });
    saving = true;
    if (job.type === "openAttachments") renderGallery();
    status.textContent = "Сохранение фотографий… Не закрывайте эту вкладку до завершения.";
    await navigator.locks.request("vk-photo-downloads", () => asZip ? saveZip(destination) : savePhotos(destination));
  } catch (error) {
    status.textContent = !saving && error.name === "AbortError"
      ? asZip ? "Выбор файла отменён. Можно сохранить архив снова." : "Выбор папки отменён. Можно выбрать папку снова."
      : `${asZip ? "Архив не сохранён" : `Сохранено: ${savedCount}`}. Ошибка: ${error.message || String(error)}`;
  } finally {
    busy = false;
    button.disabled = !photos.length || typeof window.showDirectoryPicker !== "function";
    zipButton.disabled = !photos.length || typeof window.showSaveFilePicker !== "function";
    if (job.type === "openAttachments") renderGallery();
  }
}

button.addEventListener("click", () => saveSelected(false));
zipButton.addEventListener("click", () => saveSelected(true));

async function loadJob() {
  if (!jobId) return;
  job = (await chrome.storage.session.get(jobId))[jobId];
  if (!job) throw new Error("Задание недоступно. Выберите фотографии в VK заново.");
  if (job.type === "openAttachments") {
    document.body.classList.add("gallery-page");
    document.querySelector("h1").textContent = "Фотографии чата";
    document.title = `Фотографии — ${job.chat?.name || "VK"}`;
    document.getElementById("gallery-controls").hidden = false;
    gallery.hidden = false;
    await loadAttachments();
    return;
  }
  photos = uniquePhotos(job);
  summary.textContent = `Чат: ${job.chat?.name || "Chat"}. Фотографий: ${photos.length}.`;
  if (!photos.length) {
    status.textContent = "Не обнаружено фотографий для сохранения.";
    await chrome.storage.session.remove(jobId);
  } else {
    button.disabled = typeof window.showDirectoryPicker !== "function";
    zipButton.disabled = typeof window.showSaveFilePicker !== "function";
    if (button.disabled && zipButton.disabled) status.textContent = "Выбор места сохранения недоступен. Откройте расширение в Chromium с поддержкой File System Access API.";
  }
}

loadJob().catch((error) => { status.textContent = error.message || String(error); });
