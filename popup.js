const button = document.getElementById("choose-folder");

button.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
