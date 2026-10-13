param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = Join-Path $projectRoot '.local-data/android-toolchain'
$downloadRoot = Join-Path $toolRoot 'downloads'
New-Item -ItemType Directory -Path $downloadRoot -Force | Out-Null

function Get-Text($Response) {
    if ($Response.Content -is [byte[]]) { return [Text.Encoding]::UTF8.GetString($Response.Content) }
    return [string]$Response.Content
}

function Download-Verified([string]$Url, [string]$Name, [string]$Hash = '', [string]$Algorithm = 'SHA256') {
    $destination = Join-Path $downloadRoot $Name
    if (!(Test-Path -LiteralPath $destination)) {
        Write-Host "Downloading $Name"
        Invoke-WebRequest -Uri $Url -OutFile $destination -TimeoutSec 300
    }
    if ($Hash -and (Get-FileHash -LiteralPath $destination -Algorithm $Algorithm).Hash -ne $Hash) {
        throw "Checksum verification failed: $Name"
    }
    return $destination
}

Write-Output 'Resolving official Android SDK archives'
$repository = [xml](Get-Text (Invoke-WebRequest -Uri 'https://dl.google.com/android/repository/repository2-3.xml' -TimeoutSec 30))
foreach ($spec in @(@{ Package = 'platforms;android-35'; Folder = 'platform' }, @{ Package = 'build-tools;35.0.0'; Folder = 'build-tools' })) {
    $package = $repository.SelectSingleNode("//*[local-name()='remotePackage' and @path='$($spec.Package)']")
    $archive = $package.SelectNodes("*[local-name()='archives']/*[local-name()='archive']") | Where-Object {
        $hostNode = $_.SelectSingleNode("*[local-name()='host-os']")
        !$hostNode -or $hostNode.InnerText -eq 'windows'
    } | Select-Object -First 1
    $complete = $archive.SelectSingleNode("*[local-name()='complete']")
    $url = $complete.SelectSingleNode("*[local-name()='url']").InnerText
    $hash = $complete.SelectSingleNode("*[local-name()='checksum']").InnerText
    $file = Download-Verified "https://dl.google.com/android/repository/$url" $url $hash 'SHA1'
    $unpack = Join-Path $toolRoot $spec.Folder
    if (!(Test-Path -LiteralPath $unpack)) {
        Write-Output "Extracting $($spec.Package)"
        Expand-Archive -LiteralPath $file -DestinationPath $unpack
    }
}

Write-Output 'Resolving Eclipse Temurin JDK 21'
$jdk = Invoke-RestMethod -Uri 'https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=windows&vendor=eclipse' -TimeoutSec 30
$package = $jdk[0].binary.package
$jdkFile = Download-Verified $package.link $package.name $package.checksum
$jdkDirectory = Join-Path $toolRoot 'jdk'
if (!(Test-Path -LiteralPath $jdkDirectory)) { Expand-Archive -LiteralPath $jdkFile -DestinationPath $jdkDirectory }

Write-Output 'Downloading AndroidX WebKit'
$webkitRoot = 'https://dl.google.com/dl/android/maven2/androidx/webkit/webkit/1.12.1/webkit-1.12.1'
$webkitHash = (Get-Text (Invoke-WebRequest -Uri "$webkitRoot.aar.sha256" -TimeoutSec 30)).Trim()
$webkitFile = Download-Verified "$webkitRoot.aar" 'webkit-1.12.1.zip' $webkitHash
$webkitDirectory = Join-Path $toolRoot 'webkit'
if (!(Test-Path -LiteralPath $webkitDirectory)) { Expand-Archive -LiteralPath $webkitFile -DestinationPath $webkitDirectory }
$sourceFile = Download-Verified "$webkitRoot-sources.jar" 'webkit-sources.zip'
$sourceDirectory = Join-Path $toolRoot 'webkit-sources'
if (!(Test-Path -LiteralPath $sourceDirectory)) { Expand-Archive -LiteralPath $sourceFile -DestinationPath $sourceDirectory }
Write-Output 'Downloading AndroidX support libraries'
$coreRoot = 'https://dl.google.com/dl/android/maven2/androidx/core/core/1.1.0/core-1.1.0'
$coreHash = (Get-Text (Invoke-WebRequest -Uri "$coreRoot.aar.sha1" -TimeoutSec 30)).Trim()
$coreFile = Download-Verified "$coreRoot.aar" 'core-1.1.0.zip' $coreHash 'SHA1'
$coreDirectory = Join-Path $toolRoot 'core'
if (!(Test-Path -LiteralPath $coreDirectory)) { Expand-Archive -LiteralPath $coreFile -DestinationPath $coreDirectory }
$annotationRoot = 'https://dl.google.com/dl/android/maven2/androidx/annotation/annotation-jvm/1.8.1/annotation-jvm-1.8.1'
$annotationHash = (Get-Text (Invoke-WebRequest -Uri "$annotationRoot.jar.sha256" -TimeoutSec 30)).Trim()
$annotationFile = Download-Verified "$annotationRoot.jar" 'annotation-jvm.jar' $annotationHash
Copy-Item -LiteralPath $annotationFile -Destination (Join-Path $toolRoot 'annotation-jvm.jar') -Force
Write-Output 'Downloading AndroidX runtime dependencies'
$libraryDirectory = Join-Path $toolRoot 'libraries'
New-Item -ItemType Directory -Path $libraryDirectory -Force | Out-Null
$dependencies = @(
    @{ Group = 'androidx.lifecycle'; Name = 'lifecycle-common'; Version = '2.0.0'; Type = 'jar' },
    @{ Group = 'androidx.lifecycle'; Name = 'lifecycle-runtime'; Version = '2.0.0'; Type = 'aar' },
    @{ Group = 'androidx.arch.core'; Name = 'core-common'; Version = '2.0.0'; Type = 'jar' },
    @{ Group = 'androidx.arch.core'; Name = 'core-runtime'; Version = '2.0.0'; Type = 'aar' },
    @{ Group = 'androidx.collection'; Name = 'collection'; Version = '1.0.0'; Type = 'jar' },
    @{ Group = 'androidx.versionedparcelable'; Name = 'versionedparcelable'; Version = '1.1.0'; Type = 'aar' }
)
foreach ($dependency in $dependencies) {
    $name = "$($dependency.Name)-$($dependency.Version)"
    $group = $dependency.Group.Replace('.', '/')
    $url = "https://dl.google.com/dl/android/maven2/$group/$($dependency.Name)/$($dependency.Version)/$name.$($dependency.Type)"
    $hash = (Get-Text (Invoke-WebRequest -Uri "$url.sha1" -TimeoutSec 30)).Trim()
    $downloadName = if ($dependency.Type -eq 'aar') { "$name.zip" } else { "$name.jar" }
    $file = Download-Verified $url $downloadName $hash 'SHA1'
    if ($dependency.Type -eq 'aar') {
        $unpack = Join-Path $libraryDirectory $name
        if (!(Test-Path -LiteralPath $unpack)) { Expand-Archive -LiteralPath $file -DestinationPath $unpack }
        Copy-Item -LiteralPath (Join-Path $unpack 'classes.jar') -Destination (Join-Path $libraryDirectory "$name.jar") -Force
    } else {
        Copy-Item -LiteralPath $file -Destination (Join-Path $libraryDirectory "$name.jar") -Force
    }
}
Download-Verified 'https://www.apache.org/licenses/LICENSE-2.0.txt' 'Apache-2.0.txt' | Out-Null
Write-Output "Android tools ready: $toolRoot"
