# make-clean-archive.ps1
# Создаёт чистый zip-архив проекта без node_modules, dist, .git, .env и прочего мусора.
# Запускать из корня daogreen-spec.
# Рабочие файлы НЕ удаляет.

param(
    [string]$OutputDir = ".."
)

$projectRoot = (Get-Location).Path
$projectName = Split-Path $projectRoot -Leaf
$date = Get-Date -Format "yyyy-MM-dd"
$archiveName = "$projectName-clean-$date.zip"
$archivePath = Join-Path (Resolve-Path $OutputDir) $archiveName

# Папки и файлы, которые нельзя включать в архив
$excludePatterns = @(
    "node_modules",
    "backend\node_modules",
    "dist",
    "build",
    "coverage",
    ".vite",
    ".git",
    ".env",
    "backend\.env",
    "backend\uploads",
    "uploads",
    "*.zip",
    "tmp*",
    "*_backup*",
    "*_old*",
    "daogreen-spec 1",
    "_planner-kits",
    "_planner-specsync",
    "backend\import-sources",
    "import-sources",
    "backend\data\*.db",
    "backend\data\*.sqlite",
    "backend\data\*.db-*",
    "backend\data\*.json"
)

Write-Host "Создаём чистый архив: $archivePath"
Write-Host "Источник: $projectRoot"
Write-Host ""

# Собираем список файлов для архива
$allFiles = Get-ChildItem -Path $projectRoot -Recurse -File

$filesToArchive = $allFiles | Where-Object {
    $relativePath = $_.FullName.Substring($projectRoot.Length + 1)
    $include = $true

    foreach ($pattern in $excludePatterns) {
        # Проверяем совпадение с любым сегментом пути
        $segments = $relativePath -split "\\"
        foreach ($seg in $segments) {
            if ($seg -like $pattern) { $include = $false; break }
        }
        if (-not $include) { break }

        # Дополнительно — полное совпадение начала пути
        if ($relativePath -like "$pattern*") { $include = $false; break }
        if ($relativePath -like "*\$pattern*") { $include = $false; break }
    }

    $include
}

Write-Host "Файлов для архива: $($filesToArchive.Count)"
Write-Host ""

# Создаём архив
if (Test-Path $archivePath) {
    Remove-Item $archivePath -Force
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($archivePath, 'Create')

foreach ($file in $filesToArchive) {
    $relativePath = $file.FullName.Substring($projectRoot.Length + 1)
    $entryName = "$projectName\$relativePath"
    try {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
    } catch {
        Write-Warning "Пропущен: $relativePath — $_"
    }
}

$zip.Dispose()

$sizeMb = [math]::Round((Get-Item $archivePath).Length / 1MB, 2)
Write-Host "Архив создан: $archivePath ($sizeMb MB)"
Write-Host "Готово."
