import {
  permissaoExecutarRelatorio,
  permissaoExportarRelatorio,
  RELATORIOS_CATALOGO,
} from '../relatorio/catalogo.js';
import type { DeclaracaoPermissao } from './tipos.js';
export const OPCAO_INTERFACEAMENTO = 2964;

const ADMIN = ['administrador-sistema'] as const;
/** C1-092: o pessoal do laboratório de apoio (perfil próprio) recebe a leitura, a remessa e o de-para do apoio. */
const APOIO = 'laboratorio-apoio';

export const PERMISSOES_M34_CODIGOS = {
  catalogoLer: 'relatorio.catalogo.ler',
  dadoPessoalVer: 'relatorio.dadoPessoal.ver',
  triagemLer: 'relatorio.triagem.ler',
  triagemDecidir: 'relatorio.triagem.decidir',
  pedidoCriar: 'relatorio.pedido.criar',
  pedidoPublicar: 'relatorio.pedido.publicar',
  agendamentoLer: 'relatorio.agendamento.ler',
  agendamentoEditar: 'relatorio.agendamento.editar',
  configuracaoLer: 'integracao.configuracao.ler',
  fhirLer: 'integracao.fhir.ler',
  fhirEnviar: 'integracao.fhir.enviar',
  hl7Ler: 'integracao.hl7.ler',
  parceiroLer: 'integracao.parceiro.ler',
  parceiroEditar: 'integracao.parceiro.editar',
  mensagemLer: 'integracao.mensagem.ler',
  mensagemConfigurar: 'integracao.mensagem.configurar',
  mensagemConfigurarCliente: 'integracao.mensagem.configurarCliente',
  parceiroRevisarMinimizacao: 'integracao.parceiro.revisarMinimizacao',
  mensagemEnviar: 'integracao.mensagem.enviar',
  classificacaoExternaConfigurar: 'integracao.classificacaoExterna.configurar',
  filaLer: 'integracao.fila.ler',
  filaReprocessar: 'integracao.fila.reprocessar',
  interfaceLer: 'sadt.interface.ler',
  apoioLer: 'sadt.apoio.ler',
  apoioConferir: 'sadt.apoio.conferir',
  apoioRemessa: 'sadt.apoio.remessa',
  apoioDePara: 'sadt.apoio.configurar',
  prescricaoDigitalLer: 'pep.prescricaoDigital.ler',
  prescricaoDigitalEnviar: 'pep.prescricaoDigital.enviar',
  filaErpLer: 'integracao.filaErp.ler',
  filaErpOperar: 'integracao.filaErp.operar',
  datamartLer: 'relatorio.datamart.ler',
  datamartAcionar: 'relatorio.datamart.acionar',
} as const;

const C = PERMISSOES_M34_CODIGOS;

function relatorios(): DeclaracaoPermissao[] {
  return RELATORIOS_CATALOGO.flatMap((r) => [
    {
      codigo: permissaoExecutarRelatorio(r.codigo),
      descricao: `Emitir o relatório "${r.titulo}" do catálogo (grade na tela)`,

      concessaoPorPerfil: 'por-perfil' as const,
      perfis: [...ADMIN],
      categoria: r.regua ? ('financeira' as const) : ('administrativa' as const),
      criticidade: 'normal' as const,
    },
    {
      codigo: permissaoExportarRelatorio(r.codigo),
      descricao: `Exportar o relatório "${r.titulo}" (planilha, CSV ou PDF; com dado de pessoa, só com justificativa)`,

      concessaoPorPerfil: 'por-perfil' as const,
      perfis: [...ADMIN],
      categoria: r.regua ? ('financeira' as const) : ('administrativa' as const),
      criticidade: 'sensivel' as const,
    },
  ]);
}

export const PERMISSOES_M34: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.catalogoLer,
    descricao:
      'Ver o catálogo de relatórios parametrizados (cada relatório só se emite com a permissão dele, como o relatório de origem)',

    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  ...relatorios(),
  // 01-REL L113: o controle da carga do data mart na administração (só contagens e tempos; nenhum dado de pessoa).
  {
    codigo: C.datamartLer,
    descricao:
      'Ver as cargas do data mart do estabelecimento (situação, linhas, tempo e etapas; sem dado de pessoa)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.datamartAcionar,
    descricao:
      'Pedir a carga manual do data mart do estabelecimento (o worker a executa e registra as etapas)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.dadoPessoalVer,
    descricao:
      'Ver sem máscara as colunas com dado de pessoa (nome do paciente) nos relatórios do catálogo; a exportação pede justificativa',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['assistencial-com-conselho', ...ADMIN],
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: C.triagemLer,
    descricao: 'Ver a triagem dos relatórios de SQL livre (destino, papel dono, artefato e onda de cada um)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.triagemDecidir,
    descricao: 'Confirmar ou mudar o destino de um relatório de SQL livre na triagem (com o motivo)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.pedidoCriar,
    descricao: 'Pedir um relatório novo ao curador do catálogo e acompanhar os próprios pedidos',

    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.pedidoPublicar,
    descricao: 'Analisar, publicar ou recusar os pedidos de relatório (curador do catálogo)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.agendamentoLer,
    descricao: 'Ver os envios agendados de relatório por e-mail e o histórico dos envios',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.agendamentoEditar,
    descricao:
      'Criar, mudar, desativar e enviar agora um envio agendado (o e-mail leva só o link autenticado)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: C.configuracaoLer,
    descricao: 'Consultar os endpoints, webservices e o integrador (sem credenciais)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.fhirLer,
    descricao:
      'Ver a interoperabilidade FHIR R4 e RNDS (perfis BR Core fixados, identificação, envio de vacina)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.fhirEnviar,
    descricao: 'Enviar o recurso de teste ao ambiente de homologação da RNDS (simulador fora de produção)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.hl7Ler,
    descricao:
      'Ver os canais HL7 v2 do motor de integração, as filas HL7 que seguem pelos gatilhos e a classificação externa',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.parceiroLer,
    descricao:
      'Ver os parceiros externos (os que leem o banco e os das integrações novas, com finalidade e base legal)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.parceiroEditar,
    descricao:
      'Cadastrar parceiro de integração nova, emitir a credencial (o segredo sai uma vez) e ativar por estabelecimento',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.mensagemLer,
    descricao: 'Ver a configuração da comunicação com o paciente (pela Hal-AI) e os domínios das mensagens',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  // F3.9-6 (L133 e L140): modelos e regras de envio ao paciente, o pedido e os retornos da Hal-AI, e os perfis de
  // prioridade da classificação de risco externa.
  {
    codigo: C.mensagemConfigurar,
    descricao:
      'Cadastrar os modelos de mensagem ao paciente e as regras de envio por tipo de aviso (pela Hal-AI)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.mensagemConfigurarCliente,
    descricao:
      'Cadastrar o modelo de mensagem ao paciente do cliente inteiro (vale para todos os estabelecimentos)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.parceiroRevisarMinimizacao,
    descricao:
      'Revisar a minimização de um pacote de dados de parceiro (campos, justificativas e tratamento do dado sensível)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.mensagemEnviar,
    descricao:
      'Pedir o envio de mensagem ao paciente pela regra, cancelar o pendente e registrar os retornos da Hal-AI',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: C.classificacaoExternaConfigurar,
    descricao: 'Cadastrar os perfis de prioridade enviados ao sistema de triagem externo',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.filaLer,
    descricao:
      'Ver o monitor de filas das integrações (saídas, entradas, fila de mortos e a saúde das integrações em uso)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.filaReprocessar,
    descricao: 'Reprocessar, corrigir ou descartar mensagem da fila de mortos (com o motivo, auditado)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.interfaceLer,
    descricao:
      'Consultar as interfaces de equipamento e dos laboratórios de apoio (sem senha de FTP nem chave)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.apoioLer,
    descricao: 'Ver o laboratório de apoio: o de-para de exames, elementos e materiais e a fila de retorno',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN, APOIO],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.apoioConferir,
    descricao:
      'Conferir e aprovar o resultado que voltou do laboratório de apoio antes de gravá-lo no exame (responsável técnico habilitado)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
    exigeConselho: true,
  },
  {
    codigo: C.apoioRemessa,
    descricao:
      'Montar, fechar, enviar ou cancelar a remessa de amostras ao laboratório de apoio e imprimir as etiquetas do apoio',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN, APOIO],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.apoioDePara,
    descricao:
      'Manter o de-para de analito e de material com o laboratório de apoio (desativar, nunca apagar)',

    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN, APOIO],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.prescricaoDigitalLer,
    descricao:
      'Consultar a prescrição digital externa (registro de integração; sem o conteúdo da prescrição)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  // F8 (08-INTG L132): envio da receita assinada à plataforma de prescrição digital e o cancelamento; recurso só do
  // novo, concedido por perfil.
  {
    codigo: C.prescricaoDigitalEnviar,
    descricao:
      'Enviar a receita assinada à plataforma de prescrição digital e cancelar o envio (simulador fora de produção)',
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  // F8 (08-INTG L136): fila com o ERP corporativo (monitor, geração, envio, retorno, conciliação); recurso só do
  // novo, concedido por perfil.
  {
    codigo: C.filaErpLer,
    descricao: 'Consultar a fila com o ERP corporativo: lotes, itens e retorno de cada registro',
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.filaErpOperar,
    descricao:
      'Gerar, enviar, importar o retorno, conciliar e cancelar lotes da fila com o ERP corporativo (simulador fora de produção)',
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
];
