@echo off
node --env-file=.env "%~dp0src\cli.js" %*
