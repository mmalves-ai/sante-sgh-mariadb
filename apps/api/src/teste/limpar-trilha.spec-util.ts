// A limpeza da trilha de auditoria das massas sintéticas mora no @sgh/nucleo (limpar-trilha-teste.ts), comum aos
// testes de integração da API e do worker. Este arquivo só reexporta, para os testes da API que já o importam.
export {
  CHAVES_TRATADAS,
  conferirChavesTratadas,
  idsDaMassa,
  limparTrilhaDaMassa,
  sqlLimparTrilha,
} from '@sgh/nucleo';
export type { EstabelecimentosDaMassa } from '@sgh/nucleo';
