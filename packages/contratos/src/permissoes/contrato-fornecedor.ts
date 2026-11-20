// Permissões do M55, etapa 3 (ficha, seção 7; convencoes.md §12): contratos com fornecedores. Quem tem a opção no
// sistema anterior tem a permissão no novo (regra 1 do M06). O sistema anterior não tem cadastro de contrato de
// fornecedor (cap-07 §7.3): as opções são as da gestão de compras e das contas a pagar, que o contrato envolve
// (retrato tools/verificadores/dados/acesso-legado.pc.json):
//   - consultar: Pedidos 2123 (Manutenção 2124) e Contas a pagar 108 (quem vê o pedido ou o título vê o contrato);
//   - editar (cadastro, vínculo, ocorrência, anexo, encerramento): Manutenção dos pedidos 2124;
//   - aditar (aditivo, reajuste, renovação e a exceção da regra 7, que é da alçada): Autorização dos pedidos 4491;
//   - avaliar o fornecedor (ONA-05): Definição de vencedores 2125 e Manutenção dos pedidos 2124.
import { OPCOES_FINANCEIRO_M32 } from './financeiro.js';
import { OPCOES_SUPRIMENTOS } from './suprimentos.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_CONTRATO_CODIGOS = {
  ler: 'suprimentos.contrato.ler',
  editar: 'suprimentos.contrato.editar',
  aditar: 'suprimentos.contrato.aditar',
  avaliar: 'suprimentos.contrato.avaliar',
} as const;

const S = OPCOES_SUPRIMENTOS;
const F = OPCOES_FINANCEIRO_M32;

export const PERMISSOES_CONTRATO_M55_F3: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_CONTRATO_CODIGOS.ler,
    descricao:
      'Consultar os contratos com fornecedores: vigência, valor, aditivos, saldo com os pedidos e títulos ligados e avaliações',
    opcoesLegado: [S.pedidos, S.pedidoManutencao, F.contasPagar],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: PERMISSOES_CONTRATO_CODIGOS.editar,
    descricao:
      'Cadastrar e alterar o contrato (partes, objeto, garantias, gestor e fiscal), ligar pedidos e títulos, registrar ocorrências e anexos, encerrar e rescindir',
    opcoesLegado: [S.pedidoManutencao],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_CONTRATO_CODIGOS.aditar,
    descricao:
      'Registrar o termo aditivo, o reajuste pelo índice e a renovação, e aprovar a exceção para pedido em contrato vencido (alçada)',
    opcoesLegado: [S.autorizacaoPedidos],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: PERMISSOES_CONTRATO_CODIGOS.avaliar,
    descricao: 'Avaliar e qualificar o fornecedor do contrato (qualidade, prazo, atendimento e documentação)',
    opcoesLegado: [S.definicaoVencedores, S.pedidoManutencao],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
];
