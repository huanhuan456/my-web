param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$apk = Join-Path $projectRoot 'dist/points-card-1.0.0.apk'
$archive = [IO.Compression.ZipFile]::OpenRead($apk)
try {
    $names = @($archive.Entries.FullName)
    foreach ($required in @('AndroidManifest.xml', 'resources.arsc', 'classes.dex', 'assets/index.html', 'assets/app.js', 'assets/android.js', 'assets/styles.css', 'assets/icons/icon-192.png', 'assets/licenses/Apache-2.0.txt', 'assets/licenses/NOTICE.txt')) {
        if ($required -notin $names) { throw "APK resource missing: $required" }
    }
    foreach ($name in $names) {
        if ($name.Contains('\')) { throw "APK path has invalid separator: $name" }
        if ($name -match '\.local-data|server\.js|tests/|password\.txt|\.p12$|\.pem$') {
            throw "APK contains private or test files: $name"
        }
    }
    $entry = $archive.GetEntry('assets/app.js')
    $reader = [IO.StreamReader]::new($entry.Open())
    try { $source = $reader.ReadToEnd() } finally { $reader.Dispose() }
    if ($source -match 'buildDemoState|getSeedCourses') { throw 'APK contains preset data generation' }
    if (!$source.Contains('window.pointsCardNative.requestState')) { throw 'APK is missing Android sync transport' }
    Write-Output 'PASS: APK resources, native sync transport, empty initial data, and no private/test files.'
} finally { $archive.Dispose() }
Get-FileHash -LiteralPath $apk | Select-Object Algorithm,Hash,Path | Format-List
