const loginOptionsCancelContainer = document.getElementById('loginOptionCancelContainer')
const loginOptionMicrosoft = document.getElementById('loginOptionMicrosoft')
const loginOptionMojang = document.getElementById('loginOptionMojang')
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
        'A autenticação de conta original é feita pelo NeoAuth dentro do Minecraft. Clique em CONTINUAR, entre com o mesmo nick da sua conta original e inicie o jogo. Se o Minecraft pedir reautenticação, use o botão Re-Login do NeoAuth e entre na Microsoft. Depois disso, o DirectAuth pode reconhecer sua conta original normalmente.',
        'CONTINUAR'
    )
    setOverlayHandler(() => {
        toggleOverlay(false)
        const viewOnSuccess = loginOptionsViewOnLoginSuccess || VIEWS.landing
        switchView(getCurrentView(), VIEWS.login, 250, 500, () => {
            if(typeof prepareOfflineLogin === 'function'){
                prepareOfflineLogin(viewOnSuccess, VIEWS.loginOptions)
            }
        })
    })
    toggleOverlay(true)
}

loginOptionMojang.onclick = () => {
    switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
        loginViewOnSuccess = loginOptionsViewOnLoginSuccess
        loginViewOnCancel = loginOptionsViewOnLoginCancel
        loginCancelEnabled(true)
        if(typeof setOfflineMode === 'function'){
            setOfflineMode(false)
        }
    })
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
