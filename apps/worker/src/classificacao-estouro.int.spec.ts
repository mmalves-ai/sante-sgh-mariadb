// M44, regra 4, sobre a cópia (ficha, seção 10: `worker` de estouro com relógio injetado e sem aviso duplicado com dois
// consumidores): a leitura do ciclo (atendimentos abertos do PA e as classificações, transação curta READ ONLY) com o
// relógio injetado e o tempo medido; dois consumidores gravando o MESMO aviso ao mesmo tempo, cada um na sua
// transação: enquanto o primeiro segura a linha, o segundo desiste sem erro (a chave única); depois do ROLLBACK, nada
// fica. Só contagens.
import { resolve } from 'node:path';
import {
  ambienteEfetivo,
  avisosJaGravados,
  caminhoArquivoAmbiente,
  lerCodigos,
  lerConfiguracaoNucleo,
  NucleoLegado,
  registrarAvisoEstouro,
  somenteSgh,
  travaDaCopiaSegura,
} from '@sgh/legado';
import { criarDriverNativo } from '@sgh/legado/nativo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { estourosPendentes } from './classificacao-estouro.service.js';

const raiz = resolve(import.meta.dirname, '../../..');
const { env } = ambienteEfetivo(caminhoArquivoAmbiente(process.env, raiz));
const codigos = lerCodigos(env);
const PODE_ESCREVER = codigos.length > 0 && travaDaCopiaSegura(process.pid);

describe.skipIf(!PODE_ESCREVER)('aviso de estouro na cópia (transações desfeitas)', () => {
  let nucleo: NucleoLegado;
  const cod = codigos[0] as string;
  beforeAll(async () => {
    nucleo = new NucleoLegado({
      env: { ...env, FB_POOL_TETO: '4', FB_LOCK_TIMEOUT_S: '2' },
      driver: criarDriverNativo({ biblioteca: lerConfiguracaoNucleo(env).bibliotecaCliente }),
      pastaHomologada: resolve(raiz, 'tools/schema-check/homologado'),
    });
    await nucleo.verificarSchema(cod);
  });
  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('a leitura do ciclo com o relógio injetado responde dentro da meta', async () => {
    const t0 = performance.now();
    const r = await estourosPendentes(nucleo, cod, '2026-07-05T12:00:00');
    const ms = Math.round(performance.now() - t0);
    console.log(
      `[${cod}] estouro: chave ${r.ligada ? 'ligada' : 'desligada'}; pendentes ${r.pendentes.length}; ${ms} ms`,
    );
    expect(r.agora).toBe('2026-07-05T12:00:00');
    expect(ms).toBeLessThan(5_000);
  });

  it('dois consumidores, o mesmo aviso: um grava, o outro desiste; nada fica depois do ROLLBACK', async () => {
    const aviso = {
      hospital: cod,
      chave: `pa.classificacao.estouro:${cod}:999999999`,
      classificacao: 999_999_999,
      reg: 1,
      prazoEm: '2026-10-24T10:00:00.000Z',
    };
    const ctx = { rede: nucleo.rede, hospital: cod, traceId: 'int-m44-estouro' };
    let liberar!: () => void;
    const segura = new Promise<void>((ok) => (liberar = ok));
    let primeiro!: (v: boolean) => void;
    const gravou = new Promise<boolean>((ok) => (primeiro = ok));
    const p1 = nucleo.desfazendoNaCopia(ctx, async (e) => {
      const r = await registrarAvisoEstouro(somenteSgh(e), aviso);
      primeiro(r);
      await segura;
      return r;
    });
    const r1 = await gravou;
    const r2 = await nucleo.desfazendoNaCopia(ctx, (e) => registrarAvisoEstouro(somenteSgh(e), aviso));
    liberar();
    await p1;
    console.log(`[${cod}] dois consumidores: primeiro ${r1}, segundo ${r2}`);
    expect([r1, r2]).toEqual([true, false]);
    const depois = await nucleo.lerSomente(ctx, (l) => avisosJaGravados(l, [aviso.chave]));
    expect(depois.size).toBe(0);
  });
});
