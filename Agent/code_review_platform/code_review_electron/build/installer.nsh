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
