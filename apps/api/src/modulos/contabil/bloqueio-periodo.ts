// A regra do bloqueio do período contábil mora no pacote comum da contabilidade (API e worker usam a mesma).
export {
  avisoDoBloqueio,
  type BloqueioDoLancamento,
  bloqueioDoLancamento,
  type PeriodoParaLancar,
} from '@sgh/persistencia-contabil';
