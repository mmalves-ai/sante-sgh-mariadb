// Permissões da operadora própria (M56; ficha, seção 7; convencoes.md §12). A operadora é empresa distinta na
// hierarquia da Rede, com perfis e trilha próprios (regra 3; cap-07 §7.4): nenhuma permissão vem de opção do outro
// sistema. No retrato pc (tools/verificadores/dados/acesso-legado.pc.json) os 15 módulos do sistema de operadora em
// módulos de origem têm 233 opções (abertura 53, controle financeiro 177, gerador de relatórios 3) e NENHUMA concessão a grupo
// ou papel; o catálogo do M06 já as deixa de fora (motivo `sistema-sgo-sgs`). Por isso tudo aqui é recurso do novo,
// concedido por perfil próprio da operadora (D-PERM-56, POL-5). A consulta somente leitura dos domínios do M14
// (`operadora.consulta.ler`, opção 4134) continua como está.
import type { DeclaracaoPermissao } from './tipos.js';

/** Perfis da operadora (concedidos pelo gestor de acessos, com a trilha da operadora; ficha, seção 13). */
export const PERFIS_OPERADORA = [
  'operadora-gestor',
  'operadora-cadastro',
  'operadora-cobranca',
  'operadora-credenciamento',
  'operadora-auditor',
  'operadora-atendimento',
  'operadora-ans',
] as const;
export type PerfilOperadora = (typeof PERFIS_OPERADORA)[number];

/** Perfil especial do portal do prestador (cap-08 §8.3.5): identidade própria em SGH_, nunca usuário interno. */
export const PERFIL_PORTAL_PRESTADOR = 'portal-prestador' as const;

const p = (
  codigo: string,
  descricao: string,
  perfis: readonly string[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: 'por-perfil',
  perfis,
  categoria: 'administrativa',
  criticidade: 'normal',
  escopos: [],
  ...extra,
});

const GESTOR = 'operadora-gestor';

export const PERMISSOES_OPERADORA_M56: readonly DeclaracaoPermissao[] = [
  // Beneficiários, planos e contratos (F1).
  p(
    'operadora.beneficiario.ler',
    'Consultar produtos, planos, contratos, beneficiários e carteirinhas da operadora',
    [GESTOR, 'operadora-cadastro', 'operadora-cobranca', 'operadora-atendimento', 'operadora-auditor'],
  ),
  p(
    'operadora.beneficiario.editar',
    'Incluir e alterar produto, plano, contrato e beneficiário da operadora; emitir carteirinha e segunda via',
    [GESTOR, 'operadora-cadastro'],
    { criticidade: 'sensivel' },
  ),
  // A operadora como empresa distinta (F1, regra 3; D-EMPRESA-56): registro na ANS, CNPJ e modalidade, só do gestor.
  p(
    'operadora.empresa.editar',
    'Incluir e alterar a operadora (registro na ANS, CNPJ, razão social e modalidade)',
    [GESTOR],
    { criticidade: 'sensivel' },
  ),
  // Cobrança e mensalidades (F2).
  p(
    'operadora.cobranca.ler',
    'Consultar mensalidades, coparticipações, cobranças avulsas, acordos e inadimplência da operadora',
    [GESTOR, 'operadora-cobranca', 'operadora-atendimento'],
    { categoria: 'financeira' },
  ),
  p(
    'operadora.cobranca.gerar',
    'Gerar a cobrança da competência, reajustar contrato, fazer acordo e baixar inadimplência da operadora',
    [GESTOR, 'operadora-cobranca'],
    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  // Rede credenciada e prestadora (F3).
  p(
    'operadora.prestador.ler',
    'Consultar a rede credenciada, os contratos e os modelos de remuneração dos prestadores',
    [GESTOR, 'operadora-credenciamento', 'operadora-auditor', 'operadora-atendimento'],
  ),
  p(
    'operadora.prestador.editar',
    'Credenciar, alterar e descredenciar prestador da operadora, com contrato e remuneração',
    [GESTOR, 'operadora-credenciamento'],
    { criticidade: 'sensivel' },
  ),
  // Autorização de guias e auditoria médica (F4): a guia traz diagnóstico e procedimento (conteúdo clínico).
  p(
    'operadora.autorizacao.ler',
    'Consultar as guias pedidas à operadora, com a análise e o parecer da auditoria',
    ['operadora-auditor', 'operadora-atendimento'],
    { categoria: 'clinica' },
  ),
  p(
    'operadora.autorizacao.decidir',
    'Autorizar, negar ou pedir complemento de guia como auditor da operadora',
    ['operadora-auditor'],
    { categoria: 'clinica', criticidade: 'sensivel', exigeConselho: true },
  ),
  // M56.5 (F4; D-PERM-AUT-56): registrar o pedido que o prestador faz (com o protocolo), responder o complemento e
  // cancelar o pedido não é decidir: atendimento e auditor. Designar os auditores é da diretoria da operadora (gestor),
  // sem ver o conteúdo clínico das guias.
  p(
    'operadora.autorizacao.registrar',
    'Registrar o pedido de autorização do prestador, com o protocolo, o complemento enviado e o cancelamento',
    ['operadora-atendimento', 'operadora-auditor'],
    { categoria: 'clinica', criticidade: 'sensivel' },
  ),
  p(
    'operadora.auditor.designar',
    'Designar e encerrar os médicos e enfermeiros auditores da operadora',
    [GESTOR],
    { criticidade: 'sensivel' },
  ),
  // Atendimento ao beneficiário com protocolo (F7; D-PERM-56: a ficha põe o protocolo na mesma tela da autorização,
  // mas registrar o contato não é decidir guia).
  p(
    'operadora.protocolo.ler',
    'Consultar os protocolos de atendimento ao beneficiário e os prazos de resposta',
    [GESTOR, 'operadora-atendimento', 'operadora-auditor'],
  ),
  p(
    'operadora.protocolo.registrar',
    'Registrar o contato do beneficiário com número de protocolo e responder no prazo',
    ['operadora-atendimento'],
  ),
  // Contas médicas recebidas (F5; D-PERM-56: a ficha não nomeia permissão para elas).
  // M56.6 (F5; D-PERM-CONTA-56): o atendimento da operadora recebe o lote em XML e registra o recurso de glosa do
  // prestador (não analisa); o auditor designado glosa, conclui e decide o recurso; o pagamento ao prestador é da área
  // financeira da operadora (gestor e cobrança), que vê só os valores, sem o conteúdo clínico das guias.
  p(
    'operadora.conta.ler',
    'Consultar as contas médicas recebidas dos prestadores, com a análise e a glosa',
    ['operadora-auditor', 'operadora-atendimento'],
    { categoria: 'clinica' },
  ),
  p(
    'operadora.conta.receber',
    'Receber o lote de contas médicas do prestador em XML TISS e registrar o recurso de glosa',
    ['operadora-atendimento', 'operadora-auditor'],
    { categoria: 'clinica', criticidade: 'sensivel' },
  ),
  p(
    'operadora.conta.analisar',
    'Analisar conta médica recebida, glosar item e liberar para pagamento ao prestador',
    ['operadora-auditor'],
    { categoria: 'clinica', criticidade: 'sensivel', exigeConselho: true },
  ),
  p(
    'operadora.conta.pagar',
    'Registrar o pagamento ao prestador das contas médicas liberadas pela auditoria',
    [GESTOR, 'operadora-cobranca'],
    { categoria: 'financeira', criticidade: 'sensivel' },
  ),
  // Envios à ANS (F6): gerar o arquivo da competência; o envio real só em produção. Os catálogos da ANS ficam em
  // `catalogo.ans.ler` (catalogos.ts), do hospital e destes perfis (D-ANS-HOSPITAL-56).
  p('operadora.ans.ler', 'Consultar os envios à ANS (SIB, SIP, DIOPS, TPS), com arquivo, hash e recibo', [
    GESTOR,
    'operadora-ans',
  ]),
  p(
    'operadora.ans.gerar',
    'Gerar o arquivo de envio à ANS da competência e enviá-lo (só em produção)',
    ['operadora-ans'],
    { criticidade: 'critica' },
  ),
  // Domínios da operadora e do plano próprio (CRUD genérico do grupo `operadora`).
  p('operadora.dominio.ler', 'Consultar os domínios da operadora e do plano próprio', [...PERFIS_OPERADORA]),
  p(
    'operadora.dominio.editar',
    'Incluir, alterar e inativar domínios da operadora e do plano próprio',
    [GESTOR],
    {
      criticidade: 'sensivel',
    },
  ),
  // Interface com sistema de operadora contratado (F8).
  p('operadora.interface.ler', 'Consultar os lotes trocados com o sistema de operadora contratado', [
    GESTOR,
    'operadora-cadastro',
  ]),
  p(
    'operadora.interface.editar',
    'Configurar a interface com o sistema de operadora contratado e reenviar lote',
    [GESTOR],
    { categoria: 'tecnica', criticidade: 'sensivel' },
  ),
  // Portal do prestador (F7): a permissão nunca vem de usuário interno; o servidor do portal a dá à sessão do portal.
  p(
    'operadora.portal.acessar',
    'Entrar no portal do prestador credenciado com as funções que o contrato do prestador libera',
    [PERFIL_PORTAL_PRESTADOR],
  ),
];
