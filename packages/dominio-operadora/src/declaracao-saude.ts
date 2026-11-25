// Declaração de saúde, doença ou lesão preexistente, cobertura parcial temporária e portabilidade de carências do
// beneficiário da operadora (F7, 08-SGO L95, C2-113). Regra pura, sem banco: a porta grava o que estas funções decidem.
// Padrões públicos:
// - Lei 9.656/98, art. 11 e RN ANS 162/2007: a doença ou lesão preexistente (DLP) é a que o beneficiário sabe ter na
//   adesão; a declaração pode ser feita com entrevista qualificada por médico orientador; a operadora oferece a
//   cobertura parcial temporária (CPT) de até 24 meses contados da adesão para os procedimentos ligados à DLP, ou o
//   agravo como alternativa; no coletivo empresarial com 30 ou mais participantes não cabe nem CPT nem agravo.
// - RN ANS 438/2018: portabilidade de carências com permanência mínima no plano de origem (2 anos na primeira, 3 anos
//   quando cumpriu CPT, 1 ano nas seguintes), adimplência e faixa de preço compatível na modalidade ordinária; resposta
//   da operadora de destino em até 10 dias; aprovada, o beneficiário não cumpre carência de novo.
// Melhoria: a resposta "sim" já pede o detalhe e o CID na hora; a decisão da DLP gera a CPT com o fim calculado e as
// carências aprovadas pela portabilidade passam a valer na hora, sem o aproveitamento digitado à mão.

import { somarDias, somarMeses } from './carteirinha.js';

export interface ProblemaDeclaracaoSaude {
  readonly codigo: string;
  readonly campo: string;
  readonly detalhe: string;
}
const p = (codigo: string, campo: string, detalhe: string): ProblemaDeclaracaoSaude => ({
  codigo,
  campo,
  detalhe,
});
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (d: string | null | undefined): d is string =>
  typeof d === 'string' && DATA.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`));

// ---- declaração de saúde ----

export const SITUACOES_DECLARACAO_SAUDE = [
  'rascunho',
  'preenchida',
  'em_analise',
  'analisada',
  'cancelada',
] as const;
export type SituacaoDeclaracaoSaude = (typeof SITUACOES_DECLARACAO_SAUDE)[number];
const PASSOS_DECLARACAO: Readonly<Record<SituacaoDeclaracaoSaude, readonly SituacaoDeclaracaoSaude[]>> = {
  rascunho: ['preenchida', 'cancelada'],
  preenchida: ['em_analise', 'analisada', 'cancelada'],
  em_analise: ['analisada', 'cancelada'],
  analisada: [],
  cancelada: [],
};

/** O passo da declaração é permitido (rascunho → preenchida → em análise → analisada; cancelar antes de analisada). */
export function passoDaDeclaracao(de: string, para: string): ProblemaDeclaracaoSaude | null {
  const permitidos = PASSOS_DECLARACAO[de as SituacaoDeclaracaoSaude];
  if (!permitidos) return p('situacao-invalida', 'situacao', 'Situação atual da declaração desconhecida.');
  return permitidos.includes(para as SituacaoDeclaracaoSaude)
    ? null
    : p('passo-invalido', 'situacao', 'Este passo não é permitido para a situação atual da declaração.');
}

export const FORMAS_IDENTIFICACAO_DLP = [
  'declarada',
  'entrevista_qualificada',
  'pericia',
  'auditoria',
] as const;
export type FormaIdentificacaoDlp = (typeof FORMAS_IDENTIFICACAO_DLP)[number];

export interface RespostaDeclaracao {
  readonly pergunta: number;
  readonly afirmativa: boolean | null;
  readonly texto: string | null;
  readonly complemento: string | null;
}
export interface DoencaDeclarada {
  /** Termo do CID-10. */
  readonly termo: number;
  readonly inicio: string;
  readonly forma: string;
}
export interface DadosDeclaracao {
  readonly preenchidaEm: string;
  readonly hoje: string;
  readonly pesoKg: number | null;
  readonly alturaM: number | null;
  readonly entrevistaQualificada: boolean;
  readonly medicoOrientador: number | null;
  readonly dispensouOrientacao: boolean;
  readonly respostas: readonly RespostaDeclaracao[];
  /** Perguntas obrigatórias do questionário. */
  readonly obrigatorias: readonly number[];
  /** Perguntas do questionário (as respostas só valem para elas). */
  readonly perguntas: readonly number[];
  readonly doencas: readonly DoencaDeclarada[];
}

/**
 * A declaração preenchida: entrevista qualificada com médico orientador (e não dispensada ao mesmo tempo), medidas
 * plausíveis, todas as obrigatórias respondidas, resposta "sim" com o detalhe, e ao menos uma doença com CID quando
 * há resposta "sim". A doença começa antes ou no dia da declaração e não se repete.
 */
export function problemasDaDeclaracao(x: DadosDeclaracao): ProblemaDeclaracaoSaude[] {
  const r: ProblemaDeclaracaoSaude[] = [];
  if (!dataValida(x.preenchidaEm)) r.push(p('data-invalida', 'preenchidaEm', 'Data da declaração inválida.'));
  else if (x.preenchidaEm > x.hoje)
    r.push(p('data-futura', 'preenchidaEm', 'A declaração não pode ter data futura.'));
  if (x.entrevistaQualificada && x.medicoOrientador === null)
    r.push(
      p('medico-orientador', 'medicoOrientador', 'A entrevista qualificada precisa do médico orientador.'),
    );
  if (x.entrevistaQualificada && x.dispensouOrientacao)
    r.push(
      p(
        'orientacao-contraditoria',
        'dispensouOrientacao',
        'Com entrevista qualificada o proponente não dispensou a orientação médica.',
      ),
    );
  if (x.pesoKg !== null && !(x.pesoKg > 0 && x.pesoKg <= 400))
    r.push(p('peso-invalido', 'pesoKg', 'Peso fora da faixa (até 400 kg).'));
  if (x.alturaM !== null && !(x.alturaM >= 0.3 && x.alturaM <= 2.6))
    r.push(p('altura-invalida', 'alturaM', 'Altura fora da faixa (0,30 a 2,60 m).'));
  const perguntas = new Set(x.perguntas);
  const vistas = new Set<number>();
  for (const s of x.respostas) {
    if (!perguntas.has(s.pergunta))
      r.push(p('pergunta-de-outro-questionario', 'respostas', 'Resposta a pergunta fora do questionário.'));
    if (vistas.has(s.pergunta))
      r.push(p('resposta-repetida', 'respostas', 'A mesma pergunta foi respondida duas vezes.'));
    vistas.add(s.pergunta);
    if (s.afirmativa === true && !(s.complemento ?? '').trim())
      r.push(
        p(
          'complemento-obrigatorio',
          'respostas',
          'Resposta "sim" precisa do detalhe: qual doença, desde quando e o tratamento.',
        ),
      );
  }
  const respondidas = new Set(
    x.respostas.filter((s) => s.afirmativa !== null || (s.texto ?? '').trim() !== '').map((s) => s.pergunta),
  );
  if (x.obrigatorias.some((o) => !respondidas.has(o)))
    r.push(p('resposta-obrigatoria', 'respostas', 'Responda todas as perguntas obrigatórias.'));
  if (x.respostas.some((s) => s.afirmativa === true) && x.doencas.length === 0)
    r.push(
      p(
        'doenca-nao-informada',
        'doencas',
        'Houve resposta "sim": informe a doença ou lesão com o CID para a análise.',
      ),
    );
  const termos = new Set<number>();
  for (const d of x.doencas) {
    if (termos.has(d.termo))
      r.push(p('doenca-repetida', 'doencas', 'A mesma doença foi informada duas vezes.'));
    termos.add(d.termo);
    if (!FORMAS_IDENTIFICACAO_DLP.includes(d.forma as FormaIdentificacaoDlp))
      r.push(p('forma-invalida', 'doencas', 'Forma de identificação da doença fora da lista.'));
    if (!dataValida(d.inicio)) r.push(p('inicio-invalido', 'doencas', 'Data de início da doença inválida.'));
    else if (dataValida(x.preenchidaEm) && d.inicio > x.preenchidaEm)
      r.push(
        p(
          'inicio-depois-da-declaracao',
          'doencas',
          'A doença preexistente começa antes ou no dia da declaração.',
        ),
      );
  }
  return r;
}

/** Índice de massa corporal (kg/m²) com uma casa, ou nulo sem as medidas. */
export function imcDaDeclaracao(pesoKg: number | null, alturaM: number | null): number | null {
  if (pesoKg === null || alturaM === null || !(pesoKg > 0) || !(alturaM > 0)) return null;
  return Math.round((pesoKg / (alturaM * alturaM)) * 10) / 10;
}

// ---- decisão sobre a doença preexistente e cobertura parcial temporária ----

export const DECISOES_DLP = [
  'em_analise',
  'cobertura_parcial_temporaria',
  'agravo',
  'sem_restricao',
] as const;
export type DecisaoDlp = (typeof DECISOES_DLP)[number];
/** Prazo máximo da CPT (Lei 9.656/98, art. 11; RN 162). */
export const PRAZO_MAXIMO_CPT_MESES = 24;
/** Coletivo empresarial a partir deste número de participantes não tem CPT nem agravo (RN 162 e RN 195). */
export const PARTICIPANTES_SEM_CPT = 30;

export interface DadosDecisaoDlp {
  readonly decisaoAtual: string;
  readonly decisao: string;
  readonly prazoMeses: number | null;
  readonly percentualAgravo: number | null;
  readonly adesao: string;
  readonly hoje: string;
  readonly tipoContratacao: string;
  readonly participantesNoContrato: number;
}

/**
 * A decisão sobre a doença: só uma vez (sai de "em análise"); CPT com prazo de 1 a 24 meses que ainda não acabou;
 * agravo com percentual positivo; no coletivo empresarial com 30 ou mais participantes só "sem restrição".
 */
export function problemasDaDecisaoDlp(x: DadosDecisaoDlp): ProblemaDeclaracaoSaude[] {
  const r: ProblemaDeclaracaoSaude[] = [];
  if (x.decisaoAtual !== 'em_analise')
    r.push(p('ja-decidida', 'decisao', 'A cobertura desta doença já foi decidida.'));
  if (!DECISOES_DLP.includes(x.decisao as DecisaoDlp) || x.decisao === 'em_analise')
    r.push(p('decisao-invalida', 'decisao', 'Escolha CPT, agravo ou sem restrição.'));
  const semRestricaoObrigatoria =
    x.tipoContratacao === 'coletivo_empresarial' && x.participantesNoContrato >= PARTICIPANTES_SEM_CPT;
  if (semRestricaoObrigatoria && (x.decisao === 'cobertura_parcial_temporaria' || x.decisao === 'agravo'))
    r.push(
      p(
        'cpt-nao-cabe',
        'decisao',
        `Coletivo empresarial com ${PARTICIPANTES_SEM_CPT} ou mais participantes: a doença preexistente tem cobertura integral.`,
      ),
    );
  if (x.decisao === 'cobertura_parcial_temporaria') {
    const prazo = x.prazoMeses;
    if (prazo === null || !Number.isInteger(prazo) || prazo < 1 || prazo > PRAZO_MAXIMO_CPT_MESES)
      r.push(p('prazo-invalido', 'prazoMeses', `O prazo da CPT vai de 1 a ${PRAZO_MAXIMO_CPT_MESES} meses.`));
    else if (dataValida(x.adesao) && planoDaCpt(x.adesao, prazo).fimPrevisto < x.hoje)
      r.push(
        p(
          'cpt-vencida',
          'prazoMeses',
          'O prazo da CPT conta da adesão e já terminou: a doença tem cobertura integral.',
        ),
      );
  }
  if (x.decisao === 'agravo' && (x.percentualAgravo === null || !(x.percentualAgravo > 0)))
    r.push(p('agravo-invalido', 'percentualAgravo', 'O agravo precisa de percentual maior que zero.'));
  return r;
}

/** A CPT começa na adesão e termina na véspera do mês de prazo completo. */
export function planoDaCpt(adesao: string, prazoMeses: number): { inicio: string; fimPrevisto: string } {
  return { inicio: adesao, fimPrevisto: somarDias(somarMeses(adesao, prazoMeses), -1) };
}

export interface CptNaData {
  readonly codigoCid: string;
  readonly inicio: string;
  readonly fimPrevisto: string;
  readonly situacao: string;
}
/** A CPT restringe o CID na data (vigente e dentro do período); o CID vale pelo código ou pela categoria (3 letras). */
export function cptRestringe(cpts: readonly CptNaData[], cid: string, data: string): boolean {
  const alvo = cid.replace('.', '').toUpperCase();
  return cpts.some((c) => {
    const k = c.codigoCid.replace('.', '').toUpperCase();
    return (
      c.situacao === 'vigente' &&
      c.inicio <= data &&
      c.fimPrevisto >= data &&
      (alvo === k || (k.length === 3 && alvo.startsWith(k)))
    );
  });
}

/** O encerramento antecipado ou o cancelamento da CPT: só vigente, na data do início ou depois, com motivo. */
export function problemasDoEncerramentoCpt(x: {
  readonly situacao: string;
  readonly inicio: string;
  readonly data: string;
  readonly motivo: string | null;
}): ProblemaDeclaracaoSaude[] {
  const r: ProblemaDeclaracaoSaude[] = [];
  if (x.situacao !== 'vigente') r.push(p('cpt-nao-vigente', 'situacao', 'A CPT não está vigente.'));
  if (!dataValida(x.data)) r.push(p('data-invalida', 'data', 'Data de encerramento inválida.'));
  else if (x.data < x.inicio)
    r.push(p('data-antes-do-inicio', 'data', 'O encerramento não pode ser antes do início da CPT.'));
  if (!(x.motivo ?? '').trim())
    r.push(p('motivo-obrigatorio', 'motivo', 'Informe o motivo do encerramento.'));
  return r;
}

// ---- portabilidade de carências (RN 438/2018) ----

export const DIRECOES_PORTABILIDADE = ['recebida', 'concedida'] as const;
export const MODALIDADES_PORTABILIDADE = ['ordinaria', 'especial', 'extraordinaria'] as const;
export const SITUACOES_PORTABILIDADE = [
  'recebida',
  'em_analise',
  'aprovada',
  'recusada',
  'cancelada',
] as const;
export type SituacaoPortabilidade = (typeof SITUACOES_PORTABILIDADE)[number];
/** Prazo da operadora de destino para responder (RN 438, art. 14); sem resposta, a portabilidade vale. */
export const PRAZO_RESPOSTA_PORTABILIDADE_DIAS = 10;
export const PERMANENCIA_MINIMA_MESES = { primeira: 24, comCpt: 36, seguinte: 12 } as const;

/** Meses completos entre duas datas (AAAA-MM-DD). */
export function mesesCompletos(de: string, ate: string): number {
  const [a1, m1, d1] = de.split('-').map(Number) as [number, number, number];
  const [a2, m2, d2] = ate.split('-').map(Number) as [number, number, number];
  const m = (a2 - a1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
  return Math.max(0, m);
}

export const prazoRespostaPortabilidade = (solicitado: string): string =>
  somarDias(solicitado, PRAZO_RESPOSTA_PORTABILIDADE_DIAS);

export interface DadosPortabilidade {
  readonly direcao: string;
  readonly modalidade: string;
  readonly registroAnsOrigem: string;
  readonly vinculoInicio: string | null;
  readonly solicitadoEm: string;
  readonly hoje: string;
}

/** O pedido: direção e modalidade da lista, registro da outra operadora com 6 dígitos, vínculo antes do pedido. */
export function problemasDaPortabilidade(x: DadosPortabilidade): ProblemaDeclaracaoSaude[] {
  const r: ProblemaDeclaracaoSaude[] = [];
  if (!(DIRECOES_PORTABILIDADE as readonly string[]).includes(x.direcao))
    r.push(p('direcao-invalida', 'direcao', 'Direção da portabilidade fora da lista.'));
  if (!(MODALIDADES_PORTABILIDADE as readonly string[]).includes(x.modalidade))
    r.push(p('modalidade-invalida', 'modalidade', 'Modalidade da portabilidade fora da lista.'));
  if (!/^\d{6}$/.test(x.registroAnsOrigem))
    r.push(p('registro-ans-invalido', 'registroAnsOrigem', 'O registro da operadora na ANS tem 6 dígitos.'));
  if (!dataValida(x.solicitadoEm)) r.push(p('data-invalida', 'solicitadoEm', 'Data do pedido inválida.'));
  else if (x.solicitadoEm > x.hoje)
    r.push(p('data-futura', 'solicitadoEm', 'O pedido não pode ter data futura.'));
  if (x.vinculoInicio !== null) {
    if (!dataValida(x.vinculoInicio))
      r.push(p('data-invalida', 'vinculoInicio', 'Início do vínculo inválido.'));
    else if (dataValida(x.solicitadoEm) && x.vinculoInicio > x.solicitadoEm)
      r.push(p('vinculo-depois-do-pedido', 'vinculoInicio', 'O vínculo de origem começa antes do pedido.'));
  }
  return r;
}

const PASSOS_PORTABILIDADE: Readonly<Record<SituacaoPortabilidade, readonly SituacaoPortabilidade[]>> = {
  recebida: ['em_analise', 'aprovada', 'recusada', 'cancelada'],
  em_analise: ['aprovada', 'recusada', 'cancelada'],
  aprovada: [],
  recusada: [],
  cancelada: [],
};
export function passoDaPortabilidade(de: string, para: string): ProblemaDeclaracaoSaude | null {
  const permitidos = PASSOS_PORTABILIDADE[de as SituacaoPortabilidade];
  if (!permitidos) return p('situacao-invalida', 'situacao', 'Situação atual da portabilidade desconhecida.');
  return permitidos.includes(para as SituacaoPortabilidade)
    ? null
    : p('passo-invalido', 'situacao', 'Este passo não é permitido para a situação atual do pedido.');
}

export interface RequisitosPortabilidade {
  readonly modalidade: string;
  readonly vinculoInicio: string | null;
  readonly solicitadoEm: string;
  readonly adimplente: boolean;
  readonly faixaPrecoCompativel: boolean;
  readonly cumpriuCptNaOrigem: boolean;
  readonly jaPortouAntes: boolean;
}

/** Permanência mínima exigida em meses: 1 ano nas seguintes, 3 anos com CPT, 2 anos na primeira. */
export function permanenciaMinimaMeses(x: { cumpriuCptNaOrigem: boolean; jaPortouAntes: boolean }): number {
  if (x.jaPortouAntes) return PERMANENCIA_MINIMA_MESES.seguinte;
  return x.cumpriuCptNaOrigem ? PERMANENCIA_MINIMA_MESES.comCpt : PERMANENCIA_MINIMA_MESES.primeira;
}

/**
 * Os requisitos para aprovar (RN 438, art. 3º): adimplência; permanência mínima na origem; faixa de preço compatível
 * na ordinária (a especial e a extraordinária dispensam a faixa e a permanência).
 */
export function problemasDaAprovacaoPortabilidade(x: RequisitosPortabilidade): ProblemaDeclaracaoSaude[] {
  const r: ProblemaDeclaracaoSaude[] = [];
  if (!x.adimplente)
    r.push(p('inadimplente', 'adimplente', 'O beneficiário precisa estar em dia na origem.'));
  if (x.modalidade === 'ordinaria') {
    if (x.vinculoInicio === null)
      r.push(p('vinculo-obrigatorio', 'vinculoInicio', 'Informe o início do vínculo no plano de origem.'));
    else {
      const minimo = permanenciaMinimaMeses(x);
      if (mesesCompletos(x.vinculoInicio, x.solicitadoEm) < minimo)
        r.push(
          p(
            'permanencia-insuficiente',
            'vinculoInicio',
            `A permanência no plano de origem precisa de ${minimo} meses.`,
          ),
        );
    }
    if (!x.faixaPrecoCompativel)
      r.push(
        p(
          'faixa-incompativel',
          'faixaPrecoCompativel',
          'O plano de destino precisa ter faixa de preço compatível.',
        ),
      );
  }
  return r;
}

export interface CarenciaParaPortar {
  readonly id: number;
  readonly inicio: string;
  readonly dias: number;
}
/** Aprovada a portabilidade, toda carência é aproveitada: os dias aproveitados igualam o prazo e a cobertura vale do início. */
export function carenciasComPortabilidade(
  carencias: readonly CarenciaParaPortar[],
): { id: number; aproveitados: number; cumpridaEm: string }[] {
  return carencias.map((c) => ({ id: c.id, aproveitados: c.dias, cumpridaEm: c.inicio }));
}
