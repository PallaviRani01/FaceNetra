# FaceNetra — Start Backend
# Run this from the e:\FaceNetra\backend directory

Write-Host "Starting FaceNetra Backend..." -ForegroundColor Cyan
Set-Location $PSScriptRoot
.\venv\Scripts\python.exe -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
