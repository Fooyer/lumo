import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/nunito'
import App from './App'
import DownloadsFlyout from './components/DownloadsFlyout'
import SettingsFlyout from './components/SettingsFlyout'
import SuggestionsFlyout from './components/SuggestionsFlyout'
import AddressBarOverlay from './components/AddressBarOverlay'
import Mascot from './mascot/Mascot'
import MascotChat from './mascot/MascotChat'
import './mascot/mascot.css'
import './App.css'

const hash = window.location.hash
const isDownloadsFlyout = hash === '#downloads-flyout'
const isSettingsFlyout = hash === '#settings-flyout'
const isSuggestionsFlyout = hash === '#suggestions-flyout'
const isAddressBar = hash === '#address-bar'
const isMascot = hash === '#mascot'
const isMascotChat = hash === '#mascot-chat'
const isFlyout = isDownloadsFlyout || isSettingsFlyout || isSuggestionsFlyout || isAddressBar

if (isFlyout) {
  document.documentElement.classList.add('flyout-window')
  document.body.classList.add('flyout-window')
}
if (isMascot || isMascotChat) {
  const cls = isMascot ? 'mascot-window' : 'mascot-chat-window'
  document.documentElement.classList.add(cls)
  document.body.classList.add(cls)
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {isDownloadsFlyout ? (
      <DownloadsFlyout />
    ) : isSettingsFlyout ? (
      <SettingsFlyout />
    ) : isSuggestionsFlyout ? (
      <SuggestionsFlyout />
    ) : isAddressBar ? (
      <AddressBarOverlay />
    ) : isMascot ? (
      <Mascot />
    ) : isMascotChat ? (
      <MascotChat />
    ) : (
      <App />
    )}
  </React.StrictMode>
)
