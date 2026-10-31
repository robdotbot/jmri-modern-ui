; Windows installer for JMRI Modern UI. Built by .github/workflows/release.yml:
;   makensis -DVERSION=0.3.0 -DAPP_DIR=..\..\dist -DADDON_JAR=..\..\addon\dist\jmri-modern-ui-addon.jar installer.nsi
;
; Installs:
;   - the web app into %USERPROFILE%\JMRI\web\modern (the JMRI settings folder, which JMRI's web server
;     serves at /web/modern/ for every profile, and which survives JMRI upgrades)
;   - the add-on jar into <JMRI>\lib (the Windows launcher only loads extra jars from there)
; ADDON_JAR is optional; without it only the web app is installed.

Unicode true
!include "MUI2.nsh"
!include "LogicLib.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!ifndef APP_DIR
  !define APP_DIR "..\..\dist"
!endif
!ifndef OUT_FILE
  !define OUT_FILE "JMRI-Modern-UI-${VERSION}-windows-setup.exe"
!endif

!define PRODUCT "JMRI Modern UI"
!define JAR "jmri-modern-ui-addon.jar"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\JMRIModernUI"
!define URL "http://localhost:12080/web/modern/"

Name "${PRODUCT}"
OutFile "${OUT_FILE}"
RequestExecutionLevel admin
InstallDir "$PROGRAMFILES64\JMRI"
SetCompressor /SOLID lzma

VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "${PRODUCT}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "${PRODUCT} installer"
VIAddVersionKey "LegalCopyright" ""

!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"
!define MUI_ABORTWARNING

!ifdef ADDON_JAR
  !define ADDON_NOTE " and the add-on (programming, Logix/LogixNG, panel editing, train building) into JMRI's lib folder"
!else
  !define ADDON_NOTE ""
!endif
!define MUI_WELCOMEPAGE_TEXT "This installs ${PRODUCT} ${VERSION}, a modern web front end for JMRI.$\r$\n$\r$\nThe app goes into your JMRI settings folder ($PROFILE\JMRI\web\modern)${ADDON_NOTE}.$\r$\n$\r$\nQuit JMRI (PanelPro, DecoderPro) before continuing."
!insertmacro MUI_PAGE_WELCOME
!ifdef ADDON_JAR
  !define MUI_DIRECTORYPAGE_TEXT_TOP "Select the folder JMRI is installed in (the one that contains jmri.jar). The add-on is copied into its lib folder."
  !define MUI_DIRECTORYPAGE_TEXT_DESTINATION "JMRI folder"
  !define MUI_PAGE_CUSTOMFUNCTION_LEAVE CheckJmriDir
  !insertmacro MUI_PAGE_DIRECTORY
!endif
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "${PRODUCT} is installed"
!define MUI_FINISHPAGE_TEXT "Next steps in JMRI:$\r$\n$\r$\n1. Preferences → Start Up → Add → Perform action → Start Web Server.$\r$\n2. Optional: Preferences → Web Server, untick $\"Web clients can't change track power$\".$\r$\n3. Restart JMRI.$\r$\n$\r$\nThen open ${URL} (or http://<this computer>:12080/web/modern/ from a phone or tablet). The Start menu has a shortcut."
!define MUI_FINISHPAGE_LINK "Open ${URL}"
!define MUI_FINISHPAGE_LINK_LOCATION "${URL}"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Function .onInit
  SetShellVarContext all
  ; Default to wherever JMRI is installed. A previous install remembers its folder.
  ReadRegStr $0 HKLM "${UNINST_KEY}" "JmriDir"
  ${If} $0 != ""
  ${AndIf} ${FileExists} "$0\jmri.jar"
    StrCpy $INSTDIR $0
    Return
  ${EndIf}
  ${If} ${FileExists} "$PROGRAMFILES64\JMRI\jmri.jar"
    StrCpy $INSTDIR "$PROGRAMFILES64\JMRI"
  ${ElseIf} ${FileExists} "$PROGRAMFILES32\JMRI\jmri.jar"
    StrCpy $INSTDIR "$PROGRAMFILES32\JMRI"
  ${ElseIf} ${FileExists} "C:\JMRI\jmri.jar"
    StrCpy $INSTDIR "C:\JMRI"
  ${EndIf}
FunctionEnd

!ifdef ADDON_JAR
Function CheckJmriDir
  ${IfNot} ${FileExists} "$INSTDIR\jmri.jar"
    MessageBox MB_ICONEXCLAMATION|MB_OK "$INSTDIR doesn't look like a JMRI folder: there is no jmri.jar in it.$\r$\n$\r$\nChoose the folder JMRI is installed in, usually C:\Program Files (x86)\JMRI or C:\Program Files\JMRI."
    Abort
  ${EndIf}
FunctionEnd
!endif

Section "Install"
  ; The web app, in the user's JMRI settings folder.
  StrCpy $1 "$PROFILE\JMRI\web\modern"
  RMDir /r "$1"
  SetOutPath "$1"
  File /r "${APP_DIR}\*.*"

!ifdef ADDON_JAR
  SetOutPath "$INSTDIR\lib"
  File "${ADDON_JAR}"
  WriteRegStr HKLM "${UNINST_KEY}" "JmriDir" "$INSTDIR"
!endif

  ; Start menu shortcut to the app on this computer.
  WriteINIStr "$SMPROGRAMS\${PRODUCT}.url" "InternetShortcut" "URL" "${URL}"

  ; Uninstaller, kept outside the JMRI folder so a JMRI upgrade doesn't remove it.
  CreateDirectory "$PROGRAMFILES64\${PRODUCT}"
  WriteUninstaller "$PROGRAMFILES64\${PRODUCT}\Uninstall.exe"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${PRODUCT}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${PRODUCT}"
  WriteRegStr HKLM "${UNINST_KEY}" "WebDir" "$1"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$PROGRAMFILES64\${PRODUCT}\Uninstall.exe"'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1

  ; A copy the app installed by `npm run deploy` into a profile would take precedence over this one.
  FindFirst $2 $3 "$PROFILE\JMRI\*.jmri"
  ${DoWhile} $3 != ""
    ${If} ${FileExists} "$PROFILE\JMRI\$3\web\modern\index.html"
      DetailPrint "Note: $PROFILE\JMRI\$3\web\modern is an older copy that JMRI serves instead of this one for that profile; delete it to use this version."
    ${EndIf}
    FindNext $2 $3
  ${Loop}
  FindClose $2
SectionEnd

Function un.onInit
  SetShellVarContext all
FunctionEnd

Section "Uninstall"
  ReadRegStr $0 HKLM "${UNINST_KEY}" "JmriDir"
  ${If} $0 != ""
    Delete "$0\lib\${JAR}"
  ${EndIf}
  ReadRegStr $1 HKLM "${UNINST_KEY}" "WebDir"
  ${If} $1 != ""
    RMDir /r "$1"
  ${EndIf}
  Delete "$SMPROGRAMS\${PRODUCT}.url"
  DeleteRegKey HKLM "${UNINST_KEY}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"
SectionEnd
