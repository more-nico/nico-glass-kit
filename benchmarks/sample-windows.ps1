param([string]$BrowserIds, [string]$OutputPath, [int]$Seconds = 10)
$ids = @($BrowserIds.Split(',') | ForEach-Object { [int]$_ })
# Hardware counters are kept separate from JS/trace metrics. An empty counter
# is reported as unavailable; it must never be interpreted as 0% GPU load.
$samples = @()
for ($i = 0; $i -lt $Seconds; $i++) {
  $processes = Get-Process -Id $ids -ErrorAction SilentlyContinue
  $gpu = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | Where-Object { $n = $_.Name; ($ids | Where-Object { $n -like "pid_${_}_*" }).Count -gt 0 })
  $memory = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -ErrorAction SilentlyContinue | Where-Object { $n = $_.Name; ($ids | Where-Object { $n -like "pid_${_}_*" }).Count -gt 0 })
  $samples += [pscustomobject]@{
    workingSetBytes = ($processes | Measure-Object WorkingSet64 -Sum).Sum
    gpuMaxEnginePercent = if ($gpu.Count) { ($gpu | Measure-Object UtilizationPercentage -Maximum).Maximum } else { $null }
    gpuDedicatedBytes = if ($memory.Count) { ($memory | Measure-Object DedicatedUsage -Sum).Sum } else { $null }
    gpuSharedBytes = if ($memory.Count) { ($memory | Measure-Object SharedUsage -Sum).Sum } else { $null }
  }
  Start-Sleep -Milliseconds 1000
}
ConvertTo-Json -InputObject @($samples) -Depth 3 | Set-Content -LiteralPath $OutputPath
