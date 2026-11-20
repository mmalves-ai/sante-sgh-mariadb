// Contas médicas recebidas pela operadora própria (M56, etapa 6, F5; ficha, seções 4, 6 e 8; cap-07 §7.4): regras puras
// do lado oposto do TISS do hospital. O XML já chegou validado no XSD e com o hash conferido (regra 5, na API, com o
// validador do M31); aqui ficam:
//   - o protocolo do lote (12 dígitos: AAAAMM e a sequência) e o prazo de pagamento ao prestador;
//   - a conferência do lote (versão, operadora de destino, registro das guias, prestador da rede, lote repetido, guia
//     repetida, tamanho): recusa o lote inteiro, nada é gravado;
//   - as críticas de cada guia na data do atendimento (elegibilidade, cartão de desconto, carência sem autorização,
//     prestador na rede, senha da autorização, guia já apresentada) e de cada item (procedimento não autorizado,
//     quantidade acima da autorizada, valor a maior) e a glosa automática que cada uma aplica, com o motivo da tabela 38;
//   - a revisão do auditor (glosar e desfazer com o motivo e a justificativa), os valores do lote (apresentado, glosado,
//     acatado no recurso, liberado, pago, saldo), as ações por situação, o recurso de glosa e o pagamento.
// Os valores são contados em centavos (inteiros) para não acumular erro de ponto flutuante.
import {
  type AcaoConta,
  CRITICAS_CONTA,
  type CriticaConta,
  type GuiaTissRecebida,
  type ItemTissRecebido,
  type LoteTissRecebido,
  MAXIMO_GUIAS_CONTA,
  MENSAGENS_CONTAS,
  type SituacaoAutorizacao,
  type SituacaoContaMedica,
  type SituacaoRecursoConta,
} from '@sgh/contratos';
import type { Problema } from './autorizacao.js';
import { somarDias } from './carteirinha.js';
import { avaliarElegibilidade, type DadosElegibilidade } from './elegibilidade.js';
import { normalizarDocumento } from './rede.js';

/** Parâmetros das contas (a diretoria da operadora confirma contra os contratos da rede; D-PRAZO-PAGAMENTO-56). */
export const PARAMETROS_CONTA = {
  /** Dias corridos do recebimento do lote até o pagamento ao prestador. */
  diasPagamento: 30,
  /** Tamanho mínimo da justificativa da glosa do auditor. */
  minimoJustificativa: 5,
} as const;

export const PADRAO_TISS_CONTA = '4.03.00';

// ── Dinheiro ────────────────────────────────────────────────────────────────────────────────────

const centavos = (v: number): number => Math.round(v * 100);
/** Centavos (inteiros) em reais. */
export const reaisDeCentavos = (c: number): number => Math.round(c) / 100;
const reais = reaisDeCentavos;

// ── Protocolo e prazo ───────────────────────────────────────────────────────────────────────────

/** Protocolo do lote: o ano e o mês do recebimento (AAAAMM) e a sequência (6): 12 dígitos (st_texto12 do TISS). */
export function protocoloConta(data: string, sequencia: number): string {
  if (!/^\d{4}-\d{2}/.test(data)) throw new Error('Data do protocolo inválida.');
  if (!Number.isInteger(sequencia) || sequencia < 1) throw new Error('Sequência do protocolo inválida.');
  return `${data.slice(0, 4)}${data.slice(5, 7)}${String(sequencia % 1_000_000).padStart(6, '0')}`;
}

export const protocoloContaValido = (v: string): boolean => /^\d{12}$/.test(v);

/** A competência do lote é o mês do recebimento (AAAA-MM). */
export const competenciaDoRecebimento = (hoje: string): string => hoje.slice(0, 7);

export function prazoPagamento(recebidaEm: string, dias: number = PARAMETROS_CONTA.diasPagamento): string {
  return somarDias(recebidaEm.slice(0, 10), dias);
}

/** Em análise ou liberado com o prazo de pagamento vencido (a operadora ainda deve ao prestador). */
export function contaVencida(situacao: SituacaoContaMedica, prazo: string, hoje: string): boolean {
  return (situacao === 'recebida' || situacao === 'analisada') && prazo < hoje;
}

// ── Prestador do lote ───────────────────────────────────────────────────────────────────────────

/** O documento que identifica o prestador do lote: o código na operadora é o CPF ou o CNPJ (D-CODIGO-PRESTADOR-56). */
export function documentoDaOrigem(p: LoteTissRecebido['prestador']): string {
  return normalizarDocumento(p.valor);
}

/** O prestador estava credenciado no dia? (o contrato já valia e a saída, se houver, é de depois). */
export function prestadorNaRedeNaData(
  p: { readonly contratoInicio: string; readonly situacao: string; readonly situacaoEm: string },
  dia: string,
): CriticaConta | null {
  if (dia < p.contratoInicio) return 'prestador-antes-do-contrato';
  if (p.situacao === 'descredenciado' && p.situacaoEm <= dia) return 'prestador-fora-da-rede-na-data';
  return null;
}

// ── Conferência do lote (recusa inteira) ──────────────────────────────────────────────────────────

export interface ContextoLote {
  readonly operadora: { readonly id: number; readonly registroAns: string; readonly ativa: boolean } | null;
  readonly prestadorEncontrado: boolean;
  /** O mesmo número de lote do mesmo prestador (não devolvido) ou o mesmo arquivo já recebido. */
  readonly loteJaRecebido: boolean;
}

export function problemasDoLote(l: LoteTissRecebido, x: ContextoLote): Problema[] {
  const p: Problema[] = [];
  if (l.padrao !== PADRAO_TISS_CONTA) p.push({ codigo: 'versao-recusada' });
  if (!x.operadora || !x.operadora.ativa) p.push({ codigo: 'operadora-destino-desconhecida' });
  else if (l.guias.some((g) => g.registroAns !== x.operadora!.registroAns))
    p.push({ codigo: 'registro-da-guia-divergente' });
  if (!x.prestadorEncontrado) p.push({ codigo: 'prestador-desconhecido' });
  if (x.loteJaRecebido) p.push({ codigo: 'lote-ja-recebido' });
  if (l.guias.length === 0 || l.guias.length > MAXIMO_GUIAS_CONTA) p.push({ codigo: 'guias-demais' });
  const numeros = l.guias.map((g) => g.numeroGuiaPrestador);
  if (new Set(numeros).size !== numeros.length) p.push({ codigo: 'guia-repetida-no-lote' });
  return p;
}

// ── Críticas da guia e glosa automática ──────────────────────────────────────────────────────────

/** A autorização achada pela senha da guia (F4). */
export interface AutorizacaoDaSenha {
  readonly id: number;
  readonly protocolo: string;
  readonly situacao: SituacaoAutorizacao;
  readonly beneficiario: number;
  /** O prestador que pediu e o executante. */
  readonly prestadores: readonly number[];
  readonly validade: string | null;
  readonly itens: readonly {
    readonly tabela: number;
    readonly codigo: string;
    readonly autorizada: number | null;
  }[];
}

export interface ContextoGuia {
  /** O dia do recebimento (relógio do banco). */
  readonly hoje: string;
  readonly prestador: {
    readonly id: number;
    readonly contratoInicio: string;
    readonly situacao: string;
    readonly situacaoEm: string;
  };
  /** O beneficiário da carteirinha na operadora do lote (null: não há). */
  readonly beneficiario: { readonly id: number; readonly dados: DadosElegibilidade } | null;
  /** A autorização da senha da guia (null: sem senha ou senha que não existe). */
  readonly autorizacao: AutorizacaoDaSenha | null;
  /** A mesma guia do prestador em outro lote não devolvido. */
  readonly jaApresentada: boolean;
}

/** A guia exige a senha da autorização? Internação e honorário sempre; SP/SADT no eletivo; consulta nunca (D-SENHA-CONTA-56). */
export function exigeSenha(g: Pick<GuiaTissRecebida, 'tipo' | 'carater'>): boolean {
  if (g.tipo === 'resumo-internacao' || g.tipo === 'honorario') return true;
  return g.tipo === 'sp-sadt' && g.carater !== '2';
}

const CRITICA_DA_INELEGIBILIDADE: Readonly<Record<string, CriticaConta>> = {
  'carteirinha-invalida': 'carteira-invalida',
  'nao-encontrado': 'beneficiario-inexistente',
  'antes-da-inclusao': 'atendimento-antes-da-inclusao',
  'beneficiario-excluido': 'beneficiario-excluido',
  'beneficiario-suspenso': 'beneficiario-suspenso',
  'contrato-inativo': 'contrato-inativo',
  'contrato-fora-da-vigencia': 'contrato-fora-da-vigencia',
  'produto-cancelado': 'produto-cancelado',
};

function criticasDaSenha(g: GuiaTissRecebida, x: ContextoGuia): CriticaConta[] {
  if (!g.senha) return exigeSenha(g) ? ['senha-ausente'] : [];
  const a = x.autorizacao;
  if (!a || (a.situacao !== 'autorizada' && a.situacao !== 'parcial' && a.situacao !== 'cancelada'))
    return ['senha-inexistente'];
  if (x.beneficiario && a.beneficiario !== x.beneficiario.id) return ['senha-de-outro-beneficiario'];
  if (a.situacao === 'cancelada') return ['autorizacao-cancelada'];
  const c: CriticaConta[] = [];
  if (a.validade !== null && a.validade < g.inicio) c.push('senha-vencida');
  if (!a.prestadores.includes(x.prestador.id)) c.push('autorizacao-de-outro-prestador');
  return c;
}

/** As críticas da guia inteira, na ordem em que aparecem (a primeira dá o motivo da glosa automática). */
export function criticasDaGuia(g: GuiaTissRecebida, x: ContextoGuia): CriticaConta[] {
  const c: CriticaConta[] = [];
  const el = avaliarElegibilidade(g.carteirinha, x.beneficiario?.dados ?? null, g.inicio);
  for (const m of el.motivos) c.push(CRITICA_DA_INELEGIBILIDADE[m]!);
  if (x.beneficiario?.dados.produto.natureza === 'cartaoDesconto') c.push('cartao-desconto');
  if (g.inicio > x.hoje) c.push('atendimento-no-futuro');
  const naRede = prestadorNaRedeNaData(x.prestador, g.inicio);
  if (naRede) c.push(naRede);
  c.push(...criticasDaSenha(g, x));
  // A carência dos atendimentos sem senha (os autorizados já passaram pela carência na autorização).
  if (!g.senha && el.elegivel) {
    const tipo = g.carater === '2' ? 'urgencia' : 'demais';
    if (el.carencias.some((k) => k.tipo === tipo && !k.cumprida)) c.push('em-carencia');
  }
  if (x.jaApresentada) c.push('guia-ja-apresentada');
  return c;
}

export interface GlosaAutomatica {
  /** Índice do item na guia. */
  readonly indice: number;
  readonly glosado: number;
  readonly motivo: number;
  readonly critica: CriticaConta;
  readonly justificativa: string;
}

const textoDa = (c: CriticaConta) => MENSAGENS_CONTAS[c] ?? c;
const automatica = (c: readonly CriticaConta[]) =>
  `Glosa automática no recebimento: ${c.map(textoDa).join(' ')}`.slice(0, 500);

/** O valor esperado do item: a quantidade vezes o valor unitário com o fator (centavos). */
export const valorEsperado = (i: Pick<ItemTissRecebido, 'quantidade' | 'valorUnitario' | 'fator'>): number =>
  Math.round(i.quantidade * i.valorUnitario * i.fator * 100);

/**
 * As glosas automáticas da guia: a crítica da guia glosa todos os itens inteiros (com o motivo da primeira); sem ela,
 * cada item confere o valor (só a diferença a maior) e, com a autorização da senha, o procedimento da terminologia TUSS
 * (tabela 22) contra os itens autorizados: o que não foi autorizado glosa inteiro e a quantidade acima da autorizada
 * glosa só o excesso.
 */
export function glosasAutomaticas(
  g: GuiaTissRecebida,
  criticas: readonly CriticaConta[],
  autorizacao: AutorizacaoDaSenha | null,
): GlosaAutomatica[] {
  if (criticas.length > 0) {
    const motivo = CRITICAS_CONTA[criticas[0]!].motivo;
    return g.itens
      .map((i, indice) => ({
        indice,
        glosado: centavos(i.valorTotal),
        motivo,
        critica: criticas[0]!,
        justificativa: automatica(criticas),
      }))
      .filter((x) => x.glosado > 0)
      .map((x) => ({ ...x, glosado: reais(x.glosado) }));
  }
  const confere = autorizacao !== null && g.tipo !== 'consulta';
  const saldo = new Map<string, number>();
  if (confere)
    for (const a of autorizacao.itens)
      if (a.tabela === 22) saldo.set(a.codigo, (saldo.get(a.codigo) ?? 0) + (a.autorizada ?? 0));
  const r: GlosaAutomatica[] = [];
  g.itens.forEach((i, indice) => {
    const apresentado = centavos(i.valorTotal);
    if (apresentado <= 0) return;
    const procedimento = confere && i.grupo === 'procedimento' && i.tabela === '22';
    if (procedimento && !saldo.has(i.codigo)) {
      const c: CriticaConta = 'procedimento-nao-autorizado';
      r.push({
        indice,
        glosado: reais(apresentado),
        motivo: CRITICAS_CONTA[c].motivo,
        critica: c,
        justificativa: automatica([c]),
      });
      return;
    }
    let quantidade = i.quantidade;
    let critica: CriticaConta = 'valor-a-maior';
    if (procedimento) {
      const resta = saldo.get(i.codigo)!;
      if (quantidade > resta) {
        quantidade = Math.max(0, resta);
        critica = 'quantidade-acima-da-autorizada';
      }
      saldo.set(i.codigo, resta - quantidade);
    }
    const esperado = Math.min(apresentado, valorEsperado({ ...i, quantidade }));
    if (apresentado - esperado > 0)
      r.push({
        indice,
        glosado: reais(apresentado - esperado),
        motivo: CRITICAS_CONTA[critica].motivo,
        critica,
        justificativa: automatica([critica]),
      });
  });
  return r;
}

// ── Revisão do auditor ──────────────────────────────────────────────────────────────────────────

export interface ItemParaGlosa {
  readonly id: number;
  readonly apresentado: number;
}

export interface GlosaPedida {
  readonly item: number;
  readonly valorGlosado: number;
  readonly motivo: number | null;
  readonly justificativa: string | null;
}

export function problemasDaGlosa(
  itens: readonly ItemParaGlosa[],
  pedidas: readonly GlosaPedida[],
  motivos: ReadonlySet<number>,
): Problema[] {
  const p: Problema[] = [];
  const porId = new Map(itens.map((i) => [i.id, i]));
  const vistos = new Set<number>();
  const uma = (codigo: string, campo?: string) => {
    if (!p.some((x) => x.codigo === codigo)) p.push(campo ? { codigo, campo } : { codigo });
  };
  for (const g of pedidas) {
    const i = porId.get(g.item);
    if (!i) {
      uma('item-inexistente');
      continue;
    }
    if (vistos.has(g.item)) uma('item-repetido');
    vistos.add(g.item);
    if (centavos(g.valorGlosado) > centavos(i.apresentado)) uma('glosa-acima-do-apresentado', 'valorGlosado');
    if (centavos(g.valorGlosado) === 0) {
      if (g.motivo !== null || (g.justificativa ?? '') !== '') uma('motivo-sem-glosa', 'motivo');
      continue;
    }
    if (g.motivo === null) uma('motivo-obrigatorio', 'motivo');
    else if (!motivos.has(g.motivo)) uma('motivo-inexistente', 'motivo');
    if ((g.justificativa ?? '').trim().length < PARAMETROS_CONTA.minimoJustificativa)
      uma('justificativa-obrigatoria', 'justificativa');
  }
  return p;
}

// ── Valores e situação do lote ──────────────────────────────────────────────────────────────────

export interface ValoresConta {
  readonly apresentado: number;
  readonly glosado: number;
  readonly acatado: number;
  readonly liberado: number;
  readonly pago: number;
  readonly saldo: number;
}

/** Liberado = apresentado − glosado + acatado no recurso; saldo = liberado − pago (devolvido: nada a pagar). */
export function valoresDaConta(
  v: {
    readonly apresentado: number;
    readonly glosado: number;
    readonly acatado: number;
    readonly pago: number;
  },
  situacao: SituacaoContaMedica,
): ValoresConta {
  const ap = centavos(v.apresentado);
  const gl = centavos(v.glosado);
  const ac = centavos(v.acatado);
  const pg = centavos(v.pago);
  const lib = situacao === 'devolvida' ? 0 : ap - gl + ac;
  return {
    apresentado: reais(ap),
    glosado: reais(gl),
    acatado: reais(ac),
    liberado: reais(lib),
    pago: reais(pg),
    saldo: situacao === 'recebida' || situacao === 'devolvida' ? 0 : reais(Math.max(0, lib - pg)),
  };
}

/** Depois da análise, do recurso ou do pagamento: paga sem saldo, liberada com saldo. */
export function situacaoPelosValores(liberado: number, pago: number): SituacaoContaMedica {
  return centavos(pago) >= centavos(liberado) ? 'paga' : 'analisada';
}

export interface EstadoParaAcoes {
  readonly situacao: SituacaoContaMedica;
  readonly saldo: number;
  readonly auditorDesignado: boolean;
  readonly podeAnalisar: boolean;
  readonly podeReceber: boolean;
  readonly podePagar: boolean;
  /** Guias com glosa e sem recurso registrado. */
  readonly guiasRecorriveis: number;
  readonly recursosPendentes: number;
}

export function acoesDaConta(e: EstadoParaAcoes): AcaoConta[] {
  const a: AcaoConta[] = [];
  const auditor = e.podeAnalisar && e.auditorDesignado;
  if (e.situacao === 'recebida' && auditor) a.push('glosar', 'concluir', 'devolver');
  const posAnalise = e.situacao === 'analisada' || e.situacao === 'paga';
  if (posAnalise && e.podeReceber && e.guiasRecorriveis > 0) a.push('recurso');
  if (posAnalise && auditor && e.recursosPendentes > 0) a.push('decidir-recurso');
  if (e.situacao === 'analisada' && e.podePagar && centavos(e.saldo) > 0) a.push('pagar');
  return a;
}

// ── Recurso de glosa ────────────────────────────────────────────────────────────────────────────

export interface GuiaParaRecurso {
  readonly glosado: number;
  readonly recurso: { readonly situacao: SituacaoRecursoConta; readonly valor: number } | null;
}

export function problemasDoRecurso(g: GuiaParaRecurso, valor: number): Problema[] {
  if (centavos(g.glosado) <= 0) return [{ codigo: 'sem-glosa-na-guia' }];
  if (g.recurso) return [{ codigo: 'recurso-ja-registrado' }];
  if (centavos(valor) > centavos(g.glosado)) return [{ codigo: 'recurso-acima-da-glosa', campo: 'valor' }];
  return [];
}

export function problemasDaDecisaoDoRecurso(g: GuiaParaRecurso, acatado: number): Problema[] {
  if (g.recurso?.situacao !== 'pendente') return [{ codigo: 'sem-recurso-pendente' }];
  if (centavos(acatado) > centavos(g.recurso.valor))
    return [{ codigo: 'acatado-acima-do-recurso', campo: 'valorAcatado' }];
  return [];
}

export function situacaoDoRecurso(valor: number, acatado: number): SituacaoRecursoConta {
  if (centavos(acatado) === 0) return 'mantido';
  return centavos(acatado) >= centavos(valor) ? 'acatado' : 'parcial';
}

/**
 * A glosa final de cada item depois do recurso: o valor acatado na guia desfaz a glosa dos itens na ordem (o primeiro
 * item glosado primeiro), sem passar da glosa de cada um. É o que o demonstrativo leva item a item.
 */
export function glosaFinalDosItens(glosas: readonly number[], acatado: number): number[] {
  let resta = centavos(acatado);
  return glosas.map((g) => {
    const c = centavos(g);
    const tira = Math.min(c, Math.max(0, resta));
    resta -= tira;
    return reais(c - tira);
  });
}

// ── Pagamento ao prestador ──────────────────────────────────────────────────────────────────────

export function problemasDoPagamento(
  c: { readonly situacao: SituacaoContaMedica; readonly saldo: number; readonly analisadaEm: string | null },
  e: { readonly valor: number; readonly data: string },
  hoje: string,
): Problema[] {
  if (c.situacao !== 'analisada')
    return [{ codigo: c.situacao === 'paga' ? 'nada-a-pagar' : 'situacao-nao-permite' }];
  const p: Problema[] = [];
  if (centavos(e.valor) > centavos(c.saldo)) p.push({ codigo: 'pagamento-acima-do-saldo', campo: 'valor' });
  if (e.data > hoje) p.push({ codigo: 'pagamento-no-futuro', campo: 'data' });
  else if (c.analisadaEm && e.data < c.analisadaEm.slice(0, 10))
    p.push({ codigo: 'pagamento-antes-da-analise', campo: 'data' });
  return p;
}
