import type { DeclaracaoPermissao } from './tipos.js';

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

    // Quem registra as etapas à beira do leito também vê o alerta de elegível e o relógio das metas (C2-042).
    concessaoPorPerfil: 'por-perfil',
    perfis: ['diretoria-clinica', 'assistencial-com-conselho'],
    categoria: 'clinica',
    criticidade: 'sensivel',
    escopos: ['unidade', 'local'],
  },
  {
    codigo: C.protocoloPacienteIniciar,
    descricao:
      'Incluir o paciente do PA num protocolo gerenciado, com os critérios conferidos (enfermeiro ou médico com conselho ativo)',

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

    ...ASSISTENCIAL,
    categoria: 'clinica',
    criticidade: 'sensivel',
    escopos: ['unidade', 'local'],
    exigeConselho: true,
  },
];
