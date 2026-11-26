// Permissões da pesquisa clínica (03-PEP L144; Res. CNS 466/2012, RDC ANVISA 9/2015). Recurso só do novo: concessão
// por perfil. A equipe do centro de pesquisa (perfil complementar `pesquisa-clinica`) cadastra o estudo, a equipe e os
// critérios, roda a triagem (sugestão restrita ao estabelecimento, com o acesso na trilha), avalia os candidatos,
// inclui com o termo de consentimento e acompanha os participantes. A equipe assistencial com conselho só consulta.
import type { DeclaracaoPermissao } from './tipos.js';

/** Perfil complementar da equipe do centro de pesquisa clínica. */
export const PERFIL_PESQUISA_CLINICA = 'pesquisa-clinica';

export const PERMISSOES_PESQUISA = {
  ler: 'pep.pesquisa.ler',
  gerir: 'pep.pesquisa.gerir',
  triar: 'pep.pesquisa.triar',
} as const;

/** Parâmetro que liga a triagem automática de elegibilidade (desligada por padrão; LGPD art. 11, II, c). */
export const PARAMETRO_TRIAGEM_PESQUISA = 'pep.pesquisa.triagemAutomatica';

const p = (codigo: string, descricao: string, perfis: readonly string[]): DeclaracaoPermissao => ({
  codigo,
  descricao,
  concessaoPorPerfil: 'por-perfil',
  perfis,
  categoria: 'clinica',
});

export const PERMISSOES_PESQUISA_CLINICA: readonly DeclaracaoPermissao[] = [
  p(
    PERMISSOES_PESQUISA.ler,
    'Consultar os estudos clínicos do estabelecimento: aprovação ética, equipe, critérios e participantes',
    [PERFIL_PESQUISA_CLINICA, 'assistencial-com-conselho'],
  ),
  p(
    PERMISSOES_PESQUISA.gerir,
    'Cadastrar o estudo clínico, a equipe, os critérios de elegibilidade e a situação do estudo',
    [PERFIL_PESQUISA_CLINICA],
  ),
  p(
    PERMISSOES_PESQUISA.triar,
    'Triar a elegibilidade nos prontuários do estabelecimento, avaliar candidatos, incluir com o TCLE e acompanhar',
    [PERFIL_PESQUISA_CLINICA],
  ),
];
