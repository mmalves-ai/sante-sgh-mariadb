// Executor de operações de gravação: o protocolo do núcleo antigo, sobre o banco próprio.
//   0. contexto (cliente, estabelecimento, usuário, correlação, chave de idempotência), entrada validada,
//      liberação (porta opcional) e reautenticação da operação crítica;
//   1. idempotência: a mesma chave com a mesma entrada devolve o resultado anterior sem gravar;
//   2. trava e relê a linha principal (SELECT ... FOR UPDATE) e confere a versão (trava otimista);
//   3. condição de negócio no estado relido;
//   4. grava (só nas tabelas declaradas, com auditoria automática e número de negócio);
//   5. trilha (trilha_auditoria), outbox (integracao_mensagem) e idempotência, NA MESMA TRANSAÇÃO;
//   6. confirmado: os eventos seguem (aviso ao relay).
// Sai do antigo: gravar como o sistema de origem, prova pós-escrita por gatilho, codec de caracteres.
import type { ZodType } from 'zod';
import { origemComoAtual } from './como.js';
import { type ContextoNucleo, ErroContexto, conferirContexto } from './contexto.js';
import {
  ErroOperacao,
  erroConflitoVersao,
  erroContextoEscrita,
  erroEntradaInvalida,
  erroIdempotenciaDivergente,
  erroReautenticacao,
  erroRegistroInexistente,
  problemaDoBanco,
  traduzirErro,
} from './erros.js';
import {
  type Carimbo,
  type Valores,
  alterarAuditado,
  colunasMudadas,
  conferirNome,
  excluirAuditado,
  incluirAuditado,
  travarRegistro,
} from './gravacao.js';
import {
  FORMATO_CHAVE_IDEMPOTENCIA,
  type ResultadoOperacao,
  gravarIdempotencia,
  hashEntrada,
  lerIdempotencia,
} from './idempotencia.js';
import { type NumeroNegocio, proximoNumero } from './sequencia.js';
import type { Escritor, Leitor, Linha } from './transacao.js';
import { type AcaoTrilha, type CargaEvento, chaveDoEvento, gravarOutbox, gravarTrilha } from './trilha.js';

export type { ResultadoOperacao } from './idempotencia.js';

export const REAUTENTICACAO_MS_PADRAO = 5 * 60_000;
export const FORMATO_NOME_OPERACAO = /^[a-z][a-z0-9_.-]{2,119}$/;

export interface ContextoOperacao extends ContextoNucleo {
  readonly chaveIdempotencia: string;
  /** Instante (ms) da última reautenticação (operação crítica). */
  readonly reautenticadoEm?: number;
}

/** Linha principal a travar e reler (passo 2), quando a operação altera registro existente. */
export interface AlvoTrava {
  readonly tabela: string;
  readonly id: number;
  /** Colunas relidas além de id e versao. */
  readonly colunas?: readonly string[];
  /** Versão que a tela leu: diferente da relida, 409 conflito-versao. */
  readonly versaoEsperada?: number;
  /** Valores que a tela leu, conferidos coluna a coluna. */
  readonly esperado?: Readonly<Record<string, unknown>>;
}

export interface AlvoTrilha {
  readonly tabela: string;
  readonly id: number | null;
}

export interface EventoOperacao {
  readonly tipo: string;
  /** Só ids e códigos (nunca nome, documento ou texto clínico). */
  readonly carga: CargaEvento;
}

export interface ExtrasTrilha {
  readonly acao?: AcaoTrilha;
  readonly motivo?: string | null;
  /** Dados extras da trilha (o executor já guarda operação, resultado e as escritas). */
  readonly dados?: unknown;
}

/** Uma escrita feita pela transação da operação (vai à trilha: tabela, id e nomes de coluna). */
export interface EscritaRegistrada {
  readonly acao: 'inclusao' | 'alteracao' | 'exclusao';
  readonly tabela: string;
  readonly id: number;
  readonly colunas: readonly string[];
}

/** Transação da operação: o Escritor restrito às tabelas declaradas, com auditoria e numeração. */
export interface TxOperacao extends Escritor {
  readonly contexto: ContextoOperacao;
  incluir(tabela: string, valores: Valores): Promise<number>;
  /** Devolve a nova versão; versão diferente: 409 conflito-versao. */
  alterar(tabela: string, id: number, versaoEsperada: number, valores: Valores): Promise<number>;
  excluir(tabela: string, id: number, versaoEsperada: number): Promise<void>;
  /** Número de negócio do estabelecimento do contexto (porCliente: a sequência do cliente inteiro). */
  proximoNumero(tipo: string, opcoes?: { readonly porCliente?: boolean }): Promise<NumeroNegocio>;
}

export interface Operacao<E, S extends ResultadoOperacao> {
  readonly nome: string;
  /** Tabelas que a operação grava (a transação recusa as outras). */
  readonly tabelas: readonly string[];
  readonly entrada: ZodType<E>;
  /** Ação da trilha (padrão: a das escritas, ou "operacao"). */
  readonly acao?: AcaoTrilha;
  /** Exige reautenticação recente. */
  readonly critica?: boolean;
  travar?(entrada: E, ctx: ContextoOperacao): AlvoTrava | null;
  conferir?(tx: TxOperacao, entrada: E, ctx: ContextoOperacao, relido: Linha | null): Promise<void>;
  gravar(tx: TxOperacao, entrada: E, ctx: ContextoOperacao): Promise<S>;
  eventos?(entrada: E, resultado: S, ctx: ContextoOperacao): readonly EventoOperacao[];
  alvo(entrada: E, resultado: S): AlvoTrilha;
  trilha?(entrada: E, resultado: S, ctx: ContextoOperacao): ExtrasTrilha;
}

export function definirOperacao<E, S extends ResultadoOperacao>(op: Operacao<E, S>): Operacao<E, S> {
  if (!FORMATO_NOME_OPERACAO.test(op.nome)) throw new Error(`Nome de operação inválido: ${op.nome}.`);
  if (op.tabelas.length === 0) throw new Error(`Operação ${op.nome} sem tabelas declaradas.`);
  for (const t of op.tabelas) conferirNome(t);
  return op;
}

export type Desfecho =
  'sucesso' | 'repetida' | 'recusa' | 'conflito-versao' | 'trava' | 'nao-liberada' | 'erro';

/** Contagem de desfechos por operação (em memória; a API exporta para as métricas). */
export class MetricasExecutor {
  private readonly contagens = new Map<string, Map<Desfecho, number>>();
  registrar(operacao: string, desfecho: Desfecho): void {
    const m = this.contagens.get(operacao) ?? new Map<Desfecho, number>();
    m.set(desfecho, (m.get(desfecho) ?? 0) + 1);
    this.contagens.set(operacao, m);
  }
  contagem(operacao: string, desfecho: Desfecho): number {
    return this.contagens.get(operacao)?.get(desfecho) ?? 0;
  }
  resumo(): Record<string, Partial<Record<Desfecho, number>>> {
    return Object.fromEntries([...this.contagens].map(([op, m]) => [op, Object.fromEntries(m)]));
  }
}

export interface DependenciasExecutor {
  ler<T>(ctx: ContextoNucleo, fn: (l: Leitor) => Promise<T>): Promise<T>;
  escrever<T>(ctx: ContextoNucleo, fn: (e: Escritor) => Promise<T>, confirmar: boolean): Promise<T>;
  /** Porta de liberação (perfil, chave, configuração do cliente): lança ErroOperacao para recusar. */
  liberacao?(
    operacao: { readonly nome: string; readonly critica: boolean },
    ctx: ContextoOperacao,
    l: Leitor,
  ): Promise<void>;
  /** Depois do COMMIT: ids das mensagens de saída gravadas (aviso ao relay). */
  aoConfirmar?(cliente: string, mensagens: readonly number[]): void;
  readonly metricas?: MetricasExecutor;
  readonly agora?: () => number;
  readonly reautenticacaoMs?: number;
  /** Log sem dado pessoal (códigos, ids e classe do erro). */
  readonly log?: (mensagem: string, campos: Record<string, unknown>) => void;
}

export interface OpcoesExecucao {
  /** Testes e simulação: tudo é desfeito no fim (ROLLBACK). */
  readonly desfazer?: boolean;
  /** Escritor já aberto por quem chama: a operação roda sob um SAVEPOINT nele. */
  readonly escritor?: Escritor;
}

export interface SaidaExecucao<S extends ResultadoOperacao> {
  readonly resultado: S;
  /** Mesma chave e mesma entrada: o resultado da primeira execução, sem gravar de novo. */
  readonly repetida: boolean;
  /** Ids das mensagens de saída (integracao_mensagem). */
  readonly eventos: readonly number[];
  /** Id da linha da trilha (na repetição, a da primeira execução). */
  readonly trilha: number | null;
}

// A tabela-alvo de um comando de escrita. Só a forma de uma tabela, sem esquema: UPDATE ou DELETE com JOIN,
// vírgula ou USING, e nome qualificado (`outro.t`), não casam e são recusados (gravaria fora das declaradas).
const ALVO_INSERIR =
  /^\s*(?:INSERT|REPLACE)\s+(?:(?:LOW_PRIORITY|DELAYED|HIGH_PRIORITY|IGNORE)\s+)*(?:INTO\s+)?(?!INTO\b)(`?)([A-Za-z0-9_]+)\1(?=\s|\(|$)/i;
const ALVO_ATUALIZAR =
  /^\s*UPDATE\s+(?:(?:LOW_PRIORITY|IGNORE)\s+)*(`?)([A-Za-z0-9_]+)\1(?:\s+(?:AS\s+)?`?[A-Za-z0-9_]+`?)?\s+SET\b/i;
const ALVO_APAGAR =
  /^\s*DELETE\s+(?:(?:LOW_PRIORITY|QUICK|IGNORE)\s+)*FROM\s+(`?)([A-Za-z0-9_]+)\1(?:\s+(?:AS\s+)?`?[A-Za-z0-9_]+`?)?\s*(?:;?\s*$|\b(?:WHERE|ORDER|LIMIT|RETURNING)\b)/i;

/** A única tabela que o comando grava, ou null quando não é a forma simples (várias tabelas, esquema, outro comando). */
export function alvoDaEscrita(sql: string): string | null {
  for (const re of [ALVO_INSERIR, ALVO_ATUALIZAR, ALVO_APAGAR]) {
    const m = re.exec(sql);
    if (m) return m[2]!.toLowerCase();
  }
  return null;
}
const PONTO_OPERACAO = 'sgh_operacao';

/** Transação da operação: só grava nas tabelas declaradas; auditoria, trava otimista e numeração. */
export function txDaOperacao(
  e: Escritor,
  permitidas: ReadonlySet<string>,
  ctx: ContextoOperacao,
  agora: () => Date,
  escritas: EscritaRegistrada[] = [],
): TxOperacao {
  const conferir = (sql: string) => {
    const alvo = alvoDaEscrita(sql);
    if (!alvo || !permitidas.has(alvo))
      throw new Error(`Gravação fora das tabelas da operação${alvo ? ` (${alvo})` : ''}.`);
  };
  const carimbo = (): Carimbo => ({ usuario: ctx.usuario, agora: agora() });
  const tabela = (t: string) => {
    if (!permitidas.has(t)) throw new Error(`Gravação fora das tabelas da operação (${t}).`);
    return t;
  };
  return {
    cliente: e.cliente,
    contexto: ctx,
    consultar: (sql, p, o) => e.consultar(sql, p, o),
    uma: (sql, p) => e.uma(sql, p),
    consultarParaAtualizar: (sql, p, o) => e.consultarParaAtualizar(sql, p, o),
    async executar(sql, p = []) {
      conferir(sql);
      return e.executar(sql, p);
    },
    async inserir(sql, p = []) {
      conferir(sql);
      return e.inserir(sql, p);
    },
    async executarRetornando(sql, p = []) {
      conferir(sql);
      return e.executarRetornando(sql, p);
    },
    async incluir(t, valores) {
      const id = await incluirAuditado(e, tabela(t), valores, carimbo());
      escritas.push({ acao: 'inclusao', tabela: t, id, colunas: Object.keys(valores).sort() });
      return id;
    },
    async alterar(t, id, versaoEsperada, valores) {
      const v = await alterarAuditado(e, tabela(t), id, versaoEsperada, valores, carimbo());
      escritas.push({ acao: 'alteracao', tabela: t, id, colunas: Object.keys(valores).sort() });
      return v;
    },
    async excluir(t, id, versaoEsperada) {
      await excluirAuditado(e, tabela(t), id, versaoEsperada);
      escritas.push({ acao: 'exclusao', tabela: t, id, colunas: [] });
    },
    proximoNumero(tipo, opcoes = {}) {
      return proximoNumero(e, tipo, opcoes.porCliente ? null : ctx.estabelecimento, carimbo());
    },
  };
}

/** Passo 2: trava e relê a linha principal; confere versão e colunas esperadas. */
export async function travarEConferir(e: Escritor, alvo: AlvoTrava): Promise<Linha> {
  const relido = await travarRegistro(e, alvo.tabela, alvo.id, [
    ...(alvo.colunas ?? []),
    ...Object.keys(alvo.esperado ?? {}),
  ]);
  if (!relido) throw erroRegistroInexistente();
  if (alvo.versaoEsperada !== undefined && Number(relido['versao']) !== alvo.versaoEsperada)
    throw erroConflitoVersao(['versao']);
  if (alvo.esperado) {
    const mudou = colunasMudadas(relido, alvo.esperado);
    if (mudou.length > 0) throw erroConflitoVersao(mudou);
  }
  return relido;
}

function acaoDaTrilha(escritas: readonly EscritaRegistrada[], alvo: AlvoTrilha): AcaoTrilha {
  const doAlvo = escritas.filter((x) => x.tabela === alvo.tabela && (alvo.id === null || x.id === alvo.id));
  const acoes = new Set((doAlvo.length ? doAlvo : escritas).map((x) => x.acao));
  const [unica] = acoes;
  return acoes.size === 1 && unica ? unica : 'operacao';
}

function desfechoDe(e: ErroOperacao): Desfecho {
  const c = e.problema.codigo;
  if (c === 'conflito-versao') return 'conflito-versao';
  if (c === 'registro-em-edicao') return 'trava';
  if (c === 'operacao-nao-liberada') return 'nao-liberada';
  return e.problema.status >= 500 ? 'erro' : 'recusa';
}

export class Executor {
  private readonly deps: DependenciasExecutor;

  constructor(deps: DependenciasExecutor) {
    this.deps = deps;
  }

  private agora(): number {
    return this.deps.agora?.() ?? Date.now();
  }

  private conferirContextoEscrita(cliente: string, contexto: ContextoOperacao): ContextoOperacao {
    let base: ContextoNucleo;
    try {
      base = conferirContexto(contexto);
    } catch (e) {
      if (e instanceof ErroContexto)
        throw erroContextoEscrita('cliente, estabelecimento, usuário ou correlação');
      throw e;
    }
    if (base.cliente !== cliente) throw erroContextoEscrita('o cliente da sessão');
    if (
      typeof contexto.chaveIdempotencia !== 'string' ||
      !FORMATO_CHAVE_IDEMPOTENCIA.test(contexto.chaveIdempotencia)
    )
      throw erroContextoEscrita('a chave de idempotência');
    return {
      ...base,
      chaveIdempotencia: contexto.chaveIdempotencia,
      ...(contexto.reautenticadoEm !== undefined ? { reautenticadoEm: contexto.reautenticadoEm } : {}),
    };
  }

  /** Passo 0 sem gravar: a tela consulta se pode gravar, com o código e o motivo. */
  async liberacao<E, S extends ResultadoOperacao>(
    op: Operacao<E, S>,
    contexto: ContextoOperacao,
  ): Promise<{ readonly pode: boolean; readonly codigo: string | null; readonly motivo: string | null }> {
    try {
      const ctx = this.conferirContextoEscrita(contexto.cliente, contexto);
      if (this.deps.liberacao) {
        const porta = this.deps.liberacao.bind(this.deps);
        await this.deps.ler(ctx, (l) => porta({ nome: op.nome, critica: op.critica === true }, ctx, l));
      }
      return { pode: true, codigo: null, motivo: null };
    } catch (e) {
      if (e instanceof ErroOperacao)
        return { pode: false, codigo: e.problema.codigo ?? null, motivo: e.problema.detail };
      throw e;
    }
  }

  async executar<E, S extends ResultadoOperacao>(
    op: Operacao<E, S>,
    cliente: string,
    entradaBruta: unknown,
    contexto: ContextoOperacao,
    opcoes: OpcoesExecucao = {},
  ): Promise<SaidaExecucao<S>> {
    const nome = op.nome;
    const registrar = (d: Desfecho) => {
      if (!opcoes.desfazer && !opcoes.escritor) this.deps.metricas?.registrar(nome, d);
    };
    try {
      const ctx = this.conferirContextoEscrita(cliente, contexto);
      // O escritor de quem chama tem de estar no banco do cliente do contexto (como em escreverTransacao).
      if (opcoes.escritor && opcoes.escritor.cliente !== ctx.cliente)
        throw erroContextoEscrita('o cliente da sessão');
      const analise = op.entrada.safeParse(entradaBruta);
      if (!analise.success)
        throw erroEntradaInvalida([
          ...new Set(analise.error.issues.map((i) => i.path.map(String).join('.') || '(entrada)')),
        ]);
      const entrada = analise.data;
      const ler = <T>(fn: (l: Leitor) => Promise<T>): Promise<T> =>
        opcoes.escritor ? fn(opcoes.escritor) : this.deps.ler(ctx, fn);
      if (this.deps.liberacao) {
        const porta = this.deps.liberacao.bind(this.deps);
        await ler((l) => porta({ nome, critica: op.critica === true }, ctx, l));
      }
      if (op.critica) {
        const limite = this.deps.reautenticacaoMs ?? REAUTENTICACAO_MS_PADRAO;
        if (ctx.reautenticadoEm === undefined || this.agora() - ctx.reautenticadoEm > limite)
          throw erroReautenticacao();
      }
      const hash = hashEntrada(nome, entrada);
      const anterior = await ler((l) => lerIdempotencia(l, nome, ctx.chaveIdempotencia));
      if (anterior) {
        if (anterior.hashEntrada !== hash) throw erroIdempotenciaDivergente();
        // A mesma chave usada por outra pessoa não devolve o resultado (ids) de quem gravou.
        if (anterior.usuario !== ctx.usuario) throw erroIdempotenciaDivergente();
        registrar('repetida');
        return { resultado: anterior.resultado as S, repetida: true, eventos: [], trilha: anterior.trilha };
      }
      const permitidas = new Set(op.tabelas.map((t) => t.toLowerCase()));
      const corpo = async (e: Escritor) => {
        const instante = new Date(this.agora());
        const escritas: EscritaRegistrada[] = [];
        const tx = txDaOperacao(e, permitidas, ctx, () => new Date(this.agora()), escritas);
        const alvoTrava = op.travar?.(entrada, ctx) ?? null;
        const relido = alvoTrava ? await travarEConferir(e, alvoTrava) : null;
        await op.conferir?.(tx, entrada, ctx, relido);
        const resultado = await op.gravar(tx, entrada, ctx);
        const alvo = op.alvo(entrada, resultado);
        const extras = op.trilha?.(entrada, resultado, ctx) ?? {};
        const origem = origemComoAtual();
        const trilha = await gravarTrilha(e, {
          estabelecimento: ctx.estabelecimento,
          usuario: ctx.usuario,
          acao: extras.acao ?? op.acao ?? acaoDaTrilha(escritas, alvo),
          entidade: alvo.tabela,
          entidadeId: alvo.id,
          dadosAntes: relido ?? undefined,
          dadosDepois: {
            operacao: nome,
            resultado,
            escritas,
            ...(extras.dados !== undefined ? { dados: extras.dados } : {}),
            // ADR 0021: numa sessão "como", o ator real vai junto com o alvo (o usuário do contexto).
            ...(origem ? { origem } : {}),
          },
          motivo: extras.motivo ?? null,
          enderecoIp: ctx.enderecoIp ?? null,
          correlacao: ctx.correlacao,
          ocorridoEm: instante,
        });
        const eventos: number[] = [];
        for (const [i, ev] of (op.eventos?.(entrada, resultado, ctx) ?? []).entries()) {
          eventos.push(
            await gravarOutbox(e, {
              estabelecimento: ctx.estabelecimento,
              ponto: ev.tipo,
              entidade: alvo.tabela,
              entidadeId: alvo.id,
              chave: chaveDoEvento(ctx.cliente, nome, ctx.chaveIdempotencia, i),
              carga: { ...ev.carga, cliente: ctx.cliente },
              usuario: ctx.usuario,
              agora: instante,
            }),
          );
        }
        await gravarIdempotencia(e, {
          operacao: nome,
          chave: ctx.chaveIdempotencia,
          estabelecimento: ctx.estabelecimento,
          usuario: ctx.usuario,
          hashEntrada: hash,
          resultado,
          trilha,
          agora: instante,
        });
        return { resultado, eventos, trilha };
      };
      const r = opcoes.escritor
        ? await this.noPontoDeSalvamento(opcoes.escritor, corpo)
        : await this.deps.escrever(ctx, corpo, !opcoes.desfazer);
      registrar('sucesso');
      if (!opcoes.escritor && !opcoes.desfazer && r.eventos.length > 0)
        this.deps.aoConfirmar?.(ctx.cliente, r.eventos);
      return { resultado: r.resultado, repetida: false, eventos: r.eventos, trilha: r.trilha };
    } catch (erro) {
      const traduzido = traduzirErro(erro);
      registrar(desfechoDe(traduzido));
      this.deps.log?.('executor: operação não gravada', {
        operacao: nome,
        cliente,
        codigo: traduzido.problema.codigo,
        status: traduzido.problema.status,
        ...(erro instanceof ErroOperacao ? {} : { causa: problemaDoBanco(erro).log }),
      });
      throw traduzido;
    }
  }

  /** No escritor de quem chama: SAVEPOINT; falhou, volta a ele (nada parcial fica). */
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
}
