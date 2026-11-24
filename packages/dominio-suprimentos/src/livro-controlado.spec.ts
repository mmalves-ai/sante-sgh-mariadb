// Regra 9 (ficha do M29; Portaria 344/98, arts. 62 a 64 e 67; DP-47.14): 4 livros, página por substância, termos,
// guarda de 2 anos, fechado pelo farmacêutico responsável, escrituração semanal; o oficial só com a chave da VISA.
import { describe, expect, it } from 'vitest';
import {
  conferirEmitenteDoLivro,
  conferirFechamentoLivro,
  guardaAte,
  LIVROS_CONTROLADOS,
  livroDaLista,
  montarLivro,
  termosDoLivro,
} from '@sgh/contratos/regras-suprimentos';

describe('livro de controlados (regra 9)', () => {
  it('4 livros e a lista de cada um', () => {
    expect(LIVROS_CONTROLADOS).toHaveLength(4);
    expect(livroDaLista('A1')).toBe(1);
    expect(livroDaLista('B1')).toBe(2);
    expect(livroDaLista('C1')).toBe(3);
    expect(livroDaLista('C5')).toBe(3);
    expect(livroDaLista('C2')).toBe(4);
    expect(livroDaLista(null)).toBeNull();
  });
  it('uma página por substância do livro (ordem do nome), saldo e movimentos do período em ordem; modo conferência', () => {
    const l = montarLivro({
      livro: 3,
      inicio: '2026-10-19',
      fim: '2026-10-25',
      estabelecimento: 'Hospital sintético',
      oficial: false,
      substancias: [
        { item: 2, nome: 'Zolpidem sintético', lista: 'C1', saldoAnterior: 10 },
        { item: 1, nome: 'Amitriptilina sintética', lista: 'C1', saldoAnterior: 5 },
        { item: 3, nome: 'Morfina sintética', lista: 'A1', saldoAnterior: 4 },
      ],
      movimentos: [
        { item: 1, data: '2026-10-21', tipo: 'saida', quantidade: 2, documento: 'S-2' },
        { item: 1, data: '2026-10-20', tipo: 'entrada', quantidade: 10, documento: 'N-1' },
        { item: 1, data: '2026-10-26', tipo: 'saida', quantidade: 1, documento: 'S-9' },
        { item: 2, data: '2026-10-22', tipo: 'devolucao', quantidade: 1, documento: 'D-1' },
        { item: 3, data: '2026-10-22', tipo: 'saida', quantidade: 1, documento: 'S-3' },
      ],
    });
    expect(l.modo).toBe('conferencia');
    expect(l.paginas.map((p) => [p.pagina, p.item])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(l.paginas[0]).toMatchObject({ anterior: 5, entradas: 10, saidas: 2, final: 13 });
    expect(l.paginas[0]!.movimentos.map((m) => m.documento)).toEqual(['N-1', 'S-2']);
    expect(l.termoAbertura).toMatch(/2 página\(s\).*Relatório de conferência/);
    expect(l.termoEncerramento).toMatch(/contém 2 página/);
    const oficial = montarLivro({
      ...l,
      livro: 1,
      estabelecimento: 'X',
      oficial: true,
      substancias: [],
      movimentos: [],
    });
    expect(oficial.modo).toBe('oficial');
    expect(oficial.termoAbertura).not.toMatch(/conferência/);
  });
  it('fechar: responsável técnico, período válido de até 7 dias, oficial só com a chave, não repetido', () => {
    const b = {
      responsavelTecnico: true,
      inicio: '2026-10-19',
      fim: '2026-10-25',
      oficial: false,
      chaveOficialLigada: false,
      jaFechado: false,
    };
    expect(conferirFechamentoLivro(b)).toBeNull();
    expect(conferirFechamentoLivro({ ...b, responsavelTecnico: false })?.codigo).toBe(
      'so-responsavel-tecnico',
    );
    expect(conferirFechamentoLivro({ ...b, fim: '2026-10-18' })?.codigo).toBe('periodo-invalido');
    expect(conferirFechamentoLivro({ ...b, fim: '2026-10-26' })?.codigo).toBe('periodo-maior-que-semana');
    expect(conferirFechamentoLivro({ ...b, oficial: true })?.codigo).toBe('livro-oficial-desligado');
    expect(conferirFechamentoLivro({ ...b, oficial: true, chaveOficialLigada: true })).toBeNull();
    expect(conferirFechamentoLivro({ ...b, jaFechado: true })?.codigo).toBe('livro-fechado');
  });
  it('guarda de 2 anos', () => {
    expect(guardaAte('2026-10-25')).toBe('2028-10-25');
  });

  it('termos de abertura e encerramento: páginas do livro e emitente exigido no oficial', () => {
    expect(termosDoLivro(3)).toEqual([
      { tipo: 'abertura', sequencia: 1, paginaInicial: 1, paginaFinal: 3 },
      { tipo: 'encerramento', sequencia: 2, paginaInicial: 1, paginaFinal: 3 },
    ]);
    expect(termosDoLivro(0)[1].paginaFinal).toBe(1);
    expect(conferirEmitenteDoLivro({ razaoSocial: 'H', cnpj: null, oficial: true })?.codigo).toBe(
      'estabelecimento-sem-cnpj',
    );
    expect(conferirEmitenteDoLivro({ razaoSocial: ' ', cnpj: '12345678000190', oficial: true })?.codigo).toBe(
      'estabelecimento-sem-cnpj',
    );
    expect(conferirEmitenteDoLivro({ razaoSocial: 'H', cnpj: '12345678000190', oficial: true })).toBeNull();
    expect(conferirEmitenteDoLivro({ razaoSocial: 'H', cnpj: null, oficial: false })).toBeNull();
  });
});
