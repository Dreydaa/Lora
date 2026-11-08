; Crochet de l'installeur NSIS de Lora (bundle.windows.nsis.installerHooks dans tauri.conf.json). ASCII seulement : pas de BOM necessaire.
;
; Pourquoi : la desinstallation de Tauri propose la case « Delete the application data ». Cochee, elle supprime
; %APPDATA%\com.soza.assistant et %LOCALAPPDATA%\com.soza.assistant : apps.json (applications autorisees), spotify.json
; (identifiants), modes.json, listen.json, voice.json. Cela est arrive le 06/11/2026 pendant une reinstallation. On redemande
; donc une fois, en disant ce qui part, avant de supprimer. Modes silencieux et passif : la reponse par defaut est NON.
; Les moteurs de voix (Whisper, Piper) ne sont pas ici : ils vivent dans %APPDATA%\lora-voice, que cette case ne touche pas.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
    MessageBox MB_YESNO|MB_ICONEXCLAMATION|MB_DEFBUTTON2 "Supprimer aussi les reglages de Lora ?$\r$\n$\r$\nApplications autorisees (apps.json), Spotify, modes de travail, ecoute et voix seront effaces et a refaire. Les moteurs de voix (Whisper, Piper) ne sont pas touches.$\r$\n$\r$\nChoisis Non pour tout garder." /SD IDNO IDYES lora_delete_data
    StrCpy $DeleteAppDataCheckboxState 0
    lora_delete_data:
  ${EndIf}
!macroend
