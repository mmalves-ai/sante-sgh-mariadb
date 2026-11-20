// Permissões da agenda de sessões e da digitalização certificada (M50, etapa 6; ficha, seção 7). Quem tem a opção no
// legado tem a permissão no novo (regra 1 do M06). Opções do outro sistema (TBOPCOES, retrato
// tools/verificadores/dados/acesso-legado.pc.json; todas ativas):
//   - Agendamento (módulo 31): Agendamento 4830 › Configurações 4831 (Manutenção/criação de agendas 4834); Agenda de
//     quimioterapia 4842 › Pacientes agendados 4843 (Alterar 4844, Atender 4847, Desagendar 4848), Planejamentos do
//     paciente 4850, Agendar 4852 (Incluir protocolo 4853, Confirmar agendamento 4855), Horários livres 4856. A agenda de
//     quimioterapia do outro sistema é a das cadeiras (AGCADEIRA): a agenda de sessões é a mesma ideia, para qualquer
//     terapia em série;
//   - SAME: Recepção interna (7) › Controle de prontuários 2361 (Manutenção 2362, Controle I 2363, Controle II 2364),
//     Relatório do SAME 2468, Controle de prontuários 2488; PEP (23) › Importação documentos paciente (Anexos) 4635
//     (Inserir arquivo 4636, Visualizar arquivo 4638) e o Utilitário de importação de arquivos 4726 (Inserir 4727,
//     Visualizar 4729). A digitalização com valor legal não existe no outro sistema: as opções são as de quem guarda o
//     prontuário em papel e de quem importa arquivos (inferidas: conferir na validação, D-PERM-506).
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
