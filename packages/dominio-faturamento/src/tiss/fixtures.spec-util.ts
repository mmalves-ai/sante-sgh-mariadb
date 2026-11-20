// Massa sintética de teste para as mensagens TISS (nenhum dado real: carteira, guias, registro ANS,
// CNES e conselho fictícios, só no formato exigido pelo XSD).
import type { Cabecalho, GuiaConsulta, GuiaResumoInternacao, GuiaSpSadt, RecursoGlosa } from './lote.js';

export const cabecalho: Cabecalho = {
  sequencialTransacao: '1',
  data: '2026-10-19',
  hora: '10:30:00',
  codigoPrestadorNaOperadora: 'PRESTTESTE01',
  registroANS: '999999',
};

const beneficiario = { numeroCarteira: 'SINTETICO0000001', atendimentoRN: 'N' as const };
const profissional = { conselho: '06', numeroConselho: '000000', uf: '33', cbos: '225125' };

export const consulta: GuiaConsulta = {
  tipo: 'consulta',
  numeroGuiaPrestador: 'TESTE-C-0001',
  beneficiario,
  cnes: '9999999',
  profissional,
  dataAtendimento: '2026-10-18',
  tipoConsulta: '1',
  procedimento: { codigoTabela: '22', codigo: '10101012' },
  valor: 150,
};

export const spSadt: GuiaSpSadt = {
  tipo: 'sp-sadt',
  numeroGuiaPrestador: 'TESTE-S-0001',
  beneficiario,
  nomeContratadoSolicitante: 'PRESTADOR FICTÍCIO DE TESTE',
  profissionalSolicitante: profissional,
  cnes: '9999999',
  caraterAtendimento: '1',
  tipoAtendimento: '23',
  itens: [
    {
      sequencial: 1,
      data: '2026-10-18',
      procedimento: { codigoTabela: '22', codigo: '40301630', descricao: 'EXAME FICTÍCIO DE TESTE' },
      quantidade: 2,
      valorUnitario: 12.35,
    },
  ],
};

export const resumoInternacao: GuiaResumoInternacao = {
  tipo: 'resumo-internacao',
  numeroGuiaPrestador: 'TESTE-I-0001',
  numeroGuiaSolicitacao: 'TESTE-SI-0001',
  dataAutorizacao: '2026-10-10',
  senha: 'SENHAFICTICIA1',
  beneficiario,
  cnes: '9999999',
  caraterAtendimento: '2',
  tipoFaturamento: '4',
  inicio: { data: '2026-10-10', hora: '08:00:00' },
  fim: { data: '2026-10-15', hora: '12:00:00' },
  tipoInternacao: '1',
  regimeInternacao: '1',
  motivoEncerramento: '12',
  itens: [
    {
      sequencial: 1,
      data: '2026-10-10',
      procedimento: { codigoTabela: '22', codigo: '60000694', descricao: 'DIÁRIA FICTÍCIA DE TESTE' },
      quantidade: 5,
      valorUnitario: 300,
    },
  ],
};

export const recurso: RecursoGlosa = {
  numeroGuiaRecurso: 'TESTE-R-0001',
  nomeOperadora: 'OPERADORA FICTÍCIA DE TESTE',
  numeroLote: '123',
  numeroProtocolo: '456789',
  data: '2026-10-19',
  guias: [
    {
      numeroGuiaOrigem: 'TESTE-S-0001',
      codigoGlosa: '1001',
      justificativa: 'Justificativa fictícia de teste.',
      valorRecursado: 24.7,
    },
  ],
};

export const honorario: import('./lote.js').GuiaHonorario = {
  tipo: 'honorario',
  numeroGuiaPrestador: 'TESTE-H-0001',
  guiaSolicitacaoInternacao: 'TESTE-SI-0001',
  beneficiario,
  nomeContratado: 'PRESTADOR FICTÍCIO DE TESTE',
  cnes: '9999999',
  inicio: '2026-10-10',
  fim: '2026-10-15',
  caraterAtendimento: '2',
  dataEmissao: '2026-10-16',
  itens: [
    {
      sequencial: 1,
      data: '2026-10-11',
      procedimento: { codigoTabela: '22', codigo: '30101012', descricao: 'PROCEDIMENTO FICTÍCIO DE TESTE' },
      quantidade: 1,
      valorUnitario: 480,
      equipe: [
        {
          grauParticipacao: '00',
          codigoPrestador: 'PROFTESTE01',
          nome: 'PROFISSIONAL FICTÍCIO DE TESTE',
          profissional,
        },
      ],
    },
  ],
};

/** SP/SADT com outras despesas (materiais, medicamentos e taxas): o "anexo de outras despesas" da guia. */
export const spSadtComDespesas: GuiaSpSadt = {
  ...spSadt,
  numeroGuiaPrestador: 'TESTE-S-0002',
  despesas: [
    {
      sequencial: 1,
      codigoDespesa: '03',
      data: '2026-10-18',
      codigoTabela: '19',
      codigo: '70000001',
      descricao: 'MATERIAL FICTÍCIO DE TESTE',
      quantidade: 3,
      unidadeMedida: '036',
      valorUnitario: 4.5,
    },
    {
      sequencial: 2,
      codigoDespesa: '02',
      data: '2026-10-18',
      codigoTabela: '20',
      codigo: '90000001',
      descricao: 'MEDICAMENTO FICTÍCIO DE TESTE',
      quantidade: 1.5,
      unidadeMedida: '036',
      valorUnitario: 10,
    },
    {
      sequencial: 3,
      codigoDespesa: '07',
      data: '2026-10-18',
      codigoTabela: '18',
      codigo: '60000001',
      descricao: 'TAXA FICTÍCIA DE TESTE',
      quantidade: 1,
      unidadeMedida: '036',
      valorUnitario: 25,
    },
  ],
};
