import type { DeclaracaoPermissao } from './tipos.js';

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

const clinica = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'clinica',
  criticidade: 'sensivel',
  ...extra,
});

export const PERMISSOES_ESCORES_M45: readonly DeclaracaoPermissao[] = [
  clinica(
    P.escoreLer,
    'Ver os escores de risco do paciente e da unidade (NEWS2, Braden, Morse, Glasgow, RASS, CAM-ICU e dor), as reavaliações devidas e as escalas registradas em formulário',
  ),
  clinica(
    P.escoreRegistrar,
    'Registrar a aferição com o NEWS2, as escalas de risco, a reavaliação programada e a decisão sobre os cuidados preventivos (total sempre calculado)',
  ),
  clinica(
    P.regraEscorePublicar,
    'Publicar uma nova versão das faixas de uma escala de risco (gerência de enfermagem; a versão publicada é imutável)',

    { criticidade: 'critica' },
  ),
  clinica(
    P.classificacaoLer,
    'Ver a classificação de pacientes por turno (Fugulin e NAS) e a carga de trabalho da unidade',
  ),
  clinica(
    P.classificacaoRegistrar,
    'Classificar o paciente no turno pelo Fugulin ou pelo NAS (enfermeiro; a categoria é conferida pelo vínculo)',

    { exigeConselho: true },
  ),
  clinica(
    P.indiceUtiLer,
    'Ver os índices de gravidade da UTI (APACHE II e SOFA), a mortalidade esperada e a razão de mortalidade padronizada',
  ),
  clinica(
    P.indiceUtiRegistrar,
    'Registrar o APACHE II e o SOFA com as variáveis das primeiras 24 horas (pontuação calculada pela configuração do estabelecimento)',

    { exigeConselho: true },
  ),
  clinica(
    P.indiceUtiValidar,
    'Validar o índice de gravidade registrado (só o médico com conselho ativo; reautenticação)',

    { exigeConselho: true, criticidade: 'critica' },
  ),
];
