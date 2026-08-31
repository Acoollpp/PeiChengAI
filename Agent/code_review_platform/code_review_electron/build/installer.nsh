!macro customInit
  ${if} ${FileExists} "$INSTDIR\runtime-data\*.*"
    ${StdUtils.GetParentPath} $R9 "$INSTDIR"
    StrCpy $R8 "$R9\code-review-electron-data"

    ${ifNot} ${FileExists} "$R8\*.*"
      Rename "$INSTDIR\runtime-data" "$R8"
    ${else}
      Rename "$INSTDIR\runtime-data" "$R9\code-review-electron-data-legacy"
    ${endIf}
  ${endIf}
!macroend

!macro customInstall
  ${if} ${FileExists} "$newStartMenuLink"
    CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
  ${endIf}

  ${if} ${FileExists} "$newDesktopLink"
    CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
    ClearErrors
    WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
  ${endIf}

  Delete "$INSTDIR\AI代码审查客户端启动.lnk"
!macroend
