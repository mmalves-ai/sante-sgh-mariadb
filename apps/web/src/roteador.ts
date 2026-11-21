// Roteador da casca: rotas por módulo, carregadas sob demanda; guarda que exige meta.permissao.
import type { Sessao } from '@sgh/contratos';
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
  type Router,
  type RouterHistory,
} from 'vue-router';
import { pode } from '@sgh/dominio-acesso/autorizacao';
import { rotasAcesso } from './modulos/acesso/rotas.js';
import { rotasInicio } from './modulos/inicio/rotas.js';
import { rotasAdministracao } from './modulos/administracao/rotas.js';
import { rotasCadastro } from './modulos/cadastro/rotas.js';
import { rotasRede } from './modulos/rede/rotas.js';
import { rotasImplantacao } from './modulos/implantacao/rotas.js';
import { abilityDaSessao } from './casca/sessao/pode.js';
import { rotasConfig } from './modulos/config/rotas.js';
import { rotasPrecos } from './modulos/precos/rotas.js';
import { rotasCatalogos } from './modulos/catalogos/rotas.js';
import { rotasPep } from './modulos/pep/rotas.js';
import { rotasConsultas } from './modulos/consultas/rotas.js';
import { rotasInternacao } from './modulos/internacao/rotas.js';
import { rotasAgenda } from './modulos/agenda/rotas.js';
import { rotasRecepcao } from './modulos/recepcao/rotas.js';
import { rotasExames } from './modulos/exames/rotas.js';
import { rotasCirurgia } from './modulos/cirurgia/rotas.js';
import { rotasAtendimento } from './modulos/atendimento/rotas.js';
import { rotasSadt } from './modulos/sadt/rotas.js';
import { rotasRelatorios } from './modulos/relatorios/rotas.js';
import { rotasIntegracoes } from './modulos/integracoes/rotas.js';
import { rotasAdt } from './modulos/adt/rotas.js';
import { rotasEnfermagem } from './modulos/enfermagem/rotas.js';
import { rotasNutricao } from './modulos/nutricao/rotas.js';
import { rotasCcih } from './modulos/qualidade/ccih/rotas-ccih.js';
import { rotasAgravo } from './modulos/qualidade/vigilancia/rotas-agravo.js';
import { rotasQualidade } from './modulos/qualidade/rotas.js';
import { rotasGestaoQualidade } from './modulos/qualidade/gestao/rotas-gestao.js';
import { rotasEspecialidades } from './modulos/especialidades/rotas.js';
import { rotasRouparia } from './modulos/rouparia/rotas.js';
import { rotasManutencao } from './modulos/manutencao/rotas.js';
import { rotasSessoes } from './modulos/sessoes/rotas.js';
import { rotasSame } from './modulos/same/rotas.js';
import { rotasSuprimentos } from './modulos/suprimentos/rotas.js';
import { rotasFarmacia } from './modulos/farmacia/rotas.js';
import { rotasFaturamento } from './modulos/faturamento/rotas.js';
import { rotasTiss } from './modulos/tiss/rotas.js';
import { rotasFinanceiro } from './modulos/financeiro/rotas.js';
import { rotasCoexistencia } from './modulos/coexistencia/rotas.js';
import { rotasRepasse } from './modulos/repasse/rotas.js';
import { rotasAssinatura } from './modulos/assinatura/rotas.js';
import { rotasOperadora } from './modulos/operadora/rotas.js';
import { rotasPessoas } from './modulos/pessoas/rotas.js';
import { rotasSesmt } from './modulos/pessoas/sesmt/rotas.js';
import { rotasF6 } from './modulos/pessoas/f6/rotas.js';
import { rotasContabil } from './modulos/contabil/rotas.js';
import { rotasPatrimonio } from './modulos/patrimonio/rotas.js';
import { rotasFolha } from './modulos/folha/rotas.js';
import { rotasRubricasFolha } from './modulos/folha/rubricas/rotas.js';
import { rotasCustos } from './modulos/custos/rotas.js';
import { rotasOrcamento } from './modulos/orcamento/rotas.js';
import { rotasPortalPaciente } from './modulos/portal/rotas.js';
import { rotasPortaria } from './modulos/portaria/rotas.js';
import { rotasPortalMedico } from './modulos/portal-medico/rotas.js';
import { rotasPortalPrestador } from './modulos/portal-prestador/rotas.js';
import { rotasTelemedicina } from './modulos/telemedicina/rotas.js';
import { rotasSuporte } from './modulos/suporte/rotas.js';
import { rotasPlataformaOnboarding } from './modulos/plataforma/rotas.js';
import { temContaPlataforma } from './modulos/suporte/api-suporte.js';

declare module 'vue-router' {
  interface RouteMeta {
    /** Permissão de leitura da tela (obrigatória; `publica: true` dispensa). */
    permissao?: string;
    /** As permissões que também abrem a tela (basta uma; a rota da API tem o mesmo @PermissaoOu). */
    permissaoOu?: readonly string[];
    publica?: boolean;
    /** Tela de aparelho (totem, painel de TV): sem casca; o acesso é o token do dispositivo (M19). */
    dispositivo?: boolean;
  }
}

const NaoEncontrada = () => import('./modulos/acesso/telas/NaoEncontradaTela.vue');

// Demonstração dos componentes (M07) e da quebra de vidro (M06): só no servidor de desenvolvimento.
// `import.meta.env.DEV` é constante no build, então as telas nem entram no pacote de produção. As do config
// saíram daqui no M08 (ligadas ao menu, com permissão).
const ROTAS_DE_DESENVOLVIMENTO: RouteRecordRaw[] = import.meta.env.DEV
  ? [
      {
        path: '/demonstracao',
        name: 'demonstracao',
        component: () => import('./modulos/demonstracao/DemonstracaoTela.vue'),
        meta: { permissao: 'acesso.inicio.ler' },
      },
      // M06: demonstração da decisão em passos e do diálogo de quebra de vidro (paciente sintético).
      {
        path: '/demonstracao/quebra-de-vidro',
        name: 'demonstracao-quebra-de-vidro',
        component: () => import('./modulos/acesso/telas/QuebraVidroDemonstracaoTela.vue'),
        meta: { permissao: 'acesso.inicio.ler' },
      },
    ]
  : [];

export function rotas(desenvolvimento: boolean): RouteRecordRaw[] {
  return [
    { path: '/', redirect: '/inicio' },
    ...rotasAcesso,
    // M27: página inicial por perfil, filas do médico e da recepção, mensagens internas e dicionário pessoal.
    ...rotasInicio,
    // M08 (pendência do M07 e do M06): as telas de coexistência do M02 a M04 e as do M08 em todos os
    // ambientes, ligadas ao menu, com a permissão que a API já exige.
    ...rotasConfig,
    // M60 (etapa 2): a conferência da instalação, aba da "Saúde do sistema".
    ...rotasImplantacao,
    // ADR 0021: conta da plataforma, "login como" e suporte técnico.
    ...rotasSuporte,
    // F4 L3: painel de onboarding de clientes (administrador da plataforma).
    ...rotasPlataformaOnboarding,
    // M10: acesso, organização e auditoria (telas).
    ...rotasAdministracao,
    // M11: pacientes e profissionais.
    ...rotasCadastro,
    // M57 (etapa 1): MPI da Rede (fila de prováveis duplicados entre os estabelecimentos e divergência dos índices).
    ...rotasRede,
    // M12: convênios, contratos, tabelas de preço e motor de preços.
    ...rotasPrecos,
    // M13: catálogos oficiais e importadores.
    ...rotasCatalogos,
    // M15: prontuário ao vivo (consulta) e registro de acesso ao prontuário.
    ...rotasPep,
    // M14: consultas somente leitura de todas as tabelas e os itens das Fases 5 e 6.
    ...rotasConsultas,
    // M16: painel de leitos ao vivo, censo, painéis gerenciais, indicadores e BI.
    ...rotasInternacao,
    ...rotasAgenda,
    // M19: recepção, senhas, totens e painéis.
    ...rotasRecepcao,
    // M18: agenda de exames e centro cirúrgico.
    ...rotasExames,
    ...rotasCirurgia,
    // M20: atendimento ambulatorial e pronto atendimento.
    ...rotasAtendimento,
    // M26: SADT, laudos e portal de resultados.
    ...rotasSadt,
    // M34: catálogo de relatórios e integrações novas.
    ...rotasRelatorios,
    ...rotasIntegracoes,
    // M21: internação, leitos, higienização e SAME.
    ...rotasAdt,
    // M25: enfermagem beira-leito.
    ...rotasEnfermagem,
    // M45 (etapa 5): nutrição clínica, mapa de dietas e serviço social.
    ...rotasNutricao,
    // M48 (etapa 1): notificação de incidentes (o diálogo global fica na casca), triagem do NSP, prazos e Notivisa.
    ...rotasQualidade,
    ...rotasCcih,
    ...rotasAgravo,
    // M48 (etapa 5): gestão da qualidade (ONA) e envios regulatórios.
    ...rotasGestaoQualidade,
    // M45 (etapa 6; DP-32): especialidades sob demanda e o lactário.
    ...rotasEspecialidades,
    // M55 (etapa 2): rouparia e lavanderia.
    ...rotasRouparia,
    // M55 (etapa 1): manutenção e engenharia clínica.
    ...rotasManutencao,
    ...rotasSessoes,
    ...rotasSame,
    // M28: estoque, almoxarifado e compras.
    ...rotasSuprimentos,
    ...rotasFarmacia,
    ...rotasFaturamento,
    ...rotasTiss,
    ...rotasFinanceiro,
    ...rotasCoexistencia,
    ...rotasRepasse,
    // M49 (etapa 1): Meu certificado, política de assinatura e provedores em nuvem.
    ...rotasAssinatura,
    // M56 (etapa F0): operadora própria (Envios à ANS com os catálogos da ANS).
    ...rotasOperadora,
    // M52.1: colaboradores e admissão (gestão de pessoas, fatia F1).
    ...rotasPessoas,
    // M52.5: SESMT (ASO, CAT, riscos e EPI, vacinação do colaborador).
    ...rotasSesmt,
    ...rotasF6,
    // M53.1 (etapa F0): a folha da competência (interface com a folha externa e afastamentos).
    ...rotasFolha,
    // M53.2 (etapa F1): rubricas, incidências e tabelas legais da folha.
    ...rotasRubricasFolha,
    // M54 (etapa 4): centros de custo e critérios de rateio (estrutura, estatísticas do mês e cadastros do custeio).
    ...rotasCustos,
    // M54 (etapa 7): orçamento empresarial por centro de custo e item, aprovação e orçado × realizado.
    ...rotasOrcamento,
    // M54.1 (etapa F1): plano de contas, regras de contabilização e os fatos lidos dos módulos.
    ...rotasContabil,
    // M54.6 (etapa F6): patrimônio (bens, depreciação, movimentos, inventário pelo celular e parâmetros).
    ...rotasPatrimonio,
    // M50 (etapa 1): portal do paciente (fora da casca) e a conferência dos responsáveis legais.
    ...rotasPortalPaciente,
    // M50 (etapa 5): portaria e visitantes.
    ...rotasPortaria,
    ...rotasPortalMedico,
    // M56 (etapa 8, F7): portal do prestador credenciado da operadora própria (fora da casca).
    ...rotasPortalPrestador,
    ...rotasTelemedicina,
    ...(desenvolvimento ? ROTAS_DE_DESENVOLVIMENTO : []),
    {
      path: '/sem-permissao',
      name: 'sem-permissao',
      component: NaoEncontrada,
      props: { motivo: 'sem-permissao' },
      meta: { publica: true },
    },
    { path: '/:caminho(.*)*', name: 'nao-encontrada', component: NaoEncontrada, meta: { publica: true } },
  ];
}

/** Rotas sem meta.permissao (nem publica) são defeito: a guarda recusa e o teste aponta. */
export function rotasSemPermissao(lista: readonly RouteRecordRaw[]): string[] {
  return lista.filter((r) => !r.redirect && !r.meta?.permissao && !r.meta?.publica).map((r) => r.path);
}

export function criarRoteador(
  lerSessao: () => Promise<Sessao>,
  opcoes: {
    desenvolvimento?: boolean;
    historico?: RouterHistory;
    temPlataforma?: () => Promise<boolean>;
  } = {},
): Router {
  const r = createRouter({
    history: opcoes.historico ?? createWebHistory(),
    routes: rotas(opcoes.desenvolvimento ?? import.meta.env.DEV),
  });
  r.beforeEach(async (para) => {
    if (para.meta.publica) return true;
    const exigida = para.meta.permissao;
    if (!exigida) return { name: 'sem-permissao' };
    try {
      const sessao = await lerSessao();
      // M06: a mesma regra CASL do servidor (o servidor confere de novo em toda requisição).
      const ab = abilityDaSessao(sessao);
      return pode(ab, exigida) || (para.meta.permissaoOu ?? []).some((p) => pode(ab, p))
        ? true
        : { name: 'sem-permissao' };
    } catch {
      // Sem sessão (401): leva à porta de entrada (M05) ou, com a conta da plataforma aberta (o "como"
      // terminou), de volta à conta de origem (ADR 0021). A casca também confere a permissão antes do
      // RouterView (rotaPermitida), para o caso de a sessão falhar depois de carregada.
      return (await (opcoes.temPlataforma ?? temContaPlataforma)())
        ? { name: 'plataforma' }
        : { name: 'entrar' };
    }
  });
  return r;
}
