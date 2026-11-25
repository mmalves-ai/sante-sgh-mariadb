// Regras do cadastro complementar da operadora (F7, 08-SGO linhas 93 a 95).
import { describe, expect, it } from 'vitest';
import {
  carenciasAplicadas,
  lerParametro,
  passoDoPedidoCartao,
  planoCancelamento,
  planoResponsavel,
  podeEfetivarCancelamento,
  podeDesistirCancelamento,
  problemasDaAssinatura,
  ADITIVOS_COM_EFEITO,
  problemasDaAbrangencia,
  problemasDoAditivo,
  problemasDoDepartamento,
  problemasDoPedidoCartao,
  valorDoParametro,
} from './cadastro-complementar.js';

const codigos = (r: readonly { codigo: string }[]) => r.map((x) => x.codigo);

describe('responsáveis da operadora', () => {
  const base = { natureza: 'fisica' as const, fim: null, numeroRegistro: 'CRM 1' };
  it('o novo responsável técnico encerra o anterior na véspera, sem sobrescrever', () => {
    const r = planoResponsavel({ ...base, tipo: 'responsavel_tecnico', inicio: '2026-06-01' }, [
      { id: 7, tipo: 'responsavel_tecnico', inicio: '2025-01-01', fim: null },
      { id: 8, tipo: 'atuario', inicio: '2025-01-01', fim: null },
    ]);
    expect(r.problemas).toEqual([]);
    expect(r.encerrar).toEqual([{ id: 7, fim: '2026-05-31' }]);
  });
  it('papel múltiplo (atuário) convive; período que começa depois sobrepõe', () => {
    expect(
      planoResponsavel({ ...base, tipo: 'atuario', inicio: '2026-01-01' }, [
        { id: 1, tipo: 'atuario', inicio: '2025-01-01', fim: null },
      ]).encerrar,
    ).toEqual([]);
    expect(
      codigos(
        planoResponsavel({ ...base, tipo: 'ouvidor', inicio: '2026-01-01' }, [
          { id: 1, tipo: 'ouvidor', inicio: '2026-03-01', fim: null },
        ]).problemas,
      ),
    ).toEqual(['periodo-sobreposto']);
  });
  it('técnico sem registro ou pessoa jurídica é recusado; fim antes do início também', () => {
    expect(
      codigos(
        planoResponsavel(
          {
            tipo: 'responsavel_tecnico',
            natureza: 'juridica',
            inicio: '2026-01-01',
            fim: '2025-01-01',
            numeroRegistro: null,
          },
          [],
        ).problemas,
      ),
    ).toEqual(['periodo-invalido', 'registro-obrigatorio', 'natureza-invalida']);
    expect(
      codigos(planoResponsavel({ ...base, tipo: 'presidente', inicio: '2026-01-01' }, []).problemas),
    ).toEqual(['tipo-invalido']);
  });
});

describe('setores da operadora', () => {
  const d = {
    id: 1,
    codigo: 'AUT',
    descricao: 'Autorização',
    tipo: 'autorizacao',
    email: 'aut@ex.com',
    emailsCopia: [],
    superior: null,
  };
  it('válido, e-mail inválido e ciclo na hierarquia', () => {
    expect(problemasDoDepartamento(d, new Map())).toEqual([]);
    expect(codigos(problemasDoDepartamento({ ...d, email: 'x', emailsCopia: ['y@'] }, new Map()))).toEqual([
      'email-invalido',
      'email-invalido',
    ]);
    expect(codigos(problemasDoDepartamento({ ...d, superior: 1 }, new Map()))).toEqual([
      'hierarquia-circular',
    ]);
    // 1 → 3, e 3 está abaixo de 2, que está abaixo de 1: ciclo.
    expect(
      codigos(
        problemasDoDepartamento(
          { ...d, superior: 3 },
          new Map([
            [3, 2],
            [2, 1],
          ]),
        ),
      ),
    ).toEqual(['hierarquia-circular']);
    expect(problemasDoDepartamento({ ...d, superior: 3 }, new Map([[3, null]]))).toEqual([]);
  });
});

describe('parâmetros da operadora', () => {
  it('normaliza pelo tipo e recusa fora da faixa legal', () => {
    expect(valorDoParametro('prazo_cpt_meses', '12')).toEqual({ valor: '12' });
    expect(valorDoParametro('valor_taxa_segunda_via', 15)).toEqual({ valor: '15.00' });
    expect(valorDoParametro('cobra_segunda_via_cartao', true)).toEqual({ valor: 'true' });
    expect(valorDoParametro('prazo_cpt_meses', 25)).toMatchObject({
      problema: { codigo: 'valor-fora-da-faixa' },
    });
    expect(valorDoParametro('dias_inadimplencia_cancelamento', 60)).toMatchObject({
      problema: { codigo: 'valor-fora-da-faixa' },
    });
    expect(valorDoParametro('prazo_cpt_meses', 1.5)).toMatchObject({
      problema: { codigo: 'valor-invalido' },
    });
    expect(valorDoParametro('outro', 1)).toMatchObject({ problema: { codigo: 'parametro-desconhecido' } });
    expect(lerParametro('prazo_cpt_meses', null)).toBe(24);
    expect(lerParametro('cobra_segunda_via_cartao', 'true')).toBe(true);
  });
});

describe('aditivo do contrato', () => {
  const ctr = { inicio: '2026-01-01', fim: '2026-12-31', situacao: 'ativo' };
  const a = {
    tipo: 'troca_plano',
    assinatura: '2026-03-01',
    efeito: '2026-04-01',
    planoAnterior: 1,
    planoNovo: 2,
    valorAnterior: null,
    valorNovo: null,
    novaVigenciaFim: null,
    descricao: 'Troca do plano ofertado',
  };
  it('troca válida; mesmo plano, efeito antes do contrato e prorrogação sem data recusados', () => {
    expect(problemasDoAditivo(a, ctr)).toEqual([]);
    expect(codigos(problemasDoAditivo({ ...a, planoNovo: 1 }, ctr))).toEqual(['planos-iguais']);
    expect(codigos(problemasDoAditivo({ ...a, efeito: '2025-12-01', assinatura: null }, ctr))).toEqual([
      'efeito-antes-do-contrato',
    ]);
    expect(codigos(problemasDoAditivo({ ...a, tipo: 'vigencia' }, ctr))).toEqual(['vigencia-obrigatoria']);
    expect(problemasDoAditivo({ ...a, tipo: 'vigencia', novaVigenciaFim: '2027-12-31' }, ctr)).toEqual([]);
    expect(codigos(problemasDoAditivo(a, { ...ctr, situacao: 'encerrado' }))).toEqual(['contrato-encerrado']);
  });
});

describe('cancelamento do contrato', () => {
  const base = {
    hoje: '2026-11-24',
    dataEfeito: null,
    diasAtraso: null,
    avisoEntregueEm: null,
    exigeNotificacao: false,
    diasInadimplencia: 61,
    diaLimiteNotificacao: 50,
    tipoContratacao: 'individual_familiar' as const,
    inicioContrato: '2025-01-01',
  };
  it('a pedido do titular no individual: efeito imediato e efetivado na hora, nunca retroativo', () => {
    expect(planoCancelamento({ ...base, solicitante: 'titular' })).toEqual({
      problemas: [],
      dataEfeito: '2026-11-24',
      situacao: 'solicitado',
      efetivarJa: true,
    });
    expect(
      codigos(planoCancelamento({ ...base, solicitante: 'titular', dataEfeito: '2026-11-01' }).problemas),
    ).toEqual(['efeito-retroativo']);
  });
  it('inadimplência: atraso acima do limite e 10 dias depois da notificação', () => {
    expect(
      codigos(planoCancelamento({ ...base, solicitante: 'inadimplencia', diasAtraso: 40 }).problemas),
    ).toEqual(['atraso-insuficiente', 'notificacao-obrigatoria']);
    expect(
      codigos(
        planoCancelamento({
          ...base,
          solicitante: 'inadimplencia',
          diasAtraso: 70,
          avisoEntregueEm: '2026-11-20',
        }).problemas,
      ),
    ).toEqual(['notificacao-fora-do-prazo', 'prazo-notificacao']);
    expect(
      planoCancelamento({
        ...base,
        solicitante: 'inadimplencia',
        diasAtraso: 70,
        avisoEntregueEm: '2026-10-30',
        dataEfeito: '2026-12-01',
      }),
    ).toEqual({ problemas: [], dataEfeito: '2026-12-01', situacao: 'agendado', efetivarJa: false });
  });
  it('inadimplência: notificação até o dia limite do parâmetro (art. 13 II)', () => {
    // 70 dias de atraso hoje, aviso há 4 dias: saiu no 66º dia, depois do 50º.
    const tarde = { ...base, solicitante: 'inadimplencia', diasAtraso: 70, dataEfeito: '2026-12-10' };
    expect(codigos(planoCancelamento({ ...tarde, avisoEntregueEm: '2026-11-20' }).problemas)).toEqual([
      'notificacao-fora-do-prazo',
    ]);
    // Aviso há 25 dias: saiu no 45º dia, dentro do prazo.
    expect(planoCancelamento({ ...tarde, avisoEntregueEm: '2026-10-30' }).problemas).toEqual([]);
    // Parâmetro mais rígido (40º dia) recusa o mesmo aviso.
    expect(
      codigos(
        planoCancelamento({ ...tarde, avisoEntregueEm: '2026-10-30', diaLimiteNotificacao: 40 }).problemas,
      ),
    ).toEqual(['notificacao-fora-do-prazo']);
    expect(codigos(planoCancelamento({ ...tarde, avisoEntregueEm: '2026-11-30' }).problemas)).toContain(
      'notificacao-futura',
    );
  });
  it('coletivo: contratante com 60 dias de aviso e 12 meses de vigência; titular não encerra o contrato', () => {
    const col = { ...base, tipoContratacao: 'coletivo_empresarial' as const, solicitante: 'contratante' };
    // Sem data: o sistema propõe hoje + 60 dias; agendado, nunca efetivado na hora.
    expect(planoCancelamento(col)).toEqual({
      problemas: [],
      dataEfeito: '2027-01-23',
      situacao: 'agendado',
      efetivarJa: false,
    });
    expect(codigos(planoCancelamento({ ...col, dataEfeito: '2026-12-01' }).problemas)).toEqual([
      'aviso-previo',
    ]);
    // Contrato com 3 meses: a primeira data é o fim dos 12 meses.
    expect(planoCancelamento({ ...col, inicioContrato: '2026-08-15' }).dataEfeito).toBe('2027-08-15');
    expect(
      codigos(
        planoCancelamento({ ...col, inicioContrato: '2026-08-15', dataEfeito: '2027-02-01' }).problemas,
      ),
    ).toEqual(['vigencia-minima']);
    expect(codigos(planoCancelamento({ ...col, solicitante: 'titular' }).problemas)).toEqual([
      'solicitante-coletivo',
    ]);
  });
  it('desistência só antes da efetivação e com motivo', () => {
    expect(podeDesistirCancelamento('agendado', 'acordo com o contratante')).toBeNull();
    expect(podeDesistirCancelamento('efetivado', 'x')?.codigo).toBe('situacao-invalida');
    expect(podeDesistirCancelamento('solicitado', ' ')?.codigo).toBe('motivo-obrigatorio');
  });
  it('efetivação só com o efeito alcançado e na situação certa', () => {
    expect(podeEfetivarCancelamento('agendado', '2026-12-01', '2026-11-24')?.codigo).toBe('efeito-futuro');
    expect(podeEfetivarCancelamento('efetivado', '2026-11-01', '2026-11-24')?.codigo).toBe(
      'situacao-invalida',
    );
    expect(podeEfetivarCancelamento('solicitado', '2026-11-24', '2026-11-24')).toBeNull();
  });
});

describe('área de abrangência do produto', () => {
  it('coerente com a abrangência registrada', () => {
    expect(problemasDaAbrangencia('nacional', [])).toEqual([]);
    expect(problemasDaAbrangencia('estadual', [{ tipo: 'estado', codigoIbge: '35' }])).toEqual([]);
    expect(
      codigos(problemasDaAbrangencia('estadual', [{ tipo: 'municipio', codigoIbge: '3550308' }])),
    ).toEqual(['abrangencia-incoerente']);
    expect(
      codigos(
        problemasDaAbrangencia('grupo_municipios', [
          { tipo: 'municipio', codigoIbge: '355' },
          { tipo: 'municipio', codigoIbge: '355' },
        ]),
      ),
    ).toEqual(['codigo-ibge-invalido', 'area-repetida']);
    expect(codigos(problemasDaAbrangencia('nacional', [{ tipo: 'estado', codigoIbge: '35' }]))).toEqual([
      'abrangencia-incoerente',
    ]);
  });
});

describe('carências aplicadas', () => {
  it('limita ao teto legal, desconta o aproveitamento e pula o grupo isento', () => {
    const r = carenciasAplicadas(
      '2026-02-01',
      [
        { grupo: 1, tipoCarencia: 'urgencia_emergencia', dias: 730, isento: false },
        { grupo: 2, tipoCarencia: 'parto', dias: 300, isento: false },
        { grupo: 3, tipoCarencia: 'internacao', dias: 180, isento: false },
        { grupo: 4, tipoCarencia: 'consulta', dias: 30, isento: true },
      ],
      100,
    );
    expect(r).toEqual([
      {
        grupo: 1,
        categoria: 'urgencia',
        inicio: '2026-02-01',
        dias: 1,
        aproveitados: 1,
        cumpridaEm: '2026-02-01',
      },
      {
        grupo: 2,
        categoria: 'parto',
        inicio: '2026-02-01',
        dias: 300,
        aproveitados: 100,
        cumpridaEm: '2026-08-20',
      },
      {
        grupo: 3,
        categoria: 'demais',
        inicio: '2026-02-01',
        dias: 180,
        aproveitados: 100,
        cumpridaEm: '2026-04-22',
      },
    ]);
  });
});

describe('pedido de cartão', () => {
  it('passos e segunda via com motivo', () => {
    expect(passoDoPedidoCartao('solicitado', 'emitido')).toBeNull();
    expect(passoDoPedidoCartao('emitido', 'entregue')).toBeNull();
    expect(passoDoPedidoCartao('entregue', 'cancelado')?.codigo).toBe('passo-invalido');
    expect(
      codigos(
        problemasDoPedidoCartao({ primeiraVia: false, motivo: null, cobraTaxa: true, valorTaxa: null }),
      ),
    ).toEqual(['motivo-obrigatorio', 'taxa-invalida']);
    // Cobrança ligada com a taxa no padrão zero: recusa, nunca cobra R$ 0 em silêncio.
    expect(
      codigos(problemasDoPedidoCartao({ primeiraVia: false, motivo: 1, cobraTaxa: true, valorTaxa: 0 })),
    ).toEqual(['taxa-invalida']);
    expect(
      problemasDoPedidoCartao({ primeiraVia: false, motivo: 1, cobraTaxa: true, valorTaxa: 25 }),
    ).toEqual([]);
  });
});

describe('assinatura do aditivo', () => {
  it('só o rascunho, com a assinatura até o efeito e nunca futura', () => {
    expect(problemasDaAssinatura('rascunho', '2026-11-20', '2026-12-01', '2026-11-24')).toEqual([]);
    expect(codigos(problemasDaAssinatura('vigente', '2026-11-20', '2026-12-01', '2026-11-24'))).toEqual([
      'situacao-invalida',
    ]);
    expect(codigos(problemasDaAssinatura('rascunho', '2026-12-05', '2026-12-01', '2026-11-24'))).toEqual([
      'assinatura-invalida',
    ]);
    expect(codigos(problemasDaAssinatura('rascunho', '2026-11-30', '2026-12-10', '2026-11-24'))).toEqual([
      'assinatura-invalida',
    ]);
    expect(ADITIVOS_COM_EFEITO).toEqual(['vigencia', 'renovacao']);
  });
});
