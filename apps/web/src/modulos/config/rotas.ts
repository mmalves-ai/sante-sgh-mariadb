// Rotas do módulo config (M02). Até a casca e o menu do M07 (e o login do M05), abrem só em dev.
// Permissões: config.schema.ler / config.schema.verificar, config.estabelecimento.ler e (M03)
// config.assinatura.ler e (M04) config.gravacao.ler / config.conexao.ler (@sgh/contratos).
import type { RouteRecordRaw } from 'vue-router';

export const rotasConfig: RouteRecordRaw[] = [
  // C2-025 (01-ADM L98): o que falta para operar (diagnóstico, implantação, metas e checklist padrão).
  {
    path: '/administracao/implantacao',
    name: 'config.implantacao.kit',
    component: () => import('./telas/KitImplantacaoTela.vue'),
    meta: { permissao: 'implantacao.kit.ler' },
  },
  {
    path: '/administracao/coexistencia/schema',
    name: 'config.schema',
    component: () => import('./telas/SchemaTela.vue'),
    meta: {
      permissao: 'config.schema.ler',
      menu: 'Administração > Coexistência com o legado > Verificação de schema dos dois bancos (versão congelada)',
    },
  },
  {
    path: '/administracao/coexistencia/assinaturas',
    name: 'config.assinaturas',
    component: () => import('./telas/AssinaturasTela.vue'),
    meta: {
      permissao: 'config.assinatura.ler',
      menu: 'Administração > Coexistência com o legado > Testes de assinatura de dados (Sante SGH × legado)',
    },
  },
  // M35: "Prontidão por setor", aba da tela de testes de assinatura (o mesmo item da árvore; sem item próprio).
  {
    path: '/administracao/coexistencia/prontidao',
    name: 'config.prontidao',
    component: () => import('./telas/ProntidaoTela.vue'),
    meta: { permissao: 'config.coexistencia.ler' },
  },
  // M04: conferência de gravação e saúde das conexões (só leitura).
  {
    path: '/administracao/coexistencia/gravacao',
    name: 'config.gravacao',
    component: () => import('./telas/GravacaoTela.vue'),
    meta: {
      permissao: 'config.gravacao.ler',
      menu: 'Administração > Coexistência com o legado > Conferência de gravação (triggers, generators, sentinelas)',
    },
  },
  {
    path: '/administracao/coexistencia/conexoes',
    name: 'config.conexoes',
    component: () => import('./telas/ConexoesTela.vue'),
    meta: {
      permissao: 'config.conexao.ler',
      menu: 'Administração > Coexistência com o legado > Saúde das conexões e avisos de colisão',
    },
  },
  {
    path: '/administracao/coexistencia/estabelecimentos',
    name: 'config.estabelecimentos',
    component: () => import('./telas/EstabelecimentosTela.vue'),
    meta: {
      permissao: 'config.estabelecimento.ler',
      menu: 'Administração > Coexistência com o legado > Estabelecimentos da Rede (uma conexão por hospital)',
    },
  },
];

// M09: atalhos para os painéis de saúde no Grafana (127.0.0.1:3330). Permissão sistema.saude.ler.
rotasConfig.push(
  {
    path: '/administracao/coexistencia/saude',
    name: 'config.saude-banco',
    component: () => import('./telas/SaudePaineisTela.vue'),
    props: { painel: 'banco' },
    // O item da árvore é a tela do M04 (/administracao/coexistencia/conexoes); este atalho do M09 abre dela.
    meta: { permissao: 'sistema.saude.ler' },
  },
  {
    path: '/administracao/saude',
    name: 'config.saude-sistema',
    component: () => import('./telas/SaudePaineisTela.vue'),
    props: { painel: 'sistema' },
    meta: { permissao: 'sistema.saude.ler', menu: 'Administração > Saúde do sistema (observabilidade)' },
  },
);

// M08: CRUD genérico (índice, índice por subitem do menu e a tela gerada de cada domínio), parâmetros
// hierárquicos e funcionalidades por estabelecimento (POL-3). A permissão de cada domínio
// (<modulo>.<recurso>.<acao>) é conferida pela API e pela tela (ações visíveis só com a permissão).
rotasConfig.push(
  {
    path: '/cadastros/dominios',
    name: 'config.dominios',
    component: () => import('./telas/DominiosIndiceTela.vue'),
    meta: {
      permissao: 'config.dominio.ler',
      menu: 'Cadastros > Domínios e tabelas auxiliares (CRUD genérico)',
    },
  },
  {
    path: '/cadastros/dominios/grupo/:subitem',
    name: 'config.dominios.grupo',
    component: () => import('./telas/DominiosIndiceTela.vue'),
    props: true,
    meta: { permissao: 'config.dominio.ler' },
  },
  {
    path: '/cadastros/dominios/:modulo/:recurso',
    name: 'config.dominio',
    component: () => import('./telas/DominioTela.vue'),
    props: true,
    meta: { permissao: 'config.dominio.ler' },
  },
  {
    path: '/administracao/parametros',
    name: 'config.parametros',
    component: () => import('./telas/ParametrosTela.vue'),
    meta: {
      permissao: 'config.parametro.ler',
      menu: 'Administração > Organização e parâmetros > Parâmetros hierárquicos por módulo',
    },
  },
  {
    path: '/administracao/parametros/:chave',
    name: 'config.parametro',
    component: () => import('./telas/ParametrosTela.vue'),
    props: true,
    meta: { permissao: 'config.parametro.ler' },
  },
  {
    path: '/administracao/liberacao',
    name: 'config.liberacao',
    component: () => import('./telas/LiberacaoTela.vue'),
    meta: {
      permissao: 'config.liberacao.ler',
      menu: 'Administração > Organização e parâmetros > Funcionalidades por estabelecimento (feature flags)',
    },
  },
);

// M14: domínios em massa — enumerações internas e a tela genérica dos itens com vários cadastros (mestre e
// detalhes onde o item tem; `:declaracao` abre um cadastro do grupo). A permissão de cada domínio é conferida
// pela API e pela tela; o menu exige a do item. Correção do M14: nos itens de apoio do SADT e de fornecedores, a
// do domínio principal do item (quem não o lê não vê o item no menu).
const telaGrupo = () => import('./telas/GrupoDominiosTela.vue');
rotasConfig.push(
  {
    path: '/cadastros/dominios/enumeracoes',
    name: 'config.dominios.enumeracoes',
    component: () => import('./telas/DominiosIndiceTela.vue'),
    props: { subitem: 'enumeracoes' },
    meta: { permissao: 'config.dominio.ler' },
  },
  {
    path: '/cadastros/clinicos/alergias-principios',
    name: 'config.grupo.alergiasPrincipios',
    component: telaGrupo,
    props: { subitem: 'alergiasPrincipios' },
    meta: { permissao: 'cadastro.alergia.ler' },
  },
  // M23: os cadastros de dieta (regra 16), nos itens da nutrição clínica e da hotelaria.
  {
    path: '/pep/cadastros/nutricao',
    name: 'config.grupo.nutricaoClinica',
    component: telaGrupo,
    props: { subitem: 'nutricaoClinica' },
    meta: { permissao: 'pep.caracteristicaDieta.ler' },
  },
  {
    path: '/pep/cadastros/nutricao/:declaracao',
    name: 'config.grupo.nutricaoClinica.declaracao',
    component: telaGrupo,
    props: (r) => ({ subitem: 'nutricaoClinica', declaracao: String(r.params['declaracao'] ?? '') }),
    meta: { permissao: 'pep.caracteristicaDieta.ler' },
  },
  {
    path: '/hotelaria/nutricao/dietas',
    name: 'config.grupo.nutricaoHotelaria',
    component: telaGrupo,
    props: { subitem: 'nutricaoHotelaria' },
    meta: { permissao: 'internacao.dieta.ler' },
  },
  {
    path: '/hotelaria/nutricao/dietas/:declaracao',
    name: 'config.grupo.nutricaoHotelaria.declaracao',
    component: telaGrupo,
    props: (r) => ({ subitem: 'nutricaoHotelaria', declaracao: String(r.params['declaracao'] ?? '') }),
    meta: { permissao: 'internacao.dieta.ler' },
  },
  // M47 (etapa 2): os cadastros e parâmetros da agência transfusional (editáveis só com a agência própria; as
  // consultas dos que ficam só em leitura na mesma tela).
  {
    path: '/sadt/agencia/cadastros',
    name: 'config.grupo.agenciaCadastros',
    component: telaGrupo,
    props: { subitem: 'agenciaCadastros' },
    meta: { permissao: 'sadt.agenciaCadastro.ler' },
  },
  {
    path: '/sadt/agencia/cadastros/:declaracao',
    name: 'config.grupo.agenciaCadastros.declaracao',
    component: telaGrupo,
    props: (r) => ({ subitem: 'agenciaCadastros', declaracao: String(r.params['declaracao'] ?? '') }),
    meta: { permissao: 'sadt.agenciaCadastro.ler' },
  },
  // M24: cadastros de prescrição no CRUD genérico.
  {
    path: '/cadastros/prescricao/locais-assistencia',
    name: 'config.grupo.prescricaoLocais',
    component: telaGrupo,
    props: { subitem: 'prescricaoLocais' },
    meta: { permissao: 'pep.localAssistencia.ler' },
  },
  {
    path: '/cadastros/prescricao/locais-assistencia/:declaracao',
    name: 'config.grupo.prescricaoLocais.declaracao',
    component: telaGrupo,
    props: (r) => ({ subitem: 'prescricaoLocais', declaracao: String(r.params['declaracao'] ?? '') }),
    meta: { permissao: 'pep.localAssistencia.ler' },
  },
  {
    path: '/cadastros/prescricao/perguntas-operadora',
    name: 'config.grupo.prescricaoPerguntas',
    component: telaGrupo,
    props: { subitem: 'prescricaoPerguntas' },
    meta: { permissao: 'pep.perguntaOperadora.ler' },
  },
  {
    path: '/cadastros/prescricao/perguntas-operadora/:declaracao',
    name: 'config.grupo.prescricaoPerguntas.declaracao',
    component: telaGrupo,
    props: (r) => ({ subitem: 'prescricaoPerguntas', declaracao: String(r.params['declaracao'] ?? '') }),
    meta: { permissao: 'pep.perguntaOperadora.ler' },
  },
  {
    path: '/cadastros/prescricao/hemocomponentes',
    name: 'config.grupo.prescricaoHemocomponentes',
    component: telaGrupo,
    props: { subitem: 'prescricaoHemocomponentes' },
    meta: { permissao: 'pep.hemocomponentePrescritivel.ler' },
  },
  {
    path: '/cadastros/prescricao/hemocomponentes/:declaracao',
    name: 'config.grupo.prescricaoHemocomponentes.declaracao',
    component: telaGrupo,
    props: (r) => ({
      subitem: 'prescricaoHemocomponentes',
      declaracao: String(r.params['declaracao'] ?? ''),
    }),
    meta: { permissao: 'pep.hemocomponentePrescritivel.ler' },
  },
  {
    path: '/cadastros/exames/kits',
    name: 'config.grupo.kitsExames',
    component: telaGrupo,
    props: { subitem: 'kitsExames' },
    meta: { permissao: 'sadt.kit.ler' },
  },
  {
    path: '/cadastros/exames/apoio',
    name: 'config.grupo.apoioExames',
    component: telaGrupo,
    props: { subitem: 'apoioExames' },
    meta: { permissao: 'sadt.materialBiologico.ler' },
  },
  {
    path: '/cadastros/exames/apoio/:declaracao',
    name: 'config.grupo.apoioExames.declaracao',
    component: telaGrupo,
    props: (r) => ({ subitem: 'apoioExames', declaracao: String(r.params['declaracao'] ?? '') }),
    meta: { permissao: 'sadt.materialBiologico.ler' },
  },
  {
    path: '/cadastros/exames/setores',
    name: 'config.grupo.setoresSadt',
    component: telaGrupo,
    props: { subitem: 'setoresSadt' },
    meta: { permissao: 'sadt.setorSadt.ler' },
  },
  {
    path: '/cadastros/exames/setores/:declaracao',
    name: 'config.grupo.setoresSadt.declaracao',
    component: telaGrupo,
    props: (r) => ({ subitem: 'setoresSadt', declaracao: String(r.params['declaracao'] ?? '') }),
    meta: { permissao: 'sadt.setorSadt.ler' },
  },
  {
    path: '/cadastros/exames/resultados',
    name: 'config.grupo.resultadosSadt',
    component: telaGrupo,
    props: { subitem: 'resultadosSadt' },
    meta: { permissao: 'sadt.grupoResultadosPossiveis.ler' },
  },
  {
    path: '/cadastros/exames/resultados/:declaracao',
    name: 'config.grupo.resultadosSadt.declaracao',
    component: telaGrupo,
    props: (r) => ({ subitem: 'resultadosSadt', declaracao: String(r.params['declaracao'] ?? '') }),
    meta: { permissao: 'sadt.grupoResultadosPossiveis.ler' },
  },
  {
    path: '/cadastros/exames',
    name: 'config.grupo.exames',
    component: telaGrupo,
    props: { subitem: 'exames' },
    meta: { permissao: 'sadt.exame.ler' },
  },
  {
    path: '/cadastros/fornecedores/categorias',
    name: 'config.grupo.fornecedoresCategorias',
    component: telaGrupo,
    props: { subitem: 'fornecedoresCategorias' },
    meta: { permissao: 'suprimentos.categoria.ler' },
  },
);
