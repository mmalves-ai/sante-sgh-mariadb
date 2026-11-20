// Configuração do núcleo lida do .env.sante (ARQ-1; seção 4.4). Mensagens citam só nomes de chave.
import type { Ambiente } from './arquivo-ambiente.js';
import { BIBLIOTECA_CLIENTE_PADRAO } from './driver.js';
import { type Estabelecimento, ErroConfiguracaoEstabelecimentos, chaveFb } from './estabelecimentos.js';

export interface ConfiguracaoNucleo {
  /** Conexões por estabelecimento (teto inicial pequeno; dimensionado no M09). */
  readonly tetoPorEstabelecimento: number;
  /** Conexões somadas de todos os estabelecimentos da rede (ARQ-2). */
  readonly tetoPorRede: number;
  /** Espera máxima por uma conexão livre. */
  readonly esperaConexaoMs: number;
  /** Tempo máximo por consulta de leitura: estourou, o driver cancela. */
  readonly tempoConsultaMs: number;
  /** Teto de linhas padrão por consulta de leitura. */
  readonly tetoLinhas: number;
  /** LOCK TIMEOUT das escritas (M04; revisto no M09). */
  readonly lockTimeoutSegundos: number;
  /**
   * Trilha (SGH_TRILHA, 18/11/2026): espera de trava de CADA inclusão do elo (cadeia por estabelecimento, única
   * SGH_UQ_TRILHA_ELO). Outra transação que incluiu o elo e segue aberta (captura de assinatura, teste longo na
   * mesma cópia) faz a inclusão esperar; passado este tempo a espera é cancelada só neste comando (o LOCK TIMEOUT
   * do resto da transação não muda) e o encadeamento é refeito sobre o último elo confirmado.
   */
  readonly esperaEloTrilhaMs: number;
  /**
   * Teto TOTAL da gravação de um elo, somadas as esperas e os refazimentos. Estourou: falha com o 503
   * "trilha-indisponivel" e a ação não acontece (SBIS: nenhuma ação auditável sem trilha).
   * Revisão 18/11/2026: padrão de 25 s em produção (uma transação legítima que segura o elo alguns segundos, como
   * a correção "como" ou o PEP com várias etapas, só atrasa as gravações concorrentes, como antes da correção, sem
   * derrubá-las); 3 s só com AMBIENTE=dev (cópias de teste com transações presas por minutos). A chave vale sobre ambos.
   */
  readonly tetoEloTrilhaMs: number;
  /**
   * Intervalo da nova tentativa dos estabelecimentos indisponíveis (pendência do M02 levada ao M09):
   * 60 s por padrão; no dev o banco fora volta ao seletor em até um intervalo, sem reiniciar a API.
   */
  readonly reverificacaoMs: number;
  readonly bibliotecaCliente: string;
}

export const CONFIGURACAO_PADRAO: ConfiguracaoNucleo = Object.freeze({
  tetoPorEstabelecimento: 4,
  tetoPorRede: 16,
  esperaConexaoMs: 5_000,
  tempoConsultaMs: 15_000,
  tetoLinhas: 1_000,
  lockTimeoutSegundos: 5,
  esperaEloTrilhaMs: 1_000,
  tetoEloTrilhaMs: 25_000,
  reverificacaoMs: 60_000,
  bibliotecaCliente: BIBLIOTECA_CLIENTE_PADRAO,
});

const CHAVES: Record<
  Exclude<keyof ConfiguracaoNucleo, 'bibliotecaCliente'>,
  readonly [string, number, number]
> = {
  tetoPorEstabelecimento: ['FB_POOL_TETO', 1, 64],
  tetoPorRede: ['FB_REDE_TETO', 1, 512],
  esperaConexaoMs: ['FB_POOL_ESPERA_MS', 100, 120_000],
  tempoConsultaMs: ['FB_CONSULTA_TEMPO_MS', 100, 600_000],
  tetoLinhas: ['FB_CONSULTA_TETO_LINHAS', 1, 100_000],
  lockTimeoutSegundos: ['FB_LOCK_TIMEOUT_S', 1, 60],
  esperaEloTrilhaMs: ['FB_TRILHA_ELO_ESPERA_MS', 100, 10_000],
  tetoEloTrilhaMs: ['FB_TRILHA_ELO_TETO_MS', 200, 30_000],
  reverificacaoMs: ['FB_REVERIFICACAO_MS', 5_000, 3_600_000],
};

/** Inteiro do ambiente dentro da faixa; ausente ou vazio dá o padrão; NaN ou fora da faixa é erro. */
export function lerInteiroAmbiente(
  env: Ambiente,
  chave: string,
  padrao: number,
  min: number,
  max: number,
): number {
  const bruto = env[chave]?.trim();
  if (bruto === undefined || bruto === '') return padrao;
  const n = Number(bruto);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ErroConfiguracaoEstabelecimentos(`${chave}: use um inteiro de ${min} a ${max}.`);
  }
  return n;
}

/** Teto do elo da trilha no dev (AMBIENTE=dev) quando FB_TRILHA_ELO_TETO_MS não vem: falha rápida nas cópias. */
export const TETO_ELO_TRILHA_DEV_MS = 3_000;

export function lerConfiguracaoNucleo(env: Ambiente): ConfiguracaoNucleo {
  const c: Record<string, number | string> = { ...CONFIGURACAO_PADRAO };
  if (env['AMBIENTE']?.trim() === 'dev') c['tetoEloTrilhaMs'] = TETO_ELO_TRILHA_DEV_MS;
  for (const [campo, [chave, min, max]] of Object.entries(CHAVES)) {
    c[campo] = lerInteiroAmbiente(env, chave, c[campo] as number, min, max);
  }
  const lib = env['FB_CLIENTE_BIBLIOTECA']?.trim();
  if (lib) {
    if (!lib.startsWith('/'))
      throw new ErroConfiguracaoEstabelecimentos('FB_CLIENTE_BIBLIOTECA: caminho absoluto.');
    c['bibliotecaCliente'] = lib;
  }
  const cfg = c as unknown as ConfiguracaoNucleo;
  if (cfg.tetoPorRede < cfg.tetoPorEstabelecimento) {
    throw new ErroConfiguracaoEstabelecimentos('FB_REDE_TETO menor que FB_POOL_TETO.');
  }
  if (cfg.tetoEloTrilhaMs < cfg.esperaEloTrilhaMs) {
    throw new ErroConfiguracaoEstabelecimentos('FB_TRILHA_ELO_TETO_MS menor que FB_TRILHA_ELO_ESPERA_MS.');
  }
  return Object.freeze(cfg);
}

const HOSTS_LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/** Chave da exceção de dev (só AMBIENTE=dev, host em loopback): pendência da conta própria (DP-15). */
export const CHAVE_EXCECAO_SYSDBA_DEV = 'SGH_DEV_PERMITIR_SYSDBA';

/**
 * Nunca SYSDBA (cap-10 §10.2, cap-09 §9.16). Exceção única e provisória: em AMBIENTE=dev, com host em
 * loopback e SGH_DEV_PERMITIR_SYSDBA=sim, enquanto a cópia compartilhada não tiver a conta SGH_DEV
 * (pendência do M01; o script da conta está em infra/firebird/conta-dev.sql, a ser executado por pessoa).
 * Devolve true quando a exceção foi usada (quem chama avisa no log e no painel de saúde).
 */
export function conferirUsuarioFirebird(est: Estabelecimento, env: Ambiente): boolean {
  if (est.usuario.trim().toUpperCase() !== 'SYSDBA') return false;
  // AMBIENTE explícito: ausente não vale dev aqui (a exceção nunca abre por falta de configuração).
  const ambiente = env['AMBIENTE']?.trim();
  const excecao = env[CHAVE_EXCECAO_SYSDBA_DEV]?.trim() === 'sim';
  if (ambiente === 'dev' && excecao && HOSTS_LOOPBACK.has(est.host)) return true;
  throw new ErroConfiguracaoEstabelecimentos(
    `${chaveFb(est.codigo, 'USUARIO')}: SYSDBA é recusado; use a conta própria do sistema (DP-15).`,
  );
}
