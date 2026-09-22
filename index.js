// Arquivo: index.js

const { app, BrowserWindow, ipcMain, Menu, shell } = require('electron')
const remoteMain = require('@electron/remote/main')

// Requirements
let autoUpdater = null
let ejse = null
const fs                                  = require('fs-extra')
const path                                = require('path')
const semver                              = require('semver')
const { pathToFileURL }                   = require('url')
const { AZURE_CLIENT_ID, MSFT_OPCODE, MSFT_REPLY_TYPE, MSFT_ERROR, SHELL_OPCODE } = require('./app/assets/js/ipcconstants')
const LangLoader                        = require('./app/assets/js/langloader')

const LOG_SESSION_ID = new Date().toISOString().replace(/[:.]/g, '-')
let logDirectory = null

function resolveLogDirectory(){
    if(logDirectory == null){
        logDirectory = path.join(app.getPath('userData'), 'logs')
        fs.ensureDirSync(logDirectory)
    }
    return logDirectory
}

function serializePayload(payload){
    if(payload instanceof Error){
        return {
            message: payload.message,
            stack: payload.stack,
            code: payload.code
        }
    }
    return payload
}

function appendLog(scope, message, payload = null){
    try {
        const line = JSON.stringify({
            ts: new Date().toISOString(),
            scope,
            message,
            payload: serializePayload(payload)
        })
        const filePath = path.join(resolveLogDirectory(), `${scope}-${LOG_SESSION_ID}.log`)
        fs.appendFileSync(filePath, `${line}\n`, { encoding: 'utf-8' })
    } catch (err) {
        console.error('Failed to append launcher log.', err)
    }
}

// Setup Lang
LangLoader.setupLanguage()

// Setup auto updater.
function getAutoUpdater() {
    if(autoUpdater == null) {
        autoUpdater = require('electron-updater').autoUpdater
    }
    return autoUpdater
}

function getEjse() {
    if(ejse == null) {
        ejse = require('ejs-electron')
        // If loaded after app is ready, force protocol interception now.
        if(app != null && typeof app.isReady === 'function' && app.isReady() && !ejse.listening()) {
            ejse.listen()
        }
    }
    return ejse
}

let autoUpdaterInitialized = false

function sendAutoUpdateNotification(arg, info = null){
    if(win != null && !win.isDestroyed()){
        win.webContents.send('autoUpdateNotification', arg, info)
    }
}

function initAutoUpdater(event, data) {
    const updater = getAutoUpdater()

    const preRelComp = semver.prerelease(app.getVersion())
    updater.allowPrerelease = preRelComp != null && preRelComp.length > 0 ? true : !!data

    if(autoUpdaterInitialized) {
        appendLog('update', 'Auto updater already initialized.')
        return
    }
    autoUpdaterInitialized = true
    
    // Dedicated updater logger file managed by electron-log.
    updater.logger = require('electron-log').create('updater')
    updater.logger.transports.file.level = 'info'
    updater.logger.info('=== CONFIGURANDO AUTO-UPDATER ===')
    updater.logger.info('Platform:', process.platform)
    updater.logger.info('App Version:', app.getVersion())
    updater.logger.info('Allow Prerelease:', updater.allowPrerelease)
    
    // Explicit GitHub feed to avoid repository mismatch.
    updater.setFeedURL({
        provider: 'github',
        owner: 'XKaienX',
        repo: 'CelestysLauncher'
    })

    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.allowDowngrade = false

    appendLog('update', 'Auto updater initialized.', {
        version: app.getVersion(),
        platform: process.platform,
        allowPrerelease: updater.allowPrerelease
    })
    
    updater.on('checking-for-update', () => {
        appendLog('update', 'checking-for-update')
        sendAutoUpdateNotification('checking-for-update')
    })
    
    updater.on('update-available', (info) => {
        appendLog('update', 'update-available', info)
        sendAutoUpdateNotification('update-available', info)
    })
    
    updater.on('update-not-available', (info) => {
        appendLog('update', 'update-not-available', info)
        sendAutoUpdateNotification('update-not-available', info)
    })
    
    updater.on('download-progress', (progressObj) => {
        appendLog('update', 'download-progress', {
            percent: progressObj.percent,
            transferred: progressObj.transferred,
            total: progressObj.total,
            bytesPerSecond: progressObj.bytesPerSecond
        })
        sendAutoUpdateNotification('download-progress', progressObj)
    })
    
    updater.on('update-downloaded', (info) => {
        appendLog('update', 'update-downloaded', info)
        sendAutoUpdateNotification('update-downloaded', info)
    })
    
    updater.on('error', (err) => {
        appendLog('update', 'error', err)
        sendAutoUpdateNotification('realerror', serializePayload(err))
    })
}

// Open channel to listen for update actions.
ipcMain.on('autoUpdateAction', (event, arg, data) => {
    switch(arg){
        case 'initAutoUpdater':
            appendLog('update', 'Initializing auto updater from renderer.')
            initAutoUpdater(event, data)
            sendAutoUpdateNotification('ready')
            break
        case 'checkForUpdate':
            if(!autoUpdaterInitialized){
                initAutoUpdater(event, data)
            }
            getAutoUpdater().checkForUpdates()
                .catch(err => {
                    appendLog('update', 'checkForUpdates failed', err)
                    sendAutoUpdateNotification('realerror', serializePayload(err))
                })
            break
        case 'allowPrereleaseChange':
            if(!data){
                const preRelComp = semver.prerelease(app.getVersion())
                if(preRelComp != null && preRelComp.length > 0){
                    getAutoUpdater().allowPrerelease = true
                } else {
                    getAutoUpdater().allowPrerelease = data
                }
            } else {
                getAutoUpdater().allowPrerelease = data
            }
            break
        case 'installUpdateNow':
            appendLog('update', 'Applying downloaded update.')
            getAutoUpdater().quitAndInstall(false, true)
            break
        default:
            appendLog('main', 'Unknown autoUpdateAction argument', { arg })
            break
    }
})

// Redirect distribution index event from preloader to renderer.
ipcMain.on('distributionIndexDone', (event, res) => {
    event.sender.send('distributionIndexDone', res)
})

// Handle trash item.
ipcMain.handle(SHELL_OPCODE.TRASH_ITEM, async (event, ...args) => {
    try {
        await shell.trashItem(args[0])
        return {
            result: true
        }
    } catch(error) {
        return {
            result: false,
            error: error
        }
    }
})

// Disable hardware acceleration.
// https://electronjs.org/docs/tutorial/offscreen-rendering
app.disableHardwareAcceleration()


const REDIRECT_URI_PREFIX = 'https://login.microsoftonline.com/common/oauth2/nativeclient?'

// Microsoft Auth Login
let msftAuthWindow
let msftAuthSuccess
let msftAuthViewSuccess
let msftAuthViewOnClose
ipcMain.on(MSFT_OPCODE.OPEN_LOGIN, (ipcEvent, ...arguments_) => {
    if (msftAuthWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN, msftAuthViewOnClose)
        return
    }
    msftAuthSuccess = false
    msftAuthViewSuccess = arguments_[0]
    msftAuthViewOnClose = arguments_[1]
    msftAuthWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLoginTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true
    })

    msftAuthWindow.on('closed', () => {
        msftAuthWindow = undefined
    })

    msftAuthWindow.on('close', () => {
        if(!msftAuthSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED, msftAuthViewOnClose)
        }
    })

    msftAuthWindow.webContents.on('did-navigate', (_, uri) => {
        if (uri.startsWith(REDIRECT_URI_PREFIX)) {
            let queries = uri.substring(REDIRECT_URI_PREFIX.length).split('#', 1).toString().split('&')
            let queryMap = {}

            queries.forEach(query => {
                const [name, value] = query.split('=')
                queryMap[name] = decodeURI(value)
            })

            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGIN, MSFT_REPLY_TYPE.SUCCESS, queryMap, msftAuthViewSuccess)

            msftAuthSuccess = true
            msftAuthWindow.close()
            msftAuthWindow = null
        }
    })

    msftAuthWindow.removeMenu()
    msftAuthWindow.loadURL(`https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize?prompt=select_account&client_id=${AZURE_CLIENT_ID}&response_type=code&scope=XboxLive.signin%20offline_access&redirect_uri=https://login.microsoftonline.com/common/oauth2/nativeclient`)
})

// Microsoft Auth Logout
let msftLogoutWindow
let msftLogoutSuccess
let msftLogoutSuccessSent
ipcMain.on(MSFT_OPCODE.OPEN_LOGOUT, (ipcEvent, uuid, isLastAccount) => {
    if (msftLogoutWindow) {
        ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.ALREADY_OPEN)
        return
    }

    msftLogoutSuccess = false
    msftLogoutSuccessSent = false
    msftLogoutWindow = new BrowserWindow({
        title: LangLoader.queryJS('index.microsoftLogoutTitle'),
        backgroundColor: '#222222',
        width: 520,
        height: 600,
        frame: true
    })

    msftLogoutWindow.on('closed', () => {
        msftLogoutWindow = undefined
    })

    msftLogoutWindow.on('close', () => {
        if(!msftLogoutSuccess) {
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.ERROR, MSFT_ERROR.NOT_FINISHED)
        } else if(!msftLogoutSuccessSent) {
            msftLogoutSuccessSent = true
            ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
        }
    })
    
    msftLogoutWindow.webContents.on('did-navigate', (_, uri) => {
        if(uri.startsWith('https://login.microsoftonline.com/common/oauth2/v2.0/logoutsession')) {
            msftLogoutSuccess = true
            setTimeout(() => {
                if(!msftLogoutSuccessSent) {
                    msftLogoutSuccessSent = true
                    ipcEvent.reply(MSFT_OPCODE.REPLY_LOGOUT, MSFT_REPLY_TYPE.SUCCESS, uuid, isLastAccount)
                }

                if(msftLogoutWindow) {
                    msftLogoutWindow.close()
                    msftLogoutWindow = null
                }
            }, 5000)
        }
    })
    
    msftLogoutWindow.removeMenu()
    msftLogoutWindow.loadURL('https://login.microsoftonline.com/common/oauth2/v2.0/logout')
})

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win

function createWindow() {
    const ejsElectron = getEjse()

    win = new BrowserWindow({
        width: 1280,
        height: 720,
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, 'app', 'assets', 'js', 'preloader.js'),
            nodeIntegration: true,
            contextIsolation: false
        },
        backgroundColor: '#171614'
    })
    remoteMain.enable(win.webContents)

    // Keep navigation constrained to local app files.
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url)
        return { action: 'deny' }
    })

    win.webContents.on('will-navigate', (event, targetURL) => {
        if(!targetURL.startsWith('file:')){
            event.preventDefault()
            shell.openExternal(targetURL)
        }
    })

    const data = {
        bkid: 0,
        lang: (str, placeHolders) => LangLoader.queryEJS(str, placeHolders)
    }
    Object.entries(data).forEach(([key, val]) => ejsElectron.data(key, val))

    win.loadURL(pathToFileURL(path.join(__dirname, 'app', 'app.ejs')).toString())

    /*win.once('ready-to-show', () => {
        win.show()
    })*/

    win.removeMenu()

    win.resizable = true

    win.on('closed', () => {
        win = null
    })
}

function createMenu() {
    
    if(process.platform === 'darwin') {

        // Extend default included application menu to continue support for quit keyboard shortcut
        let applicationSubMenu = {
            label: 'Application',
            submenu: [{
                label: 'About Application',
                selector: 'orderFrontStandardAboutPanel:'
            }, {
                type: 'separator'
            }, {
                label: 'Quit',
                accelerator: 'Command+Q',
                click: () => {
                    app.quit()
                }
            }]
        }

        // New edit menu adds support for text-editing keyboard shortcuts
        let editSubMenu = {
            label: 'Edit',
            submenu: [{
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                selector: 'undo:'
            }, {
                label: 'Redo',
                accelerator: 'Shift+CmdOrCtrl+Z',
                selector: 'redo:'
            }, {
                type: 'separator'
            }, {
                label: 'Cut',
                accelerator: 'CmdOrCtrl+X',
                selector: 'cut:'
            }, {
                label: 'Copy',
                accelerator: 'CmdOrCtrl+C',
                selector: 'copy:'
            }, {
                label: 'Paste',
                accelerator: 'CmdOrCtrl+V',
                selector: 'paste:'
            }, {
                label: 'Select All',
                accelerator: 'CmdOrCtrl+A',
                selector: 'selectAll:'
            }]
        }

        // Bundle submenus into a single template and build a menu object with it
        let menuTemplate = [applicationSubMenu, editSubMenu]
        let menuObject = Menu.buildFromTemplate(menuTemplate)

        // Assign it to the application
        Menu.setApplicationMenu(menuObject)

    }

}

process.on('uncaughtException', (error) => {
    appendLog('main', 'uncaughtException', error)
})

process.on('unhandledRejection', (reason) => {
    appendLog('main', 'unhandledRejection', reason)
})

app.on('ready', () => {
    appendLog('main', 'App ready.', { version: app.getVersion(), platform: process.platform, arch: process.arch })
    remoteMain.initialize()
    createWindow()
    createMenu()
})

app.on('window-all-closed', () => {
    // On macOS it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
})

app.on('activate', () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (win === null) {
        createWindow()
    }
})

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true'
app.commandLine.appendSwitch('disable-features', 'Autofill')


