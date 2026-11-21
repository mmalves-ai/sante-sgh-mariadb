import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_BLOCO_SEGURO_CODIGOS = {
  checklistLer: 'cirurgia.checklist.ler',
  checklistConfirmar: 'cirurgia.checklist.confirmar',
  checklistExcecao: 'cirurgia.checklist.excecao',
  rastreioLer: 'cirurgia.rastreio.ler',
  rastreioMover: 'cirurgia.rastreio.mover',
} as const;
const C = PERMISSOES_BLOCO_SEGURO_CODIGOS;

export const PERMISSOES_BLOCO_SEGURO_M46: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.checklistLer,
    descricao: 'Consultar o checklist de cirurgia segura (três momentos, quem confirmou e a hora)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.checklistConfirmar,
    descricao:
      'Conduzir o checklist de cirurgia segura (circulante): confirmar os itens e concluir cada momento',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.checklistExcecao,
    descricao:
      'Registrar a exceção da trava da incisão em urgência (supervisor do bloco, com o motivo; vai à auditoria)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'critica',
  },
  {
    codigo: C.rastreioLer,
    descricao:
      'Consultar o quadro do bloco e o rastreio do paciente (local, horários e o código do painel para familiares)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.rastreioMover,
    descricao: 'Registrar a movimentação do paciente no bloco (entrada, mudança de local, saída e o retorno)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
];
