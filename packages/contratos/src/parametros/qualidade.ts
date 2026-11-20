// Parâmetros da gestão da qualidade, etapa 5 do M48 (ficha, regra 9: ficha técnica com meta e polaridade): a meta de
// cada indicador da qualidade (as densidades das IRAS, a utilização de dispositivo e a adesão à higiene das mãos), no
// mesmo formato das metas dos indicadores do censo (M16). Padrão "sem meta" (POL-1): a CCIH e o escritório da qualidade
// definem na validação; a análise crítica registra a meta vigente na competência.
import {
  DIAS_UTEIS_RESPOSTA_OUVIDORIA,
  INDICADORES_QUALIDADE,
  LINHAS_DE_CUIDADO,
  parametroMetaChaveLinha,
} from '../qualidade/gestao.js';
import {
  PARAMETRO_CANAL_HALAI_OUVIDORIA,
  PARAMETRO_PRAZO_OUVIDORIA,
} from '../qualidade/ouvidoria-indicadores.js';
import { FORMATO_META_INDICADOR } from '../relatorio/indicadores.js';
import {
  PARAMETRO_PRAZO_PENDENCIA_REVISAO,
  PRAZO_PENDENCIA_REVISAO_DIAS,
} from '../qualidade/revisao-prontuario.js';
import type { DefinicaoParametro } from './definicoes.js';

const METAS_QUALIDADE: readonly DefinicaoParametro[] = INDICADORES_QUALIDADE.map(
  ({ codigo, nome }): DefinicaoParametro => ({
    chave: `qualidade.meta.${codigo}`,
    modulo: 'qualidade',
    descricao: `Meta do indicador ${nome} (um número, como 2 ou 2,5, na unidade do indicador; "sem meta" quando não houver)`,
    tipo: 'texto',
    padrao: 'sem meta',
    formato: {
      expressao: FORMATO_META_INDICADOR,
      mensagem: 'Informe só o número da meta (por exemplo, 2 ou 2,5, sem o símbolo %) ou "sem meta".',
    },
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'CCIH e escritório da qualidade',
    origem: 'ficha do M48, regra 9 (ficha técnica com meta, polaridade e análise crítica)',
  }),
);

/**
 * W0-04 (M4, ouvidoria/SAC hospitalar): o prazo da resposta ao manifestante em dias úteis do calendário do
 * estabelecimento (padrão 10, a prática das ouvidorias do SUS) e a chave do canal da Hal-AI, desligado até o dono
 * configurar o canal (a entrada pelo portal do paciente não depende de chave: é a API da ouvidoria).
 */
const PARAMETROS_OUVIDORIA: readonly DefinicaoParametro[] = [
  {
    chave: PARAMETRO_PRAZO_OUVIDORIA,
    modulo: 'qualidade',
    descricao: 'Prazo da resposta da ouvidoria ao manifestante, em dias úteis depois do recebimento',
    tipo: 'inteiro',
    padrao: String(DIAS_UTEIS_RESPOSTA_OUVIDORIA),
    minimo: 1,
    maximo: 60,
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'ouvidoria e escritório da qualidade',
    origem: 'W0-04 (M4): prazo parametrizável da ouvidoria, padrão de 10 dias úteis',
  },
  {
    chave: PARAMETRO_CANAL_HALAI_OUVIDORIA,
    modulo: 'qualidade',
    descricao:
      'Aceitar manifestações vindas do atendimento digital (Hal-AI); desligado até o canal ser configurado',
    tipo: 'booleano',
    padrao: 'nao',
    niveis: ['estabelecimento', 'rede'],
    critico: true,
    dono: 'ouvidoria e dono do projeto',
    origem:
      'W0-04 (M4): entrada da ouvidoria pela Hal-AI desligada por parâmetro até o dono configurar o canal',
  },
];

/**
 * W0-04 (M3, linhas de cuidado): a meta-chave de cada protocolo gerenciado (o código da meta na definição publicada)
 * cujo tempo dá a mediana e o percentual no alvo. Padrão: a meta das diretrizes públicas (antibiótico na sepse, ECG na
 * dor torácica, tomografia no AVC); a diretoria clínica troca quando a definição usar outro código.
 */
const PARAMETROS_LINHAS: readonly DefinicaoParametro[] = LINHAS_DE_CUIDADO.map((l): DefinicaoParametro => ({
  chave: parametroMetaChaveLinha(l.tipo),
  modulo: 'qualidade',
  descricao: `Código da meta-chave do protocolo de ${l.rotulo} (o tempo dela dá a mediana e o percentual no alvo)`,
  tipo: 'texto',
  padrao: l.metaChave,
  formato: {
    expressao: '^[a-z][a-z0-9-]{1,39}$',
    mensagem: 'Informe o código da meta como está na definição do protocolo (minúsculas, sem espaço).',
  },
  niveis: ['estabelecimento', 'rede'],
  critico: false,
  dono: 'diretoria clínica e escritório da qualidade',
  origem: 'W0-04 (M3): indicadores das linhas de cuidado (mediana e percentual no alvo da meta-chave)',
}));

/** W0-04 (M5): o prazo da pendência de prontuário ao profissional (dias corridos depois da revisão). */
const PARAMETROS_REVISAO: readonly DefinicaoParametro[] = [
  {
    chave: PARAMETRO_PRAZO_PENDENCIA_REVISAO,
    modulo: 'qualidade',
    descricao:
      'Prazo, em dias corridos, para o profissional responder a pendência de prontuário apontada pela comissão de revisão',
    tipo: 'inteiro',
    padrao: String(PRAZO_PENDENCIA_REVISAO_DIAS),
    minimo: 1,
    maximo: 90,
    niveis: ['estabelecimento', 'rede'],
    critico: false,
    dono: 'comissão de revisão de prontuários',
    origem: 'W0-04 (M5): pendências da revisão de prontuários ao profissional',
  },
];

export const PARAMETROS_QUALIDADE: readonly DefinicaoParametro[] = [
  ...METAS_QUALIDADE,
  ...PARAMETROS_OUVIDORIA,
  ...PARAMETROS_LINHAS,
  ...PARAMETROS_REVISAO,
];
