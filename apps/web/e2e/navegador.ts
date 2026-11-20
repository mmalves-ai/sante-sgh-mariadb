// Ambiente do processo do Chrome do E2E (POL-4: nada escrito fora do repositório).
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * O Chrome cria `<TMPDIR>/com.google.Chrome.XXXXXX/SingletonSocket` (41 caracteres depois do TMPDIR), e
 * o caminho de um socket Unix tem no máximo 107 bytes. Com o repositório em pasta funda, o `.tmp/` do
 * projeto estoura o limite e o Chrome aborta ("Socket path too long").
 */
export const LIMITE_TMPDIR_DO_CHROME = 60;

/** Prefixo da única pasta que o E2E pode criar fora do repositório (exceção à POL-4, ADR 0001). */
export const PREFIXO_TMP_CURTO = '/tmp/sgh-e2e-';

export function escolherTmpDoNavegador(raiz: string): { caminho: string; foraDoRepositorio: boolean } {
  const doProjeto = resolve(raiz, '.tmp');
  if (doProjeto.length <= LIMITE_TMPDIR_DO_CHROME) return { caminho: doProjeto, foraDoRepositorio: false };
  // Caminho curto e fixo por repositório; criado no início e apagado no fim do E2E (globalTeardown).
  const sufixo = createHash('sha256').update(raiz).digest('hex').slice(0, 12);
  return { caminho: `${PREFIXO_TMP_CURTO}${sufixo}`, foraDoRepositorio: true };
}

/** Só as variáveis de que o Chrome precisa: nada de segredo do processo (FB_*_SENHA etc.) no navegador. */
const VARIAVEIS_REPASSADAS = ['PATH', 'LANG', 'LC_ALL', 'TZ', 'DISPLAY'] as const;

export function ambienteDoNavegador(
  raiz: string,
  origem: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const casa = resolve(raiz, '.tmp/chrome-home');
  const tmp = escolherTmpDoNavegador(raiz).caminho;
  mkdirSync(tmp, { recursive: true, mode: 0o700 });
  const ambiente: Record<string, string> = {};
  for (const nome of VARIAVEIS_REPASSADAS) {
    const valor = origem[nome];
    if (valor !== undefined) ambiente[nome] = valor;
  }
  // O Chrome do sistema grava em ~/.config/google-chrome (Crash Reports) e ~/.pki: HOME e XDG_* no projeto.
  return {
    ...ambiente,
    HOME: casa,
    XDG_CONFIG_HOME: join(casa, '.config'),
    XDG_CACHE_HOME: join(casa, '.cache'),
    XDG_DATA_HOME: join(casa, '.local/share'),
    XDG_RUNTIME_DIR: resolve(raiz, '.tmp/run'),
    TMPDIR: tmp,
  };
}

export function limparTmpDoNavegador(raiz: string): void {
  const { caminho, foraDoRepositorio } = escolherTmpDoNavegador(raiz);
  if (foraDoRepositorio && caminho.startsWith(PREFIXO_TMP_CURTO)) {
    rmSync(caminho, { recursive: true, force: true });
  }
}
