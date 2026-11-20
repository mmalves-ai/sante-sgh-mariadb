// Mapa de dietas (ficha do M45, regras 11 e 12): a última prescrição válida até o corte de cada refeição, a mudança
// depois do corte alertando a copa, o jejum prescrito ou agendado (bloco e exames) prevalecendo, a alergia alimentar na
// linha, o acompanhante só com direito legal e o retrato com o hash do conteúdo. Casos sintéticos.
import { describe, expect, it } from 'vitest';
import {
  acompanhanteNaRefeicao,
  alertasDoMapa,
  caracteristicasTexto,
  conferirDireitoLegal,
  conteudoCanonicoMapa,
  contagensDoMapa,
  cortesProprios,
  descricaoAgora,
  dietaNoInstante,
  ErroMapa,
  examesComJejum,
  hashDoMapa,
  horaRefeicao,
  instantesDaRefeicao,
  type ItemDietaDoMapa,
  janelaDoFechamento,
  jejumAgendado,
  linhaDoMapa,
  SAIU_DA_UNIDADE,
  refeicoesComCorte,
  tipoDoPlanoDieta,
} from '../index.js';

const item = (x: Partial<ItemDietaDoMapa> & Pick<ItemDietaDoMapa, 'item' | 'plano'>): ItemDietaDoMapa => ({
  itemDieta: x.item * 10,
  prescricao: 1,
  nomeDieta: 'DIETA ORAL',
  quantidade: null,
  gravadaEm: '2026-10-25T07:00',
  vigenciaInicio: '2026-10-25T07:00',
  vigenciaFim: '2026-10-26T06:59',
  suspensaEm: null,
  caracteristicas: [],
  ...x,
});
const SEM_AGENDA = { cirurgias: [], exames: [] };
const REGRA = { horasCirurgia: 8, horasExame: 8, examesComJejum: new Set(['USABD']) };
const internado = {
  internacao: 501,
  paciente: 9001,
  nome: 'PACIENTE SINTETICO UM',
  nascimento: '1950-01-01',
  prontuario: 7001,
  leito: { bloco: '2A', acomodacao: '201', leito: 'B' },
};
const ctx = {
  servirEm: '2026-10-25T11:45',
  corteEm: '2026-10-25T09:45',
  agora: '2026-10-25T09:00',
  regraJejum: REGRA,
  refeicao: 2,
  data: '2026-10-25',
};

describe('tipo da linha pelo tipo de lançamento', () => {
  it('jejum, livre, oral, enteral e parenteral; o resto não é dieta', () => {
    expect([1, 2, 3, 4, 5, 6].map(tipoDoPlanoDieta)).toEqual([
      'jejum',
      'livre',
      'oral',
      'enteral',
      'parenteral',
      null,
    ]);
  });
});

describe('a última prescrição válida até o corte (regra 11)', () => {
  const oral = item({ item: 1, plano: 3 });
  const enteral = item({ item: 2, plano: 4, nomeDieta: 'DIETA ENTERAL', gravadaEm: '2026-10-25T08:30' });
  it('a gravada por último até o instante vale; a gravada depois não', () => {
    expect(dietaNoInstante([oral, enteral], ctx.servirEm, '2026-10-25T09:45')?.item).toBe(2);
    expect(dietaNoInstante([oral, enteral], ctx.servirEm, '2026-10-25T08:00')?.item).toBe(1);
  });
  it('fora da vigência na hora de servir, suspensa até o instante ou não dieta: não vale', () => {
    const fora = item({ item: 3, plano: 3, vigenciaInicio: '2026-10-25T12:00' });
    const suspensa = item({
      item: 4,
      plano: 3,
      gravadaEm: '2026-10-25T08:59',
      suspensaEm: '2026-10-25T09:30',
    });
    const medicamento = item({ item: 5, plano: 6, gravadaEm: '2026-10-25T09:00' });
    expect(dietaNoInstante([oral, fora, suspensa, medicamento], ctx.servirEm, '2026-10-25T09:45')?.item).toBe(
      1,
    );
    // A suspensão depois do instante ainda não valia.
    expect(dietaNoInstante([oral, suspensa], ctx.servirEm, '2026-10-25T09:00')?.item).toBe(4);
    expect(dietaNoInstante([], ctx.servirEm, ctx.agora)).toBeNull();
  });
  it('o jejum prescrito prevalece sobre a dieta gravada depois', () => {
    const jejum = item({ item: 6, plano: 1, nomeDieta: 'JEJUM / DIETA ZERO', gravadaEm: '2026-10-25T07:30' });
    expect(dietaNoInstante([jejum, enteral], ctx.servirEm, '2026-10-25T09:45')?.item).toBe(6);
  });
  it('empate na gravação: o item mais recente', () => {
    const a = item({ item: 7, plano: 3 });
    const b = item({ item: 8, plano: 2, nomeDieta: 'DIETA LIVRE' });
    expect(dietaNoInstante([a, b], ctx.servirEm, ctx.agora)?.item).toBe(8);
  });
});

describe('jejum agendado (bloco e exames) prevalece', () => {
  it('cirurgia nas 8 h seguintes ou em andamento: jejum de cirurgia', () => {
    const c = { inicio: '2026-10-25T19:00', duracaoMin: 120, descricao: 'Sala 2' };
    expect(jejumAgendado('2026-10-25T11:45', { cirurgias: [c], exames: [] }, REGRA)).toMatchObject({
      origem: 'cirurgia',
      procedimentoEm: '2026-10-25T19:00',
    });
    expect(jejumAgendado('2026-10-25T20:00', { cirurgias: [c], exames: [] }, REGRA)?.origem).toBe('cirurgia');
    expect(jejumAgendado('2026-10-25T21:30', { cirurgias: [c], exames: [] }, REGRA)).toBeNull();
    expect(jejumAgendado('2026-10-25T07:00', { cirurgias: [c], exames: [] }, REGRA)).toBeNull();
  });
  it('exame que pede jejum nas 8 h seguintes; exame fora da lista não', () => {
    const e = { inicio: '2026-10-25T14:00', exame: 'usabd', descricao: 'Ultrassom' };
    expect(jejumAgendado('2026-10-25T11:45', { cirurgias: [], exames: [e] }, REGRA)?.origem).toBe('exame');
    expect(jejumAgendado('2026-10-25T14:30', { cirurgias: [], exames: [e] }, REGRA)).toBeNull();
    expect(
      jejumAgendado('2026-10-25T11:45', { cirurgias: [], exames: [{ ...e, exame: 'RX' }] }, REGRA),
    ).toBeNull();
  });
  it('a lista de exames do parâmetro', () => {
    expect([...examesComJejum(' usabd, ENDO ,,')]).toEqual(['USABD', 'ENDO']);
    expect(examesComJejum(null).size).toBe(0);
  });
});

describe('refeições e cortes por unidade', () => {
  const cadastro = [
    { codigo: 2, nome: 'Almoço', horario: '1145' },
    { codigo: 1, nome: 'Café da manhã', horario: '0700' },
    { codigo: 0, nome: 'Nao informada', horario: null },
    { codigo: 6, nome: 'Ceia', horario: '20:00' },
  ];
  it('o horário do cadastro, a antecedência padrão e o corte próprio da unidade', () => {
    const r = refeicoesComCorte(cadastro, 120, cortesProprios('2=09:30;x=1;6=21:15;5=99:00'));
    expect(r).toEqual([
      { codigo: 1, nome: 'Café da manhã', horario: '07:00', corte: '05:00' },
      { codigo: 2, nome: 'Almoço', horario: '11:45', corte: '09:30' },
      { codigo: 6, nome: 'Ceia', horario: '20:00', corte: '21:15' },
    ]);
  });
  it('o corte depois do horário cai no dia anterior; antecedência que passa da meia-noite', () => {
    expect(
      instantesDaRefeicao('2026-10-25', { codigo: 6, nome: 'Ceia', horario: '20:00', corte: '21:15' }),
    ).toEqual({
      servirEm: '2026-10-25T20:00',
      corteEm: '2026-10-24T21:15',
    });
    expect(
      refeicoesComCorte([{ codigo: 1, nome: 'Madrugada', horario: '0030' }], 120, new Map())[0]?.corte,
    ).toBe('22:30');
    expect(horaRefeicao('2460')).toBeNull();
    expect(cortesProprios(undefined).size).toBe(0);
  });
});

describe('a linha do internado', () => {
  const oral = item({
    item: 1,
    plano: 3,
    caracteristicas: [
      { nome: 'Branda', resposta: null },
      { nome: 'Hipossódica', resposta: null },
    ],
  });
  it('antes do corte: a dieta de agora; alergia alimentar e acompanhante do dia', () => {
    const l = linhaDoMapa(
      internado,
      [oral],
      SEM_AGENDA,
      ['Leite', ' Leite ', 'Amendoim'],
      { id: 3, baseLegal: 'idoso', refeicoes: [1, 2, 5], inicio: '2026-10-24', fim: null },
      ctx,
    );
    expect(l).toMatchObject({
      tipo: 'oral',
      dieta: 'DIETA ORAL',
      itemDieta: 10,
      jejum: null,
      alergiasAlimentares: ['Amendoim', 'Leite'],
      mudouDepoisDoCorte: false,
      prescritoEm: '2026-10-25T07:00',
    });
    expect(l.acompanhante?.baseLegal).toBe('idoso');
    expect(caracteristicasTexto(l)).toBe('Branda, Hipossódica');
  });
  it('depois do corte: a do corte vale e a mudança alerta; o jejum de cirurgia prevalece', () => {
    const enteral = item({ item: 2, plano: 4, nomeDieta: 'DIETA ENTERAL', gravadaEm: '2026-10-25T10:10' });
    const depois = { ...ctx, agora: '2026-10-25T10:30' };
    const l = linhaDoMapa(internado, [oral, enteral], SEM_AGENDA, [], null, depois);
    expect(l).toMatchObject({ tipo: 'oral', itemDieta: 10, mudouDepoisDoCorte: true, acompanhante: null });
    const comCirurgia = linhaDoMapa(
      internado,
      [oral],
      { cirurgias: [{ inicio: '2026-10-25T15:00', duracaoMin: 90, descricao: 'Sala 1' }], exames: [] },
      [],
      null,
      depois,
    );
    expect(comCirurgia).toMatchObject({ tipo: 'jejum', dieta: 'DIETA ORAL', jejum: { origem: 'cirurgia' } });
  });
  it('jejum prescrito e sem prescrição', () => {
    const jejum = item({ item: 9, plano: 1, nomeDieta: 'JEJUM / DIETA ZERO' });
    expect(linhaDoMapa(internado, [jejum], SEM_AGENDA, [], null, ctx)).toMatchObject({
      tipo: 'jejum',
      jejum: { origem: 'prescrito', descricao: 'JEJUM / DIETA ZERO', procedimentoEm: null },
    });
    const vazia = linhaDoMapa(internado, [], SEM_AGENDA, [], null, ctx);
    expect(vazia).toMatchObject({ tipo: 'sem-prescricao', dieta: null, itemDieta: null, prescritoEm: null });
    expect(caracteristicasTexto(vazia)).toBeNull();
  });
  it('acompanhante fora do período ou da refeição não entra', () => {
    const a = { id: 1, baseLegal: 'idoso' as const, refeicoes: [1], inicio: '2026-10-20', fim: '2026-10-24' };
    expect(acompanhanteNaRefeicao(a, 1, '2026-10-25')).toBe(false);
    expect(acompanhanteNaRefeicao({ ...a, fim: null }, 2, '2026-10-25')).toBe(false);
    expect(acompanhanteNaRefeicao({ ...a, fim: null }, 1, '2026-10-19')).toBe(false);
    expect(acompanhanteNaRefeicao({ ...a, fim: null }, 1, '2026-10-25')).toBe(true);
  });
});

describe('contagens, hash do retrato e alertas', () => {
  const l1 = linhaDoMapa(internado, [item({ item: 1, plano: 3 })], SEM_AGENDA, [], null, ctx);
  const l2 = linhaDoMapa(
    { ...internado, internacao: 502, nome: 'PACIENTE SINTETICO DOIS' },
    [item({ item: 4, plano: 1, nomeDieta: 'JEJUM' })],
    SEM_AGENDA,
    ['Ovo'],
    null,
    ctx,
  );
  it('as contagens por tipo', () => {
    expect(contagensDoMapa([l1, l2])).toMatchObject({ oral: 1, jejum: 1, enteral: 0, 'sem-prescricao': 0 });
  });
  it('o conteúdo canônico não tem nome nem nascimento e não depende da ordem; o hash em 64 hexadecimais', async () => {
    const c = conteudoCanonicoMapa([l2, l1]);
    expect(c).toBe(conteudoCanonicoMapa([l1, l2]));
    expect(c).not.toContain('SINTETICO');
    expect(c).not.toContain('1950');
    expect(await hashDoMapa([l1, l2])).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashDoMapa([l1])).not.toBe(await hashDoMapa([l1, l2]));
  });
  it('sem retrato: só a mudança depois do corte alerta; com retrato: o item diferente e quem não estava', () => {
    const mudou = { ...l1, mudouDepoisDoCorte: true };
    const agora = new Map([
      [501, { descricao: 'DIETA ENTERAL', gravadaEm: '2026-10-25T10:10', itemDieta: 20 }],
      [502, { descricao: 'JEJUM', gravadaEm: '2026-10-25T07:00', itemDieta: 40 }],
    ]);
    expect(alertasDoMapa([mudou, l2], agora, null)).toEqual([
      {
        internacao: 501,
        nome: l1.nome,
        leito: l1.leito,
        antes: 'DIETA ORAL',
        agora: 'DIETA ENTERAL',
        prescritoEm: '2026-10-25T10:10',
      },
    ]);
    const retrato = [
      {
        internacao: 501,
        tipo: 'oral' as const,
        itemDieta: 10,
        dieta: 'DIETA ORAL',
        caracteristicas: 'Branda',
      },
    ];
    const a = alertasDoMapa([l1, l2], agora, retrato);
    expect(a.map((x) => [x.internacao, x.antes, x.agora])).toEqual([
      [501, 'DIETA ORAL · Branda', 'DIETA ENTERAL'],
      [502, 'Fora do mapa fechado', 'JEJUM'],
    ]);
    const vazio = [
      {
        internacao: 501,
        tipo: 'sem-prescricao' as const,
        itemDieta: null,
        dieta: null,
        caracteristicas: null,
      },
    ];
    expect(alertasDoMapa([l1], new Map(), vazio)).toEqual([]);
    expect(
      alertasDoMapa([l1], new Map([[501, { descricao: 'X', gravadaEm: null, itemDieta: 3 }]]), vazio)[0]
        ?.antes,
    ).toBe('Sem dieta prescrita');
  });
  it('com retrato: quem estava no retrato e saiu da unidade (alta ou transferência) alerta a copa', () => {
    const retrato = [
      { internacao: 501, tipo: 'oral' as const, itemDieta: 10, dieta: 'DIETA ORAL', caracteristicas: null },
      {
        internacao: 503,
        tipo: 'oral' as const,
        itemDieta: 30,
        dieta: 'DIETA ORAL',
        caracteristicas: 'Branda',
        nome: 'PACIENTE SINTETICO TRES',
        leito: { bloco: '2A', acomodacao: '203', leito: 'A' },
      },
      {
        internacao: 504,
        tipo: 'sem-prescricao' as const,
        itemDieta: null,
        dieta: null,
        caracteristicas: null,
      },
    ];
    const agora = new Map([[501, { descricao: 'DIETA ORAL', gravadaEm: null, itemDieta: 10 }]]);
    const a = alertasDoMapa([l1], agora, retrato);
    expect(a).toEqual([
      {
        internacao: 503,
        nome: 'PACIENTE SINTETICO TRES',
        leito: { bloco: '2A', acomodacao: '203', leito: 'A' },
        antes: 'DIETA ORAL · Branda',
        agora: SAIU_DA_UNIDADE,
        prescritoEm: null,
      },
      {
        internacao: 504,
        nome: 'Internação 504',
        leito: { bloco: '', acomodacao: '', leito: '' },
        antes: 'Sem dieta prescrita',
        agora: SAIU_DA_UNIDADE,
        prescritoEm: null,
      },
    ]);
  });
  it('a janela do fechamento: do corte até a tolerância depois de servir (o mapa de dias atrás não fecha)', () => {
    expect(janelaDoFechamento('2026-10-25T11:45', '2026-10-25T09:45', 24)).toEqual({
      abreEm: '2026-10-25T09:45',
      fechaEm: '2026-10-26T11:45',
    });
    expect(janelaDoFechamento('2026-10-25T07:00', '2026-10-24T22:00', 1).fechaEm).toBe('2026-10-25T08:00');
    expect(janelaDoFechamento('2026-10-31T23:00', '2026-10-31T21:00', 2).fechaEm).toBe('2026-11-01T01:00');
  });
  it('a descrição de agora', () => {
    expect(descricaoAgora([], ctx.servirEm, ctx.agora)).toEqual({
      descricao: 'Sem dieta prescrita',
      gravadaEm: null,
    });
    expect(
      descricaoAgora(
        [item({ item: 1, plano: 3, caracteristicas: [{ nome: 'Pastosa', resposta: null }] })],
        ctx.servirEm,
        ctx.agora,
      ),
    ).toEqual({ descricao: 'DIETA ORAL · Pastosa', gravadaEm: '2026-10-25T07:00' });
  });
});

describe('direito legal do acompanhante (regra 12)', () => {
  it('idoso a partir de 60; criança ou adolescente até 17; as declaradas passam', () => {
    expect(() => conferirDireitoLegal('idoso', 60)).not.toThrow();
    expect(() => conferirDireitoLegal('idoso', 59)).toThrow(ErroMapa);
    expect(() => conferirDireitoLegal('idoso', null)).toThrow(/60 anos/);
    expect(() => conferirDireitoLegal('crianca-adolescente', 17)).not.toThrow();
    expect(() => conferirDireitoLegal('crianca-adolescente', 18)).toThrow(/17 anos/);
    expect(() => conferirDireitoLegal('crianca-adolescente', null)).toThrow(ErroMapa);
    expect(() => conferirDireitoLegal('parturiente', 30)).not.toThrow();
    expect(() => conferirDireitoLegal('pessoa-deficiencia', null)).not.toThrow();
  });
});
