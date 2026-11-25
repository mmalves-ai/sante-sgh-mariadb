// Regras da cobrança Pix sobre o título a receber (07-FIN linha 90). Massa sintética.
import { describe, expect, it } from 'vitest';
import {
  brCodeConfere,
  cobrancaExpirada,
  conferirCobrancaPix,
  crc16Pix,
  gerarTxid,
  lerNotificacaoPix,
  montarBrCodePix,
  planejarBaixaPix,
  planejarDevolucaoPix,
  txidValido,
} from './cobranca-pix.js';

const E2E = 'E12345678202611251030abcdefGHIJK';
const TXID = 'abcdefghijABCDEFGHIJ0123456789AB';
const base = {
  modalidade: 'imediata' as const,
  valor: 100,
  saldoParcela: 150,
  situacaoParcela: 'aberta',
  hoje: '2026-11-25',
  cobrancaAtivaNaParcela: false,
  chaveAtiva: true,
};

describe('txid e BR Code', () => {
  it('gera txid de 32 alfanuméricos e confere o formato da API Pix', () => {
    const t = gerarTxid(new Uint8Array(32).map((_, i) => i * 7));
    expect(t).toHaveLength(32);
    expect(txidValido(t)).toBe(true);
    expect(txidValido('curto')).toBe(false);
    expect(txidValido(`${TXID}-`)).toBe(false);
  });
  it('CRC16-CCITT confere com o valor de referência', () => {
    expect(crc16Pix('123456789')).toBe('29B1');
  });
  it('monta o BR Code dinâmico e o estático com CRC que fecha', () => {
    const din = montarBrCodePix({
      localizacao: 'psp.exemplo/qr/v2/abc',
      valor: 10.5,
      nomeRecebedor: 'Hospital São José',
      cidade: 'Goiânia',
    });
    expect(din.startsWith('000201010212')).toBe(true);
    expect(din).toContain('5405' + '10.50');
    expect(din).toContain('HOSPITAL SAO JOSE');
    expect(brCodeConfere(din)).toBe(true);
    const est = montarBrCodePix({ chave: '+5562999990000', nomeRecebedor: 'X', cidade: 'Y', txid: 'T1' });
    expect(est).toContain('0114+5562999990000');
    expect(brCodeConfere(est)).toBe(true);
    expect(brCodeConfere(`${est.slice(0, -1)}0`)).toBe(est.endsWith('0'));
  });
});

describe('conferência da emissão', () => {
  it('aceita a cobrança imediata dentro do saldo', () => {
    expect(conferirCobrancaPix(base)).toEqual({ ok: true });
  });
  it.each([
    [{ situacaoParcela: 'recebida' }, 'parcela-sem-saldo'],
    [{ cobrancaAtivaNaParcela: true }, 'cobranca-ativa'],
    [{ chaveAtiva: false }, 'chave-inativa'],
    [{ valor: 0 }, 'valor-invalido'],
    [{ valor: 150.01 }, 'valor-acima-saldo'],
    [{ validadeSegundos: 30 }, 'validade-invalida'],
    [
      { modalidade: 'com_vencimento', vencimento: '2026-11-24', pagadorDocumento: '52998224725' },
      'vencimento-invalido',
    ],
    [
      { modalidade: 'com_vencimento', vencimento: '2026-12-01', pagadorDocumento: null },
      'pagador-sem-documento',
    ],
  ] as const)('recusa %o com %s', (mudanca, codigo) => {
    const r = conferirCobrancaPix({ ...base, ...mudanca });
    expect(r.ok ? 'ok' : r.codigo).toBe(codigo);
  });
  it('aceita a cobrança com vencimento com documento do pagador', () => {
    const r = conferirCobrancaPix({
      ...base,
      modalidade: 'com_vencimento',
      vencimento: '2026-12-01',
      pagadorDocumento: '529.982.247-25',
    });
    expect(r.ok).toBe(true);
  });
  it('a imediata expira depois da validade', () => {
    const c = {
      situacao: 'ativa',
      modalidade: 'imediata' as const,
      criadaEm: new Date('2026-11-25T10:00:00Z'),
      validadeSegundos: 3600,
    };
    expect(cobrancaExpirada(c, new Date('2026-11-25T10:59:00Z'))).toBe(false);
    expect(cobrancaExpirada(c, new Date('2026-11-25T11:01:00Z'))).toBe(true);
    expect(cobrancaExpirada({ ...c, modalidade: 'com_vencimento' }, new Date('2027-01-01'))).toBe(false);
  });
});

describe('notificação do prestador', () => {
  const pix = {
    endToEndId: E2E,
    txid: TXID,
    valor: '100.00',
    horario: '2026-11-25T10:30:00Z',
    pagador: { cpf: '52998224725', nome: 'PAGADOR' },
  };
  it('lê a lista, normaliza e ignora a repetição dentro do mesmo corpo', () => {
    const r = lerNotificacaoPix({ pix: [pix, pix] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pix).toHaveLength(1);
    expect(r.pix[0]).toMatchObject({
      fimAFim: E2E,
      valor: 100,
      pagadorCpf: '52998224725',
      pagadorCnpj: null,
    });
  });
  it.each([
    [{}, 'lista'],
    [{ pix: [{ ...pix, endToEndId: 'X1' }] }, 'fim a fim'],
    [{ pix: [{ ...pix, txid: 'x' }] }, 'txid'],
    [{ pix: [{ ...pix, valor: '10' }] }, 'valor'],
    [{ pix: [{ ...pix, horario: 'ontem' }] }, 'horário'],
  ])('recusa inteira a notificação inválida (%#)', (corpo, trecho) => {
    const r = lerNotificacaoPix(corpo);
    expect(r.ok ? '' : r.mensagem).toContain(trecho);
  });
});

describe('baixa automática', () => {
  const e = {
    fimAFimJaRegistrado: false,
    situacaoCobranca: 'ativa',
    fimAFimDaCobranca: null,
    valorPago: 100,
    saldoParcela: 100,
    situacaoParcela: 'aberta',
  };
  it('quita a parcela pelo saldo', () => {
    expect(planejarBaixaPix(e)).toMatchObject({
      acao: 'registrar',
      principal: 100,
      excedente: 0,
      quitada: true,
      situacaoRetorno: 'baixado',
      concluiCobranca: true,
    });
  });
  it('o mesmo Pix não baixa duas vezes', () => {
    expect(planejarBaixaPix({ ...e, fimAFimJaRegistrado: true })).toEqual({ acao: 'repetido' });
  });
  it('pago acima do saldo: baixa o saldo e guarda o excedente', () => {
    expect(planejarBaixaPix({ ...e, saldoParcela: 60, situacaoParcela: 'parcial' })).toMatchObject({
      principal: 60,
      excedente: 40,
      saldoRestante: 0,
      quitada: true,
    });
  });
  it('pago a menor deixa saldo', () => {
    expect(planejarBaixaPix({ ...e, valorPago: 30 })).toMatchObject({
      principal: 30,
      saldoRestante: 70,
      quitada: false,
    });
  });
  it('segundo pagamento da mesma cobrança fica todo para devolução', () => {
    const r = planejarBaixaPix({ ...e, situacaoCobranca: 'concluida', fimAFimDaCobranca: 'E1' });
    expect(r).toMatchObject({
      principal: 0,
      excedente: 100,
      situacaoRetorno: 'recebido',
      concluiCobranca: false,
    });
  });
  it('parcela já quitada por outro meio: nada baixa', () => {
    expect(planejarBaixaPix({ ...e, saldoParcela: 0, situacaoParcela: 'recebida' })).toMatchObject({
      principal: 0,
      excedente: 100,
    });
  });
});

describe('devolução', () => {
  const d = {
    valorPago: 100,
    principalAtual: 60,
    jaDevolvido: 0,
    pedido: 30,
    pagoEm: '2026-11-20T10:00:00Z',
    hoje: '2026-11-25',
  };
  it('consome primeiro o excedente', () => {
    expect(planejarDevolucaoPix(d)).toMatchObject({
      ok: true,
      doExcedente: 30,
      reverteBaixa: 0,
      principalRestante: 60,
      total: false,
    });
  });
  it('depois desfaz a baixa pelo que passar do excedente', () => {
    expect(planejarDevolucaoPix({ ...d, jaDevolvido: 30, pedido: 50 })).toMatchObject({
      ok: true,
      doExcedente: 10,
      reverteBaixa: 40,
      principalRestante: 20,
      devolvidoTotal: 80,
    });
    expect(planejarDevolucaoPix({ ...d, pedido: 100 })).toMatchObject({
      doExcedente: 40,
      reverteBaixa: 60,
      principalRestante: 0,
      total: true,
    });
  });
  it('recusa acima do disponível, valor nulo e fora do prazo de 90 dias', () => {
    const c = (x: Partial<typeof d>) => {
      const r = planejarDevolucaoPix({ ...d, ...x });
      return r.ok ? 'ok' : r.codigo;
    };
    expect(c({ jaDevolvido: 90, pedido: 20 })).toBe('valor-acima-disponivel');
    expect(c({ pedido: 0 })).toBe('valor-invalido');
    expect(c({ hoje: '2027-03-01' })).toBe('prazo-devolucao');
  });
});
