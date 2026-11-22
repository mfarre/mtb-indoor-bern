param(
    [string]$DotnetPath='dotnet',
    [string]$PythonPath='python',
    [string]$NodePath='node',
    [string]$FfmpegPath='ffmpeg',
    [Parameter(Mandatory=$true)][string]$FitSdkPath,
    [string]$SessionsRoot=(Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'MTB Track Lab'),
    [string]$DefaultSession='',
    [string]$Course=''
)
$ErrorActionPreference='Stop'
$repo=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$publish=Join-Path $repo 'artifacts/track-lab'
if(-not(Test-Path (Join-Path $FitSdkPath 'src/index.js'))){throw 'FitSdkPath must point to the @garmin/fitsdk package folder.'}
& $DotnetPath publish (Join-Path $repo 'src/TrackLab/TrackLab.csproj') -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -o $publish
if($LASTEXITCODE-ne 0){throw 'Build failed.'}
New-Item -ItemType Directory -Force (Join-Path $publish 'Scripts'),(Join-Path $publish 'FitSdk') | Out-Null
Copy-Item -Path (Join-Path $PSScriptRoot '*.py'),(Join-Path $PSScriptRoot '*.mjs') -Destination (Join-Path $publish 'Scripts') -Force
Copy-Item -Path (Join-Path $FitSdkPath '*') -Destination (Join-Path $publish 'FitSdk') -Recurse -Force
$configuration=@{defaultSession=$DefaultSession;sessionsRoot=$SessionsRoot;python=$PythonPath;node=$NodePath;ffmpeg=$FfmpegPath;course=$Course}
$configuration | ConvertTo-Json | Set-Content (Join-Path $publish 'config.json') -Encoding utf8
Write-Output "Track Lab: $publish/TrackLab.exe"
