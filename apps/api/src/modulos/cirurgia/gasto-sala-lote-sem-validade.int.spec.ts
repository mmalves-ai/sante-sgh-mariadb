// Lote migrado sem validade no gasto de sala (recusas da carga, fase 2, decisão D1) contra o MariaDB real (cliente de
// teste da massa de suprimentos, SGH_CLIENTE_TESTE; massa SINTÉTICA "F22L0314" e o ato "C0400", nenhuma pessoa real),
// pela gravação do ato (gravarDoAto) com a mesma massa de gasto-sala-propria.int.spec.ts: o item com o lote de origem
// 'migracao' e validade nula é recusado com a mensagem própria no campo do item (nunca "vencido") e nada grava; o
// mesmo gasto com o lote da massa (com validade) grava. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CLIENTE, inserirMinimo, SEM_BANCO } from '../suprimentos/massa-propria.spec-util.js';
import { desmontarAto, type Massa, montarAto, P } from './gasto-sala-ato.spec-util.js';
import { PortaGastoSalaPropria } from './gasto-sala-propria.js';

describe.skipIf(SEM_BANCO)('lote sem validade no gasto de sala (MariaDB)', () => {
  const nucleo = new NucleoProprio();
  let m: Massa;
  let porta: PortaGastoSalaPropria;
  let loteSem = 0;
  const ctx = () => ({
    cliente: CLIENTE,
    hospital: m.hospital,
    usuario: m.s.usuario,
    correlacao: `${P}-rlsvc`,
  });
  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${P}-rlsvc` }, (l) =>
      l.consultar<T & Record<string, unknown>>(sql, p),
    );
  const gastos = async () =>
    Number(
      (
        await ler<{ n: unknown }>('SELECT COUNT(*) AS n FROM consumo_cirurgia WHERE ato_cirurgico_id = ?', [
          m.ato,
        ])
      )[0]?.n,
    );

  beforeAll(async () => {
    m = await montarAto(nucleo);
    porta = new PortaGastoSalaPropria(nucleo, CLIENTE);
    loteSem = await nucleo.escrever({ cliente: CLIENTE, correlacao: `${P}-rlsvc` }, (e) =>
      inserirMinimo(
        e,
        'lote_insumo',
        {
          estabelecimento_id: m.s.estA,
          insumo_id: m.s.insumo,
          numero_lote: `${m.s.marca}SVC`,
          validade: null,
          situacao: 'liberado',
          origem: 'migracao',
        },
        m.s.marca,
      ),
    );
  }, 180_000);

  afterAll(async () => {
    if (m) await desmontarAto(nucleo, m);
    await nucleo.encerrar();
  }, 180_000);

  it('o item com o lote sem validade é recusado no seu campo com "lote sem validade"; nada grava', async () => {
    const r = await porta
      .gravarDoAto(ctx(), m.ato, {
        local: m.s.localA,
        itens: [
          { insumo: m.s.insumo, quantidade: 1, lote: m.s.lote, faturar: false },
          { insumo: m.s.insumo, quantidade: 1, lote: loteSem, faturar: false },
        ],
      })
      .then(
        () => null,
        (e: { problema?: Record<string, unknown> }) => e.problema ?? {},
      );
    expect(r).toMatchObject({ codigo: 'regra-violada', campos: ['itens.1.lote'] });
    expect(String(r?.['detail'])).toMatch(/Item 2: lote sem validade \(não informada na origem\)/);
    expect(String(r?.['detail'])).not.toMatch(/vencid/i);
    expect(await gastos()).toBe(0);
  });

  it('o mesmo gasto com o lote da massa (com validade) grava', async () => {
    const r = await porta.gravarDoAto(ctx(), m.ato, {
      local: m.s.localA,
      itens: [{ insumo: m.s.insumo, quantidade: 1, lote: m.s.lote, faturar: false }],
    });
    expect(r.id).toBeGreaterThan(0);
    expect(await gastos()).toBe(1);
  });
});
