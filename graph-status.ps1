function Get-MemberValue {
    param($Object, [string]$Name)
    if ($null -eq $Object) { return $null }
    $property = $Object.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function Get-GraphHttpStatus {
    param($ErrorRecord)
    if ($null -eq $ErrorRecord) { return 0 }
    $current = Get-MemberValue $ErrorRecord 'Exception'
    for ($depth = 0; $null -ne $current -and $depth -lt 5; $depth++) {
        $candidates = @(
            (Get-MemberValue (Get-MemberValue $current 'Response') 'StatusCode'),
            (Get-MemberValue $current 'StatusCode')
        )
        foreach ($candidate in $candidates) {
            if ($null -eq $candidate -or $candidate -eq '') { continue }
            $code = 0
            try { $code = [int]$candidate } catch { continue }
            if ($code -ge 100 -and $code -le 599) { return $code }
        }
        $current = Get-MemberValue $current 'InnerException'
    }
    $message = [string](Get-MemberValue (Get-MemberValue $ErrorRecord 'Exception') 'Message')
    if ($message -match 'does not indicate success:\s+[^(]*\((\d{3})\)') { return [int]$Matches[1] }
    return 0
}
