// Regra 10 (M34; cap-14 §14.5): a mensagem na fila de mortos sem tratamento há mais de 4 h gera o log de alerta que a
// regra provisionada no Grafana (infra/observabilidade/…/alerting/integracoes.yml) conta: a regra procura exatamente a
// linha que o worker escreve; a tratada e a recente não alertam.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { parse } from 'yaml';
import type { EnvioEntrega } from './porta-propria.js';

const mortos = vi.hoisted(() => ({ lista: [] as Partial<EnvioEntrega>[] }));
vi.mock('./porta-propria.js', async (o) => ({
  ...(await o<typeof import('./porta-propria.js')>()),
  lerMortos: async () => mortos.lista,
}));
const { verificarAlertasMortos } = await import('./integracao.service.js');

const MENSAGEM = 'alerta das integrações: fila de mortos sem tratamento';

describe('alerta da fila de mortos (regra 10)', () => {
  it('a regra provisionada conta a linha que o worker escreve, acima de zero', () => {
    const y = parse(
      readFileSync(
        resolve(
          import.meta.dirname,
          '../../../../infra/observabilidade/grafana/provisionamento/alerting/integracoes.yml',
        ),
        'utf8',
      ),
    ) as { groups: { rules: { uid: string; data: { model: { expr?: string } }[] }[] }[] };
    const regra = y.groups[0]!.rules.find((r) => r.uid === 'sgh-integracoes-mortos-4h')!;
    expect(regra.data[0]!.model.expr).toContain(`|= "${MENSAGEM}"`);
    const src = readFileSync(resolve(import.meta.dirname, 'integracao.service.ts'), 'utf8');
    expect(src).toContain(`'${MENSAGEM}'`);
  });

  it('só a morta sem tratamento há mais de 4 h alerta (só códigos no alerta)', async () => {
    const agora = new Date('2026-10-22T12:00:00Z');
    mortos.lista = [
      { id: '1', parceiro: 'lab-a', mortoEm: new Date('2026-10-22T07:00:00Z'), tratamento: null },
      { id: '2', parceiro: 'lab-a', mortoEm: new Date('2026-10-22T10:00:00Z'), tratamento: null },
      {
        id: '3',
        parceiro: 'lab-b',
        mortoEm: new Date('2026-10-22T06:00:00Z'),
        tratamento: 'reprocessar' as const,
      },
    ];
    const alertas: unknown[] = [];
    const acesso = {
      ler: <T>(_h: string, fn: (l: never) => Promise<T>) => fn({} as never),
      gravar: <T>(_h: string, fn: (e: never) => Promise<T>) => fn({} as never),
    };
    const n = await verificarAlertasMortos(acesso, 'pc', 240, agora, (a) => alertas.push(a));
    expect(n).toBe(1);
    expect(alertas).toEqual([{ estabelecimento: 'pc', envio: '1', parceiro: 'lab-a', minutos: 300 }]);
  });
});
