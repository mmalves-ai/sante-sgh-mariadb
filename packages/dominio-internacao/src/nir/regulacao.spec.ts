// M44 (etapa 3), regra 14: regulação estadual — número sempre registrável à mão; mudanças sobre a vigente; pedido novo
// depois de negada ou cancelada; a carga da outbox só com IDs e códigos; o simulador da central (DP-29). SINTÉTICO.
import { describe, expect, it } from 'vitest';
import {
  cargaDaRegulacao,
  contagemRegulacao,
  decidirRegulacao,
  respostaSimuladaDaCentral,
  resumoDeparaRegulacao,
  situacaoDoPedidoNaTela,
  situacaoDoPedidoPelaRegulacao,
  situacaoFinal,
} from './regulacao.js';
import { deparaVigente } from './maquina.js';

const vig = (situacao: 'solicitada' | 'autorizada' | 'negada' | 'concluida' | 'cancelada') => ({
  id: 9,
  numero: 'RJ-2026-0001',
  central: 'estadual' as const,
  situacao,
});

describe('regulação estadual', () => {
  it('o primeiro registro abre (solicitada, em análise ou autorizada); negada não abre', () => {
    expect(
      decidirRegulacao(null, { numero: 'RJ-2026-0001', central: 'estadual', situacao: 'solicitada' }),
    ).toEqual({
      ok: true,
      novoPedido: true,
    });
    expect(
      decidirRegulacao(null, { numero: 'RJ-2026-0001', central: 'estadual', situacao: 'negada' }),
    ).toMatchObject({
      ok: false,
      codigo: 'situacao-de-abertura',
    });
  });

  it('mudança de situação com o mesmo número; outro número ou central recusados; sem mudança recusada', () => {
    const v = vig('solicitada');
    expect(
      decidirRegulacao(v, { numero: 'RJ-2026-0001', central: 'estadual', situacao: 'autorizada' }),
    ).toEqual({
      ok: true,
      novoPedido: false,
    });
    expect(
      decidirRegulacao(v, { numero: 'RJ-2026-0002', central: 'estadual', situacao: 'autorizada' }),
    ).toMatchObject({
      codigo: 'numero-diferente',
    });
    expect(
      decidirRegulacao(v, { numero: 'RJ-2026-0001', central: 'municipal', situacao: 'autorizada' }),
    ).toMatchObject({ codigo: 'numero-diferente' });
    expect(
      decidirRegulacao(v, { numero: 'RJ-2026-0001', central: 'estadual', situacao: 'solicitada' }),
    ).toMatchObject({
      codigo: 'sem-mudanca',
    });
  });

  it('depois de negada ou cancelada, só um pedido novo com outro número; concluída não muda', () => {
    for (const s of ['negada', 'cancelada'] as const) {
      expect(
        decidirRegulacao(vig(s), { numero: 'RJ-2026-0001', central: 'estadual', situacao: 'solicitada' }),
      ).toMatchObject({ codigo: 'regulacao-encerrada' });
      expect(
        decidirRegulacao(vig(s), { numero: 'RJ-2026-0009', central: 'estadual', situacao: 'solicitada' }),
      ).toEqual({
        ok: true,
        novoPedido: true,
      });
      expect(
        decidirRegulacao(vig(s), { numero: 'RJ-2026-0009', central: 'estadual', situacao: 'concluida' }),
      ).toMatchObject({ codigo: 'situacao-de-abertura' });
    }
    expect(
      decidirRegulacao(vig('concluida'), { numero: 'X-0009', central: 'estadual', situacao: 'solicitada' }),
    ).toMatchObject({ codigo: 'regulacao-concluida' });
    expect(situacaoFinal('negada')).toBe(true);
    expect(situacaoFinal('autorizada')).toBe(false);
  });

  it('revisão do M44.3: o pedido novo não reaproveita número já usado na solicitação (A negada, B cancelada, A)', () => {
    const historico = [
      { numero: 'A-1', central: 'estadual' },
      { numero: 'A-1', central: 'estadual' },
      { numero: 'B-2', central: 'estadual' },
      { numero: 'B-2', central: 'estadual' },
    ];
    const vigenteB = { id: 4, numero: 'B-2', central: 'estadual' as const, situacao: 'cancelada' as const };
    expect(
      decidirRegulacao(vigenteB, { numero: 'A-1', central: 'estadual', situacao: 'solicitada' }, historico),
    ).toMatchObject({ ok: false, codigo: 'regulacao-encerrada' });
    // O mesmo número em outra central é outro pedido; um número nunca usado passa.
    expect(
      decidirRegulacao(vigenteB, { numero: 'A-1', central: 'municipal', situacao: 'solicitada' }, historico),
    ).toEqual({ ok: true, novoPedido: true });
    expect(
      decidirRegulacao(vigenteB, { numero: 'C-3', central: 'estadual', situacao: 'solicitada' }, historico),
    ).toEqual({ ok: true, novoPedido: true });
  });

  it('carga da outbox só com IDs e códigos; o simulador responde sem rede; contagens', () => {
    expect(cargaDaRegulacao({ regulacao: 5, solicitacao: 3, central: 'estadual', sentido: 'saida' })).toEqual(
      {
        regulacao: '5',
        solicitacao: '3',
        central: 'estadual',
        sentido: 'saida',
      },
    );
    expect(
      respostaSimuladaDaCentral({ numero: 'RJ-1', situacao: 'solicitada', prioridade: 'urgente' }),
    ).toEqual({
      numero: 'RJ-1',
      situacao: 'autorizada',
      mensagem: 'SIMULADOR:RJ-1:autorizada',
    });
    expect(
      respostaSimuladaDaCentral({ numero: 'RJ-1', situacao: 'solicitada', prioridade: 'eletivo' }).situacao,
    ).toBe('em_analise');
    expect(
      respostaSimuladaDaCentral({ numero: 'RJ-1', situacao: 'autorizada', prioridade: 'eletivo' }).situacao,
    ).toBe('concluida');
    const c = contagemRegulacao(['solicitada', null, 'solicitada', 'negada']);
    expect(c).toMatchObject({ 'sem-numero': 1, solicitada: 2, negada: 1, autorizada: 0 });
  });
});

describe('a regulação lida pelo de-para aprovado (C3-013)', () => {
  const proposta = deparaVigente([]);
  const aprovado = (situacao: number, estado: 'em_analise' | 'solicitado' | 'reservado') =>
    deparaVigente([{ situacao, estado, aprovadoPor: 'nir.sintetico', aprovadoEm: '2026-11-26T10:00:00Z' }]);

  it('autorizada no pedido em análise vira "Regulado"; solicitada ou em análise vira "Aguardando regulação"', () => {
    expect(situacaoDoPedidoPelaRegulacao('autorizada', 'em_analise', proposta)).toEqual({
      codigo: 10,
      rotulo: 'Regulado',
    });
    expect(situacaoDoPedidoPelaRegulacao('solicitada', 'em_analise', proposta)?.codigo).toBe(3);
    expect(situacaoDoPedidoPelaRegulacao('em_analise', 'em_analise', proposta)?.codigo).toBe(3);
  });

  it('a regulação nunca move o estado do pedido: outro estado ou situação final deixam o pedido como está', () => {
    expect(situacaoDoPedidoPelaRegulacao('autorizada', 'solicitado', proposta)).toBeNull();
    expect(situacaoDoPedidoPelaRegulacao('autorizada', 'reservado', proposta)).toBeNull();
    for (const s of ['negada', 'cancelada', 'concluida'] as const)
      expect(situacaoDoPedidoPelaRegulacao(s, 'em_analise', proposta)).toBeNull();
  });

  it('vale o de-para APROVADO pelo NIR: a linha reapontada para outro estado deixa de valer', () => {
    expect(situacaoDoPedidoPelaRegulacao('autorizada', 'em_analise', aprovado(10, 'reservado'))).toBeNull();
    expect(situacaoDoPedidoPelaRegulacao('autorizada', 'reservado', aprovado(10, 'reservado'))?.codigo).toBe(
      10,
    );
  });

  it('linha "a confirmar" não vale; o resumo conta as 6 a confirmar da proposta e a tela mostra a equivalente', () => {
    const semLinha10 = proposta.map((l) => (l.situacao === 10 ? { ...l, aConfirmar: true } : l));
    expect(situacaoDoPedidoPelaRegulacao('autorizada', 'em_analise', semLinha10)).toBeNull();
    expect(resumoDeparaRegulacao(proposta)).toEqual({ completo: true, aConfirmar: 6 });
    expect(resumoDeparaRegulacao([])).toEqual({ completo: false, aConfirmar: 0 });
    expect(situacaoDoPedidoNaTela('em_analise', proposta)).toMatchObject({ codigo: 1, aConfirmar: false });
    expect(situacaoDoPedidoNaTela('inexistente', proposta)).toBeNull();
  });
});
