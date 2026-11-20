// W0-09 (programa CRUD completo, M2): hora confiável (NGS1.07.05: a data e a hora da trilha são confiáveis). O painel
// de saúde mede o desvio do relógio do servidor da API e do banco contra a referência do NTP.br; o servidor NTP e o
// limiar do alerta são parâmetros (sem acesso de rede ao NTP, o indicador sai 'sem referência'). Tudo se grava em UTC
// e se exibe no fuso da instituição, parâmetro hierárquico (estabelecimento sobre a rede).
import type { DefinicaoParametro } from './definicoes.js';

export const PARAMETRO_NTP_SERVIDOR = 'sistema.ntpServidor';
export const PARAMETRO_NTP_LIMIAR_MS = 'sistema.ntpLimiarMs';
export const PARAMETRO_FUSO_INSTITUICAO = 'sistema.fusoInstituicao';

/** Servidor público do NTP.br (estrato 1, Observatório Nacional/NIC.br). */
export const NTP_SERVIDOR_PADRAO = 'a.st1.ntp.br';
export const NTP_LIMIAR_PADRAO_MS = 1_000;
export const FUSO_INSTITUICAO_PADRAO = 'America/Sao_Paulo';

/** Fusos civis do Brasil (IANA): só norma brasileira. */
export const FUSOS_BRASIL = [
  'America/Noronha',
  'America/Sao_Paulo',
  'America/Bahia',
  'America/Fortaleza',
  'America/Recife',
  'America/Maceio',
  'America/Belem',
  'America/Araguaina',
  'America/Santarem',
  'America/Manaus',
  'America/Cuiaba',
  'America/Campo_Grande',
  'America/Porto_Velho',
  'America/Boa_Vista',
  'America/Rio_Branco',
  'America/Eirunepe',
] as const;

export const PARAMETROS_HORA_CONFIAVEL: readonly DefinicaoParametro[] = [
  {
    chave: PARAMETRO_NTP_SERVIDOR,
    modulo: 'sistema',
    descricao: 'Servidor NTP de referência da hora confiável (painel de saúde)',
    tipo: 'texto',
    padrao: NTP_SERVIDOR_PADRAO,
    niveis: ['rede'],
    critico: true,
    formato: {
      expressao: '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$',
      mensagem: 'Informe o nome do servidor NTP (ex.: a.st1.ntp.br)',
    },
    dono: 'Infraestrutura',
    origem:
      'W0-09 (programa CRUD completo): hora confiável, NGS1.07.05; acesso de rede ao NTP.br depende do dono',
  },
  {
    chave: PARAMETRO_NTP_LIMIAR_MS,
    modulo: 'sistema',
    descricao: 'Desvio do relógio contra o NTP acima do qual o painel de saúde alerta (milissegundos)',
    tipo: 'inteiro',
    padrao: String(NTP_LIMIAR_PADRAO_MS),
    minimo: 100,
    maximo: 60_000,
    niveis: ['rede'],
    critico: false,
    dono: 'Infraestrutura',
    origem: 'W0-09 (programa CRUD completo): hora confiável, NGS1.07.05',
  },
  {
    chave: PARAMETRO_FUSO_INSTITUICAO,
    modulo: 'sistema',
    descricao: 'Fuso da instituição: as horas são gravadas em UTC e exibidas neste fuso',
    tipo: 'lista',
    padrao: FUSO_INSTITUICAO_PADRAO,
    opcoes: FUSOS_BRASIL,
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'Dono do projeto',
    origem:
      'W0-09 (programa CRUD completo): hora confiável, gravação em UTC e exibição no fuso da instituição',
  },
];
