// Permissões do M52, fatia F4 (ficha, seção 7, tela "Ponto: importação e tratamento"; convencoes.md §12): consultar o
// ponto, importar o AFD, lançar e aprovar ajustes e justificativas, fechar o período, exportar o AEJ e os eventos para
// a folha, e a ciência do próprio espelho. Quem tem a opção no outro sistema tem a permissão no novo (regra 1 do M06).
// Opções do Ponto eletrônico (novo) na árvore do menu de origem (conector/mapa/permissoes.tsv): Importações › AFD (5067) e
// Importações de falhas (5068); Gerenciamento › Abertura de período (5071), Autorização de trabalho/folga (5074), Painel
// de processamentos (5075), Manutenção individual (5076), Banco de horas (5077 a 5079); Solicitações (5069); Relatórios
// › Espelho de ponto (5082); Exportações (5085) › AFDT (5086) e ACJEF (5087); Integrações › Integração com folha (5084).
// Decisão D-PERM-524 (POL-5): a ficha nomeia `ler`, `importar` e `aprovar`; lançar o ajuste (`justificar`) e exportar
// (`exportar`, com o CPF no AEJ) ficam separados para que o lançamento e a aprovação sejam de pessoas diferentes; o
// fechamento e a reabertura do período e o acerto do banco são do aprovador; a ciência do espelho é de toda pessoa,
// só do próprio vínculo (o servidor confere), e o autosserviço completo é da F6.
import type { DeclaracaoPermissao } from './tipos.js';

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'administrativa',
  criticidade: 'normal',
  escopos: [],
  ...extra,
});

export const PERMISSOES_PESSOAS_M52_F4: readonly DeclaracaoPermissao[] = [
  p(
    'pessoas.ponto.ler',
    'Consultar o ponto: arquivos do relógio importados, painel do período, espelho de cada colaborador e banco de horas',
  ),
  p(
    'pessoas.ponto.importar',
    'Importar o arquivo do relógio de ponto (AFD), com a validação e a quarentena',

    { criticidade: 'sensivel' },
  ),
  p(
    'pessoas.ponto.justificar',
    'Lançar ajuste de ponto (marcação que faltou, marcação a desconsiderar) e justificativa ou abono, para aprovação',

    { criticidade: 'sensivel' },
  ),
  p(
    'pessoas.ponto.aprovar',
    'Aprovar ou recusar ajustes e justificativas, fechar e reabrir o período e lançar o acerto do banco de horas',

    { criticidade: 'sensivel' },
  ),
  p(
    'pessoas.ponto.exportar',
    'Gerar o arquivo eletrônico de jornada (AEJ) e os eventos de ponto para a folha (com o CPF do colaborador)',

    { criticidade: 'sensivel' },
  ),
  p(
    'pessoas.ponto.ciencia',
    'Ver o próprio espelho de ponto e registrar a ciência (só o próprio vínculo)',

    {
      concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    },
  ),
];
