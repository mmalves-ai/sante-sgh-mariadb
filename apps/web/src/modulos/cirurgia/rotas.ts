// Rotas do centro cirúrgico (M18; ficha, seção 7). Cada rota exige a permissão de leitura do catálogo (M06); o
// servidor confere de novo (inclusive a sala permitida) e as ações aparecem só com a permissão de agir e a
// funcionalidade liberada.
import type { RouteRecordRaw } from 'vue-router';

const id = '(\\d+)';
const M = 'Centro cirúrgico';

export const rotasCirurgia: RouteRecordRaw[] = [
  {
    path: '/cirurgia/mapa',
    name: 'cirurgia.mapa',
    component: () => import('./telas/MapaCirurgicoTela.vue'),
    meta: { permissao: 'cirurgia.agenda.ler', menu: `${M} > Agenda cirúrgica` },
  },
  {
    path: `/cirurgia/agendamentos/:id${id}`,
    name: 'cirurgia.agendamento',
    component: () => import('./telas/AgendamentoCirurgicoTela.vue'),
    props: (r) => ({ id: r.params['id'], tipo: 'agendamento' }),
    meta: { permissao: 'cirurgia.agenda.ler' },
  },
  {
    path: `/cirurgia/solicitacoes/:id${id}`,
    name: 'cirurgia.solicitacao',
    component: () => import('./telas/AgendamentoCirurgicoTela.vue'),
    props: (r) => ({ id: r.params['id'], tipo: 'solicitacao' }),
    meta: { permissao: 'cirurgia.agenda.ler' },
  },
  {
    path: '/cirurgia/cancelamentos',
    name: 'cirurgia.cancelamentos',
    component: () => import('./telas/CancelamentosCirurgiaTela.vue'),
    meta: { permissao: 'cirurgia.agenda.ler' },
  },
  {
    path: '/cirurgia/registro',
    name: 'cirurgia.registro',
    component: () => import('./telas/RegistroCirurgiaTela.vue'),
    meta: { permissao: 'cirurgia.registro.ler', menu: `${M} > Registro de cirurgia` },
  },
  {
    // F3.4-5, 04-CC L100: gasto de sala do ato (sugestão pela lista padrão, conferência e débito na conta).
    path: `/cirurgia/gasto-sala/:ato${id}?`,
    name: 'cirurgia.gasto-sala',
    component: () => import('./telas/GastoSalaTela.vue'),
    props: (r) => ({ ato: r.params['ato'] ?? '' }),
    meta: { permissao: 'cirurgia.registro.ler', menu: `${M} > Gasto de sala` },
  },
  {
    // F3.4-3, 04-CC L91: cadastro do texto padrão da descrição cirúrgica.
    path: '/cirurgia/textos-padrao',
    name: 'cirurgia.textos-padrao',
    component: () => import('./telas/TextosPadraoTela.vue'),
    meta: { permissao: 'cirurgia.registro.ler', menu: `${M} > Textos padrão da descrição` },
  },
  {
    // F8, 04-CC L105: cartão de preferência do cirurgião (sugestão para o mapa e o gasto de sala).
    path: '/cirurgia/cartoes-preferencia',
    name: 'cirurgia.cartoes-preferencia',
    component: () => import('./telas/CartoesPreferenciaTela.vue'),
    meta: { permissao: 'cirurgia.registro.ler', menu: `${M} > Cartões de preferência do cirurgião` },
  },
  // M46 (etapa 1): APA, ficha anestésica e SRPA (a escrita sob a chave bloco.ficha; a leitura pela permissão).
  {
    path: `/bloco/apa/:agenda${id}?`,
    name: 'bloco.apa',
    component: () => import('./telas/ApaTela.vue'),
    props: (r) => ({ agenda: r.params['agenda'] ?? '' }),
    meta: { permissao: 'cirurgia.apa.ler', menu: `${M} > Avaliação pré-anestésica` },
  },
  {
    path: `/bloco/ficha-anestesica/:agenda${id}?`,
    name: 'bloco.ficha',
    component: () => import('./telas/FichaAnestesicaTela.vue'),
    props: (r) => ({ agenda: r.params['agenda'] ?? '' }),
    meta: { permissao: 'cirurgia.fichaAnestesica.ler', menu: `${M} > Ficha anestésica` },
  },
  {
    path: '/bloco/srpa',
    name: 'bloco.srpa',
    component: () => import('./telas/SrpaTela.vue'),
    meta: { permissao: 'cirurgia.srpa.ler', menu: `${M} > Recuperação pós-anestésica` },
  },
  // M46 (etapa 2): checklist de cirurgia segura, quadro do bloco com o rastreio (a escrita sob as chaves
  // bloco.checklistFormulario e bloco.rastreio; a leitura pela permissão) e o painel para familiares (aparelho).
  {
    path: `/bloco/checklist/:agenda${id}?`,
    name: 'bloco.checklist',
    component: () => import('./telas/ChecklistTela.vue'),
    props: (r) => ({ agenda: r.params['agenda'] ?? '' }),
    meta: { permissao: 'cirurgia.checklist.ler', menu: `${M} > Checklist de cirurgia segura` },
  },
  {
    path: '/bloco/rastreio',
    name: 'bloco.rastreio',
    component: () => import('./telas/RastreioBlocoTela.vue'),
    meta: { permissao: 'cirurgia.rastreio.ler', menu: `${M} > Rastreio do paciente no bloco` },
  },
  // Tela de aparelho: sem casca, sem sessão de pessoa (o token do dispositivo, conferido no servidor).
  {
    path: '/paineis/bloco-familia/:dispositivo(\\d+)',
    name: 'dispositivo.blocoFamilia',
    component: () => import('./telas/PainelBlocoFamiliaTela.vue'),
    props: true,
    meta: { publica: true, dispositivo: true },
  },
  {
    path: '/cirurgia/salas',
    name: 'cirurgia.salas',
    component: () => import('./telas/SalasCirurgicasTela.vue'),
    meta: { permissao: 'cirurgia.sala.ler', menu: `${M} > Salas cirúrgicas e usuários permitidos` },
  },
];
