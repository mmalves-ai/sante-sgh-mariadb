// M53.9 (memória do E2E): a integração lê o retorno que a interface com a folha externa (F0) gravou em memória, somado
// por rubrica, centro e vencimento como `retornoParaTitulosPesSgh` faz na cópia, e marca o lote como lançado.
import { describe, expect, it } from 'vitest';
import { PortaFolhaMemoria } from './porta-folha-memoria.js';
import { PortaIntegracaoFolhaMemoria } from './porta-integracao-memoria.js';

const c = { cliente: 'pc', estabelecimento: 1, usuario: null, correlacao: 'teste-folha' };

async function comRetorno(): Promise<{ folha: PortaFolhaMemoria; id: number }> {
  const folha = new PortaFolhaMemoria();
  const id = await folha.gravarSgh(c, {} as never, async (g) => {
    const n = await g.proximoIdLote();
    await g.incluirLote({
      id: n,
      empresa: 1,
      competencia: '2099-08',
      sentido: 'recebido',
      loteExportado: null,
      leiaute: '1',
      situacao: 'conferido',
      colaboradores: 2,
      soma: 0,
      por: 'SINT.DP.FOLHA',
      geradoEm: '2099-09-01T10:00:00',
      divergencias: [],
      resumo: null,
      vinculos: [],
    } as never);
    await g.incluirResumo({
      interface: n,
      linhas: [
        { vinculo: 1, centroCusto: 10, rubrica: 'proventos', valor: 300_000, vencimento: null },
        { vinculo: 2, centroCusto: 10, rubrica: 'proventos', valor: 200_000, vencimento: null },
        { vinculo: 1, centroCusto: 10, rubrica: 'descontos', valor: 40_000, vencimento: null },
        { vinculo: 1, centroCusto: 10, rubrica: 'liquido', valor: 260_000, vencimento: '2099-09-05' },
        { vinculo: 2, centroCusto: 10, rubrica: 'liquido', valor: 200_000, vencimento: '2099-09-03' },
        { vinculo: null, centroCusto: null, rubrica: 'inss', valor: 100_000, vencimento: '2099-09-20' },
        { vinculo: null, centroCusto: null, rubrica: 'fgts', valor: 40_000, vencimento: '2099-09-07' },
      ],
    } as never);
    return n;
  });
  return { folha, id };
}

describe('integração da folha em memória sobre o retorno da F0', () => {
  it('soma o líquido (vencimento mais cedo), os encargos e os proventos por centro; desconto fica fora', async () => {
    const { folha, id } = await comRetorno();
    const r = folha.retornoParaTitulos('1', id)!;
    expect(r).toMatchObject({ id, empresa: 1, competencia: '2099-08', situacao: 'conferido' });
    expect(r.liquido).toBe(460_000);
    expect(r.vencimentoLiquido).toBe('2099-09-03');
    expect(r.encargos).toEqual([
      { tipo: 'inss', valor: 100_000, vencimento: '2099-09-20' },
      { tipo: 'fgts', valor: 40_000, vencimento: '2099-09-07' },
    ]);
    expect(r.proventos).toEqual([{ centroCusto: 10, proventos: 500_000 }]);
    expect(folha.retornoParaTitulos('1', id + 1)).toBeNull();
  });

  it('a integração lê o retorno da folha em memória; sem a folha, só o semeado', async () => {
    const { folha, id } = await comRetorno();
    const comFolha = new PortaIntegracaoFolhaMemoria(folha);
    expect((await comFolha.retorno(c, id))?.liquido).toBe(460_000);
    expect(await new PortaIntegracaoFolhaMemoria().retorno(c, id)).toBeNull();
    folha.marcarLancado('1', id);
    expect((await comFolha.retorno(c, id))?.situacao).toBe('lancado');
  });
});
