// Lote migrado sem validade no gasto de sala (recusas da carga, fase 2, decisão D1) contra o MariaDB real (cliente de
// teste da massa de suprimentos, SGH_CLIENTE_TESTE; massa SINTÉTICA "F22L0314", nenhuma pessoa real). A conferência
// do lote do item (loteValido, chamada por gravarDoAto para cada item com lote) recusa o lote de origem 'migracao' e
// validade nula com a mensagem própria no campo do item (nunca "vencido"), e aceita o lote da massa com validade.
// A gravação inteira do ato (equipe, lista padrão, conta) está em gasto-sala-propria.int.spec.ts; aqui só a regra do
// lote, pelo mesmo leitor da porta. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Leitor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from '../suprimentos/massa-propria.spec-util.js';
import { PortaGastoSalaPropria } from './gasto-sala-propria.js';

/** A conferência privada do lote, exposta só ao teste. */
type ComLoteValido = {
  loteValido(
    tx: Leitor,
    est: number,
    insumo: number,
    lote: number,
    hoje: string,
    k: number,
  ): Promise<unknown>;
};

describe.skipIf(SEM_BANCO)('lote sem validade no gasto de sala (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let m: MassaSuprimentos;
  let porta: ComLoteValido;
  let loteSem = 0;
  const ctxE = { cliente: CLIENTE, correlacao: 't-rlsvc' };
  const conferir = (lote: number, k: number) =>
    nucleo
      .lerSomente(ctxE, (l) => porta.loteValido(l, m.estA, m.insumo, lote, '2026-11-26', k))
      .then(
        () => null,
        (e: { problema?: Record<string, unknown> }) => e.problema ?? {},
      );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaGastoSalaPropria(nucleo, CLIENTE) as unknown as ComLoteValido;
    loteSem = await nucleo.escrever(ctxE, (e) =>
      inserirMinimo(
        e,
        'lote_insumo',
        {
          estabelecimento_id: m.estA,
          insumo_id: m.insumo,
          numero_lote: `${m.marca}SVC`,
          validade: null,
          situacao: 'liberado',
          origem: 'migracao',
        },
        m.marca,
      ),
    );
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  });

  it('o lote sem validade é recusado no campo do item com "lote sem validade"; o lote com validade passa', async () => {
    const r = await conferir(loteSem, 1);
    expect(r).toMatchObject({ campos: ['itens.1.lote'] });
    expect(String(r?.['detail'])).toMatch(/Item 2: lote sem validade \(não informada na origem\)/);
    expect(String(r?.['detail'])).not.toMatch(/vencid/i);
    expect(await conferir(m.lote, 0)).toBeNull();
  });
});
