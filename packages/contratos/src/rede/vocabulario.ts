// Vocabulário do MPI da Rede (M57, etapa 1: índice da Rede, pareamento, fila de revisão; ficha, seções 6 e 8; cap-07
// §7.7.3). O índice mora nas tabelas SGH_REDE_* de CADA banco dos estabelecimentos da rede (nenhuma transação cruza os
// bancos; regra 4) e nunca altera nem apaga cadastro de paciente (regra 1). A tela mostra os rótulos, nunca o código cru.

/** De onde veio o vínculo (SGH_REDE_VINCULO.ORIGEM): pareamento automático (regra 2) ou decisão humana na fila. */
export const ORIGENS_VINCULO_REDE = ['automatico', 'humano'] as const;
export type OrigemVinculoRede = (typeof ORIGENS_VINCULO_REDE)[number];

/** Situação do vínculo no índice: desfazer só marca `desfeito` (a ligação do índice; regra 1). */
export const SITUACOES_VINCULO_REDE = ['ativo', 'desfeito'] as const;
export type SituacaoVinculoRede = (typeof SITUACOES_VINCULO_REDE)[number];

/**
 * Situação do par provável (SGH_REDE_CANDIDATO.SITUACAO): `aberto` está na fila; `vinculado` virou vínculo (automático
 * ou humano); `outra_pessoa` foi descartado por uma pessoa (o pareamento automático nunca religa esse par).
 */
export const SITUACOES_CANDIDATO_REDE = ['aberto', 'vinculado', 'outra_pessoa'] as const;
export type SituacaoCandidatoRede = (typeof SITUACOES_CANDIDATO_REDE)[number];

/**
 * O que o pareamento sabe de um par já gravado: a situação, ou `reaberto` quando uma pessoa desfez o vínculo e devolveu
 * o par à fila (SITUACAO 'aberto' com ORIGEM 'humano'). O par reaberto só sai da fila por uma pessoa: o automático nunca
 * o religa (regras 2 e 3).
 */
export type SituacaoParAnteriorRede = SituacaoCandidatoRede | 'reaberto';

/** Critérios que bateram no par (gravados em SGH_REDE_CANDIDATO.CRITERIOS, separados por vírgula). */
export const CRITERIOS_PAREAMENTO_REDE = [
  'cpf',
  'cns',
  'nome',
  'nome_fonetico',
  'mae',
  'mae_fonetica',
  'nascimento',
  'sexo',
] as const;
export type CriterioPareamentoRede = (typeof CRITERIOS_PAREAMENTO_REDE)[number];

/** Dados que divergem no par (impedem o vínculo automático; regra 2). */
export const DIVERGENCIAS_PAREAMENTO_REDE = [
  'cpf_diferente',
  'nascimento_diferente',
  'sexo_diferente',
  'nome_diferente',
] as const;
export type DivergenciaPareamentoRede = (typeof DIVERGENCIAS_PAREAMENTO_REDE)[number];

/** Pontuação mínima para o par ir à fila de revisão (abaixo, o par é descartado sem gravar). */
export const LIMIAR_FILA_REDE = 50;

/** Faixas da pontuação (fila, filtro e medição na cópia só em agregados; ficha, seção 10). */
export const FAIXAS_PONTUACAO_REDE = {
  alta: { minimo: 85, maximo: 100 },
  media: { minimo: 70, maximo: 84 },
  baixa: { minimo: LIMIAR_FILA_REDE, maximo: 69 },
} as const;
export type FaixaPontuacaoRede = keyof typeof FAIXAS_PONTUACAO_REDE;
export const FAIXAS_PONTUACAO_REDE_CODIGOS = [
  'alta',
  'media',
  'baixa',
] as const satisfies readonly FaixaPontuacaoRede[];

/** Faixa de uma pontuação da fila (null abaixo do limiar). */
export function faixaPontuacaoRede(pontuacao: number): FaixaPontuacaoRede | null {
  for (const f of FAIXAS_PONTUACAO_REDE_CODIGOS)
    if (pontuacao >= FAIXAS_PONTUACAO_REDE[f].minimo && pontuacao <= FAIXAS_PONTUACAO_REDE[f].maximo)
      return f;
  return null;
}

/** Tabelas do índice da Rede: as únicas que o grupo `rede` grava (regra 1; `pnpm guardas:legado`). */
export const TABELAS_INDICE_REDE = [
  'SGH_REDE_PESSOA',
  'SGH_REDE_VINCULO',
  'SGH_REDE_CANDIDATO',
  'SGH_REDE_SERVICO_COMPART',
  'SGH_REDE_MARCA',
] as const;
export type TabelaIndiceRede = (typeof TABELAS_INDICE_REDE)[number];

/** Tipos de divergência entre os índices dos bancos (relatório diário; regra 4; critério de aceite "0 divergência"). */
export const TIPOS_DIVERGENCIA_INDICE_REDE = [
  'ausente_em_um_banco',
  'situacao_diferente',
  'pessoa_diferente',
] as const;
export type TipoDivergenciaIndiceRede = (typeof TIPOS_DIVERGENCIA_INDICE_REDE)[number];

/** Chave de liberação do MPI em SGH_CFG_LIBERACAO (ficha, seção 12). */
export const CHAVE_LIBERACAO_MPI_REDE = 'rede.mpi';
