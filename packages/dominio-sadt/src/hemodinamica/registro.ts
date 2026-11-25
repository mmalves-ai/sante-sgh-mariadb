// Registro estruturado do exame de hemodinâmica (cateterismo e angiografia) feito na sala de hemodinâmica ou no centro
// cirúrgico (F8, 04-CC linha 107). O registro executa um exame pedido (item do pedido do serviço de apoio ao
// diagnóstico e terapia) e guarda o acesso, o contraste, os indicadores de dose de radiação, a função ventricular, a
// equipe e os achados por vaso. A regra é a mesma na tela (validação na hora) e no servidor (antes de gravar):
//   - rascunho: o que foi preenchido tem de estar coerente (via válida, primeiro operador, tempos em ordem, faixas);
//   - conclusão: além disso, fim do procedimento, hemostasia, conclusão, conduta, ao menos um achado e os indicadores
//     de dose do procedimento intervencionista guiado por fluoroscopia (tempo de fluoroscopia e kerma no ponto de
//     referência ou produto dose-área), como pede a RDC Anvisa 611/2022 para o registro da exposição do paciente.
// Os alertas apontam a dose substancial de radiação (kerma de referência a partir de 5 Gy ou produto dose-área a
// partir de 500 Gy·cm², limiares do NCRP 168 adotados para o seguimento de reação tecidual na pele), a fluoroscopia
// prolongada, o volume alto de contraste e a lesão do tronco da coronária esquerda.

export const VIAS_ACESSO_HEMODINAMICA = [
  'radial_direita',
  'radial_esquerda',
  'femoral_direita',
  'femoral_esquerda',
  'braquial',
  'ulnar',
  'outra',
] as const;
export const ANESTESIAS_HEMODINAMICA = ['local', 'sedacao', 'geral'] as const;
export const DOMINANCIAS_CORONARIAS = ['direita', 'esquerda', 'balanceada'] as const;
export const HEMOSTASIAS_HEMODINAMICA = [
  'compressao_manual',
  'pulseira_compressiva',
  'dispositivo_oclusao',
  'outra',
] as const;
export const CONDUTAS_HEMODINAMICA = [
  'tratamento_clinico',
  'angioplastia',
  'cirurgia',
  'reavaliacao',
  'outra',
] as const;
export const TIPOS_ACHADO_HEMODINAMICA = [
  'normal',
  'estenose',
  'oclusao',
  'ectasia',
  'aneurisma',
  'ponte_miocardica',
  'trombo',
  'dissecacao',
  'stent_previo',
  'reestenose',
  'outro',
] as const;
export const CALCIFICACOES_HEMODINAMICA = ['ausente', 'leve', 'moderada', 'grave'] as const;
export const CONDUTAS_ACHADO_HEMODINAMICA = [
  'nenhuma',
  'tratamento_clinico',
  'angioplastia',
  'cirurgia',
] as const;

export type ViaAcessoHemodinamica = (typeof VIAS_ACESSO_HEMODINAMICA)[number];
export type TipoAchadoHemodinamica = (typeof TIPOS_ACHADO_HEMODINAMICA)[number];

/** Limiares dos alertas (NCRP 168 para a dose substancial; volume de contraste e fluoroscopia por prática clínica). */
export const LIMIARES_HEMODINAMICA = {
  kermaSubstancialMgy: 5000,
  produtoDoseAreaSubstancialGycm2: 500,
  fluoroscopiaProlongadaSegundos: 3600,
  contrasteElevadoMl: 300,
  lesaoSignificativa: 70,
  lesaoSignificativaTronco: 50,
  duracaoMaximaHoras: 24,
} as const;

export interface AchadoHemodinamica {
  readonly vaso: string;
  readonly segmento: string | null;
  readonly tipo: string;
  readonly grauPercentual: number | null;
  readonly fluxoTimi: number | null;
  readonly calcificacao: string | null;
  readonly comprimentoMm: number | null;
  readonly bifurcacao: boolean;
  readonly conduta: string | null;
  readonly stentImplantado: boolean;
  readonly observacao: string | null;
}

export interface RegistroHemodinamica {
  readonly inicioEm: string | null;
  readonly fimEm: string | null;
  readonly viaAcesso: string | null;
  readonly introdutorFrench: number | null;
  readonly anestesia: string | null;
  readonly contrasteNome: string | null;
  readonly contrasteVolumeMl: number | null;
  readonly heparinaUi: number | null;
  readonly tempoFluoroscopiaSegundos: number | null;
  readonly kermaReferenciaMgy: number | null;
  readonly produtoDoseAreaGycm2: number | null;
  readonly dominancia: string | null;
  readonly fracaoEjecao: number | null;
  readonly pressaoDiastolicaFinalVe: number | null;
  readonly hemostasia: string | null;
  readonly complicacoes: string | null;
  readonly conclusao: string | null;
  readonly condutaIndicada: string | null;
  readonly primeiroOperador: number | null;
  readonly segundoOperador: number | null;
  readonly anestesista: number | null;
  readonly achados: readonly AchadoHemodinamica[];
}

export interface ProblemaHemodinamica {
  readonly campo: string;
  readonly mensagem: string;
}

export type ModoConferencia = 'rascunho' | 'concluir';

const vazio = (v: string | null | undefined) => v === null || v === undefined || v.trim() === '';
const instante = (v: string | null) => (v ? Date.parse(v) : Number.NaN);
const em = <T extends string>(lista: readonly T[], v: string | null): boolean =>
  v === null || (lista as readonly string[]).includes(v);
const foraDe = (v: number | null, min: number, max: number) =>
  v !== null && (!Number.isFinite(v) || v < min || v > max);

/** O vaso é o tronco da coronária esquerda (a lesão significativa ali começa em 50%). */
export const ehTronco = (vaso: string): boolean =>
  /\btronco\b|\btce\b/i.test(vaso.normalize('NFD').replace(/[̀-ͯ]/g, ''));

function conferirAchado(a: AchadoHemodinamica, i: number): ProblemaHemodinamica[] {
  const p: ProblemaHemodinamica[] = [];
  const c = (campo: string, mensagem: string) =>
    p.push({ campo: `achados.${i}.${campo}`, mensagem: `Achado ${i + 1}: ${mensagem}` });
  if (vazio(a.vaso)) c('vaso', 'informe o vaso.');
  else if (a.vaso.trim().length > 60) c('vaso', 'o vaso tem no máximo 60 caracteres.');
  if (a.segmento && a.segmento.trim().length > 60) c('segmento', 'o segmento tem no máximo 60 caracteres.');
  if (!em(TIPOS_ACHADO_HEMODINAMICA, a.tipo)) c('tipo', 'tipo de achado inválido.');
  if (foraDe(a.grauPercentual, 0, 100)) c('grauPercentual', 'o grau da lesão vai de 0 a 100%.');
  if (a.tipo === 'estenose' || a.tipo === 'reestenose') {
    if (a.grauPercentual === null) c('grauPercentual', 'a estenose exige o grau da lesão.');
    else if (a.grauPercentual <= 0 || a.grauPercentual >= 100)
      c('grauPercentual', 'estenose vai de 1 a 99%; 100% é oclusão.');
  }
  if (a.tipo === 'oclusao' && a.grauPercentual !== null && a.grauPercentual !== 100)
    c('grauPercentual', 'oclusão é lesão de 100%.');
  if (a.tipo === 'normal' && a.grauPercentual !== null && a.grauPercentual > 0)
    c('grauPercentual', 'vaso normal não tem grau de lesão.');
  if (a.fluxoTimi !== null && (!Number.isInteger(a.fluxoTimi) || a.fluxoTimi < 0 || a.fluxoTimi > 3))
    c('fluxoTimi', 'o fluxo TIMI vai de 0 a 3.');
  if (a.tipo === 'oclusao' && a.fluxoTimi !== null && a.fluxoTimi > 1)
    c('fluxoTimi', 'oclusão tem fluxo TIMI 0 ou 1.');
  if (!em(CALCIFICACOES_HEMODINAMICA, a.calcificacao)) c('calcificacao', 'calcificação inválida.');
  if (foraDe(a.comprimentoMm, 0.1, 200)) c('comprimentoMm', 'o comprimento vai de 0,1 a 200 mm.');
  if (!em(CONDUTAS_ACHADO_HEMODINAMICA, a.conduta)) c('conduta', 'conduta do achado inválida.');
  if (a.stentImplantado && a.conduta !== 'angioplastia')
    c('stentImplantado', 'stent implantado exige a conduta angioplastia no achado.');
  if (a.stentImplantado && a.tipo === 'normal') c('stentImplantado', 'vaso normal não recebe stent.');
  if (a.observacao && a.observacao.length > 500)
    c('observacao', 'a observação tem no máximo 500 caracteres.');
  return p;
}

/**
 * Confere o registro. No rascunho, só a coerência do que foi preenchido (e o mínimo para abrir: via de acesso, início
 * e primeiro operador); na conclusão, também o que o laudo exige, inclusive os indicadores de dose (RDC 611/2022).
 */
export function conferirRegistroHemodinamica(
  r: RegistroHemodinamica,
  modo: ModoConferencia,
): ProblemaHemodinamica[] {
  const p: ProblemaHemodinamica[] = [];
  const c = (campo: string, mensagem: string) => p.push({ campo, mensagem });
  const concluir = modo === 'concluir';

  if (vazio(r.viaAcesso)) c('viaAcesso', 'Informe a via de acesso.');
  else if (!em(VIAS_ACESSO_HEMODINAMICA, r.viaAcesso)) c('viaAcesso', 'Via de acesso inválida.');
  if (r.primeiroOperador === null) c('primeiroOperador', 'Informe o primeiro operador.');
  if (r.segundoOperador !== null && r.segundoOperador === r.primeiroOperador)
    c('segundoOperador', 'O segundo operador tem de ser outra pessoa.');
  if (!em(ANESTESIAS_HEMODINAMICA, r.anestesia)) c('anestesia', 'Tipo de anestesia inválido.');
  if (r.anestesia === 'geral' && r.anestesista === null)
    c('anestesista', 'Anestesia geral exige o anestesista.');
  if (r.anestesista !== null && r.anestesista === r.primeiroOperador)
    c('anestesista', 'O anestesista não pode ser o primeiro operador.');

  const ini = instante(r.inicioEm);
  const fim = instante(r.fimEm);
  if (!r.inicioEm) c('inicioEm', 'Informe o início do procedimento.');
  else if (Number.isNaN(ini)) c('inicioEm', 'Início inválido.');
  if (r.fimEm && Number.isNaN(fim)) c('fimEm', 'Fim inválido.');
  if (!Number.isNaN(ini) && !Number.isNaN(fim)) {
    if (fim < ini) c('fimEm', 'O fim não pode ser antes do início.');
    else if (fim - ini > LIMIARES_HEMODINAMICA.duracaoMaximaHoras * 3_600_000)
      c('fimEm', 'O procedimento não passa de 24 horas: confira o início e o fim.');
  }

  if (foraDe(r.introdutorFrench, 3, 24)) c('introdutorFrench', 'O introdutor vai de 3 a 24 French.');
  if (r.contrasteNome && r.contrasteNome.length > 100)
    c('contrasteNome', 'Contraste com até 100 caracteres.');
  if (foraDe(r.contrasteVolumeMl, 0, 2000)) c('contrasteVolumeMl', 'Volume de contraste de 0 a 2000 mL.');
  if (r.contrasteVolumeMl !== null && r.contrasteVolumeMl > 0 && vazio(r.contrasteNome))
    c('contrasteNome', 'Informe o contraste usado.');
  if (foraDe(r.heparinaUi, 0, 100_000)) c('heparinaUi', 'Heparina de 0 a 100.000 UI.');
  if (foraDe(r.tempoFluoroscopiaSegundos, 0, 86_400))
    c('tempoFluoroscopiaSegundos', 'Tempo de fluoroscopia inválido.');
  if (foraDe(r.kermaReferenciaMgy, 0, 100_000)) c('kermaReferenciaMgy', 'Kerma de referência inválido.');
  if (foraDe(r.produtoDoseAreaGycm2, 0, 100_000)) c('produtoDoseAreaGycm2', 'Produto dose-área inválido.');
  if (!em(DOMINANCIAS_CORONARIAS, r.dominancia)) c('dominancia', 'Dominância inválida.');
  if (foraDe(r.fracaoEjecao, 0, 100)) c('fracaoEjecao', 'A fração de ejeção vai de 0 a 100%.');
  if (foraDe(r.pressaoDiastolicaFinalVe, 0, 80))
    c('pressaoDiastolicaFinalVe', 'A pressão diastólica final vai de 0 a 80 mmHg.');
  if (!em(HEMOSTASIAS_HEMODINAMICA, r.hemostasia)) c('hemostasia', 'Hemostasia inválida.');
  if (!em(CONDUTAS_HEMODINAMICA, r.condutaIndicada)) c('condutaIndicada', 'Conduta inválida.');

  const chaves = new Set<string>();
  r.achados.forEach((a, i) => {
    p.push(...conferirAchado(a, i));
    const k = `${a.vaso.trim().toLowerCase()}|${(a.segmento ?? '').trim().toLowerCase()}`;
    if (!vazio(a.vaso) && chaves.has(k))
      c(`achados.${i}.segmento`, `Achado ${i + 1}: vaso e segmento repetidos; junte num achado só.`);
    chaves.add(k);
  });

  if (concluir) {
    if (!r.fimEm) c('fimEm', 'Informe o fim do procedimento para concluir.');
    if (vazio(r.hemostasia)) c('hemostasia', 'Informe a hemostasia do acesso para concluir.');
    if (vazio(r.conclusao)) c('conclusao', 'Escreva a conclusão para concluir.');
    if (vazio(r.condutaIndicada)) c('condutaIndicada', 'Informe a conduta indicada para concluir.');
    if (!r.achados.length) c('achados', 'Registre ao menos um achado (ou o vaso normal) para concluir.');
    if (r.tempoFluoroscopiaSegundos === null)
      c('tempoFluoroscopiaSegundos', 'Registre o tempo de fluoroscopia (RDC Anvisa 611/2022).');
    if (r.kermaReferenciaMgy === null && r.produtoDoseAreaGycm2 === null)
      c('kermaReferenciaMgy', 'Registre o kerma de referência ou o produto dose-área (RDC Anvisa 611/2022).');
    if (r.achados.some((a) => a.conduta === 'angioplastia') && r.condutaIndicada === 'tratamento_clinico')
      c('condutaIndicada', 'Há achado com angioplastia: a conduta não pode ser só tratamento clínico.');
  }
  return p;
}

export type CodigoAlertaHemodinamica =
  'dose-substancial' | 'fluoroscopia-prolongada' | 'contraste-elevado' | 'lesao-tronco';

/** Os alertas clínicos do registro (não impedem gravar; a dose substancial pede o seguimento da pele). */
export function alertasHemodinamica(r: RegistroHemodinamica): CodigoAlertaHemodinamica[] {
  const l = LIMIARES_HEMODINAMICA;
  const a: CodigoAlertaHemodinamica[] = [];
  if (
    (r.kermaReferenciaMgy ?? 0) >= l.kermaSubstancialMgy ||
    (r.produtoDoseAreaGycm2 ?? 0) >= l.produtoDoseAreaSubstancialGycm2
  )
    a.push('dose-substancial');
  if ((r.tempoFluoroscopiaSegundos ?? 0) >= l.fluoroscopiaProlongadaSegundos)
    a.push('fluoroscopia-prolongada');
  if ((r.contrasteVolumeMl ?? 0) > l.contrasteElevadoMl) a.push('contraste-elevado');
  if (
    r.achados.some(
      (x) =>
        ehTronco(x.vaso) && (x.tipo === 'oclusao' || (x.grauPercentual ?? 0) >= l.lesaoSignificativaTronco),
    )
  )
    a.push('lesao-tronco');
  return a;
}

/** A lesão é significativa: oclusão, ou estenose a partir de 70% (50% no tronco da coronária esquerda). */
export function lesaoSignificativa(a: AchadoHemodinamica): boolean {
  if (a.tipo === 'oclusao') return true;
  if (a.tipo !== 'estenose' && a.tipo !== 'reestenose') return false;
  const g = a.grauPercentual ?? 0;
  return (
    g >=
    (ehTronco(a.vaso)
      ? LIMIARES_HEMODINAMICA.lesaoSignificativaTronco
      : LIMIARES_HEMODINAMICA.lesaoSignificativa)
  );
}

/** Quantos vasos (distintos) têm lesão significativa: uniarterial, biarterial ou triarterial no laudo. */
export function vasosComLesaoSignificativa(achados: readonly AchadoHemodinamica[]): number {
  return new Set(achados.filter(lesaoSignificativa).map((a) => a.vaso.trim().toLowerCase())).size;
}

/** O achado mudou (a correção grava linha nova; a anterior fica no histórico com a marca de exclusão). */
export function achadoMudou(a: AchadoHemodinamica, b: AchadoHemodinamica): boolean {
  const n = (v: string | null) => (v ?? '').trim();
  return (
    n(a.vaso) !== n(b.vaso) ||
    n(a.segmento) !== n(b.segmento) ||
    a.tipo !== b.tipo ||
    a.grauPercentual !== b.grauPercentual ||
    a.fluxoTimi !== b.fluxoTimi ||
    n(a.calcificacao) !== n(b.calcificacao) ||
    a.comprimentoMm !== b.comprimentoMm ||
    a.bifurcacao !== b.bifurcacao ||
    n(a.conduta) !== n(b.conduta) ||
    a.stentImplantado !== b.stentImplantado ||
    n(a.observacao) !== n(b.observacao)
  );
}
