import { describe, expect, it } from 'vitest';
import {
  avaliarValores,
  type FaixaDaGrandeza,
  faixaDoPaciente,
  type GrandezaDoLaudo,
  superficieCorporal,
  valoresParaModelo,
} from './estruturado.js';
import {
  aplicarModelo,
  camposDoModelo,
  conferirAssinante,
  conferirDonoDoModelo,
  conferirExameParaLaudo,
  conferirRetificador,
  dataDoExame,
  conferirMotivoRetificacao,
  conferirTextoParaAssinar,
  ordenarModelos,
  proximaVersao,
  RecusaLaudo,
  situacaoDepois,
} from './redacao.js';

const codigo = (f: () => unknown) => {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof RecusaLaudo ? e.codigo : String(e);
  }
};

describe('redação do laudo', () => {
  it('rascunho muda livre; assinado só por retificação; cancelado não muda', () => {
    expect(situacaoDepois(null, 'salvar')).toBe('rascunho');
    expect(situacaoDepois('rascunho', 'enviar_revisao')).toBe('aguardando_revisao');
    expect(situacaoDepois('aguardando_revisao', 'assinar')).toBe('assinado');
    expect(codigo(() => situacaoDepois('assinado', 'salvar'))).toBe('laudo-assinado');
    expect(codigo(() => situacaoDepois('emitido', 'assinar'))).toBe('laudo-ja-assinado');
    expect(situacaoDepois('emitido', 'retificar')).toBe('retificado');
    expect(situacaoDepois('retificado', 'retificar')).toBe('retificado');
    expect(codigo(() => situacaoDepois('rascunho', 'retificar'))).toBe('laudo-nao-assinado');
    expect(codigo(() => situacaoDepois('cancelado', 'salvar'))).toBe('laudo-cancelado');
  });

  it('texto, motivo e assinante', () => {
    expect(codigo(() => conferirTextoParaAssinar('<p> curto </p>'))).toBe('laudo-sem-texto');
    expect(codigo(() => conferirTextoParaAssinar('Exame dentro da normalidade.'))).toBeNull();
    expect(codigo(() => conferirMotivoRetificacao(null, 'erro'))).toBe('retificacao-sem-motivo');
    expect(codigo(() => conferirMotivoRetificacao(3, null))).toBeNull();
    expect(codigo(() => conferirMotivoRetificacao(null, 'Lateralidade trocada no texto'))).toBeNull();
    expect(codigo(() => conferirAssinante(null, 'imagem'))).toBe('sem-vinculo');
    expect(codigo(() => conferirAssinante({ cbo: '225125', conselhoAtivo: false }, 'imagem'))).toBe(
      'conselho-inativo',
    );
    expect(codigo(() => conferirAssinante({ cbo: '223405', conselhoAtivo: true }, 'metodos_graficos'))).toBe(
      'laudo-privativo-medico',
    );
    expect(codigo(() => conferirAssinante({ cbo: '225125', conselhoAtivo: true }, 'imagem'))).toBeNull();
    expect(proximaVersao([])).toBe(1);
    expect(proximaVersao([1, 3, 2])).toBe(4);
  });

  it('modelo com campos variáveis: troca o que tem e marca o que falta', () => {
    const m = 'FE {{fe}}%. DDVE {{ddve}} mm. FE de novo {{ fe }}.';
    expect(camposDoModelo(m)).toEqual(['fe', 'ddve']);
    expect(aplicarModelo(m, { fe: '62' })).toEqual({
      texto: 'FE 62%. DDVE [ddve] mm. FE de novo 62.',
      faltam: ['ddve'],
    });
  });

  it('ordena os modelos: o do médico, depois o do exame, depois o do setor; descarta o de outro', () => {
    const ms = [
      { id: 1, nome: 'Setor', exame: null, setor: 5, profissional: null },
      { id: 2, nome: 'Exame', exame: 9, setor: null, profissional: null },
      { id: 3, nome: 'Meu', exame: 9, setor: null, profissional: 7 },
      { id: 4, nome: 'De outro', exame: 9, setor: null, profissional: 8 },
      { id: 5, nome: 'Outro exame', exame: 10, setor: null, profissional: null },
    ];
    expect(ordenarModelos(ms, { exame: 9, setor: 5, profissional: 7 }).map((x) => x.id)).toEqual([3, 2, 1]);
  });
});

describe('laudo estruturado', () => {
  const g = (id: number, extra: Partial<GrandezaDoLaudo> = {}): GrandezaDoLaudo => ({
    id,
    codigo: `g${id}`,
    descricao: `Grandeza ${id}`,
    casasDecimais: 1,
    obrigatoria: false,
    calculada: false,
    ordem: id,
    unidade: null,
    ...extra,
  });
  const f = (grandeza: number, extra: Partial<FaixaDaGrandeza> = {}): FaixaDaGrandeza => ({
    grandeza,
    sexo: null,
    idadeMinimaDias: null,
    idadeMaximaDias: null,
    pesoMinimoKg: null,
    pesoMaximoKg: null,
    superficieMinima: null,
    superficieMaxima: null,
    minima: null,
    maxima: null,
    indexadaSuperficie: false,
    vigenciaInicio: '2020-01-01',
    vigenciaFim: null,
    ...extra,
  });
  const p = {
    sexo: 'masculino' as const,
    idadeDias: 18000,
    pesoKg: 80,
    alturaCm: 180,
    dataExame: '2026-11-24',
  };

  it('superfície corporal (Mosteller)', () => {
    expect(superficieCorporal(80, 180)).toBe(2);
    expect(superficieCorporal(null, 180)).toBeNull();
  });

  it('a faixa mais específica e vigente na data do exame', () => {
    const fs = [
      f(1, { minima: 50, maxima: 70 }),
      f(1, { sexo: 'masculino', minima: 52, maxima: 72 }),
      f(1, { sexo: 'feminino', minima: 54, maxima: 74 }),
      f(1, { sexo: 'masculino', minima: 0, maxima: 1, vigenciaFim: '2025-12-31' }),
    ];
    expect(faixaDoPaciente(fs, 1, p)?.minima).toBe(52);
    expect(faixaDoPaciente(fs, 1, { ...p, sexo: null })?.minima).toBe(50);
  });

  it('marca fora da referência (direta e indexada pela superfície), arredonda e numera pela ordem', () => {
    const gs = [g(1, { ordem: 2 }), g(2, { ordem: 1, casasDecimais: 0 }), g(3, { obrigatoria: true })];
    const fs = [f(1, { minima: 55, maxima: 70 }), f(2, { maxima: 115, indexadaSuperficie: true })];
    const r = avaliarValores(
      gs,
      [
        { grandeza: 1, numero: 48.26, texto: null },
        { grandeza: 2, numero: 240.4, texto: null },
      ],
      fs,
      p,
    );
    expect(r.map((x) => [x.grandeza, x.sequencia, x.numero, x.foraReferencia])).toEqual([
      [2, 1, 240, true],
      [1, 2, 48.3, true],
    ]);
    const ok = avaliarValores(gs, [{ grandeza: 2, numero: 200, texto: null }], fs, p);
    expect(ok[0]!.foraReferencia).toBe(false);
    expect(valoresParaModelo(gs, r)).toEqual({ g2: '240', g1: '48,3' });
  });

  it('recusa grandeza de outro exame, repetida, sem valor e falta da obrigatória na assinatura', () => {
    const gs = [g(1), g(3, { obrigatoria: true })];
    expect(codigo(() => avaliarValores(gs, [{ grandeza: 9, numero: 1, texto: null }], [], p))).toBe(
      'grandeza-de-outro-exame',
    );
    expect(
      codigo(() =>
        avaliarValores(
          gs,
          [
            { grandeza: 1, numero: 1, texto: null },
            { grandeza: 1, numero: 2, texto: null },
          ],
          [],
          p,
        ),
      ),
    ).toBe('grandeza-repetida');
    expect(codigo(() => avaliarValores(gs, [{ grandeza: 1, numero: null, texto: ' ' }], [], p))).toBe(
      'grandeza-sem-valor',
    );
    expect(codigo(() => avaliarValores(gs, [{ grandeza: 1, numero: 1, texto: null }], [], p, true))).toBe(
      'grandeza-obrigatoria',
    );
    expect(codigo(() => avaliarValores(gs, [{ grandeza: 1, numero: 1, texto: null }], [], p))).toBeNull();
  });

  it('só lauda o exame realizado; o cancelado e o pedido ainda não feito são recusados', () => {
    expect(codigo(() => conferirExameParaLaudo('solicitado', null))).toBe('exame-nao-realizado');
    expect(codigo(() => conferirExameParaLaudo('agendado', null))).toBe('exame-nao-realizado');
    expect(codigo(() => conferirExameParaLaudo('cancelado', '2026-11-20'))).toBe('exame-cancelado');
    expect(codigo(() => conferirExameParaLaudo('recusado', null))).toBe('exame-cancelado');
    expect(codigo(() => conferirExameParaLaudo('em_analise', null))).toBeNull();
    expect(codigo(() => conferirExameParaLaudo('agendado', '2026-11-20T10:00:00Z'))).toBeNull();
  });

  it('a data do exame é a da realização, senão a da coleta, senão a do pedido', () => {
    expect(dataDoExame('2026-11-20T10:00:00Z', '2026-11-19', '2026-11-18')).toBe('2026-11-20');
    expect(dataDoExame(null, '2026-11-19T08:00', '2026-11-18')).toBe('2026-11-19');
    expect(dataDoExame(null, null, '2026-11-18 07:00')).toBe('2026-11-18');
  });

  it('retifica o próprio laudista ou o responsável do setor; o colega não', () => {
    expect(codigo(() => conferirRetificador(7, 7, false))).toBeNull();
    expect(codigo(() => conferirRetificador(7, 8, false))).toBe('retificacao-de-outro-laudista');
    expect(codigo(() => conferirRetificador(7, 8, true))).toBeNull();
    expect(codigo(() => conferirRetificador(null, 8, false))).toBeNull();
  });

  it('o modelo pessoal só muda pelo dono', () => {
    expect(codigo(() => conferirDonoDoModelo(null, 5))).toBeNull();
    expect(codigo(() => conferirDonoDoModelo(5, 5))).toBeNull();
    expect(codigo(() => conferirDonoDoModelo(5, 6))).toBe('modelo-de-outro-profissional');
    expect(codigo(() => conferirDonoDoModelo(5, null))).toBe('modelo-de-outro-profissional');
  });
});
