$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot 'graph-status.ps1')
$moduleReady = $false
while ($null -ne ($line = [Console]::ReadLine())) {
    $command = $null
    try {
        $command = $line | ConvertFrom-Json
        if (-not $moduleReady) {
            . (Join-Path $PSScriptRoot 'ensure-graph.ps1') -Quiet
            $moduleReady = $true
        }
        $result = $null
        switch ($command.action) {
            'login' {
                # Use Microsoft's own Graph PowerShell application, with a process-local context.
                Connect-MgGraph -Scopes @($command.scopes) -ContextScope Process -UseDeviceCode -NoWelcome -InformationAction Continue 6>&1 | ForEach-Object {
                    if ($_ -is [string] -or $_ -is [System.Management.Automation.InformationRecord]) {
                        [Console]::WriteLine('GRAPH:' + (@{ id = $command.id; event = 'loginMessage'; message = [string]$_ } | ConvertTo-Json -Compress))
                    }
                }
                $result = Invoke-MgGraphRequest -Method GET -Uri 'https://graph.microsoft.com/v1.0/me?$select=displayName,userPrincipalName' -OutputType PSObject
            }
            'request' {
                if (-not (Get-MgContext)) { throw 'Sign in with Microsoft first.' }
                $uri = [Uri]$command.url
                if ($uri.Scheme -ne 'https' -or $uri.Host -ne 'graph.microsoft.com' -or -not $uri.AbsolutePath.StartsWith('/v1.0/')) { throw 'Invalid Graph link.' }
                if ($command.method -notin @('GET','POST')) { throw 'Invalid method.' }
                $parameters = @{ Method = $command.method; Uri = $uri.AbsoluteUri; OutputType = 'PSObject' }
                if ($null -ne $command.body) { $parameters.Body = $command.body | ConvertTo-Json -Depth 30 -Compress; $parameters.ContentType = 'application/json' }
                $result = Invoke-MgGraphRequest @parameters
            }
            default { throw 'Unknown Graph command.' }
        }
        [Console]::WriteLine('GRAPH:' + (@{ id = $command.id; data = $result } | ConvertTo-Json -Depth 50 -Compress))
    } catch {
        $status = Get-GraphHttpStatus -ErrorRecord $_
        $errorMessage = $_.Exception.Message
        if ($_.ErrorDetails.Message) {
            try {
                $graphError = $_.ErrorDetails.Message | ConvertFrom-Json
                if ($graphError.error.message) { $errorMessage += ' ' + $graphError.error.message }
            } catch { }
        }
        [Console]::WriteLine('GRAPH:' + (@{ id = $command.id; error = $errorMessage; status = $status } | ConvertTo-Json -Depth 10 -Compress))
    }
}
if ($moduleReady -and (Get-MgContext)) { Disconnect-MgGraph | Out-Null }
