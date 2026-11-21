// Vigia do índice de busca (M11; lote F2.2 05-15): a chave de ambiente; a regra pura do escore; o ciclo lê os mudados
// depois da marca, indexa, avança a marca e manda os pacientes à fila; a conferência por contagem roda no intervalo e
// repara a entidade divergente. A porta própria é um dublê; dados sintéticos.
import type { CadastroComparavel } from '@sgh/dominio-cadastro';
import { describe, expect, it } from 'vitest';
import type { CadastroLido, MarcaIndice, PortaIndiceBusca } from './indice-busca-propria.js';
import { palavrasDoIndice } from './indice-busca-propria.js';
import { avaliarPar, IndiceBuscaService, vigiaLigado } from './indice-busca.service.js';

const paciente = (id: number, extra: Partial<CadastroComparavel> = {}): CadastroComparavel =>
  ({
    id,
    nome: 'ANA MARIA SINTETICA',
    nascimento: '1980-01-01',
    mae: 'JOANA SINTETICA',
    cpf: null,
    telefones: [],
    ...extra,
  }) as CadastroComparavel;

const lido = (id: number, mudouEm: string, excluido = false): CadastroLido => ({
  id,
  nome: 'ANA SINTETICA',
  social: null,
  mae: null,
  excluido,
  mudouEm,
});

describe('vigia do índice de busca (M11)', () => {
  it('fora de dev/ci liga por padrão; em dev/ci só com BUSCA_VIGIA=ligado; desligado sempre vale', () => {
    expect(vigiaLigado({ AMBIENTE: 'producao' })).toBe(true);
    expect(vigiaLigado({ AMBIENTE: 'homolog', BUSCA_VIGIA: 'desligado' })).toBe(false);
    expect(vigiaLigado({ AMBIENTE: 'dev' })).toBe(false);
    expect(vigiaLigado({ AMBIENTE: 'ci', BUSCA_VIGIA: 'ligado' })).toBe(true);
  });

  it('a regra pura do escore decide o par (nome + nascimento + mãe entra; só o nome não)', () => {
    expect(avaliarPar(paciente(1), paciente(2))).toMatchObject({ criterios: expect.arrayContaining(['fonetica']) });
    expect(avaliarPar(paciente(1), paciente(2, { nascimento: '1999-09-09', mae: 'OUTRA PESSOA' }))).toBeNull();
  });

  it('as palavras do índice: sem repetir, com a fonética; o excluído não tem palavras', () => {
    const p = palavrasDoIndice({ ...lido(1, '2026-01-01T00:00:00.000Z'), nome: 'ANA ANA SILVA', mae: 'JOANA' });
    expect(p.map((x) => `${x.campo}:${x.palavra}`)).toEqual(['nome:ANA', 'nome:SILVA', 'mae:JOANA']);
    expect(p.every((x) => x.fonetica.length > 0)).toBe(true);
    expect(palavrasDoIndice(lido(1, '2026-01-01T00:00:00.000Z', true))).toEqual([]);
  });

  it('indexa os mudados, avança a marca, manda os pacientes à fila e confere no intervalo', async () => {
    const chamadas: string[] = [];
    const marcas: (MarcaIndice | null)[] = [];
    const porta: PortaIndiceBusca = {
      marcaInicial: async () => null,
      mudados: async (entidade, desde) => {
        marcas.push(desde);
        if (entidade !== 'paciente' || desde.id > 0) return [];
        return [lido(7, '2026-11-01T10:00:00.000Z'), lido(8, '2026-11-01T10:00:00.000Z'), lido(9, '2026-11-01T10:00:01.000Z', true)];
      },
      lerCadastros: async () => [],
      indexar: async (_e, cs) => {
        if (cs.length > 0) chamadas.push(`indexa:${cs.map((c) => c.id).join(',')}`);
        return cs.length * 2;
      },
      contagem: async (entidade) => ({ indice: 1, cadastro: entidade === 'paciente' ? 2 : 1 }),
      reparar: async (entidade) => {
        chamadas.push(`repara:${entidade}`);
        return 1;
      },
      alimentarFila: async (ids) => {
        chamadas.push(`fila:${ids.join(',')}`);
        return 1;
      },
    };
    const antes = process.env['WORKER_CLIENTES'];
    process.env['WORKER_CLIENTES'] = 'cli_teste';
    try {
      const s = new IndiceBuscaService();
      expect(await s.ciclo()).toEqual([]);
      s.usar({ lerPlataforma: async () => [] as never, encerrar: async () => undefined }, () => porta, 60_000);
      const r1 = await s.ciclo();
      expect(r1.find((x) => x.entidade === 'paciente')).toEqual({
        cliente: 'cli_teste',
        entidade: 'paciente',
        lidos: 3,
        palavras: 6,
        marca: '2026-11-01T10:00:01.000Z',
      });
      await s.ciclo();
      // A segunda volta do paciente parte da marca da última mudança lida (instante e id).
      expect(marcas.filter((m) => m?.id === 9)).toHaveLength(1);
      expect(chamadas.filter((c) => c.startsWith('fila:'))).toEqual(['fila:7,8']);
      expect(chamadas.filter((c) => c.startsWith('repara:'))).toEqual(['repara:paciente']);
      await s.onApplicationShutdown();
    } finally {
      if (antes === undefined) delete process.env['WORKER_CLIENTES'];
      else process.env['WORKER_CLIENTES'] = antes;
    }
  });
});
