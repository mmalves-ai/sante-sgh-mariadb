// Rotas do M25 (ficha, seção 7): linha do tempo do turno (em tela e no tablet), aprazamento, checagem em tela e por
// código de barras, conflitos de sincronização, sinais vitais (em tela e no tablet), passagem de plantão, aparelhos
// da beira do leito e o índice do CRUD genérico dos procedimentos e kits; o balanço hídrico (M45, etapa 3); o processo de
// enfermagem, a receita do enfermeiro e as vacinas (M45, etapa 4). Cada rota exige a permissão de leitura do
// catálogo (M06); o servidor confere de novo e recusa com o motivo quando a liberação está desligada.
import { rotaDoSubitem } from '@sgh/contratos';
import type { RouteRecordRaw } from 'vue-router';

export const rotasEnfermagem: RouteRecordRaw[] = [
  {
    path: '/enfermagem/turno',
    name: 'enfermagem.turno',
    component: () => import('./telas/TurnoTela.vue'),
    props: { modo: 'tela' },
    meta: { permissao: 'enfermagem.horario.ler' },
  },
  {
    path: '/beira-leito/turno',
    name: 'enfermagem.beiraTurno',
    component: () => import('./telas/TurnoTela.vue'),
    props: { modo: 'beira' },
    meta: { permissao: 'enfermagem.horario.ler' },
  },
  {
    path: '/enfermagem/aprazamento',
    name: 'enfermagem.aprazamento',
    component: () => import('./telas/AprazamentoTela.vue'),
    meta: { permissao: 'enfermagem.horario.ler' },
  },
  {
    path: '/enfermagem/checagem/:atendimentoId(\\d+)',
    name: 'enfermagem.checagem',
    component: () => import('./telas/ChecagemTela.vue'),
    props: true,
    meta: { permissao: 'enfermagem.administracao.ler' },
  },
  {
    path: '/beira-leito/checagem',
    name: 'enfermagem.beiraChecagem',
    component: () => import('./telas/BeiraLeitoTela.vue'),
    meta: { permissao: 'enfermagem.administracao.ler' },
  },
  {
    path: '/enfermagem/conflitos',
    name: 'enfermagem.conflitos',
    component: () => import('./telas/ConflitosTela.vue'),
    meta: { permissao: 'enfermagem.administracao.ler' },
  },
  {
    path: '/enfermagem/paciente/:id(\\d+)/sinais-vitais',
    name: 'enfermagem.sinais',
    component: () => import('./telas/SinaisVitaisTela.vue'),
    props: (r) => ({ id: String(r.params['id'] ?? ''), modo: 'tela' }),
    meta: { permissao: 'enfermagem.sinalVital.ler' },
  },
  {
    path: '/beira-leito/sinais-vitais',
    name: 'enfermagem.beiraSinais',
    component: () => import('./telas/SinaisVitaisTela.vue'),
    props: { modo: 'beira' },
    meta: { permissao: 'enfermagem.sinalVital.ler' },
  },
  {
    path: '/enfermagem/plantao',
    name: 'enfermagem.plantao',
    component: () => import('./telas/PlantaoTela.vue'),
    meta: { permissao: 'enfermagem.plantao.ler' },
  },
  {
    path: '/enfermagem/aparelhos',
    name: 'enfermagem.aparelhos',
    component: () => import('./telas/AparelhosTela.vue'),
    meta: { permissao: 'enfermagem.dispositivo.ler' },
  },
  // M45 (etapa 3): o balanço hídrico (a escolha do paciente e o balanço do atendimento).
  {
    path: '/enfermagem/balanco',
    name: 'enfermagem.balancoEscolha',
    component: () => import('./telas/BalancoTela.vue'),
    meta: { permissao: 'enfermagem.balanco.ler' },
  },
  {
    path: '/enfermagem/balanco/:reg(\\d+)',
    name: 'enfermagem.balanco',
    component: () => import('./telas/BalancoTela.vue'),
    props: true,
    meta: { permissao: 'enfermagem.balanco.ler' },
  },
  // M45 (etapa 2): escores e reavaliações, classificação de pacientes e índices de gravidade da UTI.
  {
    path: '/enfermagem/escores',
    name: 'enfermagem.escores',
    component: () => import('./telas/EscoresTela.vue'),
    meta: { permissao: 'enfermagem.escore.ler', menu: 'Enfermagem > Escores de risco' },
  },
  // Revisão W0-03, mercado M1: a profilaxia de TEV pendente na tela própria de quem prescreve (só a permissão de
  // prescrever; não exige ler os escores da enfermagem). A entrada no menu é do W4-01.
  {
    path: '/enfermagem/escores/profilaxia',
    name: 'enfermagem.escores.profilaxia',
    component: () => import('./telas/ProfilaxiaTevTela.vue'),
    meta: { permissao: 'pep.prescricao.criar' },
  },
  // W0-03, mercado M5: a contenção mecânica (a ordem, a checagem aprazada, a retirada, o alerta e o indicador). A
  // entrada no menu é do W4-01 (dono do menu); o aviso da ordem vencida na central abre esta tela.
  {
    path: '/enfermagem/contencao',
    name: 'enfermagem.contencao',
    component: () => import('./telas/ContencaoTela.vue'),
    // Revisão W0-03: o prescritor (médico) também abre a tela para prescrever, renovar e retirar a ordem.
    meta: { permissao: 'enfermagem.horario.ler', permissaoOu: ['pep.prescricao.criar'] },
  },
  // W0-03, mercado M3: o relógio de protocolos gerenciados no internado (internação e UTI). A entrada no menu é do W4-01;
  // o relógio do PA (recepcao) só ganha o atalho para cá.
  {
    path: '/enfermagem/protocolos',
    name: 'enfermagem.protocolos',
    component: () => import('./telas/ProtocolosInternadoTela.vue'),
    meta: { permissao: 'enfermagem.horario.ler' },
  },
  // C2-042 (03-PEP L134): os critérios de entrada avaliados pelo sistema, o alerta de elegível e as etapas com meta.
  {
    path: '/enfermagem/protocolos-criterios',
    name: 'enfermagem.protocolosCriterios',
    component: () => import('./telas/ProtocoloCriteriosTela.vue'),
    meta: {
      permissao: 'recepcao.protocoloPaciente.ler',
      permissaoOu: ['recepcao.protocolo.ler'],
      menu: 'Enfermagem > Protocolos: critérios e metas',
    },
  },
  // W0-03, mercado M4: as feridas e a lesão por pressão (ficha, curativo, foto, encerramento, inativação e a incidência
  // de LPP). A entrada no menu é do W4-01.
  {
    path: '/enfermagem/feridas',
    name: 'enfermagem.feridas',
    component: () => import('./telas/FeridasTela.vue'),
    meta: { permissao: 'enfermagem.escore.ler' },
  },
  // W0-03, mercado M2: o Time de Resposta Rápida e a ficha da parada (Utstein). A entrada no menu é do W4-01.
  {
    path: '/enfermagem/trr',
    name: 'enfermagem.trr',
    component: () => import('./telas/TrrTela.vue'),
    meta: { permissao: 'enfermagem.escore.ler' },
  },
  {
    path: '/enfermagem/classificacao',
    name: 'enfermagem.classificacao',
    component: () => import('./telas/ClassificacaoPacientesTela.vue'),
    meta: { permissao: 'enfermagem.classificacao.ler', menu: 'Enfermagem > Classificação de pacientes' },
  },
  {
    path: '/pep/uti/indices',
    name: 'pep.uti.indices',
    component: () => import('./telas/IndicesUtiTela.vue'),
    meta: { permissao: 'pep.indiceUti.ler', menu: 'PEP > Índices de gravidade de UTI' },
  },
  {
    path: '/pep/uti/indices/:atendimento(\\d+)',
    name: 'pep.uti.indices.paciente',
    component: () => import('./telas/IndicesUtiTela.vue'),
    props: true,
    meta: { permissao: 'pep.indiceUti.ler' },
  },
  // M45 (etapa 4): o processo de enfermagem (a escolha do paciente e o processo do atendimento), a prescrição de
  // medicamento pelo enfermeiro na consulta de enfermagem e as vacinas aplicadas.
  {
    path: '/enfermagem/sae',
    name: 'enfermagem.saeEscolha',
    component: () => import('./telas/SaeTela.vue'),
    meta: { permissao: 'enfermagem.sae.ler', menu: 'Enfermagem > Processo de enfermagem / SAE' },
  },
  {
    path: '/enfermagem/sae/:reg(\\d+)',
    name: 'enfermagem.sae',
    component: () => import('./telas/SaeTela.vue'),
    props: true,
    meta: { permissao: 'enfermagem.sae.ler' },
  },
  {
    path: '/enfermagem/prescricao-medicamento',
    name: 'enfermagem.prescricaoMedicamentoEscolha',
    component: () => import('./telas/PrescricaoMedicamentoTela.vue'),
    meta: { permissao: 'enfermagem.prescricaoMedicamento.ler' },
  },
  {
    path: '/enfermagem/prescricao-medicamento/:reg(\\d+)',
    name: 'enfermagem.prescricaoMedicamento',
    component: () => import('./telas/PrescricaoMedicamentoTela.vue'),
    props: true,
    meta: { permissao: 'enfermagem.prescricaoMedicamento.ler' },
  },
  {
    path: '/enfermagem/vacinas',
    name: 'enfermagem.vacinasEscolha',
    component: () => import('./telas/VacinasTela.vue'),
    meta: { permissao: 'enfermagem.vacina.ler' },
  },
  {
    path: '/enfermagem/vacinas/:reg(\\d+)',
    name: 'enfermagem.vacinas',
    component: () => import('./telas/VacinasTela.vue'),
    props: true,
    meta: { permissao: 'enfermagem.vacina.ler' },
  },
  // M47 (etapa 1): o ato transfusional à beira do leito (aberto a partir da requisição; a dupla checagem da bolsa).
  {
    path: '/enfermagem/transfusao/:req(\\d+)',
    name: 'enfermagem.transfusao',
    component: () => import('./telas/TransfusaoBeiraLeitoTela.vue'),
    props: true,
    meta: { permissao: 'sadt.transfusao.ler' },
  },
  {
    // Os procedimentos, cuidados e kits são do CRUD genérico: o índice do subitem.
    path: '/cadastros/enfermagem/procedimentos',
    name: 'enfermagem.procedimentos',
    redirect: rotaDoSubitem('enfermagemProcedimentos'),
  },
];
