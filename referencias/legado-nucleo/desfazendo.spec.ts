// Gravação SEMPRE desfeita, só na cópia (M03, captura de assinatura): AMBIENTE=dev ou ci explícito, host em
// loopback, nunca porta de outro projeto; a transação é de escrita e termina em ROLLBACK.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ambienteFicticio, criarDubleDriver } from './duble-driver.spec-util.js';
import { NucleoLegado } from './legado.js';

const pasta = mkdtempSync(join(tmpdir(), 'sgh-desfazendo-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

function nucleo(extra: Record<string, string>) {
  const driver = criarDubleDriver(() => [{ C: 1 }]);
  const n = new NucleoLegado({ env: ambienteFicticio(['pc', 'zz'], extra), driver, pastaHomologada: pasta });
  return { n, driver };
}
const ctx = (hospital: string) => ({ rede: 'rede-teste', hospital, traceId: 't' });

describe('desfazendoNaCopia', () => {
  it('abre transação de escrita, executa e desfaz', async () => {
    const { n, driver } = nucleo({});
    const r = await n.desfazendoNaCopia(ctx('pc'), async (e) => {
      expect(await e.executar('INSERT INTO TABELA_SINT (A) VALUES (?)', [1])).toBe(1);
      return e.consultar('SELECT 1 C FROM RDB$DATABASE');
    });
    expect(r).toEqual([{ C: 1 }]);
    expect(driver.modos.at(-1)).toEqual({ tipo: 'escrita', lockTimeoutSegundos: 5, instantaneo: true });
    await n.encerrar();
  });

  it('recusa fora de dev/ci, fora do loopback ou em porta de outro projeto', async () => {
    const homolog = nucleo({ AMBIENTE: 'homolog' }).n;
    await expect(homolog.desfazendoNaCopia(ctx('pc'), async () => 1)).rejects.toThrow(/AMBIENTE=dev ou ci/);
    const ci = nucleo({ AMBIENTE: 'ci' }).n;
    await expect(ci.desfazendoNaCopia(ctx('pc'), async () => 1)).resolves.toBe(1);
    const remoto = nucleo({ FB_ZZ_HOST: 'banco.exemplo.invalid' }).n;
    await expect(remoto.desfazendoNaCopia(ctx('zz'), async () => 1)).rejects.toThrow(/loopback/);
    const alheia = nucleo({ FB_ZZ_PORTA: '3050' }).n;
    await expect(alheia.desfazendoNaCopia(ctx('zz'), async () => 1)).rejects.toThrow(/loopback/);
    await expect(alheia.desfazendoNaCopia(ctx('xx'), async () => 1)).rejects.toThrow(/loopback/);
    for (const x of [homolog, ci, remoto, alheia]) await x.encerrar();
  });
});
