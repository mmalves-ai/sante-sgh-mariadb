// Dados sintéticos dos testes das obrigações (nenhum de pessoa real): CNPJ, CPF e NIS de exemplo.
import type { ParametrosObrigacoes } from '@sgh/contratos';
import { REGIMES_SUGERIDOS_OBRIGACOES } from '@sgh/contratos';
import { CNPJ, CPF, ficha } from '../esocial/fixtures-esocial.spec-util.js';
import type { CatalogosObrigacoes, EmpresaObrigacao, TrabalhadorObrigacao } from './tipos.js';

export const NIS = '12345678919';

export const parametros: ParametrosObrigacoes = {
  empresa: 1,
  inicio: '2000-01',
  razaoSocial: 'Hospital Sintético Ltda',
  endereco: {
    logradouro: 'Avenida Central, 1000',
    bairro: 'Centro',
    cep: '30110000',
    cidade: 'Belo Horizonte',
    uf: 'MG',
    municipio: '3106200',
  },
  contato: { nome: 'Setor Pessoal', telefone: '3133334444', email: 'dp@exemplo.com.br' },
  naturezaJuridica: '2062',
  codigoRecolhimentoSefip: '115',
  codigoPagamentoGps: '2100',
  regimes: { ...REGIMES_SUGERIDOS_OBRIGACOES },
};

export const empresa: EmpresaObrigacao = {
  cnpj: CNPJ,
  parametros: {
    razaoSocial: parametros.razaoSocial,
    endereco: parametros.endereco,
    contato: parametros.contato,
    naturezaJuridica: parametros.naturezaJuridica,
    codigoRecolhimentoSefip: parametros.codigoRecolhimentoSefip,
    codigoPagamentoGps: parametros.codigoPagamentoGps,
  },
  cnae: '8610101',
  fpas: '515',
  codTerceiros: '0115',
  aliqRat: 3,
  fap: 10_000,
};

export const trab = (over: Partial<TrabalhadorObrigacao> = {}): TrabalhadorObrigacao => ({
  vinculo: 501,
  matricula: '000123',
  cpf: CPF,
  nome: 'Colaboradora Sintética',
  admissao: '2015-03-02',
  desligamento: null,
  cargaSemanal: 44,
  salario: 300_000,
  ficha: { ...ficha, nis: NIS },
  modalidadeRescisao: null,
  ...over,
});

/** Os códigos como o banco devolve (numéricos sem zero à esquerda). */
export const catalogos: CatalogosObrigacoes = {
  categoriasSefip: new Set(['1', '4', '5', '7', '11', '13']),
  movimentacoesSefip: new Set(['H', 'I1', 'I2', 'I3', 'I5', 'J', 'S2']),
  desligamentosCaged: new Set(['31', '32', '40', '43', '45', '50', '60', '80', '90']),
  admissoesCaged: new Set(['10', '20', '25', '35', '70']),
  vinculosRais: new Set(['10', '50', '55', '60', '90']),
  desligamentosRais: new Set(['10', '11', '12', '20', '21', '60', '90']),
  admissoesRais: new Set(['1', '2', '3', '4', '5']),
};
