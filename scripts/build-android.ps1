param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$toolRoot = Join-Path $projectRoot '.local-data/android-toolchain'
$sourceRoot = Join-Path $projectRoot 'android/app/src/main'
$buildRoot = Join-Path $projectRoot ('android/build/' + [Guid]::NewGuid().ToString('N'))
$outputRoot = Join-Path $projectRoot 'dist'
$signingRoot = Join-Path $projectRoot '.local-data/android-signing'

function Run-Tool([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Tool failed: $Executable (exit $LASTEXITCODE)" }
}

$androidJar = (Get-ChildItem -LiteralPath (Join-Path $toolRoot 'platform') -Filter 'android.jar' -File -Recurse | Select-Object -First 1).FullName
$aapt2 = (Get-ChildItem -LiteralPath (Join-Path $toolRoot 'build-tools') -Filter 'aapt2.exe' -File -Recurse | Select-Object -First 1).FullName
$buildTools = Split-Path -Parent $aapt2
$java = (Get-ChildItem -LiteralPath (Join-Path $toolRoot 'jdk') -Filter 'java.exe' -File -Recurse | Select-Object -First 1).FullName
$javaBin = Split-Path -Parent $java
$libraries = @((Join-Path $toolRoot 'webkit/classes.jar'), (Join-Path $toolRoot 'core/classes.jar'), (Join-Path $toolRoot 'annotation-jvm.jar'))
$libraries += @((Get-ChildItem -LiteralPath (Join-Path $toolRoot 'libraries') -Filter '*.jar' -File).FullName)
foreach ($file in @($androidJar, $aapt2, $java) + $libraries) {
    if (!$file -or !(Test-Path -LiteralPath $file)) { throw 'Android build tools missing. Run scripts/prepare-android.ps1 first.' }
}

New-Item -ItemType Directory -Path $buildRoot,$outputRoot,$signingRoot -Force | Out-Null
$assets = Join-Path $buildRoot 'assets'
$resources = Join-Path $buildRoot 'res'
$classes = Join-Path $buildRoot 'classes'
$generated = Join-Path $buildRoot 'generated'
$dex = Join-Path $buildRoot 'dex'
New-Item -ItemType Directory -Path $assets,$classes,$generated,$dex -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $sourceRoot 'res') -Destination $resources -Recurse
foreach ($file in @('index.html', 'styles.css', 'android.js', 'app.js', 'pwa.js', 'manifest.webmanifest')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination $assets
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'icons') -Destination (Join-Path $assets 'icons') -Recurse
New-Item -ItemType Directory -Path (Join-Path $assets 'licenses') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $toolRoot 'downloads/Apache-2.0.txt') -Destination (Join-Path $assets 'licenses/Apache-2.0.txt')
Copy-Item -LiteralPath (Join-Path $projectRoot 'android/THIRD_PARTY_NOTICES.txt') -Destination (Join-Path $assets 'licenses/NOTICE.txt')
New-Item -ItemType Directory -Path (Join-Path $resources 'mipmap-xxxhdpi'),(Join-Path $resources 'drawable-nodpi') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'icons/icon-192.png') -Destination (Join-Path $resources 'mipmap-xxxhdpi/ic_launcher.png')
Copy-Item -LiteralPath (Join-Path $projectRoot 'icons/icon-maskable-512.png') -Destination (Join-Path $resources 'drawable-nodpi/ic_launcher_foreground.png')

Write-Output 'Compiling Android resources'
$compiledResources = Join-Path $buildRoot 'resources.zip'
$unalignedApk = Join-Path $buildRoot 'unsigned.apk'
Run-Tool $aapt2 @('compile', '--dir', $resources, '-o', $compiledResources)
Run-Tool $aapt2 @('link', '-I', $androidJar, '--manifest', (Join-Path $sourceRoot 'AndroidManifest.xml'), '--java', $generated, '-o', $unalignedApk, $compiledResources)

Write-Output 'Compiling Android application'
$javaFiles = @((Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'java'),$generated -Filter '*.java' -File -Recurse).FullName)
Run-Tool (Join-Path $javaBin 'javac.exe') (@('-J-Duser.language=en', '-J-Duser.country=US', '--release', '8', '-Xlint:-options', '-encoding', 'UTF-8', '-classpath', (($androidJar + ';') + ($libraries -join ';')), '-d', $classes) + $javaFiles)
$applicationJar = Join-Path $buildRoot 'application.jar'
Run-Tool (Join-Path $javaBin 'jar.exe') @('--create', '--file', $applicationJar, '-C', $classes, '.')
Run-Tool $java (@('-cp', (Join-Path $buildTools 'lib/d8.jar'), 'com.android.tools.r8.D8', '--release', '--min-api', '23', '--lib', $androidJar, '--output', $dex, $applicationJar) + $libraries)
foreach ($file in Get-ChildItem -LiteralPath $dex -Filter '*.dex') {
    Run-Tool (Join-Path $javaBin 'jar.exe') @('--update', '--file', $unalignedApk, '-C', $dex, $file.Name)
}
Run-Tool (Join-Path $javaBin 'jar.exe') @('--update', '--file', $unalignedApk, '-C', $buildRoot, 'assets')

Write-Output 'Signing installable APK'
$keyStore = Join-Path $signingRoot 'points-card.p12'
$passwordFile = Join-Path $signingRoot 'password.txt'
if (!(Test-Path -LiteralPath $keyStore)) {
    if (!(Test-Path -LiteralPath $passwordFile)) {
        $bytes = New-Object byte[] 32
        [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        [IO.File]::WriteAllText($passwordFile, [Convert]::ToBase64String($bytes), [Text.UTF8Encoding]::new($false))
    }
    $env:POINTS_KEYSTORE_PASSWORD = [IO.File]::ReadAllText($passwordFile)
    Run-Tool (Join-Path $javaBin 'keytool.exe') @('-genkeypair', '-keystore', $keyStore, '-storetype', 'PKCS12', '-storepass:env', 'POINTS_KEYSTORE_PASSWORD', '-keypass:env', 'POINTS_KEYSTORE_PASSWORD', '-alias', 'points-card', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000', '-dname', 'CN=Points Card, OU=Family, O=Points Card, C=CN')
}
$env:POINTS_KEYSTORE_PASSWORD = [IO.File]::ReadAllText($passwordFile)
$alignedApk = Join-Path $buildRoot 'aligned.apk'
$finalApk = Join-Path $outputRoot 'points-card-1.0.0.apk'
Run-Tool (Join-Path $buildTools 'zipalign.exe') @('-f', '-p', '4', $unalignedApk, $alignedApk)
Run-Tool $java @('-jar', (Join-Path $buildTools 'lib/apksigner.jar'), 'sign', '--ks', $keyStore, '--ks-key-alias', 'points-card', '--ks-pass', 'env:POINTS_KEYSTORE_PASSWORD', '--key-pass', 'env:POINTS_KEYSTORE_PASSWORD', '--out', $finalApk, $alignedApk)
Remove-Item Env:POINTS_KEYSTORE_PASSWORD
Run-Tool $java @('-jar', (Join-Path $buildTools 'lib/apksigner.jar'), 'verify', '--verbose', $finalApk)
Run-Tool $aapt2 @('dump', 'badging', $finalApk)
Write-Output "APK ready: $finalApk"
