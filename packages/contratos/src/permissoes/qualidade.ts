// Permissões do M48, etapa 1 (ficha, seção 7; convencoes.md §12; cap-05b §5.11, Perfis): notificação de incidentes,
// triagem e distribuição pelo NSP, prazos e campos do Notivisa. O outro sistema não tem módulo de qualidade nem de
// segurança do paciente: nenhuma opção da árvore (catalogo-legado.json, pc) trata de incidente; as opções "Notificar
// intercorrência" do PEP (5166, 5184, 5205, 6830) e "Notificação compulsória" (5273...) são de outra coisa (o aviso de
// intercorrência clínica e o agravo da etapa 4). Por isso as permissões são recursos só do novo (regra 3 do M06):
//   - notificar: todo perfil de pessoa (SGH_ACESSO_MAPA_OPCAO; a ficha: "concedida a todo usuário autenticado");
//   - ler, triar, distribuir, devolver e exportar ao Notivisa: o perfil complementar `nucleo-seguranca-paciente`
//     (enfermeiro da qualidade e membros do NSP; concedido pelo gestor de acessos, ADR 0022), conteúdo clínico e
//     sensível (regra 1: restrito ao NSP e aos envolvidos);
//   - a análise e o plano de ação (etapa 2) também aos coordenadores assistenciais (o "gestor da área" que recebe a
//     notificação distribuída, sem ver quem notificou). Coordenador de área administrativa (recepção, hotelaria) entra
//     por concessão individual do perfil do NSP ou pela etapa 2 (D-PERM-48.1, a confirmar com o NSP).
// Escopos: o módulo qualidade não tem escopo do outro sistema (o filtro por área é a distribuição, no serviço).
import { OPCOES_ENFERMAGEM as OE } from './enfermagem.js';
import { OPCOES_INTERNACAO as OI } from './internacao-adt.js';
import { PERFIL_CCIH } from './qualidade-ccih.js';
import type { DeclaracaoPermissao } from './tipos.js';

/** Perfil complementar do Núcleo de Segurança do Paciente (RDC 36/2013, art. 4º). */
export const PERFIL_NSP = 'nucleo-seguranca-paciente';

/** Coordenadores assistenciais que analisam os incidentes da área (cap-05b §5.11, "Gestor da área"). */
export const PERFIS_GESTOR_AREA = [
  'coordenador-medico',
  'coordenador-enfermagem',
  'supervisor-farmacia',
  'supervisor-laboratorio',
] as const;

export const PERMISSOES_QUALIDADE = {
  notificacaoCriar: 'qualidade.notificacao.criar',
  notificacaoLer: 'qualidade.notificacao.ler',
  notificacaoTriar: 'qualidade.notificacao.triar',
  notivisaExportar: 'qualidade.notivisa.exportar',
  analiseLer: 'qualidade.analise.ler',
  analiseRegistrar: 'qualidade.analise.registrar',
  // Etapa 2: tecnovigilância e farmacovigilância (NSP e a farmácia) e o painel do plano de segurança do paciente.
  tecnovigilanciaLer: 'qualidade.tecnovigilancia.ler',
  tecnovigilanciaRegistrar: 'qualidade.tecnovigilancia.registrar',
  protocoloLer: 'qualidade.protocolo.ler',
  // W0-04 (programa CRUD completo): o fechamento e a reabertura com motivo da competência dos indicadores da CCIH
  // (IRAS e dispositivos-dia). As correções e os cancelamentos usam a permissão de registrar de cada recurso.
  competenciaFechar: 'qualidade.competencia.fechar',
  competenciaReabrir: 'qualidade.competencia.reabrir',
  // W0-04 (M1): a aba de dispositivos invasivos do prontuário (o mesmo registro da CCIH), para a enfermagem.
  dispositivoInvasivoLer: 'qualidade.dispositivoInvasivo.ler',
  dispositivoInvasivoRegistrar: 'qualidade.dispositivoInvasivo.registrar',
  // Revisão do W0-04: corrigir ou cancelar o registro clínico de OUTRO autor (dispositivo, checklist do bundle,
  // precaução, sessão de higiene das mãos). A regra é a correção pelo autor (SBIS NGS1.12.01; regras_governanca do
  // pacote); a CCIH corrige o de outro só com esta permissão e a senha (reautenticação), e a trilha guarda quem.
  ccihCorrigirDeOutro: 'qualidade.ccih.corrigirDeOutro',
  // W0-04 (M5): a comissão de revisão de prontuários (sorteio, checklist, revisão, pendência e aval), a resposta do
  // profissional à própria pendência e a leitura do aval pelo SAME.
  revisaoProntuarioLer: 'qualidade.revisaoProntuario.ler',
  revisaoProntuarioRegistrar: 'qualidade.revisaoProntuario.registrar',
  revisaoPendenciaResponder: 'qualidade.revisaoProntuario.responder',
  revisaoAvalLer: 'qualidade.revisaoProntuario.aval',
} as const;

/** A farmácia trata a farmacovigilância com o NSP (cap-05b §5.11, Perfis; D-PERM-48.2). */
export const PERFIS_VIGILANCIA_PRODUTO = ['supervisor-farmacia'] as const;

const C = PERMISSOES_QUALIDADE;

const nsp = (
  codigo: string,
  descricao: string,
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado: [],
  concessaoPorPerfil: 'por-perfil',
  perfis: [PERFIL_NSP],
  categoria: 'clinica',
  criticidade: 'sensivel',
  ...extra,
});

export const PERMISSOES_QUALIDADE_M48: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.notificacaoCriar,
    descricao:
      'Notificar incidente de qualquer tela, com ou sem identificação, e acompanhar a devolutiva pelo número de acompanhamento',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    // Notificar não abre dado clínico: o diálogo mostra só o que a tela de origem já mostrava, e o servidor relê o
    // contexto pelo atendimento sem devolvê-lo.
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  nsp(
    C.notificacaoLer,
    'Consultar as notificações de incidentes, a linha do tempo e quem notificou (só quando não é anônima)',
  ),
  nsp(
    C.notificacaoTriar,
    'Triar a notificação (classificação da OMS, grau e tipo de dano), distribuir ao gestor da área, descartar e dar a devolutiva ao notificador',
  ),
  nsp(
    C.notivisaExportar,
    'Acompanhar os prazos regulatórios, gerar os campos do Notivisa e registrar a transcrição no portal',
  ),
  nsp(
    C.analiseLer,
    'Consultar a análise de causa e o plano de ação das notificações distribuídas (o gestor vê só as da área, sem o notificador)',
    { perfis: [PERFIL_NSP, ...PERFIS_GESTOR_AREA] },
  ),
  nsp(
    C.analiseRegistrar,
    'Registrar a análise de causa (5 porquês, Ishikawa, Protocolo de Londres) e o plano de ação 5W2H',
    { perfis: [PERFIL_NSP, ...PERFIS_GESTOR_AREA] },
  ),
  // Etapa 2 (D-PERM-48.2): a tecnovigilância e a farmacovigilância são do NSP (gerência de risco) com a farmácia; a
  // lista de expostos ao lote traz o atendimento e o paciente (conteúdo clínico). O painel do plano de segurança é
  // agregado (sem pessoa): NSP e os coordenadores assistenciais.
  nsp(
    C.tecnovigilanciaLer,
    'Consultar as queixas técnicas, os eventos adversos de produto, as reações adversas, os alertas sanitários e os pacientes expostos ao lote',
    { perfis: [PERFIL_NSP, ...PERFIS_VIGILANCIA_PRODUTO] },
  ),
  nsp(
    C.tecnovigilanciaRegistrar,
    'Registrar a queixa técnica, o evento adverso de produto, a reação adversa ou o alerta sanitário e o andamento (conduta, Notivisa, encerramento)',
    { perfis: [PERFIL_NSP, ...PERFIS_VIGILANCIA_PRODUTO] },
  ),
  nsp(
    C.protocoloLer,
    'Consultar o painel do plano de segurança do paciente: adesão aos protocolos, notificações, análises e ações (só números agregados)',
    { perfis: [PERFIL_NSP, ...PERFIS_GESTOR_AREA], criticidade: 'normal' },
  ),
  // W0-04: a competência fechada da CCIH (sem norma: padrão adotado, alterar só antes do fechamento e depois reabrir
  // com motivo e trilha). Só a CCIH, como o registro das fichas.
  nsp(
    C.competenciaFechar,
    'Fechar a competência dos indicadores de IRAS e de dispositivos-dia (depois dela, fichas e dispositivos do mês não mudam sem reabertura)',
    { perfis: [PERFIL_CCIH] },
  ),
  // W0-04 (M1): a enfermagem vê e registra os dispositivos invasivos do paciente (inserção, bundle do turno e
  // retirada) pela aba do prontuário, com as opções da monitorização do legado (as mesmas dos sinais vitais).
  {
    codigo: C.dispositivoInvasivoLer,
    descricao:
      'Ver os dispositivos invasivos do paciente internado, com os dias de uso, o bundle por turno e o alerta de permanência',
    opcoesLegado: [OE.monitorizacao, OE.monitorizacaoConsultar, OE.monitorizacaoConsulta],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.dispositivoInvasivoRegistrar,
    descricao:
      'Registrar a inserção, o checklist do bundle do turno e a retirada do dispositivo invasivo do paciente internado',
    opcoesLegado: [OE.incluirSinal, OE.incluirHorarioSinal, OE.confirmarSinal],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  // W0-04 (M5): a comissão de revisão de prontuários é do escritório da qualidade (o perfil complementar
  // `gestao-qualidade`, que secretaria as comissões) com a direção clínica (coordenador médico); a lista traz a
  // internação e o médico assistente (conteúdo sensível). A resposta à pendência é de todo profissional, só da própria
  // (o serviço confere o login). O SAME lê o aval pelas opções do controle de prontuários.
  nsp(
    C.revisaoProntuarioLer,
    'Consultar os sorteios da comissão de revisão de prontuários, as revisões, as pendências e o percentual conforme por clínica',
    { perfis: ['gestao-qualidade', 'coordenador-medico'] },
  ),
  nsp(
    C.revisaoProntuarioRegistrar,
    'Publicar o checklist de completude, sortear os prontuários com alta, revisar, abrir e cancelar pendência e dar o aval da comissão',
    { perfis: ['gestao-qualidade', 'coordenador-medico'] },
  ),
  {
    codigo: C.revisaoPendenciaResponder,
    descricao:
      'Ver e responder as próprias pendências de prontuário apontadas pela comissão de revisão (só as do próprio profissional)',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: C.revisaoAvalLer,
    descricao: 'Ver o aval da comissão de revisão de prontuários pelo número da internação (SAME)',
    opcoesLegado: [OI.controleProntuarios, OI.prontuariosLocalizacao],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  nsp(
    C.ccihCorrigirDeOutro,
    'Corrigir ou cancelar o registro clínico de outro autor (dispositivo invasivo, checklist do bundle, precaução e sessão de higiene das mãos), com a senha',
    { perfis: [PERFIL_CCIH], criticidade: 'critica' },
  ),
  nsp(
    C.competenciaReabrir,
    'Reabrir com motivo a competência fechada dos indicadores de IRAS e de dispositivos-dia',
    { perfis: [PERFIL_CCIH], criticidade: 'critica' },
  ),
];
