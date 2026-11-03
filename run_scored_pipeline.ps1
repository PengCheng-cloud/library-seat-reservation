[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

Write-Host "[1/1] Exporting app runtime recommendation data from defense multilabel experiment..."
python .\scripts\build_defense_multilabel_runtime_data.py

Write-Host ""
Write-Host "Pipeline completed successfully."
Write-Host "Runtime recommendation data generated under data folder."
Write-Host "Source: docs/答辩版_多算法分类实验_含神经网络_20260423"
