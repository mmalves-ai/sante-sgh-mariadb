// Permissões do M46, etapa 2 (ficha, seção 7; convencoes.md §12): checklist de cirurgia segura (OMS), rastreio do
// paciente no bloco e quadro do bloco. Quem tem a opção no sistema anterior tem a permissão no novo (regra 1 do M06).
// Opções da árvore TBOPCOES (retrato tools/verificadores/dados/acesso-legado.pc.json):
//   - P.E.P. › Movimentações › Registro cirúrgico 6813: Consultar 6814, Nova 6820, Manter 6821, Salvar 6823, Corrigir
//     6828 (o checklist é conduzido pela enfermagem do bloco, a mesma que grava o registro cirúrgico);
//   - Bloco Cirúrgico: o módulo 2227, o mapa 2293, os movimentos 2236 (a movimentação do paciente no bloco) e os
//     parâmetros 2229 e do bloco 2230 (a coordenação do bloco: a exceção da trava da incisão em urgência).
// O painel para familiares não tem permissão de pessoa: abre pelo token do dispositivo (perfil Painel/Totem do M19).
import { OPCOES_REGISTRO_CIRURGICO_PEP } from './anestesia.js';
import { OPCOES_BLOCO } from './cirurgia.js';
import type { DeclaracaoPermissao } from './tipos.js';

export const PERMISSOES_BLOCO_SEGURO_CODIGOS = {
  checklistLer: 'cirurgia.checklist.ler',
  checklistConfirmar: 'cirurgia.checklist.confirmar',
  checklistExcecao: 'cirurgia.checklist.excecao',
  rastreioLer: 'cirurgia.rastreio.ler',
  rastreioMover: 'cirurgia.rastreio.mover',
} as const;

const R = OPCOES_REGISTRO_CIRURGICO_PEP;
const B = OPCOES_BLOCO;
const C = PERMISSOES_BLOCO_SEGURO_CODIGOS;

export const PERMISSOES_BLOCO_SEGURO_M46: readonly DeclaracaoPermissao[] = [
  {
    codigo: C.checklistLer,
    descricao: 'Consultar o checklist de cirurgia segura (três momentos, quem confirmou e a hora)',
    opcoesLegado: [R.modulo, R.consultar, B.modulo, B.mapa],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.checklistConfirmar,
    descricao:
      'Conduzir o checklist de cirurgia segura (circulante): confirmar os itens e concluir cada momento',
    opcoesLegado: [R.nova, R.manter, R.salvar, R.corrigir],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.checklistExcecao,
    descricao:
      'Registrar a exceção da trava da incisão em urgência (supervisor do bloco, com o motivo; vai à auditoria)',
    opcoesLegado: [B.parametros, B.parametrosBloco],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'critica',
  },
  {
    codigo: C.rastreioLer,
    descricao:
      'Consultar o quadro do bloco e o rastreio do paciente (local, horários e o código do painel para familiares)',
    opcoesLegado: [B.modulo, B.mapa, B.movimentos],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
  {
    codigo: C.rastreioMover,
    descricao: 'Registrar a movimentação do paciente no bloco (entrada, mudança de local, saída e o retorno)',
    opcoesLegado: [B.movimentos],
    concessaoPorPerfil: null,
    categoria: 'clinica',
    criticidade: 'sensivel',
  },
];
