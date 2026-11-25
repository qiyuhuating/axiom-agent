; Only remove the retired package and implementation in the installer-owned runtime.
; Never remove the workspace, application data, sessions or user-installed extensions.
!macro NSIS_HOOK_POSTINSTALL
  ClearErrors
  Delete "$INSTDIR\runtime\bin\node.exe"
  Delete "$INSTDIR\runtime\bin\npm.cmd"
  Delete "$INSTDIR\runtime\bin\npx.cmd"
  RMDir /r "$INSTDIR\runtime\bin\node_modules\npm"
  IfFileExists "$INSTDIR\runtime\bin\node.exe" retired_pty_failed
  RMDir /r "$INSTDIR\runtime\node_modules\node-pty"
  Delete "$INSTDIR\runtime\src\terminal.mjs"
  IfFileExists "$INSTDIR\runtime\node_modules\node-pty\*.*" retired_pty_failed
  IfFileExists "$INSTDIR\runtime\src\terminal.mjs" retired_pty_failed retired_pty_done
retired_pty_failed:
  DetailPrint "Cannot remove retired runtime files. Stop the previous background runtime and reinstall."
  SetErrorLevel 1
  Abort
retired_pty_done:
  ClearErrors
!macroend
