// Permissões do M45, etapa 2 (ficha, seção 7; convencoes.md §12): escores e reavaliações, classificação de pacientes e
// índices de gravidade da UTI. Quem tem a opção no legado tem a permissão no novo (regra 1 do M06). Opções do módulo do
// PEP (TBOPCOES, retrato tools/verificadores/dados/acesso-legado.pc.json):
//   - escores: as escalas de enfermagem são registros clínicos em formulário hoje (evolução do PEP, M22) feitos junto
//     dos sinais vitais (Monitorização 2642, M25): ler = as de leitura da evolução e da monitorização; registrar = as de
//     gravação da evolução e de inclusão do sinal vital;
//   - faixas versionadas das escalas: a gerência de enfermagem, pelas opções de administração do PEP (M22: Parâmetros ›
//     Confirmar 5355), crítica (reautenticação);
//   - classificação de pacientes (Fugulin e NAS): recurso novo; as mesmas opções de registrar o escore, e o servidor
//     confere a categoria (só o enfermeiro classifica, pelo vínculo da sessão);
//   - índices de gravidade: "Índice prognóstico" 3945 (ativas no retrato: Consultar 5499, Novo 5283, Manter 5284,
//     Suspender 5285, Impressão 5286, Corrigir 6559); validar é do médico (a categoria pelo vínculo da sessão).
import { OPCOES_ENFERMAGEM } from './enfermagem.js';
import { OPCOES_PEP_ADMIN_EDITAR, OPCOES_PEP_EVOLUCAO_CRIAR, OPCOES_PEP_EVOLUCAO_LER } from './pep.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_INDICE_PROGNOSTICO = {
  menu: 3945,
  consultar: 5499,
  novo: 5283,
  manter: 5284,
  suspender: 5285,
  impressao: 5286,
  corrigir: 6559,
} as const;

export const PERMISSOES_ESCORES = {
  escoreLer: 'enfermagem.escore.ler',
  escoreRegistrar: 'enfermagem.escore.registrar',
  regraEscorePublicar: 'enfermagem.regraEscore.publicar',
  classificacaoLer: 'enfermagem.classificacao.ler',
  classificacaoRegistrar: 'enfermagem.classificacao.registrar',
  indiceUtiLer: 'pep.indiceUti.ler',
  indiceUtiRegistrar: 'pep.indiceUti.registrar',
  indiceUtiValidar: 'pep.indiceUti.validar',
} as const;

const P = PERMISSOES_ESCORES;
const O = OPCOES_ENFERMAGEM;
const I = OPCOES_INDICE_PROGNOSTICO;

const LER_SINAIS = [O.monitorizacao, O.monitorizacaoConsultar, O.monitorizacaoConsulta];
const CRIAR_SINAIS = [O.incluirSinal, O.incluirHorarioSinal, O.confirmarSinal, O.assinarSinal];

const clinica = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado,
  concessaoPorPerfil: null,
  categoria: 'clinica',
  criticidade: 'sensivel',
  ...extra,
});

export const PERMISSOES_ESCORES_M45: readonly DeclaracaoPermissao[] = [
  clinica(
    P.escoreLer,
    'Ver os escores de risco do paciente e da unidade (NEWS2, Braden, Morse, Glasgow, RASS, CAM-ICU e dor), as reavaliações devidas e as escalas registradas em formulário',
    [...new Set([...OPCOES_PEP_EVOLUCAO_LER, ...LER_SINAIS])],
  ),
  clinica(
    P.escoreRegistrar,
    'Registrar a aferição com o NEWS2, as escalas de risco, a reavaliação programada e a decisão sobre os cuidados preventivos (total sempre calculado)',
    [...new Set([...OPCOES_PEP_EVOLUCAO_CRIAR, ...CRIAR_SINAIS])],
  ),
  clinica(
    P.regraEscorePublicar,
    'Publicar uma nova versão das faixas de uma escala de risco (gerência de enfermagem; a versão publicada é imutável)',
    [...OPCOES_PEP_ADMIN_EDITAR],
    { criticidade: 'critica' },
  ),
  clinica(
    P.classificacaoLer,
    'Ver a classificação de pacientes por turno (Fugulin e NAS) e a carga de trabalho da unidade',
    [...new Set([...OPCOES_PEP_EVOLUCAO_LER, ...LER_SINAIS])],
  ),
  clinica(
    P.classificacaoRegistrar,
    'Classificar o paciente no turno pelo Fugulin ou pelo NAS (enfermeiro; a categoria é conferida pelo vínculo)',
    [...new Set([...OPCOES_PEP_EVOLUCAO_CRIAR, ...CRIAR_SINAIS])],
    { exigeConselho: true },
  ),
  clinica(
    P.indiceUtiLer,
    'Ver os índices de gravidade da UTI (APACHE II e SOFA), a mortalidade esperada e a razão de mortalidade padronizada',
    [I.menu, I.consultar, I.impressao],
  ),
  clinica(
    P.indiceUtiRegistrar,
    'Registrar o APACHE II e o SOFA com as variáveis das primeiras 24 horas (pontuação calculada pela configuração do estabelecimento)',
    [I.novo, I.manter],
    { exigeConselho: true },
  ),
  clinica(
    P.indiceUtiValidar,
    'Validar o índice de gravidade registrado (só o médico com conselho ativo; reautenticação)',
    [I.manter, I.corrigir],
    { exigeConselho: true, criticidade: 'critica' },
  ),
];
