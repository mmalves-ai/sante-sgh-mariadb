// M59-F1: porta de memória do painel de contas do banco (dev e CI sem banco). Só contas técnicas do catálogo do
// cap-08 §8.10 e números sintéticos; nenhuma conta de pessoa (o agregado das não catalogadas sai só contado).
import type { ContaBancoLida, PrivilegioReal } from '@sgh/contratos';
import type { PortaContasBanco } from './porta.js';

const zero = { S: 0, I: 0, U: 0, D: 0, R: 0, X: 0, M: 0 };
const conta = (
  nome: string | null,
  p: Partial<Omit<ContaBancoLida, 'privilegios'>> & {
    privilegios?: Partial<ContaBancoLida['privilegios']>;
  } = {},
): ContaBancoLida => ({
  nome,
  tipo: 'usuario',
  existeLogin: false,
  ativa: null,
  quantidade: 1,
  objetosComEscrita: 0,
  papeis: [],
  ...p,
  privilegios: { ...zero, ...p.privilegios },
});

/** O inventário sintético (números de ordem de grandeza do cap-08 §8.10, não do banco). */
export const INVENTARIO_SINTETICO: readonly ContaBancoLida[] = [
  conta('AUTORIZADOR', {
    privilegios: { S: 2600, I: 2600, U: 2600, D: 2600, X: 130 },
    objetosComEscrita: 2600,
  }),
  conta('TISSWS', { privilegios: { S: 2600, I: 2600, U: 2600, D: 2600, X: 130 }, objetosComEscrita: 2600 }),
  conta('SGHBACKUP', {
    privilegios: { S: 2600, I: 2600, U: 2600, D: 2600, X: 130 },
    objetosComEscrita: 2600,
  }),
  conta('HAL_AI', { privilegios: { S: 3800 } }),
  conta('EPIMED', { privilegios: { S: 3800 } }),
  conta('EXCEL', { privilegios: { S: 2900 } }),
  conta('EXCEL_FIN', { privilegios: { S: 2900, I: 2, U: 2 }, objetosComEscrita: 2, papeis: ['MASTER'] }),
  conta('RELATORIO_FARMACIA', { privilegios: { S: 40 } }),
  conta('TOLIFE', { privilegios: { S: 20, I: 5 }, objetosComEscrita: 5 }),
  conta('PUBLIC', { privilegios: { S: 50, X: 5 } }),
  conta('SGH_SINTETICO', {
    privilegios: { S: 4000, I: 4000, U: 4000, D: 4000, X: 190 },
    objetosComEscrita: 4000,
  }),
  conta(null, { quantidade: 2, privilegios: { S: 10 } }),
  conta('MASTER', { tipo: 'papel' }),
  conta('SENIOR', { tipo: 'papel' }),
  conta('SGH_APLICACAO', {
    tipo: 'papel',
    privilegios: { S: 190, I: 190, U: 190, D: 150 },
    objetosComEscrita: 190,
  }),
];

export class PortaContasBancoMemoria implements PortaContasBanco {
  readonly destino = 'memoria' as const;
  constructor(
    private readonly privilegios: readonly PrivilegioReal[] = [],
    private readonly inventario: readonly ContaBancoLida[] = INVENTARIO_SINTETICO,
  ) {}
  contasSgh() {
    return { aplicacao: ['SGH_SINTETICO'], scripts: 'SGH_SCRIPTS_SINTETICO', leitura: null };
  }
  modulosComConta() {
    return [];
  }
  async lerInventario() {
    return { contas: this.inventario, loginsNaoLegiveis: 3 };
  }
  async lerPrivilegiosSgh() {
    return this.privilegios;
  }
  /** Sintético (M59-F3): a conta ampla da aplicação ainda apaga registro clínico; contas do outro sistema agregadas. */
  async lerDeleteClinico() {
    return this.deleteClinico;
  }
  deleteClinico: readonly { titular: string | null; tabelas: number }[] = [
    { titular: 'SGH_SINTETICO', tabelas: 55 },
    { titular: null, tabelas: 330 },
  ];
}
