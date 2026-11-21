// M54.2: a contabilização do worker, lote a lote, sobre um acesso dublê (dados sintéticos). Sem regra publicada, o fato
// fica "sem regra" (nada é lançado); o teto de lotes por ciclo para o laço; sem candidato, não grava nada.
import type { AcaoContabilizacao } from '@sgh/dominio-contabil';
import { describe, expect, it } from 'vitest';
import { type AcessoContabilizacao, contabilizarPendentes, type LeituraContabilizacao } from './contabilizacao.js';

const fato = (idFato: number) => ({
  idFato,
  situacao: 'pendente' as const,
  tabela: 'titulo_receber',
  id: 100 + idFato,
  tipo: 'receitaConta' as const,
  origem: 3,
  empresa: 1,
  data: '2027-01-15',
  competencia: '2027-01',
  valorCentavos: 150_000,
  centroCusto: 7,
  documento: `conta ${idFato}`,
  campos: { convenio: 5 },
  impressao: 'abc',
  carimbo: null,
  estorno: false,
  referencia: null,
});

function acessoFalso(lotes: number[][], restamSempre = false) {
  const gravados: { acoes: readonly AcaoContabilizacao[]; diferenca: string }[] = [];
  let i = 0;
  const acesso: AcessoContabilizacao = {
    ler: async () => {
      const ids = lotes[i] ?? [];
      const restam = restamSempre || i < lotes.length - 1;
      i++;
      const fs = ids.map(fato);
      return {
        candidatos: fs,
        registrados: fs,
        lancamentos: new Map(),
        restam,
        plano: [],
        dePara: [],
        publicadas: [],
        periodos: [],
      } as unknown as LeituraContabilizacao;
    },
    gravar: async (_e, _c, acoes, diferenca) => {
      gravados.push({ acoes, diferenca });
      return { lancamentos: 0, repetidos: 0, mudaram: 0 };
    },
  };
  return { acesso, gravados, leituras: () => i };
}

describe('contabilizarPendentes (worker, M54.2)', () => {
  it('sem fato pendente, lê uma vez e não grava', async () => {
    const f = acessoFalso([[]]);
    const r = await contabilizarPendentes(f.acesso, { estabelecimento: 1 });
    expect(r).toMatchObject({ fatos: 0, lotes: 0, lancamentos: 0, restam: false });
    expect(f.gravados).toHaveLength(0);
  });

  it('sem regra publicada, marca os fatos "sem regra" e soma os lotes até não restar nada', async () => {
    const f = acessoFalso([[1, 2], [3]]);
    const r = await contabilizarPendentes(f.acesso, { estabelecimento: 1 });
    expect(r).toMatchObject({ fatos: 3, lotes: 2, lancamentos: 0, semRegra: 3, restam: false });
    expect(f.gravados.flatMap((g) => g.acoes.map((a) => [a.idFato, a.acao, a.situacao]))).toEqual([
      [1, 'marcar', 'semRegra'],
      [2, 'marcar', 'semRegra'],
      [3, 'marcar', 'semRegra'],
    ]);
    // A trilha leva só contagens (as parcelas do lote).
    expect(f.gravados[0]?.diferenca).toBe(
      'fatos=2;lancamentos=0;movidos=0;semRegra=2;semConta=0;debitos=0;creditos=0',
    );
  });

  it('para no teto de lotes por ciclo e avisa que restam fatos', async () => {
    const f = acessoFalso([[1], [2], [3], [4]], true);
    const r = await contabilizarPendentes(f.acesso, { estabelecimento: 1, maxLotes: 2 });
    expect(r).toMatchObject({ lotes: 2, fatos: 2, restam: true });
    expect(f.leituras()).toBe(2);
  });

  it('a recusa da leitura (operação indisponível no banco) sobe sem gravar nada', async () => {
    const gravar = async () => ({ lancamentos: 0, repetidos: 0, mudaram: 0 });
    const acesso: AcessoContabilizacao = { ler: () => Promise.reject(new Error('modelo-pendente')), gravar };
    await expect(contabilizarPendentes(acesso, { estabelecimento: 1 })).rejects.toThrow('modelo-pendente');
  });
});
