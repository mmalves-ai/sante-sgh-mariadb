// F3.8, 07-FIN linha 66: o retorno do banco diante da remessa, os dados bancários do credor e a remessa por Pix.
import { describe, expect, it } from 'vitest';
import {
  conferirContaCredor,
  type ContaCredorEntrada,
  gerarCnab240Pix,
  mascararDadoBancario,
  montarRetornoCnab240,
  type ParcelaEnviada,
  planejarRetorno,
  remessaPixRecusada,
} from './pagamento-eletronico.js';
import { lerRetornoCnab240, retornoRecusado, type RetornoLido } from './retorno-pagamento.js';

const HOJE = '2026-11-24';
const ler = (conteudo: string): RetornoLido => {
  const r = lerRetornoCnab240(conteudo, 1);
  if (retornoRecusado(r)) throw new Error(r.mensagem);
  return r;
};
const enviada = (parcela: number, saldo: number, vinculo: ParcelaEnviada['vinculo'] = 'pendente') => ({
  parcela,
  vinculo,
  valorEnviado: saldo || 100,
  saldo,
});

describe('retorno do banco diante da remessa', () => {
  it('baixa o pago, devolve o rejeitado à fila, mantém o agendado e registra o que não é da remessa', () => {
    const lido = ler(
      montarRetornoCnab240(1, 7, [
        { titulo: 10, valor: 100, ocorrencias: ['00'], dataPagamento: '2026-11-20', valorPago: 100 },
        { titulo: 11, valor: 50, ocorrencias: ['AG'] },
        { titulo: 12, valor: 70, ocorrencias: ['BD'], dataPagamento: '2026-11-30' },
        { titulo: 99, valor: 30, ocorrencias: ['00'], dataPagamento: '2026-11-20', valorPago: 30 },
      ]),
    );
    const p = planejarRetorno([enviada(10, 100), enviada(11, 50), enviada(12, 70)], lido, HOJE);
    expect(p.itens.map((i) => i.situacao)).toEqual(['liquidado', 'rejeitado', 'agendado', 'nao_localizado']);
    expect(p.itens[0]?.baixa).toEqual({ principal: 100, acrescimo: 0, saldoRestante: 0 });
    expect(p.itens[0]?.dataPagamento).toBe('2026-11-20');
    expect(p.itens[1]).toMatchObject({ vinculoNovo: 'rejeitada', codigo: 'AG', baixa: null });
    expect(p.itens[2]).toMatchObject({ vinculoNovo: null, baixa: null });
    expect(p.itens[3]).toMatchObject({ vinculoNovo: null, baixa: null, valorEnviado: null });
    expect(p).toMatchObject({
      baixados: 1,
      rejeitados: 1,
      agendados: 1,
      naoLocalizados: 1,
      totalBaixado: 100,
      pendentes: 1,
      situacaoRemessa: 'aceita',
    });
  });

  it('pago a menor deixa saldo; pago a maior quita e leva a diferença como acréscimo; sem data vale a de hoje', () => {
    const lido = ler(
      montarRetornoCnab240(1, 8, [
        { titulo: 20, valor: 100, ocorrencias: ['00'], dataPagamento: '2026-11-21', valorPago: 60 },
        { titulo: 21, valor: 100, ocorrencias: ['00'], valorPago: 103.5 },
      ]),
    );
    const p = planejarRetorno([enviada(20, 100), enviada(21, 100)], lido, HOJE);
    expect(p.itens[0]?.baixa).toEqual({ principal: 60, acrescimo: 0, saldoRestante: 40 });
    expect(p.itens[1]?.baixa).toEqual({ principal: 100, acrescimo: 3.5, saldoRestante: 0 });
    expect(p.itens[1]?.dataPagamento).toBe(HOJE);
    expect(p.totalBaixado).toBe(163.5);
    expect(p.situacaoRemessa).toBe('processada');
  });

  it('nunca baixa duas vezes: parcela já respondida ou já quitada vira informativo', () => {
    const lido = ler(
      montarRetornoCnab240(1, 9, [
        { titulo: 30, valor: 100, ocorrencias: ['00'], dataPagamento: '2026-11-21', valorPago: 100 },
        { titulo: 31, valor: 80, ocorrencias: ['00'], dataPagamento: '2026-11-21', valorPago: 80 },
      ]),
    );
    const p = planejarRetorno([enviada(30, 0, 'retornada'), enviada(31, 0)], lido, HOJE);
    expect(p.itens.map((i) => i.situacao)).toEqual(['informativo', 'informativo']);
    expect(p.itens.every((i) => i.baixa === null)).toBe(true);
    // A já respondida não muda; a quitada por outra via fica respondida para não travar a remessa.
    expect(p.itens.map((i) => i.vinculoNovo)).toEqual([null, 'retornada']);
    expect(p).toMatchObject({ baixados: 0, totalBaixado: 0, pendentes: 0, situacaoRemessa: 'processada' });
  });

  it('tudo rejeitado deixa a remessa rejeitada', () => {
    const lido = ler(montarRetornoCnab240(1, 10, [{ titulo: 40, valor: 10, ocorrencias: ['PA'] }]));
    const p = planejarRetorno([enviada(40, 10)], lido, HOJE);
    expect(p.itens[0]?.motivo).toBe('Chave Pix não encontrada');
    expect(p.situacaoRemessa).toBe('rejeitada');
  });
});

describe('dados bancários e chave Pix do credor', () => {
  const base: ContaCredorEntrada = {
    titularNome: 'Fornecedor Sintético',
    titularDocumento: '11.222.333/0001-81',
    tipoConta: 'corrente',
    banco: 1,
    agencia: '1234',
    digitoAgencia: 'x',
    conta: '56.789',
    digitoConta: '0',
    tipoChavePix: null,
    chavePix: '',
  };
  it('grava a forma canônica da conta e da chave', () => {
    const r = conferirContaCredor({ ...base, tipoChavePix: 'email', chavePix: ' Financeiro@Exemplo.COM ' });
    expect(r).toEqual({
      titularNome: 'Fornecedor Sintético',
      titularDocumento: '11222333000181',
      tipoConta: 'corrente',
      banco: 1,
      agencia: '1234',
      digitoAgencia: 'X',
      conta: '56789',
      digitoConta: '0',
      tipoChavePix: 'email',
      chavePix: 'financeiro@exemplo.com',
    });
  });
  it('aceita só a chave Pix, sem conta em banco', () => {
    const r = conferirContaCredor({
      ...base,
      banco: null,
      agencia: '',
      conta: '',
      digitoAgencia: '',
      digitoConta: '',
      tipoChavePix: 'cnpj',
      chavePix: '11222333000181',
    });
    expect(r).toMatchObject({ banco: null, agencia: null, conta: null, chavePix: '11222333000181' });
  });
  it('recusa na hora o que não fecha', () => {
    const codigo = (e: Partial<ContaCredorEntrada>) => {
      const r = conferirContaCredor({ ...base, ...e });
      return 'codigo' in r ? r.codigo : 'ok';
    };
    expect(codigo({ titularDocumento: '11222333000100' })).toBe('documento-invalido');
    expect(codigo({ conta: '' })).toBe('conta-incompleta');
    expect(codigo({ banco: null, agencia: '', conta: '' })).toBe('sem-destino');
    expect(codigo({ digitoConta: 'AB' })).toBe('digito-invalido');
    expect(codigo({ chavePix: 'a@b.com' })).toBe('chave-pix-invalida');
    expect(codigo({ tipoChavePix: 'telefone', chavePix: '123' })).toBe('chave-pix-invalida');
    // Chave de documento que não é o do titular: desvio de pagamento.
    expect(codigo({ tipoChavePix: 'cpf', chavePix: '529.982.247-25' })).toBe('chave-pix-de-outro-titular');
    expect(codigo({ titularNome: ' ' })).toBe('titular-invalido');
  });
  it('a lista mostra só o fim do dado', () => {
    expect(mascararDadoBancario('financeiro@exemplo.com')).toBe('••••.com');
    expect(mascararDadoBancario('123')).toBe('••••');
    expect(mascararDadoBancario(null)).toBeNull();
  });
});

describe('remessa de pagamento por Pix', () => {
  const titulo = {
    titulo: 501,
    valor: 1234.56,
    dataPagamento: '2026-11-25',
    favorecido: 'Fornecedor Sintético',
    documento: '11222333000181',
    tipoChavePix: 'email' as const,
    chavePix: 'financeiro@exemplo.com',
  };
  it('gera o lote Pix com os segmentos A e B, linhas de 240 posições e o rodapé fechando', () => {
    const r = gerarCnab240Pix(1, { agencia: 1234, numero: 56789 }, 3, [
      titulo,
      { ...titulo, titulo: 502, valor: 10, tipoChavePix: 'cnpj', chavePix: '11222333000181' },
    ]);
    if (remessaPixRecusada(r)) throw new Error(r.mensagem);
    const linhas = r.conteudo.split('\r\n').filter((l) => l.length > 0);
    expect(linhas).toHaveLength(8);
    expect(r.linhas).toBe(8);
    expect(linhas.every((l) => l.length === 240)).toBe(true);
    expect(r.total).toBe(1244.56);
    const [arquivo, lote, a1, b1, , b2, rodapeLote, rodape] = linhas as string[];
    expect(arquivo!.slice(142, 143)).toBe('1');
    expect(arquivo!.slice(157, 163)).toBe('000003');
    expect(lote!.slice(11, 13)).toBe('45');
    expect(a1!.slice(13, 14)).toBe('A');
    expect(a1!.slice(17, 20)).toBe('009');
    expect(Number(a1!.slice(73, 93))).toBe(501);
    expect(a1!.slice(93, 101)).toBe('25112026');
    expect(a1!.slice(119, 134)).toBe('000000000123456');
    expect(b1!.slice(13, 17)).toBe('B02 ');
    expect(b1!.slice(127, 226).trim()).toBe('financeiro@exemplo.com');
    expect(b2!.slice(14, 16)).toBe('03');
    expect(b2!.slice(18, 32)).toBe('11222333000181');
    expect(b2!.slice(127, 226).trim()).toBe('');
    expect(Number(rodapeLote!.slice(23, 41))).toBe(124456);
    expect(Number(rodape!.slice(23, 29))).toBe(8);
  });
  it('recusa a remessa inteira quando um credor não tem chave válida ou o título repete', () => {
    const semChave = gerarCnab240Pix(1, { agencia: 1, numero: 2 }, 1, [
      titulo,
      { ...titulo, titulo: 503, tipoChavePix: null, chavePix: null },
      { ...titulo, titulo: 504, tipoChavePix: 'telefone', chavePix: '12' },
    ]);
    expect(semChave).toMatchObject({ codigo: 'credor-sem-chave-pix' });
    expect('mensagem' in semChave ? semChave.mensagem : '').toContain('503, 504');
    expect(gerarCnab240Pix(1, { agencia: 1, numero: 2 }, 1, [titulo, titulo])).toMatchObject({
      codigo: 'titulo-invalido',
    });
    expect(gerarCnab240Pix(1, { agencia: 1, numero: 2 }, 1, [])).toMatchObject({ codigo: 'remessa-vazia' });
  });
  it('o retorno do simulador é lido pela leitura do retorno do banco', () => {
    const lido = ler(
      montarRetornoCnab240(1, 4, [
        { titulo: 501, valor: 1234.56, ocorrencias: ['00'], dataPagamento: '2026-11-25', valorPago: 1234.56 },
        { titulo: 502, valor: 10, ocorrencias: ['PB', 'AG'] },
      ]),
    );
    expect(lido.sequencial).toBe(4);
    expect(lido.titulos.map((t) => [t.titulo, t.desfecho, t.valorPago])).toEqual([
      [501, 'pago', 1234.56],
      [502, 'rejeitado', 10],
    ]);
    expect(lido.titulos[1]?.ocorrencias).toEqual(['PB', 'AG']);
    expect(lido.totalPago).toBe(1234.56);
  });
});
