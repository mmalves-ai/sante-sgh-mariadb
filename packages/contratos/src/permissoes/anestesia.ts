import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_ANESTESIA_CODIGOS = {
  apaLer: 'cirurgia.apa.ler',
  apaRegistrar: 'cirurgia.apa.registrar',
  fichaLer: 'cirurgia.fichaAnestesica.ler',
  fichaRegistrar: 'cirurgia.fichaAnestesica.registrar',
  fichaAssinar: 'cirurgia.fichaAnestesica.assinar',
  srpaLer: 'cirurgia.srpa.ler',
  srpaRegistrar: 'cirurgia.srpa.registrar',
} as const;
const C = PERMISSOES_ANESTESIA_CODIGOS;

export const PERMISSOES_ANESTESIA_M46: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.apaLer,
    descricao: 'Consultar a avaliação pré-anestésica da cirurgia (ASA, via aérea, jejum, risco e plano)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.apaRegistrar,
    descricao: 'Registrar a avaliação pré-anestésica (anestesista; fecha a pendência de APA do agendamento)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
    exigeConselho: true,
  },
  {
    codigo: C.fichaLer,
    descricao: 'Consultar a ficha anestésica (sinais, fármacos, gases, fluidos, eventos, equipe e tempos)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.fichaRegistrar,
    descricao:
      'Lançar na ficha anestésica durante o ato (sinais a cada 5 minutos, fármacos, gases, fluidos e eventos)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.fichaAssinar,
    descricao: 'Assinar a ficha anestésica (só o anestesista da cirurgia; depois de assinada, só adendo)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'critica',
    exigeConselho: true,
  },
  {
    codigo: C.srpaLer,
    descricao: 'Consultar a recuperação pós-anestésica (quadro, índice de Aldrete-Kroulik, dor e náusea)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.srpaRegistrar,
    descricao: 'Registrar admissão, avaliações a cada 15 minutos e alta da recuperação pós-anestésica',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
];
