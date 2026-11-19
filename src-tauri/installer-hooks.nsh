; Only remove the retired package and implementation in the installer-owned runtime.
; Never remove the workspace, application data, sessions or user-installed extensions.
!macro NSIS_HOOK_POSTINSTALL
  ClearErrors
  RMDir /r "$INSTDIR\runtime\node_modules\node-pty"
  Delete "$INSTDIR\runtime\src\terminal.mjs"
  IfFileExists "$INSTDIR\runtime\node_modules\node-pty\*.*" retired_pty_failed
  IfFileExists "$INSTDIR\runtime\src\terminal.mjs" retired_pty_failed retired_pty_done
retired_pty_failed:
  DetailPrint "Cannot remove retired terminal files. Stop the previous background runtime and reinstall."
  SetErrorLevel 1
  Abort
retired_pty_done:
  ClearErrors
!macroend
