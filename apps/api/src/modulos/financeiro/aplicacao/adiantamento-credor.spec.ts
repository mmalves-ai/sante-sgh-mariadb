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

  it('quem só tem as permissões do adiantamento acha o credor e pede (sem a leitura do título a pagar)', async () => {
    const so = await a.entrar('SINT.FIN.ADIANTA');
    // A pessoa não lê os títulos a pagar...
    expect((await a.get(so, '/financeiro/pagar/titulos')).statusCode).toBe(403);
    // ...mas escolhe o credor do adiantamento, do fornecedor e do médico, e pede.
    const f = await a.get(so, '/financeiro/pagar/credores?tipo=fornecedor&termo=sintetico%20a');
    expect([f.statusCode, f.json().map((c: { id: number }) => c.id)]).toEqual([200, [5001]]);
    const p = await a.get(so, '/financeiro/pagar/credores?tipo=profissional&termo=medico');
    expect([p.statusCode, p.json().map((c: { id: number }) => c.id)]).toEqual([200, [7001]]);
    const r = await a.post(so, '/financeiro/pagar/adiantamentos', {
      tipoCredor: 'fornecedor',
      credor: 5001,
      conta: 1,
      valor: 50,
      data: hoje,
      prazo: null,
      referente: 'SINTETICO SO ADIANTAMENTO',
    });
    expect(r.statusCode).toBe(200);
    // Quem não tem nenhuma das permissões da busca segue sem ela.
    const tesouraria = await a.entrar('SINT.FIN.TESFIS');
    expect(
      (await a.get(tesouraria, '/financeiro/pagar/credores?tipo=fornecedor&termo=sintetico')).statusCode,
    ).toBe(403);
  });

  it('título de médico: o código que a busca devolve vale como credor e como profissional', async () => {
    const [m] = await buscar('profissional', 'medico');
    const r = await a.post(lanca, '/financeiro/pagar/titulos', {
      tipo: 'M',
      credor: m?.id,
      profissional: m?.id,
      documento: 672_069,
      serie: '',
      emissao: hoje,
      valorDocumento: 100,
      referente: 'SINTETICO TITULO MEDICO PELA BUSCA',
      observacao: '',
      parcelas: [{ parcela: 1, vencimento: hoje, valor: 100 }],
      classificacao: { grupo: 216, subgrupo: 2, item: 1 },
      retencoes: [],
      centroCusto: null,
    });
    expect(r.statusCode).toBe(200);
  });
});
