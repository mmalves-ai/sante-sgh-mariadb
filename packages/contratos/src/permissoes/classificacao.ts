import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_CLASSIFICACAO_CODIGOS = {
  classificacaoLer: 'recepcao.classificacao.ler',
  classificacaoCriar: 'recepcao.classificacao.criar',
  classificacaoReclassificar: 'recepcao.classificacao.reclassificar',
  sinaisRegistrar: 'recepcao.classificacao.registrarSinais',
  protocoloLer: 'recepcao.protocolo.ler',
  protocoloPublicar: 'recepcao.protocolo.publicar',
} as const;

const C = PERMISSOES_CLASSIFICACAO_CODIGOS;
const ENFERMEIRO = { concessaoPorPerfil: 'por-perfil' as const, perfis: ['assistencial-com-conselho'] };

export const PERMISSOES_CLASSIFICACAO_M44: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.classificacaoLer,
    descricao:
      'Ver a fila de classificação de risco do pronto atendimento e a classificação do paciente (cor, prazo, histórico)',

    // A diretoria clínica lê pelo perfil mesmo sem as opções do prontuário (chega à fila e aos protocolos pelo menu).
    concessaoPorPerfil: 'por-perfil',
    perfis: ['diretoria-clinica'],
    categoria: 'clinica',
    criticidade: 'sensivel',
    escopos: ['unidade', 'local'],
  },
  {
    codigo: C.classificacaoCriar,
    descricao:
      'Classificar o risco do paciente no pronto atendimento (privativo do enfermeiro com conselho ativo)',

    ...ENFERMEIRO,
    categoria: 'clinica',
    criticidade: 'sensivel',
    escopos: ['unidade', 'local'],
    exigeConselho: true,
  },
  {
    codigo: C.classificacaoReclassificar,
    descricao:
      'Reclassificar o risco por estouro do tempo-alvo ou mudança do quadro (privativo do enfermeiro com conselho ativo)',

    ...ENFERMEIRO,
    categoria: 'clinica',
    criticidade: 'sensivel',
    escopos: ['unidade', 'local'],
    exigeConselho: true,
  },
  {
    codigo: C.sinaisRegistrar,
    descricao:
      'Registrar os sinais vitais na tela de classificação, sem concluí-la (técnico de enfermagem e enfermeiro)',

    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
    escopos: ['unidade', 'local'],
  },
  {
    codigo: C.protocoloLer,
    descricao:
      'Consultar os protocolos de classificação (versões, cores, tempos-alvo, discriminadores) e a tabela de cores antiga',

    // A diretoria clínica lê pelo perfil mesmo sem as opções do prontuário (chega à fila e aos protocolos pelo menu).
    concessaoPorPerfil: 'por-perfil',
    perfis: ['diretoria-clinica'],
    categoria: 'clinica',
    criticidade: 'normal',
    escopos: ['unidade', 'local'],
  },
  {
    codigo: C.protocoloPublicar,
    descricao:
      'Publicar uma versão do protocolo de classificação (diretoria clínica; Manchester só com a licença registrada)',

    concessaoPorPerfil: 'por-perfil',
    perfis: ['diretoria-clinica'],
    categoria: 'clinica',
    criticidade: 'critica',
    escopos: ['unidade', 'local'],
    exigeConselho: true,
  },
];
