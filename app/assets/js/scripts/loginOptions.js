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
        'CONTA ORIGINAL',
        'A Celestys usa o NeoAuth para autenticar contas Microsoft dentro do Minecraft. Digite exatamente o nick da sua conta original. O jogo abrirá no menu principal; entre em Multiplayer, use o botão do NeoAuth para validar sua conta Microsoft e depois conecte na Celestys.',
        'CONTINUAR'
    )
    setOverlayHandler(() => {
        toggleOverlay(false)
        switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
            if(typeof prepareOriginalLogin === 'function'){
                prepareOriginalLogin(
                    loginOptionsViewOnLoginSuccess || VIEWS.landing,
                    VIEWS.loginOptions
                )
            }
        })
    })
    toggleOverlay(true)
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
