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

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'financeira',
  criticidade: 'normal',
  escopos: ['convenio'],
  ...extra,
});

export const PERMISSOES_FATURAMENTO_M51: readonly DeclaracaoPermissao[] = [
  p(
    'faturamento.sus.ler',
    'Consultar as competências SUS, as críticas e os arquivos exportados (CIHA, BPA, APAC, AIH)',
  ),
  p('faturamento.sus.abrirCompetencia', 'Abrir a competência SUS de um instrumento e rodar a crítica prévia'),
  p(
    'faturamento.sus.fecharCompetencia',
    'Fechar a competência SUS (sem crítica bloqueante aberta; supervisor)',

    { criticidade: 'sensivel' },
  ),
  p(
    'faturamento.sus.reabrirCompetencia',
    'Reabrir a competência SUS fechada (supervisor, com justificativa)',

    { criticidade: 'sensivel' },
  ),
  p('faturamento.sus.justificarCritica', 'Justificar uma crítica de aviso da competência SUS'),
  p(
    'faturamento.susEquivalencia.editar',
    'Registrar a equivalência SIGTAP de um procedimento do hospital para a CIHA (sem mexer no de-para da tabela de preços)',
  ),
  p(
    'faturamento.susEquivalencia.editarRede',
    'Registrar ou desativar a equivalência SIGTAP que vale para a rede inteira do cliente (além da ação do estabelecimento)',

    { criticidade: 'sensivel' },
  ),
  p(
    'faturamento.susCiha.gerar',
    'Gerar o arquivo CIHA da competência no leiaute do Ministério (com hash) e baixá-lo',

    { criticidade: 'sensivel' },
  ),
  p('faturamento.susBpa.gerar', 'Gerar o BPA-C e o BPA-I da competência (BPA-Mag)', {
    criticidade: 'sensivel',
  }),
  p('faturamento.susApac.registrar', 'Registrar laudo, autorização e encerramento de APAC', {
    criticidade: 'sensivel',
  }),
  p(
    'faturamento.susAih.registrar',
    'Registrar a AIH (laudo autorizado, procedimentos, OPM e diárias) e gerar o SISAIH01',

    { criticidade: 'sensivel' },
  ),
  p(
    'faturamento.susAih.registrarFaixa',
    'Registrar a faixa numérica de AIH liberada pelo gestor',

    { criticidade: 'sensivel' },
  ),
  p('faturamento.susCadastro.editar', 'Editar os leitos de UTI habilitados e os domínios SIH e SIA'),
  // A regra por tipo de prestador geral (sem estabelecimento) vale para todos os estabelecimentos do cliente: criar ou
  // encerrar uma é administração do cliente, não do estabelecimento (06-SUS linha 61).
  p(
    'faturamento.regraPrestadorGeral.editar',
    'Criar e encerrar as regras por tipo de prestador SUS que valem para todos os estabelecimentos do cliente',
    { concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'], criticidade: 'sensivel' },
  ),
  // C1-051 (06-SUS linha 53): a permissão por usuário e setor do faturamento SUS e os parâmetros por instrumento.
  p(
    'faturamento.susConfiguracao.editar',
    'Dar e encerrar a permissão por usuário e setor do faturamento SUS e gravar os parâmetros de cada instrumento',
    { concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'], criticidade: 'sensivel' },
  ),
  // Os médicos solicitantes SUS vão pelo CRUD genérico (M51, etapa 2): as permissões
  // `faturamento.susSolicitante.{ler,criar,editar,exportar}` são geradas do domínio (dominios-m51.ts), com as opções
  // 920 e 1100 do módulo A.P.A.C.
  p(
    'faturamento.susRetorno.importar',
    'Importar o espelho e o retorno do gestor (rejeições e reapresentação)',
  ),
  // F7 (08-INTG linha 131): troca por serviço web com o SUS (rastreamento de câncer, cadastro de prestador); recurso só
  // do novo, concedido por perfil.
  p(
    'faturamento.susServicoWeb.ler',
    'Consultar os envios ao serviço web do SUS (rastreamento de câncer, cadastro de prestador) e as respostas',
    { concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  p(
    'faturamento.susServicoWeb.enviar',
    'Registrar, enviar e cancelar envios ao serviço web do SUS (simulador fora de produção)',
    { criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  // F8 (06-SUS linha 64): RAAS da atenção psicossocial e da atenção domiciliar.
  p(
    'faturamento.susRaas.ler',
    'Consultar os registros RAAS, as ações, as críticas e as remessas da competência',
    {
      concessaoPorPerfil: 'por-perfil',
      perfis: ['administrador-sistema'],
    },
  ),
  p(
    'faturamento.susRaas.registrar',
    'Incluir o registro RAAS, lançar e retirar ação, concluir, continuar na competência seguinte e rodar a crítica',
    { criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  p('faturamento.susRaas.gerar', 'Gerar a remessa RAAS da competência (arquivo com hash)', {
    criticidade: 'sensivel',
    concessaoPorPerfil: 'por-perfil',
    perfis: ['administrador-sistema'],
  }),
  // F8 (06-SUS linha 65): notificação de potencial doador e inscrição de receptor para a central estadual de
  // transplantes; recurso só do novo, concedido por perfil. Conteúdo clínico (dado sensível).
  // F7 (06-SUS linha 54): programação físico-orçamentária, tetos e cotas; recurso só do novo, concedido por perfil.
  p(
    'faturamento.susProgramacao.ler',
    'Consultar a programação físico-orçamentária, os tetos, as cotas, o saldo da competência e os remanejamentos',
    { concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  p(
    'faturamento.susProgramacao.editar',
    'Importar e ativar a programação físico-orçamentária, incluir e inativar teto e cota e pedir remanejamento de cota',
    { criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  p(
    'faturamento.susProgramacao.aprovar',
    'Aprovar ou recusar o remanejamento de cota pedido por outra pessoa',
    { criticidade: 'sensivel', concessaoPorPerfil: 'por-perfil', perfis: ['administrador-sistema'] },
  ),
  p(
    'faturamento.susTransplante.ler',
    'Consultar as notificações de potencial doador, as inscrições de receptor, o histórico enviado à central e o arquivo de conferência',
    {
      categoria: 'clinica',
      criticidade: 'sensivel',
      concessaoPorPerfil: 'por-perfil',
      perfis: ['administrador-sistema', 'coordenador-medico', 'coordenador-enfermagem'],
    },
  ),
  p(
    'faturamento.susTransplante.registrar',
    'Notificar o potencial doador, inscrever e alterar o receptor e registrar o protocolo e o número devolvidos pela central de transplantes',
    {
      categoria: 'clinica',
      criticidade: 'sensivel',
      concessaoPorPerfil: 'por-perfil',
      perfis: ['administrador-sistema', 'coordenador-medico', 'coordenador-enfermagem'],
    },
  ),
];
