import { describe, expect, it } from 'vitest';
import {
  classificarEmissao,
  copiasValidasDoModelo,
  especificidadeDaRegra,
  type FatosImpressao,
  fichasPelasRegras,
  type ModeloFichaImpressa,
  type RegraImpressaoFicha,
  regraValePara,
  validarModeloFicha,
  validarRegraImpressao,
} from './regra-impressao.js';

const modelo = (id: number, extra: Partial<ModeloFichaImpressa> = {}): ModeloFichaImpressa => ({
  id,
  titulo: `MODELO ${id}`,
  copias: 1,
  ordem: null,
  somenteRetorno: false,
  idadeMinima: null,
  idadeMaxima: null,
  ativo: true,
  ...extra,
});
const regra = (id: number, m: number, extra: Partial<RegraImpressaoFicha> = {}): RegraImpressaoFicha => ({
  id,
  modelo: m,
  estabelecimento: null,
  categoria: null,
  fontePagadora: null,
  especialidade: null,
  grupo: null,
  unidade: null,
  clinica: null,
  copias: null,
  selecionada: true,
  ativo: true,
  ...extra,
});
const fatos = (extra: Partial<FatosImpressao> = {}): FatosImpressao => ({
  estabelecimento: 1,
  categoria: 10,
  fontePagadora: 20,
  especialidade: 30,
  unidade: 40,
  clinica: null,
  grupos: [50, 51],
  retorno: false,
  idade: 40,
  ...extra,
});

describe('regras de impressão da recepção (02-REC linha 35)', () => {
  it('a regra sem dimensão vale para todo atendimento; a preenchida só quando coincide', () => {
    expect(regraValePara(regra(1, 1), fatos())).toBe(true);
    expect(regraValePara(regra(1, 1, { fontePagadora: 20 }), fatos())).toBe(true);
    expect(regraValePara(regra(1, 1, { fontePagadora: 21 }), fatos())).toBe(false);
    expect(regraValePara(regra(1, 1, { fontePagadora: 20, especialidade: 31 }), fatos())).toBe(false);
    expect(regraValePara(regra(1, 1, { unidade: 40, categoria: 10 }), fatos())).toBe(true);
    expect(regraValePara(regra(1, 1, { estabelecimento: 2 }), fatos())).toBe(false);
    expect(regraValePara(regra(1, 1, { especialidade: 30 }), fatos({ especialidade: null }))).toBe(false);
  });

  it('o grupo vale quando algum procedimento do atendimento é do grupo', () => {
    expect(regraValePara(regra(1, 1, { grupo: 51 }), fatos())).toBe(true);
    expect(regraValePara(regra(1, 1, { grupo: 52 }), fatos())).toBe(false);
    expect(regraValePara(regra(1, 1, { grupo: 50 }), fatos({ grupos: [] }))).toBe(false);
  });

  it('sem regra que valha, o modelo não sai; regra inativa e modelo inativo não contam', () => {
    const modelos = [modelo(1), modelo(2), modelo(3, { ativo: false })];
    const regras = [regra(1, 1, { fontePagadora: 99 }), regra(2, 2, { ativo: false }), regra(3, 3)];
    expect(fichasPelasRegras(modelos, regras, fatos())).toEqual([]);
  });

  it('entre as regras do mesmo modelo ganha a mais específica, e dela vêm as cópias e a seleção', () => {
    const modelos = [modelo(1, { copias: 2 })];
    const regras = [
      regra(1, 1),
      regra(2, 1, { fontePagadora: 20, copias: 3, selecionada: false }),
      regra(3, 1, { fontePagadora: 20, especialidade: 30, copias: 4 }),
      regra(4, 1, { fontePagadora: 21, especialidade: 30, unidade: 40, copias: 9 }),
    ];
    expect(especificidadeDaRegra(regras[2]!)).toBe(2);
    expect(fichasPelasRegras(modelos, regras, fatos())).toEqual([
      { modelo: 1, nome: 'MODELO 1', copias: 4, ordem: 0, selecionada: true, regra: 3 },
    ]);
    // Outro convênio: sobra a geral, com as cópias do modelo.
    expect(fichasPelasRegras(modelos, regras, fatos({ fontePagadora: 22 }))).toEqual([
      { modelo: 1, nome: 'MODELO 1', copias: 2, ordem: 0, selecionada: true, regra: 1 },
    ]);
    // Outra especialidade: a do convênio, que vem desmarcada.
    expect(fichasPelasRegras(modelos, regras, fatos({ especialidade: 31 }))[0]).toMatchObject({
      copias: 3,
      selecionada: false,
      regra: 2,
    });
  });

  it('no empate de especificidade ganha a regra mais antiga', () => {
    const regras = [regra(8, 1, { unidade: 40, copias: 5 }), regra(7, 1, { fontePagadora: 20, copias: 6 })];
    expect(fichasPelasRegras([modelo(1)], regras, fatos())[0]).toMatchObject({ regra: 7, copias: 6 });
  });

  it('os limites do modelo valem acima da regra: só no retorno e faixa de idade', () => {
    const modelos = [
      modelo(1, { somenteRetorno: true }),
      modelo(2, { idadeMaxima: 12 }),
      modelo(3, { idadeMinima: 60 }),
    ];
    const regras = [regra(1, 1), regra(2, 2), regra(3, 3)];
    const sai = (f: Partial<FatosImpressao>) =>
      fichasPelasRegras(modelos, regras, fatos(f)).map((x) => x.modelo);
    expect(sai({})).toEqual([]);
    expect(sai({ retorno: true })).toEqual([1]);
    expect(sai({ idade: 12 })).toEqual([2]);
    expect(sai({ idade: 60 })).toEqual([3]);
    // Sem data de nascimento, o modelo com faixa de idade não sai.
    expect(sai({ idade: null, retorno: true })).toEqual([1]);
  });

  it('a ordem de impressão: posição do modelo, depois os sem posição pelo título', () => {
    const modelos = [
      modelo(1, { titulo: 'Zeta' }),
      modelo(2, { titulo: 'Alfa' }),
      modelo(3, { titulo: 'Guia', ordem: 2 }),
      modelo(4, { titulo: 'Ficha', ordem: 1 }),
    ];
    const regras = [1, 2, 3, 4].map((m) => regra(m, m));
    expect(fichasPelasRegras(modelos, regras, fatos()).map((x) => x.modelo)).toEqual([4, 3, 2, 1]);
  });

  it('recusa a regra ativa repetida (mesmo modelo, mesmo alcance) e as cópias fora do limite', () => {
    const outras = [regra(1, 1, { fontePagadora: 20 }), regra(2, 1, { unidade: 40, ativo: false })];
    const nova = { ...regra(0, 1, { fontePagadora: 20 }), id: null };
    expect(validarRegraImpressao(nova, outras)?.codigo).toBe('regra-impressao-repetida');
    // A própria regra em alteração não conflita consigo; a inativa não conflita; outro modelo também não.
    expect(validarRegraImpressao({ ...nova, id: 1 }, outras)).toBeNull();
    expect(validarRegraImpressao({ ...nova, fontePagadora: null, unidade: 40 }, outras)).toBeNull();
    expect(validarRegraImpressao({ ...nova, modelo: 2 }, outras)).toBeNull();
    expect(validarRegraImpressao({ ...nova, ativo: false }, outras)).toBeNull();
    expect(validarRegraImpressao({ ...nova, fontePagadora: 21, copias: 10 }, outras)?.codigo).toBe(
      'regra-impressao-copias',
    );
    expect(validarRegraImpressao({ ...nova, fontePagadora: 21, copias: 0 }, outras)?.codigo).toBe(
      'regra-impressao-copias',
    );
    expect(validarRegraImpressao({ ...nova, fontePagadora: 21, copias: 9 }, outras)).toBeNull();
  });

  it('confere o modelo: título, cópias e faixa de idade', () => {
    const m = { titulo: 'Ficha', copias: 1, idadeMinima: null, idadeMaxima: null };
    expect(validarModeloFicha(m)).toBeNull();
    expect(validarModeloFicha({ ...m, titulo: '  ' })?.codigo).toBe('modelo-ficha-titulo');
    expect(validarModeloFicha({ ...m, copias: 10 })?.codigo).toBe('modelo-ficha-copias');
    expect(validarModeloFicha({ ...m, idadeMinima: 18, idadeMaxima: 12 })?.codigo).toBe('modelo-ficha-idade');
    expect(validarModeloFicha({ ...m, idadeMaxima: 131 })?.codigo).toBe('modelo-ficha-idade');
    expect(validarModeloFicha({ ...m, idadeMinima: 0, idadeMaxima: 12 })).toBeNull();
  });

  it('numera a emissão: a primeira é emissão, as seguintes são reimpressões', () => {
    expect(classificarEmissao(0)).toEqual({ sequencia: 1, reimpressao: false });
    expect(classificarEmissao(1)).toEqual({ sequencia: 2, reimpressao: true });
    expect(classificarEmissao(4)).toEqual({ sequencia: 5, reimpressao: true });
    expect(copiasValidasDoModelo(9)).toBe(true);
    expect(copiasValidasDoModelo(10)).toBe(false);
    expect(copiasValidasDoModelo(0)).toBe(false);
  });
});
