// Permissões do M57, etapa 1 (ficha, seção 7; convencoes.md §12): fila de prováveis duplicados da Rede, vincular e
// desfazer vínculo. Quem tem a opção no outro sistema tem a permissão no novo (regra 1 do M06): o MPI da Rede é a
// versão entre estabelecimentos da unificação de cadastros, então as opções são as de quem unifica e reverte a
// unificação no cadastro de pacientes (as mesmas da fila de duplicidades do M11, permissoes/cadastro.ts):
//   - Unificação de cadastros: recepção interna 3272/4005, SADT 4790 (gestor de cadastro, SAME, supervisores);
//   - Reversão da unificação: 6544/6608, 6531.
// O perfil "Gestor de cadastro" da ficha é o grupo que tem essas opções (SGH_ACESSO_MAPA_OPCAO); não há perfil
// complementar novo. A etapa 2 declara `rede.mpiAviso.ler`, `pep.prontuario.lerRede` e `cadastro.paciente.unificar`;
// a etapa 3 (BI da Rede, serviços compartilhados), `relatorio.biRede.acessar` e `rede.servico.registrar` (o formato do
// código é de três partes em camelCase: `rede.mpi.aviso.ler` e `relatorio.bi_rede.acessar` da ficha viram estes;
// decisão registrada no preparo).
import { OPCOES_PEP_PRONTUARIO } from './pep.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_REDE_MPI = {
  unificacaoInterna: 3272,
  unificacaoInternaAlt: 4005,
  unificacaoSadt: 4790,
  reversaoInterna: 6544,
  reversaoInternaAlt: 6608,
  reversaoSadt: 6531,
} as const;

const O = OPCOES_REDE_MPI;
const UNIFICACAO = [O.unificacaoInterna, O.unificacaoInternaAlt, O.unificacaoSadt] as const;
const REVERSAO = [O.reversaoInterna, O.reversaoInternaAlt, O.reversaoSadt] as const;

export const PERMISSOES_REDE_M57 = [
  {
    codigo: 'rede.mpi.ler',
    descricao:
      'Ver a fila de prováveis duplicados entre os estabelecimentos da rede, os vínculos e o relatório de divergência',
    opcoesLegado: [...UNIFICACAO, ...REVERSAO],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: 'rede.mpi.vincular',
    descricao:
      'Confirmar que dois cadastros da rede são a mesma pessoa (ou que são outra pessoa) e atualizar a fila',
    opcoesLegado: [...UNIFICACAO],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: 'rede.mpi.desfazer',
    descricao: 'Desfazer o vínculo entre cadastros da rede (só o índice; os cadastros não mudam)',
    opcoesLegado: [...REVERSAO],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  // ── Etapa 2 (M57.2; ficha, seções 5, 7 e 8, regras 6 e 7) ─────────────────────────────────────────────
  // O aviso "este paciente tem atendimentos em outro estabelecimento da rede" fica no cabeçalho do contexto do paciente:
  // quem abre o prontuário (as opções do M15) e quem decide a mesma pessoa no MPI vê o aviso (só contagens e datas).
  {
    codigo: 'rede.mpiAviso.ler',
    descricao:
      'Ver no cabeçalho do paciente que ele tem atendimentos em outro estabelecimento da rede (só quantos e quando)',
    opcoesLegado: [...OPCOES_PEP_PRONTUARIO, ...UNIFICACAO, ...REVERSAO],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  // Abrir o registro do outro estabelecimento (acesso cruzado): as mesmas opções de abrir o prontuário; quem decide se
  // pode é a regra da DP-42 (chave `rede.acessoCruzado`, desligada até a decisão do DPO e do jurídico).
  {
    codigo: 'pep.prontuario.lerRede',
    descricao:
      'Abrir a linha do tempo do paciente em outro estabelecimento da rede, pela regra de compartilhamento do prontuário (motivo e justificativa; trilha nos dois bancos)',
    opcoesLegado: [...OPCOES_PEP_PRONTUARIO],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  // A unificação de prontuários duplicados no mesmo estabelecimento (cadastro.unificarPaciente, ficha do M11, seção 5):
  // as opções de unificação do cadastro (as mesmas do "Unificação de cadastros" do outro sistema).
  {
    codigo: 'cadastro.paciente.unificar',
    descricao:
      'Unificar dois prontuários duplicados do mesmo estabelecimento (o absorvido fica inativo e aponta para o que fica)',
    opcoesLegado: [...UNIFICACAO],
    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'critica',
  },
] as const satisfies readonly DeclaracaoPermissao[];

export type PermissaoRede = (typeof PERMISSOES_REDE_M57)[number]['codigo'];
