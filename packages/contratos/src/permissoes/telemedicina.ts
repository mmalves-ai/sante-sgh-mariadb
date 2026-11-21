import { PERFIS_SESSAO_PORTAL } from './portal.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_CODIGOS_TELEMEDICINA = {
  ler: 'atendimento.teleconsulta.ler',
  realizar: 'atendimento.teleconsulta.realizar',
  // Sessão do portal.
  salaEspera: 'portal.teleconsulta.entrar',
} as const;

const C = PERMISSOES_CODIGOS_TELEMEDICINA;

export const PERMISSOES_TELEMEDICINA_M50: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.ler,
    descricao:
      'Ver as teleconsultas do dia (paciente na sala de espera, termo e local informados) e as teleinterconsultas',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: C.realizar,
    descricao:
      'Realizar a teleconsulta (abrir a sala, abrir o atendimento e encerrar) e pedir ou responder a teleinterconsulta',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
    exigeConselho: true,
  },
  {
    codigo: C.salaEspera,
    descricao:
      'No portal: aceitar o termo da teleconsulta, informar o local e entrar na sala de espera e na sala do médico',

    concessaoPorPerfil: 'por-perfil',
    perfis: PERFIS_SESSAO_PORTAL,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
];
