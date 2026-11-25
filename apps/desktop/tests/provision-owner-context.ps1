param([Parameter(Mandatory=$true)][string]$ProvisionScript)
$ErrorActionPreference='Stop'
$tokens=$null;$parseErrors=$null
$tree=[Management.Automation.Language.Parser]::ParseFile($ProvisionScript,[ref]$tokens,[ref]$parseErrors)
if ($parseErrors.Count) { throw 'Provisioning source has parse errors.' }
$function=$tree.Find({param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Assert-NoriProvisionOwnerContext'},$true)
if ($null -eq $function) { throw 'Owner guard missing.' }
# Exercise only the pure guard extracted from the actual source. Do not invoke
# provisioning or pretend the synthetic elevated case is a real elevated token.
. ([scriptblock]::Create($function.Extent.Text))
$owner=[Security.Principal.SecurityIdentifier]::new('S-1-5-21-1-2-3-1001')
Assert-NoriProvisionOwnerContext -CurrentSid $owner -Elevated $false -Applying $true -ExpectedSid $owner.Value
Assert-NoriProvisionOwnerContext -CurrentSid $owner -Elevated $true -Applying $false -ExpectedSid $owner.Value
$rejected=0
foreach ($case in @(
    @{CurrentSid=$owner;Elevated=$true;Applying=$true;ExpectedSid=$owner.Value},
    @{CurrentSid=$owner;Elevated=$false;Applying=$true;ExpectedSid='S-1-5-21-4-5-6-1001'},
    @{CurrentSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-18');Elevated=$false;Applying=$true;ExpectedSid=''},
    @{CurrentSid=$null;Elevated=$false;Applying=$true;ExpectedSid=''},
    @{CurrentSid=$owner;Elevated=$false;Applying=$true;ExpectedSid='not-a-sid'}
)) {
    try { Assert-NoriProvisionOwnerContext @case }
    catch { $rejected++;continue }
    throw 'Invalid owner context was accepted.'
}
[pscustomobject]@{Passed=$true;Accepted=2;Rejected=$rejected;SimulatedContexts=$true;StateCreated=$false} | ConvertTo-Json -Compress
