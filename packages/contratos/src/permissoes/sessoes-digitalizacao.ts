// Permissões da agenda de sessões e da digitalização certificada (M50, etapa 6; ficha, seção 7). Quem tem a opção no
// menu de origem tem a permissão (regra 1 do M06); a correspondência está em conector/mapa/permissoes.tsv. A agenda de
// sessões generaliza a agenda das cadeiras de quimioterapia para qualquer terapia em série; a digitalização certificada
// segue o controle de prontuários do SAME (serviço de arquivo médico).
// A digitalização com valor legal é recurso próprio: as opções de origem são as de quem guarda o prontuário em papel e
// de quem importa arquivos (inferidas: conferir na validação, D-PERM-506).
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_SESSOES = {
  ler: 'agenda.sessao.ler',
  agendar: 'agenda.sessao.agendar',
} as const;

export const PERMISSOES_DIGITALIZACAO = {
  ler: 'hotelaria.digitalizacao.ler',
  capturar: 'hotelaria.digitalizacao.capturar',
  conferir: 'hotelaria.digitalizacao.conferir',
} as const;

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'administrativa',
  criticidade: 'normal',
  ...extra,
});

export const PERMISSOES_SESSOES_DIGITALIZACAO_M50: readonly DeclaracaoPermissao[] = [
  p(
    PERMISSOES_SESSOES.ler,
    'Ver a agenda de sessões: a grade das cadeiras e salas, as séries e as sessões de cada paciente',
  ),
  p(
    PERMISSOES_SESSOES.agendar,
    'Agendar a série de sessões de um plano terapêutico, registrar a sessão realizada, a falta e o cancelamento',
  ),
  p(
    PERMISSOES_DIGITALIZACAO.ler,
    'Ver a fila da digitalização certificada (lotes, documentos, conferência e assinatura) e abrir o documento digitalizado',

    { criticidade: 'sensivel' },
  ),
  p(
    PERMISSOES_DIGITALIZACAO.capturar,
    'Capturar e indexar o documento em papel do prontuário (PDF do escâner com o resumo SHA-256)',

    { criticidade: 'sensivel' },
  ),
  p(
    PERMISSOES_DIGITALIZACAO.conferir,
    'Conferir a fidelidade do documento digitalizado com o papel e assinar com o certificado ICP-Brasil',

    { criticidade: 'sensivel' },
  ),
];
