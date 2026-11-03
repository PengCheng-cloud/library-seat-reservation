@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"

echo [1/1] Exporting app runtime recommendation data from defense multilabel experiment...
python scripts\build_defense_multilabel_runtime_data.py
if errorlevel 1 goto :error

echo.
echo Pipeline completed successfully.
echo Runtime recommendation data generated under data folder.
echo Source: docs/答辩版_多算法分类实验_含神经网络_20260423
goto :end

:error
echo.
echo Pipeline failed. Please check the error output above.
exit /b 1

:end
endlocal
