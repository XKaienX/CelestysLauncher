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
    const viewOnSuccess = loginOptionsViewOnLoginSuccess || VIEWS.landing
    switchView(getCurrentView(), VIEWS.login, 500, 500, () => {
        if(typeof preparePremiumLogin === 'function'){
            preparePremiumLogin(viewOnSuccess, VIEWS.loginOptions)
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
