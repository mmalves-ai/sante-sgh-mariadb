// M20: regras puras do atendimento externo (ficha, seção 10): caráter, conta, desfecho e ato médico, fila do
// consultório, herança, observação abaixo de 24 h e o quadro do PA. Dados sintéticos.
import { describe, expect, it } from 'vitest';
import { caraterGravado, caraterSugerido, rotuloCarater } from './carater.js';
import { avisoContaSemLancamento, permiteLancar, rotuloConta, situacaoDaConta } from './conta-aberta.js';
import { desfechosPermitidos, motivoAltaDoDesfecho, podeRegistrarDesfecho } from './desfecho.js';
import { esperaMinutos, ordenarFilaConsultorio, podeChamar, situacaoPelaLetra } from './fila-consultorio.js';
import { aplicarHeranca, camposHerdados, resolverHeranca, versaoHeranca } from './heranca.js';
import { alertaObservacao, exigeJustificativaSaida, horasDeObservacao } from './observacao.js';
import { colunaDaEtapa, etapaAtual, montarQuadro, ordenarPa, podeRegistrarEtapa } from './quadro.js';

describe('caráter do atendimento (regra 5)', () => {
  it('gravado como o legado (2 eletivo, 3 urgência); os antigos são "não informado"; o PA sugere urgência', () => {
    expect(caraterGravado('eletivo')).toBe(2);
    expect(caraterGravado('urgencia')).toBe(3);
    expect(() => caraterGravado('x' as never)).toThrow(/desconhecido/);
    expect(rotuloCarater(3)).toBe('Urgência ou emergência');
    for (const v of [null, undefined, 0, 1, 4]) expect(rotuloCarater(v)).toBe('Não informado');
    expect(caraterSugerido('pa')).toBe('urgencia');
    expect(caraterSugerido('consulta')).toBe('eletivo');
  });
});

describe('conta antes do lançamento (regra 2)', () => {
  it('a emissão vence a abertura; fechada, apresentada e sem conta não lançam, com o aviso', () => {
    expect(situacaoDaConta(null)).toBe('semConta');
    expect(situacaoDaConta({ fechada: null, emitida: null })).toBe('semConta');
    expect(situacaoDaConta({ fechada: 'N', emitida: 'F' })).toBe('aberta');
    expect(situacaoDaConta({ fechada: 'N', emitida: 'T' })).toBe('emitida');
    expect(situacaoDaConta({ fechada: 'S', emitida: 'T' })).toBe('fechada');
    expect(situacaoDaConta({ fechada: 'A', emitida: 'T' })).toBe('apresentada');
    expect(situacaoDaConta({ fechada: 'Z', emitida: null })).toBe('fechada');
    expect(permiteLancar('aberta')).toBe(true);
    for (const s of ['fechada', 'apresentada', 'emitida', 'semConta'] as const) {
      expect(permiteLancar(s)).toBe(false);
      expect(avisoContaSemLancamento(s)).toMatch(/conta/);
    }
    expect(avisoContaSemLancamento('aberta')).toBeNull();
    expect(rotuloConta('aberta')).toBe('Conta aberta');
  });
});

describe('desfecho e ato médico (Lei 12.842/2013)', () => {
  const recepcao = { desfechoMedico: false, conselhoAtivo: false };
  const medico = { desfechoMedico: true, conselhoAtivo: true };
  it('a recepção registra evasão e encerramento administrativo; o médico com conselho ativo, todos', () => {
    expect(desfechosPermitidos(recepcao)).toEqual(['evasao', 'administrativo']);
    expect(desfechosPermitidos(medico)).toHaveLength(7);
    expect(podeRegistrarDesfecho('alta', recepcao).motivo).toMatch(/ato médico/);
    expect(podeRegistrarDesfecho('alta', { desfechoMedico: true, conselhoAtivo: false }).motivo).toMatch(
      /conselho/,
    );
    expect(podeRegistrarDesfecho('x' as never, medico)).toEqual({
      pode: false,
      motivo: 'Desfecho desconhecido.',
    });
    expect(motivoAltaDoDesfecho('evasao')).toBe(16);
    expect(motivoAltaDoDesfecho('internacao')).toBeNull();
  });
});

describe('fila do consultório', () => {
  it('em atendimento, chamados, aguardando por prioridade e hora; liberados no fim', () => {
    const i = (
      reg: number,
      situacao: ReturnType<typeof situacaoPelaLetra>,
      prioridade: '0' | '1' | '2',
      chegada: string,
      agendadoPara: string | null = null,
    ) => ({
      reg,
      situacao,
      prioridade,
      chegada,
      agendadoPara,
    });
    const r = ordenarFilaConsultorio([
      i(1, 'liberado', '0', '2026-10-22T07:00:00'),
      i(2, 'aguardando', '2', '2026-10-22T07:10:00'),
      i(3, 'aguardando', '0', '2026-10-22T07:30:00'),
      i(4, 'chamado', '2', '2026-10-22T07:40:00'),
      i(5, 'emAtendimento', '2', '2026-10-22T07:50:00'),
      i(6, 'aguardando', '2', '2026-10-22T07:20:00', '2026-10-22T07:05:00'),
      i(7, 'aguardando', '2', '2026-10-22T07:10:00'),
    ]);
    expect(r.map((x) => x.reg)).toEqual([5, 4, 3, 6, 2, 7, 1]);
    expect(['C', 'A', 'L', 'X', null].map(situacaoPelaLetra)).toEqual([
      'chamado',
      'emAtendimento',
      'liberado',
      'aguardando',
      'aguardando',
    ]);
    expect(esperaMinutos('2026-10-22T07:00:00', '2026-10-22T07:45:30')).toBe(45);
    expect(esperaMinutos('2026-10-22T08:00:00Z', '2026-10-22T07:00:00Z')).toBe(0);
    expect(esperaMinutos('x', 'y')).toBe(0);
    expect(podeChamar('aguardando')).toBe(true);
    expect(podeChamar('chamado')).toBe(true);
    expect(podeChamar('emAtendimento')).toBe(false);
  });
});

describe('herança do atendimento anterior', () => {
  it('só os campos marcados e com valor no anterior', () => {
    const marcas = { fonte_pagadora: true, profissional: true, carteira: false, plano: true, empresa: null };
    expect(camposHerdados(marcas)).toEqual(['convenio', 'profissional', 'plano']);
    expect(
      aplicarHeranca(marcas, { convenio: 306, profissional: 0, plano: '', matricula: 'X' }, '2026-11-24'),
    ).toEqual({ valores: { convenio: 306 }, avisos: [] });
    expect(aplicarHeranca(marcas, null, '2026-11-24')).toEqual({ valores: {}, avisos: [] });
  });

  it('plano, carteirinha e validade só vêm junto com a fonte pagadora', () => {
    const anterior = { convenio: 306, plano: 'OURO', matricula: '123', validadeCarteira: '2027-01-31' };
    const sem = { fonte_pagadora: false, plano: true, carteira: true, validade_carteira: true };
    const r = aplicarHeranca(sem, anterior, '2026-11-24');
    expect(r.valores).toEqual({});
    expect(r.avisos).toEqual([
      'Plano e carteirinha não foram trazidos: só valem com o convênio do atendimento anterior.',
    ]);
    const com = aplicarHeranca({ ...sem, fonte_pagadora: true }, anterior, '2026-11-24');
    expect(com).toEqual({
      valores: { convenio: 306, matricula: '123', plano: 'OURO', validadeCarteira: '2027-01-31' },
      avisos: [],
    });
    // Anterior sem fonte pagadora: a cobertura dele também não vem.
    expect(aplicarHeranca({ ...sem, fonte_pagadora: true }, { plano: 'OURO' }, '2026-11-24').valores).toEqual(
      {},
    );
  });

  it('a validade vencida não é herdada e vira aviso; a do próprio dia ainda vale', () => {
    const marcas = { fonte_pagadora: true, carteira: true, validade_carteira: true };
    const r = aplicarHeranca(
      marcas,
      { convenio: 306, matricula: '123', validadeCarteira: '2026-11-23' },
      '2026-11-24',
    );
    expect(r.valores).toEqual({ convenio: 306, matricula: '123' });
    expect(r.avisos).toEqual([
      'A carteirinha do atendimento anterior venceu em 23/11/2026: confira a validade nova.',
    ]);
    expect(
      aplicarHeranca(marcas, { convenio: 306, validadeCarteira: '2026-11-24' }, '2026-11-24').valores,
    ).toEqual({ convenio: 306, validadeCarteira: '2026-11-24' });
  });

  it('a guia nunca é herdada (é de cada evento com o convênio)', () => {
    expect(camposHerdados({ guia: true, fonte_pagadora: true })).toEqual(['convenio']);
    expect(
      resolverHeranca([{ campo: 'guia', herda: true, estabelecimento: 1, usuario: null }], {
        estabelecimento: 1,
        usuario: null,
      })['guia'],
    ).toBeUndefined();
  });

  it('sem regra gravada: o padrão (cobertura e profissional)', () => {
    const m = resolverHeranca([], { estabelecimento: 1, usuario: 7 });
    expect(camposHerdados(m)).toEqual(['convenio', 'profissional', 'matricula', 'plano', 'validadeCarteira']);
    expect(versaoHeranca(m)).toBe('fonte_pagadora,profissional,carteira,plano,validade_carteira');
    expect(versaoHeranca({})).toBe('nenhum');
  });

  it('a regra mais específica vence, campo a campo; outro escopo é ignorado', () => {
    const m = resolverHeranca(
      [
        { campo: 'unidade', herda: true, estabelecimento: null, usuario: null },
        { campo: 'unidade', herda: false, estabelecimento: 1, usuario: null },
        { campo: 'unidade', herda: true, estabelecimento: 1, usuario: 7 },
        { campo: 'especialidade', herda: true, estabelecimento: 1, usuario: null },
        { campo: 'especialidade', herda: false, estabelecimento: null, usuario: null },
        { campo: 'plano', herda: false, estabelecimento: 2, usuario: null },
        { campo: 'carteira', herda: false, estabelecimento: null, usuario: 8 },
        { campo: 'peso', herda: true, estabelecimento: null, usuario: null },
      ],
      { estabelecimento: 1, usuario: 7 },
    );
    expect(m['unidade']).toBe(true);
    expect(m['especialidade']).toBe(true);
    expect(m['plano']).toBe(true);
    expect(m['carteira']).toBe(true);
    expect(m['peso']).toBeUndefined();
    expect(
      resolverHeranca([{ campo: 'unidade', herda: true, estabelecimento: 1, usuario: 7 }], {
        estabelecimento: 1,
        usuario: null,
      })['unidade'],
    ).toBe(false);
  });
});

describe('observação do PA (Portaria SAS 312/2002)', () => {
  it('aviso antes de 24 h, excedido a partir de 24 h; a saída pede justificativa', () => {
    expect(horasDeObservacao('2026-10-21T08:00:00', '2026-10-22T06:30:00')).toBe(22.5);
    expect(horasDeObservacao('2026-10-22T08:00:00Z', '2026-10-22T07:00:00Z')).toBe(0);
    expect(horasDeObservacao('x', '2026-10-22T07:00:00')).toBe(0);
    expect(alertaObservacao(19.9)).toBe('nenhum');
    expect(alertaObservacao(20)).toBe('aviso');
    expect(alertaObservacao(24)).toBe('excedido');
    expect(alertaObservacao(10, 8)).toBe('aviso');
    expect(exigeJustificativaSaida(23.9)).toBe(false);
    expect(exigeJustificativaSaida(24)).toBe(true);
  });
});

describe('quadro do pronto atendimento', () => {
  const agora = '2026-10-22T10:00:00';
  const a = (
    reg: number,
    prioridade: '0' | '1' | '2',
    chegada: string,
    marcas: { etapa: never; em: string }[] | { etapa: string; em: string }[],
    emObservacao = false,
  ) => ({
    reg,
    prioridade,
    chegada,
    marcas: marcas as never,
    emObservacao,
  });
  it('etapa atual pela marca mais recente; observação em curso vence; quem saiu não aparece', () => {
    const itens = [
      a(1, '2', '2026-10-22T08:00:00', []),
      a(2, '0', '2026-10-22T09:00:00', [{ etapa: 'atendimentoMedico', em: '2026-10-22T09:30:00' }]),
      a(3, '2', '2026-10-22T07:00:00', [{ etapa: 'observacao', em: '2026-10-22T08:00:00' }], true),
      a(4, '2', '2026-10-22T06:00:00', [{ etapa: 'saida', em: '2026-10-22T09:00:00' }]),
      a(5, '1', '2026-10-22T08:30:00', [{ etapa: 'exames', em: '2026-10-22T09:10:00' }], true),
      a(6, '2', '2026-10-22T08:40:00', [], true),
    ];
    const q = montarQuadro(itens, agora);
    const por = Object.fromEntries(q.map((c) => [c.codigo, c.cartoes.map((x) => x.item.reg)]));
    expect(por).toMatchObject({ aguardando: [1], atendimento: [2], exames: [5], observacao: [3, 6] });
    expect(q.flatMap((c) => c.cartoes).some((x) => x.item.reg === 4)).toBe(false);
    const c2 = q.find((c) => c.codigo === 'atendimento')?.cartoes[0];
    expect(c2).toMatchObject({ minutosNaEtapa: 30, minutosTotal: 60 });
    expect(etapaAtual(itens[0]!)).toEqual({ etapa: 'chegada', desde: '2026-10-22T08:00:00' });
    expect(colunaDaEtapa('saida')).toBe('saida');
    expect(colunaDaEtapa('chamada')).toBe('aguardando');
    expect(ordenarPa(itens).map((x) => x.reg)).toEqual([2, 5, 4, 3, 1, 6]);
    expect(podeRegistrarEtapa('exames')).toBe(true);
    expect(podeRegistrarEtapa('decisao')).toBe(false);
    expect(podeRegistrarEtapa('saida')).toBe(false);
  });
});
