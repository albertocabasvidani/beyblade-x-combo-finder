' Avvia daily-pipeline.bat con finestra NASCOSTA (0 = hidden), aspettando la fine (True).
'
' Motivo (22/07/2026): il task girava con /it e apriva una finestra di console visibile.
' La finestra sembra vuota — dalla separazione della raccolta la pipeline non apre piu'
' alcun browser e gli step scrivono sul file di log, non a schermo — quindi veniva chiusa
' a mano credendola un residuo. Chiudere la finestra manda CTRL_CLOSE_EVENT a tutto il
' gruppo di processi: cmd.exe e claude morivano insieme, a meta' del lavoro, senza lasciare
' errori. Da qui i 24 log dal 29/06 fermi a meta' e gli exit code STATUS_CONTROL_C_EXIT.
'
' Prova che il lavoro era sano: il 22/07 il batch si e' fermato alle 08:27:13, ma claude ha
' continuato e ha scritto youtube-cache.json alle 08:29:09.
'
' True (non False come nel wrapper dei transcript): cosi' il Task Scheduler aspetta la fine
' e l'exit code resta significativo, insieme a MultipleInstances=IgnoreNew.
CreateObject("WScript.Shell").Run "cmd /c ""c:\claude-code\Personale\Beyblade\beyblade combos\daily-pipeline.bat""", 0, True
