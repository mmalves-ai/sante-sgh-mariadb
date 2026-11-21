// Permissões do M34 (ficha, seção 7; convencoes.md §12): catálogo de relatórios parametrizados, triagem dos relatórios
// de SQL livre, pedidos de relatório, envio agendado, as integrações novas (endpoints, FHIR R4 e RNDS, HL7 v2 e o
// motor de integração, parceiros, mensagens pela Hal-AI, monitor de filas), o laboratório de apoio, as interfaces de
// equipamento e a prescrição digital externa. Quem tem a opção no legado tem a permissão no novo (regra 1 do M06).
// Opções da árvore do menu de origem (retrato tools/verificadores/dados/acesso-legado.pc.json):
//   - Editor de relatórios v1.0 4240 e 4246 e v2.0 4243 e 4247 (módulo de abertura e Gerador de relatórios v2.0): o
//     curador e quem configura o envio agendado (o agendamento é do editor); Emissão de relatórios v1.0 4241 e
//     4248, v2.0 4244 e 4249;
//   - cada relatório do catálogo: as opções dos relatórios que ele substitui ("Meus relatórios" de cada módulo e o
//     relatório do usuário: RELATORIOS_CATALOGO.opcoesLegado); o acesso por grupo e usuário de cada relatório de origem
//     (grupos e usuários liberados no relatório) restringe ainda mais na execução (ninguém ganha acesso que não tinha);
//   - Tabelas › Cadastro de Endpoint 6339 (Gerenciamento 6340); S.A.D.T. › Interfaceamento 2964 (as interfaces dos
//     laboratórios de apoio); S.M.S. › Lançamentos 4995 (Enviar 4996, Reenviar 4997, Agendar envio 4998) e Cadastrar
//     cenário 4993;
//   - recursos novos (motor de integração, FHIR e RNDS, parceiros, monitor de filas, triagem): perfil Administrador do
//     sistema (SGH_ACESSO_MAPA_OPCAO), além das opções acima quando o legado tem a tela equivalente.
// Sem permissão de agir própria (D-AGIR-34): ligar ou desligar o canal HL7 v2 é ativar o parceiro dele
// (integracao.parceiro.editar); o endereço da Hal-AI é parâmetro do estabelecimento (a permissão dos Parâmetros do
// sistema) e a credencial fica no cofre; o de-para do apoio é o CRUD genérico (sadt.apoioExame.editar,
// sadt.apoioElemento.editar, sadt.apoioMaterial.editar; a mesma opção 2964). O catálogo não concede permissão que não
// libera nada.
// Conferir na validação com a TI e com o curador do catálogo (DP-3).
import { OPCOES_PRESCRICAO_LER } from './pep.js';
import {
  permissaoExecutarRelatorio,
  permissaoExportarRelatorio,
  RELATORIOS_CATALOGO,
} from '../relatorio/catalogo.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_EDITOR_RELATORIOS = [4240, 4246, 4243, 4247] as const;
export const OPCOES_EMISSAO_RELATORIOS = [4241, 4248, 4244, 4249] as const;
export const OPCOES_ENDPOINT = [6339, 6340] as const;
export const OPCAO_INTERFACEAMENTO = 2964;
export const OPCOES_SMS = [4995, 4996, 4997, 4998, 4993] as const;

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

/** Opções do responsável técnico que libera resultado no legado (M26: registro e especialidade, liberar para a web). */
const OPCOES_LIBERAR_RESULTADO = [6206, 6210, 2972] as const;

function relatorios(): DeclaracaoPermissao[] {
  return RELATORIOS_CATALOGO.flatMap((r) => [
    {
      codigo: permissaoExecutarRelatorio(r.codigo),
      descricao: `Emitir o relatório "${r.titulo}" do catálogo (grade na tela)`,
      opcoesLegado: [...new Set([...r.opcoesLegado, ...OPCOES_EDITOR_RELATORIOS])],
      concessaoPorPerfil: 'por-perfil' as const,
      perfis: [...ADMIN],
      categoria: r.regua ? ('financeira' as const) : ('administrativa' as const),
      criticidade: 'normal' as const,
    },
    {
      codigo: permissaoExportarRelatorio(r.codigo),
      descricao: `Exportar o relatório "${r.titulo}" (planilha, CSV ou PDF; com dado de pessoa, só com justificativa)`,
      opcoesLegado: [...new Set([...r.opcoesLegado, ...OPCOES_EDITOR_RELATORIOS])],
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
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  ...relatorios(),
  {
    codigo: C.dadoPessoalVer,
    descricao:
      'Ver sem máscara as colunas com dado de pessoa (nome do paciente) nos relatórios do catálogo; a exportação pede justificativa',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['assistencial-com-conselho', ...ADMIN],
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: C.triagemLer,
    descricao: 'Ver a triagem dos relatórios de SQL livre (destino, papel dono, artefato e onda de cada um)',
    opcoesLegado: [...OPCOES_EDITOR_RELATORIOS],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.triagemDecidir,
    descricao: 'Confirmar ou mudar o destino de um relatório de SQL livre na triagem (com o motivo)',
    opcoesLegado: [...OPCOES_EDITOR_RELATORIOS],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.pedidoCriar,
    descricao: 'Pedir um relatório novo ao curador do catálogo e acompanhar os próprios pedidos',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.pedidoPublicar,
    descricao: 'Analisar, publicar ou recusar os pedidos de relatório (curador do catálogo)',
    opcoesLegado: [...OPCOES_EDITOR_RELATORIOS],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.agendamentoLer,
    descricao: 'Ver os envios agendados de relatório por e-mail e o histórico dos envios',
    opcoesLegado: [...OPCOES_EDITOR_RELATORIOS],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.agendamentoEditar,
    descricao:
      'Criar, mudar, desativar e enviar agora um envio agendado (o e-mail leva só o link autenticado)',
    opcoesLegado: [...OPCOES_EDITOR_RELATORIOS],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: C.configuracaoLer,
    descricao: 'Consultar os endpoints, webservices e o integrador (sem credenciais)',
    opcoesLegado: [...OPCOES_ENDPOINT],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.fhirLer,
    descricao:
      'Ver a interoperabilidade FHIR R4 e RNDS (perfis BR Core fixados, identificação, envio de vacina)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.fhirEnviar,
    descricao: 'Enviar o recurso de teste ao ambiente de homologação da RNDS (simulador fora de produção)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.hl7Ler,
    descricao:
      'Ver os canais HL7 v2 do motor de integração, as filas HL7 que seguem pelos gatilhos e a classificação externa',
    opcoesLegado: [OPCAO_INTERFACEAMENTO],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.parceiroLer,
    descricao:
      'Ver os parceiros externos (os que leem o banco e os das integrações novas, com finalidade e base legal)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.parceiroEditar,
    descricao:
      'Cadastrar parceiro de integração nova, emitir a credencial (o segredo sai uma vez) e ativar por estabelecimento',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'critica',
  },
  {
    codigo: C.mensagemLer,
    descricao: 'Ver a configuração da comunicação com o paciente (pela Hal-AI) e os domínios das mensagens',
    opcoesLegado: [...OPCOES_SMS],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.filaLer,
    descricao:
      'Ver o monitor de filas das integrações (saídas, entradas, fila de mortos e a saúde das integrações em uso)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.filaReprocessar,
    descricao: 'Reprocessar, corrigir ou descartar mensagem da fila de mortos (com o motivo, auditado)',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.interfaceLer,
    descricao:
      'Consultar as interfaces de equipamento e dos laboratórios de apoio (sem senha de FTP nem chave)',
    opcoesLegado: [OPCAO_INTERFACEAMENTO],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'tecnica',
    criticidade: 'normal',
  },
  {
    codigo: C.apoioLer,
    descricao: 'Ver o laboratório de apoio: o de-para de exames, elementos e materiais e a fila de retorno',
    opcoesLegado: [OPCAO_INTERFACEAMENTO],
    concessaoPorPerfil: 'por-perfil',
    perfis: [...ADMIN],
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  {
    codigo: C.apoioConferir,
    descricao:
      'Conferir e aprovar o resultado que voltou do laboratório de apoio antes de gravá-lo no exame (responsável técnico habilitado)',
    opcoesLegado: [...OPCOES_LIBERAR_RESULTADO],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
    exigeConselho: true,
  },
  {
    codigo: C.prescricaoDigitalLer,
    descricao:
      'Consultar a prescrição digital externa (registro de integração; sem o conteúdo da prescrição)',
    opcoesLegado: [...OPCOES_PRESCRICAO_LER],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
];
