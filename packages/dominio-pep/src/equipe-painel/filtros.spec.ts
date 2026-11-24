import { describe, expect, it } from 'vitest';
import {
  type FiltroPainel,
  filtrosQueDeixamDeSerPadrao,
  nasceComoPadrao,
  pacienteNoFiltro,
  type PacienteDoPainel,
  validarColunasDoFiltro,
  validarFiltroPainel,
} from './filtros.js';

const base: FiltroPainel = {
  nome: 'UTI adulto',
  padrao: false,
  tipoAtendimento: 'todos',
  unidade: null,
  setor: null,
  acomodacao: null,
  leito: null,
  especialidade: null,
  situacao: null,
  apenasMeusPacientes: false,
};
const codigos = (e: { codigo: string }[]) => e.map((x) => x.codigo);

describe('validarFiltroPainel', () => {
  it('aceita o filtro válido e o mesmo nome no próprio filtro ao renomear', () => {
    expect(validarFiltroPainel(base, [], null)).toEqual([]);
    expect(validarFiltroPainel(base, [{ id: 7, nome: 'uti ADULTO', padrao: true }], 7)).toEqual([]);
  });
  it('recusa nome vazio, longo e repetido sem diferença de maiúsculas', () => {
    expect(codigos(validarFiltroPainel({ ...base, nome: '  ' }, [], null))).toEqual(['nome-vazio']);
    expect(codigos(validarFiltroPainel({ ...base, nome: 'x'.repeat(61) }, [], null))).toEqual(['nome-longo']);
    expect(
      codigos(validarFiltroPainel(base, [{ id: 3, nome: ' Uti Adulto ', padrao: false }], null)),
    ).toEqual(['nome-repetido']);
  });
  it('recusa tipo e situação fora do catálogo, id não positivo e leito sem unidade', () => {
    const f = {
      ...base,
      tipoAtendimento: 'x',
      situacao: 'y',
      setor: 0,
      leito: 5,
    } as unknown as FiltroPainel;
    expect(codigos(validarFiltroPainel(f, [], null))).toEqual([
      'tipo-invalido',
      'situacao-invalida',
      'id-invalido',
      'leito-sem-unidade',
    ]);
    expect(validarFiltroPainel({ ...base, unidade: 2, leito: 5 }, [], null)).toEqual([]);
  });
});

describe('padrão único', () => {
  it('o primeiro filtro nasce padrão; os outros só quando pedido', () => {
    expect(nasceComoPadrao([], false)).toBe(true);
    expect(nasceComoPadrao([{ id: 1, nome: 'a', padrao: true }], false)).toBe(false);
    expect(nasceComoPadrao([{ id: 1, nome: 'a', padrao: true }], true)).toBe(true);
  });
  it('escolher o padrão desmarca os demais marcados', () => {
    const ex = [
      { id: 1, nome: 'a', padrao: true },
      { id: 2, nome: 'b', padrao: false },
      { id: 3, nome: 'c', padrao: true },
    ];
    expect(filtrosQueDeixamDeSerPadrao(ex, 2)).toEqual([1, 3]);
    expect(filtrosQueDeixamDeSerPadrao(ex, 1)).toEqual([3]);
  });
});

describe('validarColunasDoFiltro', () => {
  const cat = ['leito', 'paciente', 'idade'];
  it('aceita colunas do catálogo com largura nula ou entre 20 e 2000', () => {
    expect(
      validarColunasDoFiltro(
        [
          { coluna: 'leito', largura: 20 },
          { coluna: 'paciente', largura: null },
          { coluna: 'idade', largura: 2000 },
        ],
        cat,
      ),
    ).toEqual([]);
  });
  it('recusa coluna desconhecida, repetida, menos de duas e largura fora da faixa', () => {
    expect(codigos(validarColunasDoFiltro([{ coluna: 'z', largura: null }], cat))).toEqual([
      'coluna-desconhecida',
      'colunas-minimas',
    ]);
    expect(
      codigos(
        validarColunasDoFiltro(
          [
            { coluna: 'leito', largura: 19 },
            { coluna: 'leito', largura: 10.5 },
          ],
          cat,
        ),
      ),
    ).toEqual(['coluna-repetida', 'largura-invalida']);
  });
});

describe('pacienteNoFiltro', () => {
  const p: PacienteDoPainel = {
    tipoAtendimento: 'internacao',
    unidade: 2,
    setor: 3,
    acomodacao: 4,
    leito: 5,
    especialidade: 6,
    situacao: 'em_atendimento',
    doUsuario: false,
  };
  it('sem recortes, todos entram', () => {
    expect(pacienteNoFiltro(p, base)).toBe(true);
    expect(pacienteNoFiltro(p, { ...base, situacao: 'todos' })).toBe(true);
  });
  it('cada recorte preenchido precisa bater', () => {
    expect(pacienteNoFiltro(p, { ...base, unidade: 2, leito: 5, setor: 3, especialidade: 6 })).toBe(true);
    expect(pacienteNoFiltro(p, { ...base, setor: 9 })).toBe(false);
    expect(pacienteNoFiltro(p, { ...base, acomodacao: 9 })).toBe(false);
    expect(pacienteNoFiltro(p, { ...base, tipoAtendimento: 'ambulatorio' })).toBe(false);
    expect(pacienteNoFiltro(p, { ...base, situacao: 'alta' })).toBe(false);
  });
  it('apenas meus pacientes: só os do usuário', () => {
    expect(pacienteNoFiltro(p, { ...base, apenasMeusPacientes: true })).toBe(false);
    expect(pacienteNoFiltro({ ...p, doUsuario: true }, { ...base, apenasMeusPacientes: true })).toBe(true);
  });
});
