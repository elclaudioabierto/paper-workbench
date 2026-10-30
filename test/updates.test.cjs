const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createUpdates } = require("../src/updates.cjs");
test("downloads updates, requires an idle app, and installs only when explicitly requested", async () => {
  const updater = new EventEmitter();
  let installed = 0,
    busy = true;
  updater.checkForUpdates = async () => {
    updater.emit("checking-for-update");
    updater.emit("update-available", { version: "2.0.0" });
  };
  updater.quitAndInstall = () => installed++;
  const events = [];
  const updates = createUpdates({
    updater,
    supported: true,
    busy: () => busy,
    notify: (state) => events.push(state.status),
  });
  assert.equal(updater.autoInstallOnAppQuit, false);
  await updates.check();
  assert.deepEqual(events, ["checking", "downloading"]);
  assert.throws(() => updates.install(), /No downloaded update/);
  updater.emit("update-downloaded", { version: "2.0.0" });
  assert.throws(() => updates.install(), /Finish or stop/);
  busy = false;
  updates.install();
  assert.equal(installed, 1);
});
test("reports errors and unavailable platforms without crashing", async () => {
  const updater = new EventEmitter();
  updater.checkForUpdates = async () => {
    throw new Error("Network unavailable");
  };
  const updates = createUpdates({
    updater,
    supported: true,
    busy: () => false,
    notify: () => {},
  });
  assert.equal((await updates.check()).message, "Network unavailable");
  const unsupported = createUpdates({
    supported: false,
    unavailableReason: "Requires signed build",
    notify: () => {},
  });
  assert.equal((await unsupported.check()).message, "Requires signed build");
  assert.throws(() => unsupported.install(), /No downloaded update/);
});
