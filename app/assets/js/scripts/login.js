// Arquivo: app/assets/js/scripts/login.js

/**
 * Script for login.ejs
 */
// Validation Regexes.
const crypto                = require('crypto')
const validUsername         = /^[a-zA-Z0-9_]{1,16}$/
const basicEmail            = /^\S+@\S+\.\S+$/
//const validEmail          = /^(([^<>()\[\]\.,;:\s@\"]+(\.[^<>()\[\]\.,;:\s@\"]+)*)|(\".+\"))@(([^<>()[\]\.,;:\s@\"]+\.)+[^<>()[\]\.,;:\s@\"]{2,})$/i

// Login Elements
const loginCancelContainer  = document.getElementById('loginCancelContainer')
const loginCancelButton     = document.getElementById('loginCancelButton')
const loginEmailError       = document.getElementById('loginEmailError')
const loginUsername         = document.getElementById('loginUsername')
const loginPasswordError    = document.getElementById('loginPasswordError')
const loginPassword         = document.getElementById('loginPassword')
const checkmarkContainer    = document.getElementById('checkmarkContainer')
const loginRememberOption   = document.getElementById('loginRememberOption')
const loginButton           = document.getElementById('loginButton')
const loginForm             = document.getElementById('loginForm')
const loginSubheader        = document.getElementById('loginSubheader')
const loginNeoAuthHint      = document.getElementById('loginNeoAuthHint')
const defaultLoginSubheaderText = loginSubheader != null ? loginSubheader.innerHTML : 'LOGIN MINECRAFT'
const defaultLoginUsernamePlaceholder = loginUsername != null ? loginUsername.placeholder : 'E-MAIL OU USUARIO'

// Control variables.
let lu = false, lp = false

// --- CUSTOM: Nickname login state ---
// Both offline and NeoAuth modes launch Minecraft with a local session.
// NeoAuth then upgrades the session in-game for players who own Minecraft.
let isOfflineMode = false
let isNeoAuthMode = false

function setOfflineMode(offline){
    isOfflineMode = offline
    if(!offline){
        isNeoAuthMode = false
    }
    const checkbox = document.getElementById('loginOfflineOption')
    if(checkbox != null && checkbox.checked !== offline){
        checkbox.checked = offline
    }
    toggleOfflineModeUI(offline)
}

// --- CUSTOM: Toggle UI for Offline Mode (LIMPEZA VISUAL) ---
function toggleOfflineModeUI(offline) {
    // Elementos visuais para manipular
    const passwordInput = document.getElementById('loginPassword');
    
    // Reuse the password field container so icon and input are hidden together.
    const passwordContainer = passwordInput ? passwordInput.closest('.loginFieldContainer') : null;

    const checkboxContainer = document.getElementById('loginOfflineOption')?.parentElement;
    const loginOptionsDiv = document.getElementById('loginOptions'); 
    const header = loginSubheader;
    const loginDisclaimer = document.getElementById('loginDisclaimer'); 
    const loginRegisterSpan = document.getElementById('loginRegisterSpan'); 

    if (offline) {
        // === MODO OFFLINE ATIVADO ===
        
        // 1. Esconde o container da senha (o cadeado vai junto!)
        if(passwordContainer) passwordContainer.style.display = 'none';
        
        // 2. Esconde o resto
        if(checkboxContainer) checkboxContainer.style.display = 'flex';
        if(loginOptionsDiv) loginOptionsDiv.style.display = 'none';
        if(loginDisclaimer) loginDisclaimer.style.display = 'none';
        if(loginRegisterSpan) loginRegisterSpan.style.display = 'none';

        // 3. Ajusta textos conforme o tipo escolhido.
        if(header) header.innerHTML = isNeoAuthMode ? 'CONTA ORIGINAL • NEOAUTH' : 'LOGIN OFFLINE';
        if(loginUsername) loginUsername.placeholder = isNeoAuthMode ? 'NICK DA SUA CONTA ORIGINAL' : 'DIGITE SEU NICK';
        if(loginNeoAuthHint) loginNeoAuthHint.style.display = isNeoAuthMode ? 'block' : 'none';

        // 4. State updates
        if(passwordInput) passwordInput.value = '';
        lp = true; 
        if(loginUsername) validateEmail(loginUsername.value);

    } else {
        // === MODO ONLINE (MOJANG) ===
        // Restaura tudo
        
        // --- Traz o container da senha de volta ---
        if(passwordContainer) passwordContainer.style.display = 'flex';

        if(checkboxContainer) checkboxContainer.style.display = 'flex';
        if(loginOptionsDiv) loginOptionsDiv.style.display = 'flex';
        if(loginDisclaimer) loginDisclaimer.style.display = 'flex'; 
        if(loginRegisterSpan) loginRegisterSpan.style.display = 'block';

        if(header) header.innerHTML = defaultLoginSubheaderText
        if(loginUsername) loginUsername.placeholder = defaultLoginUsernamePlaceholder
        if(loginNeoAuthHint) loginNeoAuthHint.style.display = 'none'

        lp = false; 
    }
}

// Helper to generate UUID from string (Offline)
function getOfflineUUID(username) {
    const digest = crypto.createHash('md5').update(`OfflinePlayer:${username}`, 'utf8').digest()
    digest[6] = (digest[6] & 0x0f) | 0x30
    digest[8] = (digest[8] & 0x3f) | 0x80
    const hex = digest.toString('hex')
    return `${hex.substring(0, 8)}-${hex.substring(8, 12)}-${hex.substring(12, 16)}-${hex.substring(16, 20)}-${hex.substring(20, 32)}`
}

// Initialize Custom UI
setOfflineMode(false)


/**
 * Show a login error.
 * * @param {HTMLElement} element The element on which to display the error.
 * @param {string} value The error text.
 */
function showError(element, value){
    element.innerHTML = value
    element.style.opacity = 1
}

/**
 * Shake a login error to add emphasis.
 * * @param {HTMLElement} element The element to shake.
 */
function shakeError(element){
    if(element.style.opacity == 1){
        element.classList.remove('shake')
        void element.offsetWidth
        element.classList.add('shake')
    }
}

/**
 * Validate that an email field is neither empty nor invalid.
 * * @param {string} value The email value.
 */
function validateEmail(value){
    const normalizedValue = typeof value === 'string' ? value.trim() : ''
    if(normalizedValue){
        const valid = isOfflineMode
            ? validUsername.test(normalizedValue)
            : (basicEmail.test(normalizedValue) || validUsername.test(normalizedValue))

        if(!valid){
            showError(loginEmailError, Lang.queryJS('login.error.invalidValue'))
            loginDisabled(true)
            lu = false
        } else {
            loginEmailError.style.opacity = 0
            lu = true
            if(lp){
                loginDisabled(false)
            }
        }
    } else {
        lu = false
        showError(loginEmailError, Lang.queryJS('login.error.requiredValue'))
        loginDisabled(true)
    }
}

/**
 * Validate that the password field is not empty.
 * * @param {string} value The password value.
 */
function validatePassword(value){
    if(isOfflineMode) return; // Skip validation in offline mode

    if(value){
        loginPasswordError.style.opacity = 0
        lp = true
        if(lu){
            loginDisabled(false)
        }
    } else {
        lp = false
        showError(loginPasswordError, Lang.queryJS('login.error.invalidValue'))
        loginDisabled(true)
    }
}

// Emphasize errors with shake when focus is lost.
loginUsername.addEventListener('focusout', (e) => {
    validateEmail(e.target.value)
    shakeError(loginEmailError)
})
loginPassword.addEventListener('focusout', (e) => {
    validatePassword(e.target.value)
    shakeError(loginPasswordError)
})
// Validate input for each field.
loginUsername.addEventListener('input', (e) => {
    validateEmail(e.target.value)
})
loginPassword.addEventListener('input', (e) => {
    validatePassword(e.target.value)
})

/**
 * Enable or disable the login button.
 * * @param {boolean} v True to enable, false to disable.
 */
function loginDisabled(v){
    if(loginButton.disabled !== v){
        loginButton.disabled = v
    }
}

/**
 * Enable or disable loading elements.
 * * @param {boolean} v True to enable, false to disable.
 */
function loginLoading(v){
    if(v){
        loginButton.setAttribute('loading', v)
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.login'), Lang.queryJS('login.loggingIn'))
    } else {
        loginButton.removeAttribute('loading')
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.loggingIn'), Lang.queryJS('login.login'))
    }
}

/**
 * Enable or disable login form.
 * * @param {boolean} v True to enable, false to disable.
 */
function formDisabled(v){
    loginDisabled(v)
    loginCancelButton.disabled = v
    loginUsername.disabled = v
    // Only disable password if not already disabled by offline mode
    if(!isOfflineMode) loginPassword.disabled = v
    
    if(v){
        checkmarkContainer.setAttribute('disabled', v)
    } else {
        checkmarkContainer.removeAttribute('disabled')
    }
    loginRememberOption.disabled = v
}

let loginViewOnSuccess = VIEWS.landing
let loginViewOnCancel = VIEWS.settings
let loginViewCancelHandler

function prepareOfflineLogin(viewOnSuccess = VIEWS.landing, viewOnCancel = VIEWS.loginOptions){
    isNeoAuthMode = false
    loginViewOnSuccess = viewOnSuccess
    loginViewOnCancel = viewOnCancel
    loginCancelEnabled(true)
    setOfflineMode(true)
    loginUsername.value = ''
    loginPassword.value = ''
    loginEmailError.style.opacity = 0
    loginPasswordError.style.opacity = 0
    loginDisabled(true)
}

function preparePremiumLogin(viewOnSuccess = VIEWS.landing, viewOnCancel = VIEWS.loginOptions){
    isNeoAuthMode = true
    loginViewOnSuccess = viewOnSuccess
    loginViewOnCancel = viewOnCancel
    loginCancelEnabled(true)
    setOfflineMode(true)
    loginUsername.value = ''
    loginPassword.value = ''
    loginEmailError.style.opacity = 0
    loginPasswordError.style.opacity = 0
    loginDisabled(true)
}

globalThis.prepareOfflineLogin = prepareOfflineLogin
globalThis.preparePremiumLogin = preparePremiumLogin

function loginCancelEnabled(val){
    if(val){
        $(loginCancelContainer).show()
    } else {
        $(loginCancelContainer).hide()
    }
}

loginCancelButton.onclick = (e) => {
    switchView(getCurrentView(), loginViewOnCancel, 500, 500, () => {
        loginUsername.value = ''
        loginPassword.value = ''
        setOfflineMode(false)
        loginCancelEnabled(false)
        if(loginViewCancelHandler != null){
            loginViewCancelHandler()
            loginViewCancelHandler = null
        }
    })
}

// Disable default form behavior.
loginForm.onsubmit = () => { return false }

// Bind login button behavior.
loginButton.addEventListener('click', () => {
    // Disable form.
    formDisabled(true)

    // Show loading stuff.
    loginLoading(true)

    // --- CUSTOM: Branch for Offline Login ---
    if(isOfflineMode) {
        const username = loginUsername.value.trim()

        if(!validUsername.test(username)){
            loginLoading(false)
            formDisabled(false)
            showError(loginEmailError, Lang.queryJS('login.error.invalidValue'))
            return
        }

        const uuid = getOfflineUUID(username)

        // Simula delay de login
        setTimeout(async () => {
            try {
                const authMode = isNeoAuthMode ? 'neoauth' : 'offline'
                const offlineAuth = ConfigManager.addOfflineAuthAccount(uuid, username, authMode)
                ConfigManager.save()
                updateSelectedAccount(offlineAuth)

                loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.loggingIn'), Lang.queryJS('login.success'))
                $('.circle-loader').toggleClass('load-complete')
                $('.checkmark').toggle()

                setTimeout(() => {
                    switchView(VIEWS.login, loginViewOnSuccess, 500, 500, async () => {
                        if(loginViewOnSuccess === VIEWS.settings){
                            await prepareSettings()
                        }

                        loginViewOnSuccess = VIEWS.landing
                        loginCancelEnabled(false)
                        loginViewCancelHandler = null
                        loginUsername.value = ''
                        loginPassword.value = ''
                        setOfflineMode(false)

                        $('.circle-loader').toggleClass('load-complete')
                        $('.checkmark').toggle()
                        loginLoading(false)
                        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.success'), Lang.queryJS('login.login'))
                        formDisabled(false)
                    })
                }, 1000)

            } catch (err) {
                console.error('Offline Login Error', err)
                loginLoading(false)
                formDisabled(false)
                showError(loginEmailError, `Erro ao salvar: ${err.message}`)
            }
        }, 500)

        return // Encerra o fluxo offline aqui
    }

    // Original Online Login Flow
    AuthManager.addMojangAccount(loginUsername.value, loginPassword.value).then((value) => {
        updateSelectedAccount(value)
        loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.loggingIn'), Lang.queryJS('login.success'))
        $('.circle-loader').toggleClass('load-complete')
        $('.checkmark').toggle()
        setTimeout(() => {
            switchView(VIEWS.login, loginViewOnSuccess, 500, 500, async () => {
                // Temporary workaround
                if(loginViewOnSuccess === VIEWS.settings){
                    await prepareSettings()
                }
                loginViewOnSuccess = VIEWS.landing // Reset this for good measure.
                loginCancelEnabled(false) // Reset this for good measure.
                loginViewCancelHandler = null // Reset this for good measure.
                loginUsername.value = ''
                loginPassword.value = ''
                setOfflineMode(false)
                $('.circle-loader').toggleClass('load-complete')
                $('.checkmark').toggle()
                loginLoading(false)
                loginButton.innerHTML = loginButton.innerHTML.replace(Lang.queryJS('login.success'), Lang.queryJS('login.login'))
                formDisabled(false)
            })
        }, 1000)
    }).catch((displayableError) => {
        loginLoading(false)

        let actualDisplayableError
        if(isDisplayableError(displayableError)) {
            // msftLoginLogger.error('Error while logging in.', displayableError)
            actualDisplayableError = displayableError
        } else {
            // Uh oh.
            // msftLoginLogger.error('Unhandled error during login.', displayableError)
            actualDisplayableError = Lang.queryJS('login.error.unknown')
        }

        setOverlayContent(actualDisplayableError.title, actualDisplayableError.desc, Lang.queryJS('login.tryAgain'))
        setOverlayHandler(() => {
            formDisabled(false)
            toggleOverlay(false)
        })
        toggleOverlay(true)
    })

})
