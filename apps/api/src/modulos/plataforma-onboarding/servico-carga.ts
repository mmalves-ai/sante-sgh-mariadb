// Serviço da tela "Carga e sincronismo" (obra carga-painel, 2026-11-24; ADR 0010). Valida a entrada pelos contratos e
// orquestra: a origem de servidor (a senha vai só ao cofre, `cofre:conector/<cliente>/firebird-senha`, e nunca volta),
// o pedido de carga (completa ou diferencial, decidido por função pura), a pausa (pedido gravado no banco plataforma; o
// motor para no próximo ponto seguro), a retomada (execução nova com continuação), o progresso ao vivo
// (`contadores.progresso` do motor) e o log da execução (arquivo em CONECTOR_LOG_DIR, com proteção de caminho).
// Só agregados: nada de valor de linha, nome de tabela da origem nem segredo.
import { realpathSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import {
  type AcoesCarga,
  type CargaCliente,
  type ConectorCarga,
  type EstadoExecucaoConector,
  type ExecucaoCargaResumo,
  type ModoCarga,
  type OrigemServidor,
  type ProgressoCarga,
  type TesteOrigem,
  ESTADOS_EXECUCAO_CONECTOR,
  MODOS_CARGA,
  TIPOS_EXECUCAO_CONECTOR,
  esquemaCodigoCliente,
  esquemaOrigemServidorEntrada,
  esquemaPedirCargaEntrada,
  esquemaProgressoCarga,
} from '@sgh/contratos';
import { referenciaCofreConector } from '@sgh/dominio-documento';
import { ErroOnboarding } from './porta.js';

type TipoExecucaoConector = (typeof TIPOS_EXECUCAO_CONECTOR)[number];

// ── regras puras ────────────────────────────────────────────────────────────────────────────────────────────────

export const ESTADOS_ATIVOS: readonly EstadoExecucaoConector[] = [
  'fila',
  'abrindo',
  'lendo',
  'gravando',
  'conciliando',
  'pausando',
];
/** Estados em que o motor está rodando e aceita o pedido de pausa. */
export const ESTADOS_PAUSAVEIS: readonly EstadoExecucaoConector[] = [
  'abrindo',
  'lendo',
  'gravando',
  'conciliando',
];
/** Finais a partir dos quais a carga pode ser retomada (execução nova com continuação). */
export const ESTADOS_RETOMAVEIS: readonly EstadoExecucaoConector[] = ['falhou', 'pausada'];
/** Ativa sem batimento por mais que isto: a tela avisa (o serviço pode ter caído). */
export const LIMITE_BATIMENTO_S = 180;

/** O que o repositório lê, na mesma transação do pedido, para decidir a execução. */
export interface SituacaoCarga {
  readonly origemId: number | null;
  readonly importacaoConcluida: boolean;
  /** Última importação do cliente (a que o `--continuar` do conector considera). */
  readonly ultimaImportacao: { id: number; estado: EstadoExecucaoConector; origemId: number | null } | null;
  /** Última execução de qualquer tipo. */
  readonly ultima: {
    id: number;
    tipo: TipoExecucaoConector;
    estado: EstadoExecucaoConector;
    origemId: number | null;
    modo: ModoCarga | null;
    reprocessarRecusadas: boolean;
  } | null;
}

/** Execução a enfileirar. `continuarDe` = `contadores.continuar_de`; `reprocessarRecusadas` =
 * `contadores.reprocessar_recusadas` (o motor trata como CONECTOR_REPROCESSAR_RECUSADAS=1). */
export interface PlanoCarga {
  readonly tipo: TipoExecucaoConector;
  readonly modo: ModoCarga;
  readonly continuarDe: number | null;
  readonly reprocessarRecusadas: boolean;
}

/**
 * Iniciar carga:
 * - completa: importação nova (o hash pula a linha igual);
 * - diferencial com importação concluída: sincronizar, tentando de novo as recusadas;
 * - diferencial sem importação concluída: importação que continua a última interrompida ou pausada (mesma origem),
 *   também tentando de novo as recusadas.
 */
export function decidirCarga(modo: ModoCarga, s: SituacaoCarga): PlanoCarga {
  if (s.origemId == null)
    throw new ErroOnboarding('invalido', 'Configure a origem do cliente antes da carga.');
  if (modo === 'completa') return { tipo: 'importar', modo, continuarDe: null, reprocessarRecusadas: false };
  if (s.importacaoConcluida)
    return { tipo: 'sincronizar', modo, continuarDe: null, reprocessarRecusadas: true };
  const u = s.ultimaImportacao;
  const continuar = u && ESTADOS_RETOMAVEIS.includes(u.estado) && u.origemId === s.origemId ? u.id : null;
  return { tipo: 'importar', modo, continuarDe: continuar, reprocessarRecusadas: true };
}

/** Retomar: a última execução tem de ter parado (pausada ou falhou). Importação continua de onde parou (mesma
 * origem); sincronização roda de novo (o hash pula o que já entrou). O modo e o reprocesso seguem os da parada. */
export function decidirRetomada(s: SituacaoCarga): PlanoCarga {
  const u = s.ultima;
  if (!u || !ESTADOS_RETOMAVEIS.includes(u.estado))
    throw new ErroOnboarding('invalido', 'Não há carga pausada ou interrompida para retomar.');
  if (s.origemId == null || u.origemId !== s.origemId)
    throw new ErroOnboarding('invalido', 'A origem mudou depois da carga parada: inicie uma carga nova.');
  if (u.tipo === 'importar')
    return {
      tipo: 'importar',
      modo: u.modo ?? 'completa',
      continuarDe: u.id,
      reprocessarRecusadas: u.reprocessarRecusadas,
    };
  return {
    tipo: 'sincronizar',
    modo: u.modo ?? 'diferencial',
    continuarDe: null,
    reprocessarRecusadas: u.reprocessarRecusadas,
  };
}

export function acoesDaCarga(
  e: {
    estado: EstadoExecucaoConector;
    pausaSolicitada: boolean;
    tipo: TipoExecucaoConector;
    origemId: number | null;
  } | null,
  origemId: number | null,
): AcoesCarga {
  const ativa = !!e && ESTADOS_ATIVOS.includes(e.estado);
  return {
    iniciar: !ativa && origemId != null,
    pausar: ativa && !!e && ESTADOS_PAUSAVEIS.includes(e.estado) && !e.pausaSolicitada,
    retomar:
      !ativa && !!e && ESTADOS_RETOMAVEIS.includes(e.estado) && origemId != null && e.origemId === origemId,
  };
}

export function batimentoAtrasado(
  estado: EstadoExecucaoConector,
  segundosSemBatimento: number | null,
): boolean {
  return (
    ESTADOS_ATIVOS.includes(estado) &&
    segundosSemBatimento != null &&
    segundosSemBatimento > LIMITE_BATIMENTO_S
  );
}

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

/** `contadores.progresso` (chaves do motor em snake_case) -> ProgressoCarga; null se ausente ou fora do esquema. */
export function progressoDosContadores(c: Record<string, unknown>): ProgressoCarga | null {
  const p = c['progresso'];
  if (!p || typeof p !== 'object' || Array.isArray(p)) return null;
  const r = esquemaProgressoCarga.safeParse(
    Object.fromEntries(Object.entries(p as Record<string, unknown>).map(([k, v]) => [camel(k), v])),
  );
  return r.success ? r.data : null;
}

/** Percentual geral por linhas (processadas / total); sem progresso, o percentual da linha da execução. */
export function percentualDaCarga(p: ProgressoCarga | null, percentualLinha: number): number {
  if (p && p.linhasTotal > 0)
    return Math.round(Math.min(100, (100 * p.linhasProcessadas) / p.linhasTotal) * 100) / 100;
  return percentualLinha;
}

/** Caminho do log dentro da pasta de logs; null se escapa dela (absoluto, `..`, link para fora) ou não existe. */
export function caminhoDoLog(pasta: string, relativo: string): string | null {
  if (
    !relativo ||
    !/^[A-Za-z0-9_./-]+$/.test(relativo) ||
    relativo.startsWith('/') ||
    relativo.includes('..')
  )
    return null;
  try {
    const base = realpathSync(resolve(pasta));
    const alvo = realpathSync(resolve(base, relativo));
    if (!alvo.startsWith(base + sep) || !statSync(alvo).isFile()) return null;
    return alvo;
  } catch {
    return null;
  }
}

// ── portas ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Linha da execução lida pelo repositório (nomes já neutros). */
export interface LinhaExecucaoCarga {
  readonly id: number;
  readonly tipo: string;
  readonly estado: string;
  readonly etapa: string | null;
  readonly percentual: number;
  readonly contadores: Record<string, unknown>;
  readonly motivoFalha: string | null;
  readonly solicitadoEm: string | null;
  readonly iniciadoEm: string | null;
  readonly concluidoEm: string | null;
  readonly batimentoEm: string | null;
  readonly pausaSolicitadaEm: string | null;
  readonly modo: string | null;
  readonly arquivoLog: string | null;
  readonly origemId: number | null;
  readonly segundosSemBatimento: number | null;
}

export interface LinhaConectorCarga {
  readonly codigo: string;
  readonly nome: string;
  readonly origem: {
    readonly tipo: 'firebird_arquivo' | 'firebird_servidor';
    readonly nomeExibicao: string | null;
    readonly caminhoRelativo: string | null;
    readonly host: string | null;
    readonly porta: number | null;
    readonly banco: string | null;
    readonly senhaReferencia: string | null;
  } | null;
  readonly ultimaExecucao: LinhaExecucaoCarga | null;
}

export interface DadosOrigemServidor {
  readonly host: string;
  readonly porta: number;
  readonly banco: string;
  readonly usuario: string;
  readonly nomeExibicao: string;
}

export interface RepositorioCarga {
  listarConectores(): Promise<LinhaConectorCarga[]>;
  /** Grava (ou troca para) a origem de servidor ativa do cliente; 409 com execução ativa. */
  gravarOrigemServidor(
    codigo: string,
    dados: DadosOrigemServidor,
    referenciaSenha: string,
    admin: number | null,
  ): Promise<{ origemId: number; nova: boolean }>;
  /** Cliente existe? Tem origem de servidor ativa? (sem segredo) */
  origemDoCliente(codigo: string): Promise<{ existe: boolean; tipo: string | null }>;
  /** Execução ativa do cliente ou, sem ativa, a última; mais o id da origem ativa. */
  cargaDoCliente(
    codigo: string,
  ): Promise<{ origemId: number | null; execucao: LinhaExecucaoCarga | null } | null>;
  /** Lê a situação na transação (cliente travado), decide pela função dada e enfileira com o evento. */
  enfileirarCarga(
    codigo: string,
    decidir: (s: SituacaoCarga) => PlanoCarga,
    admin: number | null,
  ): Promise<{ id: number; plano: PlanoCarga }>;
  /** Grava o pedido de pausa na execução ativa (idempotente) com o evento; devolve o id. */
  pedirPausa(codigo: string, admin: number | null): Promise<number>;
  arquivoLog(codigo: string, id: number): Promise<string | null | undefined>;
}

export interface PonteCarga {
  testarOrigem(codigo: string): Promise<TesteOrigem>;
}

/** O que o serviço usa do cofre (o `Cofre` do módulo da assinatura). */
export interface CofreCarga {
  readonly disponivel: boolean;
  existe(referencia: string): Promise<boolean>;
  gravar(referencia: string, valor: string): Promise<void>;
}

export const SERVICO_CARGA = Symbol('SERVICO_CARGA');

// ── serviço ─────────────────────────────────────────────────────────────────────────────────────────────────────

function codigoValido(codigo: string): string {
  const r = esquemaCodigoCliente.safeParse(codigo);
  if (!r.success) throw new ErroOnboarding('invalido', 'Código de cliente inválido.');
  return r.data;
}

function resumo(l: LinhaExecucaoCarga): ExecucaoCargaResumo {
  const estado = (ESTADOS_EXECUCAO_CONECTOR as readonly string[]).includes(l.estado)
    ? (l.estado as EstadoExecucaoConector)
    : 'falhou';
  return {
    id: l.id,
    tipo: (TIPOS_EXECUCAO_CONECTOR as readonly string[]).includes(l.tipo)
      ? (l.tipo as TipoExecucaoConector)
      : 'importar',
    modo: (MODOS_CARGA as readonly string[]).includes(l.modo ?? '') ? (l.modo as ModoCarga) : null,
    estado,
    etapa: l.etapa,
    percentual: percentualDaCarga(progressoDosContadores(l.contadores), l.percentual),
    motivoFalha: l.motivoFalha,
    solicitadoEm: l.solicitadoEm,
    iniciadoEm: l.iniciadoEm,
    concluidoEm: l.concluidoEm,
    batimentoEm: l.batimentoEm,
    pausaSolicitadaEm: l.pausaSolicitadaEm,
    temLog: !!l.arquivoLog,
  };
}

export class ServicoCarga {
  constructor(
    private readonly repo: RepositorioCarga,
    private readonly ponte: PonteCarga,
    private readonly cofre: CofreCarga,
    /** CONECTOR_LOG_DIR; vazio = log indisponível. */
    private readonly pastaLogs: string | null,
  ) {}

  private async senhaDefinida(referencia: string | null): Promise<boolean> {
    if (!referencia) return false;
    // `env:NOME` (só fora de produção): a senha vem do ambiente do conector, fora do alcance da API.
    if (referencia.startsWith('env:')) return true;
    try {
      return this.cofre.disponivel && (await this.cofre.existe(referencia));
    } catch {
      return false;
    }
  }

  async listarConectores(): Promise<ConectorCarga[]> {
    const linhas = await this.repo.listarConectores();
    return Promise.all(
      linhas.map(async (l) => ({
        codigo: l.codigo,
        nome: l.nome,
        origem: l.origem
          ? {
              tipo: l.origem.tipo,
              nomeExibicao: l.origem.nomeExibicao,
              endereco:
                l.origem.tipo === 'firebird_servidor'
                  ? `${l.origem.host ?? ''}:${l.origem.porta ?? ''}/${l.origem.banco ?? ''}`
                  : (l.origem.caminhoRelativo ?? ''),
              senhaDefinida:
                l.origem.tipo === 'firebird_servidor'
                  ? await this.senhaDefinida(l.origem.senhaReferencia)
                  : null,
            }
          : null,
        ultimaExecucao: l.ultimaExecucao ? resumo(l.ultimaExecucao) : null,
      })),
    );
  }

  async gravarOrigemServidor(codigo: string, corpo: unknown, admin: number | null): Promise<OrigemServidor> {
    const cod = codigoValido(codigo);
    const r = esquemaOrigemServidorEntrada.safeParse(corpo);
    if (!r.success)
      throw new ErroOnboarding(
        'invalido',
        'Informe host, porta (1 a 65535), banco, usuário e nome da origem.',
      );
    const referencia = referenciaCofreConector(cod);
    const atual = await this.repo.origemDoCliente(cod);
    if (!atual.existe) throw new ErroOnboarding('inexistente', 'Cliente inexistente.');
    const { senha, ...dados } = r.data;
    if (senha !== undefined) {
      if (!this.cofre.disponivel)
        throw new ErroOnboarding('indisponivel', 'O cofre de segredos não está configurado neste ambiente.');
      await this.cofre.gravar(referencia, senha);
    } else if (!(await this.senhaDefinida(referencia)))
      throw new ErroOnboarding('invalido', 'Informe a senha do usuário de leitura.');
    await this.repo.gravarOrigemServidor(cod, dados, referencia, admin);
    return {
      host: dados.host,
      porta: dados.porta,
      banco: dados.banco,
      usuario: dados.usuario,
      nomeExibicao: dados.nomeExibicao,
      senhaDefinida: true,
    };
  }

  async testarOrigem(codigo: string): Promise<TesteOrigem> {
    const cod = codigoValido(codigo);
    const atual = await this.repo.origemDoCliente(cod);
    if (!atual.existe) throw new ErroOnboarding('inexistente', 'Cliente inexistente.');
    if (atual.tipo !== 'firebird_servidor')
      throw new ErroOnboarding('invalido', 'Configure a origem do servidor antes de testar.');
    return this.ponte.testarOrigem(cod);
  }

  async pedirCarga(codigo: string, corpo: unknown, admin: number | null): Promise<number> {
    const r = esquemaPedirCargaEntrada.safeParse(corpo);
    if (!r.success) throw new ErroOnboarding('invalido', 'Modo: completa ou diferencial.');
    const modo = r.data.modo;
    const { id } = await this.repo.enfileirarCarga(codigoValido(codigo), (s) => decidirCarga(modo, s), admin);
    return id;
  }

  async retomar(codigo: string, admin: number | null): Promise<number> {
    const { id } = await this.repo.enfileirarCarga(codigoValido(codigo), decidirRetomada, admin);
    return id;
  }

  pausar(codigo: string, admin: number | null): Promise<number> {
    return this.repo.pedirPausa(codigoValido(codigo), admin);
  }

  async carga(codigo: string): Promise<CargaCliente> {
    const cod = codigoValido(codigo);
    const r = await this.repo.cargaDoCliente(cod);
    if (!r) throw new ErroOnboarding('inexistente', 'Cliente inexistente.');
    const l = r.execucao;
    if (!l)
      return {
        codigo: cod,
        execucao: null,
        progresso: null,
        batimentoAtrasado: false,
        conciliacaoCarga: null,
        acoes: acoesDaCarga(null, r.origemId),
      };
    const execucao = resumo(l);
    const cc = l.contadores['conciliacao_carga'] as Record<string, unknown> | undefined;
    const recusadas = Number(cc?.['recusadas']);
    return {
      codigo: cod,
      execucao,
      progresso: progressoDosContadores(l.contadores),
      batimentoAtrasado: batimentoAtrasado(execucao.estado, l.segundosSemBatimento),
      conciliacaoCarga:
        cc && typeof cc === 'object' && Number.isSafeInteger(recusadas) && recusadas >= 0
          ? { recusadas, conferido: recusadas === 0 && cc['conferido'] !== false }
          : null,
      acoes: acoesDaCarga(
        {
          estado: execucao.estado,
          pausaSolicitada: !!l.pausaSolicitadaEm,
          tipo: execucao.tipo,
          origemId: l.origemId,
        },
        r.origemId,
      ),
    };
  }

  /** Caminho absoluto do log da execução (já conferido dentro da pasta de logs). */
  async log(codigo: string, id: number): Promise<string> {
    if (!Number.isSafeInteger(id) || id <= 0) throw new ErroOnboarding('invalido', 'Execução inválida.');
    if (!this.pastaLogs)
      throw new ErroOnboarding('indisponivel', 'A pasta de logs do conector não está configurada.');
    const rel = await this.repo.arquivoLog(codigoValido(codigo), id);
    if (rel === undefined) throw new ErroOnboarding('inexistente', 'Execução não encontrada.');
    const caminho = rel ? caminhoDoLog(this.pastaLogs, rel) : null;
    if (!caminho) throw new ErroOnboarding('inexistente', 'A execução não tem log.');
    return caminho;
  }
}
