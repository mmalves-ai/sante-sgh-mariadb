// Quem assina (ficha do M26, regra 8): a implementação mora em @sgh/contratos (a receita confere a mesma regra na
// transação); aqui, a reexportação e os testes da regra.
export {
  ehMedico,
  ehResponsavelLaboratorio,
  podeLaudar,
  podeLiberar,
  type VinculoProfissional,
} from '@sgh/contratos';
