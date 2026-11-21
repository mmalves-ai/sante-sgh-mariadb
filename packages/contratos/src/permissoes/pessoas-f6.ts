import type { DeclaracaoPermissao } from './tipos.js';
const gestor = { concessaoPorPerfil: 'por-perfil' as const, perfis: ['gestor-escala'] };

const p = (
  codigo: string,
  descricao: string,

  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,

  concessaoPorPerfil: null,
  categoria: 'administrativa',
  criticidade: 'normal',
  escopos: [],
  ...extra,
});

export const PERMISSOES_PESSOAS_M52_F6: readonly DeclaracaoPermissao[] = [
  p(
    'pessoas.treinamento.ler',
    'Consultar os treinamentos: situação dos colaboradores nos cursos obrigatórios, cursos, turmas, lista de presença e POPs com a adesão',

    gestor,
  ),
  p(
    'pessoas.treinamento.registrar',
    'Manter os cursos, abrir turmas, inscrever, registrar presença e conclusão, encerrar e cancelar turmas, publicar e revogar versões de POP',

    gestor,
  ),
  p('pessoas.pop.ciencia', 'Dar ciência da versão vigente de um POP (só o próprio vínculo)', {
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  }),
  p(
    'pessoas.autoatendimento.ler',
    'Ver o próprio espaço: vínculo, próximos plantões, banco de horas, treinamentos e POPs pendentes, próximos exames (só o próprio)',

    { concessaoPorPerfil: 'todos-os-perfis-de-pessoa' },
  ),
  p(
    'pessoas.realizado.ler',
    'Consultar o plantão realizado da escala e o relatório de plantões realizados ao repasse',

    gestor,
  ),
  p(
    'pessoas.realizado.registrar',
    'Registrar o horário real do plantão (informado ou pelas marcações do ponto), para a aprovação de outra pessoa',

    gestor,
  ),
  p(
    'pessoas.realizado.aprovar',
    'Aprovar ou recusar o plantão realizado registrado por outra pessoa (nunca o próprio plantão)',

    { ...gestor, criticidade: 'sensivel' },
  ),
  p(
    'pessoas.realizado.lancar',
    'Lançar no repasse os plantões realizados e aprovados do prestador e manter as tarifas por hora de plantão',

    { criticidade: 'sensivel' },
  ),
];
