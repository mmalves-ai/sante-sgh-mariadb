// Permissões do M20 (ficha, seção 7; convencoes.md §12): atendimento externo e pronto atendimento. Quem tem a opção no
// legado tem a permissão no novo (regra 1 do M06). Opções da árvore TBOPCOES (retrato
// tools/verificadores/dados/acesso-legado.pc.json):
//   - Recepção externa (módulo 8) › Cadastros › Atendimentos 5739 (Alterar 5746, Incluir 5745, Excluir 5747, Consultar
//     6026, Cancelar 6028); Lista de atendimentos 6543; Atendimentos anteriores 3299; Alteração de convênio 3291;
//     Lançamento rápido - faturamento 3294; Emissão de fichas 3257; Emissão de etiquetas 3292; Fichas a imprimir 3230;
//     Etiquetas a imprimir 3239; Tabelas › Parâmetros 3221 (Alterar 6001, Consultar 6004); Leitos 4552 (Painel de leitos 4555; Entrada 6010, Alterar 6011, Incluir 6012,
//     Consultar 6014; Transferência 6015; Alta 6020); Estatísticas 3293;
//   - S.A.D.T. (módulo 9) › Lançamentos › Atendimentos › Externo (Alterar 6103, Incluir 6104, Consultar 6106) e
//     Laboratório › Incluir 6116; Atendimentos 2728, Controle de atendimentos 2781;
//   - P.E.P. (módulo 23) › Movimentações › Localizar paciente 3900 (Chamar paciente 5149, Liberar paciente 5147);
//     Liberar paciente no menu rápido 4645.
// Perfil da trilha do legado (cópia pc, 2026-06 a 2026-07, só contagens): a abertura é registrada na opção 5745
// (3.017) ou 6104 (1.293), tipo 2; a alteração na 5746 (112). O quadro do PA é recurso só do novo: a leitura segue
// quem localiza o paciente e consulta atendimentos. Ato médico (alta, internação, transferência, óbito: Lei
// 12.842/2013) exige conselho ativo (ATO-01): `atendimento.desfecho.medico` e `pa.desfecho.registrar`.
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_ATENDIMENTO = {
  atendimentos: 5739,
  atendimentosAlterar: 5746,
  atendimentosIncluir: 5745,
  atendimentosExcluir: 5747,
  atendimentosConsultar: 6026,
  atendimentosCancelar: 6028,
  listaAtendimentos: 6543,
  atendimentosAnteriores: 3299,
  alteracaoConvenio: 3291,
  lancamentoRapido: 3294,
  emissaoFichas: 3257,
  emissaoEtiquetas: 3292,
  fichasImprimir: 3230,
  etiquetasImprimir: 3239,
  leitos: 4552,
  painelLeitos: 4555,
  leitoEntrada: 6010,
  leitoEntradaAlterar: 6011,
  leitoEntradaIncluir: 6012,
  leitoEntradaConsultar: 6014,
  leitoTransferencia: 6015,
  leitoAlta: 6020,
  estatisticas: 3293,
  parametros: 3221,
  parametrosAlterar: 6001,
  parametrosConsultar: 6004,
  sadtExternoAlterar: 6103,
  sadtExternoIncluir: 6104,
  sadtExternoConsultar: 6106,
  sadtLaboratorioIncluir: 6116,
  sadtAtendimentos: 2728,
  sadtControle: 2781,
  localizarPaciente: 3900,
  chamarPaciente: 5149,
  liberarPaciente: 5147,
  liberarPacienteRapido: 4645,
} as const;

const O = OPCOES_ATENDIMENTO;

export const PERMISSOES_ATENDIMENTO_CODIGOS = {
  atendimentoLer: 'atendimento.atendimento.ler',
  atendimentoAbrir: 'atendimento.atendimento.abrir',
  atendimentoEncerrar: 'atendimento.atendimento.encerrar',
  atendimentoCancelar: 'atendimento.atendimento.cancelar',
  desfechoMedico: 'atendimento.desfecho.medico',
  seguradoEditar: 'atendimento.segurado.editar',
  procedimentoLancar: 'atendimento.procedimento.lancar',
  filaLer: 'atendimento.fila.ler',
  filaConduzir: 'atendimento.fila.conduzir',
  impressoEmitir: 'atendimento.impresso.emitir',
  indicadorLer: 'atendimento.indicador.ler',
  herancaEditar: 'atendimento.heranca.editar',
  paQuadroLer: 'pa.quadro.ler',
  paEtapaRegistrar: 'pa.etapa.registrar',
  paObservacaoLer: 'pa.observacao.ler',
  paObservacaoAlocar: 'pa.observacao.alocar',
  paDesfechoRegistrar: 'pa.desfecho.registrar',
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

const LER_ATENDIMENTO = [
  O.atendimentos,
  O.atendimentosConsultar,
  O.listaAtendimentos,
  O.atendimentosAnteriores,
  O.sadtExternoConsultar,
  O.sadtAtendimentos,
  O.sadtControle,
  O.localizarPaciente,
];

export const PERMISSOES_ATENDIMENTO_M20: readonly DeclaracaoPermissao[] = [
  p(
    'atendimento.atendimento.ler',
    'Consultar os atendimentos externos do dia e a ficha do atendimento',
    LER_ATENDIMENTO,
  ),
  p(
    'atendimento.atendimento.abrir',
    'Abrir atendimento externo (ambulatório, pronto atendimento, central de exames, requisição de laboratório)',
    [O.atendimentosIncluir, O.sadtExternoIncluir, O.sadtLaboratorioIncluir],
  ),
  p(
    'atendimento.atendimento.encerrar',
    'Encerrar o atendimento com desfecho administrativo (evasão, encerramento) e liberar o paciente do local',
    [O.atendimentosAlterar, O.liberarPaciente, O.liberarPacienteRapido, O.sadtExternoAlterar],
  ),
  p(
    'atendimento.atendimento.cancelar',
    'Excluir atendimento aberto por engano (supervisor; motivo e justificativa; mostra o que será desfeito)',
    [O.atendimentosExcluir, O.atendimentosCancelar],
    { criticidade: 'critica' },
  ),
  p(
    'atendimento.desfecho.medico',
    'Registrar desfecho clínico do atendimento externo (alta, encaminhamento, internação, transferência, óbito)',
    [O.liberarPaciente, O.liberarPacienteRapido],
    { categoria: 'clinica', exigeConselho: true },
  ),
  p(
    'atendimento.segurado.editar',
    'Corrigir o atendimento aberto (convênio, profissional, especialidade, procedimento, CID, solicitante, responsável, observação, caráter, carteirinha, guia, senha e plano), com justificativa',
    [O.atendimentosAlterar, O.alteracaoConvenio, O.sadtExternoAlterar],
  ),
  p(
    'atendimento.procedimento.lancar',
    'Lançar, corrigir e estornar procedimento extra no atendimento externo com a conta aberta (conferindo antes a situação da conta)',
    [O.atendimentosAlterar, O.lancamentoRapido, O.sadtExternoAlterar],
    { categoria: 'financeira' },
  ),
  p(
    'atendimento.fila.ler',
    'Ver a fila do consultório (pacientes do dia do local, agendados e espontâneos)',
    [O.localizarPaciente, O.chamarPaciente, O.liberarPaciente, O.atendimentosConsultar],
  ),
  // A escrita da fila (chamar ao consultório e iniciar o atendimento grava a senha e o fluxo do paciente): só quem
  // chama ou libera o paciente no legado. Localizar paciente (3900) e Atendimentos › Consultar (6026) só leem.
  p(
    'atendimento.fila.conduzir',
    'Chamar o paciente ao consultório e iniciar o atendimento (a senha e o fluxo do paciente no local)',
    [O.chamarPaciente, O.liberarPaciente],
    { categoria: 'clinica' },
  ),
  p('atendimento.impresso.emitir', 'Emitir ficha, etiquetas e pulseira de identificação do atendimento', [
    O.emissaoFichas,
    O.emissaoEtiquetas,
    O.fichasImprimir,
    O.etiquetasImprimir,
    O.atendimentosIncluir,
  ]),
  p('atendimento.indicador.ler', 'Ver os indicadores do ambulatório e do pronto atendimento', [
    O.estatisticas,
  ]),
  p(
    'atendimento.heranca.editar',
    'Configurar o que a ficha nova copia do atendimento anterior do paciente (convênio, profissional, carteirinha…)',
    [O.parametros, O.parametrosAlterar],
  ),
  p('pa.quadro.ler', 'Ver o quadro de acompanhamento do pronto atendimento por etapa, com os tempos', [
    O.localizarPaciente,
    O.atendimentosConsultar,
    O.painelLeitos,
  ]),
  p(
    'pa.etapa.registrar',
    'Registrar a etapa do paciente no quadro do pronto atendimento (atendimento médico, exames, reavaliação)',
    [O.chamarPaciente, O.liberarPaciente, O.localizarPaciente],
    { categoria: 'clinica' },
  ),
  p('pa.observacao.ler', 'Ver os leitos e poltronas de observação do pronto atendimento e a ocupação', [
    O.leitos,
    O.painelLeitos,
    O.leitoEntradaConsultar,
  ]),
  p(
    'pa.observacao.alocar',
    'Pôr e tirar o paciente do leito ou poltrona de observação (alerta de 24 horas)',
    [O.leitoEntrada, O.leitoEntradaIncluir, O.leitoEntradaAlterar, O.leitoTransferencia, O.leitoAlta],
    { categoria: 'clinica' },
  ),
  p(
    'pa.desfecho.registrar',
    'Registrar o desfecho do pronto atendimento (a evasão e o encerramento; o ato médico exige também o desfecho clínico)',
    [O.liberarPaciente, O.liberarPacienteRapido, O.leitoAlta],
    { categoria: 'clinica' },
  ),
];
