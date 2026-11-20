// Permissões do M44, etapa 1 (ficha, seção 7; convencoes.md §12): classificação de risco no pronto atendimento e o
// protocolo de classificação. Recurso só do novo: a árvore de opções do sistema anterior não tem item de
// classificação de risco (retrato tools/verificadores/dados/acesso-legado.pc.json: nenhuma opção com "classificação
// de risco", "Manchester", "triagem" ou "acolhimento" no PA; a classificação de hoje é o formulário E08 do PEP, que
// enfermeiros registram pelas opções da evolução). Por isso:
//   - ler segue quem vê o registro clínico (opções da evolução do PEP, M22) e quem localiza o paciente no PA (3900);
//   - classificar e reclassificar são privativos do enfermeiro com conselho ativo (regra 1; cap-08 §8.4; Resolução
//     COFEN 661/2021): concedidos por perfil (SGH_ACESSO_MAPA_OPCAO, perfil assistencial com conselho; o mapa grupo
//     → perfil leva ENFERMAGEM_ENFERMEIRO e ENFERMAGEM_SUPERVISAO) e conferidos na hora pela categoria do vínculo
//     (enfermeiro, COREN ativo); o técnico só registra os sinais vitais na mesma tela; a recepção não classifica;
//   - publicar o protocolo é da diretoria clínica (perfil complementar `diretoria-clinica`, concedido nominalmente
//     pela gestão de acessos; crítica: reautenticação; o autor da versão é outro usuário ativo que lê protocolos).
// Escopos do módulo (unidade e local, como o M19); o vínculo assistencial é a regra 7 do M06, conferida na hora.
// Conferir com a enfermagem e a diretoria clínica na validação (DP-3).
import { OPCOES_PEP_EVOLUCAO_CRIAR, OPCOES_PEP_EVOLUCAO_LER } from './pep.js';
import type { DeclaracaoPermissao } from './tipos.js';

/** Localizar paciente (P.E.P. › Movimentações), a mesma leitura do quadro do PA (M20). */
const LOCALIZAR_PACIENTE = 3900;

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
    opcoesLegado: [...OPCOES_PEP_EVOLUCAO_LER, LOCALIZAR_PACIENTE],
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
    opcoesLegado: [...OPCOES_PEP_EVOLUCAO_CRIAR],
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
    opcoesLegado: [...OPCOES_PEP_EVOLUCAO_CRIAR],
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
    opcoesLegado: [...OPCOES_PEP_EVOLUCAO_CRIAR],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'normal',
    escopos: ['unidade', 'local'],
  },
  {
    codigo: C.protocoloLer,
    descricao:
      'Consultar os protocolos de classificação (versões, cores, tempos-alvo, discriminadores) e a tabela de cores antiga',
    opcoesLegado: [...OPCOES_PEP_EVOLUCAO_LER, LOCALIZAR_PACIENTE],
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
    opcoesLegado: [],
    concessaoPorPerfil: 'por-perfil',
    perfis: ['diretoria-clinica'],
    categoria: 'clinica',
    criticidade: 'critica',
    escopos: ['unidade', 'local'],
    exigeConselho: true,
  },
];
