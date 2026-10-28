const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("workbench", {
  invoke: (action, input) =>
    ipcRenderer.invoke("workbench:invoke", action, input),
  onEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("workbench:event", listener);
    return () => ipcRenderer.removeListener("workbench:event", listener);
  },
});
