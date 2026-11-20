// Regras puras da autorização de guias e da auditoria médica da operadora própria (M56, etapa 5 de 8, fatia F4; ficha,
// seções 1, 6 a 8; cap-07 §7.4; o lado oposto do TISS do hospital):
//   - o número de protocolo do pedido (registro da operadora na ANS, a data e a sequência: 20 dígitos), dado na hora em
//     que o pedido chega, e a senha da autorização (registro, sequência e o verificador módulo 11: 16 dígitos);
//   - o prazo da resposta pelo caráter do atendimento: imediato na urgência e emergência; em dias úteis nas eletivas (o
//     padrão e o das internações eletivas e da alta complexidade), parâmetros que a diretoria confirma;
//   - a conferência do pedido (tipo de guia e origem do domínio do banco, internação com o CID e as diárias, a consulta
//     com um procedimento, os códigos da terminologia TUSS vigentes, a guia principal autorizada do mesmo beneficiário);
//   - as críticas automáticas: elegibilidade na data, cartão de desconto (não é plano; regra 2), a segmentação
//     assistencial do plano (Lei 9.656/1998, art. 12), as carências (urgência, partos, demais) e a cobertura parcial
//     temporária, o prestador fora da rede ou sem o regime do atendimento;
//   - a decisão do auditor designado: o enfermeiro auditor autoriza por inteiro; negar, cortar quantidade ou diárias e
//     abrir a junta da divergência técnica são do médico auditor, com a crítica do domínio, o fundamento (cláusula do
//     contrato ou dispositivo legal) e o parecer; a crítica que bloqueia impede autorizar;
//   - a situação da guia que vale para as contas médicas (CDGUIASTATUS) e o comunicado da negativa ao beneficiário.
import {
  CATEGORIAS_AUDITOR,
  type CategoriaAuditor,
  type CaraterAtendimento,
  type CriticaAutomatica,
  type DecidirAutorizacaoEntrada,
  INTERNACAO_OBSTETRICA,
  MENSAGENS_AUTORIZACAO,
  type RegistrarAutorizacaoEntrada,
  type SituacaoAutorizacao,
  SITUACOES_EM_ABERTO,
  type SituacaoItemGuia,
  TABELA_PROCEDIMENTOS,
  TIPO_GUIA,
  type TipoPrazo,
} from '@sgh/contratos';
import { somarDias } from './carteirinha.js';
import type { ResultadoElegibilidade } from './elegibilidade.js';

/** Parâmetros dos prazos e da validade da senha (a diretoria da operadora confirma; D-PRAZO-AUT-56). */
export const PARAMETROS_AUTORIZACAO = {
  /** Dias úteis para a resposta ao pedido eletivo. */
  diasUteisPadrao: 5,
  /** Dias úteis para a resposta ao pedido de alta complexidade e à internação eletiva. */
  diasUteisComplexo: 10,
  /** Dias corridos de validade da senha da autorização. */
  diasValidadeSenha: 30,
} as const;

export interface Problema {
  readonly codigo: string;
  readonly campo?: string;
}

// ── Protocolo e senha ────────────────────────────────────────────────────────────────────────────

const registro6 = (registroAns: string): string => {
  const r = registroAns.replace(/\D/g, '');
  if (!/^\d{6}$/.test(r)) throw new Error('Registro da operadora na ANS inválido.');
  return r;
};

/** Protocolo do pedido: o registro da operadora (6), a data AAAAMMDD (8) e a sequência (6): 20 dígitos. */
export function protocoloAtendimento(registroAns: string, data: string, sequencia: number): string {
  if (!/^\d{4}-\d{2}-\d{2}/.test(data)) throw new Error('Data do protocolo inválida.');
  if (!Number.isInteger(sequencia) || sequencia < 1) throw new Error('Sequência do protocolo inválida.');
  const seq = String(sequencia % 1_000_000).padStart(6, '0');
  return `${registro6(registroAns)}${data.slice(0, 10).replace(/-/g, '')}${seq}`;
}

/** O protocolo tem 20 dígitos? */
export const protocoloValido = (v: string): boolean => /^\d{20}$/.test(v);

function digitoModulo11(base: string): number {
  let s = 0;
  let peso = 2;
  for (let i = base.length - 1; i >= 0; i--) {
    s += Number(base[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = 11 - (s % 11);
  return r >= 10 ? 0 : r;
}

/** Senha da autorização: o registro da operadora (6), a sequência (9) e o verificador módulo 11 (1). */
export function senhaAutorizacao(registroAns: string, sequencia: number): string {
  if (!Number.isInteger(sequencia) || sequencia < 1 || sequencia > 999_999_999)
    throw new Error('Sequência da senha fora da faixa.');
  const base = `${registro6(registroAns)}${String(sequencia).padStart(9, '0')}`;
  return `${base}${digitoModulo11(base)}`;
}

export function senhaValida(v: string): boolean {
  return /^\d{16}$/.test(v) && digitoModulo11(v.slice(0, 15)) === Number(v[15]);
}

/** Validade da senha a partir da data da decisão. */
export function validadeDaSenha(
  decididaEm: string,
  dias: number = PARAMETROS_AUTORIZACAO.diasValidadeSenha,
): string {
  return somarDias(decididaEm.slice(0, 10), dias);
}

// ── Prazo da resposta ────────────────────────────────────────────────────────────────────────────

/** O dia útil (segunda a sexta) depois de N dias úteis contados do dia seguinte. Feriados não entram (D-PRAZO-AUT-56). */
export function somarDiasUteis(data: string, dias: number): string {
  let d = data.slice(0, 10);
  let falta = dias;
  while (falta > 0) {
    d = somarDias(d, 1);
    const semana = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (semana !== 0 && semana !== 6) falta--;
  }
  return d;
}

/**
 * O prazo da resposta ao pedido: imediato na urgência e emergência (vence na hora do pedido); nas eletivas, até o fim
 * do N-ésimo dia útil (o padrão, ou o da internação eletiva e da alta complexidade).
 */
export function prazoDaResposta(
  p: { readonly carater: CaraterAtendimento; readonly tipoGuia: number; readonly altaComplexidade: boolean },
  agora: string,
  parametros: {
    readonly diasUteisPadrao: number;
    readonly diasUteisComplexo: number;
  } = PARAMETROS_AUTORIZACAO,
): { tipo: TipoPrazo; prazoEm: string } {
  const instante = agora.slice(0, 19).replace(' ', 'T');
  if (p.carater === 'U') return { tipo: 'imediato', prazoEm: instante };
  const complexo = p.altaComplexidade || p.tipoGuia === TIPO_GUIA.internacao;
  const dias = complexo ? parametros.diasUteisComplexo : parametros.diasUteisPadrao;
  return { tipo: complexo ? 'complexo' : 'padrao', prazoEm: `${somarDiasUteis(instante, dias)}T23:59:59` };
}

/** Em aberto e com o prazo vencido no instante (AAAA-MM-DDTHH:MM:SS). */
export function prazoVencido(situacao: SituacaoAutorizacao, prazoEm: string, agora: string): boolean {
  return (
    SITUACOES_EM_ABERTO.includes(situacao) && agora.slice(0, 19).replace(' ', 'T') > prazoEm.slice(0, 19)
  );
}

// ── Conferência do pedido ────────────────────────────────────────────────────────────────────────

export interface ProcedimentoConferido {
  readonly vigente: boolean;
}

export interface ContextoPedido {
  readonly tiposGuia: ReadonlySet<number>;
  readonly origens: ReadonlySet<number>;
  readonly hoje: string;
  /** Os códigos da tabela 22 encontrados na terminologia TUSS do banco. */
  readonly procedimentos: ReadonlyMap<string, ProcedimentoConferido>;
  /** O CID informado existe na tabela do estabelecimento (null: sem CID no pedido). */
  readonly cidExiste: boolean | null;
  /** A guia principal informada, lida pelo ID (null: não informada ou não existe). */
  readonly guiaPrincipal: {
    readonly beneficiario: number;
    readonly tipoGuia: number;
    readonly situacao: SituacaoAutorizacao;
  } | null;
  readonly beneficiario: number;
}

export function problemasDoPedido(e: RegistrarAutorizacaoEntrada, x: ContextoPedido): Problema[] {
  const p: Problema[] = [];
  if (!x.tiposGuia.has(e.tipoGuia)) p.push({ codigo: 'dominio-invalido', campo: 'tipoGuia' });
  if (!x.origens.has(e.origem)) p.push({ codigo: 'dominio-invalido', campo: 'origem' });
  const internacao = e.tipoGuia === TIPO_GUIA.internacao;
  if (internacao) {
    if (!e.internacao) p.push({ codigo: 'internacao-obrigatoria', campo: 'internacao' });
    else if (e.carater === 'E' && e.internacao.admissaoPrevista < x.hoje)
      p.push({ codigo: 'admissao-no-passado', campo: 'internacao.admissaoPrevista' });
    if (!e.cid) p.push({ codigo: 'cid-obrigatorio', campo: 'cid' });
  } else if (e.internacao) p.push({ codigo: 'internacao-so-na-guia-de-internacao', campo: 'internacao' });
  if (e.cid && x.cidExiste === false) p.push({ codigo: 'cid-inexistente', campo: 'cid' });
  if (e.tipoGuia === TIPO_GUIA.consulta) {
    const [i] = e.itens;
    if (e.itens.length !== 1 || i?.tabela !== TABELA_PROCEDIMENTOS || i.quantidade !== 1)
      p.push({ codigo: 'consulta-um-item', campo: 'itens' });
  }
  const vistos = new Set<string>();
  let codigoTuss = false;
  let inexistente = false;
  let foraDaVigencia = false;
  let semDescricao = false;
  let repetido = false;
  for (const i of e.itens) {
    const chave = `${i.tabela}:${i.codigo}`;
    if (vistos.has(chave)) repetido = true;
    vistos.add(chave);
    if (i.tabela === TABELA_PROCEDIMENTOS) {
      if (!/^\d{8}$/.test(i.codigo)) codigoTuss = true;
      else {
        const t = x.procedimentos.get(i.codigo);
        if (!t) inexistente = true;
        else if (!t.vigente) foraDaVigencia = true;
      }
    } else if (!i.descricao) semDescricao = true;
  }
  if (codigoTuss) p.push({ codigo: 'codigo-tuss-invalido', campo: 'itens' });
  if (inexistente) p.push({ codigo: 'procedimento-inexistente', campo: 'itens' });
  if (foraDaVigencia) p.push({ codigo: 'procedimento-fora-de-vigencia', campo: 'itens' });
  if (semDescricao) p.push({ codigo: 'descricao-obrigatoria', campo: 'itens' });
  if (repetido) p.push({ codigo: 'item-repetido', campo: 'itens' });
  if (e.guiaPrincipal !== null) {
    if (e.tipoGuia !== TIPO_GUIA.sadt && !internacao)
      p.push({ codigo: 'guia-principal-so-sadt-ou-internacao', campo: 'guiaPrincipal' });
    else {
      const g = x.guiaPrincipal;
      if (
        !g ||
        g.beneficiario !== x.beneficiario ||
        g.tipoGuia !== TIPO_GUIA.internacao ||
        (g.situacao !== 'autorizada' && g.situacao !== 'parcial')
      )
        p.push({ codigo: 'guia-principal-inexistente', campo: 'guiaPrincipal' });
    }
  }
  return p;
}

// ── Críticas automáticas ─────────────────────────────────────────────────────────────────────────

/** Códigos das críticas da autorização no domínio da operadora (PSCRITICA), lidos do banco do estabelecimento. */
export const CRITICA_DOMINIO = {
  carencia: 1,
  inadimplencia: 2,
  inatividade: 3,
  cobertura: 4,
  quantidade: 5,
  preexistencia: 6,
  retorno: 7,
} as const;

export type CoberturaSegmentacao = 'cobre' | 'nao-cobre' | 'conferir';

/**
 * A segmentação assistencial cobre o atendimento? (Lei 9.656/1998, art. 12.) O ambulatorial não tem internação; o
 * hospitalar só tem o SP/SADT ligado à internação (pela guia principal) e a obstetrícia só no "com obstetrícia"; o
 * odontológico não tem guia médica; o plano-referência cobre tudo; no ambulatorial e hospitalar a obstetrícia é conferida
 * no contrato.
 */
export function segmentacaoCobre(
  segmentacao: string | null,
  p: {
    readonly tipoGuia: number;
    readonly internacaoTipo: number | null;
    readonly comGuiaPrincipal: boolean;
  },
): CoberturaSegmentacao {
  const internacao = p.tipoGuia === TIPO_GUIA.internacao;
  const obstetrica = internacao && p.internacaoTipo === INTERNACAO_OBSTETRICA;
  const ambulatorialSemInternacao = !internacao && !(p.tipoGuia === TIPO_GUIA.sadt && p.comGuiaPrincipal);
  switch (segmentacao) {
    case 'referencia':
      return 'cobre';
    case 'ambulatorialHospitalar':
      return obstetrica ? 'conferir' : 'cobre';
    case 'ambulatorial':
      return internacao ? 'nao-cobre' : 'cobre';
    case 'hospitalarComObstetricia':
      return ambulatorialSemInternacao ? 'nao-cobre' : 'cobre';
    case 'hospitalarSemObstetricia':
      return ambulatorialSemInternacao || obstetrica ? 'nao-cobre' : 'cobre';
    default:
      return 'nao-cobre';
  }
}

/**
 * W0-10 (M7): a cobertura do plano por tipo de atendimento, para a elegibilidade do portal do prestador: a mesma regra
 * da segmentação do pedido de autorização (consulta e SP/SADT sem internação; internação clínica; internação
 * obstétrica). O cartão de desconto não é plano (Lei 9.656/1998): não cobre nada.
 */
export function coberturaPorAtendimento(
  natureza: 'plano' | 'cartaoDesconto',
  segmentacao: string | null,
): { atendimento: 'consulta' | 'sadt' | 'internacao' | 'parto'; cobertura: CoberturaSegmentacao }[] {
  const casos = [
    ['consulta', { tipoGuia: TIPO_GUIA.consulta, internacaoTipo: null, comGuiaPrincipal: false }],
    ['sadt', { tipoGuia: TIPO_GUIA.sadt, internacaoTipo: null, comGuiaPrincipal: false }],
    ['internacao', { tipoGuia: TIPO_GUIA.internacao, internacaoTipo: 1, comGuiaPrincipal: false }],
    [
      'parto',
      { tipoGuia: TIPO_GUIA.internacao, internacaoTipo: INTERNACAO_OBSTETRICA, comGuiaPrincipal: false },
    ],
  ] as const;
  return casos.map(([atendimento, p]) => ({
    atendimento,
    cobertura: natureza === 'plano' ? segmentacaoCobre(segmentacao, p) : 'nao-cobre',
  }));
}

/** A carência que vale para o atendimento: urgência, partos (internação obstétrica eletiva) ou as demais. */
export function carenciaDoAtendimento(p: {
  readonly carater: CaraterAtendimento;
  readonly tipoGuia: number;
  readonly internacaoTipo: number | null;
}): 'urgencia' | 'partos' | 'demais' {
  if (p.carater === 'U') return 'urgencia';
  if (p.tipoGuia === TIPO_GUIA.internacao && p.internacaoTipo === INTERNACAO_OBSTETRICA) return 'partos';
  return 'demais';
}

/** O regime do contrato do prestador (TBREGIMEATEND: 1 ambulatorial, 2 hospitalar, 3 os dois) serve? */
export function regimeServe(
  regime: number,
  p: { readonly tipoGuia: number; readonly comGuiaPrincipal: boolean },
): boolean {
  if (p.tipoGuia === TIPO_GUIA.internacao) return regime === 2 || regime === 3;
  if (p.tipoGuia === TIPO_GUIA.sadt && p.comGuiaPrincipal) return true;
  return regime === 1 || regime === 3;
}

export interface ContextoCriticas {
  readonly elegibilidade: ResultadoElegibilidade;
  readonly produto: { readonly natureza: 'plano' | 'cartaoDesconto'; readonly segmentacao: string | null };
  readonly pedido: {
    readonly carater: CaraterAtendimento;
    readonly tipoGuia: number;
    readonly internacaoTipo: number | null;
    readonly comGuiaPrincipal: boolean;
  };
  /** O prestador que pede e o que executa (null: não está na rede); o executante só quando é outro. */
  readonly prestador: { readonly situacao: string; readonly regime: number } | null;
  readonly executante?: { readonly situacao: string; readonly regime: number } | null;
  /** Há executante informado (mesmo que não esteja na rede)? */
  readonly temExecutante?: boolean;
}

const critica = (codigo: string, bloqueia: boolean, dominio: number | null): CriticaAutomatica => ({
  codigo,
  bloqueia,
  critica: dominio,
  texto: MENSAGENS_AUTORIZACAO[codigo] ?? codigo,
});

/** As críticas automáticas do pedido na data: as que bloqueiam a autorização e as que só avisam o auditor. */
export function criticasAutomaticas(x: ContextoCriticas): CriticaAutomatica[] {
  const r: CriticaAutomatica[] = [];
  if (!x.elegibilidade.elegivel)
    r.push(critica('beneficiario-inelegivel', true, CRITICA_DOMINIO.inatividade));
  if (x.produto.natureza === 'cartaoDesconto')
    r.push(critica('produto-nao-e-plano', true, CRITICA_DOMINIO.cobertura));
  else {
    const cobre = segmentacaoCobre(x.produto.segmentacao, x.pedido);
    if (cobre === 'nao-cobre') r.push(critica('fora-da-segmentacao', true, CRITICA_DOMINIO.cobertura));
    if (cobre === 'conferir') r.push(critica('obstetricia-a-conferir', false, CRITICA_DOMINIO.cobertura));
    const cumprida = (tipo: string) =>
      x.elegibilidade.carencias.find((c) => c.tipo === tipo)?.cumprida ?? true;
    const tipo = carenciaDoAtendimento(x.pedido);
    if (!cumprida(tipo)) r.push(critica('em-carencia', true, CRITICA_DOMINIO.carencia));
    else if (tipo === 'urgencia' && x.pedido.tipoGuia === TIPO_GUIA.internacao) {
      const da = x.pedido.internacaoTipo === INTERNACAO_OBSTETRICA ? 'partos' : 'demais';
      if (!cumprida(da)) r.push(critica('urgencia-em-carencia', false, CRITICA_DOMINIO.carencia));
    }
    if (!cumprida('cpt')) r.push(critica('cpt-vigente', false, CRITICA_DOMINIO.preexistencia));
  }
  const naRede = (q: { readonly situacao: string } | null | undefined) => q?.situacao === 'credenciado';
  const executa = x.temExecutante ? x.executante : x.prestador;
  if (!naRede(x.prestador) || !naRede(executa)) r.push(critica('prestador-fora-da-rede', true, null));
  else if (executa && !regimeServe(executa.regime, x.pedido))
    r.push(critica('prestador-sem-regime', true, null));
  return r;
}

// ── Ações por situação ───────────────────────────────────────────────────────────────────────────

export type AcaoAutorizacao =
  'pedirComplemento' | 'responderComplemento' | 'decidir' | 'abrirJunta' | 'concluirJunta' | 'cancelar';

const ACOES: Readonly<Record<SituacaoAutorizacao, readonly AcaoAutorizacao[]>> = {
  'em-analise': ['pedirComplemento', 'decidir', 'abrirJunta', 'cancelar'],
  pendente: ['responderComplemento', 'cancelar'],
  'em-junta': ['concluirJunta', 'cancelar'],
  autorizada: ['cancelar'],
  parcial: ['cancelar'],
  negada: [],
  cancelada: [],
};

export const acaoPermitida = (situacao: SituacaoAutorizacao, acao: AcaoAutorizacao): boolean =>
  ACOES[situacao].includes(acao);

export const acoesDaSituacao = (situacao: SituacaoAutorizacao): readonly AcaoAutorizacao[] => ACOES[situacao];

// ── Decisão do auditor ───────────────────────────────────────────────────────────────────────────

export interface PedidoParaDecisao {
  readonly tipoGuia: number;
  readonly itens: readonly { readonly id: number; readonly quantidadeSolicitada: number }[];
  readonly diariasSolicitadas: number | null;
}

export interface ItemDecidido {
  readonly id: number;
  readonly quantidade: number;
  readonly situacao: SituacaoItemGuia;
}

export interface ResultadoDecisao {
  readonly problemas: Problema[];
  readonly situacao: 'autorizada' | 'parcial' | 'negada';
  readonly itens: ItemDecidido[];
  readonly diarias: number | null;
}

type EntradaDecisao = Pick<
  DecidirAutorizacaoEntrada,
  'decisao' | 'itens' | 'diariasAutorizadas' | 'critica' | 'fundamento'
>;

/**
 * A decisão do auditor designado (ou a da junta): na negativa, todos os itens negados, com a crítica, o fundamento e o
 * médico auditor; na autorização, a quantidade de cada item até a pedida (0 nega o item) e as diárias até as pedidas;
 * menos que o pedido é autorização parcial, também do médico, com a crítica e o fundamento. A crítica automática que
 * bloqueia impede autorizar.
 */
export function conferirDecisao(
  pedido: PedidoParaDecisao,
  e: EntradaDecisao,
  auditor: { readonly categoria: CategoriaAuditor } | null,
  criticas: readonly CriticaAutomatica[],
  criticasDoDominio: ReadonlySet<number>,
): ResultadoDecisao {
  const p: Problema[] = [];
  if (!auditor) p.push({ codigo: 'auditor-nao-designado', campo: 'auditor' });
  const medico = auditor?.categoria === 'medico';
  const internacao = pedido.tipoGuia === TIPO_GUIA.internacao;
  const justificar = () => {
    if (auditor && !medico) p.push({ codigo: 'negativa-so-medico', campo: 'decisao' });
    if (e.critica === null) p.push({ codigo: 'critica-obrigatoria', campo: 'critica' });
    else if (!criticasDoDominio.has(e.critica)) p.push({ codigo: 'dominio-invalido', campo: 'critica' });
    if (!e.fundamento) p.push({ codigo: 'fundamento-obrigatorio', campo: 'fundamento' });
  };
  if (e.decisao === 'negar') {
    justificar();
    return {
      problemas: p,
      situacao: 'negada',
      itens: pedido.itens.map((i) => ({ id: i.id, quantidade: 0, situacao: 'negado' })),
      diarias: null,
    };
  }
  if (criticas.some((c) => c.bloqueia)) p.push({ codigo: 'critica-bloqueante', campo: 'decisao' });
  const porItem = new Map(e.itens.map((i) => [i.item, i.quantidadeAutorizada]));
  const cobreTodos =
    porItem.size === e.itens.length &&
    pedido.itens.length === e.itens.length &&
    pedido.itens.every((i) => porItem.has(i.id));
  if (!cobreTodos) p.push({ codigo: 'itens-da-decisao', campo: 'itens' });
  const itens: ItemDecidido[] = pedido.itens.map((i) => {
    const q = Math.min(porItem.get(i.id) ?? 0, i.quantidadeSolicitada);
    return {
      id: i.id,
      quantidade: q,
      situacao: q === i.quantidadeSolicitada ? 'autorizado' : q === 0 ? 'negado' : 'parcial',
    };
  });
  if (pedido.itens.some((i) => (porItem.get(i.id) ?? 0) > i.quantidadeSolicitada))
    p.push({ codigo: 'quantidade-acima-do-pedido', campo: 'itens' });
  if (cobreTodos && itens.every((i) => i.quantidade === 0))
    p.push({ codigo: 'nada-autorizado', campo: 'itens' });
  let diarias: number | null = null;
  let diariasCortadas = false;
  if (internacao) {
    if (e.diariasAutorizadas === null)
      p.push({ codigo: 'diarias-obrigatorias', campo: 'diariasAutorizadas' });
    else if (pedido.diariasSolicitadas !== null && e.diariasAutorizadas > pedido.diariasSolicitadas)
      p.push({ codigo: 'diarias-acima-do-pedido', campo: 'diariasAutorizadas' });
    else {
      diarias = e.diariasAutorizadas;
      diariasCortadas = pedido.diariasSolicitadas !== null && diarias < pedido.diariasSolicitadas;
    }
  }
  const parcial = itens.some((i) => i.situacao !== 'autorizado') || diariasCortadas;
  if (parcial) justificar();
  return { problemas: p, situacao: parcial ? 'parcial' : 'autorizada', itens, diarias };
}

/** A abertura da junta (divergência técnica): do médico auditor, com o aviso já dado; o desempatador é outro médico. */
export function problemasDaJunta(
  e: { readonly notificadosEm: string; readonly desempatador: { readonly crm: string; readonly uf: string } },
  solicitante: { readonly conselho: string; readonly numero: string; readonly uf: string },
  auditor: { readonly categoria: CategoriaAuditor } | null,
  hoje: string,
): Problema[] {
  const p: Problema[] = [];
  if (!auditor) p.push({ codigo: 'auditor-nao-designado', campo: 'auditor' });
  else if (auditor.categoria !== 'medico') p.push({ codigo: 'junta-so-medico', campo: 'auditor' });
  if (e.notificadosEm > hoje) p.push({ codigo: 'notificacao-no-futuro', campo: 'notificadosEm' });
  if (
    solicitante.conselho === 'CRM' &&
    solicitante.numero.replace(/^0+/, '') === e.desempatador.crm.replace(/^0+/, '') &&
    solicitante.uf === e.desempatador.uf
  )
    p.push({ codigo: 'desempatador-e-o-solicitante', campo: 'desempatador' });
  return p;
}

// ── Designação dos auditores ─────────────────────────────────────────────────────────────────────

/** O conselho da categoria do auditor (médico: CRM; enfermeiro: COREN). */
export const conselhoDoAuditor = (categoria: CategoriaAuditor): string =>
  CATEGORIAS_AUDITOR[categoria].conselho;

export function problemasDaDesignacao(e: { readonly inicio: string }, hoje: string): Problema[] {
  return e.inicio > somarDias(hoje, 30) ? [{ codigo: 'inicio-no-futuro-distante', campo: 'inicio' }] : [];
}

/** A designação vale no dia (ativa, já começou e sem fim antes dele). */
export function designacaoVigente(
  d: { readonly situacao: string; readonly inicio: string; readonly fim: string | null },
  hoje: string,
): boolean {
  return d.situacao === 'ativo' && d.inicio <= hoje && (d.fim === null || d.fim >= hoje);
}

// ── Situação da guia e comunicado ────────────────────────────────────────────────────────────────

/** A situação da guia (CDGUIASTATUS) para as contas médicas: 1 autorizada (também a parcial), 5 cancelada. */
export function situacaoGuiaTiss(situacao: SituacaoAutorizacao): number | null {
  if (situacao === 'autorizada' || situacao === 'parcial') return 1;
  if (situacao === 'cancelada') return 5;
  return null;
}

const dataBr = (d: string) => d.slice(0, 10).split('-').reverse().join('/');

/**
 * O comunicado da negativa (total ou parcial) ao beneficiário, em linguagem clara: o protocolo, o que foi negado, o
 * motivo, a cláusula do contrato ou o dispositivo legal e o parecer. Null quando nada foi negado.
 */
export function comunicadoDaNegativa(x: {
  readonly situacao: SituacaoAutorizacao;
  readonly protocolo: string;
  readonly beneficiario: string;
  readonly decididaEm: string | null;
  readonly critica: string | null;
  readonly fundamento: string | null;
  readonly parecer: string | null;
  readonly negados: readonly string[];
}): string | null {
  if (x.situacao !== 'negada' && x.situacao !== 'parcial') return null;
  const total = x.situacao === 'negada';
  return [
    `Protocolo ${x.protocolo}${x.decididaEm ? `, decidido em ${dataBr(x.decididaEm)}` : ''}.`,
    `${x.beneficiario}, o pedido de autorização foi ${total ? 'negado' : 'autorizado em parte'}.`,
    x.negados.length ? `${total ? 'Negado' : 'Não autorizado'}: ${x.negados.join('; ')}.` : null,
    x.critica ? `Motivo: ${x.critica}.` : null,
    x.fundamento ? `Fundamento: ${x.fundamento}.` : null,
    x.parecer ? `Parecer da auditoria: ${x.parecer}` : null,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');
}
