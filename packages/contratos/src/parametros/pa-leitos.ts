// Parâmetros do W0-07 (programa CRUD completo: NIR, mapa de leitos e observação do PA; mercado M1 e M4). Padrão de
// mercado (POL-1); o protocolo institucional ajusta por estabelecimento sem mudar código.
import { PARAMETRO_LIMIAR_NEWS2_SEPSE, PARAMETRO_LIMIAR_QSOFA_SEPSE } from '../atendimento/escore-pa.js';
import type { DefinicaoParametro } from './definicoes.js';

/** M4: a OS da manutenção com local igual a um leito propõe o bloqueio por manutenção (desligado por padrão). */
export const PARAMETRO_OS_BLOQUEIA_LEITO = 'adt.osBloqueiaLeito';

export const PARAMETROS_PA_LEITOS: readonly DefinicaoParametro[] = [
  {
    chave: PARAMETRO_LIMIAR_NEWS2_SEPSE,
    modulo: 'atendimento',
    descricao:
      'NEWS2 a partir do qual o quadro do pronto atendimento sugere abrir o protocolo de sepse (o padrão de mercado é 5)',
    tipo: 'inteiro',
    padrao: '5',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 20,
    dono: 'comissão do protocolo de sepse (diretoria clínica)',
    origem: 'W0-07, mercado M1 (alerta de deterioração e sepse no PA; protocolo do ILAS)',
  },
  {
    chave: PARAMETRO_LIMIAR_QSOFA_SEPSE,
    modulo: 'atendimento',
    descricao:
      'qSOFA a partir do qual o quadro do pronto atendimento sugere abrir o protocolo de sepse (o padrão de mercado é 2)',
    tipo: 'inteiro',
    padrao: '2',
    niveis: ['unidade', 'estabelecimento', 'rede'],
    critico: false,
    minimo: 1,
    maximo: 3,
    dono: 'comissão do protocolo de sepse (diretoria clínica)',
    origem: 'W0-07, mercado M1 (alerta de deterioração e sepse no PA; Sepsis-3)',
  },
  {
    chave: PARAMETRO_OS_BLOQUEIA_LEITO,
    modulo: 'adt',
    descricao:
      'A ordem de serviço da manutenção aberta num leito propõe o bloqueio do leito por manutenção; ao encerrar a OS, o bloqueio encerra e a higienização é solicitada',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'NIR e manutenção',
    origem: 'W0-07, mercado M4 (integração da manutenção predial com o bloqueio de leito)',
  },
];
