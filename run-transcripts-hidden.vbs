' Avvia fetch-transcripts.bat con finestra nascosta (0 = hidden).
' Usato dal task "Beyblade Transcripts" per non mostrare la console ogni 5 min.
' Il percorso si ricava dal file stesso: lo stesso .vbs gira sul portatile e sul homeserver.
' True = aspetta la fine: l'exit code resta significativo e IgnoreNew protegge dalle sovrapposizioni.
percorso = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "cmd /c """ & percorso & "\fetch-transcripts.bat""", 0, True
