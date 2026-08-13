import React from 'react'
import ReactDOM from 'react-dom/client'

import { createFixtureWorkbenchAdapter } from './workbench-preview/fixture-adapter'
import { ReviewWorkbenchPreview } from './workbench-preview/ReviewWorkbenchPreview'
import './styles.css'
import './workbench-preview/workbench-preview.css'

const adapter = createFixtureWorkbenchAdapter()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ReviewWorkbenchPreview adapter={adapter} />
  </React.StrictMode>
)
