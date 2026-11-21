// Permissões do M44, etapa 3 (ficha, seção 7; convencoes.md §12): o relógio dos protocolos gerenciados no PA (sepse,
// dor torácica, AVC, trauma). Recurso só do novo: o sistema anterior não tem protocolo gerenciado nem opção dele na
// árvore do menu de origem (retrato tools/verificadores/dados/acesso-legado.pc.json). Por isso, como a classificação (etapa 1):
//   - ler o relógio segue quem vê o registro clínico (opções da evolução do PEP, M22) e quem localiza o paciente no PA
//     (3900), mais a diretoria clínica pelo perfil;
//   - incluir o paciente e registrar as metas é do enfermeiro ou do médico com conselho ativo (regra 8: "inclusão pelo
//     enfermeiro ou pelo médico"), pelas opções de gravação da evolução, com o conselho exigido e a categoria
//     (enfermeiro ou médico) conferida na hora pelo vínculo da sessão;
//   - publicar a definição versionada é da diretoria clínica: a mesma `recepcao.protocolo.publicar` da classificação
//     (perfil `diretoria-clinica`, crítica, autor ≠ aprovador).
// Escopos do módulo (unidade e local, como o resto do `recepcao`).
import { OPCOES_PEP_EVOLUCAO_CRIAR, OPCOES_PEP_EVOLUCAO_LER } from './pep.js';
import type { DeclaracaoPermissao } from './tipos.js';

/** Localizar paciente (P.E.P. › Movimentações), a mesma leitura do quadro do PA (M20). */
const LOCALIZAR_PACIENTE = 3900;

export const PERMISSOES_PROTOCOLO_GERENCIADO_CODIGOS = {
  protocoloPacienteLer: 'recepcao.protocoloPaciente.ler',
  protocoloPacienteIniciar: 'recepcao.protocoloPaciente.iniciar',
  protocoloPacienteRegistrar: 'recepcao.protocoloPaciente.registrar',
} as const;

const C = PERMISSOES_PROTOCOLO_GERENCIADO_CODIGOS;
const ASSISTENCIAL = { concessaoPorPerfil: 'por-perfil' as const, perfis: ['assistencial-com-conselho'] };

export const PERMISSOES_PROTOCOLO_GERENCIADO_M44: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.protocoloPacienteLer,
    descricao:
      'Ver o relógio dos protocolos gerenciados do PA (sepse, dor torácica, AVC, trauma): pacientes incluídos, metas e prazos',
    opcoesLegado: [...OPCOES_PEP_EVOLUCAO_LER, LOCALIZAR_PACIENTE],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['diretoria-clinica'],
    categoria: 'clinica',
    criticidade: 'sensivel',
    escopos: ['unidade', 'local'],
  },
  {
    codigo: C.protocoloPacienteIniciar,
    descricao:
      'Incluir o paciente do PA num protocolo gerenciado, com os critérios conferidos (enfermeiro ou médico com conselho ativo)',
    opcoesLegado: [...OPCOES_PEP_EVOLUCAO_CRIAR],
    ...ASSISTENCIAL,
    categoria: 'clinica',
    criticidade: 'sensivel',
    escopos: ['unidade', 'local'],
    exigeConselho: true,
  },
  {
    codigo: C.protocoloPacienteRegistrar,
    descricao:
      'Registrar as metas e o checklist do protocolo gerenciado (meta perdida com o motivo) e encerrar o protocolo do paciente',
    opcoesLegado: [...OPCOES_PEP_EVOLUCAO_CRIAR],
    ...ASSISTENCIAL,
    categoria: 'clinica',
    criticidade: 'sensivel',
    escopos: ['unidade', 'local'],
    exigeConselho: true,
  },
];
