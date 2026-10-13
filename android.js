(() => {
  if (!window.PointsCardAndroid) return;
  const pendingRequests = new Map();
  const settingsButton = document.querySelector("#android-sync-button");
  settingsButton.classList.remove("is-hidden");
  settingsButton.addEventListener("click", () => window.PointsCardAndroid.showSettings());

  window.pointsCardNative = {
    hasSyncServer: () => Boolean(window.PointsCardAndroid.getServerUrl()),
    requestState: (options = {}) => new Promise((resolve, reject) => {
      const id = crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
      const abort = () => {
        pendingRequests.delete(id);
        reject(new DOMException("Request aborted", "AbortError"));
      };
      if (options.signal?.aborted) return abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      pendingRequests.set(id, {
        resolve, reject,
        cleanup: () => options.signal?.removeEventListener("abort", abort)
      });
      try {
        window.PointsCardAndroid.requestState(id, options.method || "GET", options.body || "", options.headers?.["If-Match"] || "");
      } catch (error) {
        pendingRequests.delete(id);
        options.signal?.removeEventListener("abort", abort);
        reject(error);
      }
    })
  };

  window.addEventListener("android-state-response", (event) => {
    const data = event.detail;
    const request = pendingRequests.get(data.id);
    if (!request) return;
    pendingRequests.delete(data.id);
    request.cleanup();
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(new Response(data.body, { status: data.status, headers: data.headers }));
  });
})();
