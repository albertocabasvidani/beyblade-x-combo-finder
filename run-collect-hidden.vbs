' Avvia collect-sources-task.bat con finestra NASCOSTA (0 = hidden), aspettando la fine (True).
'
' Stessa ragione del wrapper della pipeline: la console visibile veniva chiusa a mano e
' portava con se' l'intero albero di processi (CTRL_CLOSE_EVENT al gruppo). Anche qui il
' log si fermava a meta' senza mai scrivere COLLECT END, pur avendo la raccolta completato
' il suo lavoro e salvato le cache.
'
' Nascondere la console NON nasconde i browser: Reddit, WBO e arca girano headed in finestre
' loro, che restano visibili — serve poterci risolvere il captcha Cloudflare di WBO.
CreateObject("WScript.Shell").Run "cmd /c ""c:\claude-code\Personale\Beyblade\beyblade combos\collect-sources-task.bat""", 0, True
