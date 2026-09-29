const form = document.getElementById("folder-form");
const input = document.getElementById("download-folder");
const status = document.getElementById("status");

chrome.storage.local.get({ downloadFolder: "VK Photos" }, ({ downloadFolder }) => {
  input.value = downloadFolder;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const folder = input.value.trim();
  if (!folder || /^[\\/]/.test(folder) || /^[a-z]:/i.test(folder) || folder.split(/[\\/]/).includes("..")) {
    status.textContent = "Укажи подпапку внутри Downloads.";
    return;
  }

  chrome.storage.local.set({ downloadFolder: folder }, () => {
    status.textContent = chrome.runtime.lastError?.message || "Папка сохранена.";
  });
});
