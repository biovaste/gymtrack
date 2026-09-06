@echo off
cd /d "%~dp0"
node tools/i18n/cli.mjs review
pause
