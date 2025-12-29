import React from 'react'
import ReactDOM from 'react-dom/client'
import { ModelStatusEmbed } from './components/ModelStatusEmbed'
import './index.css'

// Parse URL parameters
const urlParams = new URLSearchParams(window.location.search)
const refreshInterval = parseInt(urlParams.get('refresh') || '60', 10)
const defaultModels = urlParams.get('models')?.split(',').filter(Boolean) || []

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ModelStatusEmbed 
      refreshInterval={refreshInterval}
      defaultModels={defaultModels}
    />
  </React.StrictMode>,
)
