// Constantes do motor de preços e dos convênios (ficha do M12, seções 5 e 8; ref 05 §1.3; cap-11 §11.3).
// Números medidos na cópia do ProntoCardio (2026-10-20, contagens agregadas) ou vindos da sante-api, que já
// grava situação e reajuste em produção (src/services/acoes-precos.js e acoes-convenio-situacao.js).

/** A tabela de honorários compartilhada por SUS (1) e Particular (10): reajuste exige confirmação (regra 5). */
export const TABELA_COMPARTILHADA = 10;

/** Tabelas cujo preço final passa por percentual em TBPERTHM (alerta com confirmação; ref 05 §1.3). */
export const TABELAS_COM_PERCENTUAL: readonly number[] = [315, 617, 619, 622, 623, 624, 625, 626];

/** Percentual da tabela 625 em TBPERTHM: significado não confirmado (DP-33, regra 7). */
export const TABELA_PERCENTUAL_A_CONFIRMAR = 625;

/** Itens por transação curta do reajuste (ficha, seção 5: "transações curtas de até 200 itens"). */
export const ITENS_POR_TRANSACAO = 200;

/** Teto de itens de uma proposta de reajuste (a maior tabela tem cerca de 4.900 itens). */
export const TETO_ITENS_PROPOSTA = 6000;

/** Teto de linhas de um arquivo de importação de tabela de preço. */
export const TETO_LINHAS_IMPORTACAO = 20000;

/** Teto de página das grades de preço (regra do cap-10 §10.11: toda leitura tem teto). */
export const TETO_PAGINA_PRECOS = 500;

/** Maior valor aceito nas colunas NUMERIC(10,2) de TBVLRTHM (VALOR_ANES, VALOR_FILME). */
export const VALOR_MAXIMO_COMPONENTE = 99999999.99;

/** Casas decimais aceitas num valor informado (unitário com 4 casas; cap-10 §10.2). */
export const CASAS_MAXIMAS_VALOR = 4;

/** Sentinela de data do Delphi (TDateTime 0): vale como "sem data" (regra 1). */
export const DATA_SENTINELA = '1899-12-30';

/** Situações de convênio que o legado usa (TBCONVEN.SITUACAO, 44 A e 33 I na cópia). */
export const SITUACOES_CONVENIO = ['A', 'I'] as const;
export type SituacaoConvenio = (typeof SITUACOES_CONVENIO)[number];

/** Abas do contrato (ficha, seção 7). */
export const ABAS_CONTRATO = [
  'cadastro',
  'tabelas',
  'modificadores',
  'faturabilidade',
  'pacotes',
  'tiss',
  'financeiro',
] as const;
export type AbaContrato = (typeof ABAS_CONTRATO)[number];

/** Abas cujo conteúdo o novo altera neste marco (temas 1, 2, 13 e 17; o resto em consulta). */
export const ABAS_EDITAVEIS: readonly AbaContrato[] = ['cadastro', 'faturabilidade', 'financeiro'];

/** Origem registrada em SGH_PRECO_AUTORIA (ficha, seção 6). */
export const ORIGENS_AUTORIA = ['reajuste', 'desfazer', 'importacao', 'situacao', 'contrato'] as const;
export type OrigemAutoria = (typeof ORIGENS_AUTORIA)[number];

/** Situações da carga em SGH_CAT_CARGA (ficha, seção 6; reaproveitada pelo M13). */
export const SITUACOES_CARGA = ['preparada', 'validada', 'comparada', 'publicada', 'rejeitada'] as const;
export type SituacaoCarga = (typeof SITUACOES_CARGA)[number];

/** Tipos de tabela de preço do legado (THM honorários, DTH diárias e taxas, MEM mat/med). */
export const TIPOS_TABELA_PRECO = ['honorarios', 'diarias', 'matmed'] as const;
export type TipoTabelaPreco = (typeof TIPOS_TABELA_PRECO)[number];

/** Chaves de liberação do marco (SGH_CFG_LIBERACAO, por hospital; ficha, seção 12). */
export const CHAVES_LIBERACAO_M12 = ['convenio.escrita', 'preco.escrita'] as const;
