// Ciclo da leitura incremental dos fatos contábeis (M54.1; regra 1): sobre um banco em memória (as linhas da fonte, os
// fatos registrados e o estado da fonte), o primeiro ciclo registra os fatos e sobe a marca; o segundo, sem mudança,
// não grava nada (idempotente); a linha alterada dentro da revisão gera estorno + fato novo; a volta ao que era
// (A → B → A) ganha outra impressão; a faixa é lida em pedaços do teto; o evento só leva contagens. Dados SINTÉTICOS.
import type { FatoContabil, LinhaFonte } from '@sgh/contratos';
import type { EstadoFonte } from './fatos.js';
import { describe, expect, it } from 'vitest';
import {
  type AcessoCiclo,
  cicloDaFonte,
  diferencaDoCiclo,
  lerFaixaInteira,
  linhasUnicas,
  TETO_FAIXA,
} from './ciclo.js';

const T = 'titulo_pagar';
const titulo = (
  id: number,
  valor: number,
  extra: Record<string, string | number | null> = {},
): LinhaFonte => ({
  tabela: T,
  id,
  carimbo: null,
  valores: {
    VALOR: valor,
    PAGO: null,
    EMISSAO: '2026-10-05',
    DT_PGTO: null,
    TIPO: 'N',
    ONDE: 'F',
    ID_MFTIPOLANC: 7,
    ID_RPRPA: null,
    ...extra,
  },
});

function bancoEmMemoria(linhas: LinhaFonte[]) {
  const fonte = new Map(linhas.map((l) => [l.id, l]));
  const fatos: FatoContabil[] = [];
  let estado: { e: EstadoFonte; versao: number } | null = null;
  const leituras: { de: number; ate: number }[] = [];
  const acesso: AcessoCiclo = {
    estado: async () =>
      estado ? { marca: estado.e.marca, varredura: estado.e.varredura, versao: estado.versao } : null,
    lerNovos: async (_t, acimaDe, lote) =>
      [...fonte.values()]
        .filter((l) => l.id > acimaDe)
        .sort((a, b) => a.id - b.id)
        .slice(0, lote),
    lerFaixa: async (_t, de, ate) => {
      leituras.push({ de, ate });
      return [...fonte.values()].filter((l) => l.id >= de && l.id <= ate).sort((a, b) => a.id - b.id);
    },
    registrados: async (_t, chaves) => fatos.filter((f) => chaves.includes(f.id)),
    gravar: async (g) => {
      if ((estado?.versao ?? null) !== g.versaoVista) throw new Error('ciclo-concorrente');
      let gravados = 0;
      let repetidos = 0;
      for (const f of g.fatos) {
        const igual = fatos.some(
          (x) =>
            x.tabela === f.tabela &&
            x.id === f.id &&
            x.tipo === f.tipo &&
            x.impressao === f.impressao &&
            x.estorno === f.estorno,
        );
        if (igual) repetidos += 1;
        else {
          fatos.push(f);
          gravados += 1;
        }
      }
      estado = { e: g.estado, versao: (estado?.versao ?? 0) + 1 };
      return { gravados, repetidos };
    },
  };
  return { acesso, fonte, fatos, leituras, estadoAtual: () => estado };
}

const C = { empresa: 1, hoje: '2026-10-28', opcoes: { lote: 500, folga: 50, faixaVarredura: 100 } };

describe('ciclo da leitura dos fatos', () => {
  it('o primeiro ciclo registra os fatos das linhas novas e sobe a marca', async () => {
    const b = bancoEmMemoria([
      titulo(1, 100),
      titulo(2, 250.5, { PAGO: 250.5, DT_PGTO: '2026-10-10' }),
      titulo(3, 0),
    ]);
    const r = await cicloDaFonte(b.acesso, T, C);
    expect(r).toMatchObject({
      lidosNovos: 3,
      lidosAlterados: 0,
      fatosNovos: 3,
      estornos: 0,
      gravados: 3,
      marca: 3,
    });
    // O título de valor zero não gera fato; o pago gera o título e a baixa.
    expect(b.fatos.map((f) => [f.id, f.tipo, f.valorCentavos])).toEqual([
      [1, 'tituloPagar', 10000],
      [2, 'baixaTituloPagar', 25050],
      [2, 'tituloPagar', 25050],
    ]);
    expect(b.estadoAtual()?.e.marca).toBe(3);
  });

  it('o segundo ciclo sem mudança não grava nada (idempotente)', async () => {
    const b = bancoEmMemoria([titulo(1, 100), titulo(2, 200)]);
    await cicloDaFonte(b.acesso, T, C);
    const r = await cicloDaFonte(b.acesso, T, C);
    expect(r).toMatchObject({ lidosNovos: 0, lidosRevisao: 2, fatosNovos: 0, estornos: 0, gravados: 0 });
    expect(b.fatos).toHaveLength(2);
  });

  it('a linha alterada depois de lida (gravada por fora) gera estorno e fato novo; a volta ao que era, outra impressão', async () => {
    const b = bancoEmMemoria([titulo(1, 100), titulo(2, 200)]);
    await cicloDaFonte(b.acesso, T, C);
    b.fonte.set(2, titulo(2, 300));
    const r = await cicloDaFonte(b.acesso, T, C);
    expect(r).toMatchObject({ lidosAlterados: 1, fatosNovos: 1, estornos: 1, gravados: 2 });
    const estorno = b.fatos.find((f) => f.estorno)!;
    expect(estorno).toMatchObject({ id: 2, valorCentavos: 20000, referencia: b.fatos[1]!.impressao });
    // A → B → A: o fato de 200 volta, com impressão diferente da primeira (a chave única não aceita repetir).
    b.fonte.set(2, titulo(2, 200));
    const r2 = await cicloDaFonte(b.acesso, T, C);
    expect(r2).toMatchObject({ fatosNovos: 1, estornos: 1, gravados: 2, repetidos: 0 });
    const de200 = b.fatos.filter((f) => f.id === 2 && !f.estorno && f.valorCentavos === 20000);
    expect(de200).toHaveLength(2);
    expect(new Set(de200.map((f) => f.impressao)).size).toBe(2);
  });

  it('a linha nova confirmada atrás da marca entra pela revisão', async () => {
    const b = bancoEmMemoria([titulo(1, 100), titulo(3, 300)]);
    await cicloDaFonte(b.acesso, T, C);
    b.fonte.set(2, titulo(2, 200));
    const r = await cicloDaFonte(b.acesso, T, C);
    expect(r).toMatchObject({ lidosNovos: 0, fatosNovos: 1, gravados: 1, marca: 3 });
    expect(b.fatos.some((f) => f.id === 2)).toBe(true);
  });

  it('a faixa é lida em pedaços do teto, e as linhas repetidas valem uma vez', async () => {
    const b = bancoEmMemoria([]);
    await lerFaixaInteira(b.acesso, T, { de: 1, ate: TETO_FAIXA * 2 + 10 });
    expect(b.leituras).toEqual([
      { de: 1, ate: TETO_FAIXA },
      { de: TETO_FAIXA + 1, ate: TETO_FAIXA * 2 },
      { de: TETO_FAIXA * 2 + 1, ate: TETO_FAIXA * 2 + 10 },
    ]);
    expect(await lerFaixaInteira(b.acesso, T, null)).toEqual([]);
    expect(
      linhasUnicas([titulo(2, 1)], [titulo(1, 1), titulo(2, 5)]).map((l) => [l.id, l.valores['VALOR']]),
    ).toEqual([
      [1, 1],
      [2, 5],
    ]);
  });

  it('dois ciclos ao mesmo tempo: o segundo recusa pela versão do estado', async () => {
    const b = bancoEmMemoria([titulo(1, 100)]);
    const versaoAntes = await b.acesso.estado(T);
    await cicloDaFonte(b.acesso, T, C);
    await expect(
      b.acesso.gravar({
        tabela: T,
        fatos: [],
        estado: { tabela: T, marca: 1, varredura: 1 },
        versaoVista: versaoAntes?.versao ?? null,
        resumo: {} as never,
        diferenca: () => '',
      }),
    ).rejects.toThrow('ciclo-concorrente');
  });

  it('a fonte sem derivação é recusada, e o evento leva só contagens e faixas', async () => {
    const b = bancoEmMemoria([]);
    await expect(
      cicloDaFonte({ ...b.acesso, lerNovos: async () => [{ ...titulo(1, 1), tabela: 'XX' }] }, 'XX', C),
    ).rejects.toThrow(/sem derivação/);
    const d = diferencaDoCiclo(
      {
        tabela: T,
        plano: { novos: { acimaDe: 10, lote: 500 }, revisao: { de: 1, ate: 10 }, varredura: null },
        lidosNovos: 2,
        lidosRevisao: 10,
        lidosVarredura: 0,
        lidosAlterados: 1,
        fatosNovos: 3,
        estornos: 1,
        marca: 12,
        varredura: 1,
      },
      4,
    );
    expect(d).toBe(
      'fonte=titulo_pagar;novos=2;acima=10;revisao=1-10;varredura=-;alterados=1;fatos=3;estornos=1;gravados=4;marca=12',
    );
  });
});
