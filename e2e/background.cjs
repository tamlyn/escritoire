// Loaded into the main process before the app, so tests never take over the desktop.
const { app, BrowserWindow, Notification } = require('electron')

if (process.platform === 'darwin') app.setActivationPolicy('accessory')
BrowserWindow.prototype.show = function () {}
BrowserWindow.prototype.focus = function () {}

// Kept rather than shown, so tests can read them and click them.
globalThis.e2eNotifications = []
Notification.prototype.show = function () {
  globalThis.e2eNotifications.push(this)
}
