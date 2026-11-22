// ADR 0004: conferência da pasta de arquivos na instalação (permissão, dono e espaço livre).
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { conferirRaizArquivos } from './arquivos-raiz.ts';

const pasta = mkdtempSync(join(tmpdir(), 'sgh-arquivos-instalacao-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));
const motivos = (r: ReturnType<typeof conferirRaizArquivos>) => r.problemas.map((p) => p.motivo).join(' | ');

describe('conferência de ARQUIVOS_RAIZ', () => {
  it('aceita a pasta do serviço com espaço; alerta abaixo do limite', () => {
    chmodSync(pasta, 0o750);
    const uid = String(statSync(pasta).uid);
    expect(conferirRaizArquivos(pasta, { uid, medir: () => 50 * 1024 ** 3 })).toMatchObject({
      problemas: [],
      alertas: [],
    });
    const r = conferirRaizArquivos(pasta, { uid, alertaLivreGb: 100, medir: () => 50 * 1024 ** 3 });
    expect(r.problemas).toEqual([]);
    expect(r.alertas.join()).toMatch(/abaixo do limite de 100 GB/);
  });

  it('recusa relativa, ausente, arquivo, gravável por todos e dono diferente', () => {
    expect(motivos(conferirRaizArquivos('relativa'))).toMatch(/absoluto/);
    expect(motivos(conferirRaizArquivos(''))).toMatch(/absoluto/);
    expect(motivos(conferirRaizArquivos(join(pasta, 'nao-existe')))).toMatch(/não existe/);
    const arq = join(pasta, 'arquivo');
    writeFileSync(arq, 'x');
    expect(motivos(conferirRaizArquivos(arq, { medir: () => 1e12 }))).toMatch(/não é uma pasta/);
    chmodSync(pasta, 0o777);
    expect(motivos(conferirRaizArquivos(pasta, { medir: () => 1e12 }))).toMatch(/gravável por todos/);
    chmodSync(pasta, 0o750);
    expect(motivos(conferirRaizArquivos(pasta, { uid: '999999', medir: () => 1e12 }))).toMatch(/dono/);
  });
});
