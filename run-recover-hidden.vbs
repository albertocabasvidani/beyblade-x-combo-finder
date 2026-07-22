' Avvia recover-combos.bat con finestra NASCOSTA (0 = hidden), aspettando la fine (True).
'
' Il recupero gira alle 14:00, con l'utente al PC: e' quindi il piu' esposto di tutti alla
' chiusura manuale della finestra. Ieri infatti e' uscito con 0xC000013A
' (STATUS_CONTROL_C_EXIT), la firma di una console chiusa.
CreateObject("WScript.Shell").Run "cmd /c ""c:\claude-code\Personale\Beyblade\beyblade combos\recover-combos.bat""", 0, True
