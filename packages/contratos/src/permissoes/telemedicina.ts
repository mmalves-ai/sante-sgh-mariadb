// Permissões da telemedicina, etapa 4 do M50 (ficha, seção 7; regra 7; convencoes.md §12). Dois lados:
//   - tela do médico (`PEP > Telemedicina`): ver as teleconsultas do dia e as teleinterconsultas, e realizar (iniciar a
//     teleconsulta, que abre o atendimento como uma consulta; encerrar; pedir e responder a teleinterconsulta). O outro
//     sistema não tem opção de telemedicina (INTEGRA_TELEMEDICINA_CONEXA vazia, sem tela em uso): vale a regra 1 do M06
//     pelas opções do consultório e do prontuário — quem localiza o paciente e chama ao consultório (3900, 5149) vê;
//     quem registra a evolução do atendimento (Evolução › Confirmar, 5182) ou chama e libera o paciente (5149, 5147)
//     realiza, com o conselho ativo (ato médico, Lei 12.842/2013; termo do médico, CFM 2.299 e 2.314, DOC-07);
//   - portal (identidade própria em SGH_POR_CONTA): a SESSÃO DO PORTAL do titular ou do responsável com o escopo
//     `agendamentos` entra na sala de espera; nunca vem de usuário interno.
import { OPCOES_ATENDIMENTO } from './atendimento.js';
import { PERFIS_SESSAO_PORTAL } from './portal.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const OPCOES_TELEMEDICINA = {
  localizarPaciente: OPCOES_ATENDIMENTO.localizarPaciente,
  chamarPaciente: OPCOES_ATENDIMENTO.chamarPaciente,
  liberarPaciente: OPCOES_ATENDIMENTO.liberarPaciente,
  /** P.E.P. › Evolução › Confirmar (o registro da evolução do atendimento). */
  evolucaoConfirmar: 5182,
} as const;

const O = OPCOES_TELEMEDICINA;

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
    opcoesLegado: [O.localizarPaciente, O.chamarPaciente, O.evolucaoConfirmar],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
  },
  {
    codigo: C.realizar,
    descricao:
      'Realizar a teleconsulta (abrir a sala, abrir o atendimento e encerrar) e pedir ou responder a teleinterconsulta',
    opcoesLegado: [O.evolucaoConfirmar, O.chamarPaciente, O.liberarPaciente],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
    exigeConselho: true,
  },
  {
    codigo: C.salaEspera,
    descricao:
      'No portal: aceitar o termo da teleconsulta, informar o local e entrar na sala de espera e na sala do médico',
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: PERFIS_SESSAO_PORTAL,
    categoria: 'administrativa',
    criticidade: 'normal',
  },
];
