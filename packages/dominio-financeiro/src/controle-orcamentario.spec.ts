// Controle orçamentário na compra e no pagamento (C2-112, 07-FIN linha 130): regra aplicável, saldo do período,
// conferência (registrar, alertar, bloquear com exceção), exceção com segregação e o efeito da nota na reserva.
import { describe, expect, it } from 'vitest';
import {
  abertoDaReserva,
  type AlvoControle,
  conferirAjusteDaNota,
  conferirSaldo,
  efeitoDaNota,
  mesesDoPeriodo,
  orcadoNoPeriodo,
  type RegraControle,
  type RegraProposta,
  regraAplicavel,
  saldoOrcamentario,
  validarDecisaoExcecao,
  validarExcecaoOrcamentaria,
  validarLiberacaoReserva,
  validarRegraControle,
} from './controle-orcamentario.js';

const regra = (x: Partial<RegraControle> & { id: number }): RegraControle => ({
  acao: 'alertar',
  tipoDocumento: 'todos',
  planoOrcamentario: null,
  versaoOrcamento: null,
  centroCusto: null,
  contaOrcamentaria: null,
  naturezaFinanceira: null,
  tolerancia: 0,
  periodo: 'mensal',
  prioridade: 100,
  vigenciaInicio: '2027-01-01',
  vigenciaFim: null,
  ativo: true,
  ...x,
});
const alvo: AlvoControle = {
  tipoDocumento: 'pedido_compra',
  planoOrcamentario: 1,
  versaoOrcamento: 7,
  centroCusto: 10,
  contaOrcamentaria: 20,
  naturezaFinanceira: 30,
  data: '2027-03-15',
};
const saldo = (orcado: number, disponivel: number) => ({
  orcado,
  comprometido: 0,
  realizado: orcado - disponivel,
  disponivel,
});

describe('regra de controle', () => {
  it('vale a de menor prioridade e, no empate, a mais específica; fora da vigência ou inativa não vale', () => {
    const geral = regra({ id: 1 });
    const centro = regra({ id: 2, centroCusto: 10, acao: 'bloquear' });
    const outroCentro = regra({ id: 3, centroCusto: 11, acao: 'conferir', prioridade: 1 });
    expect(regraAplicavel([geral, centro, outroCentro], alvo)?.id).toBe(2);
    const prioritaria = regra({ id: 4, prioridade: 5, acao: 'conferir' });
    expect(regraAplicavel([geral, centro, prioritaria], alvo)?.id).toBe(4);
    const vencida = regra({ id: 5, prioridade: 1, vigenciaFim: '2027-02-28' });
    const inativa = regra({ id: 6, prioridade: 1, ativo: false });
    const titulo = regra({ id: 7, prioridade: 1, tipoDocumento: 'titulo_pagar' });
    expect(regraAplicavel([geral, vencida, inativa, titulo], alvo)?.id).toBe(1);
    expect(regraAplicavel([], alvo)).toBeNull();
  });

  it('valida tolerância, prioridade, vigência e a dispensa só com recorte', () => {
    const ok: RegraProposta = { ...regra({ id: 0 }) };
    expect(validarRegraControle(ok)).toEqual([]);
    const campos = (r: Partial<RegraProposta>) => validarRegraControle({ ...ok, ...r }).map((p) => p.campo);
    expect(campos({ tolerancia: 101 })).toEqual(['tolerancia']);
    expect(campos({ prioridade: 0 })).toEqual(['prioridade']);
    expect(campos({ vigenciaFim: '2026-12-31' })).toEqual(['vigenciaFim']);
    expect(campos({ acao: 'nao_controlar' })).toEqual(['acao']);
    expect(campos({ acao: 'nao_controlar', centroCusto: 3 })).toEqual([]);
  });
});

describe('saldo do período', () => {
  it('soma os meses do período', () => {
    expect(mesesDoPeriodo('2027-05-01', 'mensal')).toEqual([5]);
    expect(mesesDoPeriodo('2027-05-01', 'trimestral')).toEqual([4, 5, 6]);
    expect(mesesDoPeriodo('2027-03-01', 'acumulado')).toEqual([1, 2, 3]);
    expect(mesesDoPeriodo('2027-03-01', 'anual')).toHaveLength(12);
    const meses = Array.from({ length: 12 }, (_, i) => (i + 1) * 100);
    expect(orcadoNoPeriodo(meses, '2027-05-01', 'trimestral')).toBe(1500);
  });

  it('orçado − comprometido em aberto − realizado (consumido e ajuste a maior)', () => {
    const s = saldoOrcamentario(
      1000,
      [
        { reservado: 300, consumido: 100, liberado: 0, situacao: 'parcial' },
        { reservado: 200, consumido: 150, liberado: 50, situacao: 'consumida' },
        { reservado: 400, consumido: 0, liberado: 400, situacao: 'liberada' },
        { reservado: 90, consumido: 0, liberado: 0, situacao: 'cancelada' },
      ],
      [20, -50],
    );
    expect(s).toEqual({ orcado: 1000, comprometido: 200, realizado: 270, disponivel: 530 });
    expect(abertoDaReserva({ reservado: 300, consumido: 100, liberado: 0, situacao: 'parcial' })).toBe(200);
  });
});

describe('conferência do saldo', () => {
  const base = { tolerancia: 0, saldo: saldo(1000, 400), ciente: false, excecaoAprovada: null };
  it('cabe no saldo ou na tolerância: livre, sem marcar excesso', () => {
    expect(conferirSaldo({ ...base, acao: 'bloquear', valor: 400 })).toMatchObject({
      decisao: 'livre',
      excedeuSaldo: false,
    });
    expect(conferirSaldo({ ...base, acao: 'bloquear', tolerancia: 5, valor: 450 }).decisao).toBe('livre');
  });

  it('conferir registra o excesso; alertar pede ciência; dispensa não controla', () => {
    expect(conferirSaldo({ ...base, acao: 'conferir', valor: 500 })).toMatchObject({
      decisao: 'registrado',
      excesso: 100,
      excedeuSaldo: true,
      autorizacao: 'sessao',
      problemas: [],
    });
    const semCiencia = conferirSaldo({ ...base, acao: 'alertar', valor: 500 });
    expect(semCiencia.problemas.map((p) => p.campo)).toEqual(['ciente']);
    expect(conferirSaldo({ ...base, acao: 'alertar', valor: 500, ciente: true })).toMatchObject({
      decisao: 'alerta',
      autorizacao: 'sessao',
      problemas: [],
    });
    expect(conferirSaldo({ ...base, acao: 'nao_controlar', valor: 5000 })).toMatchObject({
      decisao: 'sem_controle',
      excedeuSaldo: false,
    });
  });

  it('bloquear só passa com exceção aprovada que cubra o excesso', () => {
    expect(conferirSaldo({ ...base, acao: 'bloquear', valor: 500 }).problemas.map((p) => p.campo)).toEqual([
      'excecao',
    ]);
    expect(conferirSaldo({ ...base, acao: 'bloquear', valor: 500, excecaoAprovada: 50 }).decisao).toBe(
      'bloqueio',
    );
    expect(conferirSaldo({ ...base, acao: 'bloquear', valor: 500, excecaoAprovada: 100 })).toMatchObject({
      decisao: 'excecao',
      autorizacao: 'excecao',
      excedeuSaldo: true,
      problemas: [],
    });
    expect(conferirSaldo({ ...base, acao: 'conferir', valor: 0 }).problemas[0]?.campo).toBe('valor');
  });
});

describe('exceção orçamentária', () => {
  it('justificativa e valor; decisão por outra pessoa; reprovação com parecer', () => {
    expect(validarExcecaoOrcamentaria({ valor: 10, justificativa: 'curta' }).map((p) => p.campo)).toEqual([
      'justificativa',
    ]);
    expect(
      validarExcecaoOrcamentaria({ valor: 10, justificativa: 'Reposição urgente de material da UTI' }),
    ).toEqual([]);
    const d = { situacao: 'pendente' as const, solicitante: 1, aprovador: 2, aprovar: true, parecer: null };
    expect(validarDecisaoExcecao(d)).toEqual([]);
    expect(validarDecisaoExcecao({ ...d, aprovador: 1 }).map((p) => p.campo)).toEqual(['aprovador']);
    expect(validarDecisaoExcecao({ ...d, aprovar: false }).map((p) => p.campo)).toEqual(['parecer']);
    expect(validarDecisaoExcecao({ ...d, situacao: 'aprovada' }).map((p) => p.campo)).toEqual(['situacao']);
  });
});

describe('nota na reserva', () => {
  const r = { reservado: 1000, consumido: 0, liberado: 0, situacao: 'ativa' as const };
  it('parcial consome o que veio; final consome, libera a sobra e lança o ajuste', () => {
    expect(efeitoDaNota({ reserva: r, realizado: 300, final: false })).toMatchObject({
      consumir: 300,
      liberar: 0,
      ajuste: 0,
      situacao: 'parcial',
    });
    expect(efeitoDaNota({ reserva: r, realizado: 1000, final: false }).problemas[0]?.campo).toBe('final');
    const parcial = { ...r, consumido: 300, situacao: 'parcial' as const };
    expect(efeitoDaNota({ reserva: parcial, realizado: 650, final: true })).toMatchObject({
      consumir: 650,
      liberar: 50,
      ajuste: -50,
      comprometido: 700,
      situacao: 'consumida',
    });
    expect(efeitoDaNota({ reserva: parcial, realizado: 760, final: true })).toMatchObject({
      consumir: 700,
      liberar: 0,
      ajuste: 60,
    });
    expect(
      efeitoDaNota({ reserva: { ...r, situacao: 'consumida' }, realizado: 10, final: true }).problemas[0]
        ?.campo,
    ).toBe('reserva');
  });

  it('libera só a reserva em aberto e com motivo', () => {
    expect(validarLiberacaoReserva(r, 'Pedido cancelado')).toEqual([]);
    expect(validarLiberacaoReserva({ ...r, situacao: 'liberada' }, 'x').map((p) => p.campo)).toEqual([
      'reserva',
      'motivo',
    ]);
  });
});

describe('nota final acima da reserva (o ajuste segue a regra)', () => {
  const saldo = { orcado: 1000, comprometido: 1000, realizado: 300, disponivel: -300 };
  const base = { tolerancia: 0, saldo, ajuste: 50, ciente: false, excecaoAprovada: null };

  it('ajuste zero ou negativo passa livre, mesmo com bloqueio', () => {
    expect(conferirAjusteDaNota({ ...base, acao: 'bloquear', ajuste: 0 }).decisao).toBe('livre');
    expect(conferirAjusteDaNota({ ...base, acao: 'bloquear', ajuste: -20 }).decisao).toBe('livre');
  });

  it('o excesso da nota é só o que ela gasta além do saldo que havia', () => {
    expect(conferirAjusteDaNota({ ...base, acao: 'conferir' })).toMatchObject({
      decisao: 'registrado',
      excesso: 50,
      autorizacao: 'sessao',
    });
    const cabe = { ...saldo, disponivel: 30 };
    expect(conferirAjusteDaNota({ ...base, acao: 'bloquear', saldo: cabe, ajuste: 20 }).decisao).toBe(
      'livre',
    );
    expect(conferirAjusteDaNota({ ...base, acao: 'conferir', saldo: cabe }).excesso).toBe(20);
  });

  it('alerta pede ciência; bloqueio exige exceção aprovada que cubra o excesso', () => {
    const alerta = conferirAjusteDaNota({ ...base, acao: 'alertar' });
    expect(alerta).toMatchObject({ decisao: 'alerta', autorizacao: null });
    expect(alerta.problemas[0]?.campo).toBe('ciente');
    expect(conferirAjusteDaNota({ ...base, acao: 'alertar', ciente: true }).autorizacao).toBe('sessao');
    const sem = conferirAjusteDaNota({ ...base, acao: 'bloquear' });
    expect(sem).toMatchObject({ decisao: 'bloqueio', excedeuSaldo: false });
    expect(sem.problemas[0]?.mensagem).toMatch(/^A nota passa da reserva/);
    expect(conferirAjusteDaNota({ ...base, acao: 'bloquear', excecaoAprovada: 40 }).decisao).toBe('bloqueio');
    expect(conferirAjusteDaNota({ ...base, acao: 'bloquear', excecaoAprovada: 50 })).toMatchObject({
      decisao: 'excecao',
      autorizacao: 'excecao',
    });
    expect(conferirAjusteDaNota({ ...base, acao: 'nao_controlar' }).decisao).toBe('sem_controle');
  });
});
