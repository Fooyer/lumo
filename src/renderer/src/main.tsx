import React from 'react'
import ReactDOM from 'react-dom/client'
import '@fontsource-variable/nunito'
import App from './App'
import DownloadsFlyout from './components/DownloadsFlyout'
import SettingsFlyout from './components/SettingsFlyout'
import SuggestionsFlyout from './components/SuggestionsFlyout'
import AddressBarOverlay from './components/AddressBarOverlay'
import './App.css'

const hash = window.location.hash
const isDownloadsFlyout = hash === '#downloads-flyout'
const isSettingsFlyout = hash === '#settings-flyout'
const isSuggestionsFlyout = hash === '#suggestions-flyout'
const isAddressBar = hash === '#address-bar'
const isFlyout = isDownloadsFlyout || isSettingsFlyout || isSuggestionsFlyout || isAddressBar

if (isFlyout) {
  document.documentElement.classList.add('flyout-window')
  document.body.classList.add('flyout-window')
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
    ) : (
      <App />
    )}
  </React.StrictMode>
)
