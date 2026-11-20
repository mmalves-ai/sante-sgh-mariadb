// Preferências do painel "Meus pacientes" neste navegador (D-PAINEL-1): favoritos, colunas e unidade, numa chave por
// rede, estabelecimento e login (correção da revisão do M23): em estação compartilhada, o próximo profissional não
// herda a lista de quem saiu, e a troca de estabelecimento não mistura IDs de pacientes de bancos diferentes. Sem
// armazenamento (janela privada, bloqueio), segue sem guardar.
import { COLUNAS_PAINEL, type ColunaPainel } from '@sgh/contratos';

export interface PreferenciasPainelLocal {
  readonly favoritos: number[];
  readonly colunas: ColunaPainel[];
  readonly unidade: number | null;
}

export interface DonoPainel {
  readonly rede: string;
  readonly estabelecimento: string;
  readonly login: string;
}

const PREFIXO = 'sgh.pep.painel';

/** Chave do dono; sem sessão, nenhuma (nada é lido nem guardado). */
export function chavePainel(d: DonoPainel | null): string | null {
  if (!d || !d.estabelecimento || !d.login) return null;
  return `${PREFIXO}:${d.rede}:${d.estabelecimento}:${d.login}`;
}

const PADRAO = (): PreferenciasPainelLocal => ({
  favoritos: [],
  colunas: [...COLUNAS_PAINEL],
  unidade: null,
});

export function lerPreferenciasPainel(
  chave: string | null,
  armazenamento: Pick<Storage, 'getItem'> | null = guardado(),
): PreferenciasPainelLocal {
  if (!chave || !armazenamento) return PADRAO();
  try {
    const x = JSON.parse(armazenamento.getItem(chave) ?? '{}') as Record<string, unknown>;
    const cols = Array.isArray(x['colunas'])
      ? (x['colunas'] as string[]).filter((c): c is ColunaPainel =>
          (COLUNAS_PAINEL as readonly string[]).includes(c),
        )
      : [];
    return {
      favoritos: Array.isArray(x['favoritos'])
        ? (x['favoritos'] as unknown[]).filter((n): n is number => typeof n === 'number')
        : [],
      colunas: cols.length >= 2 ? cols : [...COLUNAS_PAINEL],
      unidade: typeof x['unidade'] === 'number' ? x['unidade'] : null,
    };
  } catch {
    return PADRAO();
  }
}

export function gravarPreferenciasPainel(
  chave: string | null,
  p: PreferenciasPainelLocal,
  armazenamento: Pick<Storage, 'setItem' | 'removeItem'> | null = guardado(),
): void {
  if (!chave || !armazenamento) return;
  try {
    armazenamento.setItem(chave, JSON.stringify(p));
    // A chave antiga, sem dono, não fica para o próximo usuário.
    armazenamento.removeItem(PREFIXO);
  } catch {
    /* preferência só deste navegador: sem armazenamento, segue sem guardar */
  }
}

function guardado(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
