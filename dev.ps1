# Run with: .\dev.ps1
$ErrorActionPreference = "Stop"

# 1) XTTS server
Start-Process powershell -ArgumentList "-NoExit", "-Command", @"
cd services/tts
.\.venv\Scripts\Activate.ps1
uvicorn server:app --host 0.0.0.0 --port 8000
"@

# 2) Wrangler worker
Start-Process cmd -ArgumentList "/k", "cd services\chat && wrangler dev --ip 0.0.0.0 --port 8787"

# 3) Expo client
Start-Process cmd -ArgumentList "/k", "cd apps\client && npm start"
