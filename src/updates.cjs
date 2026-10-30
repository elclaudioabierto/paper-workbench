function createUpdates({
  updater,
  supported,
  unavailableReason,
  busy,
  notify,
}) {
  let state = supported
    ? { status: "idle" }
    : { status: "unavailable", message: unavailableReason };
  let checking = false;
  const set = (next) => {
    state = next;
    notify(state);
  };
  if (supported) {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.on("checking-for-update", () => set({ status: "checking" }));
    updater.on("update-available", (info) =>
      set({ status: "downloading", version: info.version }),
    );
    updater.on("update-not-available", () => set({ status: "current" }));
    updater.on("update-downloaded", (info) =>
      set({ status: "ready", version: info.version }),
    );
    updater.on("error", (error) =>
      set({
        status: "error",
        message: error.message || "Unable to check for updates.",
      }),
    );
  }
  return {
    getState: () => ({ ...state }),
    async check() {
      if (
        !supported ||
        checking ||
        state.status === "ready" ||
        state.status === "downloading"
      )
        return { ...state };
      checking = true;
      try {
        await updater.checkForUpdates();
      } catch (error) {
        set({
          status: "error",
          message: error.message || "Unable to check for updates.",
        });
      } finally {
        checking = false;
      }
      return { ...state };
    },
    install() {
      if (!supported || state.status !== "ready")
        throw new Error("No downloaded update is ready to install.");
      if (busy())
        throw new Error(
          "Finish or stop the current workflow before installing the update.",
        );
      updater.quitAndInstall();
    },
  };
}
module.exports = { createUpdates };
