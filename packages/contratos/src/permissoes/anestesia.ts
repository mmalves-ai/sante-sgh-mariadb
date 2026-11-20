// Permissões do M46, etapa 1 (ficha, seção 7; convencoes.md §12): avaliação pré-anestésica (APA), ficha anestésica e
// recuperação pós-anestésica (SRPA). Quem tem a opção no sistema anterior tem a permissão no novo (regra 1 do M06).
// Opções da árvore TBOPCOES (retrato tools/verificadores/dados/acesso-legado.pc.json):
//   - P.E.P. › Movimentações › Registro cirúrgico 6813: Consultar 6814, Nova 6820, Manter 6821, Salvar 6823,
//     Corrigir 6828, Ficha anestésica 6829 (a ficha anestésica antiga mora dentro do registro cirúrgico do PEP);
//   - Bloco Cirúrgico: o módulo 2227 e o mapa 2293 (quem acompanha o bloco lê a SRPA).
// O sistema anterior não tem opção de APA nem de SRPA: a APA segue a opção da ficha anestésica (é o anestesista quem
// avalia) e a SRPA segue o registro cirúrgico (enfermagem do bloco). Registrar a APA e assinar a ficha são privativos
// de médico (Lei 12.842/2013; CFM 2.174/2017): exigem conselho, e o servidor confere na hora que quem assina é o
// anestesista da cirurgia (regra 3), além da permissão.
// D-PERM-46: o código da ficha é `cirurgia.fichaAnestesica.*` (o roteiro escreve `ficha_anestesica`; o catálogo
// exige camelCase em três partes, FORMATO_CODIGO_PERMISSAO). Conferir com o anestesista chave-usuário e com a
// enfermagem do bloco na validação (DP-3).
import { OPCOES_BLOCO } from './cirurgia.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_REGISTRO_CIRURGICO_PEP = {
  modulo: 6813,
  consultar: 6814,
  nova: 6820,
  manter: 6821,
  salvar: 6823,
  corrigir: 6828,
  fichaAnestesica: 6829,
} as const;

export const PERMISSOES_ANESTESIA_CODIGOS = {
  apaLer: 'cirurgia.apa.ler',
  apaRegistrar: 'cirurgia.apa.registrar',
  fichaLer: 'cirurgia.fichaAnestesica.ler',
  fichaRegistrar: 'cirurgia.fichaAnestesica.registrar',
  fichaAssinar: 'cirurgia.fichaAnestesica.assinar',
  srpaLer: 'cirurgia.srpa.ler',
  srpaRegistrar: 'cirurgia.srpa.registrar',
} as const;

const R = OPCOES_REGISTRO_CIRURGICO_PEP;
const B = OPCOES_BLOCO;
const C = PERMISSOES_ANESTESIA_CODIGOS;

const LER_REGISTRO = [R.modulo, R.consultar, R.fichaAnestesica];
const GRAVAR_REGISTRO = [R.nova, R.manter, R.salvar, R.corrigir];

export const PERMISSOES_ANESTESIA_M46: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.apaLer,
    descricao: 'Consultar a avaliação pré-anestésica da cirurgia (ASA, via aérea, jejum, risco e plano)',
    opcoesLegado: [...LER_REGISTRO, B.mapa],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.apaRegistrar,
    descricao: 'Registrar a avaliação pré-anestésica (anestesista; fecha a pendência de APA do agendamento)',
    opcoesLegado: [R.fichaAnestesica],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
    exigeConselho: true,
  },
  {
    codigo: C.fichaLer,
    descricao: 'Consultar a ficha anestésica (sinais, fármacos, gases, fluidos, eventos, equipe e tempos)',
    opcoesLegado: [...LER_REGISTRO, B.mapa],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.fichaRegistrar,
    descricao:
      'Lançar na ficha anestésica durante o ato (sinais a cada 5 minutos, fármacos, gases, fluidos e eventos)',
    opcoesLegado: [R.fichaAnestesica],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.fichaAssinar,
    descricao: 'Assinar a ficha anestésica (só o anestesista da cirurgia; depois de assinada, só adendo)',
    opcoesLegado: [R.fichaAnestesica],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'critica',
    exigeConselho: true,
  },
  {
    codigo: C.srpaLer,
    descricao: 'Consultar a recuperação pós-anestésica (quadro, índice de Aldrete-Kroulik, dor e náusea)',
    opcoesLegado: [...LER_REGISTRO, B.modulo, B.mapa],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.srpaRegistrar,
    descricao: 'Registrar admissão, avaliações a cada 15 minutos e alta da recuperação pós-anestésica',
    opcoesLegado: [...GRAVAR_REGISTRO, R.fichaAnestesica],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
];
