// Regra 5 da ficha do M22: as expressões do formulário de origem convertidas para JSON Logic, cada uma com teste
// de regressão (mesmas entradas, mesmo resultado que o interpretador de referência), e casos dourados dos padrões
// do inventário do M09 (habilitar por resposta, dias desde a data, dose, escore, faixa, antropometria).
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ItemFormulario, RepresentacaoFormulario } from '../formulario/dfm/mapeamento.js';
import { converterExpressao, TETO_REGRA } from './conversor.js';
import { interpretar } from './interpretador.js';
import {
  avaliarRegra,
  ErroRegra,
  OPERACOES_REGRA,
  type RegraLogica,
  variaveisDaRegra,
} from './json-logic.js';
import { ErroExpressao, lerPrograma, semComentarios } from './pascal.js';
import {
  aritmetica,
  arredondarPar,
  chamar,
  comoNumero,
  comparar,
  type ContextoRegras,
  dataParaDias,
  diasParaTexto,
  textoParaDias,
  type Valor,
} from './valores.js';

const HOJE = '2026-10-21';
const ctx = (valores: Record<string, Valor>): ContextoRegras => ({ valores, hoje: HOJE });

function ambos(fonte: string, valores: Record<string, Valor>): { ref: Valor; jl: Valor } {
  const c = converterExpressao(fonte);
  expect(c.convertida, c.motivo ?? '').toBe(true);
  return { ref: interpretar(lerPrograma(fonte), ctx(valores)), jl: avaliarRegra(c.regra, ctx(valores)) };
}

describe('valores (semântica comum)', () => {
  it('datas como dias desde 30/12/1899, ida e volta', () => {
    expect(dataParaDias('1899-12-30')).toBe(0);
    expect(diasParaTexto(0)).toBe('30/12/1899');
    expect(textoParaDias(diasParaTexto(46_000))).toBe(46_000);
    expect(dataParaDias('2026-13-40')).not.toBe(46_000);
    expect(dataParaDias('x')).toBeNull();
    expect(textoParaDias('2026-01-01')).toBeNull();
  });
  it('números, textos e lógicos', () => {
    expect(comoNumero('1,5')).toBe(1.5);
    expect(comoNumero(true)).toBe(1);
    expect(comoNumero(null)).toBeNull();
    expect(comoNumero(Number.NaN)).toBeNull();
    expect(comoNumero('30/12/1899')).toBe(0);
    expect(aritmetica('+', 'ab', 'cd')).toBe('abcd');
    expect(aritmetica('/', 1, 0)).toBeNull();
    expect(aritmetica('div', 7, 2)).toBe(3);
    expect(aritmetica('div', 7, 0)).toBeNull();
    expect(aritmetica('mod', 7, 3)).toBe(1);
    expect(aritmetica('mod', 7, 0)).toBeNull();
    expect(aritmetica('*', 'x', 2)).toBeNull();
    expect(comparar('=', 'a', 'a')).toBe(true);
    expect(comparar('<', 1, '2')).toBe(true);
    expect(comparar('>=', null, 'a')).toBe(false);
    expect(comparar('<>', 'b', 1)).toBe(true);
    expect(comparar('<=', 2, 2)).toBe(true);
    expect(comparar('>', 3, 2)).toBe(true);
  });
  it('Round como o Delphi (ao par) e as funções', () => {
    expect(arredondarPar(2.5)).toBe(2);
    expect(arredondarPar(3.5)).toBe(4);
    expect(arredondarPar(2.4)).toBe(2);
    expect(chamar('round', [2.5], ctx({}))).toBe(2);
    expect(chamar('abs', [-3], ctx({}))).toBe(3);
    expect(chamar('trunc', [-3.7], ctx({}))).toBe(-3);
    expect(chamar('sum', [1, 2, '3'], ctx({}))).toBe(6);
    expect(chamar('sum', [1, 'x'], ctx({}))).toBeNull();
    expect(chamar('strtodate', ['30/12/1899'], ctx({}))).toBe(0);
    expect(chamar('strtodate', [5], ctx({}))).toBe(5);
    expect(chamar('datetostr', [null], ctx({}))).toBeNull();
    expect(chamar('int', ['x'], ctx({}))).toBeNull();
    expect(chamar('round', [null], ctx({}))).toBeNull();
    expect(chamar('abs', [null], ctx({}))).toBeNull();
    expect(chamar('nada', [], ctx({}))).toBeNull();
    expect(chamar('date', [], ctx({}))).toBe(dataParaDias(HOJE));
  });
});

describe('leitor do Pascal-script', () => {
  it('comentários fora, textos preservados', () => {
    expect(semComentarios("a := 1; // fim\nb := '//x' { c } (* d *)")).toBe("a := 1;  \nb := '//x'    ");
  });
  it('recusa o que está fora do subconjunto, com o motivo', () => {
    for (const [fonte, motivo] of [
      ['while x do y := 1', 'comando desconhecido'],
      ['result := Foo(1)', 'função desconhecida'],
      ['result := 1 +', 'expressão incompleta'],
      ["result := 'abc", 'aspas'],
      ['result := 1 # 2', 'caractere'],
      ['result := (1', 'esperado ")"'],
      ['if 1 result := 2', 'esperado "then"'],
      ['result := 1 result := 2', 'esperado ";"'],
      ['result := Sum()', 'aridade'],
      ['begin result := 1', 'esperado "end"'],
    ] as const) {
      expect(() => lerPrograma(fonte)).toThrow(ErroExpressao);
      expect(converterExpressao(fonte).motivo ?? '').toContain(motivo);
    }
  });
  it('blocos, if sem else, else vazio, not, menos e mais unários, true/false', () => {
    const f =
      'begin x := -2; if not (x > 0) then begin result := +x * 3 end else ; end; if false then result := 0';
    expect(ambos(f, {})).toEqual({ ref: -6, jl: -6 });
    expect(ambos('if true then else result := 1', {})).toEqual({ ref: null, jl: null });
    expect(ambos('result := 7 div 2 + 7 mod 4', {})).toEqual({ ref: 6, jl: 6 });
    expect(ambos('result := 1 or 0', {})).toEqual({ ref: true, jl: true });
  });
  it('expressão vazia: convertida, sem regra', () => {
    expect(converterExpressao('   ')).toEqual({ convertida: true, regra: null, motivo: null });
  });
});

describe('padrões do inventário (casos dourados)', () => {
  it('habilitar por resposta: índice 1 desabilita', () => {
    const f = 'if (cmp837ItemIndex = 1) then result := false else result := true;';
    expect(ambos(f, { cmp837ItemIndex: 1 }).jl).toBe(false);
    expect(ambos(f, { cmp837ItemIndex: 2 }).jl).toBe(true);
    expect(ambos(f, {}).jl).toBe(true);
    expect(converterExpressao(f).regra).toEqual({
      if: [{ '==': [{ var: 'cmp837ItemIndex' }, 1] }, false, true],
    });
  });
  it('dias desde a data: vazia = 0; senão hoje − data', () => {
    const f =
      "if (DateToStr(cmp490) = '30/12/1899') then result := 0 else result := Date() - DateToStr(cmp490);";
    expect(ambos(f, { cmp490: 0 }).jl).toBe(0);
    const d = dataParaDias('2026-10-11');
    expect(ambos(f, { cmp490: d })).toEqual({ ref: 10, jl: 10 });
  });
  it('dose vasoativa (comentários no meio, sem quebra de linha perdida)', () => {
    const f =
      'if cmp69 > 0 // Concent\n and cmp70 > 0 // Vazao\n and cmp12 > 0 // Peso\n then result:= (cmp69 * cmp70) / (cmp12 * 60)';
    expect(ambos(f, { cmp69: 4, cmp70: 15, cmp12: 50 })).toEqual({ ref: 0.02, jl: 0.02 });
    expect(ambos(f, { cmp69: 0, cmp70: 15, cmp12: 50 }).jl).toBeNull();
  });
  it('escore de Braden: soma dos índices escolhidos', () => {
    const f =
      'PercepçãoSensorial := 0; Umidade := 0; if cmp254ItemIndex > 0 then PercepçãoSensorial := cmp254ItemIndex; if cmp255ItemIndex > 0 then Umidade := cmp255ItemIndex; result := Sum(PercepçãoSensorial, Umidade)';
    expect(ambos(f, { cmp254ItemIndex: 3, cmp255ItemIndex: 4 })).toEqual({ ref: 7, jl: 7 });
    expect(ambos(f, { cmp254ItemIndex: -1, cmp255ItemIndex: 2 })).toEqual({ ref: 2, jl: 2 });
  });
  it('classificação por faixa', () => {
    const f =
      'if ((cmp260 >= 6) and (cmp260 <= 11)) then result := 3 else if ((cmp260 >= 12) and (cmp260 <= 14)) then result := 1 else if ((cmp260 >= 15) and (cmp260 <= 16)) then result := 2;';
    expect([8, 13, 16, 20].map((v) => ambos(f, { cmp260: v }).jl)).toEqual([3, 1, 2, null]);
  });
  it('antropometria: IMC com int() e o "and" abaixo da comparação', () => {
    const f = 'if cmp278 <> 0 and cmp279 <> 0 then result := int(cmp278/(cmp279*cmp279));';
    expect(ambos(f, { cmp278: 80, cmp279: 1.8 })).toEqual({ ref: 24, jl: 24 });
    expect(ambos(f, { cmp278: 80, cmp279: 0 }).jl).toBeNull();
    const g =
      'if cmp760 <> 0 and(PacienteIdade <= 60) and (PacienteSexo = "F") and (cmp772ItemIndex = 1) then result:= (70.25 +(1.87 * cmp760) - 0.06 * PacienteIdade)';
    const r = ambos(g, { cmp760: 50, PacienteIdade: 40, PacienteSexo: 'F', cmp772ItemIndex: 1 });
    expect(r.ref).toBeCloseTo(161.35, 6);
    expect(r.jl).toBeCloseTo(161.35, 6);
  });
});

describe('avaliador de JSON Logic', () => {
  it('recusa operação desconhecida e nó com duas operações', () => {
    expect(() => avaliarRegra({ xpto: [1] }, ctx({}))).toThrow(ErroRegra);
    expect(() => avaliarRegra({ var: ['a'], if: [1] } as RegraLogica, ctx({}))).toThrow(ErroRegra);
    expect(() => avaliarRegra({ var: [1] }, ctx({}))).toThrow(ErroRegra);
  });
  it('if encadeado, else implícito, menos unário, argumento único', () => {
    expect(avaliarRegra({ if: [false, 1, true, 2, 3] }, ctx({}))).toBe(2);
    expect(avaliarRegra({ if: [false, 1] }, ctx({}))).toBeNull();
    expect(avaliarRegra({ '-': [5] }, ctx({}))).toBe(-5);
    expect(avaliarRegra({ '!': true }, ctx({}))).toBe(false);
    expect(avaliarRegra({ '+': [1, 2, 3] }, ctx({}))).toBe(6);
  });
  it('variáveis lidas pela regra (recalcular só quando mudam)', () => {
    const c = converterExpressao('if cmp1ItemIndex = 1 then result := cmp2 + cmp3 else result := 0');
    expect(variaveisDaRegra(c.regra)).toEqual(['cmp1ItemIndex', 'cmp2', 'cmp3']);
  });
  it('a regra convertida usa só as operações aceitas', () => {
    const visitar = (r: RegraLogica | readonly RegraLogica[]): void => {
      if (Array.isArray(r)) return r.forEach(visitar);
      if (r && typeof r === 'object')
        for (const [op, v] of Object.entries(r)) {
          expect(OPERACOES_REGRA.has(op)).toBe(true);
          visitar(v as RegraLogica);
        }
    };
    visitar(converterExpressao('x := Round(Abs(-2.5)); result := Trunc(x) + StrToDate("30/12/1899")').regra);
  });
  it('teto do tamanho da regra', () => {
    const muitos = Array.from({ length: 40 }, (_, i) => `if cmp${i} > 0 then x := x + 1;`).join(' ');
    const c = converterExpressao(`x := 0; ${muitos} result := x`);
    expect(c.convertida).toBe(false);
    expect(c.motivo).toContain('grande demais');
    expect(TETO_REGRA).toBeGreaterThan(1_000);
  });
});

// ── Regressão nos 67 modelos (as 270 expressões do inventário do M09) ──────────────────────────────────

const pasta = resolve(import.meta.dirname, '../../../../docs/marcos/M09/dfm');
const reps = readdirSync(pasta)
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(resolve(pasta, f), 'utf8')) as RepresentacaoFormulario);

function todas(): { fonte: string; regra: RegraLogica; convertida: boolean; refs: readonly string[] }[] {
  const l: { fonte: string; regra: RegraLogica; convertida: boolean; refs: readonly string[] }[] = [];
  const visitar = (itens: readonly ItemFormulario[]) => {
    for (const i of itens) {
      for (const e of i.expressoes ?? [])
        l.push({
          fonte: e.fonte,
          regra: e.regra ?? null,
          convertida: e.convertida === true,
          refs: e.referencias,
        });
      visitar(i.itens);
    }
  };
  for (const r of reps) visitar(r.itens);
  return l;
}

/** Gerador pseudoaleatório determinístico (mulberry32). */
function aleatorio(semente: number): () => number {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('regressão: as 270 expressões dos 67 modelos', () => {
  const lista = todas();
  it('270 expressões, 100% convertidas automaticamente (meta da ficha: cerca de 95%)', () => {
    expect(lista).toHaveLength(270);
    expect(lista.filter((e) => e.convertida)).toHaveLength(270);
  });
  it('mesmas entradas, mesmo resultado (interpretador de referência × JSON Logic), 40 casos por expressão', () => {
    const rnd = aleatorio(20261021);
    let casos = 0;
    for (const e of lista) {
      const prog = lerPrograma(e.fonte);
      // A regra guardada na representação é a que a tela usa: é ela que se confere.
      for (let k = 0; k < 40; k++) {
        const valores: Record<string, Valor> = {
          PacienteIdade: Math.floor(rnd() * 100),
          PacienteSexo: rnd() < 0.5 ? 'F' : 'M',
        };
        for (const ref of e.refs) {
          const base = ref.replace(/itemindex$/i, '');
          valores[`${base}ItemIndex`] = Math.floor(rnd() * 7) - 1;
          valores[base] =
            rnd() < 0.2
              ? 0
              : rnd() < 0.5
                ? (dataParaDias(HOJE) ?? 0) - Math.floor(rnd() * 400)
                : Math.round(rnd() * 2000) / 10;
        }
        const ref = interpretar(prog, ctx(valores));
        const jl = avaliarRegra(e.regra, ctx(valores));
        if (typeof ref === 'number' && typeof jl === 'number') expect(jl).toBeCloseTo(ref, 9);
        else expect(jl).toEqual(ref);
        casos++;
      }
    }
    expect(casos).toBe(270 * 40);
  });
});
