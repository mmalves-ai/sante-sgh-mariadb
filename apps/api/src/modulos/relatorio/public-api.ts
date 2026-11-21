// Módulo relatorio da API (M34): catálogo de relatórios parametrizados, triagem dos relatórios de SQL livre, pedidos e
// envio agendado.
export {
  FILA_ENVIO_RELATORIO,
  GERADOR_PDF_RELATORIO,
  CatalogoRelatoriosController,
} from './relatorio.controller.js';
export { PORTA_RELATORIO, type PortaRelatorio } from './porta.js';
export { portaRelatorioIndisponivel, PortaRelatorioPropria } from './porta-propria.js';
export { PortaRelatorioMemoria } from './porta-memoria.js';
export { FilaEnvioPorValkey } from './infra/fila-envio.js';
export { ConfiguracaoM34, type EstadoRecurso, type SujeitoM34 } from './aplicacao/configuracao.js';
export type { FilaEnvioRelatorio } from './aplicacao/gestao.js';
// M57 (etapa 3): o BI consolidado da Rede.
export { BiRedeController } from './bi-rede.controller.js';
export { planilhaDaSerieRede, ServicoBiRede } from './aplicacao/bi-rede.js';
// M54.3: a planilha XLSX mínima, também para as demonstrações contábeis.
export { gerarXlsx, type PlanilhaExportacao } from './aplicacao/exportar.js';
