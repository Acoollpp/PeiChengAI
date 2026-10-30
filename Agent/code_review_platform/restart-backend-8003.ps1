$venvPython = 'C:\Users\admin\Documents\Codex\2026-10-22\nin\work\backend-venv\Scripts\python.exe'
$backendDir = 'D:\资料\D盘\PeiChengAI\Agent\code_review_platform\code_review_server\backend'
$outLog = 'D:\资料\D盘\PeiChengAI\Agent\code_review_platform\.local-backend-8003.out.log'
$errLog = 'D:\资料\D盘\PeiChengAI\Agent\code_review_platform\.local-backend-8003.err.log'
$p = Start-Process -FilePath $venvPython -ArgumentList @('-m','uvicorn','app.main:app','--host','0.0.0.0','--port','8003') -WorkingDirectory $backendDir -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
Write-Output "started backend PID: $($p.Id)"
