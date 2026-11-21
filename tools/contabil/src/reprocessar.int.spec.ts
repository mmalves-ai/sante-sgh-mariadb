// Integração do `contabil:reprocessar` no MariaDB real (cliente de teste f22_o5), pela porta da tela, com a empresa
// contábil = o estabelecimento (o único caminho em que a porta consulta o banco):
//   - estabelecimento inexistente no cliente: recusa com 64, sem ler o período (nada de falso "idêntico");
//   - estabelecimento existente: a porta lê os fatos, o plano e o de-para no SQL e, HOJE, recusa a leitura das regras
//     publicadas com "modelo-pendente" (falta o modelo das versões de regra no banco do cliente): a ferramenta sai com
//     69 e a mensagem da operação. Quando a porta passar a ler as regras, este caso falha de propósito: troque-o por
//     uma massa mínima (fato, plano, regra publicada) e confira contagens diferentes de zero e IDÊNTICO.
// Massa: nenhuma gravação (só leitura).
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contextoDe, fonteDoBanco, reprocessar, SAIDA } from './reprocessar.ts';

const CLIENTE = 'f22_o5';
const raiz = resolve(import.meta.dirname, '../../..');
let nucleo: NucleoProprio;
let estabelecimento = 0;
let inexistente = 0;

beforeAll(async () => {
  const lista = execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', '--listar'], { cwd: raiz, encoding: 'utf8' });
  if (!lista.split(/\s+/).includes(CLIENTE)) {
    execFileSync('python3', ['-I', 'tools/db/criar_cliente.py', CLIENTE, 'Teste F2.2 onda 5'], { cwd: raiz });
  }
  nucleo = new NucleoProprio();
  const linha = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'f22-05-09' }, (l) =>
    l.uma('SELECT MIN(id) AS id, MAX(id) AS maior FROM estabelecimento WHERE excluido_em IS NULL', []),
  );
  const r = linha as { id?: unknown; maior?: unknown } | null;
  estabelecimento = Number(r?.id ?? 0);
  inexistente = Number(r?.maior ?? 0) + 1000;
}, 120_000);

afterAll(async () => {
  await nucleo?.encerrar();
});

describe('contabil:reprocessar no banco próprio', () => {
  it('estabelecimento inexistente no cliente: recusa com 64, nunca IDÊNTICO', async () => {
    expect(estabelecimento).toBeGreaterThan(0);
    const fonte = await fonteDoBanco(nucleo);
    const r = await reprocessar(nucleo, fonte, { cliente: CLIENTE, estabelecimento: inexistente, periodo: '2026-10' });
    expect(r.saida).toBe(SAIDA.uso);
    expect(r.texto).not.toContain('IDÊNTICO');
  });

  it('estabelecimento existente: a porta consulta o banco (fatos, plano, de-para) e as regras dão "modelo-pendente" (69)', async () => {
    const fonte = await fonteDoBanco(nucleo);
    const c = contextoDe({ cliente: CLIENTE, estabelecimento });
    // As leituras com SQL respondem (a empresa é o estabelecimento: não é o ramo vazio da porta).
    await expect(fonte.fatosDaCompetencia(c, estabelecimento, '2026-10', 10)).resolves.toEqual([]);
    await expect(fonte.plano(c, estabelecimento)).resolves.toBeInstanceOf(Array);
    await expect(fonte.dePara(c, estabelecimento)).resolves.toBeInstanceOf(Array);
    const r = await reprocessar(nucleo, fonte, { cliente: CLIENTE, estabelecimento, periodo: '2026-10' });
    expect(r.saida).toBe(SAIDA.indisponivel);
    expect(r.texto).toMatch(/indisponível/);
    expect(r.texto).not.toContain('IDÊNTICO');
  });
});
