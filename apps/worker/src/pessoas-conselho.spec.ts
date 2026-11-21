// M52.1 (regra 3; ficha, seção 4; lote F2.2 05-16): o retrato diário da validade do conselho no worker. A contagem (só
// os registros ativos; vencidos, a vencer na janela e sem validade), a janela do parâmetro, o retrato não gravado sem a
// tabela (nunca finge gravar) e a chave do serviço. Porta falsa; dados sintéticos.
import { afterEach, describe, expect, it } from 'vitest';
import { diaCivil } from './clientes-worker.js';
import { type PortaConselho, type RetratoConselho, tabelaAusente } from './pessoas-conselho-propria.js';
import {
  contarAlertas,
  type NucleoConselho,
  PessoasConselhoService,
  retratoConselhoLigado,
  retratoDoCliente,
} from './pessoas-conselho.service.js';

const HOJE = '2026-10-25';
const AGORA = new Date('2026-10-25T13:00:00Z');

function portaFalsa(janela: number | null, grava: boolean) {
  const gravados: RetratoConselho[] = [];
  const porta: PortaConselho = {
    registrosAtivos: async () => [
      { registro: 11, profissional: 7, ativo: true, validade: '2026-12-09' },
      { registro: 12, profissional: 7, ativo: true, validade: null },
      { registro: 13, profissional: 8, ativo: false, validade: '2020-01-01' },
    ],
    janelaDias: async () => janela,
    gravarRetrato: async (r) => {
      gravados.push(r);
      return grava;
    },
  };
  return { porta, gravados };
}

describe('retrato do conselho (M52.1)', () => {
  it('conta vencidos, a vencer e sem validade; o registro inativo fica de fora', () => {
    const r = contarAlertas(
      [
        { registro: 1, profissional: 1, ativo: true, validade: '2026-10-24' },
        { registro: 2, profissional: 1, ativo: true, validade: '2026-12-20' },
        { registro: 3, profissional: 2, ativo: null, validade: null },
        { registro: 4, profissional: 2, ativo: true, validade: '2027-06-30' },
        { registro: 5, profissional: 3, ativo: false, validade: '2020-01-01' },
      ],
      HOJE,
      60,
    );
    expect(r).toEqual({ registros: 4, vencidos: 1, aVencer: 1, semValidade: 1 });
  });

  it('a chave: fora de dev/ci ligado; em dev/ci só pedido', () => {
    expect(retratoConselhoLigado({ AMBIENTE: 'producao' })).toBe(true);
    expect(retratoConselhoLigado({ AMBIENTE: 'producao', PESSOAS_CONSELHO_DIARIO: 'desligado' })).toBe(false);
    expect(retratoConselhoLigado({ AMBIENTE: 'dev' })).toBe(false);
    expect(retratoConselhoLigado({ AMBIENTE: 'ci', PESSOAS_CONSELHO_DIARIO: 'ligado' })).toBe(true);
  });

  it('aplica a janela do parâmetro (30: 45 dias fica fora; padrão 60: dentro) e grava só as contagens', async () => {
    const a = portaFalsa(30, true);
    const r = await retratoDoCliente(a.porta, 'f22_teste', AGORA);
    expect(r).toMatchObject({ cliente: 'f22_teste', dia: HOJE, janelaDias: 30, registros: 2, aVencer: 0, semValidade: 1 });
    expect(r.gravado).toBe(true);
    expect(Object.keys(a.gravados[0]!).sort()).toEqual(
      ['aVencer', 'cliente', 'dia', 'janelaDias', 'registros', 'semValidade', 'vencidos'].sort(),
    );
    const b = portaFalsa(null, false);
    const s = await retratoDoCliente(b.porta, 'f22_teste', AGORA);
    expect(s).toMatchObject({ aVencer: 1, gravado: false });
    expect(s.janelaDias).toBeGreaterThan(30);
  });

  it('a tabela ausente é reconhecida pelo código, pelo número ou pela causa', () => {
    expect(tabelaAusente({ code: 'ER_NO_SUCH_TABLE' })).toBe(true);
    expect(tabelaAusente({ message: 'x', cause: { errno: 1146 } })).toBe(true);
    expect(tabelaAusente(new Error('outra falha'))).toBe(false);
    expect(diaCivil(new Date('2026-10-26T02:00:00Z'))).toBe('2026-10-25');
  });

  describe('o serviço', () => {
    const antes = process.env['WORKER_CLIENTES'];
    afterEach(() => {
      if (antes === undefined) delete process.env['WORKER_CLIENTES'];
      else process.env['WORKER_CLIENTES'] = antes;
    });
    it('roda por cliente; sem núcleo, nada', async () => {
      const s = new PessoasConselhoService();
      expect(await s.ciclo()).toEqual([]);
      process.env['WORKER_CLIENTES'] = 'f22_teste,Invalido';
      s.usar({ lerPlataforma: async () => [], encerrar: async () => undefined } as unknown as NucleoConselho, () =>
        portaFalsa(30, false).porta,
      );
      const r = await s.ciclo(AGORA);
      expect(r.map((x) => [x.cliente, x.gravado])).toEqual([['f22_teste', false]]);
      await s.onApplicationShutdown();
    });
  });
});
