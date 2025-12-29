import React from 'react'
import ReactDOM from 'react-dom/client'
import { ModelStatusEmbed } from './components/ModelStatusEmbed'
import './index.css'

// Parse URL parameters
const urlParams = new URLSearchParams(window.location.search)
const refreshInterval = parseInt(urlParams.get('refresh') || '60', 10)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ModelStatusEmbed refreshInterval={refreshInterval} />
  </React.StrictMode>,
)
