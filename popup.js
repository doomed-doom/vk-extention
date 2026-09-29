const button = document.getElementById("choose-folder");
const status = document.getElementById("status");
//

function renderFolder() {
  chrome.storage.local.get({ downloadFolder: "VK Photos" }, ({ downloadFolder }) => {
    button.textContent = `${downloadFolder}`;
  });
}

button.addEventListener("click", async () => {
  if (!window.showDirectoryPicker) {
    status.textContent = "Браузер не поддерживает выбор папки.";
    return;
  }

  try {
    const handle = await window.showDirectoryPicker({ startIn: "downloads" });
    chrome.storage.local.set({ downloadFolder: handle.name }, () => {
      if (chrome.runtime.lastError) {
        status.textContent = chrome.runtime.lastError.message;
        return;
      }
      renderFolder();
      status.textContent = `Выбрано: Downloads/${handle.name}`;
    });
  } catch (error) {
    if (error.name !== "AbortError") status.textContent = error.message;
  }
});

renderFolder();
