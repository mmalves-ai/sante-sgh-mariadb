// Cadastros das agendas de sessões e dos recursos no CRUD genérico (M50, etapa 6; ficha, seção 5, "Receita genérica do
// CRUD para as 8 tabelas do marco": os 2 das sessões; os 6 da portaria são da etapa 5). Pelo catálogo RDB$ e pelo
// levantamento da cópia `pc` (1 linha "não informado" em cada):
//   - agendas de sessões: o banco gera o código (gen_idagenda em laço); nome, tipo de agenda da recepção,
//     unidade de atendimento, situação (A/I, sem CHECK: o perfil vê "A"), atendimento domiciliar
//     (CHECK F/T) e o centro de custo;
//   - recursos de sessão: as cadeiras e salas de cada agenda; o banco gera o código (GEN_IDCADEIRA em laço;
//     CHECK código > 0); a identificação, o tipo e a prioridade, a faixa etária aceita, a complexidade e
//     a duração aceitas (0 = todas) e a situação.
// Opções do outro sistema (menu de origem, módulo Agendamento): Configurações 4831 › Manutenção/criação de agendas 4834 para
// gravar; com a Agenda de quimioterapia 4842 e os Horários livres 4856 para ler (inferidas: conferir na validação).
import type { DominioPublico } from './tipos.js';

const CONFIGURACOES = 4831;
const MANUTENCAO_AGENDAS = 4834;
const AGENDA_QUIMIOTERAPIA = 4842;
const HORARIOS_LIVRES = 4856;

const m50 = (recurso: string, singular: string, plural: string): DominioPublico => ({
  modulo: 'agenda',
  recurso,
  rotulo: { singular, plural },
  subitem: 'sessoesCadastros',
  natureza: 'editavel',
  acoes: ['ler', 'criar', 'editar', 'inativar', 'exportar'],
  opcoesLegado: {
    ler: [CONFIGURACOES, MANUTENCAO_AGENDAS, AGENDA_QUIMIOTERAPIA, HORARIOS_LIVRES],
    exportar: [CONFIGURACOES, MANUTENCAO_AGENDAS, AGENDA_QUIMIOTERAPIA, HORARIOS_LIVRES],
    criar: [MANUTENCAO_AGENDAS],
    editar: [MANUTENCAO_AGENDAS],
    inativar: [MANUTENCAO_AGENDAS],
  },
  origemOpcoes: 'inferida',
  marco: 'M50',
});

export const DOMINIOS_M50_SESSOES: readonly DominioPublico[] = [
  m50('agendaSessao', 'Agenda de sessões', 'Agendas de sessões'),
  m50('recursoSessao', 'Cadeira ou sala', 'Cadeiras e salas'),
];
