// Dados sintéticos dos testes do eSocial (nenhum de pessoa real): CNPJ e CPF de exemplo com dígitos válidos.
import type { FichaEsocialVinculo, RubricaFolha } from '@sgh/contratos';
import type { ContextoEventoEsocial, EmpregadorParaEvento } from './comum.js';
import type { TrabalhadorParaEvento } from './eventos-trabalhador.js';

export const CNPJ = '11222333000181';
export const CPF = '52998224725';

export const ctx: ContextoEventoEsocial = {
  leiaute: 'v_S_01_03_00',
  tpAmb: 2,
  verProc: 'SanteSGH-1.0',
  instante: '2026-10-27T10:15:30',
  sequencia: 1,
};

export const empregador: EmpregadorParaEvento = {
  empresa: 1,
  inicio: '2026-01',
  transmissor: 'sante',
  leiaute: 'v_S_01_03_00',
  classTrib: '99',
  indCoop: 0,
  indConstr: 0,
  indDesFolha: 0,
  indOptRegEletron: 1,
  cnaePrep: '8610101',
  aliqRat: 3,
  fap: 10_000,
  codLotacao: 'LOT01',
  fpas: '515',
  codTercs: '0115',
  ideTabRubr: 'SGH',
  cnpjSindicato: '33444555000106',
  motivosAfastamento: { '3': '01', '7': '15' },
  cnpj: CNPJ,
};

export const ficha: FichaEsocialVinculo = {
  sexo: 'F',
  racaCor: 3,
  estadoCivil: 1,
  grauInstrucao: '09',
  nomeSocial: null,
  nascimento: '1990-05-17',
  paisNascimento: '105',
  paisNacionalidade: '105',
  endereco: {
    tipoLogradouro: 'R',
    logradouro: 'Rua das Flores',
    numero: '100',
    complemento: 'Apto 2',
    bairro: 'Centro',
    cep: '30110000',
    municipio: '3106200',
    uf: 'MG',
  },
  categoria: '101',
  cboCargo: '223505',
  cboFuncao: null,
  regimeJornada: 1,
  naturezaAtividade: 1,
  tipoContrato: 1,
  terminoContrato: null,
  tipoJornada: 2,
  tempoParcial: 0,
  descricaoJornada: 'Segunda a sexta, das 7h às 13h, com 15 minutos de intervalo',
  tipoAdmissao: 1,
  indicativoAdmissao: 1,
  cnpjSindicato: null,
  estagio: null,
};

export const trabalhador: TrabalhadorParaEvento = {
  vinculo: 501,
  matricula: '000123',
  tipo: 'clt',
  cpf: CPF,
  nome: 'Colaboradora Sintética',
  cargo: 'Enfermeira',
  funcao: null,
  cargaSemanal: 30,
  admissao: '2026-10-01',
  desligamento: null,
  ficha,
  salario: 512_345,
};

export const rubrica = (over: Partial<RubricaFolha> = {}): RubricaFolha => ({
  id: 10,
  empresa: 1,
  codigo: 1,
  descricao: 'Salário base',
  tipo: 'provento',
  referencia: 'valor',
  percentual: 0,
  prioridade: null,
  ativa: true,
  vigencia: { inicio: null, fim: null },
  usos: ['mensal'],
  incidencias: {} as RubricaFolha['incidencias'],
  esocial: { inss: '11', irrf: '11', fgts: '11', sindical: null },
  natureza: 1000,
  ...over,
});
