import { describe, expect, it } from 'vitest';
import { rtfParaTexto, textoCorrido } from './prontuario/rtf.js';
import {
  conferirReceita,
  linhasDaReceita,
  receituario,
  rtfDaReceita,
  TIPO_PADRAO_LEGADO,
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
    expect(TIPO_PADRAO_LEGADO).toEqual({ simples: 1, 'controle-especial': 4, antimicrobiano: 1 });
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
