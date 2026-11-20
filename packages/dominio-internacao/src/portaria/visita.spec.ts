// Regras da portaria (M50, etapa 5; regras 9 e 10; o `visita.spec.ts` da ficha): bloqueio, sigilo, acompanhante com
// direito legal, isolamento, horário, limite, idade, a exceção do supervisor, a biometria desligada, o crachá (código,
// validade, ZPL, catraca), o cadastro mínimo e o relatório de contatos.
import { describe, expect, it } from 'vitest';
import {
  avaliarCatraca,
  avaliarVisita,
  type BloqueioParaAvaliar,
  bloqueiosVigentes,
  codigoDoCracha,
  conferirFundamento,
  conferirNascimento,
  conferirRegra,
  contatosNoPeriodo,
  crachaVencido,
  dentroDoHorario,
  type EntradaAvaliacao,
  idadeNaData,
  mensagemDaRecusa,
  nomeDeBusca,
  REGRA_PADRAO,
  regraDaUnidade,
  reterAte,
  somarDias,
  temSigilo,
  validadeDoCracha,
  vencido,
  zplDoCracha,
} from './index.js';

const bloqueio = (b: Partial<BloqueioParaAvaliar>): BloqueioParaAvaliar => ({
  motivo: 'pedido',
  abrangencia: 'todos',
  visitante: null,
  limite: null,
  incluiAcompanhante: false,
  inicio: '2026-10-20T08:00',
  fim: null,
  revogado: false,
  ...b,
});

const base = (e: Partial<EntradaAvaliacao> = {}): EntradaAvaliacao => ({
  agora: '2026-10-25T15:00',
  regra: REGRA_PADRAO,
  isolamento: false,
  bloqueios: [],
  abertas: 0,
  acompanhante: null,
  visitante: { id: 10, nascimento: '1980-05-01', emVisita: false },
  biometrica: false,
  biometriaLigada: false,
  excecao: false,
  ...e,
});

describe('regras de visita por unidade', () => {
  const uti = { ...REGRA_PADRAO, unidade: 'UTI-1', maxSimultaneos: 1, uti: true };
  const geral = { ...REGRA_PADRAO, unidade: '*', horaInicio: '10:00' };
  it('a da unidade, depois a do estabelecimento, depois a de mercado', () => {
    expect(regraDaUnidade([uti, geral], 'uti-1')).toEqual({ regra: uti, padrao: false });
    expect(regraDaUnidade([uti, geral], 'INT-2')).toEqual({ regra: geral, padrao: false });
    expect(regraDaUnidade([uti], 'INT-2')).toEqual({
      regra: { ...REGRA_PADRAO, unidade: 'INT-2' },
      padrao: true,
    });
    expect(regraDaUnidade([], ' ').regra.unidade).toBe('*');
  });
  it('o horário de visita é [início, fim)', () => {
    expect(dentroDoHorario('2026-10-25T14:00', REGRA_PADRAO)).toBe(true);
    expect(dentroDoHorario('2026-10-25T19:59', REGRA_PADRAO)).toBe(true);
    expect(dentroDoHorario('2026-10-25T20:00', REGRA_PADRAO)).toBe(false);
    expect(dentroDoHorario('2026-10-25T13:59', REGRA_PADRAO)).toBe(false);
  });
  it('confere o horário e a duração', () => {
    expect(conferirRegra(REGRA_PADRAO)).toEqual({ ok: true });
    expect(conferirRegra({ ...REGRA_PADRAO, horaInicio: '20:00', horaFim: '14:00' }).ok).toBe(false);
    const longa = conferirRegra({
      ...REGRA_PADRAO,
      horaInicio: '15:00',
      horaFim: '16:00',
      duracaoMaxMin: 90,
    });
    expect(longa).toEqual({ ok: false, mensagem: expect.stringContaining('90 min') });
    expect(
      conferirRegra({ ...REGRA_PADRAO, horaInicio: '15:00', horaFim: '16:00', duracaoMaxMin: 1_440 }).ok,
    ).toBe(true);
  });
});

describe('avaliação da visita (regra 9)', () => {
  it('libera dentro da regra, como visitante, sem orientação', () => {
    expect(avaliarVisita(base())).toEqual({
      permitida: true,
      papel: 'visitante',
      orientacao: null,
      excecaoUsada: null,
      limite: 2,
    });
  });
  it('bloqueio do paciente: mensagem genérica, sem exceção, nunca o motivo', () => {
    for (const motivo of ['pedido', 'judicial', 'clinico', 'sigilo'] as const) {
      const r = avaliarVisita(base({ bloqueios: [bloqueio({ motivo })], excecao: true }));
      expect(r).toMatchObject({ permitida: false, recusa: 'bloqueio', excepcionavel: false });
      if (!r.permitida) expect(r.mensagem).not.toMatch(/judicial|clínic|sigilo|pedido/i);
    }
    // Sem visitante (a busca), o bloqueio "todos" também recusa.
    expect(avaliarVisita(base({ visitante: null, bloqueios: [bloqueio({})] }))).toMatchObject({
      recusa: 'bloqueio',
    });
  });
  it('bloqueio de uma pessoa: só ela', () => {
    const b = [bloqueio({ abrangencia: 'visitante', visitante: 10, motivo: 'judicial' })];
    expect(avaliarVisita(base({ bloqueios: b }))).toMatchObject({ permitida: false, recusa: 'bloqueio' });
    expect(
      avaliarVisita(base({ bloqueios: b, visitante: { id: 11, nascimento: null, emVisita: false } })),
    ).toMatchObject({ permitida: false, recusa: 'nascimento-exigido' });
    expect(
      avaliarVisita(base({ bloqueios: b, visitante: { id: 11, nascimento: '1990-01-01', emVisita: false } }))
        .permitida,
    ).toBe(true);
  });
  it('acompanhante com direito legal: fora do horário, do limite e da idade; o bloqueio só se incluir o acompanhante', () => {
    const e = base({
      agora: '2026-10-25T23:00',
      abertas: 5,
      acompanhante: 10,
      visitante: { id: 10, nascimento: '2015-01-01', emVisita: false },
      isolamento: true,
      regra: { ...REGRA_PADRAO, isolamento: 'bloquear', uti: true },
      bloqueios: [bloqueio({ motivo: 'pedido' })],
    });
    const r = avaliarVisita(e);
    expect(r).toMatchObject({ permitida: true, papel: 'acompanhante' });
    if (r.permitida) expect(r.orientacao).toMatch(/precaução.*terapia intensiva/s);
    expect(
      avaliarVisita({ ...e, bloqueios: [bloqueio({ motivo: 'judicial', incluiAcompanhante: true })] }),
    ).toMatchObject({ permitida: false, recusa: 'bloqueio' });
    expect(
      avaliarVisita({
        ...e,
        bloqueios: [
          bloqueio({ abrangencia: 'visitante', visitante: 10, motivo: 'clinico', incluiAcompanhante: true }),
        ],
      }),
    ).toMatchObject({ permitida: false, recusa: 'bloqueio' });
  });
  it('acompanhante autorizado pela equipe (sem direito legal): segue a regra da unidade, o isolamento e o bloqueio', () => {
    const e = base({
      agora: '2026-10-25T15:00',
      acompanhante: 10,
      acompanhanteFundamento: 'autorizado',
      visitante: { id: 10, nascimento: '1980-05-01', emVisita: false },
    });
    expect(avaliarVisita(e)).toMatchObject({ permitida: true, papel: 'acompanhante' });
    // Fora do horário: recusa com a exceção possível (o supervisor libera).
    expect(avaliarVisita({ ...e, agora: '2026-10-25T23:00' })).toMatchObject({
      permitida: false,
      recusa: 'fora-do-horario',
      excepcionavel: true,
    });
    expect(avaliarVisita({ ...e, agora: '2026-10-25T23:00', excecao: true })).toMatchObject({
      permitida: true,
      papel: 'acompanhante',
      excecaoUsada: 'fora-do-horario',
    });
    // O isolamento que a regra bloqueia e o bloqueio do paciente (mesmo sem incluir o acompanhante) valem para ele.
    expect(
      avaliarVisita({ ...e, isolamento: true, regra: { ...REGRA_PADRAO, isolamento: 'bloquear' } }),
    ).toMatchObject({ permitida: false, recusa: 'isolamento' });
    expect(avaliarVisita({ ...e, bloqueios: [bloqueio({ motivo: 'sigilo' })] })).toMatchObject({
      permitida: false,
      recusa: 'bloqueio',
    });
    expect(avaliarVisita({ ...e, abertas: 2 })).toMatchObject({ permitida: false, recusa: 'limite' });
    // Com direito legal (ou sem o fundamento informado), a isenção continua.
    for (const f of ['idoso', null] as const)
      expect(
        avaliarVisita({
          ...e,
          acompanhanteFundamento: f,
          agora: '2026-10-25T23:00',
          bloqueios: [bloqueio({ motivo: 'sigilo' })],
        }),
      ).toMatchObject({ permitida: true, papel: 'acompanhante' });
  });
  it('isolamento: a regra bloqueia ou orienta', () => {
    expect(
      avaliarVisita(
        base({ isolamento: true, regra: { ...REGRA_PADRAO, isolamento: 'bloquear' }, excecao: true }),
      ),
    ).toMatchObject({ permitida: false, recusa: 'isolamento', excepcionavel: false });
    const r = avaliarVisita(base({ isolamento: true }));
    expect(r.permitida).toBe(true);
    if (r.permitida) expect(r.orientacao).toMatch(/precaução/);
  });
  it('horário, limite e idade: recusa com exceção possível; a exceção do supervisor libera e fica registrada', () => {
    const fora = avaliarVisita(base({ agora: '2026-10-25T21:00' }));
    expect(fora).toMatchObject({ permitida: false, recusa: 'fora-do-horario', excepcionavel: true });
    if (!fora.permitida) expect(fora.mensagem).toBe('Fora do horário de visita da unidade (14:00 às 20:00).');
    expect(avaliarVisita(base({ agora: '2026-10-25T21:00', excecao: true }))).toMatchObject({
      permitida: true,
      excecaoUsada: 'fora-do-horario',
    });
    expect(avaliarVisita(base({ abertas: 2 }))).toMatchObject({ recusa: 'limite', excepcionavel: true });
    expect(avaliarVisita(base({ abertas: 2, excecao: true }))).toMatchObject({
      permitida: true,
      excecaoUsada: 'limite',
    });
    const crianca = { id: 10, nascimento: '2020-01-01', emVisita: false };
    expect(avaliarVisita(base({ visitante: crianca }))).toMatchObject({
      recusa: 'idade',
      excepcionavel: true,
    });
    expect(avaliarVisita(base({ visitante: crianca, excecao: true }))).toMatchObject({
      excecaoUsada: 'idade',
    });
    expect(
      avaliarVisita(base({ visitante: crianca, regra: { ...REGRA_PADRAO, idadeMinima: 0 } })).permitida,
    ).toBe(true);
    // Fora do horário e acima do limite: a exceção registra a primeira.
    expect(avaliarVisita(base({ agora: '2026-10-25T21:00', abertas: 3, excecao: true }))).toMatchObject({
      excecaoUsada: 'fora-do-horario',
    });
  });
  it('o limite menor do bloqueio não tem exceção', () => {
    const b = [bloqueio({ abrangencia: 'limite', limite: 1 })];
    expect(avaliarVisita(base({ bloqueios: b, abertas: 0 })).permitida).toBe(true);
    expect(avaliarVisita(base({ bloqueios: b, abertas: 1, excecao: true }))).toMatchObject({
      permitida: false,
      recusa: 'bloqueio',
      limite: 1,
    });
    // Limite do bloqueio acima do da unidade: vale o da unidade, com exceção.
    const alto = [bloqueio({ abrangencia: 'limite', limite: 5 })];
    expect(avaliarVisita(base({ bloqueios: alto, abertas: 2 }))).toMatchObject({
      recusa: 'limite',
      limite: 2,
    });
  });
  it('visita já aberta e biometria sem a DP-45', () => {
    expect(
      avaliarVisita(base({ visitante: { id: 10, nascimento: null, emVisita: true }, excecao: true })),
    ).toMatchObject({
      recusa: 'ja-em-visita',
    });
    expect(avaliarVisita(base({ biometrica: true }))).toMatchObject({ recusa: 'identificacao-biometrica' });
    expect(avaliarVisita(base({ biometrica: true, biometriaLigada: true })).permitida).toBe(true);
  });
  it('mensagens do porteiro', () => {
    expect(mensagemDaRecusa('limite', REGRA_PADRAO, 1)).toContain('1 visitante(s)');
    expect(mensagemDaRecusa('idade', REGRA_PADRAO, 2)).toContain('12 anos');
    expect(mensagemDaRecusa('sem-internacao', REGRA_PADRAO, 2)).toMatch(/não encontrado/);
    for (const r of ['nascimento-exigido', 'isolamento', 'ja-em-visita', 'identificacao-biometrica'] as const)
      expect(mensagemDaRecusa(r, REGRA_PADRAO, 2).length).toBeGreaterThan(10);
  });
  it('bloqueios vigentes e sigilo', () => {
    const lista = [
      bloqueio({ motivo: 'sigilo' }),
      bloqueio({ revogado: true }),
      bloqueio({ fim: '2026-10-24' }),
      bloqueio({ inicio: '2026-10-26T08:00' }),
      bloqueio({ fim: '2026-10-25', motivo: 'clinico' }),
    ];
    const v = bloqueiosVigentes(lista, '2026-10-25T15:00');
    expect(v.map((b) => b.motivo)).toEqual(['sigilo', 'clinico']);
    expect(temSigilo(v)).toBe(true);
    expect(temSigilo([bloqueio({ motivo: 'sigilo', abrangencia: 'limite', limite: 1 })])).toBe(false);
  });
});

describe('crachá e catraca', () => {
  it('código de 12 caracteres sem ambíguos, de bytes aleatórios', () => {
    const c = codigoDoCracha(Uint8Array.from({ length: 12 }, (_, i) => i * 21));
    expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{12}$/);
    expect(() => codigoDoCracha(new Uint8Array(4))).toThrow(/bytes/);
  });
  it('validade: o fim do horário ou a duração; acompanhante 24 h; exceção pela duração', () => {
    expect(validadeDoCracha('2026-10-25T15:00', REGRA_PADRAO, 'visitante', false)).toBe('2026-10-25T17:00');
    expect(validadeDoCracha('2026-10-25T19:30', REGRA_PADRAO, 'visitante', false)).toBe('2026-10-25T20:00');
    expect(validadeDoCracha('2026-10-25T21:00', REGRA_PADRAO, 'visitante', false)).toBe('2026-10-25T23:00');
    expect(validadeDoCracha('2026-10-25T19:30', REGRA_PADRAO, 'visitante', true)).toBe('2026-10-25T21:30');
    expect(validadeDoCracha('2026-10-25T23:30', REGRA_PADRAO, 'acompanhante', false)).toBe(
      '2026-10-26T23:30',
    );
    expect(crachaVencido('2026-10-25T17:00', '2026-10-25T17:00')).toBe(true);
    expect(crachaVencido('2026-10-25T17:00', '2026-10-25T16:59')).toBe(false);
  });
  it('ZPL sem comandos injetados, com o código de barras', () => {
    const z = zplDoCracha({
      codigo: 'ABC123DEF456',
      visitante: 'MARIA ^XZ~JA SINTETICA',
      destino: 'INTERNACAO - 02 · 201-A',
      validoAte: '2026-10-25T17:00',
      papel: 'visitante',
    });
    expect(z.startsWith('^XA\n^CI28')).toBe(true);
    expect(z.endsWith('^XZ')).toBe(true);
    expect(z).toContain('^FDMARIA  XZ JA SINTETICA^FS');
    expect(z).toContain('^BCN,100,Y,N,N^FDABC123DEF456^FS');
    expect(z).toContain('Valido ate 25/10 17:00');
    expect(
      zplDoCracha({
        codigo: 'X',
        visitante: 'A',
        destino: 'B',
        validoAte: '2026-10-25T17:00',
        papel: 'acompanhante',
      }),
    ).toContain('ACOMPANHANTE');
  });
  it('catraca: entrada com o crachá válido; saída sempre liberada a quem tem a visita', () => {
    const terminal = { ativo: true, sentido: 'ambos' as const };
    const aberta = { validoAte: '2026-10-25T17:00', saida: null };
    const ag = '2026-10-25T16:00';
    expect(avaliarCatraca({ visita: aberta, agora: ag, sentido: 'entrada', terminal })).toEqual({
      resultado: 'liberado',
      motivo: null,
      encerra: false,
    });
    expect(
      avaliarCatraca({ visita: aberta, agora: '2026-10-25T18:00', sentido: 'entrada', terminal }),
    ).toMatchObject({
      resultado: 'negado',
      motivo: 'cracha-vencido',
    });
    expect(avaliarCatraca({ visita: aberta, agora: '2026-10-25T18:00', sentido: 'saida', terminal })).toEqual(
      {
        resultado: 'liberado',
        motivo: null,
        encerra: true,
      },
    );
    const encerrada = { ...aberta, saida: '2026-10-25T16:30' };
    expect(avaliarCatraca({ visita: encerrada, agora: ag, sentido: 'saida', terminal })).toMatchObject({
      encerra: false,
    });
    expect(avaliarCatraca({ visita: encerrada, agora: ag, sentido: 'entrada', terminal }).motivo).toBe(
      'visita-encerrada',
    );
    expect(avaliarCatraca({ visita: null, agora: ag, sentido: 'entrada', terminal }).motivo).toBe(
      'cracha-desconhecido',
    );
    expect(
      avaliarCatraca({
        visita: aberta,
        agora: ag,
        sentido: 'entrada',
        terminal: { ...terminal, ativo: false },
      }).motivo,
    ).toBe('terminal-inativo');
    expect(
      avaliarCatraca({
        visita: aberta,
        agora: ag,
        sentido: 'entrada',
        terminal: { ativo: true, sentido: 'saida' },
      }).motivo,
    ).toBe('sentido-do-terminal');
  });
});

describe('cadastro mínimo, acompanhante e contatos', () => {
  it('nome de busca, idade, prazo de retenção e nascimento', () => {
    expect(nomeDeBusca('  José  da Conceição-Silva ')).toBe('JOSE DA CONCEICAO SILVA');
    expect(idadeNaData('2008-10-26', '2026-10-25')).toBe(17);
    expect(idadeNaData('2008-10-25', '2026-10-25')).toBe(18);
    expect(idadeNaData('2008-11-01', '2026-10-25')).toBe(17);
    expect(somarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(reterAte('2026-10-25T15:00', 365)).toBe('2027-10-25');
    expect(conferirNascimento(null, '2026-10-25')).toEqual({ ok: true });
    expect(conferirNascimento('1990-02-30', '2026-10-25').ok).toBe(false);
    expect(conferirNascimento('2027-01-01', '2026-10-25').ok).toBe(false);
    expect(conferirNascimento('1890-01-01', '2026-10-25').ok).toBe(false);
    expect(conferirNascimento('1990-02-28', '2026-10-25')).toEqual({ ok: true });
    expect(vencido({ reterAte: '2026-10-24', emVisita: false }, '2026-10-25')).toBe(true);
    expect(vencido({ reterAte: '2026-10-24', emVisita: true }, '2026-10-25')).toBe(false);
    expect(vencido({ reterAte: '2026-10-25', emVisita: false }, '2026-10-25')).toBe(false);
  });
  it('fundamento do acompanhante: idade do paciente para idoso e criança; avisos nos declarados', () => {
    expect(conferirFundamento('idoso', 72)).toEqual({ ok: true, aviso: null });
    expect(conferirFundamento('idoso', 59).ok).toBe(false);
    expect(conferirFundamento('idoso', null)).toMatchObject({
      ok: true,
      aviso: expect.stringContaining('60'),
    });
    expect(conferirFundamento('crianca', 9)).toEqual({ ok: true, aviso: null });
    expect(conferirFundamento('crianca', 18).ok).toBe(false);
    expect(conferirFundamento('crianca', null)).toMatchObject({ ok: true });
    for (const f of ['parto', 'deficiencia', 'autorizado'] as const)
      expect(conferirFundamento(f, 30)).toMatchObject({ ok: true, aviso: expect.any(String) });
  });
  it('contatos no período: a visita que esteve no intervalo (a aberta até agora), em ordem', () => {
    const v = [
      { id: 3, entrada: '2026-10-22T15:00', saida: null },
      { id: 1, entrada: '2026-10-20T15:00', saida: '2026-10-20T16:00' },
      { id: 2, entrada: '2026-10-18T15:00', saida: '2026-10-19T09:00' },
      { id: 4, entrada: '2026-10-26T15:00', saida: null },
    ];
    expect(contatosNoPeriodo(v, '2026-10-19', '2026-10-25', '2026-10-25T16:00').map((x) => x.id)).toEqual([
      2, 1, 3,
    ]);
    expect(contatosNoPeriodo(v, '2026-10-24', '2026-10-25', '2026-10-25T16:00').map((x) => x.id)).toEqual([
      3,
    ]);
    // Sem a saída e com o crachá vencido, a visita termina na validade (não "até agora").
    const vencida = [{ id: 5, entrada: '2026-10-10T15:00', saida: null, validoAte: '2026-10-10T17:00' }];
    expect(contatosNoPeriodo(vencida, '2026-10-24', '2026-10-25', '2026-10-25T16:00')).toEqual([]);
    expect(contatosNoPeriodo(vencida, '2026-10-10', '2026-10-25', '2026-10-25T16:00')).toHaveLength(1);
  });
});
