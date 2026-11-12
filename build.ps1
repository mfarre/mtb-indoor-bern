param(
    [ValidateSet('Debug','Release')][string]$Configuration = 'Release',
    [string]$DotnetPath = 'dotnet',
    [switch]$SelfTest
)
$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'src/MTBIndoorBern/MTBIndoorBern.csproj'
$output = Join-Path $PSScriptRoot 'artifacts/publish/win-x64'
& $DotnetPath publish $project -c $Configuration -r win-x64 --self-contained true '-p:PublishSingleFile=true' '-p:IncludeNativeLibrariesForSelfExtract=true' -o $output
if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
if ($SelfTest) {
    $report = Join-Path $PSScriptRoot 'artifacts/self-test.txt'
    $exe = Join-Path $output 'MTBIndoorBern.exe'
    $process = Start-Process -FilePath $exe -ArgumentList @('--self-test', ('"' + $report + '"')) -WindowStyle Hidden -PassThru
    if (!$process.WaitForExit(30000)) { throw 'Self-test timed out.' }
    if ($process.ExitCode -ne 0) { throw (Get-Content -LiteralPath $report -Raw) }
    Get-Content -LiteralPath $report
}
Write-Output "Application: $output\MTBIndoorBern.exe"

