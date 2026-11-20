// Regra 13 sobre a cópia (consultas de controle): as duas réguas da receita de 2025 — pela data do item (BRIEF §3:
// ~R$ 83,6 mi cobrados e ~R$ 65,9 mi pagos) e pela competência da conta (cap-11 §11.3: R$ 83,9 mi e R$ 65,7 mi) —,
// e a glosa só dos itens baixados. Só somas agregadas saem.
import { seriesFinanceiras, totalDaSerie } from '@sgh/dominio-relatorio';
import { lerFinanceiroMensal } from '@sgh/legado';
import { afterAll, describe, expect, it } from 'vitest';
import { codigos, criarNucleo } from './escrita.spec-util.js';

const nucleo = codigos.length > 0 ? criarNucleo() : null;
const cod = codigos[0] ?? '';
afterAll(async () => {
  await nucleo?.encerrar();
});

const MESES = Array.from({ length: 12 }, (_, i) => `2025-${String(i + 1).padStart(2, '0')}`);
const mi = (v: number) => Math.round(v / 100_000) / 10;

describe.skipIf(!nucleo)('duas réguas da receita na cópia', () => {
  it('2025 nas duas réguas, com o nome da régua; glosa dos baixados', async () => {
    const t0 = performance.now();
    const linhas = await nucleo!.lerSomente(
      { rede: nucleo!.rede, hospital: cod, traceId: 'int-m16-receita' },
      (l) => lerFinanceiroMensal(l, '2025-01', '2025-12'),
    );
    const ms = Math.round(performance.now() - t0);
    const s = seriesFinanceiras(linhas, MESES, '2099-01');
    const v = (c: string) =>
      mi(
        totalDaSerie(
          s.find((x) => x.codigo === c)!,
          MESES,
        ),
      );
    const r = {
      cobradoItem: v('cobrado-data-do-item'),
      pagoItem: v('pago-data-do-item'),
      cobradoCompetencia: v('cobrado-competencia'),
      pagoCompetencia: v('pago-competencia'),
    };
    console.log(`[${cod}] receita 2025 (R$ mi): ${JSON.stringify(r)} em ${ms} ms`);
    expect(r).toEqual({ cobradoItem: 83.6, pagoItem: 65.9, cobradoCompetencia: 83.9, pagoCompetencia: 65.7 });
    const glosa = s.find((x) => x.codigo === 'glosa-baixados')!;
    expect(glosa.valores.every((x) => x.valor === null || (x.valor >= 0 && x.valor < 100))).toBe(true);
  });
});
