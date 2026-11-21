import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_REDE_M57 = [
  {
    codigo: 'rede.mpi.ler',
    descricao:
      'Ver a fila de prováveis duplicados entre os estabelecimentos da rede, os vínculos e o relatório de divergência',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: 'rede.mpi.vincular',
    descricao:
      'Confirmar que dois cadastros da rede são a mesma pessoa (ou que são outra pessoa) e atualizar a fila',

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'sensivel',
  },
  {
    codigo: 'rede.mpi.desfazer',
    descricao: 'Desfazer o vínculo entre cadastros da rede (só o índice; os cadastros não mudam)',

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

    concessaoPorPerfil: null,
    categoria: 'administrativa',
    criticidade: 'critica',
  },
] as const satisfies readonly DeclaracaoPermissao[];

export type PermissaoRede = (typeof PERMISSOES_REDE_M57)[number]['codigo'];
