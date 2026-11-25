// @sgh/dominio-recepcao (M19): regras puras da recepção, sem banco. Usadas pela API (fila, painel, supervisor), pela
// tela (eventos possíveis, texto da senha).
export * from './prioridade.js';
// 02-AGE 49: o grupo da marcação na senha da chegada.
export * from './prioridade-chegada.js';
export * from './fluxo.js';
export * from './painel.js';
export * from './identificacao.js';
export * from './indicadores.js';
// 02-REC linha 33: cadastro da estrutura da recepção (ponto, guichês e serviços de senha).
export * from './estrutura.js';
// 02-REC linha 33 (C2-005): locais de atendimento e encaminhamentos entre locais.
export * from './locais-atendimento.js';
// A máquina de estados da senha e a ordem da fila moram em @sgh/contratos (as receitas do legado as usam: o adaptador
// não importa os pacotes de domínio); daqui seguem para a API e a tela.
export {
  chamavel,
  CONFIG_FILA_PADRAO,
  decidirEvento,
  eventosPossiveis,
  ordenarFila,
  prioritariasSeguidas,
  situacaoDe,
  type ConfigFila,
  type Decisao,
  type EfeitoEvento,
  type EstadoSenha,
  type SenhaNaFila,
} from '@sgh/contratos';
// M27: a fila da recepção na página inicial (prioridade legal e guias aguardando autorização).
export * from './worklist/ordenacao.js';
// M44 (etapa 1): classificação de risco no pronto atendimento.
export * from './classificacao/index.js';
// 02-CAD linha 24: regra própria do plano da fonte pagadora na recepção (carteira, guia, senha, teto, pendência).
export * from './regra-plano.js';
