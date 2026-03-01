// Arquivo: app/assets/js/scripts/landing.js

/**
 * Script for landing.ejs
 */
// Requirements
const fsExtra = require('fs-extra')
const pathMod = require('path')
const {
    validateLocalFile
}                             = require('helios-core/common')
const {
    FullRepair,
    DistributionIndexProcessor,
    MojangIndexProcessor,
    downloadFile
}                             = require('helios-core/dl')
const {
    validateSelectedJvm,
    ensureJavaDirIsRoot,
    javaExecFromRoot,
    discoverBestJvmInstallation,
    latestOpenJDK,
    extractJdk
}                             = require('helios-core/java')

// Internal Requirements
const DiscordWrapper          = require('./assets/js/discordwrapper')
const ProcessBuilder          = require('./assets/js/processbuilder')

// Launch Elements
const launch_content          = document.getElementById('launch_content')
const launch_details          = document.getElementById('launch_details')
const launch_progress         = document.getElementById('launch_progress')
const launch_progress_label   = document.getElementById('launch_progress_label')
const launch_details_text     = document.getElementById('launch_details_text')
const server_selection_button = document.getElementById('server_selection_button')
const user_text               = document.getElementById('user_text')

// Busca elementos dinamicamente (apos DOM load)
function getPlayerCountTop() {
    return document.getElementById('player_count_top')
}

function getServerSelectionText() {
    return document.getElementById('server_selection_text')
}

function setServerSelectionText(text) {
    const serverText = getServerSelectionText()
    if(serverText != null) {
        serverText.textContent = text
    }
}


const loggerLanding = LoggerUtil.getLogger('Landing')
const DOWNLOAD_LOG_SESSION = new Date().toISOString().replace(/[:.]/g, '-')
const DOWNLOAD_LOG_FILE = pathMod.join(remote.app.getPath('userData'), 'logs', `download-${DOWNLOAD_LOG_SESSION}.log`)

function appendDownloadLog(stage, payload = null){
    try {
        fsExtra.ensureDirSync(pathMod.dirname(DOWNLOAD_LOG_FILE))
        const line = JSON.stringify({
            ts: new Date().toISOString(),
            stage,
            payload
        })
        fsExtra.appendFileSync(DOWNLOAD_LOG_FILE, `${line}\n`, { encoding: 'utf-8' })
    } catch (err) {
        loggerLanding.warn('Failed to persist download log', err.message)
    }
}

/* Launch Progress Wrapper Functions */

function toggleLaunchArea(loading){
    if(loading){
        launch_details.style.display = 'flex'
        launch_content.style.display = 'none'
    } else {
        launch_details.style.display = 'none'
        launch_content.style.display = 'inline-flex'
    }
}

function setLaunchDetails(details){
    launch_details_text.textContent = details
}

function setLaunchPercentage(percent){
    launch_progress.setAttribute('max', 100)
    launch_progress.setAttribute('value', percent)
    launch_progress_label.textContent = percent + '%'
}

function setDownloadPercentage(percent){
    remote.getCurrentWindow().setProgressBar(percent/100)
    setLaunchPercentage(percent)
}

function setLaunchEnabled(val){
    document.getElementById('launch_button').disabled = !val
}

// Bind launch button
document.getElementById('launch_button').addEventListener('click', async e => {
    loggerLanding.info('Launching game..')
    try {
        const server = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
        const jExe = ConfigManager.getJavaExecutable(ConfigManager.getSelectedServer())
        if(jExe == null){
            await asyncSystemScan(server.effectiveJavaOptions)
        } else {

            setLaunchDetails(Lang.queryJS('landing.launch.pleaseWait'))
            toggleLaunchArea(true)
            setLaunchPercentage(0)

            const details = await validateSelectedJvm(ensureJavaDirIsRoot(jExe), server.effectiveJavaOptions.supported)
            if(details != null){
                loggerLanding.info('Jvm Details', details)
                const normalizedJavaExec = javaExecFromRoot(details.path)
                if(jExe !== normalizedJavaExec){
                    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), normalizedJavaExec)
                    ConfigManager.save()

                    settingsJavaExecVal.value = normalizedJavaExec
                    await populateJavaExecDetails(settingsJavaExecVal.value)
                }
                await dlAsync()

            } else {
                await asyncSystemScan(server.effectiveJavaOptions)
            }
        }
    } catch(err) {
        loggerLanding.error('Unhandled error in during launch process.', err)
        showLaunchFailure(Lang.queryJS('landing.launch.failureTitle'), Lang.queryJS('landing.launch.failureText'))
    }
})

// Bind settings button
document.getElementById('settingsMediaButton').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings)
}

// Bind avatar overlay button.
document.getElementById('avatarOverlay').onclick = async e => {
    await prepareSettings()
    switchView(getCurrentView(), VIEWS.settings, 500, 500, () => {
        settingsNavItemListener(document.getElementById('settingsNavAccount'), false)
    })
}

// Uso da cabeca 3D (/head/)
function updateSelectedAccount(authUser){
    let username = Lang.queryJS('landing.selectedAccount.noAccountSelected')
    
    if(authUser != null){
        if(authUser.displayName != null){
            username = authUser.displayName
        }
        
        // Usa sempre o endpoint /head/ (Cubo 3D) baseado no Nome (displayName)
        const identifier = authUser.displayName || 'Steve'
        document.getElementById('avatarContainer').style.backgroundImage = `url('https://mc-heads.net/head/${identifier}')`
    }
    
    user_text.textContent = username
}
updateSelectedAccount(ConfigManager.getSelectedAccount())

// Bind selected server
function updateSelectedServer(serv){
    if(getCurrentView() === VIEWS.settings){
        fullSettingsSave()
    }
    ConfigManager.setSelectedServer(serv != null ? serv.rawServer.id : null)
    ConfigManager.save()

    const displayText = serv != null ? serv.rawServer.name : Lang.queryJS('landing.selectedServer.noSelection')
    setServerSelectionText(displayText)

    if(getCurrentView() === VIEWS.settings){
        animateSettingsTabRefresh()
    }
    setLaunchEnabled(serv != null)
}
// Real text is set in uibinder.js on distributionIndexDone.
setServerSelectionText(Lang.queryJS('landing.selectedServer.loading'))
server_selection_button.onclick = async e => {
    e.currentTarget.blur()
    await toggleServerSelection(true)
}

// =========================================================================
// MOJANG STATUS LOGIC REMOVED
// =========================================================================

let serverStatusRequestInFlight = false

function resolveServerEndpoint(serv) {
    const rawAddress = serv.rawServer?.address || ''
    const [addressHost, addressPort] = rawAddress.split(':')
    const hostname = serv.hostname || addressHost || 'localhost'
    const parsedPort = Number.parseInt(addressPort, 10)
    const port = serv.port || (Number.isInteger(parsedPort) ? parsedPort : 25565)

    return { hostname, port }
}

const refreshServerStatus = async (fade = false) => {
    if(serverStatusRequestInFlight) {
        return
    }

    serverStatusRequestInFlight = true

    try {
        const serv = (await DistroAPI.getDistribution()).getServerById(ConfigManager.getSelectedServer())
        const pCountElementTop = getPlayerCountTop()

        if(serv == null || pCountElementTop == null) {
            return
        }

        const { hostname, port } = resolveServerEndpoint(serv)

        const statusController = new AbortController()
        const timeout = setTimeout(() => statusController.abort(), 10000)

        let pVal = 'OFFLINE'

        try {
            const response = await fetch(`https://api.mcstatus.io/v2/status/java/${hostname}:${port}`, {
                signal: statusController.signal
            })

            if(!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }

            const data = await response.json()
            if(data.online === true && data.players) {
                const onlinePlayers = data.players.online || 0
                const maxPlayers = data.players.max || 0
                pVal = `${onlinePlayers}/${maxPlayers}`
                pCountElementTop.style.color = '#27ae60'
            } else {
                pCountElementTop.style.color = '#e74c3c'
            }

            loggerLanding.info(`Server status ${hostname}:${port} -> ${pVal}`)
        } catch(err) {
            pCountElementTop.style.color = '#e74c3c'
            if(err.name !== 'AbortError') {
                loggerLanding.warn('Server status request failed', err.message)
            }
        } finally {
            clearTimeout(timeout)
        }

        if(fade) {
            $('#server_status_wrapper_top').fadeOut(250, () => {
                pCountElementTop.textContent = pVal
                $('#server_status_wrapper_top').fadeIn(500)
            })
        } else {
            pCountElementTop.textContent = pVal
        }
    } finally {
        serverStatusRequestInFlight = false
    }
}

// Server Status is refreshed in uibinder.js on distributionIndexDone.

// Refresh rate for server status (once every 1 minute).
const serverStatusListener = setInterval(() => refreshServerStatus(true), 60000)
window.addEventListener('beforeunload', () => clearInterval(serverStatusListener))

/**
 * Shows an error overlay, toggles off the launch area.
 * * @param {string} title The overlay title.
 * @param {string} desc The overlay description.
 */
function showLaunchFailure(title, desc){
    appendDownloadLog('launch_failure', { title, desc })
    setOverlayContent(
        title,
        desc,
        Lang.queryJS('landing.launch.okay')
    )
    setOverlayHandler(null)
    toggleOverlay(true)
    toggleLaunchArea(false)
}

/* System (Java) Scan */

async function asyncSystemScan(effectiveJavaOptions, launchAfter = true){

    setLaunchDetails(Lang.queryJS('landing.systemScan.checking'))
    toggleLaunchArea(true)
    setLaunchPercentage(0, 100)

    const jvmDetails = await discoverBestJvmInstallation(
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.supported
    )

    if(jvmDetails == null) {
        setOverlayContent(
            Lang.queryJS('landing.systemScan.noCompatibleJava'),
            Lang.queryJS('landing.systemScan.installJavaMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
            Lang.queryJS('landing.systemScan.installJava'),
            Lang.queryJS('landing.systemScan.installJavaManually')
        )
        setOverlayHandler(() => {
            setLaunchDetails(Lang.queryJS('landing.systemScan.javaDownloadPrepare'))
            toggleOverlay(false)
            
            try {
                downloadJava(effectiveJavaOptions, launchAfter)
            } catch(err) {
                loggerLanding.error('Unhandled error in Java Download', err)
                showLaunchFailure(Lang.queryJS('landing.systemScan.javaDownloadFailureTitle'), Lang.queryJS('landing.systemScan.javaDownloadFailureText'))
            }
        })
        setDismissHandler(() => {
            $('#overlayContent').fadeOut(250, () => {
                setOverlayContent(
                    Lang.queryJS('landing.systemScan.javaRequired', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredMessage', { 'major': effectiveJavaOptions.suggestedMajor }),
                    Lang.queryJS('landing.systemScan.javaRequiredDismiss'),
                    Lang.queryJS('landing.systemScan.javaRequiredCancel')
                )
                setOverlayHandler(() => {
                    toggleLaunchArea(false)
                    toggleOverlay(false)
                })
                setDismissHandler(() => {
                    toggleOverlay(false, true)

                    asyncSystemScan(effectiveJavaOptions, launchAfter)
                })
                $('#overlayContent').fadeIn(250)
            })
        })
        toggleOverlay(true, true)
    } else {
        const javaExec = javaExecFromRoot(jvmDetails.path)
        ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), javaExec)
        ConfigManager.save()

        settingsJavaExecVal.value = javaExec
        await populateJavaExecDetails(settingsJavaExecVal.value)

        if(launchAfter){
            await dlAsync()
        }
    }

}

async function downloadJava(effectiveJavaOptions, launchAfter = true) {
    appendDownloadLog('java_download_start', { suggestedMajor: effectiveJavaOptions.suggestedMajor })
    const asset = await latestOpenJDK(
        effectiveJavaOptions.suggestedMajor,
        ConfigManager.getDataDirectory(),
        effectiveJavaOptions.distribution)

    if(asset == null) {
        throw new Error(Lang.queryJS('landing.downloadJava.findJdkFailure'))
    }

    let received = 0
    await downloadFile(asset.url, asset.path, ({ transferred }) => {
        received = transferred
        setDownloadPercentage(Math.trunc((transferred/asset.size)*100))
    })
    setDownloadPercentage(100)

    if(received != asset.size) {
        loggerLanding.warn(`Java Download: Expected ${asset.size} bytes but received ${received}`)
        if(!await validateLocalFile(asset.path, asset.algo, asset.hash)) {
            loggerLanding.error(`Hashes do not match, ${asset.id} may be corrupted.`)
            appendDownloadLog('java_download_hash_mismatch', { assetId: asset.id })
            throw new Error(Lang.queryJS('landing.downloadJava.javaDownloadCorruptedError'))
        }
    }

    remote.getCurrentWindow().setProgressBar(2)

    const eLStr = Lang.queryJS('landing.downloadJava.extractingJava')
    let dotStr = ''
    setLaunchDetails(eLStr)
    const extractListener = setInterval(() => {
        if(dotStr.length >= 3){
            dotStr = ''
        } else {
            dotStr += '.'
        }
        setLaunchDetails(eLStr + dotStr)
    }, 750)

    const newJavaExec = await extractJdk(asset.path)
    appendDownloadLog('java_download_extract_complete', { javaExec: newJavaExec })

    remote.getCurrentWindow().setProgressBar(-1)

    ConfigManager.setJavaExecutable(ConfigManager.getSelectedServer(), newJavaExec)
    ConfigManager.save()

    clearInterval(extractListener)
    setLaunchDetails(Lang.queryJS('landing.downloadJava.javaInstalled'))

    asyncSystemScan(effectiveJavaOptions, launchAfter)

}

let proc
let hasRPC = false
const GAME_JOINED_REGEX = /\[.+\]: Sound engine started/
const GAME_LAUNCH_REGEX = /^\[.+\]: (?:MinecraftForge .+ Initialized|ModLauncher .+ starting: .+|Loading Minecraft .+ with Fabric Loader .+)$/
const MIN_LINGER = 5000

async function dlAsync(login = true) {

    const loggerLaunchSuite = LoggerUtil.getLogger('LaunchSuite')

    setLaunchDetails(Lang.queryJS('landing.dlAsync.loadingServerInfo'))
    appendDownloadLog('launch_suite_start', { login })

    let distro

    try {
        distro = await DistroAPI.refreshDistributionOrFallback()
        appendDownloadLog('distribution_refresh_ok', { selectedServer: ConfigManager.getSelectedServer() })
        onDistroRefresh(distro)
    } catch(err) {
        appendDownloadLog('distribution_refresh_error', { message: err.message })
        loggerLaunchSuite.error('Unable to refresh distribution index.', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.fatalError'), Lang.queryJS('landing.dlAsync.unableToLoadDistributionIndex'))
        return
    }

    const serv = distro.getServerById(ConfigManager.getSelectedServer())

    if(login) {
        if(ConfigManager.getSelectedAccount() == null){
            loggerLanding.error('You must be logged into an account.')
            return
        }
    }

    setLaunchDetails(Lang.queryJS('landing.dlAsync.pleaseWait'))
    toggleLaunchArea(true)
    setLaunchPercentage(0)

    const fullRepairModule = new FullRepair(
        ConfigManager.getCommonDirectory(),
        ConfigManager.getInstanceDirectory(),
        ConfigManager.getLauncherDirectory(),
        ConfigManager.getSelectedServer(),
        DistroAPI.isDevMode()
    )

    fullRepairModule.spawnReceiver()

    fullRepairModule.childProcess.on('error', (err) => {
        loggerLaunchSuite.error('Error during launch', err)
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), err.message || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
    })
    fullRepairModule.childProcess.on('close', (code, _signal) => {
        if(code !== 0){
            loggerLaunchSuite.error(`Full Repair Module exited with code ${code}, assuming error.`)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        }
    })

    loggerLaunchSuite.info('Validating files.')
    setLaunchDetails(Lang.queryJS('landing.dlAsync.validatingFileIntegrity'))
    let invalidFileCount = 0
    try {
        invalidFileCount = await fullRepairModule.verifyFiles(percent => {
            setLaunchPercentage(percent)
        })
        appendDownloadLog('verify_files_complete', { invalidFileCount })
        setLaunchPercentage(100)
    } catch (err) {
        appendDownloadLog('verify_files_error', { message: err.message, displayable: err.displayable })
        loggerLaunchSuite.error('Error during file validation.')
        showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileVerificationTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
        return
    }
    

    if(invalidFileCount > 0) {
        loggerLaunchSuite.info('Downloading files.')
        setLaunchDetails(Lang.queryJS('landing.dlAsync.downloadingFiles'))
        setLaunchPercentage(0)
        try {
            await fullRepairModule.download(percent => {
                setDownloadPercentage(percent)
            })
            appendDownloadLog('download_files_complete')
            setDownloadPercentage(100)
        } catch(err) {
            appendDownloadLog('download_files_error', { message: err.message, displayable: err.displayable })
            loggerLaunchSuite.error('Error during file download.')
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringFileDownloadTitle'), err.displayable || Lang.queryJS('landing.dlAsync.seeConsoleForDetails'))
            return
        }
    } else {
        loggerLaunchSuite.info('No invalid files, skipping download.')
    }

    remote.getCurrentWindow().setProgressBar(-1)

    fullRepairModule.destroyReceiver()

    setLaunchDetails(Lang.queryJS('landing.dlAsync.preparingToLaunch'))

    const mojangIndexProcessor = new MojangIndexProcessor(
        ConfigManager.getCommonDirectory(),
        serv.rawServer.minecraftVersion)
    const distributionIndexProcessor = new DistributionIndexProcessor(
        ConfigManager.getCommonDirectory(),
        distro,
        serv.rawServer.id
    )

    const modLoaderData = await distributionIndexProcessor.loadModLoaderVersionJson(serv)
    const versionData = await mojangIndexProcessor.getVersionJson()
    appendDownloadLog('manifests_loaded', {
        minecraftVersion: serv.rawServer.minecraftVersion,
        serverId: serv.rawServer.id
    })

    if(login) {
        const authUser = ConfigManager.getSelectedAccount()
        loggerLaunchSuite.info(`Sending selected account (${authUser.displayName}) to ProcessBuilder.`)
        let pb = new ProcessBuilder(serv, versionData, modLoaderData, authUser, remote.app.getVersion())
        setLaunchDetails(Lang.queryJS('landing.dlAsync.launchingGame'))

        const SERVER_JOINED_REGEX = new RegExp(`\\[.+\\]: \\[CHAT\\] ${authUser.displayName} joined the game`)

        const onLoadComplete = () => {
            toggleLaunchArea(false)
            if(hasRPC){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.loading'))
                proc.stdout.on('data', gameStateChange)
            }
            proc.stdout.removeListener('data', tempListener)
            proc.stderr.removeListener('data', gameErrorListener)

            // === FECHAR O LAUNCHER ===
            setTimeout(() => {
                try {
                    const w = remote.getCurrentWindow();
                    w.close();
                } catch(e) {
                    console.error("Erro ao fechar:", e);
                    remote.app.quit();
                }
            }, 1500); // Espera 1.5s antes de fechar
        }
        const start = Date.now()

        const tempListener = function(data){
            if(GAME_LAUNCH_REGEX.test(data.trim())){
                const diff = Date.now()-start
                if(diff < MIN_LINGER) {
                    setTimeout(onLoadComplete, MIN_LINGER-diff)
                } else {
                    onLoadComplete()
                }
            }
        }

        const gameStateChange = function(data){
            data = data.trim()
            if(SERVER_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joined'))
            } else if(GAME_JOINED_REGEX.test(data)){
                DiscordWrapper.updateDetails(Lang.queryJS('landing.discord.joining'))
            }
        }

        const gameErrorListener = function(data){
            data = data.trim()
            if(data.indexOf('Could not find or load main class net.minecraft.launchwrapper.Launch') > -1){
                loggerLaunchSuite.error('Game launch failed, LaunchWrapper was not downloaded properly.')
                showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.launchWrapperNotDownloaded'))
            }
        }

        try {
            proc = pb.build()
            appendDownloadLog('minecraft_process_spawned', { pid: proc.pid })
            proc.stdout.on('data', tempListener)
            proc.stderr.on('data', gameErrorListener)

            setLaunchDetails(Lang.queryJS('landing.dlAsync.doneEnjoyServer'))

            if(distro.rawDistribution.discord != null && serv.rawServer.discord != null){
                DiscordWrapper.initRPC(distro.rawDistribution.discord, serv.rawServer.discord)
                hasRPC = true
                proc.on('close', (code, signal) => {
                    loggerLaunchSuite.info('Shutting down Discord Rich Presence..')
                    DiscordWrapper.shutdownRPC()
                    hasRPC = false
                    proc = null
                })
            }

        } catch(err) {
            appendDownloadLog('minecraft_process_error', { message: err.message })
            loggerLaunchSuite.error('Error during launch', err)
            showLaunchFailure(Lang.queryJS('landing.dlAsync.errorDuringLaunchTitle'), Lang.queryJS('landing.dlAsync.checkConsoleForDetails'))
        }
    }
}

// --- NEWS DISABLED ---
function disableNews() {
    const newsButton = document.getElementById('newsButton')
    if(newsButton != null) {
        newsButton.style.display = 'none'
        newsButton.onclick = () => {}
    }
}

disableNews()

async function initNews() {
    disableNews()
    return null
}
