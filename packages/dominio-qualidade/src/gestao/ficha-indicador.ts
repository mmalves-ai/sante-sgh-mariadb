// Indicadores com ficha técnica, meta e análise crítica (M48, etapa 5; ficha, regra 9; cap-07 §7.5.3): a ficha tem
// nome, fórmula, numerador, denominador, fonte, periodicidade, meta, polaridade e responsável, e serve à ANAHP, à ONA e
// ao PM-QUALISS sem retrabalho. Os indicadores do censo vêm do M16 (a ficha de lá convertida aqui); os da qualidade
// (densidades das IRAS e utilização de dispositivo, da CCIH do M48.3; adesão à higiene das mãos) são declarados aqui.
// Fora da meta, a análise exige as causas, o plano, o responsável e o prazo.
import type {
  FichaIndicador,
  FichaIndicadorQualidade,
  RegistrarAnaliseIndicadorEntrada,
  SituacaoMetaQualidade,
} from '@sgh/contratos';
import { LINHAS_DE_CUIDADO } from '@sgh/contratos';
import { competenciaFechada, diasDaCompetenciaQualidade, duasCasas, numeroBr } from './comum.js';
import { FICHAS_SEGURANCA_PACIENTE, fichasDaLinha } from './indicadores-seguranca.js';

const CCIH = 'Comissão de controle de infecção hospitalar';
const HIGIENIZACAO = 'Coordenação da hotelaria (higienização)';
const REF_HIGIENIZACAO =
  'Anvisa, Segurança do paciente em serviços de saúde: limpeza e desinfecção de superfícies (2012); RDC 63/2011';
const PA = 'Coordenação do pronto atendimento';
const REF_PA =
  'CFM, Resolução 2.077/2014 (serviços hospitalares de urgência e emergência); ANS, QUALISS (indicadores hospitalares)';
const REF_IRAS = 'Anvisa, critérios diagnósticos das IRAS (2017) e Nota Técnica anual de notificação';

/** Programas por indicador do censo (D-QUALISS-48.5: o conjunto do PM-QUALISS a conferir com o leiaute do programa). */
const PROGRAMAS_CENSO: Readonly<Record<string, FichaIndicadorQualidade['programas']>> = {
  taxaOcupacao: ['anahp', 'ona', 'pmQualiss'],
  mediaPermanencia: ['anahp', 'ona', 'pmQualiss'],
  taxaMortalidadeInstitucional: ['anahp', 'ona', 'pmQualiss'],
  taxaReinternacao30: ['anahp', 'ona', 'pmQualiss'],
};

/** As fichas dos indicadores da qualidade (o valor vem das leituras da CCIH; a API faz a conta pelas parcelas). */
export const FICHAS_INDICADOR_QUALIDADE: readonly FichaIndicadorQualidade[] = [
  {
    codigo: 'densidadeIpcsCvc',
    nome: 'Densidade de infecção primária da corrente sanguínea associada a cateter venoso central',
    formula: 'IPCS associadas a CVC ÷ CVC-dia × 1.000',
    numerador: 'IPCS laboratoriais confirmadas associadas a CVC na competência',
    denominador: 'Cateter venoso central-dia na competência',
    fator: 1000,
    unidade: 'densidade',
    fonte: 'Fichas de IRAS e registro de dispositivos da CCIH',
    periodicidade: 'mensal',
    polaridade: 'menor-melhor',
    responsavel: CCIH,
    referencia: REF_IRAS,
    programas: ['anahp', 'ona', 'pmQualiss'],
    origem: 'qualidade',
  },
  {
    codigo: 'densidadeItuSvd',
    nome: 'Densidade de infecção do trato urinário associada a sonda vesical de demora',
    formula: 'ITU associadas a SVD ÷ SVD-dia × 1.000',
    numerador: 'ITU confirmadas associadas a SVD na competência',
    denominador: 'Sonda vesical de demora-dia na competência',
    fator: 1000,
    unidade: 'densidade',
    fonte: 'Fichas de IRAS e registro de dispositivos da CCIH',
    periodicidade: 'mensal',
    polaridade: 'menor-melhor',
    responsavel: CCIH,
    referencia: REF_IRAS,
    programas: ['anahp', 'ona', 'pmQualiss'],
    origem: 'qualidade',
  },
  {
    codigo: 'densidadePavVm',
    nome: 'Densidade de pneumonia associada à ventilação mecânica',
    formula: 'PAV ÷ ventilação mecânica-dia × 1.000',
    numerador: 'PAV confirmadas na competência',
    denominador: 'Ventilação mecânica-dia na competência',
    fator: 1000,
    unidade: 'densidade',
    fonte: 'Fichas de IRAS e registro de dispositivos da CCIH',
    periodicidade: 'mensal',
    polaridade: 'menor-melhor',
    responsavel: CCIH,
    referencia: REF_IRAS,
    programas: ['anahp', 'ona', 'pmQualiss'],
    origem: 'qualidade',
  },
  {
    codigo: 'utilizacaoCvc',
    nome: 'Taxa de utilização de cateter venoso central',
    formula: 'CVC-dia ÷ paciente-dia × 100',
    numerador: 'Cateter venoso central-dia na competência',
    denominador: 'Pacientes-dia do censo diário na competência',
    fator: 100,
    unidade: 'percentual',
    fonte: 'Registro de dispositivos da CCIH e censo diário',
    periodicidade: 'mensal',
    polaridade: 'neutra',
    responsavel: CCIH,
    referencia: REF_IRAS,
    programas: ['anahp', 'ona'],
    origem: 'qualidade',
  },
  {
    codigo: 'utilizacaoSvd',
    nome: 'Taxa de utilização de sonda vesical de demora',
    formula: 'SVD-dia ÷ paciente-dia × 100',
    numerador: 'Sonda vesical de demora-dia na competência',
    denominador: 'Pacientes-dia do censo diário na competência',
    fator: 100,
    unidade: 'percentual',
    fonte: 'Registro de dispositivos da CCIH e censo diário',
    periodicidade: 'mensal',
    polaridade: 'neutra',
    responsavel: CCIH,
    referencia: REF_IRAS,
    programas: ['anahp', 'ona'],
    origem: 'qualidade',
  },
  {
    codigo: 'utilizacaoVm',
    nome: 'Taxa de utilização de ventilação mecânica',
    formula: 'Ventilação mecânica-dia ÷ paciente-dia × 100',
    numerador: 'Ventilação mecânica-dia na competência',
    denominador: 'Pacientes-dia do censo diário na competência',
    fator: 100,
    unidade: 'percentual',
    fonte: 'Registro de dispositivos da CCIH e censo diário',
    periodicidade: 'mensal',
    polaridade: 'neutra',
    responsavel: CCIH,
    referencia: REF_IRAS,
    programas: ['anahp', 'ona'],
    origem: 'qualidade',
  },
  {
    codigo: 'adesaoHigieneMaos',
    nome: 'Taxa de adesão à higiene das mãos',
    formula: 'Oportunidades com higiene ÷ oportunidades observadas × 100',
    numerador: 'Oportunidades observadas em que houve a higiene das mãos',
    denominador: 'Oportunidades de higiene das mãos observadas na competência',
    fator: 100,
    unidade: 'percentual',
    fonte: 'Observações de adesão da CCIH (os cinco momentos da OMS)',
    periodicidade: 'mensal',
    polaridade: 'maior-melhor',
    responsavel: CCIH,
    referencia:
      'OMS, os cinco momentos para a higiene das mãos; Anvisa, protocolo de higiene das mãos (2013)',
    programas: ['anahp', 'ona'],
    origem: 'qualidade',
  },
  // W0-04 (M2): segurança do paciente; (M3): linhas de cuidado.
  ...FICHAS_SEGURANCA_PACIENTE,
  ...LINHAS_DE_CUIDADO.flatMap((l) => fichasDaLinha(l)),
  // W0-07 (M3): higienização e giro de leito. O valor vem das etapas gravadas da limpeza (SGH_HOT_LIMPEZA_ETAPA) pelo
  // cálculo de @sgh/dominio-hotelaria (o mesmo da tela da higienização, com os recortes por tipo, área e profissional).
  {
    codigo: 'tempoGiroLeito',
    nome: 'Tempo médio de giro do leito',
    formula: 'Soma dos minutos da solicitação da limpeza até o leito liberado ÷ limpezas liberadas',
    numerador:
      'Minutos, somados, da solicitação da limpeza até a liberação do leito, das liberadas na competência',
    denominador: 'Limpezas de leito liberadas na competência',
    fator: 1,
    unidade: 'minutos',
    fonte: 'Etapas da higienização (solicitação e liberação do leito)',
    periodicidade: 'mensal',
    polaridade: 'menor-melhor',
    responsavel: HIGIENIZACAO,
    referencia: REF_HIGIENIZACAO,
    programas: ['anahp', 'ona'],
    origem: 'higienizacao',
  },
  {
    codigo: 'higienizacaoNoPrazo',
    nome: 'Higienizações liberadas dentro do prazo',
    formula: 'Limpezas liberadas até o prazo ÷ limpezas liberadas com prazo × 100',
    numerador: 'Limpezas liberadas até o prazo do tipo de limpeza e da criticidade da área',
    denominador: 'Limpezas liberadas na competência com prazo registrado',
    fator: 100,
    unidade: 'percentual',
    fonte: 'Etapas da higienização (prazo por tipo de limpeza e criticidade da área, e a liberação)',
    periodicidade: 'mensal',
    polaridade: 'maior-melhor',
    responsavel: HIGIENIZACAO,
    referencia: REF_HIGIENIZACAO,
    programas: ['ona'],
    origem: 'higienizacao',
  },
  {
    codigo: 'tempoExecucaoLimpeza',
    nome: 'Tempo médio de execução da limpeza',
    formula: 'Soma dos minutos em execução (sem as pausas) ÷ limpezas liberadas',
    numerador: 'Minutos em execução, sem as pausas, das limpezas liberadas na competência',
    denominador: 'Limpezas de leito liberadas na competência',
    fator: 1,
    unidade: 'minutos',
    fonte: 'Etapas da higienização (início, pausas e conclusão da execução)',
    periodicidade: 'mensal',
    polaridade: 'menor-melhor',
    responsavel: HIGIENIZACAO,
    referencia: REF_HIGIENIZACAO,
    programas: ['ona'],
    origem: 'higienizacao',
  },
  // W0-07 (M2): o pronto atendimento. O valor vem das fichas do PA pelo cálculo de @sgh/dominio-atendimento
  // (totaisIndicadoresPaCatalogo: as mesmas parcelas das linhas exportáveis da tela de indicadores do atendimento).
  {
    codigo: 'retornoPa72h',
    nome: 'Retorno ao pronto atendimento em 72 horas',
    formula: 'Visitas ao PA com outra visita do mesmo paciente nas 72 horas anteriores ÷ visitas ao PA × 100',
    numerador:
      'Visitas ao PA na competência cujo paciente teve outra visita ao PA nas 72 horas anteriores (de 1 minuto a 72 horas)',
    denominador: 'Visitas ao PA na competência',
    fator: 100,
    unidade: 'percentual',
    fonte: 'Fichas do pronto atendimento (data e hora da ficha, paciente)',
    periodicidade: 'mensal',
    polaridade: 'menor-melhor',
    responsavel: PA,
    referencia: REF_PA,
    programas: ['anahp', 'ona'],
    origem: 'atendimento',
  },
  {
    codigo: 'internacaoViaPa',
    nome: 'Taxa de internação via pronto atendimento',
    formula: 'Atendimentos do PA que resultaram em internação ÷ atendimentos do PA × 100',
    numerador:
      'Atendimentos do PA na competência com desfecho de internação ou encaminhamento à internação (sem contar duas vezes)',
    denominador: 'Atendimentos do PA na competência',
    fator: 100,
    unidade: 'percentual',
    fonte: 'Fichas do pronto atendimento (desfecho e encaminhamento à internação)',
    periodicidade: 'mensal',
    polaridade: 'neutra',
    responsavel: PA,
    referencia: REF_PA,
    programas: ['anahp', 'ona'],
    origem: 'atendimento',
  },
];

/** A ficha do censo (M16) no formato da qualidade, com os programas que a usam. */
export function fichaDoCenso(f: FichaIndicador): FichaIndicadorQualidade {
  return {
    codigo: f.codigo,
    nome: f.nome,
    formula: f.formula,
    numerador: f.numerador.descricao,
    denominador: f.denominador?.descricao ?? null,
    fator: f.fator,
    unidade: f.unidade,
    fonte: f.fonte,
    periodicidade: 'mensal',
    polaridade: f.polaridade,
    responsavel: f.responsavel,
    referencia: f.referencia,
    programas: PROGRAMAS_CENSO[f.codigo] ?? ['anahp', 'ona'],
    origem: 'censo',
  };
}

/** Os campos que a ficha tem de ter preenchidos (regra 9); a lista vazia diz que a ficha está completa. */
export function faltasDaFicha(f: FichaIndicadorQualidade): string[] {
  const faltas: string[] = [];
  const texto = (v: string | null, nome: string, permiteNulo = false) => {
    if (v === null ? !permiteNulo : v.trim().length < 3) faltas.push(nome);
  };
  texto(f.nome, 'nome');
  texto(f.formula, 'fórmula');
  texto(f.numerador, 'numerador');
  // Contagem e mediana (minutos) não têm denominador.
  texto(f.denominador, 'denominador', f.unidade === 'quantidade' || f.unidade === 'minutos');
  texto(f.fonte, 'fonte');
  texto(f.responsavel, 'responsável');
  texto(f.referencia, 'referência');
  if (!(f.fator > 0)) faltas.push('fator');
  if (f.programas.length === 0) faltas.push('programas');
  return faltas;
}

/** O valor pelas parcelas (nulo sem denominador positivo; o de contagem é o numerador). */
export function valorPelasParcelas(
  numerador: number,
  denominador: number | null,
  fator: number,
): number | null {
  if (denominador === null) return numerador;
  return denominador > 0 ? duasCasas((numerador / denominador) * fator) : null;
}

/** A conta com as parcelas impressas (ex.: "3 ÷ 1.250 × 1.000 = 2,4"). */
export function contaDoIndicador(
  numerador: number,
  denominador: number | null,
  fator: number,
): string | null {
  const v = valorPelasParcelas(numerador, denominador, fator);
  if (v === null) return null;
  if (denominador === null) return `${numeroBr(numerador)} = ${numeroBr(v)}`;
  return `${numeroBr(numerador)} ÷ ${numeroBr(denominador)} × ${numeroBr(fator, 0)} = ${numeroBr(v)}`;
}

/** Situação do valor perante a meta, pela polaridade (faixa e neutra não têm meta de um lado só). */
export function situacaoMetaQualidade(
  polaridade: FichaIndicadorQualidade['polaridade'],
  meta: number | null,
  valor: number | null,
): SituacaoMetaQualidade {
  if (valor === null) return 'sem-valor';
  if (meta === null || polaridade === 'faixa' || polaridade === 'neutra') return 'sem-meta';
  if (polaridade === 'maior-melhor') return valor >= meta ? 'na-meta' : 'fora-da-meta';
  return valor <= meta ? 'na-meta' : 'fora-da-meta';
}

export type RecusaAnaliseIndicador =
  | 'competencia-aberta'
  | 'analise-ja-registrada'
  | 'analise-inexistente'
  | 'versao-desatualizada'
  | 'plano-obrigatorio'
  | 'prazo-antes-da-competencia'
  | 'indicador-inexistente'
  | 'sem-valor';

/**
 * A análise crítica: só de competência terminada, com valor apurado; uma por indicador e competência (a segunda
 * altera, com a versão); fora da meta, causas, plano, responsável e prazo, e o prazo depois do fim da competência.
 */
export function recusaAnaliseIndicador(e: {
  readonly entrada: Pick<
    RegistrarAnaliseIndicadorEntrada,
    'analise' | 'versao' | 'competencia' | 'causas' | 'plano' | 'responsavel' | 'prazo'
  >;
  readonly situacaoMeta: SituacaoMetaQualidade;
  readonly existente: { readonly id: number; readonly versao: number } | null;
  readonly agora: string;
}): RecusaAnaliseIndicador | null {
  const { entrada: a } = e;
  if (!competenciaFechada(a.competencia, e.agora)) return 'competencia-aberta';
  if (e.situacaoMeta === 'sem-valor') return 'sem-valor';
  if (a.analise === null && e.existente) return 'analise-ja-registrada';
  if (a.analise !== null) {
    if (!e.existente || e.existente.id !== a.analise) return 'analise-inexistente';
    if (e.existente.versao !== a.versao) return 'versao-desatualizada';
  }
  if (e.situacaoMeta === 'fora-da-meta') {
    const ok = (v: string | null, min: number) => (v?.trim().length ?? 0) >= min;
    if (!ok(a.causas, 10) || !ok(a.plano, 10) || !ok(a.responsavel, 3) || a.prazo === null)
      return 'plano-obrigatorio';
  }
  if (a.prazo !== null && a.prazo <= diasDaCompetenciaQualidade(a.competencia).ate)
    return 'prazo-antes-da-competencia';
  return null;
}

/** A análise está devida: competência terminada sem análise, ou fora da meta sem plano. */
export function analisePendente(e: {
  readonly competencia: string;
  readonly agora: string;
  readonly situacaoMeta: SituacaoMetaQualidade;
  readonly analise: { readonly plano: string | null } | null;
}): boolean {
  if (!competenciaFechada(e.competencia, e.agora) || e.situacaoMeta === 'sem-valor') return false;
  if (!e.analise) return true;
  return e.situacaoMeta === 'fora-da-meta' && !e.analise.plano;
}
