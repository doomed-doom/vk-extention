const input = document.getElementById("download-folder");
const button = document.getElementById("save-folder");
const status = document.getElementById("status");

function renderFolder() {
  chrome.storage.local.get({ downloadFolder: "VK Photos" }, ({ downloadFolder }) => {
    input.value = downloadFolder;
  });
}

button.addEventListener("click", () => {
  const downloadFolder = input.value.trim() || "VK Photos";
  chrome.storage.local.set({ downloadFolder }, () => {
    if (chrome.runtime.lastError) {
      status.textContent = chrome.runtime.lastError.message;
      return;
    }
    input.value = downloadFolder;
    status.textContent = "Изменения сохранены";
  });
});

input.addEventListener("input", () => {
  status.textContent = "";
});

renderFolder();
