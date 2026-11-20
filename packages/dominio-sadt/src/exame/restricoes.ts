// Restrições do pedido e do lançamento (ficha do M26, regra 6): a implementação mora em @sgh/contratos (as receitas do
// adaptador conferem a mesma regra na transação); aqui, a reexportação e os testes da regra.
export {
  type AvisoRestricao,
  decisaoDasRestricoes,
  emDias,
  idadeEmDias,
  type NivelRestricao,
  type PacienteRestricao,
  repeticao,
  type RestricaoCadastro,
  restricoesDoExame,
} from '@sgh/contratos';
