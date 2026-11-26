// Reprocessamento do período aberto (regra 2, segunda metade): a derivação de hoje frente ao gravado e a conferência
// das duas execuções do `pnpm contabil:reprocessar`.
import type { FatoContabil, PartidaGerada, RegraContabil } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { fato, PLANO, regra } from './fixtures.spec-util.js';
import { contextoDeAplicacao } from './registro.js';
import {
  aplicarLeitura,
  compararComGravado,
  conferirExecucoes,
  type LeituraDoPeriodo,
} from './reprocessamento.js';

// As duas partidas em conta fixa: a derivação não depende do de-para.
const credito = regra().partidas[1]!;
const fixa: RegraContabil = regra({ partidas: [{ ...credito, lado: 'D' }, credito] });
const ctx = contextoDeAplicacao(PLANO, []);
type Fato = FatoContabil & { idFato?: number; situacao?: string };
const contabilizado = (idFato: number, extra: Partial<FatoContabil> = {}): Fato => ({
  ...fato({ id: idFato, impressao: `i${idFato}`, ...extra }),
  idFato,
  situacao: 'contabilizado',
});
const partidasDe = (f: Fato): readonly PartidaGerada[] => aplicarLeitura(leitura([f])).todos[0]!.partidas;
const leitura = (fatos: readonly Fato[], extra: Partial<LeituraDoPeriodo> = {}): LeituraDoPeriodo => ({
  fatos,
  plano: PLANO,
  dePara: [],
  regras: [fixa],
  parcial: false,
  ...extra,
});

describe('reprocessamento frente ao gravado', () => {
  it('compara só os contabilizados que não são estorno e têm ID; conta iguais, diferentes e sem lançamento', () => {
    const igual = contabilizado(1);
    const mudou = contabilizado(2);
    const semGravado = contabilizado(3);
    const fatos: Fato[] = [
      igual,
      mudou,
      semGravado,
      { ...contabilizado(4), situacao: 'pendente' },
      { ...contabilizado(5), estorno: true },
      { ...fato({ id: 6 }), situacao: 'contabilizado' },
    ];
    const outra = partidasDe(mudou).map((p) => ({ ...p, valorCentavos: p.valorCentavos + 1 }));
    const gravados = new Map([
      [1, { partidas: partidasDe(igual) }],
      [2, { partidas: outra }],
    ]);
    expect(compararComGravado(fatos, [fixa], ctx, gravados)).toEqual({
      comparados: 3,
      iguais: 1,
      diferentes: 1,
      semLancamento: 1,
    });
  });

  it('sem regra aplicável hoje, o gravado conta como diferente', () => {
    const f = contabilizado(1);
    const gravados = new Map([[1, { partidas: partidasDe(f) }]]);
    expect(compararComGravado([f], [], ctx, gravados)).toMatchObject({
      comparados: 1,
      iguais: 0,
      diferentes: 1,
    });
  });
});

describe('conferência das duas execuções', () => {
  const fatos = [contabilizado(1), contabilizado(2, { valorCentavos: 33 })];

  it('as mesmas leituras inteiras dão idêntico; o substituído não conta', () => {
    const r = conferirExecucoes(
      leitura(fatos),
      leitura([...fatos, { ...contabilizado(9), situacao: 'substituido' }]),
    );
    expect(r).toMatchObject({
      fatos: 2,
      parcial: false,
      identico: true,
      iguais: 2,
      diferentes: 0,
      gravado: null,
    });
    expect(r.lancamentos).toEqual({ primeira: 2, segunda: 2 });
    expect(r.totais.primeira).toEqual(r.totais.segunda);
  });

  it('uma leitura parcial nunca é idêntica', () => {
    expect(conferirExecucoes(leitura(fatos), leitura(fatos, { parcial: true }))).toMatchObject({
      parcial: true,
      identico: false,
    });
    expect(conferirExecucoes(leitura(fatos, { parcial: true }), leitura(fatos)).identico).toBe(false);
  });

  it('lançamento a mais ou a menos na segunda conta como diferente', () => {
    const r = conferirExecucoes(leitura(fatos), leitura(fatos.slice(0, 1)));
    expect(r).toMatchObject({ identico: false, iguais: 1, diferentes: 1 });
    expect(r.lancamentos).toEqual({ primeira: 2, segunda: 1 });
  });

  it('com os gravados, a derivação diferente do gravado tira o idêntico', () => {
    const certos = new Map(fatos.map((f) => [f.idFato!, { partidas: partidasDe(f) }]));
    const ok = conferirExecucoes(leitura(fatos, { gravados: certos }), leitura(fatos));
    expect(ok.identico).toBe(true);
    expect(ok.gravado).toEqual({ comparados: 2, iguais: 2, diferentes: 0, semLancamento: 0 });

    const faltando = new Map([...certos].slice(0, 1));
    const sem = conferirExecucoes(leitura(fatos, { gravados: faltando }), leitura(fatos));
    expect(sem.identico).toBe(false);
    expect(sem.gravado?.semLancamento).toBe(1);

    const errado = new Map([...certos].map(([k, v]) => [k, { partidas: v.partidas.slice(0, 1) }]));
    const dif = conferirExecucoes(leitura(fatos, { gravados: errado }), leitura(fatos));
    expect(dif.identico).toBe(false);
    expect(dif.gravado?.diferentes).toBe(2);
  });
});
