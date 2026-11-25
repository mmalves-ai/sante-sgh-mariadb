// F7, 07-FIN linha 78: regras da cobrança bancária com boleto (massa SINTÉTICA).
import { describe, expect, it } from 'vitest';
import {
  type BoletoDoRetorno,
  campoLivrePadrao,
  conferirCarteira,
  conferirEmissao,
  digitoNossoNumero,
  fatorVencimento,
  gerarRemessaCobranca240,
  lerRetornoCobranca240,
  linhaParaCodigoBarras,
  modulo10,
  montarCodigoBoleto,
  montarRetornoCobranca240,
  planejarRetornoCobranca,
  proximoNossoNumero,
  retornoCobrancaRecusado,
} from './cobranca-boleto.js';

const CARTEIRA = {
  descricao: 'Carteira sintética',
  codigoCarteira: '9',
  codigoBeneficiario: '123456',
  nossoNumeroInicial: 1,
  nossoNumeroFinal: 999,
  diasCompensacao: 1,
  valorTarifa: 2.5,
};

describe('carteira e nosso número', () => {
  it('valida a carteira na hora', () => {
    expect(conferirCarteira(CARTEIRA)).toBeNull();
    expect(conferirCarteira({ ...CARTEIRA, codigoCarteira: 'AB' })?.codigo).toBe('carteira-codigo');
    expect(conferirCarteira({ ...CARTEIRA, nossoNumeroFinal: 0 })?.codigo).toBe('carteira-faixa');
    expect(conferirCarteira({ ...CARTEIRA, valorTarifa: -1 })?.codigo).toBe('carteira-tarifa');
    expect(conferirCarteira({ ...CARTEIRA, descricao: ' ' })?.campos).toEqual(['descricao']);
  });
  it('dá o próximo nosso número com dígito e para no fim da faixa', () => {
    const p = proximoNossoNumero({ codigoCarteira: '9', atual: 1, inicial: 1, final: 3 });
    expect(p?.sequencia).toBe(2);
    expect(p?.nossoNumero).toHaveLength(12);
    expect(p?.nossoNumero.slice(-1)).toBe(digitoNossoNumero('9', 2));
    expect(proximoNossoNumero({ codigoCarteira: '9', atual: 3, inicial: 1, final: 3 })).toBeNull();
    expect(proximoNossoNumero({ codigoCarteira: '9', atual: 0, inicial: 10, final: 30 })?.sequencia).toBe(10);
  });
});

describe('código de barras e linha digitável (FEBRABAN)', () => {
  it('fator de vencimento com o recomeço de 22/02/2025', () => {
    expect(fatorVencimento('2000-07-03')).toBe('1000');
    expect(fatorVencimento('2007-12-31')).toBe('3737');
    expect(fatorVencimento('2025-02-21')).toBe('9999');
    expect(fatorVencimento('2025-02-22')).toBe('1000');
    expect(fatorVencimento('2025-02-23')).toBe('1001');
  });
  it('confere o exemplo público da linha digitável', () => {
    expect(modulo10('001905009')).toBe('5');
    expect(linhaParaCodigoBarras('00190.50095 40144.816069 06809.350314 3 37370000000100')).toBe(
      '00193373700000001000500940144816060680935031',
    );
    expect(linhaParaCodigoBarras('00190.50095 40144.816069 06809.350314 4 37370000000100')).toBeNull();
  });
  it('monta código e linha que se conferem um ao outro', () => {
    const livre = campoLivrePadrao({
      agencia: '1234',
      carteira: '9',
      nossoNumero: '000000000021',
      conta: '98765',
    });
    expect(livre).toHaveLength(25);
    const c = montarCodigoBoleto({ banco: 987, vencimento: '2030-01-15', valor: 1234.56, campoLivre: livre });
    expect(c.codigoBarras).toHaveLength(44);
    expect(c.codigoBarras.slice(9, 19)).toBe('0000123456');
    expect(c.linhaDigitavel.replace(/\D/g, '')).toHaveLength(47);
    expect(linhaParaCodigoBarras(c.linhaDigitavel)).toBe(c.codigoBarras);
    expect(() =>
      montarCodigoBoleto({ banco: 987, vencimento: '2030-01-15', valor: 0, campoLivre: livre }),
    ).toThrow();
  });
});

describe('emissão', () => {
  const P = {
    parcela: 7,
    situacao: 'aberta',
    tituloSituacao: 'aberto',
    saldo: 100,
    vencimento: '2030-01-10',
    boletoAtivo: false,
    pagadorDocumento: '12345678909',
    pagadorNome: 'PAGADOR SINTETICO',
  };
  it('aceita a parcela em aberto e recusa com o motivo dito', () => {
    expect(conferirEmissao(P, '2030-01-01')).toBeNull();
    expect(conferirEmissao({ ...P, situacao: 'recebida' }, '2030-01-01')?.codigo).toBe('parcela-nao-aberta');
    expect(conferirEmissao({ ...P, boletoAtivo: true }, '2030-01-01')?.codigo).toBe('boleto-ja-emitido');
    expect(conferirEmissao({ ...P, pagadorDocumento: '123' }, '2030-01-01')?.codigo).toBe(
      'pagador-sem-documento',
    );
    expect(conferirEmissao(P, '2030-02-01')?.codigo).toBe('vencimento-passado');
    expect(conferirEmissao({ ...P, saldo: 0 }, '2030-01-01')?.codigo).toBe('parcela-sem-saldo');
  });
});

describe('remessa CNAB 240 de cobrança', () => {
  it('gera P, Q e R com 240 posições e o total com as parcelas', () => {
    const r = gerarRemessaCobranca240(
      {
        banco: 987,
        cnpj: '11222333000181',
        nome: 'HOSPITAL SINTÉTICO',
        convenio: '123456',
        agencia: '1234',
        conta: '98765',
        digitoConta: '0',
        carteira: '9',
      },
      5,
      new Date('2030-01-02T10:11:12Z'),
      [
        {
          instrucao: 'registro',
          nossoNumero: '000000000021',
          numeroDocumento: 'TR-1/1',
          vencimento: '2030-01-15',
          emissao: '2030-01-02',
          valor: 100,
          pagadorDocumento: '12345678909',
          pagadorNome: 'Pagador Á',
          percentualMulta: 2,
          percentualJurosMes: 1,
          mensagem: 'Não receber após 30 dias',
        },
        {
          instrucao: 'registro',
          nossoNumero: '000000000035',
          numeroDocumento: 'TR-2/1',
          vencimento: '2030-01-20',
          emissao: '2030-01-02',
          valor: 50.25,
          pagadorDocumento: '11222333000181',
          pagadorNome: 'Empresa',
          percentualMulta: null,
          percentualJurosMes: null,
          mensagem: null,
        },
        {
          instrucao: 'baixa',
          nossoNumero: '000000000040',
          numeroDocumento: 'TR-3/1',
          vencimento: '2030-01-20',
          emissao: '2030-01-02',
          valor: 10,
          pagadorDocumento: '12345678909',
          pagadorNome: 'X',
          percentualMulta: null,
          percentualJurosMes: null,
          mensagem: null,
        },
      ],
    );
    const linhas = r.conteudo.split('\r\n').filter((l) => l.length > 0);
    expect(linhas.every((l) => l.length === 240)).toBe(true);
    expect(linhas.map((l) => l[13]).join('')).toContain('PQRPQPQ');
    expect(linhas[0]?.[142]).toBe('1');
    expect(linhas[2]?.slice(15, 17)).toBe('01');
    expect(linhas[7]?.slice(15, 17)).toBe('02');
    expect(r.parcelas).toEqual([100, 50.25]);
    expect(r.total).toBe(150.25);
    expect(Number(linhas.at(-1)?.slice(23, 29))).toBe(linhas.length);
    expect(linhas[4]?.slice(99, 139).trim()).toBe('NAO RECEBER APOS 30 DIAS');
  });
});

describe('retorno CNAB 240 de cobrança', () => {
  const boletos = new Map<string, BoletoDoRetorno>([
    ['000000000021', { boleto: 1, parcela: 11, situacao: 'emitido', saldoParcela: 100 }],
    ['000000000035', { boleto: 2, parcela: 12, situacao: 'registrado', saldoParcela: 50 }],
    ['000000000040', { boleto: 3, parcela: 13, situacao: 'pago', saldoParcela: 0 }],
    ['000000000052', { boleto: 4, parcela: 14, situacao: 'emitido', saldoParcela: 80 }],
  ]);
  const arquivo = montarRetornoCobranca240(987, 9, '2030-01-21', [
    { codigo: '02', nossoNumero: '000000000021', valorTitulo: 100, tarifa: 1.5 },
    {
      codigo: '06',
      nossoNumero: '000000000021',
      valorTitulo: 100,
      valorPago: 102,
      encargos: 2,
      tarifa: 2.5,
      dataOcorrencia: '2030-01-20',
      dataCredito: '2030-01-21',
    },
    {
      codigo: '06',
      nossoNumero: '000000000035',
      valorTitulo: 50,
      valorPago: 30,
      dataOcorrencia: '2030-01-20',
    },
    {
      codigo: '06',
      nossoNumero: '000000000040',
      valorTitulo: 10,
      valorPago: 10,
      dataOcorrencia: '2030-01-20',
    },
    { codigo: '03', nossoNumero: '000000000052', valorTitulo: 80, motivos: '4608' },
    { codigo: '06', nossoNumero: '000000000999', valorTitulo: 5, valorPago: 5, dataOcorrencia: '2030-01-20' },
  ]);
  it('lê T e U e recusa o arquivo que não fecha', () => {
    const lido = lerRetornoCobranca240(arquivo, 987);
    if (retornoCobrancaRecusado(lido)) throw new Error(lido.mensagem);
    expect(lido.linhas).toHaveLength(6);
    expect(lido.sequencial).toBe(9);
    expect(lido.linhas[1]).toMatchObject({
      codigo: '06',
      valorPago: 102,
      encargos: 2,
      valorTarifa: 2.5,
      dataCredito: '2030-01-21',
    });
    expect(lido.linhas[4]?.motivos).toEqual([
      '46 Tipo ou número de inscrição do pagador inválidos',
      '08 Nosso número inválido',
    ]);
    expect((lerRetornoCobranca240(arquivo, 1) as { codigo: string }).codigo).toBe('banco-diferente');
    const curto = arquivo.split('\r\n');
    curto.splice(3, 1);
    expect((lerRetornoCobranca240(curto.join('\r\n'), 987) as { codigo: string }).codigo).toBe(
      'rodape-divergente',
    );
    expect(
      (lerRetornoCobranca240(arquivo.replace(/^(.{20})/, '$1X'), 987) as { codigo: string }).codigo,
    ).toBe('linha-tamanho');
    expect((lerRetornoCobranca240('', 987) as { codigo: string }).codigo).toBe('arquivo-vazio');
  });
  it('planeja: confirma, liquida (inteiro e a menor), não baixa de novo, rejeita e aponta o não localizado', () => {
    const lido = lerRetornoCobranca240(arquivo, 987);
    if (retornoCobrancaRecusado(lido)) throw new Error(lido.mensagem);
    const p = planejarRetornoCobranca(boletos, lido, 2);
    expect(p.itens.map((i) => i.situacao)).toEqual([
      'entrada_confirmada',
      'liquidado',
      'liquidado',
      'informativo',
      'rejeitado',
      'nao_localizado',
    ]);
    expect(p.itens[0]?.boletoNovo).toBe('registrado');
    expect(p.itens[1]?.baixa).toMatchObject({
      recebido: 102,
      principal: 100,
      encargos: 2,
      saldoRestante: 0,
      data: '2030-01-20',
      dataCredito: '2030-01-21',
    });
    expect(p.itens[2]?.baixa).toMatchObject({
      recebido: 30,
      principal: 30,
      saldoRestante: 20,
      dataCredito: '2030-01-22',
    });
    expect(p.itens[2]?.motivo).toContain('parcial');
    expect(p.itens[3]?.baixa).toBeNull();
    expect(p.itens[4]?.boletoNovo).toBe('rejeitado');
    expect(p.parcelasLiquidadas).toEqual([102, 30]);
    expect(p.totalLiquidado).toBe(132);
    expect(p.parcelasTarifa).toEqual([1.5, 2.5]);
    expect(p.totalTarifas).toBe(4);
    expect([p.liquidados, p.rejeitados, p.naoLocalizados]).toEqual([2, 1, 1]);
  });
});
