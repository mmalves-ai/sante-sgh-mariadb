// Permissões do M55, etapa 5 (ficha, seção 7; convencoes.md §12): contratualização SUS (metas e incentivos). Quem tem a
// opção no sistema anterior tem a permissão no novo (regra 1 do M06). O sistema anterior tem os domínios da
// contratualização (CM*) sem tela de contrato com dado; as opções são as do faturamento SUS que a contratualização
// envolve (as mesmas do M51, retrato tools/verificadores/dados/acesso-legado.pc.json):
//   - consultar (contratos, metas, apurações e o painel produção × meta): as raízes do faturamento AIH, ambulatório e
//     APAC (4252, 4253, 4262) e o Controle de atendimento SUS 2487 (quem vê a produção SUS vê as metas);
//   - editar (contrato, incentivos, metas, apuração e encerramento): as Tabelas e os Parâmetros do faturamento SUS
//     (643, 644, 701, 920), de quem configura o faturamento SUS do estabelecimento.
// Escopo: o do módulo faturamento (convênio), como pede o permissoes:verificar; a contratualização é toda do SUS.
import { OPCOES_FATURAMENTO_SUS } from './faturamento-sus.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_CONTRATUALIZACAO_CODIGOS = {
  ler: 'faturamento.contratualizacao.ler',
  editar: 'faturamento.contratualizacao.editar',
} as const;

const O = OPCOES_FATURAMENTO_SUS;

export const PERMISSOES_CONTRATUALIZACAO_M55_F5: readonly DeclaracaoPermissao[] = [
  {
    codigo: PERMISSOES_CONTRATUALIZACAO_CODIGOS.ler,
    descricao:
      'Consultar a contratualização SUS: contratos com o gestor, incentivos, metas, apurações e o painel produção × meta',
    opcoesLegado: [O.aihRaiz, O.ambRaiz, O.apacRaiz, O.controleAtendimentoSus],
    concessaoPorPerfil: null,
    categoria: 'financeira',
    criticidade: 'normal',
    escopos: ['convenio'],
  },
  {
    codigo: PERMISSOES_CONTRATUALIZACAO_CODIGOS.editar,
    descricao:
      'Cadastrar e alterar o contrato SUS (orçamento, incentivos, habilitação), as metas quantitativas e qualitativas e registrar a apuração do período',
    opcoesLegado: [O.aihTabelas, O.aihParametros, O.ambTabelas, O.apacTabelas],
    concessaoPorPerfil: null,
    categoria: 'financeira',
    criticidade: 'sensivel',
    escopos: ['convenio'],
  },
];
