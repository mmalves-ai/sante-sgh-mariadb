// Regra 12 (ficha do M30): urgência sem caução (Lei 12.653/2012); preço manual dentro da faixa ou com aprovação.
import { describe, expect, it } from 'vitest';
import {
  CONVENIO_PARTICULAR_FAT,
  conferirContaParticular,
  conferirPrecoManual,
  conferirRecebimento,
  conferirSemCaucao,
  decidirPrecoManual,
  mesmoLogin,
  ROTULO_FORMA,
  SITUACOES_DERIVADAS,
  SITUACOES_FILTRAVEIS,
  totalOrcamento,
  troco,
} from '../index.js';

const faixa = { abaixo: 0.1, acima: 0.2 };

describe('particular (regra 12)', () => {
  it('urgência nunca condicionada a caução ou garantia', () => {
    expect(conferirSemCaucao({ urgencia: true, exigeGarantiaAntes: true })?.codigo).toBe('caucao-proibida');
    expect(conferirSemCaucao({ urgencia: true, exigeGarantiaAntes: false })).toBeNull();
    expect(conferirSemCaucao({ urgencia: false, exigeGarantiaAntes: true })).toBeNull();
  });
  it('preço manual: dentro da faixa, acima (aprovação) e abaixo do mínimo', () => {
    expect(decidirPrecoManual(100, 95, faixa)).toBe('dentro-da-faixa');
    expect(decidirPrecoManual(100, 120, faixa)).toBe('dentro-da-faixa');
    expect(decidirPrecoManual(100, 121, faixa)).toBe('exige-aprovacao');
    expect(decidirPrecoManual(100, 89, faixa)).toBe('abaixo-do-minimo');
    expect(decidirPrecoManual(0, 10, faixa)).toBe('exige-aprovacao');
  });
  it('fora da faixa só com aprovador e justificativa', () => {
    const base = { tabela: 100, manual: 150, faixa, aprovador: null, justificativa: '' };
    expect(conferirPrecoManual({ ...base, manual: 110 })).toBeNull();
    expect(conferirPrecoManual(base)?.codigo).toBe('preco-fora-da-faixa');
    expect(conferirPrecoManual({ ...base, aprovador: 'SUPERVISOR' })?.codigo).toBe(
      'justificativa-obrigatoria',
    );
    expect(
      conferirPrecoManual({ ...base, aprovador: 'SUPERVISOR', justificativa: 'acordo da diretoria' }),
    ).toBeNull();
  });
  it('orçamento, recebimento e troco', () => {
    expect(
      totalOrcamento(
        [
          { descricao: 'a', quantidade: 2, unitario: 10.005 },
          { descricao: 'b', quantidade: 1, unitario: 5 },
        ],
        3,
      ),
    ).toBe(22.01);
    expect(totalOrcamento([{ descricao: 'a', quantidade: 1, unitario: 1 }], 5)).toBe(0);
    expect(conferirRecebimento({ saldo: 100, pagamentos: [] })?.codigo).toBe('sem-pagamento');
    expect(conferirRecebimento({ saldo: 100, pagamentos: [{ forma: 'pix', valor: 0 }] })?.codigo).toBe(
      'valor-invalido',
    );
    expect(conferirRecebimento({ saldo: 100, pagamentos: [{ forma: 'pix', valor: 120 }] })?.codigo).toBe(
      'acima-do-saldo',
    );
    expect(conferirRecebimento({ saldo: 100, pagamentos: [{ forma: 'dinheiro', valor: 120 }] })).toBeNull();
    expect(troco(100, [{ valor: 120 }])).toBe(20);
    expect(troco(100, [{ valor: 50 }])).toBe(0);
    expect(ROTULO_FORMA.pix).toBe('Pix');
  });
});

describe('correções do M30: autoaprovação e conta do particular', () => {
  const base = {
    tabela: 100,
    manual: 150,
    faixa: { abaixo: 0.1, acima: 0.2 },
    justificativa: 'acordo comercial',
  };
  it('o aprovador não pode ser quem lança (sem caixa, sem espaços nas pontas)', () => {
    expect(conferirPrecoManual({ ...base, aprovador: ' sint.fat ', operador: 'SINT.FAT' })?.codigo).toBe(
      'autoaprovacao',
    );
    expect(conferirPrecoManual({ ...base, aprovador: 'SINT.SUP', operador: 'SINT.FAT' })).toBeNull();
    // Dentro da faixa não há aprovação a conferir.
    expect(
      conferirPrecoManual({ ...base, manual: 105, aprovador: 'SINT.FAT', operador: 'SINT.FAT' }),
    ).toBeNull();
    expect(mesmoLogin('a', ' A ')).toBe(true);
  });
  it('só a conta do particular é recebida no caixa', () => {
    expect(conferirContaParticular(CONVENIO_PARTICULAR_FAT)).toBeNull();
    expect(conferirContaParticular(91)?.codigo).toBe('conta-nao-particular');
  });
  it('as situações filtráveis são as derivadas sem as subsituações da apresentada', () => {
    expect(SITUACOES_FILTRAVEIS).not.toContain('protocolada');
    expect(SITUACOES_FILTRAVEIS).not.toContain('com-retorno');
    expect(SITUACOES_FILTRAVEIS).not.toContain('em-recurso');
    for (const s of SITUACOES_FILTRAVEIS) expect(SITUACOES_DERIVADAS).toContain(s);
  });
});
