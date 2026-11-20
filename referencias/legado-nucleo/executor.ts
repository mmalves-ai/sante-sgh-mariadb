// Executor de operações (ficha do M04; cap-10 §10.2; roteiro 4.6 e 6.2): o ÚNICO caminho de escrita do
// novo no banco do legado. `executar(operacao, hospital, entrada, contexto)` faz, nesta ordem:
//   0. confere contexto (TBUSERS.NOME de quem opera, Idempotency-Key), entrada (Zod), catálogo (em produção
//      só `liberada` e com a chave de SGH_CFG_LIBERACAO ligada para o estabelecimento, o setor ou a pessoa),
//      marca de schema do M02, reautenticação (operação crítica) e a Idempotency-Key em SGH_IDEMPOTENCIA;
//   1. abre a transação curta (READ COMMITTED, LOCK TIMEOUT do M02) só no "Salvar";
//   2. trava e relê a linha principal (SELECT … WITH LOCK, tabela física única) quando altera linha existente;
//   3. confere a condição no estado relido (controle otimista pelas colunas relidas);
//   4. grava pela receita (só nas tabelas da receita; nunca nas tabelas de efeito de trigger);
//   5. prova pós-escrita (faltou efeito: desfaz e devolve 409 acao_sem_efeito);
//   6. grava SGH_TRILHA, SGH_OUTBOX e SGH_IDEMPOTENCIA na mesma transação;
//   7. confirma; só então os eventos seguem (aviso ao relay da outbox).
// Conflito de versão: 409 com as colunas que mudaram; trava ocupada além do LOCK TIMEOUT: 409 "registro em
// edição em outro terminal". Erro em qualquer passo desfaz tudo.
import { createHash } from 'node:crypto';
import type { EstadoOperacao } from '@sgh/contratos';
import type { FonteCatalogo } from './catalogo-operacoes.js';
import { conferirContexto } from './contexto.js';
import type { Linha } from './driver.js';
import {
  ErroOperacao,
  ErroProva,
  erroAcaoSemEfeito,
  erroConflitoVersao,
  erroContextoEscrita,
  erroEntradaInvalida,
  erroIdempotenciaDivergente,
  erroNaoLiberada,
  erroOperacaoBloqueada,
  erroReautenticacao,
  erroRegistroEmEdicao,
  erroRequisicaoEmAndamento,
  erroSchemaDivergente,
  ehTravaOcupada,
  restricaoUnicaViolada,
} from './erros-operacao.js';
import { problemaDoLegado } from './erros.js';
import { ErroImagemComo } from './como.js';
import {
  gravarEventoLegado,
  RECEITA_REGISTRAR_EVENTO_LEGADO,
} from '../auditoria/gravacao/registrarEventoLegado.js';
import {
  type AlvoTrava,
  type ContextoOperacao,
  type Operacao,
  type ResultadoOperacao,
  tabelasDaReceita,
  type TxOperacao,
} from './operacao.js';
import {
  chaveEvento,
  gravarIdempotencia,
  gravarOutbox,
  gravarTrilha,
  lerIdempotencia,
  lerLiberacoes,
  liberacaoPermite,
} from './sgh/tecnicas.js';
import { conferirSqlLeitura, type Escritor, type Leitor, repassarEsperaCurta } from './transacao.js';
import { somenteSgh } from './sgh/somente-sgh.js';

/**
 * M59-F1: receitas que o executor roda dentro da transação de toda operação, com a conta do módulo dono da operação
 * (o evento na trilha do legado, quando a receita tem `eventoLegado`). O alcance de privilégios dá os passos, os
 * efeitos e os gatilhos delas a todo módulo (privilegios:gerar).
 */
export const RECEITAS_DO_NUCLEO: readonly string[] = [RECEITA_REGISTRAR_EVENTO_LEGADO.nome];

export const FORMATO_CHAVE_IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;
const NOME_USUARIO = /^\S.{0,30}$/;
const NOME_OBJETO = /^[A-Z][A-Z0-9_$]{0,30}$/;
/**
 * MAQUINA_USUARIO da trilha do legado quando a sessão não informa a estação (M06): "SGH-WEB:servidor", no
 * formato "MÁQUINA:conta" do Delphi; distingue o que veio do novo (decisão D-M06 nas evidências).
 */
export const ESTACAO_PADRAO = 'SGH-WEB:servidor';
/** Validade da reautenticação para operação crítica (M05). */
export const REAUTENTICACAO_MS_PADRAO = 5 * 60_000;

export type Desfecho =
  'sucesso' | 'repetida' | 'desfeita' | 'conflito-versao' | 'trava' | 'recusa' | 'nao-liberada' | 'erro';

export interface ContagemDesfechos {
  readonly operacao: string;
  readonly hospital: string;
  readonly desfechos: Readonly<Partial<Record<Desfecho, number>>>;
  /** Avisos de colisão (409 de versão e trava ocupada) por hora (AAAA-MM-DDTHH, UTC). */
  readonly colisoesPorHora: Readonly<Record<string, number>>;
  /**
   * Recusas por código do problema (ex.: `horario-ocupado`): os indicadores de disputa da onda 1 (M39) separam a
   * recusa por horário ocupado das demais. Só o código; nenhum dado de linha.
   */
  readonly recusasPorCodigo: Readonly<Record<string, number>>;
  readonly ultimaEm: string | null;
}

/** Contagens do executor em memória do processo (telas de conferência e de saúde; nenhum dado de linha). */
/** Contagem de disputa de uma operação num dia civil (M39: indicadores de disputa da onda 1). */
export interface DisputaDoDia {
  readonly operacao: string;
  readonly hospital: string;
  readonly conflitosVersao: number;
  readonly travas: number;
  readonly recusasPorCodigo: Readonly<Record<string, number>>;
}

/** Dia civil no fuso do estabelecimento (o banco do legado roda na hora local). */
export function diaCivil(quando: Date, fuso = 'America/Sao_Paulo'): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(quando);
  const v = (t: string) => p.find((x) => x.type === t)?.value ?? '00';
  return `${v('year')}-${v('month')}-${v('day')}`;
}

export class MetricasExecutor {
  /** M39: por operação, hospital e dia civil: conflitos de versão, travas e recusas por código (só dias recentes). */
  private readonly porDia = new Map<
    string,
    { conflitosVersao: number; travas: number; recusas: Record<string, number> }
  >();
  private readonly fuso: string;
  constructor(fuso = 'America/Sao_Paulo') {
    this.fuso = fuso;
  }
  private readonly mapa = new Map<
    string,
    {
      desfechos: Partial<Record<Desfecho, number>>;
      colisoes: Record<string, number>;
      recusas: Record<string, number>;
      ultima: string | null;
    }
  >();
  registrar(
    operacao: string,
    hospital: string,
    desfecho: Desfecho,
    quando = new Date(),
    codigo?: string,
  ): void {
    const k = `${operacao}\u0000${hospital}`;
    let m = this.mapa.get(k);
    if (!m) this.mapa.set(k, (m = { desfechos: {}, colisoes: {}, recusas: {}, ultima: null }));
    m.desfechos[desfecho] = (m.desfechos[desfecho] ?? 0) + 1;
    if (desfecho === 'recusa' && codigo) m.recusas[codigo] = (m.recusas[codigo] ?? 0) + 1;
    m.ultima = quando.toISOString();
    if (desfecho === 'conflito-versao' || desfecho === 'trava') {
      const hora = quando.toISOString().slice(0, 13);
      m.colisoes[hora] = (m.colisoes[hora] ?? 0) + 1;
    }
    if (desfecho === 'conflito-versao' || desfecho === 'trava' || (desfecho === 'recusa' && codigo)) {
      const dia = diaCivil(quando, this.fuso);
      const kd = `${k}\u0000${dia}`;
      let d = this.porDia.get(kd);
      if (!d) {
        this.porDia.set(kd, (d = { conflitosVersao: 0, travas: 0, recusas: {} }));
        // Só os últimos dias ficam na memória (o retrato de 15 min guarda o dia em SGH_CFG_COEX_USO_DIA).
        if (this.porDia.size > 5_000) this.porDia.delete(this.porDia.keys().next().value as string);
      }
      if (desfecho === 'conflito-versao') d.conflitosVersao++;
      else if (desfecho === 'trava') d.travas++;
      else if (codigo) d.recusas[codigo] = (d.recusas[codigo] ?? 0) + 1;
    }
  }
  /** M39: a disputa do dia civil (AAAA-MM-DD) por operação e hospital, contada por este processo. */
  doDia(dia: string): DisputaDoDia[] {
    const r: DisputaDoDia[] = [];
    for (const [k, d] of this.porDia) {
      const [operacao = '', hospital = '', dd = ''] = k.split('\u0000');
      if (dd !== dia) continue;
      r.push({
        operacao,
        hospital,
        conflitosVersao: d.conflitosVersao,
        travas: d.travas,
        recusasPorCodigo: { ...d.recusas },
      });
    }
    return r.sort((a, b) => `${a.operacao}${a.hospital}`.localeCompare(`${b.operacao}${b.hospital}`));
  }
  resumo(): ContagemDesfechos[] {
    return [...this.mapa.entries()]
      .map(([k, m]) => {
        const [operacao = '', hospital = ''] = k.split('\u0000');
        return {
          operacao,
          hospital,
          desfechos: { ...m.desfechos },
          colisoesPorHora: { ...m.colisoes },
          recusasPorCodigo: { ...m.recusas },
          ultimaEm: m.ultima,
        };
      })
      .sort((a, b) => `${a.operacao}${a.hospital}`.localeCompare(`${b.operacao}${b.hospital}`));
  }
}

export interface DependenciasExecutor {
  readonly ambiente: string;
  readonly catalogo: FonteCatalogo;
  /** Marca de schema do M02 (sem marca, tudo bloqueado). */
  readonly schema: { bloqueada(hospital: string, tabelas: readonly string[]): boolean };
  ler<T>(ctx: ContextoOperacao, fn: (l: Leitor) => Promise<T>): Promise<T>;
  escrever<T>(
    ctx: ContextoOperacao,
    fn: (e: Escritor) => Promise<T>,
    confirmar: boolean,
    /** M19: transação NO WAIT (receita de fila concorrente). */
    semEspera?: boolean,
  ): Promise<T>;
  /** Depois do COMMIT: os eventos gravados seguem (aviso ao relay). */
  aoConfirmar?(hospital: string, eventos: readonly string[]): void;
  readonly metricas?: MetricasExecutor;
  readonly agora?: () => number;
  readonly reautenticacaoMs?: number;
  /** Log sem dado pessoal (código e mensagem sanitizada). */
  readonly log?: (mensagem: string, campos: Record<string, unknown>) => void;
}

/** Resultado do passo 0 consultado pela tela (M11): pode gravar? Se não, o código e o motivo do executor. */
export interface LiberacaoConsultada {
  readonly pode: boolean;
  readonly codigo: string | null;
  readonly motivo: string | null;
}

export interface OpcoesExecucao {
  /** Reprodução da assinatura e testes: tudo é desfeito no fim (ROLLBACK). */
  readonly desfazer?: boolean;
  /** Escritor já aberto por quem chama (a captura retrata antes e depois na mesma transação). */
  readonly escritor?: Escritor;
}

export interface SaidaExecucao<S extends ResultadoOperacao> {
  readonly resultado: S;
  /** Mesma Idempotency-Key e mesma entrada: o resultado da primeira execução, sem gravar de novo. */
  readonly repetida: boolean;
  readonly eventos: readonly string[];
  readonly trilha: string | null;
}

/** JSON canônico (chaves em ordem) para o hash da entrada. */
export function jsonCanonico(v: unknown): string {
  if (v instanceof Date) return JSON.stringify(v.toISOString());
  if (Array.isArray(v)) return `[${v.map(jsonCanonico).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${jsonCanonico((v as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v ?? null);
}

export function hashEntrada(operacao: string, entrada: unknown): string {
  return createHash('sha256')
    .update(`${operacao}\u0000${jsonCanonico(entrada)}`, 'utf8')
    .digest('hex');
}

const ALVO_ESCRITA =
  /^\s*(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|UPDATE\s+OR\s+INSERT\s+INTO)\s+"?([A-Za-z0-9_$]+)"?/i;

/** Chave composta do evento (gravarOutbox a reduz a 64 hex com chaveEvento). */
function compostaDoEvento(hospital: string, operacao: string, idempotencyKey: string, i: number): string {
  return `${hospital}\u0000${operacao}\u0000${idempotencyKey}\u0000${i}`;
}

/** Chave do evento da outbox como gravada (64 hex, única): estabelecimento, operação, Idempotency-Key e posição. */
export function chaveDoEvento(hospital: string, operacao: string, idempotencyKey: string, i: number): string {
  return chaveEvento(compostaDoEvento(hospital, operacao, idempotencyKey, i));
}

/** Estados que gravam fora de `dev` e `ci` (homologação, treino): só a operação provada. */
const GRAVA_FORA_DE_DEV: readonly EstadoOperacao[] = ['verde', 'conferida', 'liberada'];
const AMBIENTES_DE_DESENVOLVIMENTO = new Set(['dev', 'ci']);

/** Ponto de salvamento da operação no escritor de quem chama (reprodução da assinatura e testes). */
const PONTO_OPERACAO = 'SGH_OP';

/**
 * Transação da operação: só grava nas tabelas da receita; procedimento e bloco PSQL recusados. A leitura
 * (`consultar`, `uma`) passa pela guarda do caminho de leitura: generator com passo, procedimento executável
 * e bloco PSQL recusados (o procedimento selecionável sem efeito, como SPFONETICA_2, é aceito); e nenhum
 * comando de escrita por ela (`UPDATE … RETURNING` pela leitura furava a lista de tabelas da receita).
 */
export function txDaOperacao(
  e: Escritor,
  permitidas: ReadonlySet<string>,
  generatorsReservados: ReadonlySet<string> = new Set(),
): TxOperacao {
  const conferir = (sql: string) => {
    if (/^\s*EXECUTE\s+(?:PROCEDURE|BLOCK)\b/i.test(sql)) {
      throw new Error('Operação não executa procedimento nem bloco PSQL (convencoes.md §1, regra 2).');
    }
    const m = ALVO_ESCRITA.exec(sql);
    const alvo = m?.[1]?.toUpperCase();
    if (!alvo || !permitidas.has(alvo)) {
      throw new Error(
        `Gravação fora da receita${alvo ? ` (${alvo})` : ''}: só as tabelas dos passos da receita.`,
      );
    }
  };
  const ler = (sql: string) => {
    conferirSqlLeitura(sql);
    if (
      ALVO_ESCRITA.test(sql) ||
      /^\s*(?:EXECUTE|SAVEPOINT|ROLLBACK|COMMIT|SET|CREATE|ALTER|DROP|RECREATE|GRANT|REVOKE)\b/i.test(sql)
    ) {
      throw new Error(
        'Comando de escrita pela leitura da operação: só por executar, nas tabelas da receita.',
      );
    }
  };
  return {
    hospital: e.hospital,
    async consultar(sql, p, o) {
      ler(sql);
      return e.consultar(sql, p, o);
    },
    lerBlob: (b) => e.lerBlob(b),
    async uma(sql, p = []) {
      ler(sql);
      const [l] = await e.consultar(sql, p, { teto: 1 });
      return l ?? null;
    },
    async executar(sql, p = []) {
      conferir(sql);
      return e.executar(sql, p);
    },
    async executarRetornando(sql, p = []) {
      conferir(sql);
      return e.executarRetornando(sql, p);
    },
    async reservarGenerator(nome) {
      // M20: só o generator declarado na receita (generatorsReservados), pedido antes da gravação como o Delphi pede.
      // M26: também a sequência SGH_ do novo declarada na receita (a numeração própria do laudo, 0266).
      if (!/^(SGH_)?GEN_[A-Z0-9_$]{1,27}$/.test(nome) || nome.length > 31 || !generatorsReservados.has(nome))
        throw new Error(`Generator ${nome} fora dos reservados da receita.`);
      const [l] = await e.consultar(`SELECT GEN_ID(${nome}, 1) V FROM RDB$DATABASE`, [], { teto: 1 });
      const v = Number(l?.['V'] ?? NaN);
      if (!Number.isSafeInteger(v) || v <= 0) throw new Error(`Generator ${nome} ilegível.`);
      return v;
    },
  };
}

/** M12: escritor do registro próprio da operação: só as tabelas SGH_ declaradas na receita. */
export function somenteSghDeclaradas(e: Escritor, tabelas: readonly string[]): Escritor {
  const aceitas = new Set(tabelas.map((t) => t.toUpperCase()));
  const conferir = (sql: string) => {
    const alvo = ALVO_ESCRITA.exec(sql)?.[1]?.toUpperCase();
    if (!alvo || !alvo.startsWith('SGH_') || !aceitas.has(alvo))
      throw new Error('Registro próprio da operação: só as tabelas SGH_ declaradas na receita.');
  };
  return {
    hospital: e.hospital,
    consultar: (sql, p, o) => e.consultar(sql, p, o),
    lerBlob: (b) => e.lerBlob(b),
    async executar(sql, p = []) {
      conferir(sql);
      return e.executar(sql, p);
    },
    async executarRetornando(sql, p = []) {
      conferir(sql);
      return e.executarRetornando(sql, p);
    },
    ...repassarEsperaCurta(e, conferir),
  };
}

/** Passo 2: SELECT … WITH LOCK da linha principal (tabela física única). */
export async function travarEReler(e: Escritor, alvo: AlvoTrava): Promise<Linha | null> {
  const nomes = [alvo.tabela, ...alvo.colunas, ...Object.keys(alvo.chave)];
  for (const n of nomes) if (!NOME_OBJETO.test(n)) throw new Error('Nome de objeto inválido na trava.');
  const chave = Object.entries(alvo.chave);
  if (chave.length === 0) throw new Error('Trava sem chave.');
  const [linha] = await e.consultar(
    `SELECT ${alvo.colunas.join(', ')} FROM ${alvo.tabela} WHERE ${chave.map(([c]) => `${c} = ?`).join(' AND ')} WITH LOCK`,
    chave.map(([, v]) => v),
    { teto: 1 },
  );
  return linha ?? null;
}

const comparavel = (v: unknown): string =>
  v instanceof Date ? v.toISOString() : v === null || v === undefined ? '\u0000' : String(v).trimEnd();

/** Passo 3 (controle otimista): colunas relidas diferentes das que a tela leu. */
export function colunasMudadas(relido: Linha, esperado: Readonly<Record<string, unknown>>): string[] {
  return Object.keys(esperado)
    .filter((c) => comparavel(relido[c]) !== comparavel(esperado[c]))
    .sort();
}

export class Executor {
  private readonly deps: DependenciasExecutor;
  constructor(deps: DependenciasExecutor) {
    this.deps = deps;
  }

  private conferirContextoEscrita(hospital: string, ctx: ContextoOperacao): ContextoOperacao {
    try {
      conferirContexto(ctx);
    } catch {
      throw erroContextoEscrita('rede, estabelecimento ou rastreio');
    }
    if (ctx.hospital !== hospital) throw erroContextoEscrita('o estabelecimento da sessão');
    if (typeof ctx.usuarioLegado !== 'string' || !NOME_USUARIO.test(ctx.usuarioLegado)) {
      throw erroContextoEscrita('o usuário do sistema legado (TBUSERS.NOME)');
    }
    if (typeof ctx.idempotencyKey !== 'string' || !FORMATO_CHAVE_IDEMPOTENCIA.test(ctx.idempotencyKey)) {
      throw erroContextoEscrita('a Idempotency-Key');
    }
    return ctx;
  }

  /**
   * M11: o passo 0 sem gravar nada (catálogo, ambiente, chave de liberação por pessoa, setor e grupo, marca de
   * schema), para a tela esconder ou desabilitar a ação com o motivo ANTES de a pessoa preencher o formulário.
   * A reautenticação da operação crítica fica para a hora de gravar (é por pedido). Mesma regra do executar.
   */
  async liberacao<E, S extends ResultadoOperacao>(
    op: Operacao<E, S>,
    quem: {
      readonly rede: string;
      readonly hospital: string;
      readonly usuarioLegado: string;
      readonly setor?: string;
      readonly grupo?: string;
    },
  ): Promise<LiberacaoConsultada> {
    const ctx = {
      rede: quem.rede,
      hospital: quem.hospital,
      traceId: 'liberacao',
      usuarioLegado: quem.usuarioLegado,
      idempotencyKey: 'liberacao-consulta',
      ...(quem.setor !== undefined ? { setor: quem.setor } : {}),
      ...(quem.grupo !== undefined ? { grupo: quem.grupo } : {}),
    } as ContextoOperacao;
    try {
      await this.conferirLiberacao(op, ctx, (fn) => this.deps.ler(ctx, fn), false);
      return { pode: true, codigo: null, motivo: null };
    } catch (e) {
      if (e instanceof ErroOperacao)
        return {
          pode: false,
          codigo: e.problema.codigo ?? null,
          motivo: e.problema.detail ?? e.problema.title,
        };
      throw e;
    }
  }

  /** Passo 0: catálogo, liberação, schema e reautenticação (antes de abrir a transação de escrita). */
  private async conferirLiberacao<E, S extends ResultadoOperacao>(
    op: Operacao<E, S>,
    ctx: ContextoOperacao,
    leitor: <T>(fn: (l: Leitor) => Promise<T>) => Promise<T>,
    conferirReautenticacao = true,
  ): Promise<void> {
    const estado: EstadoOperacao | null = this.deps.catalogo.estado(op.receita.nome, ctx.hospital);
    if (estado === null || estado === 'bloqueada')
      throw erroOperacaoBloqueada(this.deps.catalogo.motivo?.(op.receita.nome, ctx.hospital));
    // Fora de dev e ci (homologação e treino, com o SPDATA ao lado): só a operação provada (verde ou além).
    if (!AMBIENTES_DE_DESENVOLVIMENTO.has(this.deps.ambiente) && !GRAVA_FORA_DE_DEV.includes(estado))
      throw erroNaoLiberada(op.receita.pendente);
    if (this.deps.ambiente === 'producao') {
      if (estado !== 'liberada') throw erroNaoLiberada(op.receita.pendente);
      const chaves = await leitor((l) => lerLiberacoes(l, ctx.hospital, op.receita.nome));
      if (!liberacaoPermite(chaves, ctx.usuarioLegado, ctx.setor, ctx.grupo)) throw erroNaoLiberada();
    }
    if (this.deps.schema.bloqueada(ctx.hospital, tabelasDaReceita(op.receita))) throw erroSchemaDivergente();
    if (op.receita.critica && conferirReautenticacao) {
      const agora = this.deps.agora?.() ?? Date.now();
      const limite = this.deps.reautenticacaoMs ?? REAUTENTICACAO_MS_PADRAO;
      if (ctx.reautenticadoEm === undefined || agora - ctx.reautenticadoEm > limite)
        throw erroReautenticacao();
    }
  }

  async executar<E, S extends ResultadoOperacao>(
    op: Operacao<E, S>,
    hospital: string,
    entradaBruta: unknown,
    contexto: ContextoOperacao,
    opcoes: OpcoesExecucao = {},
  ): Promise<SaidaExecucao<S>> {
    const nome = op.receita.nome;
    // Reprodução (desfazer) e escritor de quem chama não são desfechos reais: não entram nas contagens.
    const registrar = (d: Desfecho, codigo?: string) => {
      if (!opcoes.desfazer && !opcoes.escritor)
        this.deps.metricas?.registrar(nome, hospital, d, new Date(), codigo);
    };
    try {
      // M59-F1: a transação usa a conta do módulo dono da receita (o grupo), se a TI já a configurou.
      const ctx: ContextoOperacao = {
        ...this.conferirContextoEscrita(hospital, contexto),
        modulo: op.receita.grupo,
      };
      const analise = op.entrada.safeParse(entradaBruta);
      if (!analise.success) {
        throw erroEntradaInvalida([
          ...new Set(analise.error.issues.map((i) => i.path.join('.') || '(entrada)')),
        ]);
      }
      const entrada = analise.data;
      const leitor = <T>(fn: (l: Leitor) => Promise<T>): Promise<T> =>
        opcoes.escritor ? fn(opcoes.escritor) : this.deps.ler(ctx, fn);
      await this.conferirLiberacao(op, ctx, leitor);
      const hash = hashEntrada(nome, entrada);
      const anterior = await leitor((l) => lerIdempotencia(l, ctx.idempotencyKey, nome, hospital));
      if (anterior) {
        if (anterior.hashEntrada !== hash) throw erroIdempotenciaDivergente();
        // A mesma chave usada por outra pessoa não devolve o resultado (IDs) da execução de quem gravou.
        if (anterior.usuario !== null && anterior.usuario !== ctx.usuarioLegado)
          throw erroIdempotenciaDivergente();
        registrar('repetida');
        return { resultado: anterior.resultado as S, repetida: true, eventos: [], trilha: null };
      }
      const permitidas = new Set(op.receita.passos.map((p) => p.tabela));
      const corpo = async (e: Escritor) => {
        const tx = txDaOperacao(e, permitidas, new Set(op.receita.generatorsReservados ?? []));
        // 2 e 3: trava, relê e confere a condição no estado relido.
        const alvo = op.travar?.(entrada, ctx) ?? null;
        let relido: Linha | null = null;
        if (alvo) {
          relido = await travarEReler(e, alvo);
          if (!relido) {
            throw new ErroOperacao(
              404,
              'registro-inexistente',
              'Registro não encontrado',
              'O registro não existe mais.',
            );
          }
          if (alvo.esperado) {
            const mudou = colunasMudadas(relido, alvo.esperado);
            if (mudou.length > 0) throw erroConflitoVersao(mudou);
          }
        }
        await op.conferir?.(tx, entrada, ctx, relido);
        // 4. grava pela receita.
        const resultado = await op.gravar(tx, entrada, ctx);
        // 5. prova pós-escrita.
        await op.provar(tx, entrada, resultado, ctx);
        // 5a (M11). Derivados SGH_ da operação (índice de busca), na mesma transação, só em tabela SGH_.
        if (op.sgh) await op.sgh(somenteSgh(e), entrada, resultado, ctx);
        // 5b. M12: registro próprio do novo em SGH_ (autoria), na mesma transação; só tabela SGH_.
        if (op.registrarSgh) {
          if (!op.receita.registrosSgh?.length)
            throw new Error(`Receita ${nome}: registrarSgh sem as tabelas declaradas em registrosSgh.`);
          await op.registrarSgh(somenteSghDeclaradas(e, op.receita.registrosSgh), entrada, resultado, ctx);
        }
        // 6. Trilha do legado (M06, quando a receita declara o evento do Delphi), SGH_TRILHA, SGH_OUTBOX e
        // SGH_IDEMPOTENCIA na mesma transação: desfeita a operação, as duas trilhas somem juntas.
        const alvoTrilha = op.alvo(entrada, resultado);
        const extras = op.trilha?.(entrada, resultado, ctx) ?? {};
        let idTrilhaLegado = extras.idTrilhaLegado ?? null;
        // M23: a receita e o atestado da mesma operação vão a opções diferentes da trilha do legado.
        const dinamico = op.eventoLegadoDaEntrada?.(entrada) ?? null;
        const ev = dinamico?.evento ?? op.receita.eventoLegado;
        // M22: o atendimento do evento (o Delphi grava ID_ATCABECATEND nos eventos do prontuário).
        const atendimentoLegado = op.atendimentoLegado?.(entrada, resultado) ?? null;
        const comAtendimento =
          atendimentoLegado !== null && Number.isSafeInteger(atendimentoLegado) && atendimentoLegado > 0
            ? { atendimento: atendimentoLegado }
            : {};
        for (const antes of dinamico?.antes ?? op.receita.eventosLegadoAntes ?? []) {
          await gravarEventoLegado(
            e,
            {
              tipo: antes.tipo,
              criticidade: antes.criticidade,
              opcao: antes.opcao,
              estacao: ctx.estacao ?? ESTACAO_PADRAO,
              ...comAtendimento,
            },
            ctx,
          );
        }
        if (ev) {
          const id = Number(alvoTrilha.id);
          const legado = await gravarEventoLegado(
            e,
            {
              tipo: ev.tipo,
              criticidade: ev.criticidade,
              opcao: ev.opcao,
              estacao: ctx.estacao ?? ESTACAO_PADRAO,
              ...comAtendimento,
              ...(ev.alvo && Number.isSafeInteger(id) && id > 0
                ? { alvos: [{ tabelaCampo: ev.alvo, id }] }
                : {}),
            },
            ctx,
          );
          idTrilhaLegado = legado.idTrilha;
        }
        const trilha = await gravarTrilha(e, {
          rede: ctx.rede,
          hospital,
          usuario: ctx.usuarioLegado,
          recurso: op.receita.recurso,
          operacao: nome,
          tabelaAlvo: alvoTrilha.tabela,
          idAlvo: alvoTrilha.id === null ? null : String(alvoTrilha.id),
          chaveNaturalAlvo: alvoTrilha.chaveNatural ?? null,
          resultado: 'sucesso',
          estacao: ctx.estacao ?? null,
          correlacao: ctx.traceId.slice(0, 64),
          ...extras,
          evento: extras.evento ?? op.receita.evento,
          idTrilhaLegado,
        });
        const eventos: string[] = [];
        for (const [i, ev] of op.eventos(entrada, resultado, ctx).entries()) {
          eventos.push(
            await gravarOutbox(e, {
              rede: ctx.rede,
              hospital,
              tipo: ev.tipo,
              chave: compostaDoEvento(hospital, nome, ctx.idempotencyKey, i),
              carga: { ...ev.carga, hospital },
            }),
          );
        }
        try {
          await gravarIdempotencia(e, {
            chave: ctx.idempotencyKey,
            operacao: nome,
            hospital,
            hashEntrada: hash,
            resultado: JSON.stringify(resultado),
            usuario: ctx.usuarioLegado,
          });
        } catch (erro) {
          if (restricaoUnicaViolada(erro) === 'SGH_PK_IDEMPOTENCIA') throw erroRequisicaoEmAndamento();
          throw erro;
        }
        return { resultado, eventos, trilha: trilha.id };
      };
      const r = opcoes.escritor
        ? await this.noPontoDeSalvamento(opcoes.escritor, corpo)
        : await this.deps.escrever(ctx, corpo, !opcoes.desfazer, op.receita.semEspera === true);
      registrar('sucesso');
      // 7. confirmado: só agora os eventos seguem.
      if (!opcoes.escritor && !opcoes.desfazer && r.eventos.length > 0)
        this.deps.aoConfirmar?.(hospital, r.eventos);
      return { resultado: r.resultado, repetida: false, eventos: r.eventos, trilha: r.trilha };
    } catch (erro) {
      const traduzido = this.traduzir(erro);
      const codigo = traduzido.problema.codigo;
      registrar(
        codigo === 'acao_sem_efeito'
          ? 'desfeita'
          : codigo === 'conflito-versao'
            ? 'conflito-versao'
            : codigo === 'registro-em-edicao'
              ? 'trava'
              : codigo === 'operacao-nao-liberada'
                ? 'nao-liberada'
                : traduzido.problema.status >= 500
                  ? 'erro'
                  : 'recusa',
        codigo,
      );
      this.deps.log?.('executor: operação não gravada', {
        operacao: nome,
        estabelecimento: hospital,
        codigo,
        status: traduzido.problema.status,
        ...(erro instanceof ErroOperacao ? {} : { causa: problemaDoLegado(erro).log }),
      });
      throw traduzido;
    }
  }

  /**
   * No escritor de quem chama não há transação própria para desfazer: a operação roda sob um SAVEPOINT e,
   * se falhar (prova, conflito, recusa), volta a ele; nada parcial fica na transação de quem chamou.
   */
  private async noPontoDeSalvamento<T>(e: Escritor, corpo: (e: Escritor) => Promise<T>): Promise<T> {
    await e.executar(`SAVEPOINT ${PONTO_OPERACAO}`);
    try {
      const r = await corpo(e);
      await e.executar(`RELEASE SAVEPOINT ${PONTO_OPERACAO}`);
      return r;
    } catch (erro) {
      await e.executar(`ROLLBACK TO SAVEPOINT ${PONTO_OPERACAO}`);
      throw erro;
    }
  }

  private traduzir(erro: unknown): ErroOperacao {
    if (erro instanceof ErroOperacao) return erro;
    if (erro instanceof ErroProva) return erroAcaoSemEfeito();
    // Sessão "como" (ADR 0021): sem a imagem antes/depois, a escrita não acontece (fail-closed).
    if (erro instanceof ErroImagemComo)
      return new ErroOperacao(503, 'suporte-imagem-indisponivel', 'Escrita não registrada', erro.message);
    if (ehTravaOcupada(erro)) return erroRegistroEmEdicao();
    // Recusa decidida no registro SGH_ da mesma transação (estado relido; ex.: parecer já encerrado): 4xx com o código.
    const rec = recusaSgh(erro);
    if (rec) return new ErroOperacao(rec.status, rec.codigo, 'Operação recusada', rec.mensagem);
    // Colisão numa chave única do novo (duas gravações concorrentes da mesma versão ou da mesma origem): 409, nada gravado.
    const unica = restricaoUnicaViolada(erro);
    if (unica?.startsWith('SGH_UQ_'))
      return new ErroOperacao(
        409,
        'conflito-versao',
        'Gravado por outra pessoa',
        'Outra gravação do mesmo documento foi feita ao mesmo tempo. Releia e confira de novo.',
      );
    const p = problemaDoLegado(erro).problema;
    return new ErroOperacao(p.status, p.codigo ?? 'erro-interno', p.title, p.detail);
  }
}

/** Recusa com código e situação HTTP 4xx lançada por um registro SGH_ (ex.: ErroPepSgh), sem depender do módulo. */
function recusaSgh(erro: unknown): { status: number; codigo: string; mensagem: string } | null {
  if (!(erro instanceof Error)) return null;
  const x = erro as Error & { codigo?: unknown; status?: unknown };
  if (typeof x.codigo !== 'string' || typeof x.status !== 'number') return null;
  if (x.status < 400 || x.status >= 500) return null;
  return { status: x.status, codigo: x.codigo, mensagem: x.message };
}
