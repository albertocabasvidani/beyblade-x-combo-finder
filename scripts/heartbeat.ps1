# Battito cardiaco per diagnosticare la morte della pipeline.
#
# Lanciato da daily-pipeline.bat con "start /b", quindi vive NELLA STESSA CONSOLE del
# batch. E' questo il punto: condivide la sorte della console, non quella di cmd.exe.
# Leggendo dove si ferma il battito rispetto all'ultimo marker della pipeline si
# distinguono due famiglie di cause che finora non riuscivo a separare:
#
#   battito si ferma NELLO STESSO ISTANTE dell'ultimo marker
#     -> e' stata uccisa l'intera console (evento CTRL+C al gruppo di processi,
#        taskkill sull'albero, chiusura della finestra): il colpevole e' esterno al bat
#
#   battito CONTINUA dopo l'ultimo marker
#     -> la console e' viva ed e' uscito solo cmd.exe: il colpevole e' nel bat
#        o in come claude termina
#
# Si ferma da solo quando il batch cancella il flag, o dopo 4 ore (se il batch muore
# senza cancellarlo, il battito non resta a girare per sempre).
param(
    [Parameter(Mandatory = $true)][string]$LogPath,
    [Parameter(Mandatory = $true)][string]$FlagPath
)

$ErrorActionPreference = 'SilentlyContinue'
$scadenza = (Get-Date).AddHours(4)

Add-Content -Path $LogPath -Value ("[{0}] BATTITO START pid={1}" -f (Get-Date -Format 'dd/MM/yyyy HH:mm:ss'), $PID)

while ((Get-Date) -lt $scadenza) {
    Start-Sleep -Seconds 30
    if (-not (Test-Path $FlagPath)) {
        Add-Content -Path $LogPath -Value ("[{0}] BATTITO FINE (flag rimosso: la pipeline e' arrivata in fondo)" -f (Get-Date -Format 'dd/MM/yyyy HH:mm:ss'))
        exit 0
    }
    Add-Content -Path $LogPath -Value ("[{0}] battito" -f (Get-Date -Format 'dd/MM/yyyy HH:mm:ss'))
}

Add-Content -Path $LogPath -Value ("[{0}] BATTITO FINE (scadute le 4 ore: il flag non e' mai stato rimosso)" -f (Get-Date -Format 'dd/MM/yyyy HH:mm:ss'))
