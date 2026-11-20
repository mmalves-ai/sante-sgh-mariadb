// Estados do exame (ficha do M26, regra 1): a implementação mora em @sgh/contratos (o adaptador do legado deriva o
// estado nas leituras com a mesma regra); aqui, a reexportação e os testes da regra.
export {
  type AcaoExame,
  estadoDoExame,
  fatura,
  type MarcasExame,
  ordemDoEstado,
  podeNoEstado,
} from '@sgh/contratos';
