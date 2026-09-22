const loginOptionsCancelContainer = document.getElementById('loginOptionCancelContainer')
const loginOptionMicrosoft = document.getElementById('loginOptionMicrosoft')
const loginOptionOffline = document.getElementById('loginOptionOffline')
const loginOptionsCancelButton = document.getElementById('loginOptionCancelButton')

let loginOptionsViewOnLoginSuccess
let loginOptionsViewOnLoginCancel
let loginOptionsViewOnCancel
let loginOptionsViewCancelHandler

function loginOptionsCancelEnabled(val){
    if(val){
        $(loginOptionsCancelContainer).show()
    } else {
        $(loginOptionsCancelContainer).hide()
    }
}

loginOptionMicrosoft.onclick = () => {
    setOverlayContent(
        'MINECRAFT ORIGINAL',
        'A Celestys usa o NeoAuth para autenticar contas originais dentro do Minecraft. Informe abaixo o nick EXATO da sua conta Microsoft. Ao abrir o jogo, se aparecer "Invalid session", clique em "Re-Login", escolha Microsoft, entre na sua conta e reconecte ao servidor.',
        'CONTINUAR',
        'VOLTAR'
    )
    setOverlayHandler(() => {
        toggleOverlay(false)
        switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
            const viewOnSuccess = loginOptionsViewOnLoginSuccess || VIEWS.landing
            if(typeof prepareNeoAuthLogin === 'function'){
                prepareNeoAuthLogin(viewOnSuccess, VIEWS.loginOptions)
            }
        })
    })
    setDismissHandler(() => toggleOverlay(false))
    toggleOverlay(true, true)
}

loginOptionOffline.onclick = () => {
    const viewOnSuccess = loginOptionsViewOnLoginSuccess || VIEWS.landing
    switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
        if(typeof prepareOfflineLogin === 'function'){
            prepareOfflineLogin(viewOnSuccess, VIEWS.loginOptions)
        }
    })
}

loginOptionsCancelButton.onclick = () => {
    switchView(getCurrentView(), loginOptionsViewOnCancel, 500, 500, () => {
        if(loginOptionsViewCancelHandler != null){
            loginOptionsViewCancelHandler()
            loginOptionsViewCancelHandler = null
        }
    })
}
