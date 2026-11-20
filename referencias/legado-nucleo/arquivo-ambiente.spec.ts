import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  aplicarArquivoAmbiente,
  ambienteEfetivo,
  caminhoArquivoAmbiente,
  lerArquivoAmbiente,
} from './arquivo-ambiente.js';

// Pasta temporária dentro do repositório (POL-4: nada fora dele).
const pasta = mkdtempSync(resolve(import.meta.dirname, '../../../../.tmp/legado-amb-'));
afterAll(() => rmSync(pasta, { recursive: true, force: true }));

describe('arquivo de ambiente', () => {
  it('recusa o .env da raiz (é do legado)', () => {
    expect(() => lerArquivoAmbiente('/qualquer/.env')).toThrow(/legado/);
  });

  it('o processo tem precedência; o arquivo só preenche o que falta', () => {
    const arq = join(pasta, '.env.teste');
    writeFileSync(arq, 'A=arquivo\nB=arquivo\n');
    expect(ambienteEfetivo(arq, { A: 'processo' }).env).toMatchObject({ A: 'processo', B: 'arquivo' });
    const destino: Record<string, string | undefined> = { A: 'processo' };
    expect(aplicarArquivoAmbiente(arq, destino)).toBe(true);
    expect(destino).toEqual({ A: 'processo', B: 'arquivo' });
    expect(aplicarArquivoAmbiente(join(pasta, 'nao-existe'), destino)).toBe(false);
  });

  it('caminho padrão é .env.sante; SGH_ARQUIVO_AMBIENTE muda', () => {
    expect(caminhoArquivoAmbiente({}, '/r')).toBe('/r/.env.sante');
    expect(caminhoArquivoAmbiente({ SGH_ARQUIVO_AMBIENTE: 'outro' }, '/r')).toBe('/r/outro');
  });
});
