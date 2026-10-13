(() => {
  if (window.PointsCardAndroid) return;
  const installButton = document.querySelector("#install-app-button");
  const updateButton = document.querySelector("#update-app-button");
  const helpDialog = document.querySelector("#install-help");
  const helpCopy = document.querySelector("#install-help-copy");
  const standaloneMode = window.matchMedia("(display-mode: standalone)");
  const isAppleDevice = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let installPrompt = null;
  let waitingWorker = null;
  let updating = false;

  function isInstalled() {
    return standaloneMode.matches || navigator.standalone === true;
  }

  function refreshInstallButton() {
    installButton.classList.toggle("is-hidden", isInstalled() || !window.isSecureContext);
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    refreshInstallButton();
  });

  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    installButton.classList.add("is-hidden");
    showToast("积分卡已安装");
  });

  standaloneMode.addEventListener("change", refreshInstallButton);
  installButton.addEventListener("click", async () => {
    if (installPrompt) {
      const prompt = installPrompt;
      installPrompt = null;
      await prompt.prompt();
      const choice = await prompt.userChoice;
      if (choice.outcome === "accepted") installButton.classList.add("is-hidden");
      return;
    }
    helpCopy.textContent = isAppleDevice
      ? "在 Safari 中打开积分卡，点击分享按钮，选择“添加到主屏幕”，然后点击“添加”。"
      : "在浏览器菜单中选择“安装积分卡”或“安装应用”。如果只有“添加到主屏幕”，请使用支持应用安装的浏览器打开。";
    helpDialog.showModal();
  });

  document.querySelector("#close-install-help").addEventListener("click", () => helpDialog.close());
  helpDialog.addEventListener("click", (event) => {
    if (event.target === helpDialog) {
      const rect = helpDialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) helpDialog.close();
    }
  });

  updateButton.addEventListener("click", () => {
    if (!waitingWorker) return;
    updating = true;
    updateButton.disabled = true;
    waitingWorker.postMessage({ type: "SKIP_WAITING" });
  });

  refreshInstallButton();
  if (!window.isSecureContext || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (updating) window.location.reload();
  });

  navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).then((registration) => {
    function showUpdate() {
      if (!registration.waiting || !navigator.serviceWorker.controller) return;
      waitingWorker = registration.waiting;
      updateButton.classList.remove("is-hidden");
    }
    showUpdate();
    registration.addEventListener("updatefound", () => {
      registration.installing?.addEventListener("statechange", showUpdate);
    });
    window.addEventListener("online", () => registration.update().catch(() => {}));
  }).catch((error) => {
    console.warn("无法准备离线应用", error);
    showToast("离线应用暂未就绪，请联网后重试");
  });
})();
