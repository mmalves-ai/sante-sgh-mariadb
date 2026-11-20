import { chmodSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { compararEnv, medirEnv } from './env-raiz.ts';

const registro = { permissao: '600', tamanho: 10, mtime: 1_700_000_000 };
const pastas: string[] = [];

function arquivoFalso(): string {
  const pasta = mkdtempSync(join(tmpdir(), 'sgh-env-raiz-'));
  pastas.push(pasta);
  const caminho = join(pasta, 'env-falso');
  writeFileSync(caminho, 'X'.repeat(10));
  chmodSync(caminho, 0o600);
  utimesSync(caminho, registro.mtime, registro.mtime);
  return caminho;
}

afterEach(() => {
  for (const p of pastas.splice(0)) rmSync(p, { recursive: true, force: true });
});

describe('.env da raiz intocado (regra 1)', () => {
  it('passa quando permissão, tamanho e data batem com o registro', () => {
    expect(compararEnv(registro, medirEnv(arquivoFalso()))).toEqual([]);
  });

  it('falha com permissão diferente do registro', () => {
    const caminho = arquivoFalso();
    chmodSync(caminho, 0o644);
    expect(compararEnv(registro, medirEnv(caminho))).toEqual(['permissão 644, registrada 600']);
  });

  it('falha com data diferente do registro', () => {
    const caminho = arquivoFalso();
    utimesSync(caminho, registro.mtime + 60, registro.mtime + 60);
    expect(compararEnv(registro, medirEnv(caminho))).toEqual([
      `data ${registro.mtime + 60}, registrada ${registro.mtime}`,
    ]);
  });

  it('falha se o arquivo sumir', () => {
    expect(compararEnv(registro, medirEnv('/caminho/que/nao/existe/.env'))).toHaveLength(1);
  });
});
