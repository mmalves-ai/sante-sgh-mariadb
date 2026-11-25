import { describe, expect, it } from 'vitest';
import { rtfParaTexto, textoCorrido } from './prontuario/rtf.js';
import {
  CLASSE_RECEITA,
  conferirItensDoTipo,
  conferirReceita,
  corpoDaReceitaEmVias,
  duracaoEstruturada,
  itemDaLinha,
  itensEstruturados,
  quantidadeNumerica,
  rtfDaReceitaEmVias,
  tipoDaClasse,
  linhasDaReceita,
  receituario,
  rtfDaReceita,
} from './receita.js';

const item = {
  medicamento: 'AMOXICILINA',
  concentracao: '500 mg',
  forma: 'cápsula',
  via: 'oral',
  posologia: '1 cápsula de 8 em 8 horas',
  quantidade: '21 cápsulas',
  duracao: '7 dias',
  usoContinuo: false,
};

describe('receita (regras 6 e 7)', () => {
  it('receituário certo por tipo, com rodapé de assinatura à mão no controlado', () => {
    expect(receituario('simples')).toMatchObject({ vias: 1, validadeDias: 30 });
    const c = receituario('controle-especial');
    expect(c.vias).toBe(2);
    expect(c.rodape).toMatch(/assinatura à mão/);
    const a = receituario('antimicrobiano');
    expect(a).toMatchObject({ vias: 2, validadeDias: 10 });
    expect(a.rodape).toMatch(/assinatura à mão/);
    // Classe própria: a de antimicrobiano não vira simples.
    expect(CLASSE_RECEITA.antimicrobiano).toEqual({ controleEspecial: false, antimicrobiano: true });
    expect(tipoDaClasse({ controleEspecial: 0, antimicrobiano: 1 })).toBe('antimicrobiano');
    expect(tipoDaClasse({ controleEspecial: 1, antimicrobiano: 1 })).toBe('controle-especial');
    expect(tipoDaClasse({ controleEspecial: 0, antimicrobiano: 0 })).toBe('simples');
  });

  it('recusa indicar farmácia e caractere fora do CP1252', () => {
    expect(conferirReceita([item])).toEqual([]);
    expect(conferirReceita([{ ...item, posologia: 'comprar na Drogaria X' }])[0]?.motivo).toMatch(/farmácia/);
    expect(conferirReceita([item], 'Retirar na farmácia do bairro')[0]?.campo).toBe('orientacoes');
    expect(conferirReceita([{ ...item, medicamento: 'AMOX ≥ 500' }])[0]?.motivo).toMatch(/Caractere/);
    expect(conferirReceita([item], 'dose ≥ 2')[0]?.motivo).toMatch(/Caractere/);
    expect(conferirReceita([])[0]?.campo).toBe('itens');
    expect(conferirReceita([{ ...item, posologia: ' ', quantidade: ' ' }]).map((p) => p.campo)).toEqual([
      'itens.0.posologia',
      'itens.0.quantidade',
    ]);
  });

  it('linhas e texto formatado (ida e volta pelo leitor do prontuário)', () => {
    const l = linhasDaReceita(
      [item, { ...item, medicamento: 'DIPIRONA', usoContinuo: true }],
      'Repouso.\nRetorno.',
    );
    expect(l[0]).toBe('1) AMOXICILINA 500 mg cápsula - 21 cápsulas');
    expect(l[1]).toContain('Via oral, 1 cápsula de 8 em 8 horas, por 7 dias');
    expect(l[3]).toContain('(uso contínuo)');
    expect(l.slice(-2)).toEqual(['Repouso.', 'Retorno.']);
    const rtf = rtfDaReceita([item], 'Ação');
    expect(rtf.startsWith('{\\rtf1\\ansi\\ansicpg1252')).toBe(true);
    expect(rtf).toContain("A\\'e7\\'e3o");
    expect(textoCorrido(rtfParaTexto(rtf))).toContain('AMOXICILINA 500 mg');
    expect(textoCorrido(rtfParaTexto(rtf))).toContain('Ação');
  });
});

describe('itens estruturados da receita (C2-021)', () => {
  it('quantidade e duração em número, texto impresso preservado', () => {
    expect(quantidadeNumerica('21 cápsulas')).toBe(21);
    expect(quantidadeNumerica('1,5 frasco')).toBe(1.5);
    expect(quantidadeNumerica('duas caixas')).toBe(2);
    expect(quantidadeNumerica('caixa')).toBeNull();
    expect(quantidadeNumerica('0')).toBeNull();
    expect(duracaoEstruturada('7 dias')).toEqual({ valor: 7, unidade: 'dia' });
    expect(duracaoEstruturada('2 semanas')).toEqual({ valor: 2, unidade: 'semana' });
    expect(duracaoEstruturada('3 meses')).toEqual({ valor: 3, unidade: 'mes' });
    expect(duracaoEstruturada('10')).toEqual({ valor: 10, unidade: 'dia' });
    expect(duracaoEstruturada('até melhorar')).toBeNull();
    const [e] = itensEstruturados([item]);
    expect(e).toMatchObject({
      sequencia: 1,
      quantidade: 21,
      quantidadeDescricao: '21 cápsulas',
      duracao: { valor: 7, unidade: 'dia' },
      via: 'oral',
    });
    const volta = itemDaLinha({
      medicamento: e!.medicamento,
      concentracao: e!.concentracao,
      forma: e!.forma,
      via: e!.via,
      posologia: e!.posologia,
      quantidadeDescricao: e!.quantidadeDescricao,
      duracao: 7,
      diasDaUnidade: 1,
      usoContinuo: false,
    });
    expect(volta).toEqual(item);
  });

  it('receituário certo pelo tipo e pela classe do medicamento', () => {
    expect(conferirItensDoTipo('simples', [{ ...item, quantidade: 'caixa' }])).toEqual([]);
    expect(conferirItensDoTipo('controle-especial', [{ ...item, quantidade: 'uma caixa grande' }])).toEqual(
      [],
    );
    expect(conferirItensDoTipo('controle-especial', [{ ...item, quantidade: 'caixa' }])[0]?.campo).toBe(
      'itens.0.quantidade',
    );
    const semDuracao = {
      medicamento: item.medicamento,
      concentracao: item.concentracao,
      forma: item.forma,
      via: item.via,
      posologia: item.posologia,
      quantidade: item.quantidade,
      usoContinuo: false,
    };
    expect(conferirItensDoTipo('antimicrobiano', [semDuracao])[0]?.campo).toBe('itens.0.duracao');
    expect(conferirItensDoTipo('antimicrobiano', [{ ...semDuracao, usoContinuo: true }])).toEqual([]);
    const ctrl = [{ sequencia: 1, controlado: true, antimicrobiano: false }];
    expect(conferirItensDoTipo('simples', [item], ctrl)[0]?.motivo).toMatch(/controle especial/);
    expect(conferirItensDoTipo('antimicrobiano', [item], ctrl)[0]?.motivo).toMatch(/Portaria 344/);
    expect(conferirItensDoTipo('controle-especial', [item], ctrl)).toEqual([]);
    const atb = [{ sequencia: 1, controlado: false, antimicrobiano: true }];
    expect(conferirItensDoTipo('simples', [item], atb)[0]?.motivo).toMatch(/RDC 471/);
    expect(conferirItensDoTipo('antimicrobiano', [item], atb)).toEqual([]);
  });

  it('documento em 2 vias no controle especial e no antimicrobiano; 1 via na simples', () => {
    const s = corpoDaReceitaEmVias('simples', [item]);
    expect(s.filter((l) => l.startsWith('1) AMOXICILINA'))).toHaveLength(1);
    const a = corpoDaReceitaEmVias('antimicrobiano', [item], 'Tomar com água');
    expect(a.filter((l) => l.startsWith('1) AMOXICILINA'))).toHaveLength(2);
    expect(a[0]).toMatch(/1ª via: retenção da farmácia/);
    expect(a.some((l) => /2ª via: paciente/.test(l))).toBe(true);
    expect(a.at(-1)).toMatch(/Validade de 10 dias/);
    const rtf = rtfDaReceitaEmVias('controle-especial', [item]);
    expect(textoCorrido(rtfParaTexto(rtf))).toMatch(/2ª via: paciente/);
  });

  it('a linha que fecha a via (marca da telemedicina) sai em cada via', () => {
    const marca = ['', 'MARCA SINTETICA'];
    expect(
      corpoDaReceitaEmVias('controle-especial', [item], undefined, marca).filter(
        (l) => l === 'MARCA SINTETICA',
      ),
    ).toHaveLength(2);
    expect(corpoDaReceitaEmVias('simples', [item], undefined, marca).at(-1)).toBe('MARCA SINTETICA');
  });
});
