// Permissões do M21 (ficha, seção 7; convencoes.md §12): internação (pré-internação, admissão, guias, trocas, alta em
// dois tempos, impressos), mapa de leitos operacional (admitir, transferir, bloquear), higienização (painel,
// solicitações, aplicativo do profissional, inspeção e liberação, cadastros) e SAME (movimentação física). Quem tem a
// opção no legado tem a permissão no novo (regra 1 do M06). Opções da árvore do menu de origem (retrato
// tools/verificadores/dados/acesso-legado.pc.json):
//   - Recepção interna (módulo 7) › Internações 2342: Manutenção 5740 (Alterar 6056, Incluir 6057, Excluir 6058,
//     Consultar 6059, Cancelar 6060); Pré-internação 5741 (6062 a 6065); Transferências de localização 5742 (6066 a
//     6069); Altas 5743 (Alterar 6070, Incluir 6071, Excluir 6072, Consultar 6073, Cancelar 6074); Alterações… 5744
//     (6075 a 6079); Criação de contas/guias/protocolos 2360; Emissão de fichas 2372 e de etiquetas 2373; Fichas a
//     imprimir 2315; Leitos 2322 (Manutenção 2323, Painel de leitos 3990, Controle Central de Leitos 2483); Controle de
//     prontuários 2361 (Manutenção 2362, Controle I 2363, Controle II 2364, Movimentação em lote 4569, Setor 2365,
//     Motivo 2366, Localização 2367, Composição 2368); Relatórios › Relatório do SAME 2468, Controle de prontuários 2488;
//   - Higienização (módulo 37): Parâmetros 5003, Cadastro de áreas 5004, de tipos de ocorrências 5005, de tipos de
//     limpeza 5006, Configuração de checklist 5007, Cadastro de profissionais 5008, de terceirizadas 5009, Vínculo do
//     profissional por área 5010; Painel de leitos 5012, Solicitar limpeza 5013, Gerenciar limpeza 5014,
//     Iniciar/Finalizar limpeza 5015, Checklist de liberação 5016.
// Perfil da trilha do legado (cópia pc, desde 2026-06, só contagens): a admissão na 6057 (188), a transferência na
// 6067 (172), a alta na 6071 (190), a pré-internação na 6063 (55), as alterações na 6075 (5) e o cancelamento da alta
// na 6074 (1). Ato médico (alta médica: Lei 12.842/2013): `internacao.altaMedica.registrar` exige conselho ativo.
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_INTERNACAO = {
  internacoes: 2342,
  manutencao: 5740,
  manutencaoAlterar: 6056,
  manutencaoIncluir: 6057,
  manutencaoExcluir: 6058,
  manutencaoConsultar: 6059,
  manutencaoCancelar: 6060,
  pre: 5741,
  preAlterar: 6062,
  preIncluir: 6063,
  preExcluir: 6064,
  preConsultar: 6065,
  transferencias: 5742,
  transferenciaAlterar: 6066,
  transferenciaIncluir: 6067,
  transferenciaExcluir: 6068,
  transferenciaConsultar: 6069,
  altas: 5743,
  altaAlterar: 6070,
  altaIncluir: 6071,
  altaExcluir: 6072,
  altaConsultar: 6073,
  altaCancelar: 6074,
  alteracoes: 5744,
  alteracaoAlterar: 6075,
  alteracaoIncluir: 6076,
  alteracaoExcluir: 6077,
  alteracaoConsultar: 6078,
  alteracaoCancelar: 6079,
  contasGuias: 2360,
  emissaoFichas: 2372,
  emissaoEtiquetas: 2373,
  fichasImprimir: 2315,
  leitos: 2322,
  leitosManutencao: 2323,
  painelLeitos: 3990,
  controleCentralLeitos: 2483,
  controleProntuarios: 2361,
  prontuariosManutencao: 2362,
  prontuariosControleI: 2363,
  prontuariosControleII: 2364,
  prontuariosLote: 4569,
  prontuariosSetor: 2365,
  prontuariosMotivo: 2366,
  prontuariosLocalizacao: 2367,
  prontuariosComposicao: 2368,
  relatorioSame: 2468,
  relatorioControleProntuarios: 2488,
  higParametros: 5003,
  higAreas: 5004,
  higOcorrencias: 5005,
  higTiposLimpeza: 5006,
  higChecklist: 5007,
  higProfissionais: 5008,
  higTerceirizadas: 5009,
  higVinculoArea: 5010,
  higPainel: 5012,
  higSolicitar: 5013,
  higGerenciar: 5014,
  higIniciarFinalizar: 5015,
  higChecklistLiberacao: 5016,
} as const;

const O = OPCOES_INTERNACAO;

export const PERMISSOES_M21_CODIGOS = {
  internacaoLer: 'internacao.internacao.ler',
  internacaoCriar: 'internacao.internacao.criar',
  internacaoExcluir: 'internacao.internacao.excluir',
  preLer: 'internacao.pre.ler',
  preCriar: 'internacao.pre.criar',
  guiaEditar: 'internacao.guia.editar',
  trocaCriar: 'internacao.troca.criar',
  altaMedica: 'internacao.altaMedica.registrar',
  altaRegistrar: 'internacao.alta.registrar',
  altaCancelar: 'internacao.alta.cancelar',
  impressoEmitir: 'internacao.impresso.emitir',
  mapaLer: 'leitos.mapa.ler',
  transferenciaCriar: 'leitos.transferencia.criar',
  bloqueioCriar: 'leitos.bloqueio.criar',
  limpezaLer: 'hotelaria.limpeza.ler',
  limpezaSolicitar: 'hotelaria.limpeza.solicitar',
  limpezaExecutar: 'hotelaria.limpeza.executar',
  limpezaLiberar: 'hotelaria.limpeza.liberar',
  cadastroEditar: 'hotelaria.cadastro.editar',
  sameLer: 'same.movimento.ler',
  sameCriar: 'same.movimento.criar',
  sameExcluir: 'same.movimento.excluir',
} as const;

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
  categoria: 'administrativa',
  criticidade: 'normal',
  ...extra,
});

const LER_INTERNACAO = [
  O.internacoes,
  O.manutencaoConsultar,
  O.preConsultar,
  O.transferenciaConsultar,
  O.altaConsultar,
  O.alteracaoConsultar,
];

export const PERMISSOES_INTERNACAO_M21: readonly DeclaracaoPermissao[] = [
  p(
    'internacao.internacao.ler',
    'Consultar as internações, a trajetória do paciente, as guias, as trocas e os procedimentos extras',
    LER_INTERNACAO,
  ),
  p(
    'internacao.internacao.criar',
    'Admitir o paciente (nova internação) no leito do mapa, com a pulseira de identificação',
    [O.manutencaoIncluir],
  ),
  p(
    'internacao.internacao.excluir',
    'Excluir a internação aberta por engano (supervisor; apaga conta, guias e períodos: dupla confirmação)',
    [O.manutencaoExcluir, O.manutencaoCancelar],
    { criticidade: 'critica' },
  ),
  p('internacao.pre.ler', 'Ver as pré-internações pendentes e a lista de saneamento das datas', [
    O.pre,
    O.preConsultar,
  ]),
  p('internacao.pre.criar', 'Agendar a pré-internação e corrigir a data prevista (saneamento)', [
    O.preIncluir,
    O.preAlterar,
  ]),
  p(
    'internacao.guia.editar',
    'Registrar as guias e autorizações do convênio da internação (prorrogações)',
    [O.contasGuias, O.manutencaoAlterar],
    { categoria: 'financeira' },
  ),
  p('internacao.troca.criar', 'Trocar o convênio, a clínica, a especialidade ou o médico da internação', [
    O.alteracaoIncluir,
    O.alteracaoAlterar,
  ]),
  p(
    'internacao.altaMedica.registrar',
    'Registrar a alta médica (decisão, motivo e destino; ligada ao sumário de alta): ato médico',
    [O.altaIncluir, O.altaAlterar],
    { categoria: 'clinica', exigeConselho: true },
  ),
  p(
    'internacao.alta.registrar',
    'Dar a saída do paciente (alta administrativa): libera o leito e pede a limpeza',
    [O.altaIncluir, O.altaAlterar],
  ),
  p(
    'internacao.alta.cancelar',
    'Cancelar a alta dada por engano (supervisor; o leito volta à internação)',
    [O.altaCancelar, O.altaExcluir],
    { criticidade: 'critica' },
  ),
  p('internacao.impresso.emitir', 'Emitir as fichas, etiquetas e a pulseira da internação', [
    O.emissaoFichas,
    O.emissaoEtiquetas,
    O.fichasImprimir,
    O.manutencaoIncluir,
  ]),
  p('leitos.mapa.ler', 'Ver o mapa de leitos operacional e o histórico de ocupação (períodos)', [
    O.leitos,
    O.painelLeitos,
    O.controleCentralLeitos,
    O.higPainel,
  ]),
  p('leitos.transferencia.criar', 'Transferir o paciente internado de leito ou de setor', [
    O.transferenciaIncluir,
    O.transferenciaAlterar,
  ]),
  p(
    'leitos.bloqueio.criar',
    'Bloquear e liberar leito no mapa (manutenção, reserva, isolamento) e marcar a precaução',
    [O.leitosManutencao, O.controleCentralLeitos],
  ),
  p('hotelaria.limpeza.ler', 'Ver o painel de higienização em tempo real e as solicitações com o prazo', [
    O.higPainel,
    O.higGerenciar,
  ]),
  p('hotelaria.limpeza.solicitar', 'Solicitar a limpeza do leito (manual ou pelo QR code)', [O.higSolicitar]),
  p(
    'hotelaria.limpeza.executar',
    'Executar a limpeza no aplicativo do profissional (iniciar, pausar, concluir, checklist e foto)',
    [O.higIniciarFinalizar, O.higGerenciar],
  ),
  p(
    'hotelaria.limpeza.liberar',
    'Inspecionar e liberar o leito depois da limpeza (supervisor da higienização ou enfermagem)',
    [O.higChecklistLiberacao, O.higGerenciar],
  ),
  p(
    'hotelaria.cadastro.editar',
    'Manter as áreas, os profissionais, os vínculos e os materiais da higienização',
    [O.higAreas, O.higProfissionais, O.higVinculoArea, O.higTiposLimpeza, O.higChecklist, O.higParametros],
  ),
  p('same.movimento.ler', 'Ver a localização e a linha do tempo de prontuários e contas em papel', [
    O.controleProntuarios,
    O.prontuariosLocalizacao,
    O.relatorioSame,
    O.relatorioControleProntuarios,
  ]),
  p(
    'same.movimento.criar',
    'Registrar a movimentação física de prontuários e contas (leitura do código de barras)',
    [O.prontuariosManutencao, O.prontuariosControleI, O.prontuariosControleII, O.prontuariosLote],
  ),
  p(
    'same.movimento.excluir',
    'Desfazer (exclusão lógica) o último movimento lançado por engano, com o motivo',
    [O.prontuariosManutencao],
    { criticidade: 'sensivel' },
  ),
];
