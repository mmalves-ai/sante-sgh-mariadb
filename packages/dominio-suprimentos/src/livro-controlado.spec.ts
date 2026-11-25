// Regra 9 (ficha do M29; Portaria 344/98, arts. 62 a 64 e 67; DP-47.14): 4 livros, página por substância, termos,
// guarda de 2 anos, fechado pelo farmacêutico responsável, escrituração semanal; o oficial só com a chave da VISA.
import { describe, expect, it } from 'vitest';
import {
  cnpjFormatado,
  conferirEmitenteDoLivro,
  conferirFechamentoLivro,
  guardaAte,
  LIVROS_CONTROLADOS,
  livroDaLista,
  montarLivro,
  ordenarTermos,
  termosDoLivro,
  textoDoTermo,
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
  it('termo gravado: o texto traz páginas, emitente com o CNPJ formatado, período, responsável e emissão', () => {
    const abertura = {
      tipo: 'abertura' as const,
      paginaInicial: 1,
      paginaFinal: 3,
      razaoSocial: 'HOSPITAL SINTETICO LTDA',
      cnpj: '92400000000155',
      responsavel: 'FARMACEUTICA SINTETICA',
      emitidoEm: '2026-11-15T08:30',
      conteudoGuardado: false,
    };
    const livro = {
      titulo: 'Livro de entorpecentes',
      inicio: '2026-11-08',
      fim: '2026-11-14',
      oficial: true,
    };
    const a = textoDoTermo(abertura, livro);
    expect(a).toMatch(/^Termo de abertura: este livro contém 3 página\(s\), numeradas de 1 a 3/);
    expect(a).toContain('HOSPITAL SINTETICO LTDA, CNPJ 92.400.000/0001-55');
    expect(a).toContain('no período de 08/11/2026 a 14/11/2026');
    expect(a).toContain('Responsável técnico: FARMACEUTICA SINTETICA. Emitido em 15/11/2026.');
    expect(a).not.toMatch(/conferência/);
    const e = textoDoTermo({ ...abertura, tipo: 'encerramento', conteudoGuardado: true }, livro);
    expect(e).toMatch(
      /^Termo de encerramento:.*contém 3 página\(s\).*escrituradas de 08\/11\/2026 a 14\/11\/2026/,
    );
    expect(e).toContain('O conteúdo fechado está guardado no arquivo do livro.');
    // O de conferência avisa que não substitui o oficial, e não cita arquivo.
    const c = textoDoTermo({ ...abertura, tipo: 'encerramento' }, { ...livro, oficial: false });
    expect(c).toMatch(/Relatório de conferência: não substitui o livro oficial\.$/);
    expect(c).not.toContain('guardado no arquivo');
    // Sem nome de responsável o termo diz, sem inventar; CNPJ fora do formato sai como veio.
    expect(textoDoTermo({ ...abertura, responsavel: '' }, livro)).toContain(
      'Responsável técnico: não identificado.',
    );
    expect(cnpjFormatado('123')).toBe('123');
  });
  it('termos gravados saem na ordem do livro: abertura e depois encerramento', () => {
    expect(ordenarTermos([{ tipo: 'encerramento' }, { tipo: 'abertura' }]).map((t) => t.tipo)).toEqual([
      'abertura',
      'encerramento',
    ]);
  });
});
