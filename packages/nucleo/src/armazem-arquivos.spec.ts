// Unidade da porta de arquivos (ADR 0004): caminho preso na raiz, chave pelo hash, gravação uma vez e somente leitura,
// recusa de exclusão antes da guarda legal. Disco numa pasta temporária; sem banco.
import { readFile, stat, writeFile, chmod, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  caminhoNaRaiz,
  chaveDoArquivo,
  espacoLivreBytes,
  gravarUmaVez,
  lerRaizArquivos,
  motivoRecusaExclusao,
  pastaDoBanco,
  sha256,
} from './armazem-arquivos.js';
import { type PastaArquivosTeste, criarPastaArquivosTeste } from './arquivos-teste.js';

describe('porta de arquivos: regras puras', () => {
  const h = sha256(Buffer.from('conteudo sintetico'));

  it('chave pelo hash, por origem, estabelecimento e mês; a da migração é a do conector', () => {
    const d = new Date('2026-03-09T12:00:00Z');
    expect(chaveDoArquivo('sistema', 7, d, h)).toBe(`sistema/7/2026/03/${h.slice(0, 2)}/${h}`);
    expect(chaveDoArquivo('integracao', null, d, h)).toBe(`integracao/0/2026/03/${h.slice(0, 2)}/${h}`);
    expect(chaveDoArquivo('migracao', 7, d, h)).toBe(`migracao/${h.slice(0, 2)}/${h}`);
    expect(() => chaveDoArquivo('sistema', 1, d, 'xyz')).toThrow();
  });

  it('o caminho nunca sai da raiz', () => {
    expect(caminhoNaRaiz('/srv/arq', 'cliente_a', 'sistema/1/2026/01/ab/abc')).toBe(
      '/srv/arq/cliente_a/sistema/1/2026/01/ab/abc',
    );
    for (const ruim of ['../x', 'a/../../x', '/etc/passwd', 'a//b', 'a/./b', '', 'a/b c', 'a\\b', '.oculto'])
      expect(() => caminhoNaRaiz('/srv/arq', 'cliente_a', ruim), ruim).toThrow(/caminho/);
    expect(() => caminhoNaRaiz('/srv/arq', '../x', 'a')).toThrow(/caminho/);
    expect(() => caminhoNaRaiz('relativa', 'cliente_a', 'a')).toThrow(/absoluto/);
  });

  it('a pasta do cliente é o nome do banco saneado', () => {
    expect(pastaDoBanco('cliente_x')).toBe('cliente_x');
    expect(pastaDoBanco('cli-x.y')).toBe('cli_x_y');
  });

  it('exclusão recusada antes da guarda legal e para o imutável sem prazo', () => {
    expect(motivoRecusaExclusao('2046-01-01', false, '2026-11-21')).toMatch(/guarda legal/);
    expect(motivoRecusaExclusao('2026-11-21', false, '2026-11-21')).toBeNull();
    expect(motivoRecusaExclusao(null, true, '2026-11-21')).toMatch(/imutável/);
    expect(motivoRecusaExclusao(null, false, '2026-11-21')).toBeNull();
  });

  it('ARQUIVOS_RAIZ: vazia é não configurada; relativa é recusada', () => {
    expect(lerRaizArquivos({})).toBeNull();
    expect(lerRaizArquivos({ ARQUIVOS_RAIZ: ' /srv/a ' })).toBe('/srv/a');
    expect(() => lerRaizArquivos({ ARQUIVOS_RAIZ: 'srv/a' })).toThrow(/absoluto/);
  });
});

describe('porta de arquivos: gravação uma vez no disco', () => {
  let pasta: PastaArquivosTeste;
  beforeAll(async () => {
    pasta = await criarPastaArquivosTeste();
  });
  afterAll(async () => {
    await pasta.apagar();
  });

  it('grava somente leitura, sem temporário sobrando, e não sobrescreve', async () => {
    const c = Buffer.from('laudo sintetico 1');
    const h = sha256(c);
    const destino = caminhoNaRaiz(pasta.raiz, 'cliente_t', chaveDoArquivo('sistema', 1, new Date(), h));
    expect(await gravarUmaVez(destino, c, h)).toBe('gravado');
    expect((await stat(destino)).mode & 0o777).toBe(0o444);
    expect(await readFile(destino)).toEqual(c);
    expect((await readdir(join(destino, '..'))).filter((n) => n.endsWith('.tmp'))).toEqual([]);
    // O mesmo conteúdo: nada a fazer.
    expect(await gravarUmaVez(destino, c, h)).toBe('existente');
    // Outro conteúdo no mesmo caminho: recusa, e o original fica.
    await expect(gravarUmaVez(destino, Buffer.from('outro'), h)).rejects.toThrow(/arquivo-divergente/);
    expect(await readFile(destino)).toEqual(c);
  });

  it('arquivo adulterado no disco é divergente na regravação', async () => {
    const c = Buffer.from('laudo sintetico 2');
    const h = sha256(c);
    const destino = caminhoNaRaiz(pasta.raiz, 'cliente_t', chaveDoArquivo('sistema', 1, new Date(), h));
    await gravarUmaVez(destino, c, h);
    await chmod(destino, 0o644);
    await writeFile(destino, 'adulterado');
    await expect(gravarUmaVez(destino, c, h)).rejects.toThrow(/arquivo-divergente/);
  });

  it('mede o espaço livre da raiz', () => {
    expect(espacoLivreBytes(pasta.raiz)).toBeGreaterThan(0);
  });
});
