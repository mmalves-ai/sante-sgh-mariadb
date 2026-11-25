// Regra da soroteca (F8, 05-SADT linha 9): cadastro, prazo de descarte pela regra, posição no suporte, retirada,
// devolução e expurgo só do que venceu.
import { describe, expect, it } from 'vitest';
import {
  conferirDevolucao,
  conferirEquipamento,
  conferirExpurgo,
  conferirGuarda,
  guardaAtiva,
  prazoDescarteVigente,
  conferirMotivoExpurgo,
  conferirPosicao,
  conferirRegraDescarte,
  conferirRetirada,
  conferirSuporte,
  descartePrevisto,
  primeiraPosicaoLivre,
  type RegraDescarte,
  regraDescarteAplicavel,
  resultadoAtende,
  somarDiasDaGuarda,
  vencidasParaExpurgo,
} from './soroteca.js';

const codigo = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return (e as { codigo?: string }).codigo ?? String(e);
  }
};

const regra = (p: Partial<RegraDescarte>): RegraDescarte => ({
  id: 1,
  abrangencia: 'geral',
  exame: null,
  comparador: null,
  valorTexto: null,
  fontePagadora: null,
  diasGuarda: 7,
  prioridade: 0,
  ativo: true,
  ...p,
});

describe('soroteca: cadastro', () => {
  it('equipamento com faixa de temperatura coerente', () => {
    expect(codigo(() => conferirEquipamento({ temperaturaMinima: 2, temperaturaMaxima: 8 }))).toBe('ok');
    expect(codigo(() => conferirEquipamento({ temperaturaMinima: 8, temperaturaMaxima: 2 }))).toBe(
      'temperatura-invertida',
    );
  });
  it('suporte com linhas e colunas', () => {
    expect(codigo(() => conferirSuporte({ quantidadeLinhas: 10, quantidadeColunas: 10 }))).toBe('ok');
    expect(codigo(() => conferirSuporte({ quantidadeLinhas: 0, quantidadeColunas: 10 }))).toBe(
      'suporte-sem-linhas',
    );
    expect(codigo(() => conferirSuporte({ quantidadeLinhas: 2, quantidadeColunas: 0 }))).toBe(
      'suporte-sem-colunas',
    );
  });
  it('regra de descarte completa para a abrangência', () => {
    const base = {
      exame: null,
      comparador: null,
      valorTexto: null,
      fontePagadora: null,
      diasGuarda: 7,
      prioridade: 0,
    };
    expect(codigo(() => conferirRegraDescarte({ ...base, abrangencia: 'geral' }))).toBe('ok');
    expect(codigo(() => conferirRegraDescarte({ ...base, abrangencia: 'geral', diasGuarda: 0 }))).toBe(
      'dias-invalidos',
    );
    expect(codigo(() => conferirRegraDescarte({ ...base, abrangencia: 'exame' }))).toBe('regra-sem-exame');
    expect(codigo(() => conferirRegraDescarte({ ...base, abrangencia: 'resultado', exame: 3 }))).toBe(
      'regra-sem-comparacao',
    );
    expect(
      codigo(() =>
        conferirRegraDescarte({
          ...base,
          abrangencia: 'resultado',
          exame: 3,
          comparador: 'entre',
          valorTexto: '9;2',
        }),
      ),
    ).toBe('faixa-invalida');
    expect(codigo(() => conferirRegraDescarte({ ...base, abrangencia: 'fonte_pagadora' }))).toBe(
      'regra-sem-fonte',
    );
  });
});

describe('soroteca: prazo de descarte', () => {
  it('compara o resultado por número ou por texto', () => {
    expect(resultadoAtende('maior', '10', '12,5')).toBe(true);
    expect(resultadoAtende('menor_igual', '10', '10')).toBe(true);
    expect(resultadoAtende('entre', '5;10', '7')).toBe(true);
    expect(resultadoAtende('entre', '5;10', '11')).toBe(false);
    expect(resultadoAtende('igual', 'Reagente', 'reagente')).toBe(true);
    expect(resultadoAtende('contem', 'positivo', 'Fracamente positivo')).toBe(true);
    expect(resultadoAtende('maior', '10', 'não reagente')).toBe(false);
  });
  it('escolhe a regra de maior prioridade; empate, o maior prazo; inativa e de outro alvo ficam fora', () => {
    const regras = [
      regra({ id: 1, diasGuarda: 7 }),
      regra({ id: 2, abrangencia: 'exame', exame: 5, diasGuarda: 30, prioridade: 1 }),
      regra({ id: 3, abrangencia: 'exame', exame: 5, diasGuarda: 60, prioridade: 1 }),
      regra({
        id: 4,
        abrangencia: 'resultado',
        exame: 5,
        comparador: 'igual',
        valorTexto: 'reagente',
        diasGuarda: 365,
        prioridade: 5,
      }),
      regra({
        id: 5,
        abrangencia: 'fonte_pagadora',
        fontePagadora: 9,
        diasGuarda: 90,
        prioridade: 9,
        ativo: false,
      }),
    ];
    const c = { exames: [5], fontePagadora: 9, resultados: [] };
    expect(regraDescarteAplicavel(regras, c)?.id).toBe(3);
    expect(regraDescarteAplicavel(regras, { ...c, resultados: [{ exame: 5, valor: 'Reagente' }] })?.id).toBe(
      4,
    );
    expect(regraDescarteAplicavel(regras, { ...c, exames: [6] })?.id).toBe(1);
    expect(regraDescarteAplicavel([], c)).toBeNull();
  });
  it('soma os dias ao dia da guarda (virada de mês e ano); sem regra, sem prazo', () => {
    expect(somarDiasDaGuarda('2026-12-25', 10)).toBe('2027-01-04');
    expect(descartePrevisto('2026-02-20', regra({ diasGuarda: 10 }))).toBe('2026-03-02');
    expect(descartePrevisto('2026-02-20', null)).toBeNull();
  });
});

describe('soroteca: posição no suporte', () => {
  const s = { quantidadeLinhas: 2, quantidadeColunas: 3 };
  it('recusa fora do suporte e ocupada', () => {
    expect(codigo(() => conferirPosicao(s, { linha: 2, coluna: 3 }, []))).toBe('ok');
    expect(codigo(() => conferirPosicao(s, { linha: 3, coluna: 1 }, []))).toBe('posicao-fora');
    expect(codigo(() => conferirPosicao(s, { linha: 0, coluna: 1 }, []))).toBe('posicao-fora');
    expect(codigo(() => conferirPosicao(s, { linha: 1, coluna: 2 }, [{ linha: 1, coluna: 2 }]))).toBe(
      'posicao-ocupada',
    );
  });
  it('sugere a primeira livre, linha a linha; cheio, nenhuma', () => {
    expect(
      primeiraPosicaoLivre(s, [
        { linha: 1, coluna: 1 },
        { linha: 1, coluna: 2 },
      ]),
    ).toEqual({ linha: 1, coluna: 3 });
    const todas = [1, 2].flatMap((linha) => [1, 2, 3].map((coluna) => ({ linha, coluna })));
    expect(primeiraPosicaoLivre(s, todas)).toBeNull();
  });
});

describe('soroteca: guarda, retirada, devolução e expurgo', () => {
  const reteste = { ativo: true, definitiva: false, finalidade: 'reteste' as const };
  const vencido = { ativo: true, definitiva: true, finalidade: 'prazo_vencido' as const };
  it('guarda só amostra viva e ainda não guardada', () => {
    const g = (situacao: 'guardada' | 'retirada' | 'descartada', retiradaDefinitiva = false) => ({
      situacao,
      retiradaDefinitiva,
    });
    expect(codigo(() => conferirGuarda('recebida', []))).toBe('ok');
    expect(codigo(() => conferirGuarda('rejeitada', []))).toBe('amostra-nao-guardavel');
    expect(codigo(() => conferirGuarda('aguardando_coleta', []))).toBe('amostra-nao-guardavel');
    expect(codigo(() => conferirGuarda('recebida', [g('guardada')]))).toBe('amostra-ja-guardada');
    // A retirada provisória ainda ocupa a soroteca; a definitiva encerra e a amostra pode ser guardada de novo.
    expect(codigo(() => conferirGuarda('armazenada', [g('retirada')]))).toBe('amostra-ja-guardada');
    expect(codigo(() => conferirGuarda('armazenada', [g('retirada', true)]))).toBe('ok');
    // A descartada nunca volta, nem pela situação da amostra nem por uma guarda descartada.
    expect(codigo(() => conferirGuarda('descartada', []))).toBe('amostra-descartada');
    expect(codigo(() => conferirGuarda('analisada', [g('descartada')]))).toBe('amostra-descartada');
    expect(guardaAtiva(g('guardada'))).toBe(true);
    expect(guardaAtiva(g('retirada'))).toBe(true);
    expect(guardaAtiva(g('retirada', true))).toBe(false);
    expect(guardaAtiva(g('descartada'))).toBe(false);
  });
  it('prazo vigente: a regra pelo resultado digitado depois da guarda passa a valer; sem regra, fica o gravado', () => {
    const regras = [
      {
        id: 1,
        abrangencia: 'geral' as const,
        exame: null,
        comparador: null,
        valorTexto: null,
        fontePagadora: null,
        diasGuarda: 7,
        prioridade: 0,
        ativo: true,
      },
      {
        id: 2,
        abrangencia: 'resultado' as const,
        exame: 10,
        comparador: 'maior' as const,
        valorTexto: '100',
        fontePagadora: null,
        diasGuarda: 90,
        prioridade: 5,
        ativo: true,
      },
    ];
    const semResultado = { exames: [10], fontePagadora: null, resultados: [] };
    const comResultado = { ...semResultado, resultados: [{ exame: 10, valor: '150' }] };
    expect(prazoDescarteVigente('2026-11-01', regras, semResultado, '2026-11-08').descartePrevistoEm).toBe(
      '2026-11-08',
    );
    const v = prazoDescarteVigente('2026-11-01', regras, comResultado, '2026-11-08');
    expect(v.regra?.id).toBe(2);
    expect(v.descartePrevistoEm).toBe('2027-01-30');
    expect(prazoDescarteVigente('2026-11-01', [], comResultado, '2026-11-08').descartePrevistoEm).toBe(
      '2026-11-08',
    );
    expect(prazoDescarteVigente('2026-11-01', [], comResultado, null).descartePrevistoEm).toBeNull();
  });
  it('retirada com motivo ativo; devolução só da provisória', () => {
    expect(codigo(() => conferirRetirada('guardada', reteste))).toBe('ok');
    expect(codigo(() => conferirRetirada('guardada', null))).toBe('motivo-invalido');
    expect(codigo(() => conferirRetirada('guardada', { ...reteste, ativo: false }))).toBe('motivo-invalido');
    expect(codigo(() => conferirRetirada('descartada', reteste))).toBe('nao-guardada');
    // Motivo de descarte só pelo expurgo (que confere o prazo e pede outra permissão).
    expect(codigo(() => conferirRetirada('guardada', vencido))).toBe('retirada-para-descarte');
    expect(
      codigo(() => conferirRetirada('guardada', { ativo: true, definitiva: true, finalidade: 'descarte' })),
    ).toBe('retirada-para-descarte');
    expect(
      codigo(() =>
        conferirRetirada('guardada', { ativo: true, definitiva: true, finalidade: 'transferencia' }),
      ),
    ).toBe('ok');
    expect(codigo(() => conferirDevolucao('retirada', reteste))).toBe('ok');
    expect(codigo(() => conferirDevolucao('retirada', vencido))).toBe('retirada-definitiva');
    expect(codigo(() => conferirDevolucao('guardada', reteste))).toBe('nao-retirada');
  });
  it('expurgo só do vencido e com motivo de prazo vencido ou descarte', () => {
    const g = [
      { id: 1, situacao: 'guardada' as const, descartePrevistoEm: '2026-11-20' },
      { id: 2, situacao: 'guardada' as const, descartePrevistoEm: '2026-11-25' },
      { id: 3, situacao: 'guardada' as const, descartePrevistoEm: '2026-12-01' },
      { id: 4, situacao: 'retirada' as const, descartePrevistoEm: '2026-11-01' },
      { id: 5, situacao: 'guardada' as const, descartePrevistoEm: null },
    ];
    const v = vencidasParaExpurgo(g, '2026-11-25');
    expect(v.map((x) => x.id)).toEqual([1, 2]);
    expect(codigo(() => conferirExpurgo([1, 2], v))).toBe('ok');
    expect(codigo(() => conferirExpurgo([], v))).toBe('expurgo-vazio');
    expect(codigo(() => conferirExpurgo([1, 3], v))).toBe('expurgo-fora-do-prazo');
    expect(codigo(() => conferirMotivoExpurgo(vencido))).toBe('ok');
    expect(codigo(() => conferirMotivoExpurgo(reteste))).toBe('motivo-expurgo');
  });
});
