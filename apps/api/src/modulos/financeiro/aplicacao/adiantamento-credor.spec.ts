// F3.8, 07-FIN linha 67, pela HTTP na sessão sintética (porta em memória, a mesma do E2E @F3.8-04): o credor do
// adiantamento é achado pelo nome ou pelo código, dentro do tipo escolhido (fornecedor ou profissional), e a lista dos
// adiantamentos traz o nome do credor ao lado do código.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type AppFinanceiro, appFinanceiro, type Sessao } from './comum.spec-util.js';

let a: AppFinanceiro;
let lanca: Sessao;
let hoje = '';
beforeAll(async () => {
  a = await appFinanceiro();
  lanca = await a.entrar('SINT.FIN.LANCA');
  hoje = (await a.get(lanca, '/financeiro/apoio')).json().hoje;
});
afterAll(async () => {
  await a.app.close();
});

const buscar = async (tipo: string, termo: string): Promise<{ id: number; nome: string }[]> =>
  (await a.get(lanca, `/financeiro/pagar/credores?tipo=${tipo}&termo=${encodeURIComponent(termo)}`)).json();

describe('credor do adiantamento pela busca e com o nome na lista (memória)', () => {
  it('acha pelo nome (parte, sem diferenciar maiúsculas) e pelo código, só dentro do tipo; termo curto não busca', async () => {
    expect((await buscar('fornecedor', 'sintetico a')).map((c) => [c.id, c.nome])).toEqual([
      [5001, 'FORNECEDOR SINTETICO A'],
    ]);
    expect((await buscar('fornecedor', '5002')).map((c) => c.id)).toEqual([5002]);
    expect((await buscar('fornecedor', 'SINTETICO')).map((c) => c.id)).toEqual([5001, 5002]);
    // O médico só aparece no tipo profissional, e o fornecedor só no tipo fornecedor (o credor é o par tipo e código).
    expect((await buscar('profissional', 'medico')).map((c) => [c.id, c.nome])).toEqual([
      [7001, 'MEDICO SINTETICO'],
    ]);
    expect(await buscar('fornecedor', 'MEDICO')).toEqual([]);
    expect(await buscar('profissional', 'FORNECEDOR')).toEqual([]);
    expect(await buscar('fornecedor', 'S')).toEqual([]);
  });

  it('a lista dos adiantamentos traz o nome do credor do fornecedor e do médico', async () => {
    const pedir = async (tipoCredor: string, credor: number, referente: string) => {
      const r = await a.post(lanca, '/financeiro/pagar/adiantamentos', {
        tipoCredor,
        credor,
        conta: 1,
        valor: 100,
        data: hoje,
        prazo: null,
        referente,
      });
      expect(r.statusCode).toBe(200);
      return r.json().ids.adiantamento as number;
    };
    const f = await pedir('fornecedor', 5001, 'SINTETICO CREDOR FORNECEDOR');
    const p = await pedir('profissional', 7001, 'SINTETICO CREDOR MEDICO');
    const lista: { id: number; credor: number; credorNome: string }[] = (
      await a.get(lanca, '/financeiro/pagar/adiantamentos')
    ).json();
    expect(lista.find((x) => x.id === f)).toMatchObject({
      credor: 5001,
      credorNome: 'FORNECEDOR SINTETICO A',
    });
    expect(lista.find((x) => x.id === p)).toMatchObject({ credor: 7001, credorNome: 'MEDICO SINTETICO' });
  });
});
