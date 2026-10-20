# Rapatrie chaque jour la dernière sauvegarde chiffrée de Cortège sur ce PC Windows.
# Les fichiers sont chiffrés (age) : ils peuvent aussi aller dans un dossier synchronisé dans le cloud.
# Réglages : adresse du serveur, utilisateur SSH, clé SSH, dossier de destination, nombre de copies gardées.
param(
  [string]$Server = "83.228.211.72",
  [string]$User = "debian",
  [string]$Key = "$HOME\.ssh\neru_vps",
  [string]$Dest = "$HOME\Cortege-sauvegardes",
  [int]$Keep = 30
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force $Dest | Out-Null
$file = Join-Path $Dest ("cortege-" + (Get-Date -Format "yyyy-MM-dd") + ".tar.gz.age")
$log = Join-Path $Dest "journal.txt"
try {
  scp -q -i $Key -o BatchMode=yes -o ConnectTimeout=20 "${User}@${Server}:/var/backups/cortege/latest.tar.gz.age" $file
  if (-not (Test-Path $file) -or (Get-Item $file).Length -lt 1000) { throw "fichier absent ou vide" }
  Add-Content $log ("{0}  OK  {1} ({2} Ko)" -f (Get-Date -Format "yyyy-MM-dd HH:mm"), (Split-Path $file -Leaf), [math]::Round((Get-Item $file).Length / 1KB))
  Get-ChildItem $Dest -Filter "cortege-*.tar.gz.age" | Sort-Object LastWriteTime -Descending | Select-Object -Skip $Keep | Remove-Item
} catch {
  Add-Content $log ("{0}  ÉCHEC  {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm"), $_.Exception.Message)
  exit 1
}
