// Permissões da agenda de sessões e da digitalização certificada (M50, etapa 6; ficha, seção 7). Quem tem a opção no
// menu de origem tem a permissão (regra 1 do M06); a correspondência está em conector/mapa/permissoes.tsv. A agenda de
// sessões generaliza a agenda das cadeiras de quimioterapia para qualquer terapia em série; a digitalização certificada
// segue o controle de prontuários do SAME (serviço de arquivo médico). Os números em OPCOES_* ficam até a etapa
// coordenada que tira a procedência da declaração (padroes.md da F2.4, seção 5).
// A digitalização com valor legal é recurso próprio: as opções de origem são as de quem guarda o prontuário em papel e
// de quem importa arquivos (inferidas: conferir na validação, D-PERM-506).
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_SESSOES = {
  agendamento: 4830,
  configuracoes: 4831,
  manutencaoAgendas: 4834,
  agendaQuimioterapia: 4842,
  pacientesAgendados: 4843,
  alterar: 4844,
  atender: 4847,
  desagendar: 4848,
  planejamentos: 4850,
  agendar: 4852,
  incluirProtocolo: 4853,
  confirmar: 4855,
  horariosLivres: 4856,
} as const;

export const OPCOES_DIGITALIZACAO = {
  controleProntuarios: 2361,
  prontuariosManutencao: 2362,
  prontuariosControleI: 2363,
  prontuariosControleII: 2364,
  relatorioSame: 2468,
  relatorioControleProntuarios: 2488,
  importacaoAnexos: 4635,
  inserirArquivo: 4636,
  visualizarArquivo: 4638,
  utilitarioImportacao: 4726,
  utilitarioInserir: 4727,
  utilitarioVisualizar: 4729,
} as const;

export const PERMISSOES_SESSOES = {
  ler: 'agenda.sessao.ler',
  agendar: 'agenda.sessao.agendar',
} as const;

export const PERMISSOES_DIGITALIZACAO = {
  ler: 'hotelaria.digitalizacao.ler',
  capturar: 'hotelaria.digitalizacao.capturar',
  conferir: 'hotelaria.digitalizacao.conferir',
} as const;

const S = OPCOES_SESSOES;
const D = OPCOES_DIGITALIZACAO;

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

export const PERMISSOES_SESSOES_DIGITALIZACAO_M50: readonly DeclaracaoPermissao[] = [
  p(
    PERMISSOES_SESSOES.ler,
    'Ver a agenda de sessões: a grade das cadeiras e salas, as séries e as sessões de cada paciente',
    [S.agendamento, S.agendaQuimioterapia, S.pacientesAgendados, S.planejamentos, S.horariosLivres],
  ),
  p(
    PERMISSOES_SESSOES.agendar,
    'Agendar a série de sessões de um plano terapêutico, registrar a sessão realizada, a falta e o cancelamento',
    [S.agendar, S.incluirProtocolo, S.confirmar, S.alterar, S.atender, S.desagendar],
  ),
  p(
    PERMISSOES_DIGITALIZACAO.ler,
    'Ver a fila da digitalização certificada (lotes, documentos, conferência e assinatura) e abrir o documento digitalizado',
    [
      D.controleProntuarios,
      D.relatorioSame,
      D.relatorioControleProntuarios,
      D.importacaoAnexos,
      D.visualizarArquivo,
      D.utilitarioVisualizar,
    ],
    { criticidade: 'sensivel' },
  ),
  p(
    PERMISSOES_DIGITALIZACAO.capturar,
    'Capturar e indexar o documento em papel do prontuário (PDF do escâner com o resumo SHA-256)',
    [D.prontuariosManutencao, D.inserirArquivo, D.utilitarioInserir],
    { criticidade: 'sensivel' },
  ),
  p(
    PERMISSOES_DIGITALIZACAO.conferir,
    'Conferir a fidelidade do documento digitalizado com o papel e assinar com o certificado ICP-Brasil',
    [D.prontuariosControleI, D.prontuariosControleII, D.utilitarioImportacao],
    { criticidade: 'sensivel' },
  ),
];
