// Permissões do M52, fatia F6 (ficha, seção 7, telas "Treinamentos" e "Meu espaço"; seção 5, o plantão realizado para o
// repasse; convencoes.md §12). Quem tem a opção no outro sistema tem a permissão no novo (regra 1 do M06); o que é só
// do novo vai por perfil (SGH_ACESSO_MAPA_OPCAO ou a concessão a todo perfil de pessoa).
// Decisão D-PERM-526 (POL-5):
//   - treinamentos: o outro sistema não tem opção de treinamento; quem tem o cadastro de funcionário da folha (358, o
//     RH) lê e registra; o perfil `gestor-escala` (coordenação do setor, que conduz a educação permanente) também. A
//     publicação e a revogação de versão de POP são "registrar" (a coordenação e o RH publicam);
//   - a ciência de POP e o "Meu espaço" são de toda pessoa, só do próprio vínculo (o servidor confere);
//   - plantão realizado: lê e registra quem monta a escala (quadro de escalas 5073 e a manutenção do plantão médico
//     3399) e o perfil `gestor-escala`; APROVA só o perfil (quatro olhos com quem registrou, como a troca); o relatório
//     ao repasse também é lido por quem consulta os lançamentos do repasse (3032, 3033, 3036); LANÇAR no repasse e
//     manter as tarifas por hora é de quem lança eventos do repasse (3033), crítico.
import { OPCOES_ESCALA, OPCOES_PESSOAS } from './pessoas.js';
import { OPCOES_REPASSE } from './repasse.js';
import type { DeclaracaoPermissao } from './tipos.js';

const X = OPCOES_ESCALA;
const F = OPCOES_PESSOAS;
const R = OPCOES_REPASSE;
const plantaoMedicoManutencao = 3399;
const gestor = { concessaoPorPerfil: 'por-perfil' as const, perfis: ['gestor-escala'] };

const p = (
  codigo: string,
  descricao: string,
  opcoesLegado: readonly number[],
  extra: Partial<DeclaracaoPermissao> = {},
): DeclaracaoPermissao => ({
  codigo,
  descricao,
  opcoesLegado,
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
    [F.funcionario, F.funcionarioSubitem],
    gestor,
  ),
  p(
    'pessoas.treinamento.registrar',
    'Manter os cursos, abrir turmas, inscrever, registrar presença e conclusão, encerrar e cancelar turmas, publicar e revogar versões de POP',
    [F.funcionario],
    gestor,
  ),
  p('pessoas.pop.ciencia', 'Dar ciência da versão vigente de um POP (só o próprio vínculo)', [], {
    concessaoPorPerfil: 'todos-os-perfis-de-pessoa',
  }),
  p(
    'pessoas.autoatendimento.ler',
    'Ver o próprio espaço: vínculo, próximos plantões, banco de horas, treinamentos e POPs pendentes, próximos exames (só o próprio)',
    [],
    { concessaoPorPerfil: 'todos-os-perfis-de-pessoa' },
  ),
  p(
    'pessoas.realizado.ler',
    'Consultar o plantão realizado da escala e o relatório de plantões realizados ao repasse',
    [X.quadroEscalas, plantaoMedicoManutencao, R.lancamentos, R.lancamentoEventos, R.listagem],
    gestor,
  ),
  p(
    'pessoas.realizado.registrar',
    'Registrar o horário real do plantão (informado ou pelas marcações do ponto), para a aprovação de outra pessoa',
    [X.quadroEscalas, plantaoMedicoManutencao],
    gestor,
  ),
  p(
    'pessoas.realizado.aprovar',
    'Aprovar ou recusar o plantão realizado registrado por outra pessoa (nunca o próprio plantão)',
    [],
    { ...gestor, criticidade: 'sensivel' },
  ),
  p(
    'pessoas.realizado.lancar',
    'Lançar no repasse os plantões realizados e aprovados do prestador e manter as tarifas por hora de plantão',
    [R.lancamentoEventos],
    { criticidade: 'sensivel' },
  ),
];
