// F3.8, 07-FIN linha 67: regras do adiantamento (conceder, compensar no título do mesmo credor, devolver o saldo).
import { describe, expect, it } from 'vitest';
import {
  aposUso,
  conferirCompensacao,
  conferirConcessao,
  conferirDevolucao,
  conferirPedidoEmAberto,
  conferirSaida,
  credorDoTitulo,
  parcelaAposCompensacao,
  tipoAlcadaDoAdiantamento,
} from './adiantamento.js';

const forn = { tipo: 'fornecedor' as const, id: 7 };
const ad = { credor: forn, saldo: 600, situacao: 'compensado_parcial' };

describe('conceder', () => {
  it('aceita valor, finalidade e prazo depois da data', () => {
    expect(
      conferirConcessao({ valor: 1000, referente: 'Viagem', data: '2026-11-01', prazo: '2026-12-01' }),
    ).toBeNull();
  });
  it('recusa valor zero, finalidade vazia e prazo anterior', () => {
    expect(conferirConcessao({ valor: 0, referente: 'x', data: '2026-11-01', prazo: null })?.codigo).toBe(
      'valor-obrigatorio',
    );
    expect(conferirConcessao({ valor: 10, referente: ' ', data: '2026-11-01', prazo: null })?.codigo).toBe(
      'finalidade-obrigatoria',
    );
    expect(
      conferirConcessao({ valor: 10, referente: 'x', data: '2026-11-01', prazo: '2026-10-01' })?.codigo,
    ).toBe('prazo-invalido');
  });
});

describe('compensar', () => {
  it('aceita o mesmo credor dentro dos dois saldos', () => {
    expect(conferirCompensacao(ad, { credor: forn, saldo: 500 }, 500)).toBeNull();
  });
  it('recusa outro credor, mesmo id de outro tipo, acima do saldo e acima da parcela', () => {
    expect(conferirCompensacao(ad, { credor: { tipo: 'fornecedor', id: 8 }, saldo: 500 }, 10)?.codigo).toBe(
      'credor-diferente',
    );
    expect(conferirCompensacao(ad, { credor: { tipo: 'profissional', id: 7 }, saldo: 500 }, 10)?.codigo).toBe(
      'credor-diferente',
    );
    expect(conferirCompensacao(ad, { credor: forn, saldo: 900 }, 600.01)?.codigo).toBe('acima-do-saldo');
    expect(conferirCompensacao(ad, { credor: forn, saldo: 100 }, 100.01)?.codigo).toBe('acima-da-parcela');
    expect(conferirCompensacao(ad, { credor: forn, saldo: 100 }, 0)?.codigo).toBe('valor-obrigatorio');
  });
  it('recusa adiantamento já compensado ou cancelado', () => {
    expect(
      conferirCompensacao({ ...ad, situacao: 'compensado' }, { credor: forn, saldo: 1 }, 1)?.codigo,
    ).toBe('adiantamento-sem-saldo');
  });
});

describe('devolver e situação', () => {
  it('devolução exige motivo e respeita o saldo', () => {
    expect(conferirDevolucao(ad, 600, 'Sobra da viagem')).toBeNull();
    expect(conferirDevolucao(ad, 600, '')?.codigo).toBe('motivo-obrigatorio');
    expect(conferirDevolucao(ad, 601, 'x')?.codigo).toBe('acima-do-saldo');
  });
  it('a situação deriva do saldo depois do uso', () => {
    expect(aposUso(1000, 1000, 400)).toEqual({ saldo: 600, situacao: 'compensado_parcial' });
    expect(aposUso(1000, 600, 600)).toEqual({ saldo: 0, situacao: 'compensado' });
    expect(parcelaAposCompensacao(500, 200)).toEqual({ saldo: 300, situacao: 'parcial' });
    expect(parcelaAposCompensacao(500, 500)).toEqual({ saldo: 0, situacao: 'paga' });
  });
});

describe('dois olhos antes da saída (pedido, aprovação na alçada, pagamento)', () => {
  it('só o pedido em aberto é aprovado; só o aprovado sai da conta', () => {
    expect(conferirPedidoEmAberto('aberto')).toBeNull();
    expect(conferirPedidoEmAberto('aprovado')?.codigo).toBe('adiantamento-ja-aprovado');
    expect(conferirSaida('aberto')?.codigo).toBe('sem-aprovacao');
    expect(conferirSaida('aprovado')).toBeNull();
    expect(conferirSaida('pago')?.codigo).toBe('adiantamento-ja-pago');
  });
  it('a faixa da alçada é a do tipo de credor do título (fornecedor F, médico M)', () => {
    expect(tipoAlcadaDoAdiantamento('fornecedor')).toBe('F');
    expect(tipoAlcadaDoAdiantamento('profissional')).toBe('M');
  });
});

describe('credor do título pelo par (tipo, id)', () => {
  it('não colapsa ids de cadastros diferentes', () => {
    expect(credorDoTitulo({ profissional: 7, fornecedor: null, outro: null })).toEqual({
      tipo: 'profissional',
      id: 7,
    });
    expect(credorDoTitulo({ profissional: null, fornecedor: 7, outro: null })).toEqual(forn);
    expect(credorDoTitulo({ profissional: null, fornecedor: null, outro: 7 })).toEqual({
      tipo: 'outro',
      id: 7,
    });
  });
  it('recusa compensar título de outro tipo de credor com o mesmo id', () => {
    for (const tipo of ['profissional', 'outro'] as const)
      expect(conferirCompensacao(ad, { credor: { tipo, id: 7 }, saldo: 100 }, 50)?.codigo).toBe(
        'credor-diferente',
      );
  });
});
