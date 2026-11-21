import {
  permissaoExecutarRelatorio,
  permissaoExportarRelatorio,
  RELATORIOS_CATALOGO,
} from '../relatorio/catalogo.js';
import type { DeclaracaoPermissao } from './tipos.js';
export const OPCAO_INTERFACEAMENTO = 2964;

const ADMIN = ['administrador-sistema'] as const;

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
  filaLer: 'integracao.fila.ler',
  filaReprocessar: 'integracao.fila.reprocessar',
  interfaceLer: 'sadt.interface.ler',
  apoioLer: 'sadt.apoio.ler',
  apoioConferir: 'sadt.apoio.conferir',
  prescricaoDigitalLer: 'pep.prescricaoDigital.ler',
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
    perfis: [...ADMIN],
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
    codigo: C.prescricaoDigitalLer,
    descricao:
      'Consultar a prescrição digital externa (registro de integração; sem o conteúdo da prescrição)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
];
