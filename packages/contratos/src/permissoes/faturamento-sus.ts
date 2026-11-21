// Permissões do M51 (ficha, seção 7; convencoes.md §12): faturamento SUS próprio. Quem tem a opção no outro sistema tem
// a permissão no novo (regra 1 do M06). Os nomes da ficha (`faturamento.sus.ciha.gerar`, `.fechar_competencia`) foram
// trazidos ao formato de três partes em camelCase do catálogo (FORMATO_CODIGO_PERMISSAO): `faturamento.susCiha.gerar`,
// `faturamento.sus.fecharCompetencia`. Opções da árvore do menu de origem levantadas no preparo do M51 (retrato
// tools/verificadores/dados/acesso-legado.pc.json):
//   - Recepção externa (módulo 8) › Exportação 3263 › C.I.H.A. 3264 (a CIHA de hoje é gerada ali);
//   - Recepção interna (módulo 9) › Controle atendimento S.U.S. 2487 (grupos de supervisão do faturamento);
//   - Faturamento A.I.H. (módulo 2): raiz 4252; Tabelas 643 › Parâmetros 644; Lançamentos › Cadastro de AIH 646
//     (Manutenção 647); Gerar arquivo p/apresentação 690 (Criar arquivo 691); Sisaih01 3217; Utilitários ›
//     Importação de AIHs 3198, Fechamento de fatura 3201, Fechamento mensal 4388;
//   - Faturamento ambulatório (módulo 3): raiz 4253; Tabelas 701; Geração de BPA 724 (Criação 725, Manutenção 726,
//     Arquivo Magnético 728, Importação 733); Fechamento de Fatura 906;
//   - Faturamento A.P.A.C. (módulo 20): raiz 4262; Tabelas 920; Cadastro Apac 929; Arquivo Magnético 951;
//     Encerramento 961; Importa tabela de médicos solicitantes do SUS 1100; Fechamento de fatura 1103.
// Escopo: o do módulo faturamento (convênio), como pede o permissoes:verificar. A CIHA cobre todos os financiadores não
// SUS do estabelecimento: quem tem escopo parcial lê só os registros dos seus convênios e NÃO gera o arquivo nem fecha a
// competência (o serviço recusa com `escopo-parcial`; desenho em docs/marcos/M51/preparo-e1.md).
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_FATURAMENTO_SUS = {
  exportacaoRecepcaoExterna: 3263,
  ciha: 3264,
  controleAtendimentoSus: 2487,
  aihRaiz: 4252,
  aihTabelas: 643,
  aihParametros: 644,
  aihCadastro: 646,
  aihManutencao: 647,
  aihGerarArquivo: 690,
  aihCriarArquivo: 691,
  aihSisaih01: 3217,
  aihImportacao: 3198,
  aihFechamentoFatura: 3201,
  aihFechamentoMensal: 4388,
  ambRaiz: 4253,
  ambTabelas: 701,
  bpa: 724,
  bpaCriacao: 725,
  bpaManutencao: 726,
  bpaArquivo: 728,
  bpaImportacao: 733,
  ambFechamentoFatura: 906,
  apacRaiz: 4262,
  apacTabelas: 920,
  apacCadastro: 929,
  apacArquivo: 951,
  apacEncerramento: 961,
  apacImportaMedSol: 1100,
  apacFechamentoFatura: 1103,
} as const;

const O = OPCOES_FATURAMENTO_SUS;

const p = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado,
  concessaoPorPerfil: null,
  categoria: 'financeira',
  criticidade: 'normal',
  escopos: ['convenio'],
  ...extra,
});

const RAIZES = [O.aihRaiz, O.ambRaiz, O.apacRaiz];
const CIHA = [O.exportacaoRecepcaoExterna, O.ciha];
const FECHAMENTO = [
  O.aihFechamentoFatura,
  O.aihFechamentoMensal,
  O.ambFechamentoFatura,
  O.apacFechamentoFatura,
  O.controleAtendimentoSus,
];
const BPA = [O.bpa, O.bpaCriacao, O.bpaManutencao, O.bpaArquivo];
const APAC = [O.apacCadastro, O.apacArquivo, O.apacEncerramento];
const AIH = [O.aihCadastro, O.aihManutencao, O.aihGerarArquivo, O.aihCriarArquivo, O.aihSisaih01];

export const PERMISSOES_FATURAMENTO_M51: readonly DeclaracaoPermissao[] = [
  p(
    'faturamento.sus.ler',
    'Consultar as competências SUS, as críticas e os arquivos exportados (CIHA, BPA, APAC, AIH)',
    [...RAIZES, ...CIHA, O.controleAtendimentoSus],
  ),
  p(
    'faturamento.sus.abrirCompetencia',
    'Abrir a competência SUS de um instrumento e rodar a crítica prévia',
    [...CIHA, ...BPA, ...APAC, ...AIH],
  ),
  p(
    'faturamento.sus.fecharCompetencia',
    'Fechar a competência SUS (sem crítica bloqueante aberta; supervisor)',
    FECHAMENTO,
    { criticidade: 'sensivel' },
  ),
  p(
    'faturamento.sus.reabrirCompetencia',
    'Reabrir a competência SUS fechada (supervisor, com justificativa)',
    FECHAMENTO,
    { criticidade: 'sensivel' },
  ),
  p('faturamento.sus.justificarCritica', 'Justificar uma crítica de aviso da competência SUS', [
    ...CIHA,
    ...BPA,
    ...APAC,
    ...AIH,
  ]),
  p(
    'faturamento.susEquivalencia.editar',
    'Registrar a equivalência SIGTAP de um procedimento do hospital para a CIHA (sem mexer no de-para da tabela de preços)',
    [...CIHA, O.ambTabelas, O.aihTabelas],
  ),
  p(
    'faturamento.susEquivalencia.editarRede',
    'Registrar ou desativar a equivalência SIGTAP que vale para a rede inteira do cliente (além da ação do estabelecimento)',
    [...CIHA, O.ambTabelas, O.aihTabelas],
    { criticidade: 'sensivel' },
  ),
  p(
    'faturamento.susCiha.gerar',
    'Gerar o arquivo CIHA da competência no leiaute do Ministério (com hash) e baixá-lo',
    CIHA,
    { criticidade: 'sensivel' },
  ),
  p('faturamento.susBpa.gerar', 'Gerar o BPA-C e o BPA-I da competência (BPA-Mag)', BPA, {
    criticidade: 'sensivel',
  }),
  p('faturamento.susApac.registrar', 'Registrar laudo, autorização e encerramento de APAC', APAC, {
    criticidade: 'sensivel',
  }),
  p(
    'faturamento.susAih.registrar',
    'Registrar a AIH (laudo autorizado, procedimentos, OPM e diárias) e gerar o SISAIH01',
    AIH,
    { criticidade: 'sensivel' },
  ),
  p(
    'faturamento.susAih.registrarFaixa',
    'Registrar a faixa numérica de AIH liberada pelo gestor',
    [O.aihParametros, O.aihFechamentoMensal],
    { criticidade: 'sensivel' },
  ),
  p('faturamento.susCadastro.editar', 'Editar os leitos de UTI habilitados e os domínios SIH e SIA', [
    O.aihTabelas,
    O.aihParametros,
    O.ambTabelas,
    O.apacTabelas,
  ]),
  // Os médicos solicitantes SUS vão pelo CRUD genérico (M51, etapa 2): as permissões
  // `faturamento.susSolicitante.{ler,criar,editar,exportar}` são geradas do domínio (dominios-m51.ts), com as opções
  // 920 e 1100 do módulo A.P.A.C.
  p(
    'faturamento.susRetorno.importar',
    'Importar o espelho e o retorno do gestor (rejeições e reapresentação)',
    [O.aihImportacao, O.bpaImportacao],
  ),
];
