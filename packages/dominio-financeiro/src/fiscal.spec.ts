// Regras 18 e 19 do M32 no domínio: DMED e EFD-REINF gerados (não enviados), o lote contábil com contagem e soma, a
// remessa CNAB 240 contra o simulador e os indicadores com as parcelas.
import { describe, expect, it } from 'vitest';
import {
  conferirLote,
  contagemExibida,
  gerarCnab240,
  gerarDmed,
  gerarReinf,
  indicadorContasSemTitulo,
  indicadorCredorOrfao,
  indicadorPagosSemAprovacao,
  montarLoteContabil,
  simularRetorno,
} from './index.js';

describe('DMED e EFD-REINF', () => {
  it('DMED: dois recebimentos do mesmo CPF somam 150 + 50 = 200; total 200 + 80 = 280', () => {
    const a = gerarDmed(
      2025,
      { cnpj: '11.222.333/0001-81', nome: 'HOSPITAL SINTETICO', responsavelCpf: '529.982.247-25' },
      [
        { cpfTitular: '000.000.001-91', nomeTitular: 'TITULAR A', valor: 150 },
        { cpfTitular: '00000000191', nomeTitular: 'TITULAR A', valor: 50 },
        { cpfTitular: '000.000.002-72', nomeTitular: 'TITULAR B', valor: 80 },
      ],
    );
    expect(a.valorTotal).toBe(280);
    expect(a.situacao).toBe('gerado-nao-enviado');
    expect(a.conteudo).toContain('RPPSS|00000000191|TITULAR A|20000|');
    expect(a.conteudo.split('\r\n').filter(Boolean)).toHaveLength(a.registros);
  });
  it('R-2000 e R-4000 por prestador da competência', () => {
    const r = [
      {
        cnpjPrestador: '11.111.111/0001-11',
        documento: 1,
        dataEmissao: '2026-03-05',
        valorBruto: 1_000,
        inss: 110,
        ir: 15,
        csll: 10,
        pis: 6.5,
        cofins: 30,
      },
      {
        cnpjPrestador: '11.111.111/0001-11',
        documento: 2,
        dataEmissao: '2026-03-20',
        valorBruto: 500,
        inss: 55,
        ir: 7.5,
        csll: 5,
        pis: 3.25,
        cofins: 15,
      },
      {
        cnpjPrestador: '22.222.222/0001-22',
        documento: 3,
        dataEmissao: '2026-04-01',
        valorBruto: 999,
        inss: 1,
        ir: 1,
        csll: 0,
        pis: 0,
        cofins: 0,
      },
    ];
    const r2000 = gerarReinf('R-2000', '2026-03', '33.333.333/0001-33', r);
    expect(r2000.registros).toBe(1);
    expect(r2000.valorTotal).toBe(165);
    expect(r2000.conteudo).toContain('<vlrTotalRetPrinc>165.00</vlrTotalRetPrinc>');
    const r4000 = gerarReinf('R-4000', '2026-03', '33.333.333/0001-33', r);
    // IR 22,50 + CSRF (15 + 9,75 + 45) 69,75 = 92,25.
    expect(r4000.valorTotal).toBe(92.25);
    expect(gerarReinf('R-2000', '2026-05', '1', r).registros).toBe(0);
  });
});

describe('lote contábil (regra 19)', () => {
  it('2 lançamentos com de-para (100 + 250,50) e 1 sem de-para; o rodapé confere', () => {
    const l = montarLoteContabil(
      [
        { data: '2026-03-01', evento: 'P:F', valor: 100, historico: 'titulo; 1', documento: '1' },
        { data: '2026-03-02', evento: 'R:C', valor: 250.5, historico: 'recebido', documento: '2' },
        { data: '2026-03-03', evento: 'X', valor: 9, historico: 'sem', documento: '3' },
      ],
      [
        { evento: 'P:F', contaDebito: '3.1.1', contaCredito: '1.1.1' },
        { evento: 'R:C', contaDebito: '1.1.1', contaCredito: '1.2.1' },
        { evento: 'X', contaDebito: '', contaCredito: '1' },
      ],
    );
    expect(l.lancamentos).toBe(2);
    expect(l.somaDebitos).toBe(350.5);
    expect(l.somaCreditos).toBe(350.5);
    expect(l.semDePara).toHaveLength(1);
    expect(l.linhas[0]).toBe('2026-03-01;3.1.1;1.1.1;100.00;titulo  1;1');
    expect(conferirLote(l.conteudo)).toEqual({ ok: true, lancamentos: 2, soma: 350.5 });
    expect(conferirLote(l.conteudo.replace('100.00', '101.00')).ok).toBe(false);
  });
});

describe('remessa CNAB 240 e indicadores', () => {
  it('cabeçalho, 2 segmentos A e rodapé com 240 posições; o simulador responde 00', () => {
    const r = gerarCnab240(104, { agencia: 6174, numero: 123 }, 7, [
      { titulo: 1, valor: 10.5, vencimento: '2026-03-10', favorecido: 'Fornecedor Ação' },
      { titulo: 2, valor: 0, vencimento: '2026-03-10', favorecido: 'X' },
    ]);
    expect(r.linhas).toBe(4);
    expect(r.total).toBe(10.5);
    expect(
      r.conteudo
        .split('\r\n')
        .filter(Boolean)
        .every((l) => l.length === 240),
    ).toBe(true);
    expect(r.conteudo).toContain('FORNECEDOR ACAO');
    expect(
      simularRetorno([
        { titulo: 1, valor: 1, vencimento: '', favorecido: '' },
        { titulo: 2, valor: 0, vencimento: '', favorecido: '' },
      ]),
    ).toEqual([
      { titulo: 1, ocorrencia: '00' },
      { titulo: 2, ocorrencia: 'BD' },
    ]);
  });
  it('indicadores com as parcelas: 12,9% de credor órfão (129 de 1.000); contas sem título 67,41%', () => {
    expect(indicadorCredorOrfao(1_000, 129).valor).toBe(12.9);
    const c = indicadorContasSemTitulo(40_693, 13_260);
    expect(c.valor).toBe(67.41);
    expect(c.parcelas.map((p) => p.valor)).toEqual([40_693, 13_260, 27_433]);
    const p = indicadorPagosSemAprovacao(200, 150, 40);
    expect(p.valor).toBe(25);
    expect(p.parcelas[2]?.valor).toBe(50);
    expect(indicadorPagosSemAprovacao(0, 0, 0).valor).toBe(0);
    expect(contagemExibida(3)).toBe('<5');
    expect(contagemExibida(0)).toBe('0');
    expect(contagemExibida(12)).toBe('12');
  });
});
