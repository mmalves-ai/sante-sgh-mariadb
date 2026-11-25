// F78.04-1: formulários de declaração de óbito, auditoria do isolamento e evolução da regulação (regra pura).
import { describe, expect, it } from 'vitest';
import {
  avaliarAuditoriaIsolamento,
  conferirQuadroClinico,
  type CriterioAuditoria,
  decidirAcaoFormularioObito,
  conferirEnvioManual,
  decidirEventoRegulacao,
  gravidadeSugerida,
  marcasDaSituacao,
  numerosDoLote,
  proximaReauditoria,
  resumoFormulariosObito,
} from './controles-assistenciais.js';

describe('formulários de declaração de óbito (04-INT linha 74)', () => {
  it('lote: números com zeros à esquerda; recusa invertido, tamanhos diferentes e lote grande', () => {
    expect(numerosDoLote('000998', '001001')).toEqual({
      ok: true,
      numeros: ['000998', '000999', '001000', '001001'],
    });
    expect(numerosDoLote('10', '09')).toMatchObject({ ok: false, codigo: 'lote-invertido' });
    expect(numerosDoLote('10', '100')).toMatchObject({ ok: false, codigo: 'numero-invalido' });
    expect(numerosDoLote('1A', '1B')).toMatchObject({ ok: false, codigo: 'numero-invalido' });
    expect(numerosDoLote('0000', '0600')).toMatchObject({ ok: false, codigo: 'lote-grande' });
  });

  it('usar: só disponível, declaração vigente de mesmo número e sem formulário', () => {
    const d = { numero: '123', situacao: 'emitida' as const, jaTemFormulario: false };
    expect(
      decidirAcaoFormularioObito('disponivel', 'usar', { numeroFormulario: '123', declaracao: d }),
    ).toEqual({
      ok: true,
      nova: 'utilizado',
      motivo: null,
    });
    expect(
      decidirAcaoFormularioObito('disponivel', 'usar', { numeroFormulario: '124', declaracao: d }),
    ).toMatchObject({ codigo: 'numero-divergente' });
    expect(
      decidirAcaoFormularioObito('disponivel', 'usar', {
        numeroFormulario: '123',
        declaracao: { ...d, situacao: 'cancelada' },
      }),
    ).toMatchObject({ codigo: 'declaracao-cancelada' });
    expect(
      decidirAcaoFormularioObito('disponivel', 'usar', {
        numeroFormulario: '123',
        declaracao: { ...d, jaTemFormulario: true },
      }),
    ).toMatchObject({ codigo: 'declaracao-com-formulario' });
    expect(
      decidirAcaoFormularioObito('extraviado', 'usar', { numeroFormulario: '123', declaracao: d }),
    ).toMatchObject({ codigo: 'formulario-indisponivel' });
  });

  it('extravio e cancelamento pedem motivo; utilizado só cancela com a declaração cancelada; devolução', () => {
    expect(
      decidirAcaoFormularioObito('disponivel', 'extraviar', { numeroFormulario: '1', motivo: 'curto' }),
    ).toMatchObject({
      codigo: 'motivo-obrigatorio',
    });
    expect(
      decidirAcaoFormularioObito('disponivel', 'extraviar', {
        numeroFormulario: '1',
        motivo: 'Não encontrado no bloco',
      }),
    ).toMatchObject({ ok: true, nova: 'extraviado' });
    expect(
      decidirAcaoFormularioObito('utilizado', 'cancelar', {
        numeroFormulario: '1',
        motivo: 'Preenchimento com erro',
        declaracao: { numero: '1', situacao: 'emitida', jaTemFormulario: true },
      }),
    ).toMatchObject({ codigo: 'declaracao-vigente' });
    expect(
      decidirAcaoFormularioObito('utilizado', 'cancelar', {
        numeroFormulario: '1',
        motivo: 'Preenchimento com erro',
        declaracao: { numero: '1', situacao: 'cancelada', jaTemFormulario: true },
      }),
    ).toMatchObject({ ok: true, nova: 'cancelado' });
    expect(decidirAcaoFormularioObito('cancelado', 'devolver', { numeroFormulario: '1' })).toMatchObject({
      ok: true,
      nova: 'devolvido',
    });
    expect(decidirAcaoFormularioObito('utilizado', 'devolver', { numeroFormulario: '1' })).toMatchObject({
      codigo: 'transicao-invalida',
    });
    expect(
      decidirAcaoFormularioObito('devolvido', 'cancelar', { numeroFormulario: '1', motivo: 'x'.repeat(12) }),
    ).toMatchObject({
      codigo: 'transicao-invalida',
    });
  });

  it('resumo: contagem, vias a devolver e estoque baixo', () => {
    const r = resumoFormulariosObito(['disponivel', 'disponivel', 'cancelado', 'utilizado'], 3);
    expect(r.porSituacao).toMatchObject({ disponivel: 2, cancelado: 1, utilizado: 1 });
    expect(r.viasADevolver).toBe(1);
    expect(r.estoqueBaixo).toBe(true);
  });
});

describe('auditoria do isolamento (04-INT linha 75)', () => {
  const criterios: CriterioAuditoria[] = [
    { id: 1, descricao: 'Placa na porta', acao: 'registrar', validadeDias: 7 },
    { id: 2, descricao: 'Avental disponível', acao: 'alertar', validadeDias: 3 },
    { id: 3, descricao: 'Quarto privativo', acao: 'bloquear', validadeDias: null },
    { id: 4, descricao: 'Higiene das mãos', acao: 'registrar', validadeDias: null },
    { id: 5, descricao: 'Luvas', acao: 'registrar', validadeDias: null },
    { id: 6, descricao: 'Bandeja exclusiva', acao: 'registrar', validadeDias: null },
  ];
  const tudo = (resposta: 'conforme' | 'nao_conforme' | 'nao_se_aplica') =>
    criterios.map((c) => ({
      criterio: c.id,
      resposta,
      naoConformidade: resposta === 'nao_conforme' ? 'falha' : null,
    }));

  it('tudo conforme: 100% conforme; recusa isolamento inativo, critério faltando, repetido ou alheio', () => {
    expect(avaliarAuditoriaIsolamento(true, criterios, tudo('conforme'))).toEqual({
      ok: true,
      percentual: 100,
      geral: 'conforme',
      alertas: [],
    });
    expect(avaliarAuditoriaIsolamento(false, criterios, tudo('conforme'))).toMatchObject({
      codigo: 'isolamento-inativo',
    });
    expect(avaliarAuditoriaIsolamento(true, criterios, tudo('conforme').slice(1))).toMatchObject({
      codigo: 'criterio-sem-resposta',
    });
    expect(
      avaliarAuditoriaIsolamento(true, criterios, [
        ...tudo('conforme'),
        { criterio: 1, resposta: 'conforme' },
      ]),
    ).toMatchObject({ codigo: 'criterio-repetido' });
    expect(
      avaliarAuditoriaIsolamento(true, criterios, [
        ...tudo('conforme'),
        { criterio: 99, resposta: 'conforme' },
      ]),
    ).toMatchObject({ codigo: 'criterio-alheio' });
    expect(avaliarAuditoriaIsolamento(true, [], [])).toMatchObject({ codigo: 'sem-criterios' });
  });

  it('não conforme sem descrição recusa; percentual sem os não se aplica; alerta; bloqueio derruba', () => {
    const r = tudo('conforme').map((x) =>
      x.criterio === 4 ? { ...x, resposta: 'nao_conforme' as const } : x,
    );
    expect(avaliarAuditoriaIsolamento(true, criterios, r)).toMatchObject({
      codigo: 'nao-conformidade-sem-descricao',
    });
    const parcial = tudo('conforme').map((x) =>
      x.criterio === 2
        ? { ...x, resposta: 'nao_conforme' as const, naoConformidade: 'Sem avental' }
        : x.criterio === 6
          ? { ...x, resposta: 'nao_se_aplica' as const }
          : x,
    );
    expect(avaliarAuditoriaIsolamento(true, criterios, parcial)).toEqual({
      ok: true,
      percentual: 80,
      geral: 'parcialmente_conforme',
      alertas: [{ criterio: 2, descricao: 'Avental disponível', acao: 'alertar' }],
    });
    const bloqueio = tudo('conforme').map((x) =>
      x.criterio === 3
        ? { ...x, resposta: 'nao_conforme' as const, naoConformidade: 'Quarto compartilhado' }
        : x,
    );
    expect(avaliarAuditoriaIsolamento(true, criterios, bloqueio)).toMatchObject({ geral: 'nao_conforme' });
    expect(avaliarAuditoriaIsolamento(true, criterios, tudo('nao_se_aplica'))).toMatchObject({
      percentual: null,
      geral: 'conforme',
    });
  });

  it('reauditoria pelo menor prazo dos critérios', () => {
    const d = new Date('2026-11-24T10:00:00Z');
    expect(proximaReauditoria(d, criterios)?.toISOString()).toBe('2026-11-27T10:00:00.000Z');
    expect(proximaReauditoria(d, [criterios[3]!])).toBeNull();
  });
});

describe('regulação: quadro clínico e evolução (04-INT linha 78)', () => {
  const q = {
    quadroClinico: 'Dispneia progressiva há dois dias, febril.',
    condicaoGeral: 'estavel' as const,
  };

  it('quadro: texto, oxigênio, PEEP, droga, germes, faixas e aviso de gravidade', () => {
    expect(conferirQuadroClinico({ ...q, quadroClinico: 'curto' })).toMatchObject({ codigo: 'quadro-curto' });
    expect(conferirQuadroClinico({ ...q, fracaoInspirada: 40 })).toMatchObject({
      codigo: 'sem-suporte-oxigenio',
    });
    expect(conferirQuadroClinico({ ...q, suporteOxigenio: 1, peep: 8 })).toMatchObject({
      codigo: 'peep-sem-ventilacao',
    });
    expect(conferirQuadroClinico({ ...q, usaDrogaVasoativa: true })).toMatchObject({
      codigo: 'droga-sem-descricao',
    });
    expect(conferirQuadroClinico({ ...q, germes: [1, 1] })).toMatchObject({ codigo: 'germe-repetido' });
    expect(conferirQuadroClinico({ ...q, germeMultirresistente: 'KPC' })).toMatchObject({
      codigo: 'multirresistente-sem-isolamento',
    });
    expect(conferirQuadroClinico({ ...q, saturacao: 120 })).toMatchObject({ codigo: 'sinal-fora-da-faixa' });
    expect(conferirQuadroClinico({ ...q, pressaoSistolica: 80, pressaoDiastolica: 90 })).toMatchObject({
      codigo: 'pressao-invertida',
    });
    const r = conferirQuadroClinico({ ...q, saturacao: 88, suporteOxigenio: 2, fracaoInspirada: 60 });
    expect(r).toMatchObject({ ok: true, sugerida: 'grave' });
    expect((r as { aviso: string }).aviso).toContain('grave');
    expect(conferirQuadroClinico({ ...q, condicaoGeral: 'grave', saturacao: 88 })).toMatchObject({
      aviso: null,
    });
  });

  it('gravidade sugerida', () => {
    expect(gravidadeSugerida({ ...q, usaDrogaVasoativa: true })).toBe('critico');
    expect(gravidadeSugerida({ ...q, frequenciaCardiaca: 130 })).toBe('instavel');
    expect(gravidadeSugerida(q)).toBe('estavel');
  });

  it('evento: transições, cancelamento com motivo, encerrada não recebe', () => {
    expect(decidirEventoRegulacao('solicitada', 'mudanca_situacao', 'em_analise', null)).toEqual({
      ok: true,
      situacaoNova: 'em_analise',
    });
    expect(decidirEventoRegulacao('em_analise', 'mudanca_situacao', 'concluida', null)).toMatchObject({
      codigo: 'transicao-invalida',
    });
    expect(decidirEventoRegulacao('solicitada', 'mudanca_situacao', 'cancelada', null)).toMatchObject({
      codigo: 'use-cancelamento',
    });
    expect(decidirEventoRegulacao('autorizada', 'cancelamento', null, 'curto')).toMatchObject({
      codigo: 'motivo-obrigatorio',
    });
    expect(decidirEventoRegulacao('autorizada', 'cancelamento', null, 'Paciente evoluiu a óbito')).toEqual({
      ok: true,
      situacaoNova: 'cancelada',
    });
    expect(decidirEventoRegulacao('negada', 'resposta', null, 'Nova tentativa')).toMatchObject({
      codigo: 'regulacao-encerrada',
    });
    expect(decidirEventoRegulacao('solicitada', 'contato_central', 'autorizada', 'Ligação')).toMatchObject({
      codigo: 'contato-sem-situacao',
    });
    expect(
      decidirEventoRegulacao('em_analise', 'resposta', 'autorizada', 'Vaga liberada no hospital X'),
    ).toEqual({
      ok: true,
      situacaoNova: 'autorizada',
    });
    expect(marcasDaSituacao('negada')).toEqual({ regulado: true, encerrado: true });
    expect(marcasDaSituacao('em_analise')).toEqual({ regulado: false, encerrado: false });
  });

  it('envio manual à central: só no contato, nem no futuro nem antes da solicitação', () => {
    const agora = new Date('2026-11-25T10:00:00Z');
    const pedido = new Date('2026-11-25T08:00:00Z');
    expect(conferirEnvioManual('contato_central', null, pedido, agora)).toEqual({ ok: true });
    expect(conferirEnvioManual('contato_central', new Date('2026-11-25T09:30:00Z'), pedido, agora)).toEqual({
      ok: true,
    });
    expect(conferirEnvioManual('contato_central', new Date('2026-11-25T10:03:00Z'), pedido, agora)).toEqual({
      ok: true,
    });
    expect(
      conferirEnvioManual('contato_central', new Date('2026-11-25T11:00:00Z'), pedido, agora),
    ).toMatchObject({ codigo: 'envio-no-futuro' });
    expect(
      conferirEnvioManual('contato_central', new Date('2026-11-25T07:00:00Z'), pedido, agora),
    ).toMatchObject({ codigo: 'envio-antes-da-solicitacao' });
    expect(conferirEnvioManual('resposta', new Date('2026-11-25T09:30:00Z'), pedido, agora)).toMatchObject({
      codigo: 'envio-so-no-contato',
    });
    expect(conferirEnvioManual('contato_central', new Date('x'), pedido, agora)).toMatchObject({
      codigo: 'envio-invalido',
    });
  });
});
