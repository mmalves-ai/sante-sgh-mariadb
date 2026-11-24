// Unidade da porta própria completa da gestão da qualidade (qualidade-b): o mapeamento do envio regulatório, o filtro
// pelo estabelecimento e pela competência, as tabelas da transação e o que segue falhando fechado na base.
import { ErroOperacao, type Executor } from '@sgh/nucleo';
import { describe, expect, it } from 'vitest';
import type { NucleoQualidade } from './apoio-propria.js';
import { PortaGestaoPropriaCompleta, TABELAS_GESTAO_COMPLETA } from './gestao-porta-propria-completa.js';
import { TABELAS_GESTAO } from './porta-gestao-propria.js';
import { TABELAS_COMPLEMENTO_Q5 } from './porta-propria-complemento-q5.js';

const LINHA = {
  id: 7,
  versao: 2,
  tipo: 'pm_qualiss',
  competencia: '2026-09',
  revisao: 1,
  arquivo_nome: 'pmQualiss-X-2026-09-r1.csv',
  resumo_sha256: 'c'.repeat(64),
  linhas: 4,
  resumo: '{"a":1}',
  situacao: 'substituido',
  gerado_por: 'ANA',
  gerado_em: new Date(2026, 9, 1, 8, 30, 5),
  transmitido_em: null,
  transmitido_por: null,
  protocolo: null,
};

function falso(linhas: readonly Record<string, unknown>[] = [LINHA]) {
  const chamadas: { sql: string; p: readonly unknown[] }[] = [];
  const leitor = {
    consultar: (sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve([...linhas]);
    },
    uma: (sql: string, p: readonly unknown[] = []) => {
      chamadas.push({ sql, p });
      return Promise.resolve(linhas[0] ?? null);
    },
  };
  const nucleo = {
    lerSomente: (_c: unknown, fn: (l: typeof leitor) => Promise<unknown>) => fn(leitor),
    criarExecutor: () => ({}) as Executor,
  } as unknown as NucleoQualidade;
  return { porta: new PortaGestaoPropriaCompleta(nucleo, null, {} as Executor), chamadas };
}
const C = { cliente: 'teste', estabelecimento: 3, usuario: 1, correlacao: 'x' } as never;

describe('porta própria completa da gestão (unidade)', () => {
  it('a transação declara as tabelas da base e a do envio regulatório', () => {
    expect(TABELAS_GESTAO_COMPLETA).toEqual(expect.arrayContaining([...TABELAS_GESTAO]));
    expect(TABELAS_GESTAO_COMPLETA).toContain('envio_regulatorio_qualidade');
    expect(TABELAS_GESTAO_COMPLETA).toEqual(expect.arrayContaining([...TABELAS_COMPLEMENTO_Q5]));
  });

  it('a lista de envios lê no estabelecimento desde o primeiro dia da competência e mapeia para o contrato', async () => {
    const { porta, chamadas } = falso();
    const [e] = await porta.envios(C, '2026-09');
    expect(chamadas[0]?.p).toEqual([3, '2026-09-01']);
    expect(chamadas[0]?.sql).toMatch(/ORDER BY e\.competencia DESC, e\.tipo, e\.revisao DESC/);
    expect(e).toEqual({
      id: 7,
      versao: 2,
      tipo: 'pmQualiss',
      competencia: '2026-09',
      revisao: 1,
      arquivo: 'pmQualiss-X-2026-09-r1.csv',
      hash: 'c'.repeat(64),
      linhas: 4,
      resumo: '{"a":1}',
      situacao: 'substituido',
      geradoPor: 'ANA',
      geradoEm: '2026-10-01T08:30:05',
      transmitidoEm: null,
      transmitidoPor: null,
      protocolo: null,
    });
  });

  it('o envio é lido pelo id no estabelecimento da sessão', async () => {
    const { porta, chamadas } = falso();
    expect((await porta.envio(C, 7))?.id).toBe(7);
    expect(chamadas[0]?.p).toEqual([3, 7]);
  });

  it('sem estabelecimento na sessão, a leitura recusa', async () => {
    const { porta } = falso();
    await expect(
      porta.envios({ ...(C as object), estabelecimento: null } as never, '2026-01'),
    ).rejects.toThrow(ErroOperacao);
  });

  it('sem o armazenamento de arquivos, o arquivo guardado do envio recusa 409 modelo-pendente (nunca gera de novo)', async () => {
    const { porta, chamadas } = falso();
    await expect(porta.arquivoEnvio(C, 7)).rejects.toMatchObject({ problema: { codigo: 'modelo-pendente' } });
    expect(chamadas[0]?.p).toEqual([7, 3]);
    expect(chamadas[0]?.sql).toMatch(/JOIN arquivo a ON a\.chave_armazenamento = e\.chave_objeto/);
  });

  it('as leituras do complemento Q5 vão ao banco no estabelecimento da sessão (não recusam mais modelo-pendente)', async () => {
    const { porta, chamadas } = falso([]);
    await expect(porta.sorteiosRevisao(C, 5)).resolves.toEqual([]);
    expect(chamadas[0]?.p).toEqual([3, 5]);
    await expect(porta.auditoria(C, 9)).resolves.toBeNull();
    expect(chamadas[1]?.p).toEqual([3, 9]);
  });
});
