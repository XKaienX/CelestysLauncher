const AdmZip = require('adm-zip')
const childProcess = require('child_process')
const crypto = require('crypto')
const fs = require('fs-extra')
const got = require('got')
const path = require('path')
const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('CelestysPackManager')

const PACK = Object.freeze({
    name: 'Celestys | All The Mons 1.3.0',
    curseforgeProjectId: 1356598,
    curseforgeFileId: 8822048,
    minecraftVersion: '1.21.1',
    neoForgeVersion: '21.1.250',
    allTheMonsSourceCommit: 'fa55a10373879529bab9a26f048ad631d4ad18ae'
})

const PACK_INDEX_URL = 'https://api.modpacks.ch/public/curseforge/' + PACK.curseforgeProjectId + '/' + PACK.curseforgeFileId
const OVERRIDES_URL = 'https://codeload.github.com/AllTheMods/All-the-Mons/zip/' + PACK.allTheMonsSourceCommit
const NEOFORGE_BASE_URL = 'https://maven.neoforged.net/releases/net/neoforged/neoforge/' + PACK.neoForgeVersion
const NEOFORGE_INSTALLER_URL = NEOFORGE_BASE_URL + '/neoforge-' + PACK.neoForgeVersion + '-installer.jar'
const STATE_FILE = '.celestys-pack-state.json'
const CELESTYS_MOD_OVERRIDES_URL = 'https://raw.githubusercontent.com/XKaienX/CelestysLauncher/celestys-base/celestys-mod-overrides.json'
const CELESTYS_EXTRAS_URL = 'https://raw.githubusercontent.com/XKaienX/CelestysLauncher/celestys-base/celestys-extra-files-v2.json'
const DOWNLOAD_CONCURRENCY = 6

function report(onProgress, percent, detail) {
    if(typeof onProgress === 'function') {
        onProgress({
            percent: Math.max(0, Math.min(100, Math.trunc(percent))),
            detail
        })
    }
}

function normalizeRelativePath(rawPath, fileName = null) {
    let value = String(rawPath || '').replaceAll('\\', '/').replace(/^\/+/, '')

    if(fileName != null && fileName !== '') {
        const normalizedName = String(fileName).replaceAll('\\', '/').split('/').pop()
        if(path.posix.basename(value) !== normalizedName) {
            value = path.posix.join(value, normalizedName)
        }
    }

    value = path.posix.normalize(value)

    if(value === '.' || value.startsWith('../') || path.posix.isAbsolute(value)) {
        throw new Error('Caminho inseguro no manifesto do modpack: ' + rawPath)
    }

    return value
}

function resolveManagedPath(instanceDir, relativePath) {
    const normalized = normalizeRelativePath(relativePath)
    const root = path.resolve(instanceDir)
    const destination = path.resolve(instanceDir, ...normalized.split('/'))

    if(destination !== root && !destination.startsWith(root + path.sep)) {
        throw new Error('Caminho escapou da instancia: ' + relativePath)
    }

    return destination
}

async function sha1File(filePath) {
    const hash = crypto.createHash('sha1')

    await new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath)
        stream.on('error', reject)
        stream.on('data', chunk => hash.update(chunk))
        stream.on('end', resolve)
    })

    return hash.digest('hex')
}

async function sha256File(filePath) {
    const hash = crypto.createHash('sha256')

    await new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath)
        stream.on('error', reject)
        stream.on('data', chunk => hash.update(chunk))
        stream.on('end', resolve)
    })

    return hash.digest('hex')
}

async function readState(instanceDir) {
    const statePath = path.join(instanceDir, STATE_FILE)

    try {
        const data = await fs.readJson(statePath)
        return data != null && typeof data === 'object' ? data : {}
    } catch(err) {
        if(err.code !== 'ENOENT') {
            logger.warn('Falha ao ler estado do modpack, reconstruindo.', err.message)
        }
        return {}
    }
}

async function writeState(instanceDir, state) {
    const statePath = path.join(instanceDir, STATE_FILE)
    await fs.writeJson(statePath, state, { spaces: 2 })
}

async function downloadToFile(url, destination, progressCallback = null) {
    await fs.ensureDir(path.dirname(destination))

    const temporary = destination + '.celestys-download'
    await fs.remove(temporary)

    try {
        await new Promise((resolve, reject) => {
            const request = got.stream(url, {
                followRedirect: true,
                headers: {
                    'user-agent': 'CelestysLauncher/1.0'
                },
                retry: {
                    limit: 2
                },
                timeout: {
                    request: 120000
                }
            })

            const output = fs.createWriteStream(temporary)

            request.on('downloadProgress', progress => {
                if(typeof progressCallback === 'function') {
                    progressCallback(progress)
                }
            })

            request.on('error', reject)
            output.on('error', reject)
            output.on('finish', resolve)

            request.pipe(output)
        })

        await fs.move(temporary, destination, { overwrite: true })
    } catch(err) {
        await fs.remove(temporary)
        throw err
    }
}

async function downloadWithFallback(urls, destination, progressCallback = null) {
    const candidates = [...new Set(urls.filter(value => typeof value === 'string' && value.trim() !== ''))]
    let lastError = null

    for(const url of candidates) {
        try {
            await downloadToFile(url, destination, progressCallback)
            return url
        } catch(err) {
            lastError = err
            logger.warn('Falha ao baixar ' + url + ': ' + err.message)
        }
    }

    throw lastError || new Error('Nenhuma URL disponivel para ' + path.basename(destination))
}

async function validateManagedFile(destination, file, previousFingerprint = null) {
    let stat

    try {
        stat = await fs.stat(destination)
    } catch(err) {
        if(err.code === 'ENOENT') {
            return { valid: false, fingerprint: null }
        }
        throw err
    }

    if(file.size != null && Number(file.size) > 0 && stat.size !== Number(file.size)) {
        return { valid: false, fingerprint: null }
    }

    const expectedSha1 = typeof file.sha1 === 'string' ? file.sha1.toLowerCase() : null

    if(expectedSha1 == null || expectedSha1 === '') {
        return {
            valid: true,
            fingerprint: {
                size: stat.size,
                mtimeMs: stat.mtimeMs,
                sha1: null
            }
        }
    }

    if(previousFingerprint != null
        && previousFingerprint.sha1 === expectedSha1
        && previousFingerprint.size === stat.size
        && previousFingerprint.mtimeMs === stat.mtimeMs) {
        return { valid: true, fingerprint: previousFingerprint }
    }

    const actualSha1 = await sha1File(destination)

    return {
        valid: actualSha1 === expectedSha1,
        fingerprint: {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            sha1: actualSha1
        }
    }
}

function getPackFileRelativePath(file) {
    const rawPath = file.path || ''
    const name = file.name || file.fileName || ''
    return normalizeRelativePath(rawPath, name)
}

function getPackFileUrls(file) {
    const urls = []

    if(typeof file.url === 'string') {
        urls.push(file.url)
    }

    if(Array.isArray(file.mirrors)) {
        urls.push(...file.mirrors)
    }

    if(file.curseforge != null && file.curseforge.project != null && file.curseforge.file != null) {
        urls.push('https://www.curseforge.com/api/v1/mods/' + file.curseforge.project + '/files/' + file.curseforge.file + '/download')
    }

    return urls
}

async function fetchPackIndex() {
    const response = await got(PACK_INDEX_URL, {
        headers: {
            'user-agent': 'CelestysLauncher/1.0'
        },
        retry: {
            limit: 2
        },
        timeout: {
            request: 60000
        }
    }).json()

    if(response == null || !Array.isArray(response.files)) {
        throw new Error('A API do All The Mons retornou um manifesto invalido.')
    }

    return response
}

async function fetchCelestysModOverrides() {
    let manifest

    try {
        manifest = await got(CELESTYS_MOD_OVERRIDES_URL, {
            headers: {
                'user-agent': 'CelestysLauncher/1.0'
            },
            retry: {
                limit: 2
            },
            timeout: {
                request: 60000
            }
        }).json()
    } catch(err) {
        throw new Error('Nao foi possivel carregar a lista de atualizacoes de mods da Celestys: ' + err.message)
    }

    const files = Array.isArray(manifest?.files) ? manifest.files : []

    if(files.length < 50) {
        throw new Error('A lista de atualizacoes da Celestys retornou apenas ' + files.length + ' arquivos; instalacao cancelada por seguranca.')
    }

    return manifest
}

async function fetchModVersionPage(projectId, filter, secondFilter, page) {
    const url = 'https://api.modpacks.ch/public/mod/'
        + encodeURIComponent(String(projectId))
        + '/versions/' + encodeURIComponent(filter)
        + '/' + encodeURIComponent(secondFilter)
        + '/' + page

    return got(url, {
        headers: {
            'user-agent': 'CelestysLauncher/1.0'
        },
        retry: {
            limit: 2
        },
        timeout: {
            request: 60000
        }
    }).json()
}

async function resolveExactModVersion(projectId, targetPath) {
    const targetName = path.posix.basename(normalizeRelativePath(targetPath))
    const filters = [
        [PACK.minecraftVersion, 'neoforge'],
        [PACK.minecraftVersion, 'all'],
        ['all', 'neoforge'],
        ['all', 'all']
    ]
    let lastError = null

    for(const [filter, secondFilter] of filters) {
        let page = 1
        let pages = 1

        do {
            let response

            try {
                response = await fetchModVersionPage(projectId, filter, secondFilter, page)
            } catch(err) {
                lastError = err
                break
            }

            const versions = Array.isArray(response?.versions) ? response.versions : []
            const match = versions.find(version => version?.name === targetName)

            if(match != null) {
                const urls = []

                if(typeof match.url === 'string' && match.url !== '') {
                    urls.push(match.url)
                }
                if(Array.isArray(match.mirrors)) {
                    urls.push(...match.mirrors)
                }

                if(urls.length === 0) {
                    throw new Error('A fonte oficial nao informou uma URL para ' + targetName)
                }

                return {
                    name: targetName,
                    size: match.size,
                    sha1: match.sha1,
                    urls
                }
            }

            pages = Math.max(1, Math.min(Number(response?.pages) || 1, 20))
            page++
        } while(page <= pages)
    }

    throw new Error(
        'Nao foi possivel localizar a versao exata ' + targetName
        + ' no projeto ' + projectId
        + (lastError != null ? ': ' + lastError.message : '')
    )
}

async function runPool(items, concurrency, worker) {
    let cursor = 0

    const runners = Array.from(
        { length: Math.min(concurrency, Math.max(items.length, 1)) },
        async () => {
            for(;;) {
                const index = cursor++
                if(index >= items.length) {
                    return
                }
                await worker(items[index], index)
            }
        }
    )

    await Promise.all(runners)
}

async function syncPackFiles(instanceDir, previousState, modOverrideManifest, onProgress) {
    report(onProgress, 3, 'Lendo arquivos oficiais do All The Mons...')

    const manifest = await fetchPackIndex()
    const allFiles = manifest.files.filter(file => {
        return file != null
            && file.serveronly !== true
            && file.optional !== true
            && (file.name != null || file.fileName != null)
    })

    if(allFiles.length < 300) {
        throw new Error('O manifesto do All The Mons retornou apenas ' + allFiles.length + ' arquivos; instalacao cancelada por seguranca.')
    }

    const replacementOldPaths = new Set()
    for(const override of modOverrideManifest.files) {
        for(const oldPath of Array.isArray(override?.replaces) ? override.replaces : []) {
            replacementOldPaths.add(normalizeRelativePath(oldPath))
        }
    }

    const replacementSources = {}
    const files = []

    for(const file of allFiles) {
        const relativePath = getPackFileRelativePath(file)

        if(replacementOldPaths.has(relativePath)) {
            const projectId = file?.curseforge?.project
            if(projectId == null) {
                throw new Error('Nao foi possivel identificar o projeto de origem de ' + relativePath)
            }

            replacementSources[relativePath] = {
                projectId
            }
            continue
        }

        files.push(file)
    }

    for(const oldPath of replacementOldPaths) {
        if(replacementSources[oldPath] == null) {
            throw new Error('Arquivo antigo para substituicao nao foi encontrado no All The Mons: ' + oldPath)
        }
    }

    const previousFingerprints = previousState.fingerprints || {}
    const newFingerprints = {}
    const managedFiles = []
    let completed = 0

    await runPool(files, DOWNLOAD_CONCURRENCY, async file => {
        const relativePath = getPackFileRelativePath(file)
        const destination = resolveManagedPath(instanceDir, relativePath)
        const previousFingerprint = previousFingerprints[relativePath]
        let result = await validateManagedFile(destination, file, previousFingerprint)

        if(!result.valid) {
            const urls = getPackFileUrls(file)

            if(urls.length === 0) {
                throw new Error('Sem fonte oficial disponivel para ' + relativePath)
            }

            await downloadWithFallback(urls, destination)

            result = await validateManagedFile(destination, file, null)

            if(!result.valid) {
                throw new Error('Hash invalido apos baixar ' + relativePath)
            }
        }

        managedFiles.push(relativePath)
        newFingerprints[relativePath] = result.fingerprint
        completed++

        const percent = 5 + (completed / files.length) * 65
        report(onProgress, percent, 'Atualizando All The Mons (' + completed + '/' + files.length + ')')
    })

    return {
        manifest,
        managedFiles,
        fingerprints: newFingerprints,
        replacementSources
    }
}

async function syncCelestysModOverrides(instanceDir, previousState, modOverrideManifest, replacementSources, onProgress) {
    report(onProgress, 70, 'Aplicando atualizacoes validadas da Celestys...')

    const files = modOverrideManifest.files
    const previousFingerprints = previousState.modOverrideFingerprints || {}
    const managedFiles = []
    const fingerprints = {}
    let completed = 0

    await runPool(files, DOWNLOAD_CONCURRENCY, async override => {
        const relativePath = normalizeRelativePath(override.path)
        const replaces = Array.isArray(override.replaces) ? override.replaces.map(normalizeRelativePath) : []

        if(replaces.length !== 1) {
            throw new Error('Atualizacao de mod invalida para ' + relativePath + ': esperado exatamente um arquivo substituido.')
        }

        const source = replacementSources[replaces[0]]
        if(source?.projectId == null) {
            throw new Error('Projeto de origem nao encontrado para ' + replaces[0])
        }

        const resolved = await resolveExactModVersion(source.projectId, relativePath)
        const destination = resolveManagedPath(instanceDir, relativePath)
        const previousFingerprint = previousFingerprints[relativePath]

        const validationFile = {
            size: resolved.size,
            sha1: resolved.sha1
        }

        let result = await validateManagedFile(destination, validationFile, previousFingerprint)

        if(!result.valid) {
            await downloadWithFallback(resolved.urls, destination)
            result = await validateManagedFile(destination, validationFile, null)

            if(!result.valid) {
                await fs.remove(destination)
                throw new Error('Hash invalido apos baixar atualizacao da Celestys: ' + relativePath)
            }
        }

        managedFiles.push(relativePath)
        fingerprints[relativePath] = result.fingerprint
        completed++

        report(
            onProgress,
            70 + (completed / files.length) * 12,
            'Atualizando mods Celestys (' + completed + '/' + files.length + ')'
        )
    })

    return {
        managedFiles,
        fingerprints
    }
}

function getOverridesCachePath(cacheDir) {
    return path.join(cacheDir, 'all-the-mons-' + PACK.allTheMonsSourceCommit + '.zip')
}

async function ensureOverridesArchive(cacheDir, onProgress) {
    const archivePath = getOverridesCachePath(cacheDir)

    if(await fs.pathExists(archivePath)) {
        return archivePath
    }

    report(onProgress, 82, 'Baixando configuracoes oficiais do All The Mons...')
    await downloadToFile(OVERRIDES_URL, archivePath, progress => {
        report(onProgress, 82 + progress.percent * 4, 'Baixando configuracoes oficiais do All The Mons...')
    })

    return archivePath
}

async function overridesArePresent(instanceDir, previousState) {
    if(previousState.overrideSourceCommit !== PACK.allTheMonsSourceCommit
        || !Array.isArray(previousState.overrideFiles)
        || previousState.overrideFiles.length === 0) {
        return false
    }

    for(const relativePath of previousState.overrideFiles) {
        if(!await fs.pathExists(resolveManagedPath(instanceDir, relativePath))) {
            return false
        }
    }

    return true
}

async function syncOfficialOverrides(instanceDir, cacheDir, previousState, onProgress) {
    if(await overridesArePresent(instanceDir, previousState)) {
        report(onProgress, 86, 'Configuracoes do All The Mons ja estao atualizadas.')
        return previousState.overrideFiles
    }

    const archivePath = await ensureOverridesArchive(cacheDir, onProgress)
    report(onProgress, 86, 'Aplicando configuracoes do All The Mons...')

    const zip = new AdmZip(archivePath)
    const entries = zip.getEntries()
    const managed = []

    for(const entry of entries) {
        if(entry.isDirectory) {
            continue
        }

        const parts = entry.entryName.replaceAll('\\', '/').split('/')

        if(parts.length < 3 || (parts[1] !== 'config' && parts[1] !== 'kubejs')) {
            continue
        }

        const relativePath = normalizeRelativePath(parts.slice(1).join('/'))
        const destination = resolveManagedPath(instanceDir, relativePath)
        await fs.ensureDir(path.dirname(destination))
        await fs.writeFile(destination, entry.getData())
        managed.push(relativePath)
    }

    if(managed.length < 100) {
        throw new Error('O pacote de configuracoes trouxe apenas ' + managed.length + ' arquivos; instalacao cancelada por seguranca.')
    }

    report(onProgress, 88, 'Configuracoes aplicadas (' + managed.length + ' arquivos).')
    return managed
}

function neoForgeVersionCandidates(commonDir) {
    const versionsDir = path.join(commonDir, 'versions')

    return [
        path.join(versionsDir, 'neoforge-' + PACK.neoForgeVersion, 'neoforge-' + PACK.neoForgeVersion + '.json'),
        path.join(
            versionsDir,
            PACK.minecraftVersion + '-neoforge-' + PACK.neoForgeVersion,
            PACK.minecraftVersion + '-neoforge-' + PACK.neoForgeVersion + '.json'
        )
    ]
}

async function findNeoForgeVersionJson(commonDir) {
    for(const candidate of neoForgeVersionCandidates(commonDir)) {
        if(await fs.pathExists(candidate)) {
            return candidate
        }
    }

    const versionsDir = path.join(commonDir, 'versions')

    if(!await fs.pathExists(versionsDir)) {
        return null
    }

    const directories = await fs.readdir(versionsDir)

    for(const directory of directories) {
        if(!directory.toLowerCase().includes(('neoforge-' + PACK.neoForgeVersion).toLowerCase())) {
            continue
        }

        const versionPath = path.join(versionsDir, directory, directory + '.json')
        if(await fs.pathExists(versionPath)) {
            return versionPath
        }
    }

    return null
}

async function installerJavaExecutable(javaExec) {
    if(process.platform !== 'win32' || path.basename(javaExec).toLowerCase() !== 'javaw.exe') {
        return javaExec
    }

    const consoleJava = path.join(path.dirname(javaExec), 'java.exe')
    return await fs.pathExists(consoleJava) ? consoleJava : javaExec
}

async function verifyNeoForgeInstaller(installerPath) {
    try {
        const checksumUrl = NEOFORGE_INSTALLER_URL + '.sha256'
        const expected = (await got(checksumUrl, {
            headers: {
                'user-agent': 'CelestysLauncher/1.0'
            },
            timeout: {
                request: 30000
            }
        }).text()).trim().split(/\s+/)[0].toLowerCase()

        if(!/^[a-f0-9]{64}$/.test(expected)) {
            return true
        }

        const actual = await sha256File(installerPath)
        return actual === expected
    } catch(err) {
        logger.warn('Nao foi possivel obter SHA-256 oficial do instalador NeoForge.', err.message)
        return true
    }
}

async function runNeoForgeInstaller(javaExec, installerPath, commonDir) {
    const executable = await installerJavaExecutable(javaExec)

    await fs.ensureDir(commonDir)

    const launcherProfilesPath = path.join(commonDir, 'launcher_profiles.json')
    if(!await fs.pathExists(launcherProfilesPath)) {
        await fs.writeJson(launcherProfilesPath, {
            profiles: {},
            settings: {},
            version: 3
        }, { spaces: 2 })
    }

    await new Promise((resolve, reject) => {
        const proc = childProcess.spawn(
            executable,
            ['-jar', installerPath, '--install-client', commonDir],
            {
                cwd: commonDir,
                windowsHide: true
            }
        )

        let stdout = ''
        let stderr = ''

        if(proc.stdout != null) {
            proc.stdout.on('data', chunk => {
                stdout += chunk.toString()
                logger.info(chunk.toString().trim())
            })
        }

        if(proc.stderr != null) {
            proc.stderr.on('data', chunk => {
                stderr += chunk.toString()
                logger.warn(chunk.toString().trim())
            })
        }

        proc.on('error', reject)
        proc.on('close', code => {
            if(code === 0) {
                resolve()
            } else {
                reject(new Error('Instalador NeoForge terminou com codigo ' + code + '. ' + (stderr || stdout)))
            }
        })
    })
}

async function ensureNeoForge(commonDir, javaExec, cacheDir, onProgress) {
    let versionJson = await findNeoForgeVersionJson(commonDir)

    if(versionJson != null) {
        report(onProgress, 98, 'NeoForge ' + PACK.neoForgeVersion + ' pronto.')
        return versionJson
    }

    report(onProgress, 90, 'Preparando NeoForge ' + PACK.neoForgeVersion + '...')
    await fs.ensureDir(cacheDir)

    const installerPath = path.join(cacheDir, 'neoforge-' + PACK.neoForgeVersion + '-installer.jar')

    if(!await fs.pathExists(installerPath) || !await verifyNeoForgeInstaller(installerPath)) {
        await fs.remove(installerPath)

        await downloadToFile(NEOFORGE_INSTALLER_URL, installerPath, progress => {
            report(onProgress, 90 + progress.percent * 4, 'Baixando NeoForge ' + PACK.neoForgeVersion + '...')
        })

        if(!await verifyNeoForgeInstaller(installerPath)) {
            await fs.remove(installerPath)
            throw new Error('O instalador do NeoForge falhou na verificacao SHA-256.')
        }
    }

    report(onProgress, 95, 'Instalando NeoForge ' + PACK.neoForgeVersion + '...')
    await runNeoForgeInstaller(javaExec, installerPath, commonDir)

    versionJson = await findNeoForgeVersionJson(commonDir)

    if(versionJson == null) {
        throw new Error('NeoForge ' + PACK.neoForgeVersion + ' foi executado, mas o version.json nao foi encontrado.')
    }

    report(onProgress, 99, 'NeoForge ' + PACK.neoForgeVersion + ' instalado.')
    return versionJson
}

async function resolveCelestysExtra(file) {
    if(file == null || typeof file.path !== 'string') {
        return null
    }

    // Backward-compatible manifest support:
    // older launchers keep using file.path/file.url, while newer launchers
    // can resolve a newer exact Modrinth version through file.latest.
    const latest = file.latest

    if(latest != null
        && latest.source === 'Modrinth'
        && typeof latest.projectId === 'string'
        && typeof latest.path === 'string') {

        const apiUrl = 'https://api.modrinth.com/v2/project/' + encodeURIComponent(latest.projectId) + '/version'
        let versions

        try {
            versions = await got(apiUrl, {
                headers: {
                    'user-agent': 'CelestysLauncher/1.0'
                },
                searchParams: {
                    game_versions: JSON.stringify([latest.gameVersion || PACK.minecraftVersion]),
                    loaders: JSON.stringify([latest.loader || 'neoforge'])
                },
                retry: {
                    limit: 2
                },
                timeout: {
                    request: 30000
                }
            }).json()
        } catch(err) {
            throw new Error('Nao foi possivel consultar a versao mais recente de ' + file.path + ' no Modrinth: ' + err.message)
        }

        const targetName = path.posix.basename(normalizeRelativePath(latest.path))
        const targetVersion = Array.isArray(versions)
            ? versions.find(version => {
                if(latest.versionNumber && version?.version_number === latest.versionNumber) {
                    return true
                }

                return Array.isArray(version?.files)
                    && version.files.some(candidate => candidate?.filename === targetName)
            })
            : null

        if(targetVersion == null) {
            throw new Error('Versao Modrinth nao encontrada para ' + targetName)
        }

        const candidates = Array.isArray(targetVersion.files) ? targetVersion.files : []
        const targetFile = candidates.find(candidate => candidate?.filename === targetName)
            || candidates.find(candidate => candidate?.primary === true)
            || candidates[0]

        if(targetFile == null || typeof targetFile.url !== 'string') {
            throw new Error('Arquivo Modrinth nao encontrado para ' + targetName)
        }

        return {
            path: latest.path,
            url: targetFile.url
        }
    }

    if(typeof file.url !== 'string') {
        return null
    }

    return {
        path: file.path,
        url: file.url
    }
}

async function syncCelestysExtras(instanceDir, previousState, onProgress) {
    report(onProgress, 88, 'Verificando arquivos exclusivos da Celestys...')

    let manifest
    try {
        manifest = await got(CELESTYS_EXTRAS_URL, {
            headers: {
                'user-agent': 'CelestysLauncher/1.0'
            },
            retry: {
                limit: 2
            },
            timeout: {
                request: 30000
            }
        }).json()
    } catch(err) {
        throw new Error('Nao foi possivel carregar o manifesto exclusivo da Celestys: ' + err.message)
    }

    const files = Array.isArray(manifest?.files) ? manifest.files : []
    const managed = []
    const previousFingerprints = previousState.extraFingerprints || {}
    const fingerprints = {}

    let completed = 0

    for(const file of files) {
        const resolvedFile = await resolveCelestysExtra(file)
        if(resolvedFile == null) {
            continue
        }

        const relativePath = normalizeRelativePath(resolvedFile.path)
        const destination = resolveManagedPath(instanceDir, relativePath)
        const manifestSha256 = typeof file.sha256 === 'string' ? file.sha256.toLowerCase() : null
        const previous = previousFingerprints[relativePath]
        const expectedSha256 = manifestSha256 || previous?.sha256 || null

        let valid = false
        let stat = null
        let actualSha256 = null

        try {
            stat = await fs.stat(destination)

            if(file.size == null || Number(file.size) === stat.size) {
                if(expectedSha256 != null
                    && previous != null
                    && previous.sha256 === expectedSha256
                    && previous.size === stat.size
                    && previous.mtimeMs === stat.mtimeMs) {
                    valid = true
                    actualSha256 = expectedSha256
                } else if(expectedSha256 != null) {
                    actualSha256 = await sha256File(destination)
                    valid = actualSha256 === expectedSha256
                } else {
                    actualSha256 = await sha256File(destination)
                    valid = true
                }
            }
        } catch(err) {
            if(err.code !== 'ENOENT') {
                throw err
            }
        }

        if(!valid) {
            await downloadToFile(resolvedFile.url, destination)
            actualSha256 = await sha256File(destination)

            if(manifestSha256 != null && actualSha256 !== manifestSha256) {
                await fs.remove(destination)
                throw new Error('Hash invalido para arquivo exclusivo da Celestys: ' + relativePath)
            }

            stat = await fs.stat(destination)
        }

        managed.push(relativePath)
        fingerprints[relativePath] = {
            size: stat.size,
            mtimeMs: stat.mtimeMs,
            sha256: actualSha256
        }

        completed++
        if(files.length > 0) {
            report(onProgress, 88 + (completed / files.length) * 2, 'Atualizando arquivos da Celestys (' + completed + '/' + files.length + ')')
        }
    }

    return {
        managedFiles: managed,
        fingerprints
    }
}


async function cleanupStaleFiles(instanceDir, previousFiles, currentFiles) {
    if(!Array.isArray(previousFiles) || previousFiles.length === 0) {
        return
    }

    const current = new Set(currentFiles)

    for(const relativePath of previousFiles) {
        if(current.has(relativePath)) {
            continue
        }

        try {
            const destination = resolveManagedPath(instanceDir, relativePath)
            await fs.remove(destination)
        } catch(err) {
            logger.warn('Falha ao remover arquivo antigo ' + relativePath + ': ' + err.message)
        }
    }
}

async function prepareInstance(options) {
    const commonDir = options.commonDir
    const instanceDir = options.instanceDir
    const javaExec = options.javaExec
    const cacheDir = options.cacheDir || path.join(commonDir, 'celestys-cache')
    const onProgress = options.onProgress || null

    if(commonDir == null || instanceDir == null || javaExec == null) {
        throw new Error('PackManager recebeu parametros incompletos.')
    }

    await fs.ensureDir(commonDir)
    await fs.ensureDir(instanceDir)
    await fs.ensureDir(cacheDir)

    const previousState = await readState(instanceDir)

    report(onProgress, 1, 'Preparando All The Mons 1.3.0 + atualizacoes Celestys...')

    const modOverrideManifest = await fetchCelestysModOverrides()
    const packResult = await syncPackFiles(instanceDir, previousState, modOverrideManifest, onProgress)
    const modOverrideResult = await syncCelestysModOverrides(
        instanceDir,
        previousState,
        modOverrideManifest,
        packResult.replacementSources,
        onProgress
    )
    const overrideFiles = await syncOfficialOverrides(instanceDir, cacheDir, previousState, onProgress)
    const extraResult = await syncCelestysExtras(instanceDir, previousState, onProgress)

    const versionJsonPath = await ensureNeoForge(commonDir, javaExec, cacheDir, onProgress)

    const oldManaged = [
        ...(Array.isArray(previousState.managedFiles) ? previousState.managedFiles : []),
        ...(Array.isArray(previousState.modOverrideFiles) ? previousState.modOverrideFiles : []),
        ...(Array.isArray(previousState.overrideFiles) ? previousState.overrideFiles : []),
        ...(Array.isArray(previousState.extraFiles) ? previousState.extraFiles : [])
    ]

    const newManaged = [
        ...packResult.managedFiles,
        ...modOverrideResult.managedFiles,
        ...overrideFiles,
        ...extraResult.managedFiles
    ]

    await cleanupStaleFiles(instanceDir, oldManaged, newManaged)

    const state = {
        schemaVersion: 2,
        pack: PACK,
        updatedAt: new Date().toISOString(),
        managedFiles: packResult.managedFiles.sort(),
        modOverrideFiles: modOverrideResult.managedFiles.sort(),
        overrideFiles: overrideFiles.sort(),
        overrideSourceCommit: PACK.allTheMonsSourceCommit,
        extraFiles: extraResult.managedFiles.sort(),
        fingerprints: packResult.fingerprints,
        modOverrideFingerprints: modOverrideResult.fingerprints,
        extraFingerprints: extraResult.fingerprints
    }

    await writeState(instanceDir, state)

    const modLoaderData = await fs.readJson(versionJsonPath)

    report(onProgress, 100, 'Celestys atualizado e pronto para jogar.')

    return {
        modLoaderData,
        state,
        versionJsonPath
    }
}

module.exports = {
    PACK,
    prepareInstance,
    findNeoForgeVersionJson
}
