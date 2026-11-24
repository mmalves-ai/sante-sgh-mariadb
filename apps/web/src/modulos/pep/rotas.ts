// Rotas do prontuário ao vivo (M15; ficha, seção 7): busca e cabeçalho do paciente, registros do paciente,
// registro com as abas e o registro de acesso ao prontuário. Cada rota exige a permissão de leitura do catálogo
// (M06); o servidor confere de novo e pede o motivo de acesso na primeira abertura do paciente.
import type { RouteRecordRaw } from 'vue-router';

const id = '(\\d+)';
/** Código do modelo do formulário (começa por letra: EVAM, M12, ENF091…), distinto do ID do registro. */
const codigo = '([A-Za-z][A-Za-z0-9_-]*)';

export const rotasPep: RouteRecordRaw[] = [
  {
    path: '/pep/prontuario',
    name: 'pep.prontuario',
    component: () => import('./telas/ProntuarioBuscaTela.vue'),
    meta: { permissao: 'pep.prontuario.ler', menu: 'PEP > Prontuário ao vivo: consulta' },
  },
  {
    // Regra 9: relatório agregado das exceções (só contagens), para o arquivo médico e a comissão.
    path: '/pep/prontuario/excecoes',
    name: 'pep.prontuario.excecoes',
    component: () => import('./telas/ExcecoesProntuarioTela.vue'),
    meta: { permissao: 'pep.prontuario.ler' },
  },
  {
    path: `/pep/prontuario/:paciente${id}`,
    name: 'pep.prontuario.paciente',
    component: () => import('./telas/RegistrosPacienteTela.vue'),
    props: true,
    meta: { permissao: 'pep.prontuario.ler' },
  },
  {
    path: `/pep/prontuario/:paciente${id}/registro/:registro${id}`,
    name: 'pep.prontuario.registro',
    component: () => import('./telas/RegistroTela.vue'),
    props: true,
    meta: { permissao: 'pep.prontuario.ler' },
  },
  // M22 (ficha, seção 7): registros clínicos nos modelos do formulário e a administração do PEP.
  {
    path: '/pep/rascunhos',
    name: 'pep.rascunhos',
    component: () => import('./telas/MeusRascunhosTela.vue'),
    meta: {
      permissao: 'pep.evolucao.criar',
      menu: 'PEP > Registros clínicos (anamnese, evolução, escalas, rascunhos)',
    },
  },
  {
    path: `/pep/:paciente${id}/registro`,
    name: 'pep.registro.escolha',
    component: () => import('./telas/EscolhaModeloTela.vue'),
    props: true,
    meta: { permissao: 'pep.evolucao.criar' },
  },
  {
    path: `/pep/:paciente${id}/registro/:id${id}`,
    name: 'pep.registro.ver',
    component: () => import('./telas/RegistroVisualizacaoTela.vue'),
    props: true,
    meta: { permissao: 'pep.evolucao.ler' },
  },
  {
    path: `/pep/:paciente${id}/registro/:modelo${codigo}`,
    name: 'pep.registro.formulario',
    component: () => import('./telas/RegistroClinicoTela.vue'),
    props: true,
    meta: { permissao: 'pep.evolucao.criar' },
  },
  {
    path: '/pep/admin/modelos',
    name: 'pep.admin.modelos',
    component: () => import('./telas/AdminModelosTela.vue'),
    meta: { permissao: 'pep.admin.ler', menu: 'PEP > Administração do PEP > Construtor de formulários' },
  },
  {
    // M45 (etapa 1): o construtor de formulários novos, no mesmo item do menu (evoluído, sem mudar de dono).
    path: '/pep/admin/formularios-novos',
    name: 'pep.admin.formulariosNovos',
    component: () => import('./telas/FormulariosNovosTela.vue'),
    meta: { permissao: 'pep.admin.ler', menu: 'PEP > Administração do PEP > Construtor de formulários' },
  },
  {
    path: '/pep/admin/impressao',
    name: 'pep.admin.impressao',
    component: () => import('./telas/AdminImpressaoTela.vue'),
    meta: {
      permissao: 'pep.admin.ler',
      menu: 'PEP > Administração do PEP > Modelos de impressão e cabeçalhos',
    },
  },
  {
    path: '/pep/admin/tipos',
    name: 'pep.admin.tipos',
    component: () => import('./telas/AdminTiposTela.vue'),
    meta: {
      permissao: 'pep.admin.ler',
      menu: 'PEP > Administração do PEP > Tipos de documento, fluxos de situação e avisos',
    },
  },
  {
    path: '/administracao/auditoria/acessos-prontuario',
    name: 'auditoria.acessos-prontuario',
    component: () => import('./telas/AcessosProntuarioTela.vue'),
    meta: {
      permissao: 'auditoria.acessos.ler',
      menu: 'Administração > Auditoria e privacidade > Registro de acesso ao prontuário',
    },
  },
  // M24 (ficha, seção 7): prescrição eletrônica (CPOE), farmácia clínica, horários-padrão e cadastros em consulta.
  {
    path: '/pep/prescricao',
    name: 'pep.prescricao',
    component: () => import('./telas/PrescricaoInicioTela.vue'),
    props: { destino: 'prescricao' },
    meta: { permissao: 'pep.prescricao.ler', menu: 'PEP > Prescrição médica > Prescrição' },
  },
  {
    path: '/pep/prescricao/hemoterapia',
    name: 'pep.prescricao.hemoterapia',
    component: () => import('./telas/PrescricaoInicioTela.vue'),
    props: { destino: 'hemoterapia' },
    meta: { permissao: 'pep.prescricao.criar', menu: 'PEP > Prescrição médica > Prescrição de hemoterapia' },
  },
  {
    path: '/pep/prescricao/montar',
    name: 'pep.prescricao.montar',
    component: () => import('./telas/PrescricaoInicioTela.vue'),
    props: { destino: 'montar' },
    meta: {
      permissao: 'pep.prescricao.criar',
      menu: 'PEP > Prescrição médica > Aplicar protocolo/kit e copiar a prescrição anterior',
    },
  },
  {
    path: '/pep/prescricao/futura',
    name: 'pep.prescricao.futura',
    component: () => import('./telas/PrescricaoInicioTela.vue'),
    props: { destino: 'futura' },
    meta: {
      permissao: 'pep.prescricao.ler',
      menu: 'PEP > Prescrição médica > Planejamento e prescrição futura',
    },
  },
  {
    path: '/pep/prescricao/alertas',
    name: 'pep.prescricao.alertas',
    component: () => import('./telas/FarmaciaInteracoesTela.vue'),
    props: { consulta: true },
    meta: { permissao: 'pep.regraAlerta.ler', menu: 'PEP > Prescrição médica > Alertas' },
  },
  {
    path: '/pep/prescricao/reconciliacao',
    name: 'pep.prescricao.reconciliacao',
    component: () => import('./telas/PrescricaoInicioTela.vue'),
    props: { destino: 'reconciliacao' },
    meta: {
      permissao: 'pep.reconciliacao.ler',
      menu: 'PEP > Prescrição médica > Reconciliação medicamentosa',
    },
  },
  {
    path: `/pep/paciente/:paciente${id}/prescricao`,
    name: 'pep.prescricao.paciente',
    component: () => import('./telas/PrescricaoTela.vue'),
    props: true,
    meta: { permissao: 'pep.prescricao.ler' },
  },
  {
    path: `/pep/paciente/:paciente${id}/prescricao/nova`,
    name: 'pep.prescricao.editor',
    component: () => import('./telas/PrescricaoEditorTela.vue'),
    props: true,
    meta: { permissao: 'pep.prescricao.criar' },
  },
  {
    path: `/pep/paciente/:paciente${id}/prescricao/futura`,
    name: 'pep.prescricao.paciente.futura',
    component: () => import('./telas/PrescricaoFuturaTela.vue'),
    props: true,
    meta: { permissao: 'pep.prescricao.ler' },
  },
  {
    path: `/pep/paciente/:paciente${id}/prescricao/:id${id}`,
    name: 'pep.prescricao.ver',
    component: () => import('./telas/PrescricaoVerTela.vue'),
    props: true,
    meta: { permissao: 'pep.prescricao.ler' },
  },
  {
    path: `/pep/paciente/:paciente${id}/reconciliacao`,
    name: 'pep.reconciliacao',
    component: () => import('./telas/ReconciliacaoTela.vue'),
    props: true,
    meta: { permissao: 'pep.reconciliacao.ler' },
  },
  {
    path: '/farmacia-clinica/interacoes',
    name: 'farmacia.interacoes',
    component: () => import('./telas/FarmaciaInteracoesTela.vue'),
    meta: {
      permissao: 'pep.regraAlerta.ler',
      menu: 'Farmácia clínica > Interações medicamentosas e validação de dose',
    },
  },
  {
    path: '/farmacia-clinica/antimicrobianos',
    name: 'farmacia.antimicrobianos',
    component: () => import('./telas/AntimicrobianosTela.vue'),
    meta: { permissao: 'pep.antimicrobiano.ler', menu: 'Farmácia clínica > Fichas de antimicrobiano' },
  },
  {
    path: '/cadastros/prescricao/horarios-padrao',
    name: 'cadastros.prescricao.horarios',
    component: () => import('./telas/HorariosPadraoTela.vue'),
    meta: {
      permissao: 'pep.gradeHorario.ler',
      menu: 'Enfermagem > Horários-padrão de medicação por unidade',
    },
  },
  {
    path: '/cadastros/prescricao/protocolos',
    name: 'cadastros.prescricao.protocolos',
    component: () => import('./telas/CadastrosPrescricaoTela.vue'),
    props: { secao: 'protocolos' },
    meta: {
      permissao: 'pep.protocoloPrescricao.ler',
      menu: 'Cadastros > Cadastros clínicos e de prescrição > Protocolos de prescrição',
    },
  },
  {
    path: '/cadastros/prescricao/frequencias',
    name: 'cadastros.prescricao.frequencias',
    component: () => import('./telas/CadastrosPrescricaoTela.vue'),
    props: { secao: 'frequencias' },
    meta: {
      permissao: 'pep.frequenciaDose.ler',
      menu: 'Cadastros > Cadastros clínicos e de prescrição > Frequências, horários relativos e fórmulas de dose',
    },
  },
  {
    path: '/cadastros/prescricao/kits',
    name: 'cadastros.prescricao.kits',
    component: () => import('./telas/CadastrosPrescricaoTela.vue'),
    props: { secao: 'kits' },
    meta: {
      permissao: 'pep.kitPrescricao.ler',
      menu: 'Cadastros > Cadastros clínicos e de prescrição > Kits de medicamentos e de soluções',
    },
  },
  {
    path: '/cadastros/prescricao/receitas-padrao',
    name: 'cadastros.prescricao.receitasPadrao',
    component: () => import('./telas/CadastrosPrescricaoTela.vue'),
    props: { secao: 'receitasPadrao' },
    meta: {
      permissao: 'pep.receitaPadrao.ler',
      menu: 'Cadastros > Cadastros clínicos e de prescrição > Receitas padrão',
    },
  },
  {
    path: '/cadastros/prescricao/itens-nao-padronizados',
    name: 'cadastros.prescricao.naoPadronizados',
    component: () => import('./telas/CadastrosPrescricaoTela.vue'),
    props: { secao: 'naoPadronizados' },
    meta: {
      permissao: 'pep.itemNaoPadronizado.ler',
      menu: 'Cadastros > Cadastros clínicos e de prescrição > Itens não padronizados',
    },
  },
  {
    path: '/cadastros/prescricao/parametros-item',
    name: 'cadastros.prescricao.parametrosItem',
    component: () => import('./telas/CadastrosPrescricaoTela.vue'),
    props: { secao: 'parametrosItem' },
    meta: {
      permissao: 'pep.parametroClinicoItem.ler',
      menu: 'Cadastros > Cadastros clínicos e de prescrição > Parâmetros clínicos e fiscais do item',
    },
  },
  // M23 (ficha, seção 7): prontuário de uso diário (painel, prontuário com cabeçalho fixo e abas, pareceres,
  // pendências de assinatura e a validação pública do documento).
  // F3.3 (L91, L94): regras do prontuário por setor e equipe assistencial do atendimento.
  {
    path: '/pep/prontuario-setor',
    name: 'pep.prontuarioSetor',
    component: () => import('./telas/ConfiguracaoSetorProntuarioTela.vue'),
    meta: { permissao: 'pep.admin.ler' },
  },
  // F3.3 (L124): seções configuráveis do sumário de alta (ordem, obrigatórias, recorte de tempo).
  {
    path: '/pep/sumario-alta/secoes',
    name: 'pep.sumarioAltaSecoes',
    component: () => import('./telas/SumarioAltaSecoesTela.vue'),
    meta: { permissao: 'pep.admin.ler' },
  },
  {
    path: `/pep/equipe/:atendimento${id}`,
    name: 'pep.equipe',
    component: () => import('./telas/EquipeAssistencialTela.vue'),
    props: true,
    meta: { permissao: 'pep.painel.ler' },
  },
  {
    path: '/pep/pacientes',
    name: 'pep.pacientes',
    component: () => import('./telas/MeusPacientesTela.vue'),
    meta: {
      permissao: 'pep.painel.ler',
      menu: 'PEP > Painel e localização de pacientes (favoritos, filtros)',
    },
  },
  {
    path: `/pep/paciente/:paciente${id}`,
    component: () => import('./telas/ProntuarioPacienteTela.vue'),
    props: true,
    meta: {
      permissao: 'pep.prontuario.ler',
      menu: 'Início > Contexto do paciente (cabeçalho fixo e linha do tempo)',
    },
    children: [
      {
        path: '',
        name: 'pep.paciente',
        redirect: (r) => `/pep/paciente/${String(r.params['paciente'])}/linha-do-tempo`,
      },
      {
        path: 'linha-do-tempo',
        name: 'pep.paciente.linha-do-tempo',
        component: () => import('./telas/abas/AbaLinhaTempo.vue'),
        meta: { permissao: 'pep.prontuario.ler' },
      },
      {
        path: 'alergias',
        name: 'pep.paciente.alergias',
        component: () => import('./telas/abas/AbaAlergias.vue'),
        meta: { permissao: 'pep.alergia.ler' },
      },
      {
        path: 'problemas',
        name: 'pep.paciente.problemas',
        component: () => import('./telas/abas/AbaProblemas.vue'),
        meta: { permissao: 'pep.problema.ler' },
      },
      {
        path: 'exames',
        name: 'pep.paciente.exames',
        component: () => import('./telas/abas/AbaExames.vue'),
        meta: { permissao: 'pep.pedidoExame.ler' },
      },
      { path: 'exames/solicitar', redirect: (r) => `/pep/paciente/${String(r.params['paciente'])}/exames` },
      {
        path: 'resultados',
        name: 'pep.paciente.resultados',
        component: () => import('./telas/abas/AbaResultados.vue'),
        meta: { permissao: 'pep.resultado.ler' },
      },
      {
        path: 'receitas',
        name: 'pep.paciente.receitas',
        component: () => import('./telas/abas/AbaReceitas.vue'),
        meta: { permissao: 'pep.receita.ler' },
      },
      {
        path: 'atestados',
        name: 'pep.paciente.atestados',
        component: () => import('./telas/abas/AbaAtestados.vue'),
        meta: { permissao: 'pep.atestado.ler' },
      },
      {
        path: 'tcle',
        name: 'pep.paciente.tcle',
        component: () => import('./telas/abas/AbaTcle.vue'),
        meta: { permissao: 'pep.tcle.ler' },
      },
      {
        path: 'alta',
        name: 'pep.paciente.alta',
        component: () => import('./telas/abas/AbaAlta.vue'),
        meta: { permissao: 'pep.sumarioAlta.ler' },
      },
      {
        path: 'anexos',
        name: 'pep.paciente.anexos',
        component: () => import('./telas/abas/AbaAnexos.vue'),
        meta: { permissao: 'pep.anexo.ler' },
      },
      {
        path: 'tempos',
        name: 'pep.paciente.tempos',
        component: () => import('./telas/abas/AbaTempos.vue'),
        meta: { permissao: 'pep.tempoEvento.ler' },
      },
      {
        // W0-04 (M1): os dispositivos invasivos do internado (o mesmo registro da CCIH): bundle e alerta.
        path: 'dispositivos',
        name: 'pep.paciente.dispositivos',
        component: () => import('../qualidade/ccih/componentes/AbaDispositivos.vue'),
        meta: { permissao: 'qualidade.dispositivoInvasivo.ler' },
      },
    ],
  },
  {
    // Evoluções multiprofissionais: os modelos do CBO do profissional, no formulário do M22.
    path: `/pep/paciente/:paciente${id}/registros/novo`,
    redirect: (r) => ({ path: `/pep/${String(r.params['paciente'])}/registro`, query: r.query }),
    meta: { permissao: 'pep.evolucao.criar' },
  },
  {
    path: '/pep/interconsultas',
    name: 'pep.interconsultas',
    component: () => import('./telas/InterconsultasTela.vue'),
    meta: { permissao: 'pep.interconsulta.ler', menu: 'PEP > Parecer e interconsulta' },
  },
  {
    path: '/inicio/assinaturas',
    name: 'inicio.assinaturas',
    component: () => import('./telas/AssinaturasTela.vue'),
    meta: {
      permissao: 'documento.documento.ler',
      menu: 'Início > Pendências de assinatura (assinar em lote)',
    },
  },
  {
    path: '/validar/:documento([A-Za-z0-9_-]{16,64})',
    name: 'documento.validar',
    component: () => import('./telas/ValidarDocumentoTela.vue'),
    props: true,
    meta: { publica: true },
  },
];
