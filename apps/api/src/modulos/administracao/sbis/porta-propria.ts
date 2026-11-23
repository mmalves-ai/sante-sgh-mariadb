// Porta própria do M59-F5 (certificação SBIS: ciclos de avaliação, termo das concessões e backup verificado) sobre o
// banco do cliente, pelo @sgh/nucleo. Leituras numa transação somente leitura; gravações pelo Executor, com a trilha de
// auditoria e a idempotência na mesma transação e as tabelas declaradas por operação. O estabelecimento vem pelo código
// da sessão e o usuário pelo login (ids do banco do cliente); nada de cliente fixo no código.
// Tabelas: ciclo_certificacao e ciclo_certificacao_item (pedido de modelo do lote 02-06: enquanto não existem, o
// recurso "ciclos" responde "recurso ainda não instalado", com as tabelas que faltam), verificacao_backup (as
// restaurações conferidas), estabelecimento (nome, CNES, CNPJ) e politica_senha (tentativas e inatividade).
// Melhoria: a leitura dos itens confere que o ciclo é do estabelecimento da sessão (antes, só o id do ciclo).
// Melhoria: cada mudança de item ou de ciclo trava a linha (SELECT ... FOR UPDATE) e grava pela trava otimista
// (versao), com a mesma condição de antes (NC sem correção verificada não se reavalia; quem corrigiu não verifica).
// Melhoria: o cancelamento guarda o motivo no ciclo (antes, só na trilha) e quem abriu, avaliou, corrigiu ou
// verificou é o usuário por id (chave estrangeira), não um texto de login.
// Melhoria: as restaurações ficam no registro único de cópias de segurança (verificacao_backup, processo
// "restauracao"), do cliente inteiro: o banco é um por cliente, e a cópia é dele, não de um estabelecimento.
// Concessões (ADR 0003): o produto não convive com sistema anterior; as seis concessões provisórias da convivência
// não existem e constam encerradas, sem tabela. Reabrir ou prever fim é recusado com o motivo.
// Prova da cadeia (SBIS-16): a trilha_auditoria do núcleo ainda não é encadeada por hash (pedido de modelo do lote
// 02-06); até lá, verificarDias recusa com "trilha-sem-encadeamento" (o painel mostra o item pendente e a exportação
// para a auditoria responde 503 com o motivo), nunca uma prova inventada.
// Melhoria: a recusa apurada dentro da transação (item ou ciclo que mudou, ciclo aberto do tipo) desfaz a transação
// (RecusaGravacaoSbis, 409): o Executor conta "recusa" e nada fica na trilha nem na idempotência.
// Melhoria: a chave de idempotência é a do pedido (Idempotency-Key, pela TrilhaSbis): o reenvio do mesmo pedido
// devolve o resultado gravado (uma linha só, uma trilha só), em vez de gravar de novo.
import { randomUUID } from 'node:crypto';
import {
  CONCESSOES_COEXISTENCIA,
  type ItemCicloSbis,
  type NivelSbis,
  type OrigemNcSbis,
  type ParecerSbis,
  REQUISITOS_SBIS,
  type Restauracao,
  type ResultadoItemSbis,
  type SeveridadeNcSbis,
  type SituacaoCicloSbis,
  type SituacaoCorrecaoSbis,
  type TipoCicloSbis,
} from '@sgh/contratos';
import {
  definirOperacao,
  ErroOperacao,
  type Executor,
  type Leitor,
  type NucleoProprio,
  type ResultadoOperacao,
  type TxOperacao,
  verificarDiaTrilha,
} from '@sgh/nucleo';
import { z } from 'zod';
import { ErroProblema } from '../../../problema.filter.js';
import { CONFIG_LOGIN_PADRAO } from '../../../sessao/tipos-acesso.js';
import type {
  CicloCertificacao,
  ConcessaoRegistrada,
  ConfigSeguranca,
  IdentificacaoEstabelecimento,
  NovoCiclo,
  PortaSbis,
  RecursoSbis,
  TrilhaSbis,
  VerificacaoDiaTrilha,
} from './porta.js';

/** O mínimo do núcleo que a porta usa (os testes trocam). */
export type NucleoSbis = Pick<NucleoProprio, 'lerSomente' | 'criarExecutor'>;

/** As tabelas de cada recurso (o que `faltando` confere no banco do cliente). */
export const TABELAS_SBIS: Readonly<Record<RecursoSbis, readonly string[]>> = {
  ciclos: ['ciclo_certificacao', 'ciclo_certificacao_item'],
  concessoes: [],
  backup: ['verificacao_backup'],
};

/** Ciclos lidos (os mais recentes) e janela das restaurações. */
const TETO_CICLOS = 60;
const DIAS_RESTAURACOES = 62;
const TETO_RESTAURACOES = 200;
const BYTES_MB = 1_048_576;

export const TEXTO_SEM_CONVIVENCIA =
  'O produto não convive com sistema anterior: a concessão provisória da convivência não existe neste banco.';

type Linha = Record<string, unknown>;
const texto = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const textoOuNulo = (v: unknown): string | null => {
  const t = texto(v).trim();
  return t === '' ? null : t;
};
const instante = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(`${String(v).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};
/** Valor fixo do contrato (com hífen) ↔ valor do banco (snake_case, convenção do DDL). */
const paraBanco = (v: string): string => v.replace(/-/g, '_');
const doBanco = <T extends string>(v: unknown): T => texto(v).replace(/_/g, '-') as T;
const doBancoOuNulo = <T extends string>(v: unknown): T | null =>
  textoOuNulo(v) === null ? null : doBanco<T>(v);
const idDe = (v: string): number => {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0)
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Ciclo inválido.');
  return n;
};

const SQL_CICLO = `
  SELECT c.id, c.tipo, c.competencia, c.versao_software, c.referencia, c.avaliador, c.situacao, c.parecer,
         c.parecer_texto, c.certificado, ua.login AS aberto_por, c.aberto_em, uc.login AS concluido_por, c.concluido_em
    FROM ciclo_certificacao c
    JOIN estabelecimento e ON e.id = c.estabelecimento_id
    JOIN usuario ua ON ua.id = c.aberto_por_usuario_id
    LEFT JOIN usuario uc ON uc.id = c.concluido_por_usuario_id
   WHERE e.codigo = ? AND e.excluido_em IS NULL AND c.excluido_em IS NULL`;

export function cicloDaLinha(x: Linha): CicloCertificacao {
  return {
    id: texto(x['id']),
    tipo: doBanco<TipoCicloSbis>(x['tipo']),
    competencia: texto(x['competencia']),
    versao: texto(x['versao_software']),
    referencia: texto(x['referencia']),
    avaliador: textoOuNulo(x['avaliador']),
    situacao: doBanco<SituacaoCicloSbis>(x['situacao']),
    parecer: doBancoOuNulo<ParecerSbis>(x['parecer']),
    parecerTexto: textoOuNulo(x['parecer_texto']),
    certificado: textoOuNulo(x['certificado']),
    abertoPor: texto(x['aberto_por']),
    abertoEm: instante(x['aberto_em']) ?? new Date(0).toISOString(),
    concluidoPor: textoOuNulo(x['concluido_por']),
    concluidoEm: instante(x['concluido_em']),
  };
}

const REQ = new Map(REQUISITOS_SBIS.map((r, i) => [r.codigo, { r, i }]));

export function itemDaLinha(x: Linha): ItemCicloSbis {
  const codigo = texto(x['requisito']);
  const r = REQ.get(codigo)?.r;
  return {
    requisito: codigo,
    nivel: (r?.nivel ?? 'NGS1') as NivelSbis,
    titulo: r?.titulo ?? codigo,
    resultado: doBanco<ResultadoItemSbis>(x['resultado']),
    severidade: doBancoOuNulo<SeveridadeNcSbis>(x['severidade']),
    origem: doBancoOuNulo<OrigemNcSbis>(x['origem_nao_conformidade']),
    evidencia: textoOuNulo(x['evidencia']),
    observacao: textoOuNulo(x['observacao']),
    avaliadoPor: textoOuNulo(x['avaliado_por']),
    avaliadoEm: instante(x['avaliado_em']),
    correcao: doBancoOuNulo<SituacaoCorrecaoSbis>(x['situacao_correcao']),
    correcaoDescricao: textoOuNulo(x['descricao_correcao']),
    corrigidoPor: textoOuNulo(x['corrigido_por']),
    corrigidoEm: instante(x['corrigido_em']),
    verificadoPor: textoOuNulo(x['verificado_por']),
    verificadoEm: instante(x['verificado_em']),
  };
}

interface DadosRestauracao {
  periodicidade?: unknown;
  integridade?: unknown;
  observacao?: unknown;
}

export function restauracaoDaLinha(x: Linha): Restauracao {
  let d: DadosRestauracao;
  try {
    const bruto = x['dados'];
    d = (typeof bruto === 'string' ? JSON.parse(bruto) : (bruto ?? {})) as DadosRestauracao;
  } catch {
    d = {};
  }
  const inicio = instante(x['iniciado_em']) ?? new Date(0).toISOString();
  const fim = instante(x['concluido_em']) ?? inicio;
  const bytes = x['tamanho_bytes'];
  return {
    id: texto(x['id']),
    tipo: texto(d.periodicidade) === 'mensal' ? 'mensal' : 'diaria',
    inicio,
    fim,
    duracaoMinutos: Math.max(0, Math.round((Date.parse(fim) - Date.parse(inicio)) / 60_000)),
    resultado: texto(x['situacao']) === 'concluido' ? 'ok' : 'falhou',
    integridade: doBanco<Restauracao['integridade']>(textoOuNulo(d.integridade) ?? 'nao_verificada'),
    tamanhoMb: bytes === null || bytes === undefined ? null : Math.round(Number(bytes) / BYTES_MB),
    ambiente: texto(x['destino']),
    observacao: textoOuNulo(d.observacao),
    registradoPor: texto(x['registrado_por']),
    registradoEm: instante(x['criado_em']) ?? fim,
  };
}

const ENTRADA = z.record(z.string(), z.unknown());

/** Recusa apurada dentro da gravação (a condição mudou): desfaz a transação; a porta devolve "não gravou". */
export class RecusaGravacaoSbis extends ErroOperacao {
  constructor() {
    super(
      409,
      'recusa-de-negocio',
      'Ação recusada',
      'A situação do ciclo ou do item mudou: nada foi gravado.',
    );
  }
}
const recusar = (): never => {
  throw new RecusaGravacaoSbis();
};

interface PedidoGravacao<S extends ResultadoOperacao> {
  readonly nome: string;
  readonly tabelas: readonly string[];
  readonly entidade: string;
  readonly entrada: Record<string, unknown>;
  readonly motivo?: string | null;
  readonly fn: (tx: TxOperacao, est: number, usuario: number) => Promise<S>;
  readonly alvoId?: (s: S) => number | null;
}

export class PortaSbisPropria implements PortaSbis {
  readonly destino = 'banco' as const;
  private readonly executor: Executor;

  constructor(
    private readonly nucleo: NucleoSbis,
    private readonly cliente: string,
    executorPronto?: Executor,
  ) {
    this.executor = executorPronto ?? nucleo.criarExecutor();
  }

  private ler<T>(correlacao: string, fn: (l: Leitor) => Promise<T>): Promise<T> {
    return this.nucleo.lerSomente({ cliente: this.cliente, correlacao: correlacao.slice(0, 64) }, fn);
  }

  /** O estabelecimento (pelo código da sessão) e o usuário (pelo login) da gravação; desconhecidos: recusa. */
  private async ids(h: string, login: string, correlacao: string): Promise<{ est: number; usuario: number }> {
    const r = await this.ler(correlacao, (l) =>
      l.uma<Linha>(
        `SELECT e.id AS est,
                (SELECT u.id FROM usuario u WHERE u.login = ? AND u.excluido_em IS NULL) AS usuario
           FROM estabelecimento e WHERE e.codigo = ? AND e.excluido_em IS NULL`,
        [login, h],
      ),
    );
    if (!r)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Ação recusada',
        'O estabelecimento da sessão não existe neste banco.',
        {
          codigo: 'estabelecimento-desconhecido',
        },
      );
    if (r['usuario'] === null || r['usuario'] === undefined)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Ação recusada',
        'O usuário da sessão não tem conta neste banco.',
        {
          codigo: 'usuario-desconhecido',
        },
      );
    return { est: Number(r['est']), usuario: Number(r['usuario']) };
  }

  /**
   * Uma gravação pelo Executor: tabelas declaradas, trilha (evento, recurso, operação, estação) e idempotência pela
   * chave do pedido. A recusa apurada na transação (RecusaGravacaoSbis) volta como null: nada gravado, nem trilha.
   */
  private async gravar<S extends ResultadoOperacao>(
    h: string,
    t: TrilhaSbis,
    p: PedidoGravacao<S>,
  ): Promise<S | null> {
    const { est, usuario } = await this.ids(h, t.usuario, t.correlacao);
    const op = definirOperacao<Record<string, unknown>, S>({
      nome: p.nome,
      tabelas: p.tabelas,
      entrada: ENTRADA,
      gravar: (tx) => p.fn(tx, est, usuario),
      alvo: (_e, s) => ({ tabela: p.entidade, id: p.alvoId?.(s) ?? null }),
      trilha: () => ({
        dados: { evento: t.evento, recurso: t.recurso, operacao: t.operacao, estacao: t.estacao },
        motivo: p.motivo ?? null,
      }),
    });
    try {
      const saida = await this.executor.executar(op, this.cliente, p.entrada, {
        cliente: this.cliente,
        estabelecimento: est,
        usuario,
        correlacao: t.correlacao.slice(0, 64),
        // Sem chave do pedido (chamada interna, não HTTP), uma chave nova: não há reenvio a reconhecer.
        chaveIdempotencia: t.chaveIdempotencia ?? `sbis.${randomUUID()}`,
      });
      return saida.resultado;
    } catch (e) {
      if (e instanceof RecusaGravacaoSbis) return null;
      throw e;
    }
  }

  // ── recursos ───────────────────────────────────────────────────────────────────────────────────

  async faltando(h: string, recurso: RecursoSbis): Promise<string[]> {
    const tabelas = TABELAS_SBIS[recurso];
    if (tabelas.length === 0) return [];
    const linhas = await this.ler(`sbis-faltando-${h}`, (l) =>
      l.consultar<Linha>(
        `SELECT TABLE_NAME AS nome FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${tabelas.map(() => '?').join(', ')})`,
        [...tabelas],
        { teto: tabelas.length },
      ),
    );
    const tem = new Set(linhas.map((x) => texto(x['nome'])));
    return tabelas.filter((t) => !tem.has(t));
  }

  // ── concessões (ADR 0003: sem convivência, todas encerradas) ────────────────────────────────────

  async concessoes(): Promise<ConcessaoRegistrada[]> {
    return CONCESSOES_COEXISTENCIA.map((codigo) => ({
      codigo,
      situacao: 'encerrada' as const,
      fimPrevisto: null,
      evidencia: TEXTO_SEM_CONVIVENCIA,
      encerradaPor: null,
      encerradaEm: null,
      reabertaPor: null,
      reabertaEm: null,
      motivoReabertura: null,
    }));
  }

  private semConvivencia(): Promise<never> {
    return Promise.reject(
      new ErroProblema('recusa-de-negocio', 409, 'Ação recusada', TEXTO_SEM_CONVIVENCIA, {
        codigo: 'sem-convivencia',
      }),
    );
  }

  async encerrar(): Promise<boolean> {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  reabrir(_h: string, _c: Parameters<PortaSbis['reabrir']>[1], _t: TrilhaSbis): Promise<boolean> {
    return this.semConvivencia();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  prever(_h: string, _c: Parameters<PortaSbis['prever']>[1], _t: TrilhaSbis): Promise<boolean> {
    return this.semConvivencia();
  }

  // ── ciclos ─────────────────────────────────────────────────────────────────────────────────────

  async ciclos(h: string): Promise<CicloCertificacao[]> {
    const linhas = await this.ler(`sbis-ciclos-${h}`, (l) =>
      l.consultar<Linha>(`${SQL_CICLO} ORDER BY c.id DESC LIMIT ${TETO_CICLOS}`, [h], { teto: TETO_CICLOS }),
    );
    return linhas.map(cicloDaLinha);
  }

  async ciclo(h: string, id: string): Promise<CicloCertificacao | null> {
    const n = idDe(id);
    const x = await this.ler(`sbis-ciclo-${h}`, (l) => l.uma<Linha>(`${SQL_CICLO} AND c.id = ?`, [h, n]));
    return x ? cicloDaLinha(x) : null;
  }

  async itens(h: string, id: string): Promise<ItemCicloSbis[]> {
    const n = idDe(id);
    const linhas = await this.ler(`sbis-itens-${h}`, (l) =>
      l.consultar<Linha>(
        `SELECT i.requisito, i.resultado, i.severidade, i.origem_nao_conformidade, i.evidencia, i.observacao,
                uav.login AS avaliado_por, i.avaliado_em, i.situacao_correcao, i.descricao_correcao,
                uco.login AS corrigido_por, i.corrigido_em, uve.login AS verificado_por, i.verificado_em
           FROM ciclo_certificacao_item i
           JOIN ciclo_certificacao c ON c.id = i.ciclo_certificacao_id
           JOIN estabelecimento e ON e.id = c.estabelecimento_id
           LEFT JOIN usuario uav ON uav.id = i.avaliado_por_usuario_id
           LEFT JOIN usuario uco ON uco.id = i.corrigido_por_usuario_id
           LEFT JOIN usuario uve ON uve.id = i.verificado_por_usuario_id
          WHERE c.id = ? AND e.codigo = ? AND c.excluido_em IS NULL AND i.excluido_em IS NULL`,
        [n, h],
        { teto: 1_000 },
      ),
    );
    return linhas
      .map(itemDaLinha)
      .sort((a, b) => (REQ.get(a.requisito)?.i ?? 1e6) - (REQ.get(b.requisito)?.i ?? 1e6));
  }

  async abrir(h: string, n: NovoCiclo, t: TrilhaSbis): Promise<{ id: string } | null> {
    const r = await this.gravar(h, t, {
      nome: 'auditoria.sbis.abrir-ciclo',
      tabelas: TABELAS_SBIS.ciclos,
      entidade: 'ciclo_certificacao',
      entrada: { tipo: n.tipo, competencia: n.competencia, versao: n.versao },
      fn: async (tx, est, usuario) => {
        const tipo = paraBanco(n.tipo);
        // Um ciclo aberto por tipo no estabelecimento: a leitura trava o intervalo do índice (a segunda abertura espera).
        const aberto = await tx.consultarParaAtualizar(
          `SELECT id FROM ciclo_certificacao
            WHERE estabelecimento_id = ? AND tipo = ? AND situacao = 'aberto' AND excluido_em IS NULL`,
          [est, tipo],
          { teto: 1 },
        );
        if (aberto.length > 0) recusar();
        const id = await tx.incluir('ciclo_certificacao', {
          estabelecimento_id: est,
          tipo,
          competencia: n.competencia,
          versao_software: n.versao,
          referencia: n.referencia,
          avaliador: n.avaliador,
          situacao: 'aberto',
          aberto_por_usuario_id: usuario,
          aberto_em: new Date(),
        });
        for (const requisito of n.requisitos)
          await tx.incluir('ciclo_certificacao_item', {
            ciclo_certificacao_id: id,
            requisito,
            resultado: 'pendente',
          });
        return { id };
      },
      alvoId: (s) => (typeof s.id === 'number' ? s.id : null),
    });
    return r && typeof r.id === 'number' ? { id: String(r.id) } : null;
  }

  /** O item do ciclo ABERTO do estabelecimento, travado (ciclo e item); null quando não há. */
  private async itemTravado(
    tx: TxOperacao,
    est: number,
    idCiclo: string,
    requisito: string,
  ): Promise<Linha | null> {
    const [x] = await tx.consultarParaAtualizar<Linha>(
      `SELECT i.id, i.versao, i.resultado, i.situacao_correcao, i.corrigido_por_usuario_id
         FROM ciclo_certificacao_item i
         JOIN ciclo_certificacao c ON c.id = i.ciclo_certificacao_id
        WHERE c.id = ? AND c.estabelecimento_id = ? AND c.situacao = 'aberto' AND c.excluido_em IS NULL
          AND i.requisito = ? AND i.excluido_em IS NULL`,
      [idDe(idCiclo), est, requisito],
      { teto: 1 },
    );
    return x ?? null;
  }

  async avaliar(h: string, a: Parameters<PortaSbis['avaliar']>[1], t: TrilhaSbis): Promise<boolean> {
    const p = a.pedido;
    const r = await this.gravar(h, t, {
      nome: 'auditoria.sbis.avaliar-item',
      tabelas: TABELAS_SBIS.ciclos,
      entidade: 'ciclo_certificacao_item',
      entrada: { ciclo: a.idCiclo, requisito: a.requisito, ...p },
      fn: async (tx, est, usuario) => {
        const i = await this.itemTravado(tx, est, a.idCiclo, a.requisito);
        // A NC sem correção verificada não se reavalia.
        if (
          !i ||
          (texto(i['resultado']) === 'nao_conforme' && texto(i['situacao_correcao']) !== 'verificada')
        )
          return recusar();
        const nc = p.resultado === 'nao-conforme';
        await tx.alterar('ciclo_certificacao_item', Number(i['id']), Number(i['versao']), {
          resultado: paraBanco(p.resultado),
          severidade: nc ? (p.severidade ?? null) : null,
          origem_nao_conformidade: nc ? (p.origem ?? null) : p.resultado === 'concessao' ? 'concessao' : null,
          evidencia: p.evidencia?.trim() || null,
          observacao: p.observacao?.trim() || null,
          avaliado_por_usuario_id: usuario,
          avaliado_em: new Date(),
          situacao_correcao: nc ? 'aberta' : null,
          descricao_correcao: null,
          corrigido_por_usuario_id: null,
          corrigido_em: null,
          verificado_por_usuario_id: null,
          verificado_em: null,
        });
        return { id: Number(i['id']) };
      },
      alvoId: (s) => (typeof s.id === 'number' ? s.id : null),
    });
    return r !== null;
  }

  async corrigir(h: string, a: Parameters<PortaSbis['corrigir']>[1], t: TrilhaSbis): Promise<boolean> {
    const r = await this.gravar(h, t, {
      nome: 'auditoria.sbis.corrigir-item',
      tabelas: TABELAS_SBIS.ciclos,
      entidade: 'ciclo_certificacao_item',
      entrada: { ciclo: a.idCiclo, requisito: a.requisito, descricao: a.descricao },
      fn: async (tx, est, usuario) => {
        const i = await this.itemTravado(tx, est, a.idCiclo, a.requisito);
        if (!i || texto(i['resultado']) !== 'nao_conforme' || texto(i['situacao_correcao']) !== 'aberta')
          return recusar();
        await tx.alterar('ciclo_certificacao_item', Number(i['id']), Number(i['versao']), {
          situacao_correcao: 'corrigida',
          descricao_correcao: a.descricao,
          corrigido_por_usuario_id: usuario,
          corrigido_em: new Date(),
        });
        return { id: Number(i['id']) };
      },
      alvoId: (s) => (typeof s.id === 'number' ? s.id : null),
    });
    return r !== null;
  }

  async verificar(h: string, a: Parameters<PortaSbis['verificar']>[1], t: TrilhaSbis): Promise<boolean> {
    const r = await this.gravar(h, t, {
      nome: 'auditoria.sbis.verificar-item',
      tabelas: TABELAS_SBIS.ciclos,
      entidade: 'ciclo_certificacao_item',
      entrada: { ciclo: a.idCiclo, requisito: a.requisito },
      fn: async (tx, est, usuario) => {
        const i = await this.itemTravado(tx, est, a.idCiclo, a.requisito);
        // Quem corrigiu não verifica a própria correção.
        if (
          !i ||
          texto(i['situacao_correcao']) !== 'corrigida' ||
          Number(i['corrigido_por_usuario_id']) === usuario
        )
          return recusar();
        await tx.alterar('ciclo_certificacao_item', Number(i['id']), Number(i['versao']), {
          situacao_correcao: 'verificada',
          verificado_por_usuario_id: usuario,
          verificado_em: new Date(),
        });
        return { id: Number(i['id']) };
      },
      alvoId: (s) => (typeof s.id === 'number' ? s.id : null),
    });
    return r !== null;
  }

  /** O ciclo ABERTO do estabelecimento, travado; null quando não há. */
  private async cicloTravado(tx: TxOperacao, est: number, id: string): Promise<Linha | null> {
    const [x] = await tx.consultarParaAtualizar<Linha>(
      `SELECT id, versao FROM ciclo_certificacao
        WHERE id = ? AND estabelecimento_id = ? AND situacao = 'aberto' AND excluido_em IS NULL`,
      [idDe(id), est],
      { teto: 1 },
    );
    return x ?? null;
  }

  async concluir(h: string, c: Parameters<PortaSbis['concluir']>[1], t: TrilhaSbis): Promise<boolean> {
    const r = await this.gravar(h, t, {
      nome: 'auditoria.sbis.concluir-ciclo',
      tabelas: TABELAS_SBIS.ciclos,
      entidade: 'ciclo_certificacao',
      entrada: { ciclo: c.id, parecer: c.parecer, certificado: c.certificado },
      motivo: c.parecerTexto.slice(0, 500),
      fn: async (tx, est, usuario) => {
        const ciclo = await this.cicloTravado(tx, est, c.id);
        if (!ciclo) return recusar();
        const conta = await tx.uma<Linha>(
          `SELECT SUM(resultado = 'pendente') AS pendentes,
                  SUM(resultado = 'nao_conforme' AND severidade = 'bloqueante'
                      AND COALESCE(situacao_correcao, '') <> 'verificada') AS bloqueantes
             FROM ciclo_certificacao_item WHERE ciclo_certificacao_id = ? AND excluido_em IS NULL`,
          [Number(ciclo['id'])],
        );
        // Nenhum item pendente; no parecer apto, nenhuma bloqueante sem correção verificada (gravada agora por outro).
        if (Number(conta?.['pendentes'] ?? 0) > 0) return recusar();
        if (c.parecer === 'apto' && Number(conta?.['bloqueantes'] ?? 0) > 0) return recusar();
        await tx.alterar('ciclo_certificacao', Number(ciclo['id']), Number(ciclo['versao']), {
          situacao: 'concluido',
          parecer: paraBanco(c.parecer),
          parecer_texto: c.parecerTexto,
          certificado: c.certificado,
          concluido_por_usuario_id: usuario,
          concluido_em: new Date(),
        });
        return { id: Number(ciclo['id']) };
      },
      alvoId: (s) => (typeof s.id === 'number' ? s.id : null),
    });
    return r !== null;
  }

  async cancelar(h: string, c: Parameters<PortaSbis['cancelar']>[1], t: TrilhaSbis): Promise<boolean> {
    const r = await this.gravar(h, t, {
      nome: 'auditoria.sbis.cancelar-ciclo',
      tabelas: TABELAS_SBIS.ciclos,
      entidade: 'ciclo_certificacao',
      entrada: { ciclo: c.id, motivo: c.motivo },
      motivo: c.motivo.slice(0, 500),
      fn: async (tx, est, usuario) => {
        const ciclo = await this.cicloTravado(tx, est, c.id);
        if (!ciclo) return recusar();
        await tx.alterar('ciclo_certificacao', Number(ciclo['id']), Number(ciclo['versao']), {
          situacao: 'cancelado',
          motivo_cancelamento: c.motivo,
          concluido_por_usuario_id: usuario,
          concluido_em: new Date(),
        });
        return { id: Number(ciclo['id']) };
      },
      alvoId: (s) => (typeof s.id === 'number' ? s.id : null),
    });
    return r !== null;
  }

  // ── backup verificado ──────────────────────────────────────────────────────────────────────────

  async restauracoes(h: string): Promise<Restauracao[]> {
    // Dado do cliente inteiro (a cópia é do banco do cliente, não de um estabelecimento): sem filtro de estabelecimento.
    const desde = new Date(Date.now() - DIAS_RESTAURACOES * 86_400_000);
    const linhas = await this.ler(`sbis-restauracoes-${h}`, (l) =>
      l.consultar<Linha>(
        `SELECT v.id, v.iniciado_em, v.concluido_em, v.situacao, v.tamanho_bytes, v.destino, v.dados, v.criado_em,
                u.login AS registrado_por
           FROM verificacao_backup v
           LEFT JOIN usuario u ON u.id = v.usuario_id
          WHERE v.processo = 'restauracao' AND v.situacao IN ('concluido', 'falhou') AND v.concluido_em >= ?
          ORDER BY v.concluido_em DESC, v.id DESC
          LIMIT ${TETO_RESTAURACOES}`,
        [desde],
        { teto: TETO_RESTAURACOES },
      ),
    );
    return linhas.map(restauracaoDaLinha);
  }

  async registrarRestauracao(
    h: string,
    r: Parameters<PortaSbis['registrarRestauracao']>[1],
    t: TrilhaSbis,
  ): Promise<{ id: string }> {
    const p = r.pedido;
    const s = await this.gravar(h, t, {
      nome: 'auditoria.backup.registrar-restauracao',
      tabelas: TABELAS_SBIS.backup,
      entidade: 'verificacao_backup',
      entrada: { ...p },
      fn: async (tx, _est, usuario) => {
        const fim = new Date(p.fim);
        const id = await tx.incluir('verificacao_backup', {
          processo: 'restauracao',
          modalidade: 'completa',
          iniciado_em: new Date(p.inicio),
          concluido_em: fim,
          tamanho_bytes: p.tamanhoMb === undefined ? null : p.tamanhoMb * BYTES_MB,
          destino: p.ambiente.trim(),
          situacao: p.resultado === 'ok' ? 'concluido' : 'falhou',
          mensagem_erro: p.resultado === 'falhou' ? p.observacao?.trim() || null : null,
          // Periodicidade, integridade conferida e observação: colunas pedidas ao modelo (pedido do lote 02-06).
          dados: JSON.stringify({
            periodicidade: p.tipo,
            integridade: paraBanco(p.integridade),
            observacao: p.observacao?.trim() || null,
          }),
          ocorrido_em: fim,
          usuario_id: usuario,
        });
        return { id };
      },
      alvoId: (x) => (typeof x.id === 'number' ? x.id : null),
    });
    // A restauração não tem recusa dentro da transação: sem resultado, é falha do banco.
    if (!s)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Serviço indisponível',
        'A restauração não foi registrada.',
      );
    return { id: String(s.id) };
  }

  // ── identificação, política e prova da cadeia ─────────────────────────────────────────────────

  async identificacao(h: string): Promise<IdentificacaoEstabelecimento> {
    const x = await this.ler(`sbis-identificacao-${h}`, (l) =>
      l.uma<Linha>(
        'SELECT nome_fantasia, razao_social, codigo_cnes, cnpj FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
        [h],
      ),
    );
    if (!x)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Estabelecimento não encontrado',
        'O estabelecimento da sessão não existe neste banco.',
      );
    return {
      nome: textoOuNulo(x['nome_fantasia']) ?? textoOuNulo(x['razao_social']),
      cnes: textoOuNulo(x['codigo_cnes']),
      cnpj: textoOuNulo(x['cnpj']),
    };
  }

  async configSeguranca(h: string): Promise<ConfigSeguranca> {
    const x = await this.ler(`sbis-politica-${h}`, (l) =>
      l.uma<Linha>(
        `SELECT p.tentativas_ate_bloqueio, p.inatividade_sessao_minutos
           FROM politica_senha p JOIN estabelecimento e ON e.id = p.estabelecimento_id
          WHERE e.codigo = ? AND e.excluido_em IS NULL`,
        [h],
      ),
    );
    // Sem política própria vale o padrão seguro do produto (o mesmo do login).
    if (!x)
      return {
        limiteTentativas: CONFIG_LOGIN_PADRAO.limiteTentativas,
        inatividadeSegundos: CONFIG_LOGIN_PADRAO.tempo.inatividadeSegundos,
      };
    return {
      limiteTentativas: Number(x['tentativas_ate_bloqueio']),
      inatividadeSegundos: Number(x['inatividade_sessao_minutos']) * 60,
    };
  }

  /**
   * SBIS-16: a prova da cadeia de cada dia (o núcleo recalcula o hash de cada linha, confere cada elo e o fim do dia
   * com o fecho diário, ou com a cabeça da cadeia no dia ainda aberto). Tudo numa leitura só (um retrato do banco).
   */
  async verificarDias(h: string, dias: readonly string[]): Promise<VerificacaoDiaTrilha[]> {
    return this.ler(`sbis-cadeia-${h}`, async (l) => {
      const est = await l.uma<Linha>(
        'SELECT id FROM estabelecimento WHERE codigo = ? AND excluido_em IS NULL',
        [h],
      );
      if (!est)
        throw new ErroProblema(
          'nao-encontrado',
          404,
          'Estabelecimento não encontrado',
          'O estabelecimento da sessão não existe neste banco.',
        );
      const r: VerificacaoDiaTrilha[] = [];
      for (const dia of dias) r.push(await verificarDiaTrilha(l, Number(est['id']), dia));
      return r;
    });
  }
}
