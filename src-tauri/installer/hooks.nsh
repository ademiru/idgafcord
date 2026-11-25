; Kept outside the application directory: WebView2, settings and voice models.
; Never pass /DELETEAPPDATA while replacing a version.
Var IdgcExistingLocation
Var IdgcExistingUninstaller
Var IdgcExistingVersion
Var IdgcVersionComparison
Var IdgcUninstallExit

!macro NSIS_HOOK_PREINSTALL
  ReadRegStr $IdgcExistingVersion SHCTX "${UNINSTKEY}" "DisplayVersion"
  ${If} $IdgcExistingVersion != ""
    nsis_tauri_utils::SemverCompare "${VERSION}" "$IdgcExistingVersion"
    Pop $IdgcVersionComparison
    ${If} $IdgcVersionComparison = -1
      Abort "Daha yeni bir idgafcord surumu zaten kurulu."
    ${EndIf}
    ${If} $IdgcVersionComparison = 1
      ReadRegStr $IdgcExistingLocation SHCTX "${MANUPRODUCTKEY}" ""
      ${If} $IdgcExistingLocation == ""
        ReadRegStr $IdgcExistingLocation SHCTX "${UNINSTKEY}" "InstallLocation"
        nsis_tauri_utils::StrReplace "$IdgcExistingLocation" '$\"' ""
        Pop $IdgcExistingLocation
      ${EndIf}
      ReadRegStr $IdgcExistingUninstaller SHCTX "${UNINSTKEY}" "UninstallString"
      ${If} $IdgcExistingLocation == ""
      ${OrIf} $IdgcExistingUninstaller == ""
        Abort "Eski kurulum bilgisi okunamadi. Dosyalar degistirilmedi."
      ${EndIf}
      !insertmacro CheckIfAppIsRunning "$IdgcExistingLocation\${MAINBINARYNAME}.exe" "${PRODUCTNAME}"
      StrCpy $INSTDIR "$IdgcExistingLocation"
      ExecWait '$IdgcExistingUninstaller /UPDATE /S _?=$IdgcExistingLocation' $IdgcUninstallExit
      ${If} $IdgcUninstallExit != 0
        Abort "Eski surum kaldirilamadi. Kullanici verileri korunuyor."
      ${EndIf}
      SetOutPath "$INSTDIR"
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode = 1
    StrCpy $DeleteAppDataCheckboxState 0
  ${EndIf}
!macroend
