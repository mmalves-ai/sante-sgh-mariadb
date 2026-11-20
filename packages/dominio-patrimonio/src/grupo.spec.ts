// W0-08, parte 4 (matriz, "Tabelas de domínio": a vida útil nova do grupo é prospectiva): o grupo do bem vira cadastro
// (SGH_PAT_GRUPO); a vida útil do grupo é só o padrão sugerido na hora do cadastro do bem. O bem guarda a própria, e a
// cota já calculada nunca é refeita: mudar o grupo não altera nenhuma cota (antes e depois), só os bens cadastrados
// depois. O bem só entra em grupo ativo do cadastro. Bens sintéticos.
import { type CadastrarBem, esquemaCadastrarBem, GRUPOS_BEM } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import { type BemParaDepreciar, cotaDoMes, montarTotais, planoDaDepreciacao } from './depreciacao.js';
import {
  type ContextoCadastro,
  gruposDaSemente,
  type GruposDoCadastro,
  problemasDoCadastro,
  valoresDoCadastro,
  vidaUtilPadrao,
} from './origem.js';

const P = { aplicarCoeficiente: true, considerarResidual: true };

const ctx = (grupos: GruposDoCadastro): ContextoCadastro => ({
  origens: new Map([[1, { depreciar: true }]]),
  tiposResponsavel: new Set([1]),
  coeficientes: new Set([1]),
  centrosAtivos: new Set([10]),
  empresas: new Set([1]),
  item: { id: 500, nota: 50, quantidade: 1, valorTotalCent: 12_000_00, jaCadastrados: 0 },
  dataNota: '2025-12-10',
  hoje: '2026-10-29',
  grupos,
});

const cadastro = (grupo: string): CadastrarBem =>
  esquemaCadastrarBem.parse({
    documento: 'nota',
    nota: 50,
    itemNota: 500,
    descricao: 'Monitor multiparamétrico',
    grupo,
    origem: 1,
    centro: 10,
  });

/** O bem como o cadastro o gravou (a vida útil do bem é a do grupo NA HORA do cadastro). */
const bemCadastrado = (id: number, grupos: GruposDoCadastro, acumuladaCent = 0): BemParaDepreciar => {
  const v = valoresDoCadastro(cadastro('equipamentoMedico'), ctx(grupos), 1);
  return {
    id,
    plaqueta: `PC${String(id).padStart(6, '0')}`,
    descricao: 'Monitor',
    grupo: 'equipamentoMedico',
    centro: 10,
    valorCent: v.valores[0]!,
    residualCent: 0,
    vidaUtilMeses: v.vidaUtilMeses,
    coeficiente: null,
    inicioDepreciacao: v.inicioDepreciacao,
    depreciavel: v.depreciavel,
    situacao: 'ativo',
    baixadoEm: null,
    acumuladaCent,
    temCotaNaCompetencia: false,
  };
};

const cota = (b: BemParaDepreciar, comp: string) => {
  const r = cotaDoMes(b, comp, P);
  if (!('cota' in r)) throw new Error(r.semCota);
  return r.cota;
};

describe('W0-08: grupo do bem como cadastro (vida útil prospectiva)', () => {
  it('a semente são os 8 grupos da IN RFB, ativos, com a vida útil de GRUPOS_BEM', () => {
    const s = gruposDaSemente();
    expect([...s.keys()]).toEqual(Object.keys(GRUPOS_BEM));
    expect(s.get('informatica')).toEqual({ ativo: true, vidaUtilMeses: 60 });
    expect(vidaUtilPadrao('edificacoes')).toBe(300);
    expect(vidaUtilPadrao('naoExiste')).toBe(120);
  });

  it('a vida útil padrão é a do cadastro (não a da semente) e o grupo novo do cadastro vale', () => {
    const g: GruposDoCadastro = new Map([
      ['equipamentoMedico', { ativo: true, vidaUtilMeses: 96 }],
      ['ortese', { ativo: true, vidaUtilMeses: 36 }],
    ]);
    expect(vidaUtilPadrao('equipamentoMedico', g)).toBe(96);
    expect(problemasDoCadastro(cadastro('ortese'), ctx(g))).toEqual([]);
    expect(valoresDoCadastro(cadastro('ortese'), ctx(g), 1).vidaUtilMeses).toBe(36);
  });

  it('grupo desconhecido ou inativo recusa o cadastro do bem', () => {
    const g: GruposDoCadastro = new Map([['moveis', { ativo: false, vidaUtilMeses: 120 }]]);
    expect(problemasDoCadastro(cadastro('moveis'), ctx(g)).map((p) => p.codigo)).toContain('grupo-inativo');
    expect(problemasDoCadastro(cadastro('veiculos'), ctx(g)).map((p) => p.codigo)).toContain('grupo');
  });

  it('mudar a vida útil do grupo não altera cota já calculada nem a cota seguinte do bem antigo (antes e depois)', () => {
    const antes: GruposDoCadastro = new Map([['equipamentoMedico', { ativo: true, vidaUtilMeses: 120 }]]);
    const bemAntigo = bemCadastrado(1, antes);
    // Antes da mudança: 12.000,00 em 120 meses → 100,00 em jan/2026 (cota calculada e gravada).
    const janeiro = cota(bemAntigo, '2026-01');
    expect(janeiro.valorCent).toBe(100_00);
    expect(janeiro.vidaUtilMeses).toBe(120);

    // O grupo passa a 60 meses (alteração do cadastro).
    const depois: GruposDoCadastro = new Map([['equipamentoMedico', { ativo: true, vidaUtilMeses: 60 }]]);
    // A cota de janeiro já calculada é a mesma (nada a recalcular: o bem guarda a própria vida útil)…
    expect(cota(bemAntigo, '2026-01')).toEqual(janeiro);
    // …e a de fevereiro do bem antigo segue 100,00 (120 meses), com a acumulada de janeiro.
    const fevereiro = cota({ ...bemAntigo, acumuladaCent: janeiro.acumuladaDepoisCent }, '2026-02');
    expect(fevereiro.valorCent).toBe(100_00);
    expect(fevereiro.acumuladaAntesCent).toBe(100_00);

    // O bem cadastrado DEPOIS da mudança pega 60 meses: 200,00 por mês.
    const bemNovo = bemCadastrado(2, depois);
    expect(bemNovo.vidaUtilMeses).toBe(60);
    expect(cota(bemNovo, '2026-01').valorCent).toBe(200_00);
  });

  it('o rótulo da parcela por grupo vem do cadastro (com a semente como padrão)', () => {
    const b = bemCadastrado(1, gruposDaSemente());
    const plano = planoDaDepreciacao([b], '2026-01', P, String, (k) => `Grupo ${k}`);
    expect(plano.porGrupo).toEqual([
      { chave: 'equipamentoMedico', rotulo: 'Grupo equipamentoMedico', bens: 1, valorCent: 100_00 },
    ]);
    expect(montarTotais(plano.cotas).porGrupo[0]?.rotulo).toBe(GRUPOS_BEM.equipamentoMedico.rotulo);
  });
});
