// Plano e movimento sintéticos das demonstrações e do SPED (M54-F3).
import type { ContaPlano, GrupoConta } from '@sgh/contratos';
import type { SomaConta } from './demonstracoes.js';

export const c = (
  codigo: string,
  nome: string,
  grupo: GrupoConta,
  extra: Partial<ContaPlano> = {},
): ContaPlano => ({
  empresa: 1,
  codigo,
  nome,
  grupo,
  tipo: codigo.split('.').length >= 3 ? 'analitica' : 'sintetica',
  natureza: ['ativo', 'custo', 'despesa', 'compensacao'].includes(grupo) ? 'devedora' : 'credora',
  referencialTipo: null,
  referencialConta: null,
  contaExportacao: null,
  exigeCentroCusto: false,
  ativa: true,
  ...extra,
});

export const PLANO: ContaPlano[] = [
  c('1', 'Ativo', 'ativo'),
  c('1.1', 'Ativo circulante', 'ativo'),
  c('1.1.01', 'Caixa', 'ativo'),
  c('1.1.02', 'Convênios a receber', 'ativo'),
  c('2', 'Passivo', 'passivo'),
  c('2.1', 'Passivo circulante', 'passivo'),
  c('2.1.01', 'Fornecedores', 'passivo'),
  c('3', 'Patrimônio líquido', 'patrimonioLiquido'),
  c('3.1', 'Patrimônio social', 'patrimonioLiquido'),
  c('3.1.01', 'Patrimônio social', 'patrimonioLiquido'),
  c('3.1.02', 'Superávits acumulados', 'patrimonioLiquido'),
  c('4', 'Receitas', 'receita'),
  c('4.1', 'Receita de serviços', 'receita'),
  c('4.1.01', 'Receita de convênios', 'receita'),
  c('4.1.02', 'Glosas', 'receita', { natureza: 'devedora' }),
  c('5', 'Custos', 'custo'),
  c('5.1', 'Custo dos serviços', 'custo'),
  c('5.1.01', 'Materiais', 'custo', { exigeCentroCusto: true }),
  c('6', 'Despesas', 'despesa'),
  c('6.1', 'Despesas administrativas', 'despesa'),
  c('6.1.01', 'Serviços de terceiros', 'despesa'),
];

/** O movimento de janeiro (centavos): capital, receita, glosa, custo e despesa. */
export const MOVIMENTO: SomaConta[] = [
  { conta: '1.1.01', debitos: 10_000, creditos: 8_000 },
  { conta: '3.1.01', debitos: 0, creditos: 10_000 },
  { conta: '1.1.02', debitos: 50_000, creditos: 2_000 },
  { conta: '4.1.01', debitos: 0, creditos: 50_000 },
  { conta: '4.1.02', debitos: 2_000, creditos: 0 },
  { conta: '5.1.01', debitos: 15_000, creditos: 0 },
  { conta: '2.1.01', debitos: 0, creditos: 15_000 },
  { conta: '6.1.01', debitos: 8_000, creditos: 0 },
];
