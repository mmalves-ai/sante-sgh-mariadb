// Fichas técnicas dos indicadores hospitalares (M16; regra 11; cap-07 §7.5.3): nome, fórmula, numerador,
// denominador, fonte, periodicidade, polaridade, responsável e versão, versionadas aqui. A meta é parâmetro do
// sistema novo (`relatorio.meta.<código>`, M08), definida pela diretoria e pela qualidade na validação. Mudou a
// fórmula: sobe a versão. Referências: Portaria SAS/MS 312/2002 (padronização da nomenclatura do censo
// hospitalar) e o caderno de indicadores da ANAHP.
import { CODIGOS_INDICADOR, esquemaFichaIndicador, type FichaIndicador } from '@sgh/contratos';

const P312 = 'Portaria SAS/MS 312/2002';
const ANAHP = 'ANAHP (caderno de indicadores)';
const FONTE_CENSO =
  'Censo diário calculado da trajetória do paciente (trechos de leito), na hora de fechamento única do estabelecimento';
const FONTE_SAIDAS =
  'Saídas do período (altas de todos os motivos, inclusive óbitos e transferências externas)';
const LIMITACAO_LEITO =
  'O leito-dia operacional usa a situação ATUAL de cada leito: o cadastro do estabelecimento não guarda o histórico de bloqueio (até a Fase 2).';

export const FICHAS: readonly FichaIndicador[] = [
  {
    codigo: 'taxaOcupacao',
    nome: 'Taxa de ocupação hospitalar',
    formula: 'paciente-dia ÷ leito-dia operacional × 100',
    numerador: {
      grandeza: 'pacientesDia',
      descricao: 'Pacientes-dia: soma dos internados na hora de fechamento',
    },
    denominador: {
      grandeza: 'leitosDia',
      descricao: 'Leitos-dia operacionais: leitos ativos × dias do período',
    },
    fator: 100,
    unidade: 'percentual',
    fonte: FONTE_CENSO,
    referencia: P312,
    periodicidade: 'mensal',
    polaridade: 'maior-melhor',
    responsavel: 'coordenação de leitos',
    versao: 1,
    limitacoes: [LIMITACAO_LEITO],
    recortes: ['acomodacao', 'tipoAcomodacao'],
  },
  {
    codigo: 'taxaOcupacaoIntensiva',
    nome: 'Taxa de ocupação da terapia intensiva',
    formula: 'paciente-dia em terapia intensiva ÷ leito-dia operacional de terapia intensiva × 100',
    numerador: {
      grandeza: 'pacientesDiaIntensiva',
      descricao: 'Pacientes-dia em trecho de leito de tipo de terapia intensiva',
    },
    denominador: {
      grandeza: 'leitosDiaIntensiva',
      descricao: 'Leitos-dia operacionais das acomodações de terapia intensiva',
    },
    fator: 100,
    unidade: 'percentual',
    fonte: `${FONTE_CENSO}; terapia intensiva pelo tipo de acomodação do trecho (parâmetro internacao.acomodacao.intensiva)`,
    referencia: `${P312}; ${ANAHP}`,
    periodicidade: 'mensal',
    polaridade: 'maior-melhor',
    responsavel: 'coordenação da terapia intensiva',
    versao: 1,
    limitacoes: [LIMITACAO_LEITO],
    recortes: [],
  },
  {
    codigo: 'mediaPermanencia',
    nome: 'Média de permanência (Portaria 312)',
    formula: 'paciente-dia ÷ saídas',
    numerador: { grandeza: 'pacientesDia', descricao: 'Pacientes-dia do período' },
    denominador: { grandeza: 'saidas', descricao: FONTE_SAIDAS },
    fator: 1,
    unidade: 'dias',
    fonte: FONTE_CENSO,
    referencia: P312,
    periodicidade: 'mensal',
    polaridade: 'menor-melhor',
    responsavel: 'diretoria clínica',
    versao: 1,
    limitacoes: [
      'Não é a média de diárias faturadas (outra régua, com nome próprio): as diárias contam a entrada e a alta.',
    ],
    recortes: ['acomodacao', 'tipoAcomodacao', 'clinica'],
  },
  {
    codigo: 'mediaDiariasFaturadas',
    nome: 'Média de diárias faturáveis por saída',
    formula: 'diárias faturáveis das saídas ÷ saídas',
    numerador: {
      grandeza: 'diariasFaturadas',
      descricao: 'Diárias faturáveis das internações que saíram (a régua do faturamento)',
    },
    denominador: { grandeza: 'saidas', descricao: FONTE_SAIDAS },
    fator: 1,
    unidade: 'dias',
    fonte: 'Diárias faturáveis gravadas na internação (a entrada e a alta contam)',
    referencia: 'Régua do faturamento (ficha do M16, regra 6)',
    periodicidade: 'mensal',
    polaridade: 'neutra',
    responsavel: 'faturamento',
    versao: 1,
    limitacoes: [
      'Um dia a mais que a diferença de datas em cerca de metade das internações: não comparar com a média de permanência da Portaria 312.',
    ],
    recortes: ['acomodacao', 'tipoAcomodacao', 'clinica'],
  },
  {
    codigo: 'mediaPacientesDia',
    nome: 'Média de pacientes-dia (censo médio diário)',
    formula: 'paciente-dia ÷ dias do período',
    numerador: { grandeza: 'pacientesDia', descricao: 'Pacientes-dia do período' },
    denominador: { grandeza: 'dias', descricao: 'Dias do período (o mês corrente até o dia em curso)' },
    fator: 1,
    unidade: 'razao',
    fonte: FONTE_CENSO,
    referencia: P312,
    periodicidade: 'mensal',
    polaridade: 'neutra',
    responsavel: 'coordenação de leitos',
    versao: 1,
    limitacoes: [],
    recortes: ['acomodacao', 'tipoAcomodacao', 'clinica'],
  },
  {
    codigo: 'giroLeito',
    nome: 'Índice de rotatividade (giro do leito)',
    formula: 'saídas ÷ leitos operacionais',
    numerador: { grandeza: 'saidas', descricao: FONTE_SAIDAS },
    denominador: {
      grandeza: 'leitosOperacionaisMedios',
      descricao: 'Leitos operacionais (ativos) no período',
    },
    fator: 1,
    unidade: 'razao',
    fonte: FONTE_CENSO,
    referencia: P312,
    periodicidade: 'mensal',
    polaridade: 'maior-melhor',
    responsavel: 'coordenação de leitos',
    versao: 1,
    limitacoes: [LIMITACAO_LEITO],
    recortes: ['acomodacao', 'tipoAcomodacao'],
  },
  {
    codigo: 'intervaloSubstituicao',
    nome: 'Intervalo de substituição',
    formula: '(leito-dia operacional − paciente-dia) ÷ saídas',
    numerador: {
      grandeza: 'leitosDiaOciosos',
      descricao: 'Leitos-dia sem paciente (leito-dia − paciente-dia)',
    },
    denominador: { grandeza: 'saidas', descricao: FONTE_SAIDAS },
    fator: 1,
    unidade: 'dias',
    fonte: FONTE_CENSO,
    referencia: P312,
    periodicidade: 'mensal',
    polaridade: 'menor-melhor',
    responsavel: 'coordenação de leitos',
    versao: 1,
    limitacoes: [LIMITACAO_LEITO],
    recortes: ['acomodacao', 'tipoAcomodacao'],
  },
  {
    codigo: 'taxaMortalidadeGeral',
    nome: 'Taxa de mortalidade geral',
    formula: 'óbitos ÷ saídas × 100',
    numerador: { grandeza: 'obitos', descricao: 'Saídas por óbito (grupo do motivo de alta)' },
    denominador: { grandeza: 'saidas', descricao: FONTE_SAIDAS },
    fator: 100,
    unidade: 'percentual',
    fonte: 'Motivo de alta agrupado pelo grupo do indicador (óbito 40 a 46, 52 a 54 e 65 a 67)',
    referencia: P312,
    periodicidade: 'mensal',
    polaridade: 'menor-melhor',
    responsavel: 'comissão de óbitos',
    versao: 1,
    limitacoes: [],
    recortes: ['acomodacao', 'tipoAcomodacao', 'clinica'],
  },
  {
    codigo: 'taxaMortalidadeInstitucional',
    nome: 'Taxa de mortalidade institucional',
    formula: 'óbitos após 24 horas da internação ÷ saídas × 100',
    numerador: {
      grandeza: 'obitosInstitucionais',
      descricao: 'Saídas por óbito com 24 horas ou mais de internação',
    },
    denominador: { grandeza: 'saidas', descricao: FONTE_SAIDAS },
    fator: 100,
    unidade: 'percentual',
    fonte: 'Motivo de alta e as horas de entrada e de alta da internação',
    referencia: P312,
    periodicidade: 'mensal',
    polaridade: 'menor-melhor',
    responsavel: 'comissão de óbitos',
    versao: 1,
    limitacoes: [],
    recortes: ['acomodacao', 'tipoAcomodacao', 'clinica'],
  },
  {
    codigo: 'taxaReinternacao7',
    nome: 'Taxa de reinternação em até 7 dias',
    formula: 'saídas vivas com nova internação do mesmo paciente em até 7 dias ÷ saídas vivas × 100',
    numerador: {
      grandeza: 'reinternacoes7',
      descricao: 'Saídas vivas seguidas de nova internação em até 7 dias',
    },
    denominador: { grandeza: 'saidasVivas', descricao: 'Saídas do período menos os óbitos' },
    fator: 100,
    unidade: 'percentual',
    fonte: 'Calculada pelas internações do mesmo paciente (a marca de reinternação gravada não é usada)',
    referencia: ANAHP,
    periodicidade: 'mensal',
    polaridade: 'menor-melhor',
    responsavel: 'qualidade',
    versao: 1,
    limitacoes: ['Só reinternações no mesmo estabelecimento (o consolidado da rede é do M57).'],
    recortes: ['acomodacao', 'tipoAcomodacao', 'clinica'],
  },
  {
    codigo: 'taxaReinternacao30',
    nome: 'Taxa de reinternação em até 30 dias',
    formula: 'saídas vivas com nova internação do mesmo paciente em até 30 dias ÷ saídas vivas × 100',
    numerador: {
      grandeza: 'reinternacoes30',
      descricao: 'Saídas vivas seguidas de nova internação em até 30 dias',
    },
    denominador: { grandeza: 'saidasVivas', descricao: 'Saídas do período menos os óbitos' },
    fator: 100,
    unidade: 'percentual',
    fonte: 'Calculada pelas internações do mesmo paciente (a marca de reinternação gravada não é usada)',
    referencia: ANAHP,
    periodicidade: 'mensal',
    polaridade: 'menor-melhor',
    responsavel: 'qualidade',
    versao: 1,
    limitacoes: [
      'Só reinternações no mesmo estabelecimento (o consolidado da rede é do M57).',
      'Os últimos 30 dias do período ainda podem ganhar reinternações (o mês corrente é parcial).',
    ],
    recortes: ['acomodacao', 'tipoAcomodacao', 'clinica'],
  },
  {
    codigo: 'admissoes',
    nome: 'Internações (admissões)',
    formula: 'número de internações iniciadas no período',
    numerador: { grandeza: 'admissoes', descricao: 'Internações com entrada no período' },
    denominador: null,
    fator: 1,
    unidade: 'quantidade',
    fonte: 'Entrada da internação (unidade do primeiro trecho de leito)',
    referencia: P312,
    periodicidade: 'mensal',
    polaridade: 'neutra',
    responsavel: 'coordenação de leitos',
    versao: 1,
    limitacoes: [],
    recortes: ['acomodacao', 'tipoAcomodacao', 'clinica'],
  },
  {
    codigo: 'percentualUrgencia',
    nome: 'Internações de urgência',
    formula: 'internações de caráter urgência ÷ internações × 100',
    numerador: { grandeza: 'admissoesUrgencia', descricao: 'Internações de caráter urgência' },
    denominador: { grandeza: 'admissoes', descricao: 'Internações com entrada no período' },
    fator: 100,
    unidade: 'percentual',
    fonte: 'Caráter da internação gravado na entrada',
    referencia: ANAHP,
    periodicidade: 'mensal',
    polaridade: 'neutra',
    responsavel: 'diretoria clínica',
    versao: 1,
    limitacoes: [],
    recortes: ['acomodacao', 'tipoAcomodacao', 'clinica'],
  },
];

/** Problemas de uma ficha (o validador da regra 11); lista vazia = válida. */
export function validarFicha(f: unknown): string[] {
  const r = esquemaFichaIndicador.safeParse(f);
  if (!r.success) return r.error.issues.map((i) => `${i.path.join('.') || 'ficha'}: ${i.message}`);
  const x = r.data;
  const p: string[] = [];
  if (x.unidade === 'quantidade' && x.denominador !== null)
    p.push('indicador de quantidade não tem denominador');
  if (x.unidade !== 'quantidade' && x.denominador === null) p.push('indicador sem denominador');
  if (x.unidade === 'percentual' && x.fator !== 100) p.push('percentual com fator diferente de 100');
  if (x.unidade !== 'percentual' && x.fator !== 1) p.push('fator só nos percentuais');
  const usaLeito = [x.numerador.grandeza, x.denominador?.grandeza].some((g) =>
    ['leitosDia', 'leitosDiaIntensiva', 'leitosOperacionaisMedios', 'leitosDiaOciosos'].includes(g ?? ''),
  );
  if (usaLeito && x.recortes.includes('clinica')) p.push('o recorte por clínica não tem leito-dia');
  if (usaLeito && !x.limitacoes.some((l) => /leito-dia/i.test(l)))
    p.push('indicador de leito sem a limitação do leito-dia declarada');
  return p;
}

/** Valida o conjunto: cada código com uma ficha, todas válidas. */
export function validarFichas(fichas: readonly FichaIndicador[] = FICHAS): string[] {
  const p: string[] = [];
  const vistos = new Set<string>();
  for (const f of fichas) {
    if (vistos.has(f.codigo)) p.push(`${f.codigo}: ficha repetida`);
    vistos.add(f.codigo);
    for (const x of validarFicha(f)) p.push(`${f.codigo}: ${x}`);
  }
  for (const c of CODIGOS_INDICADOR) if (!vistos.has(c)) p.push(`${c}: indicador sem ficha`);
  return p;
}

export function fichaDe(codigo: string): FichaIndicador | undefined {
  return FICHAS.find((f) => f.codigo === codigo);
}
