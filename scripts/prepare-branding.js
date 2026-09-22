const fs = require('fs-extra')
const got = require('got')
const path = require('path')

const CELESTYS_LOGO_URL = 'https://raw.githubusercontent.com/XKaienX/celestys-site/main/img/celestys.png'

async function main() {
    const response = await got(CELESTYS_LOGO_URL, {
        headers: { 'user-agent': 'CelestysLauncher/1.1' },
        retry: { limit: 2 },
        timeout: { request: 30000 }
    })

    const logo = response.rawBody
    if(!Buffer.isBuffer(logo) || logo.length < 10000) {
        throw new Error('A logo oficial da Celestys retornou um arquivo invalido.')
    }

    const destinations = [
        path.join(__dirname, '..', 'build', 'icon.png'),
        path.join(__dirname, '..', 'app', 'assets', 'images', 'SealCircle.png')
    ]

    for(const destination of destinations) {
        await fs.ensureDir(path.dirname(destination))
        await fs.writeFile(destination, logo)
    }

    console.log('Branding Celestys preparado com sucesso.')
}

main().catch(err => {
    console.error('Falha ao preparar branding Celestys:', err)
    process.exit(1)
})
