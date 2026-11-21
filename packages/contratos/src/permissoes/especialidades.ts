import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_ESPECIALIDADES_CODIGOS = {
  oftalmologiaLer: 'pep.especialidadeOftalmologia.ler',
  oftalmologiaRegistrar: 'pep.especialidadeOftalmologia.registrar',
  oncologiaLer: 'pep.especialidadeOncologia.ler',
  oncologiaPublicarProtocolo: 'pep.especialidadeOncologia.publicarProtocolo',
  oncologiaRegistrar: 'pep.especialidadeOncologia.registrar',
  oncologiaValidar: 'pep.especialidadeOncologia.validar',
  obstetriciaLer: 'pep.especialidadeObstetricia.ler',
  obstetriciaRegistrar: 'pep.especialidadeObstetricia.registrar',
  lactarioLer: 'hotelaria.lactario.ler',
  lactarioProduzir: 'hotelaria.lactario.produzir',
} as const;

const C = PERMISSOES_ESPECIALIDADES_CODIGOS;

const p = (
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

export const PERMISSOES_ESPECIALIDADES_M45: readonly DeclaracaoPermissao[] = [
  p(
    C.oftalmologiaLer,
    'Ver os exames oftalmológicos do paciente (acuidade visual, pressão intraocular, gonioscopia e exames complementares)',
  ),
  p(
    C.oftalmologiaRegistrar,
    'Registrar o exame oftalmológico (acuidade pelo cadastro, pressão intraocular e exames complementares): médico com o conselho ativo',

    { exigeConselho: true },
  ),
  p(
    C.oncologiaLer,
    'Ver os protocolos de quimioterapia e os ciclos do paciente (doses calculadas com as parcelas e a validação farmacêutica)',
  ),
  p(
    C.oncologiaPublicarProtocolo,
    'Publicar a versão de um protocolo de quimioterapia (imutável; corrigir é publicar nova versão): médico com o conselho ativo',

    { exigeConselho: true },
  ),
  p(
    C.oncologiaRegistrar,
    'Registrar o ciclo de quimioterapia do paciente (dose por superfície corporal, peso ou AUC calculada pelo sistema): médico com o conselho ativo',

    { exigeConselho: true },
  ),
  p(
    C.oncologiaValidar,
    'Validar o ciclo de quimioterapia com a dupla checagem independente das doses: farmacêutico com o conselho ativo',

    { exigeConselho: true },
  ),
  p(
    C.obstetriciaLer,
    'Ver o partograma (dilatação, apresentação, batimentos cardíacos fetais e contrações com as linhas de alerta e de ação) e os recém-nascidos',
  ),
  p(
    C.obstetriciaRegistrar,
    'Registrar a observação do partograma e o recém-nascido (Apgar, peso, idade gestacional): médico ou enfermagem obstétrica com o conselho ativo',

    { exigeConselho: true },
  ),
  p(
    C.lactarioLer,
    'Ver a produção do lactário (ordens de fórmula por paciente e horário, validade e conferência; lista com nomes)',

    { categoria: 'administrativa' },
  ),
  p(
    C.lactarioProduzir,
    'Registrar a ordem de produção do lactário, conferir a de outra pessoa e imprimir as etiquetas (dois identificadores, fórmula, volume, horário e validade)',

    { categoria: 'administrativa', criticidade: 'normal' },
  ),
];
