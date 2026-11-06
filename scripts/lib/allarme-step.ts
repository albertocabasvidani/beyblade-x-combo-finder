/**
 * allarme-step.ts — Un guasto che il passo deve far vedere al .bat, anche quando lo script è
 * lanciato dal modello dentro uno step `claude -p`.
 *
 * Il .bat vede solo l'exit code di `claude`, che esce 0 anche se uno script interno è fallito (un
 * guardrail del prune, una violazione dell'invariante dello score). Lo script quindi scrive una riga
 * in `logs/allarmi-<aaaa-mm-gg>.log`, e daily-pipeline.bat / recover-combos.bat contano lo step come
 * fallito se il file del giorno esiste. La data è quella locale, come `%TODAY%` nei .bat.
 */
import { appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dirname, '..', '..');

export function oggiLocale(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function segnalaAllarme(script: string, messaggio: string): void {
  const dir = join(ROOT, 'logs');
  mkdirSync(dir, { recursive: true });
  const ora = new Date().toTimeString().slice(0, 8);
  appendFileSync(join(dir, `allarmi-${oggiLocale()}.log`), `[${ora}] ${script}: ${messaggio}\n`);
}
