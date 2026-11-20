// Permissões do M48, etapa 5 (gestão da qualidade ONA e envios regulatórios; ficha, seção 7; convencoes.md §12; cap-05b
// §5.11, Perfis). O outro sistema não tem módulo de qualidade, ouvidoria nem gestão documental (nenhuma opção da árvore
// do catálogo legado trata disso; a matriz GUT de lá é a da priorização de pagamentos do repasse): são recursos só do
// novo (regra 3 do M06), por perfil complementar (ADR 0022), concedidos pelo gestor de acessos:
//   - `gestao-qualidade`: o escritório da qualidade (documentos, indicadores, auditorias, comissões, riscos, não
//     conformidades e envios);
//   - `ouvidoria`: ouvidoria e SAC (manifestações e o NPS da pesquisa);
//   - ler os documentos vigentes e dar ciência: todo perfil de pessoa (a ficha: "ciência por todo usuário");
//   - o NSP e a CCIH analisam os indicadores deles e geram os envios do Notivisa e das IRAS; os coordenadores
//     assistenciais leem os indicadores e a gestão (planos de ação da área).
import type { DeclaracaoPermissao } from './tipos.js';
import { PERFIL_NSP, PERFIS_GESTOR_AREA, PERMISSOES_QUALIDADE } from './qualidade.js';
import { PERFIL_CCIH, PERMISSOES_CCIH } from './qualidade-ccih.js';

/** Perfil complementar do escritório da qualidade (gestão da qualidade e acreditação). */
export const PERFIL_GESTAO_QUALIDADE = 'gestao-qualidade';
/** Perfil complementar da ouvidoria e do SAC. */
export const PERFIL_OUVIDORIA = 'ouvidoria';

export const PERMISSOES_GESTAO_QUALIDADE = {
  documentoLer: 'qualidade.documento.ler',
  documentoPublicar: 'qualidade.documento.publicar',
  indicadorLer: 'qualidade.indicador.ler',
  indicadorAnalisar: 'qualidade.indicador.analisar',
  gestaoLer: 'qualidade.gestao.ler',
  gestaoRegistrar: 'qualidade.gestao.registrar',
  ouvidoriaLer: 'qualidade.ouvidoria.ler',
  ouvidoriaResponder: 'qualidade.ouvidoria.responder',
  envioGerar: 'relatorio.envioRegulatorio.gerar',
} as const;

const C = PERMISSOES_GESTAO_QUALIDADE;

/**
 * Cada envio regulatório lê os dados de uma área: além de `relatorio.envioRegulatorio.gerar`, a sessão precisa da
 * permissão desses dados para ver, gerar, baixar e transmitir o envio daquele tipo. O Notivisa traz os incidentes do NSP
 * (`qualidade.notivisa.exportar`, só do NSP), as IRAS as infecções da CCIH (`qualidade.iras.ler`) e o PM-QUALISS os
 * indicadores (`qualidade.indicador.ler`). Assim a CCIH não lê os incidentes do NSP, nem o NSP as IRAS da CCIH.
 */
export const PERMISSAO_DADOS_ENVIO_REGULATORIO: Readonly<Record<'pmQualiss' | 'iras' | 'notivisa', string>> =
  {
    pmQualiss: C.indicadorLer,
    iras: PERMISSOES_CCIH.irasLer,
    notivisa: PERMISSOES_QUALIDADE.notivisaExportar,
  };

const qualidade = (
  codigo: string,
  descricao: string,
  perfis: readonly string[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado: [],
  concessaoPorPerfil: 'por-perfil',
  perfis,
  categoria: 'administrativa',
  criticidade: 'normal',
  ...extra,
});

export const PERMISSOES_QUALIDADE_GESTAO_M48: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.documentoLer,
    descricao:
      'Consultar os documentos da qualidade vigentes (POPs, protocolos, manuais, políticas) e registrar a ciência da revisão',
    opcoesLegado: [],
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
    categoria: 'administrativa',
    criticidade: 'normal',
  },
  qualidade(
    C.documentoPublicar,
    'Publicar documento da qualidade e as revisões (aprovação), retirar de uso e acompanhar as ciências',
    [PERFIL_GESTAO_QUALIDADE],
  ),
  qualidade(
    C.indicadorLer,
    'Consultar os indicadores com a ficha técnica, a meta, o valor da competência e a análise crítica',
    [PERFIL_GESTAO_QUALIDADE, PERFIL_NSP, PERFIL_CCIH, ...PERFIS_GESTOR_AREA],
  ),
  qualidade(
    C.indicadorAnalisar,
    'Registrar a análise crítica do indicador na competência e o plano de ação quando fora da meta',
    [PERFIL_GESTAO_QUALIDADE, PERFIL_NSP, PERFIL_CCIH],
  ),
  qualidade(
    C.gestaoLer,
    'Consultar as auditorias internas, as comissões e reuniões, a matriz de riscos e as não conformidades',
    [PERFIL_GESTAO_QUALIDADE, PERFIL_NSP, ...PERFIS_GESTOR_AREA],
  ),
  qualidade(
    C.gestaoRegistrar,
    'Registrar auditoria interna por checklist, comissão e reunião (pauta, ata e presença), risco na matriz GUT e não conformidade com o tratamento e a eficácia',
    [PERFIL_GESTAO_QUALIDADE],
  ),
  // A manifestação identificada traz o paciente ou o contato do manifestante: dado pessoal, criticidade sensível.
  qualidade(
    C.ouvidoriaLer,
    'Consultar as manifestações da ouvidoria e do SAC (com o manifestante quando identificada) e o NPS da pesquisa de satisfação',
    [PERFIL_OUVIDORIA, PERFIL_GESTAO_QUALIDADE],
    { criticidade: 'sensivel' },
  ),
  qualidade(
    C.ouvidoriaResponder,
    'Registrar a manifestação, encaminhar à área e responder ao manifestante',
    [PERFIL_OUVIDORIA],
    { criticidade: 'sensivel' },
  ),
  qualidade(
    C.envioGerar,
    'Gerar os arquivos dos envios regulatórios por competência (PM-QUALISS, IRAS, Notivisa) e registrar a transmissão manual',
    [PERFIL_GESTAO_QUALIDADE, PERFIL_NSP, PERFIL_CCIH],
  ),
];
