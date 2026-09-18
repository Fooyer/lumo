/// <reference types="vite/client" />

import type { LumoApi } from '../../preload/index'

declare global {
  interface Window {
    lumo: LumoApi
  }
}
