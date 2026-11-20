// M42: o cache do acompanhamento da competência leva o escopo de contas bancárias da sessão (regra 15 do M32): o
// retrato montado para quem vê todas as contas nunca é servido a quem só vê a conta 1. Porta e serviço de teste (nada
// conecta a banco); o cache é o do M08 sobre o armazém em memória.
import { describe, expect, it } from 'vitest';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { CacheConfig } from '../config/public-api.js';
import { AcompanhamentoTiss } from './acompanhamento.js';
import type { FiltroAcompanhamentoPorta, LeituraAcompanhamento, PortaTiss } from './porta.js';
import type { ServicoTiss } from './servico.js';

const ESCOPO: Record<string, number[] | null> = { LIVRE: null, CONTA1: [1] };

function montar() {
  const leituras: FiltroAcompanhamentoPorta[] = [];
  const porta = {
    destino: 'legado',
    contasBancariasDoEscopo: async (_c: unknown, login: string | null) => ESCOPO[login ?? ''] ?? null,
    convenios: async () => [{ codigo: 91, nome: 'CONVENIO SINTETICO' }],
    painel: async () => {
      throw new Error('sem painel no teste');
    },
    acompanhamento: async (_c: unknown, f: FiltroAcompanhamentoPorta): Promise<LeituraAcompanhamento> => {
      leituras.push(f);
      const movimento = [
        { conta: 1, tipo: 'I', lancamentos: 7, valor: 70 },
        { conta: 2, tipo: 'O', lancamentos: 11, valor: 110 },
      ]
        .filter((m) => f.contasBancarias === null || f.contasBancarias.includes(m.conta))
        .map(({ tipo, lancamentos, valor }) => ({ tipo, lancamentos, valor }));
      return {
        contas: [],
        lotes: { lotes: 0, comProtocolo: 0, contasEmLote: 0, conveniosFechados: 0, conveniosComConta: 0 },
        titulos: {
          aPagar: { titulos: 0, valor: 0, pagos: 0, valorPago: 0 },
          aReceber: { titulos: 0, valor: 0, recebidos: 0, valorRecebido: 0 },
          movimento,
        },
        repasse: null,
        gravacoes: [],
        uso: null,
      };
    },
  } as unknown as PortaTiss;
  const servico = {
    apoios: { cache: new CacheConfig(new ArmazemMemoria()) },
    parametro: async (_s: unknown, _k: string, padrao: number) => padrao,
    convenios: () => null,
    exigirEscopoConvenio: () => undefined,
  } as unknown as ServicoTiss;
  const sessao = (login: string) =>
    ({
      rede: 'r',
      hospital: 'pc',
      login,
      porta: { rede: 'r', hospital: 'pc' },
      pode: (p: string) => p.startsWith('financeiro.') || p.startsWith('relatorio.'),
    }) as unknown as SessaoCadastro;
  return { a: new AcompanhamentoTiss(porta, servico), leituras, sessao };
}

describe('acompanhamento da competência: cache e escopo de contas bancárias', () => {
  it('o retrato de quem vê todas as contas não é servido do cache a quem só vê a conta 1', async () => {
    const { a, leituras, sessao } = montar();
    const livre = await a.painel(sessao('LIVRE'), { competencia: '2026-04' });
    expect(livre.titulos.disponivel && livre.titulos.movimento?.map((m) => m.tipo)).toEqual(['I', 'O']);
    expect(livre.emCache).toBe(false);
    const deNovo = await a.painel(sessao('LIVRE'), { competencia: '2026-04' });
    expect(deNovo.emCache).toBe(true);
    const restrito = await a.painel(sessao('CONTA1'), { competencia: '2026-04' });
    expect(restrito.emCache).toBe(false);
    expect(restrito.titulos.disponivel && restrito.titulos.movimento?.map((m) => m.tipo)).toEqual(['I']);
    expect(leituras.map((f) => f.contasBancarias)).toEqual([null, [1]]);
  });
});
