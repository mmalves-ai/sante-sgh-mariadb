// Precaução (regra 7), dispositivo, higiene das mãos, surto, vigilância e os textos das recusas.
import { describe, expect, it } from 'vitest';
import { MENSAGENS_RECUSA_CCIH } from './mensagens.js';
import {
  bloqueioDoVizinho,
  conferirPrecaucao,
  precaucaoDoLeito,
  precaucaoPublica,
  vizinhosParaBloquear,
  bloqueiosALiberar,
  reconciliarPrecaucoes,
  separarBloqueiosCompartilhados,
  situacaoDaPrecaucao,
  tiposVigentesNoLeito,
} from './precaucao.js';
import {
  adesaoHigieneMaos,
  conferirInsercao,
  conferirObservacao,
  conferirRetirada,
  conferirSurto,
  consumoAlcoolPorPacienteDia,
  contarObservacao,
  sugereNotificacao,
} from './registros.js';
import {
  emPosOperatorio,
  motivosVigilancia,
  ordenarVigilancia,
  pesoVigilancia,
  teveFebre,
} from './vigilancia.js';

const AGORA = '2026-10-26T10:00:00';

describe('precaução', () => {
  it('o leito mostra a mais restritiva', () => {
    expect(precaucaoDoLeito([])).toBeNull();
    expect(precaucaoDoLeito(['contato', 'aerossois', 'goticulas'])).toBe('aerossois');
    expect(precaucaoDoLeito(['goticulas', 'contato'])).toBe('goticulas');
  });
  it('bloqueio do vizinho: exigido em aerossóis, sugerido em gotículas e multirresistente', () => {
    expect(bloqueioDoVizinho('aerossois', 'tuberculose', 0)).toBe('naoSeAplica');
    expect(bloqueioDoVizinho('aerossois', 'tuberculose', 1)).toBe('exigido');
    expect(bloqueioDoVizinho('goticulas', 'influenza', 2)).toBe('sugerido');
    expect(bloqueioDoVizinho('contato', 'kpc', 1)).toBe('sugerido');
    expect(bloqueioDoVizinho('contato', 'clostridioides', 1)).toBe('naoSeAplica');
  });
  it('conferência da precaução nova', () => {
    const base = {
      temLeito: true,
      motivo: 'kpc' as const,
      tipo: 'contato' as const,
      motivosAbertos: [] as never[],
      bloquearVizinhos: false,
      vizinhos: [{ ocupado: true }],
    };
    expect(conferirPrecaucao(base)).toBeNull();
    expect(conferirPrecaucao({ ...base, temLeito: false })).toBe('sem-leito');
    expect(conferirPrecaucao({ ...base, motivosAbertos: ['kpc'] })).toBe('precaucao-ja-aberta');
    expect(conferirPrecaucao({ ...base, motivo: 'outro', motivosAbertos: ['outro'] })).toBeNull();
    expect(conferirPrecaucao({ ...base, motivo: 'tuberculose', tipo: 'aerossois' })).toBe(
      'bloqueio-vizinho-exigido',
    );
    expect(
      conferirPrecaucao({ ...base, motivo: 'tuberculose', tipo: 'aerossois', bloquearVizinhos: true }),
    ).toBeNull();
  });
  it('só os vizinhos livres são bloqueados; o painel público vê só o tipo', () => {
    const r = vizinhosParaBloquear([
      { leito: '1', ocupado: false },
      { leito: '2', ocupado: true },
    ]);
    expect(r.bloquear.map((v) => v.leito)).toEqual(['1']);
    expect(r.ocupados.map((v) => v.leito)).toEqual(['2']);
    expect(precaucaoPublica({ tipo: 'contato', motivo: 'kpc' } as { tipo: 'contato' })).toEqual({
      tipo: 'contato',
    });
  });
});

describe('precaução diante da internação ao vivo e dos bloqueios compartilhados', () => {
  const uti = (leito: string) => ({ bloco: 'UTI', acomodacao: '01', leito });
  const internados = [
    { reg: 1, ...uti('A') },
    { reg: 2, ...uti('B') },
  ];

  it('vigente no mesmo leito; transferida em outro; encerrada fora dos internados', () => {
    expect(situacaoDaPrecaucao({ reg: 1, leito: uti('A') }, internados)).toBe('vigente');
    expect(situacaoDaPrecaucao({ reg: 2, leito: uti('A') }, internados)).toBe('transferida');
    expect(situacaoDaPrecaucao({ reg: 3, leito: uti('A') }, internados)).toBe('internacaoEncerrada');
  });

  it('o leito só olha as vigentes: a órfã de quem saiu não pesa no tipo do novo ocupante', () => {
    const abertas = reconciliarPrecaucoes(
      [
        { id: 10, reg: 9, tipo: 'aerossois' as const, leito: uti('B'), bloqueios: [] },
        { id: 11, reg: 2, tipo: 'contato' as const, leito: uti('B'), bloqueios: [] },
      ],
      internados,
    );
    expect(abertas.map((p) => p.situacao)).toEqual(['internacaoEncerrada', 'vigente']);
    expect(tiposVigentesNoLeito(abertas, uti('B'))).toEqual(['contato']);
    expect(tiposVigentesNoLeito(abertas, uti('B'), 11)).toEqual([]);
  });

  it('duas precauções no quarto: o bloqueio é compartilhado e só sai quando nenhuma aberta o pede', () => {
    const tb = { id: 1, bloqueios: [uti('B'), uti('C')] };
    const { bloquear, compartilhar } = separarBloqueiosCompartilhados([uti('B'), uti('C'), uti('D')], [tb]);
    expect(bloquear).toEqual([uti('D')]);
    expect(compartilhar).toEqual([uti('B'), uti('C')]);
    const sarampo = { id: 2, bloqueios: [...bloquear, ...compartilhar] };
    // Encerrar a TB não solta nada (o sarampo ainda pede B e C); encerrar o sarampo depois solta os três.
    expect(bloqueiosALiberar(tb, [tb, sarampo])).toEqual([]);
    expect(bloqueiosALiberar(sarampo, [sarampo])).toEqual([uti('D'), uti('B'), uti('C')]);
  });
});

describe('dispositivo', () => {
  const base = {
    tipo: 'cvc' as const,
    inseridoEm: '2026-10-25T08:00',
    agora: AGORA,
    entrada: '2026-10-20',
    ativos: [],
  };
  it('inserção', () => {
    expect(conferirInsercao(base)).toBeNull();
    expect(conferirInsercao({ ...base, inseridoEm: '2026-10-26T11:00' })).toBe('instante-futuro');
    expect(conferirInsercao({ ...base, inseridoEm: '2026-09-20T08:00' })).toBe('muito-antigo');
    expect(conferirInsercao({ ...base, inseridoEm: '2026-10-19T23:00' })).toBe('antes-da-internacao');
    expect(conferirInsercao({ ...base, ativos: [{ tipo: 'sondaVesical' }] })).toBeNull();
    expect(conferirInsercao({ ...base, ativos: [{ tipo: 'cvc' }] })).toBe('dispositivo-ja-ativo');
  });
  it('retirada', () => {
    const d = { inseridoEm: '2026-10-25T08:00', retiradoEm: null };
    expect(conferirRetirada({ dispositivo: d, retiradoEm: '2026-10-26T09:00', agora: AGORA })).toBeNull();
    expect(
      conferirRetirada({
        dispositivo: { ...d, retiradoEm: '2026-10-25T09:00' },
        retiradoEm: '2026-10-26T09:00',
        agora: AGORA,
      }),
    ).toBe('ja-retirado');
    expect(conferirRetirada({ dispositivo: d, retiradoEm: '2026-10-26T11:00', agora: AGORA })).toBe(
      'instante-futuro',
    );
    expect(conferirRetirada({ dispositivo: d, retiradoEm: '2026-10-25T07:00', agora: AGORA })).toBe(
      'antes-da-insercao',
    );
    expect(sugereNotificacao('acidental')).toBe(true);
    expect(sugereNotificacao('eletiva')).toBe(false);
  });
});

describe('higiene das mãos', () => {
  const obs = [
    {
      categoria: 'enfermeiro' as const,
      oportunidades: [
        { momento: 'antesContato' as const, acao: 'friccao' as const },
        { momento: 'aposContato' as const, acao: 'naoRealizada' as const },
      ],
    },
    {
      categoria: 'medico' as const,
      oportunidades: [{ momento: 'antesContato' as const, acao: 'lavagem' as const }],
    },
  ];
  it('conformes e oportunidades; adesão total, por momento e por categoria', () => {
    expect(contarObservacao(obs[0]!)).toEqual({ oportunidades: 2, conformes: 1 });
    const a = adesaoHigieneMaos(obs);
    expect(a.total).toMatchObject({ numerador: 2, denominador: 3, valor: 66.67 });
    expect(a.porMomento.find((m) => m.momento === 'antesContato')).toMatchObject({
      numerador: 2,
      denominador: 2,
    });
    expect(a.porMomento.find((m) => m.momento === 'aposAmbiente')?.valor).toBeNull();
    expect(a.porCategoria.find((c) => c.categoria === 'medico')).toMatchObject({ valor: 100 });
  });
  it('consumo de preparação alcoólica e data da observação', () => {
    expect(consumoAlcoolPorPacienteDia(9000, 450)).toMatchObject({ valor: 20, fator: 1 });
    expect(conferirObservacao('2026-10-26T09:00', AGORA)).toBeNull();
    expect(conferirObservacao('2026-10-26T11:00', AGORA)).toBe('instante-futuro');
    expect(conferirObservacao('2026-09-01T09:00', AGORA)).toBe('muito-antigo');
  });
});

describe('surto', () => {
  const base = {
    atual: 'investigacao' as const,
    inicio: '2026-10-10',
    encerradoEm: null,
    hoje: '2026-10-26',
  };
  it('conferências', () => {
    expect(conferirSurto(base)).toBeNull();
    expect(conferirSurto({ ...base, atual: null })).toBeNull();
    expect(conferirSurto({ ...base, atual: 'encerrado' })).toBe('surto-encerrado');
    expect(conferirSurto({ ...base, inicio: '2026-10-27' })).toBe('data-futura');
    expect(conferirSurto({ ...base, encerradoEm: '2026-10-27' })).toBe('data-futura');
    expect(conferirSurto({ ...base, encerradoEm: '2026-10-09' })).toBe('encerramento-antes-do-inicio');
    expect(conferirSurto({ ...base, encerradoEm: '2026-10-20' })).toBeNull();
  });
});

describe('vigilância', () => {
  const nada = {
    dispositivosAtivos: 0,
    antimicrobianos: 0,
    restritosSemLiberacao: 0,
    revisoesDevidas: 0,
    culturasRecentes: 0,
    febre: false,
    posOperatorio: false,
    precaucoes: 0,
    iras: 0,
  };
  it('motivos e peso', () => {
    expect(motivosVigilancia(nada)).toEqual([]);
    const todos = motivosVigilancia({
      dispositivosAtivos: 1,
      antimicrobianos: 1,
      restritosSemLiberacao: 1,
      revisoesDevidas: 1,
      culturasRecentes: 1,
      febre: true,
      posOperatorio: true,
      precaucoes: 1,
      iras: 1,
    });
    expect(todos[0]).toBe('antimicrobianoSemLiberacao');
    expect(todos).toHaveLength(9);
    expect(pesoVigilancia(todos)).toBe(19);
  });
  it('febre em 48 h; pós-operatório em 30 dias; ordem pelo peso e pelo leito', () => {
    expect(teveFebre([{ valor: 38.1, em: '2026-10-25T10:00' }], AGORA)).toBe(true);
    expect(teveFebre([{ valor: 38.1, em: '2026-10-24T09:00' }], AGORA)).toBe(false);
    expect(teveFebre([{ valor: 37.2, em: '2026-10-26T09:00' }], AGORA)).toBe(false);
    expect(teveFebre([{ valor: 39, em: '2026-10-26T11:00' }], AGORA)).toBe(false);
    expect(emPosOperatorio(['2026-10-01'], '2026-10-26')).toBe(true);
    expect(emPosOperatorio(['2026-09-20', '2026-10-27'], '2026-10-26')).toBe(false);
    const fila = ordenarVigilancia([
      { leito: 'B', motivos: ['precaucao' as const] },
      { leito: 'A', motivos: ['precaucao' as const] },
      { leito: 'C', motivos: ['febre' as const] },
    ]);
    expect(fila.map((x) => x.leito)).toEqual(['C', 'A', 'B']);
  });
  it('toda recusa tem texto', () => {
    for (const t of Object.values(MENSAGENS_RECUSA_CCIH)) expect(t.length).toBeGreaterThan(10);
  });
});
