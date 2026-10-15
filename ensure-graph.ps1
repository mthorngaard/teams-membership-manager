param([switch]$Quiet)

$ErrorActionPreference = 'Stop'
$moduleName = 'Microsoft.Graph.Authentication'

try {
    $installed = Get-Module -ListAvailable -Name $moduleName |
        Sort-Object Version -Descending | Select-Object -First 1
    if (-not $installed) {
        if (-not $Quiet) { Write-Host 'The Graph module is missing. Installing it from the PowerShell Gallery for the current user...' }
        Install-Module -Name $moduleName -Repository PSGallery -Scope CurrentUser -Force -AllowClobber -AcceptLicense -ErrorAction Stop
        $installed = Get-Module -ListAvailable -Name $moduleName |
            Sort-Object Version -Descending | Select-Object -First 1
        if (-not $installed) { throw 'The module could not be found after installation.' }
    }
    Import-Module -Name $installed.Path -ErrorAction Stop
    if (-not $Quiet) { Write-Host "The Graph module is ready (version $($installed.Version))." }
} catch {
    throw "The Graph module could not be prepared: $($_.Exception.Message). Check internet access to the PowerShell Gallery and permission to install modules for your user."
}
