// Cofre dos segredos dos provedores (ICP-06): o valor vai cifrado (AES-256-GCM) para um arquivo por referência, com o
// nome do arquivo sendo o resumo da referência (nada do provedor no disco); sem chave ou com o diretório dentro do
// repositório, o cofre fica indisponível (falha fechada); referência fora do formato é recusada.
import { randomBytes } from 'node:crypto';
import { readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  CofreArquivo,
  CofreMemoria,
  cofreDoAmbiente,
  cofreIndisponivel,
  raizDoRepositorio,
} from './cofre.js';

// Diretório de teste dentro de node_modules/.cache do worktree (ignorado pelo git; nada fora do worktree).
const raiz = raizDoRepositorio(process.cwd());
const dir = join(raiz, 'node_modules', '.cache', `sgh-cofre-teste-${randomBytes(4).toString('hex')}`);
const REF = 'cofre:psc/pc/psc-sintetico/client-secret';

afterAll(() => rm(dir, { recursive: true, force: true }));

describe('cofre de arquivo', () => {
  it('grava cifrado, relê, diz se existe; o arquivo não tem o valor nem o nome do provedor', async () => {
    const chave = randomBytes(32);
    const c = new CofreArquivo(dir, chave);
    expect(await c.existe(REF)).toBe(false);
    await c.gravar(REF, 'segredo-sintetico-1');
    expect(await c.existe(REF)).toBe(true);
    expect(await c.ler(REF)).toBe('segredo-sintetico-1');
    const arquivos = await readdir(dir);
    expect(arquivos).toHaveLength(1);
    expect(arquivos[0]).not.toContain('psc-sintetico');
    expect(await readFile(join(dir, arquivos[0]!), 'utf8')).not.toContain('segredo-sintetico-1');
    // Outra chave não abre.
    expect(await new CofreArquivo(dir, randomBytes(32)).ler(REF)).toBeNull();
    // Cifra curta (o verificador do PKCE) só volta com a mesma chave; envelope adulterado não abre.
    const env = c.cifrar('verificador')!;
    expect(c.decifrar(env)).toBe('verificador');
    expect(c.decifrar(`${env.slice(0, -2)}xx`)).toBeNull();
    expect(c.decifrar('v0.a.b.c')).toBeNull();
    await expect(c.gravar('cofre:outra/coisa', 'x')).rejects.toThrow();
    expect(() => new CofreArquivo(dir, randomBytes(16))).toThrow();
  });

  it('falha fechada: sem chave, sem diretório, diretório relativo ou dentro do repositório', async () => {
    const chave = randomBytes(32);
    expect(cofreDoAmbiente({ COFRE_DIR: '/var/lib/sgh-cofre' }, null, raiz)).toBe(cofreIndisponivel);
    expect(cofreDoAmbiente({}, chave, raiz)).toBe(cofreIndisponivel);
    expect(cofreDoAmbiente({ COFRE_DIR: 'relativo' }, chave, raiz)).toBe(cofreIndisponivel);
    expect(cofreDoAmbiente({ COFRE_DIR: dir }, chave, raiz)).toBe(cofreIndisponivel);
    expect(cofreDoAmbiente({ COFRE_DIR: '/var/lib/sgh-cofre' }, chave, raiz).disponivel).toBe(true);
    expect(cofreIndisponivel.cifrar('x')).toBeNull();
    await expect(cofreIndisponivel.gravar(REF, 'x')).rejects.toThrow();
  });

  it('cofre em memória (sessão sintética)', async () => {
    const m = new CofreMemoria();
    await m.gravar(REF, 'v');
    expect(await m.ler(REF)).toBe('v');
    expect(m.decifrar(m.cifrar('p'))).toBe('p');
  });
});
