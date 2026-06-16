' Avvia fetch-transcripts.bat con finestra nascosta (0 = hidden).
' Usato dal task "Beyblade Transcripts" per non mostrare la console ogni 5 min.
CreateObject("WScript.Shell").Run "cmd /c ""c:\claude-code\Personale\beyblade combos\fetch-transcripts.bat""", 0, False
