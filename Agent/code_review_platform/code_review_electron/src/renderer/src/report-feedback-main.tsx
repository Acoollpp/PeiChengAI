import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { ReportFeedbackWindow } from './components/ReportFeedbackWindow'
import './report-feedback.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ReportFeedbackWindow />
  </StrictMode>
)
