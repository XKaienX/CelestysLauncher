const {ipcRenderer}  = require('electron')
const fs             = require('fs-extra')
const os             = require('os')
const path           = require('path')

const ConfigManager  = require('./configmanager')
const { DistroAPI }  = require('./distromanager')
const LangLoader     = require('./langloader')
const { LoggerUtil } = require('helios-core')
// eslint-disable-next-line no-unused-vars
const { HeliosDistribution } = require('helios-core/common')

const logger = LoggerUtil.getLogger('Preloader')

logger.info('Loading..')

// Load ConfigManager
ConfigManager.load()

// Yuck!
// TODO Fix this
DistroAPI['commonDir'] = ConfigManager.getCommonDirectory()
DistroAPI['instanceDir'] = ConfigManager.getInstanceDirectory()

// Always ship a local distribution bootstrap with the launcher. This lets a
// brand-new install render the UI immediately even when GitHub/raw networking
// is slow or unavailable. Remote refreshes can happen later without blocking
// the loading screen.
const localDistributionPath = path.join(ConfigManager.getLauncherDirectory(), 'distribution.json')
const bundledDistributionPath = path.resolve(__dirname, '..', '..', '..', 'distribution.json')

try {
    if(!fs.existsSync(localDistributionPath) && fs.existsSync(bundledDistributionPath)) {
        fs.ensureDirSync(path.dirname(localDistributionPath))
        fs.copyFileSync(bundledDistributionPath, localDistributionPath)
        logger.info('Seeded local Celestys distribution bootstrap.')
    }
} catch(err) {
    logger.warn('Failed to seed bundled distribution bootstrap.', err)
}

// Load Strings
LangLoader.setupLanguage()

/**
 * 
 * @param {HeliosDistribution} data 
 */
let distributionSignalSent = false

function sendDistributionReady(success){
    const send = () => {
        if(distributionSignalSent) {
            return
        }

        distributionSignalSent = true
        ipcRenderer.send('distributionIndexDone', success)
    }

    // The preload can resolve the cached distribution before uibinder.js has
    // registered its IPC listener. Wait until the DOM is ready so the startup
    // signal cannot be lost, otherwise the loading screen can stay forever.
    if(globalThis.document.readyState === 'loading') {
        globalThis.addEventListener('DOMContentLoaded', () => setTimeout(send, 0), { once: true })
    } else {
        setTimeout(send, 0)
    }
}

function onDistroLoad(data){
    if(data != null){
        
        // Resolve the selected server if its value has yet to be set.
        if(ConfigManager.getSelectedServer() == null || data.getServerById(ConfigManager.getSelectedServer()) == null){
            logger.info('Determining default selected server..')
            ConfigManager.setSelectedServer(data.getMainServer().rawServer.id)
            ConfigManager.save()
        }
    }

    sendDistributionReady(data != null)
}

// Start from the bundled/local distribution so first launch never waits on
// the network. A remote refresh is intentionally non-blocking.
DistroAPI.getDistributionLocalLoadOnly()
    .then(heliosDistro => {
        logger.info('Loaded local Celestys distribution index.')
        onDistroLoad(heliosDistro)

        DistroAPI.refreshDistributionOrFallback()
            .then(() => logger.info('Celestys distribution refreshed in background.'))
            .catch(err => logger.warn('Background distribution refresh failed.', err))
    })
    .catch(err => {
        logger.info('Failed to load the bundled/local distribution index.')
        logger.info('Application cannot run.')
        logger.error(err)

        onDistroLoad(null)
    })

// Clean up temp dir incase previous launches ended unexpectedly. 
fs.remove(path.join(os.tmpdir(), ConfigManager.getTempNativeFolder()), (err) => {
    if(err){
        logger.warn('Error while cleaning natives directory', err)
    } else {
        logger.info('Cleaned natives directory.')
    }
})