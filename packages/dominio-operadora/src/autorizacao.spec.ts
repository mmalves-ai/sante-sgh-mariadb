// Regras da autorização de guias e da auditoria médica da operadora (M56, etapa 5, F4): protocolo, senha, prazos,
// conferência do pedido, críticas automáticas, ações por situação, decisão do auditor, junta, designação, situação da
// guia e comunicado da negativa. Dados SINTÉTICOS.
import type { CriticaAutomatica, RegistrarAutorizacaoEntrada } from '@sgh/contratos';
import { describe, expect, it } from 'vitest';
import {
  acaoPermitida,
  acoesDaSituacao,
  carenciaDoAtendimento,
  comunicadoDaNegativa,
  conferirDecisao,
  conselhoDoAuditor,
  type ContextoCriticas,
  type ContextoPedido,
  criticasAutomaticas,
  designacaoVigente,
  PARAMETROS_AUTORIZACAO,
  prazoDaResposta,
  prazoVencido,
  problemasDaDesignacao,
  problemasDaJunta,
  problemasDoPedido,
  protocoloAtendimento,
  protocoloValido,
  regimeServe,
  segmentacaoCobre,
  coberturaPorAtendimento,
  senhaAutorizacao,
  senhaValida,
  situacaoGuiaTiss,
  somarDiasUteis,
  validadeDaSenha,
} from './autorizacao.js';

describe('protocolo e senha', () => {
  it('protocolo: registro (6) + data (8) + sequência (6) = 20 dígitos', () => {
    const p = protocoloAtendimento('900.001', '2026-10-25T10:00:00', 42);
    expect(p).toBe('90000120261025000042');
    expect(protocoloValido(p)).toBe(true);
    expect(protocoloValido('123')).toBe(false);
    expect(protocoloAtendimento('900001', '2026-10-25', 1_000_007)).toBe('90000120261025000007');
    expect(() => protocoloAtendimento('12', '2026-10-25', 1)).toThrow('Registro');
    expect(() => protocoloAtendimento('900001', 'ontem', 1)).toThrow('Data');
    expect(() => protocoloAtendimento('900001', '2026-10-25', 0)).toThrow('Sequência');
  });

  it('senha: registro, sequência e verificador módulo 11 (16 dígitos)', () => {
    const s = senhaAutorizacao('900001', 7);
    expect(s).toHaveLength(16);
    expect(s.startsWith('900001000000007')).toBe(true);
    expect(senhaValida(s)).toBe(true);
    expect(senhaValida(`${s.slice(0, 15)}${(Number(s[15]) + 1) % 10}`)).toBe(false);
    expect(senhaValida('12')).toBe(false);
    expect(() => senhaAutorizacao('900001', 0)).toThrow('faixa');
    // Verificador 0 quando o resto dá 10 ou 11.
    const todos = Array.from({ length: 30 }, (_, i) => senhaAutorizacao('900001', i + 1));
    expect(todos.every(senhaValida)).toBe(true);
  });

  it('validade da senha: 30 dias corridos da decisão (parâmetro)', () => {
    expect(validadeDaSenha('2026-10-25T10:00:00')).toBe('2026-11-24');
    expect(validadeDaSenha('2026-10-25', 60)).toBe('2026-12-24');
    expect(PARAMETROS_AUTORIZACAO.diasValidadeSenha).toBe(30);
  });
});

describe('prazo da resposta', () => {
  it('dias úteis pulam sábado e domingo', () => {
    // 2026-10-23 é sexta-feira.
    expect(somarDiasUteis('2026-10-23', 1)).toBe('2026-10-26');
    expect(somarDiasUteis('2026-10-23', 5)).toBe('2026-10-30');
    expect(somarDiasUteis('2026-10-24T09:00:00', 1)).toBe('2026-10-26');
    expect(somarDiasUteis('2026-10-26', 0)).toBe('2026-10-26');
  });

  it('urgência: imediato; eletiva: 5 dias úteis; internação eletiva e alta complexidade: 10', () => {
    const agora = '2026-10-23 14:30:00';
    expect(prazoDaResposta({ carater: 'U', tipoGuia: 3, altaComplexidade: false }, agora)).toEqual({
      tipo: 'imediato',
      prazoEm: '2026-10-23T14:30:00',
    });
    expect(prazoDaResposta({ carater: 'E', tipoGuia: 4, altaComplexidade: false }, agora)).toEqual({
      tipo: 'padrao',
      prazoEm: '2026-10-30T23:59:59',
    });
    expect(prazoDaResposta({ carater: 'E', tipoGuia: 3, altaComplexidade: false }, agora)).toEqual({
      tipo: 'complexo',
      prazoEm: '2026-11-06T23:59:59',
    });
    expect(prazoDaResposta({ carater: 'E', tipoGuia: 4, altaComplexidade: true }, agora).tipo).toBe(
      'complexo',
    );
    expect(
      prazoDaResposta({ carater: 'E', tipoGuia: 2, altaComplexidade: false }, agora, {
        diasUteisPadrao: 1,
        diasUteisComplexo: 2,
      }).prazoEm,
    ).toBe('2026-10-26T23:59:59');
  });

  it('vencido só em aberto e depois do prazo', () => {
    expect(prazoVencido('em-analise', '2026-10-23T14:30:00', '2026-10-23 14:30:01')).toBe(true);
    expect(prazoVencido('pendente', '2026-10-30T23:59:59', '2026-10-30T23:59:59')).toBe(false);
    expect(prazoVencido('em-junta', '2026-10-30T23:59:59', '2026-10-31T00:00:00')).toBe(true);
    expect(prazoVencido('autorizada', '2026-10-01T00:00:00', '2026-10-31T00:00:00')).toBe(false);
  });
});

const pedido = (x: Partial<RegistrarAutorizacaoEntrada> = {}): RegistrarAutorizacaoEntrada => ({
  carteirinha: '9000010000000017',
  prestador: 1,
  executante: null,
  tipoGuia: 4,
  carater: 'E',
  altaComplexidade: false,
  origem: 1,
  guiaPrincipal: null,
  cid: null,
  indicacaoClinica: 'Indicação clínica sintética',
  profissional: { nome: 'Profissional Sintético', conselho: 'CRM', numero: '900001', uf: 'SC' },
  internacao: null,
  itens: [{ tabela: 22, codigo: '40301630', descricao: null, quantidade: 2 }],
  ...x,
});

const ctxPedido = (x: Partial<ContextoPedido> = {}): ContextoPedido => ({
  tiposGuia: new Set([1, 2, 3, 4]),
  origens: new Set([1, 2, 3, 4, 5, 6]),
  hoje: '2026-10-25',
  procedimentos: new Map([
    ['40301630', { vigente: true }],
    ['10101012', { vigente: true }],
    ['90000000', { vigente: false }],
  ]),
  cidExiste: null,
  guiaPrincipal: null,
  beneficiario: 10,
  ...x,
});
const codigos = (p: readonly { codigo: string }[]) => p.map((x) => x.codigo);

describe('conferência do pedido', () => {
  it('o pedido de SP/SADT certo passa; domínios fora da lista recusam', () => {
    expect(problemasDoPedido(pedido(), ctxPedido())).toEqual([]);
    expect(codigos(problemasDoPedido(pedido({ tipoGuia: 9, origem: 99 }), ctxPedido()))).toEqual([
      'dominio-invalido',
      'dominio-invalido',
    ]);
  });

  it('internação: tipo, diárias, admissão e CID; fora da internação, sem esses dados', () => {
    expect(codigos(problemasDoPedido(pedido({ tipoGuia: 3 }), ctxPedido()))).toEqual([
      'internacao-obrigatoria',
      'cid-obrigatorio',
    ]);
    const internacao = { tipo: 1, diarias: 3, admissaoPrevista: '2026-10-20' };
    expect(
      codigos(
        problemasDoPedido(pedido({ tipoGuia: 3, internacao, cid: 'J189' }), ctxPedido({ cidExiste: true })),
      ),
    ).toEqual(['admissao-no-passado']);
    expect(
      problemasDoPedido(
        pedido({ tipoGuia: 3, carater: 'U', internacao, cid: 'J189' }),
        ctxPedido({ cidExiste: true }),
      ),
    ).toEqual([]);
    expect(codigos(problemasDoPedido(pedido({ internacao }), ctxPedido()))).toEqual([
      'internacao-so-na-guia-de-internacao',
    ]);
    expect(codigos(problemasDoPedido(pedido({ cid: 'Z999' }), ctxPedido({ cidExiste: false })))).toEqual([
      'cid-inexistente',
    ]);
  });

  it('consulta: um procedimento com quantidade 1', () => {
    expect(
      problemasDoPedido(
        pedido({ tipoGuia: 2, itens: [{ tabela: 22, codigo: '10101012', descricao: null, quantidade: 1 }] }),
        ctxPedido(),
      ),
    ).toEqual([]);
    expect(codigos(problemasDoPedido(pedido({ tipoGuia: 2 }), ctxPedido()))).toEqual(['consulta-um-item']);
  });

  it('itens: código TUSS de 8 dígitos, existente e vigente; descrição fora da 22; sem repetir', () => {
    const p = problemasDoPedido(
      pedido({
        itens: [
          { tabela: 22, codigo: '123', descricao: null, quantidade: 1 },
          { tabela: 22, codigo: '11111111', descricao: null, quantidade: 1 },
          { tabela: 22, codigo: '90000000', descricao: null, quantidade: 1 },
          { tabela: 19, codigo: 'OPME1', descricao: null, quantidade: 1 },
          { tabela: 20, codigo: 'MED1', descricao: 'Medicamento sintético', quantidade: 1 },
          { tabela: 20, codigo: 'MED1', descricao: 'Medicamento sintético', quantidade: 1 },
        ],
      }),
      ctxPedido(),
    );
    expect(codigos(p)).toEqual([
      'codigo-tuss-invalido',
      'procedimento-inexistente',
      'procedimento-fora-de-vigencia',
      'descricao-obrigatoria',
      'item-repetido',
    ]);
  });

  it('guia principal: só para SP/SADT ou internação; internação autorizada do mesmo beneficiário', () => {
    const principal = { beneficiario: 10, tipoGuia: 3, situacao: 'autorizada' as const };
    expect(problemasDoPedido(pedido({ guiaPrincipal: 5 }), ctxPedido({ guiaPrincipal: principal }))).toEqual(
      [],
    );
    expect(
      problemasDoPedido(
        pedido({ guiaPrincipal: 5 }),
        ctxPedido({ guiaPrincipal: { ...principal, situacao: 'parcial' } }),
      ),
    ).toEqual([]);
    expect(
      codigos(
        problemasDoPedido(
          pedido({
            tipoGuia: 2,
            guiaPrincipal: 5,
            itens: [{ tabela: 22, codigo: '10101012', descricao: null, quantidade: 1 }],
          }),
          ctxPedido({ guiaPrincipal: principal }),
        ),
      ),
    ).toEqual(['guia-principal-so-sadt-ou-internacao']);
    for (const g of [
      null,
      { ...principal, beneficiario: 11 },
      { ...principal, tipoGuia: 4 },
      { ...principal, situacao: 'negada' as const },
    ])
      expect(
        codigos(problemasDoPedido(pedido({ guiaPrincipal: 5 }), ctxPedido({ guiaPrincipal: g }))),
      ).toEqual(['guia-principal-inexistente']);
  });
});

describe('segmentação, carência e regime', () => {
  const sadt = { tipoGuia: 4, internacaoTipo: null, comGuiaPrincipal: false };
  const sadtNaInternacao = { ...sadt, comGuiaPrincipal: true };
  const internacao = { tipoGuia: 3, internacaoTipo: 1, comGuiaPrincipal: false };
  const parto = { tipoGuia: 3, internacaoTipo: 3, comGuiaPrincipal: false };

  it('cobertura pela segmentação assistencial', () => {
    expect(segmentacaoCobre('referencia', parto)).toBe('cobre');
    expect(segmentacaoCobre('ambulatorialHospitalar', sadt)).toBe('cobre');
    expect(segmentacaoCobre('ambulatorialHospitalar', parto)).toBe('conferir');
    expect(segmentacaoCobre('ambulatorial', sadt)).toBe('cobre');
    expect(segmentacaoCobre('ambulatorial', internacao)).toBe('nao-cobre');
    expect(segmentacaoCobre('hospitalarComObstetricia', parto)).toBe('cobre');
    expect(segmentacaoCobre('hospitalarComObstetricia', sadt)).toBe('nao-cobre');
    expect(segmentacaoCobre('hospitalarComObstetricia', sadtNaInternacao)).toBe('cobre');
    expect(segmentacaoCobre('hospitalarSemObstetricia', internacao)).toBe('cobre');
    expect(segmentacaoCobre('hospitalarSemObstetricia', parto)).toBe('nao-cobre');
    expect(segmentacaoCobre('hospitalarSemObstetricia', sadt)).toBe('nao-cobre');
    expect(segmentacaoCobre('odontologico', sadt)).toBe('nao-cobre');
    expect(segmentacaoCobre(null, sadt)).toBe('nao-cobre');
  });

  it('a carência do atendimento', () => {
    expect(carenciaDoAtendimento({ carater: 'U', tipoGuia: 3, internacaoTipo: 3 })).toBe('urgencia');
    expect(carenciaDoAtendimento({ carater: 'E', tipoGuia: 3, internacaoTipo: 3 })).toBe('partos');
    expect(carenciaDoAtendimento({ carater: 'E', tipoGuia: 3, internacaoTipo: 1 })).toBe('demais');
    expect(carenciaDoAtendimento({ carater: 'E', tipoGuia: 4, internacaoTipo: null })).toBe('demais');
  });

  it('o regime do prestador', () => {
    expect(regimeServe(2, internacao)).toBe(true);
    expect(regimeServe(3, internacao)).toBe(true);
    expect(regimeServe(1, internacao)).toBe(false);
    expect(regimeServe(2, sadtNaInternacao)).toBe(true);
    expect(regimeServe(1, sadt)).toBe(true);
    expect(regimeServe(2, sadt)).toBe(false);
  });
});

describe('críticas automáticas', () => {
  const cumpridas = [
    { tipo: 'urgencia' as const, cumpridaEm: '2026-01-02', cumprida: true },
    { tipo: 'partos' as const, cumpridaEm: '2026-10-01', cumprida: true },
    { tipo: 'demais' as const, cumpridaEm: '2026-07-01', cumprida: true },
  ];
  const base = (x: Partial<ContextoCriticas> = {}): ContextoCriticas => ({
    elegibilidade: { elegivel: true, motivos: [], carencias: cumpridas },
    produto: { natureza: 'plano', segmentacao: 'ambulatorialHospitalar' },
    pedido: { carater: 'E', tipoGuia: 4, internacaoTipo: null, comGuiaPrincipal: false },
    prestador: { situacao: 'credenciado', regime: 3 },
    ...x,
  });

  it('sem crítica no caso comum', () => {
    expect(criticasAutomaticas(base())).toEqual([]);
  });

  it('inelegível, cartão de desconto, segmentação e obstetrícia a conferir', () => {
    const r = criticasAutomaticas(
      base({ elegibilidade: { elegivel: false, motivos: ['beneficiario-suspenso'], carencias: [] } }),
    );
    expect(r).toEqual([
      expect.objectContaining({ codigo: 'beneficiario-inelegivel', bloqueia: true, critica: 3 }),
    ]);
    expect(criticasAutomaticas(base({ produto: { natureza: 'cartaoDesconto', segmentacao: null } }))).toEqual(
      [expect.objectContaining({ codigo: 'produto-nao-e-plano', bloqueia: true, critica: 4 })],
    );
    expect(
      codigos(
        criticasAutomaticas(
          base({ produto: { natureza: 'plano', segmentacao: 'hospitalarSemObstetricia' } }),
        ),
      ),
    ).toEqual(['fora-da-segmentacao']);
    const parto = criticasAutomaticas(
      base({ pedido: { carater: 'E', tipoGuia: 3, internacaoTipo: 3, comGuiaPrincipal: false } }),
    );
    expect(parto).toEqual([expect.objectContaining({ codigo: 'obstetricia-a-conferir', bloqueia: false })]);
    expect(parto[0]?.texto).toContain('obstetrícia');
  });

  it('carências: em carência bloqueia; urgência na carência da internação avisa; CPT avisa', () => {
    const carencias = [
      { tipo: 'urgencia' as const, cumpridaEm: '2026-10-26', cumprida: false },
      { tipo: 'demais' as const, cumpridaEm: '2027-04-01', cumprida: false },
      { tipo: 'cpt' as const, cumpridaEm: '2028-01-01', cumprida: false },
    ];
    const el = { elegivel: true, motivos: [], carencias };
    expect(codigos(criticasAutomaticas(base({ elegibilidade: el })))).toEqual(['em-carencia', 'cpt-vigente']);
    const urg = base({
      elegibilidade: el,
      pedido: { carater: 'U', tipoGuia: 3, internacaoTipo: 1, comGuiaPrincipal: false },
    });
    expect(codigos(criticasAutomaticas(urg))).toEqual(['em-carencia', 'cpt-vigente']);
    const depoisDas24h = { ...el, carencias: [{ ...carencias[0]!, cumprida: true }, carencias[1]!] };
    expect(
      criticasAutomaticas({ ...urg, elegibilidade: depoisDas24h }).map((c) => [c.codigo, c.bloqueia]),
    ).toEqual([['urgencia-em-carencia', false]]);
    const partoUrgente = {
      ...urg,
      pedido: { carater: 'U' as const, tipoGuia: 3, internacaoTipo: 3, comGuiaPrincipal: false },
      elegibilidade: {
        ...el,
        carencias: [
          { tipo: 'urgencia' as const, cumpridaEm: '2026-01-02', cumprida: true },
          { tipo: 'partos' as const, cumpridaEm: '2027-01-01', cumprida: false },
        ],
      },
    };
    expect(codigos(criticasAutomaticas(partoUrgente))).toEqual([
      'obstetricia-a-conferir',
      'urgencia-em-carencia',
    ]);
    // Urgência fora da internação na carência das demais: só a carência de urgência conta.
    expect(
      codigos(
        criticasAutomaticas({
          ...urg,
          elegibilidade: depoisDas24h,
          pedido: { carater: 'U', tipoGuia: 4, internacaoTipo: null, comGuiaPrincipal: false },
        }),
      ),
    ).toEqual([]);
  });

  it('prestador fora da rede, executante fora da rede e regime', () => {
    expect(codigos(criticasAutomaticas(base({ prestador: null })))).toEqual(['prestador-fora-da-rede']);
    expect(
      codigos(criticasAutomaticas(base({ prestador: { situacao: 'descredenciado', regime: 3 } }))),
    ).toEqual(['prestador-fora-da-rede']);
    expect(codigos(criticasAutomaticas(base({ temExecutante: true, executante: null })))).toEqual([
      'prestador-fora-da-rede',
    ]);
    expect(
      codigos(
        criticasAutomaticas(
          base({ temExecutante: true, executante: { situacao: 'credenciado', regime: 2 } }),
        ),
      ),
    ).toEqual(['prestador-sem-regime']);
    expect(codigos(criticasAutomaticas(base({ prestador: { situacao: 'credenciado', regime: 2 } })))).toEqual(
      ['prestador-sem-regime'],
    ); // C2-118: o prestador (ou o executante) suspenso na data bloqueia a autorização.
    expect(
      codigos(
        criticasAutomaticas(base({ prestador: { situacao: 'credenciado', regime: 3, suspenso: true } })),
      ),
    ).toEqual(['prestador-suspenso']);
    expect(
      codigos(
        criticasAutomaticas(
          base({ temExecutante: true, executante: { situacao: 'credenciado', regime: 3, suspenso: true } }),
        ),
      ),
    ).toEqual(['prestador-suspenso']);
  });
});

describe('ações por situação', () => {
  it('cada situação com as suas ações', () => {
    expect(acoesDaSituacao('em-analise')).toEqual(['pedirComplemento', 'decidir', 'abrirJunta', 'cancelar']);
    expect(acaoPermitida('pendente', 'responderComplemento')).toBe(true);
    expect(acaoPermitida('pendente', 'decidir')).toBe(false);
    expect(acaoPermitida('em-junta', 'concluirJunta')).toBe(true);
    expect(acaoPermitida('autorizada', 'cancelar')).toBe(true);
    expect(acaoPermitida('parcial', 'decidir')).toBe(false);
    expect(acoesDaSituacao('negada')).toEqual([]);
    expect(acoesDaSituacao('cancelada')).toEqual([]);
  });
});

describe('decisão do auditor', () => {
  const sadt = {
    tipoGuia: 4,
    itens: [
      { id: 1, quantidadeSolicitada: 2 },
      { id: 2, quantidadeSolicitada: 1 },
    ],
    diariasSolicitadas: null,
  };
  const dominio = new Set([1, 4, 5]);
  const medico = { categoria: 'medico' as const };
  const enfermeiro = { categoria: 'enfermeiro' as const };
  const autorizarTudo = {
    decisao: 'autorizar' as const,
    itens: [
      { item: 1, quantidadeAutorizada: 2 },
      { item: 2, quantidadeAutorizada: 1 },
    ],
    diariasAutorizadas: null,
    critica: null,
    fundamento: null,
  };
  const bloqueante: CriticaAutomatica = { codigo: 'em-carencia', bloqueia: true, critica: 1, texto: '' };
  const aviso: CriticaAutomatica = { codigo: 'cpt-vigente', bloqueia: false, critica: 6, texto: '' };

  it('autorizar tudo: o enfermeiro auditor pode; aviso não impede', () => {
    const r = conferirDecisao(sadt, autorizarTudo, enfermeiro, [aviso], dominio);
    expect(r).toMatchObject({ problemas: [], situacao: 'autorizada', diarias: null });
    expect(r.itens.map((i) => i.situacao)).toEqual(['autorizado', 'autorizado']);
  });

  it('sem designação, recusa; crítica que bloqueia impede autorizar', () => {
    expect(codigos(conferirDecisao(sadt, autorizarTudo, null, [], dominio).problemas)).toEqual([
      'auditor-nao-designado',
    ]);
    expect(codigos(conferirDecisao(sadt, autorizarTudo, medico, [bloqueante], dominio).problemas)).toEqual([
      'critica-bloqueante',
    ]);
  });

  it('parcial: do médico, com a crítica e o fundamento; o item com 0 fica negado', () => {
    const e = {
      ...autorizarTudo,
      itens: [
        { item: 1, quantidadeAutorizada: 1 },
        { item: 2, quantidadeAutorizada: 0 },
      ],
    };
    expect(codigos(conferirDecisao(sadt, e, medico, [], dominio).problemas)).toEqual([
      'critica-obrigatoria',
      'fundamento-obrigatorio',
    ]);
    expect(codigos(conferirDecisao(sadt, e, enfermeiro, [], dominio).problemas)).toEqual([
      'negativa-so-medico',
      'critica-obrigatoria',
      'fundamento-obrigatorio',
    ]);
    const ok = conferirDecisao(
      sadt,
      { ...e, critica: 5, fundamento: 'Cláusula 7.2 do contrato' },
      medico,
      [],
      dominio,
    );
    expect(ok.problemas).toEqual([]);
    expect(ok.situacao).toBe('parcial');
    expect(ok.itens.map((i) => [i.quantidade, i.situacao])).toEqual([
      [1, 'parcial'],
      [0, 'negado'],
    ]);
    expect(
      codigos(conferirDecisao(sadt, { ...e, critica: 9, fundamento: 'x' }, medico, [], dominio).problemas),
    ).toEqual(['dominio-invalido']);
  });

  it('itens da decisão: todos, sem passar do pedido, algum autorizado', () => {
    expect(
      codigos(
        conferirDecisao(
          sadt,
          { ...autorizarTudo, itens: [{ item: 1, quantidadeAutorizada: 2 }] },
          medico,
          [],
          dominio,
        ).problemas,
      ),
    ).toContain('itens-da-decisao');
    expect(
      codigos(
        conferirDecisao(
          sadt,
          {
            ...autorizarTudo,
            itens: [
              { item: 1, quantidadeAutorizada: 3 },
              { item: 2, quantidadeAutorizada: 1 },
            ],
          },
          medico,
          [],
          dominio,
        ).problemas,
      ),
    ).toEqual(['quantidade-acima-do-pedido']);
    expect(
      codigos(
        conferirDecisao(
          sadt,
          {
            ...autorizarTudo,
            critica: 4,
            fundamento: 'Rol',
            itens: [
              { item: 1, quantidadeAutorizada: 0 },
              { item: 2, quantidadeAutorizada: 0 },
            ],
          },
          medico,
          [],
          dominio,
        ).problemas,
      ),
    ).toEqual(['nada-autorizado']);
  });

  it('internação: diárias obrigatórias, até as pedidas; menos diárias é parcial', () => {
    const int = { tipoGuia: 3, itens: [{ id: 1, quantidadeSolicitada: 1 }], diariasSolicitadas: 5 };
    const base = { ...autorizarTudo, itens: [{ item: 1, quantidadeAutorizada: 1 }] };
    expect(codigos(conferirDecisao(int, base, medico, [], dominio).problemas)).toEqual([
      'diarias-obrigatorias',
    ]);
    expect(
      codigos(conferirDecisao(int, { ...base, diariasAutorizadas: 6 }, medico, [], dominio).problemas),
    ).toEqual(['diarias-acima-do-pedido']);
    expect(conferirDecisao(int, { ...base, diariasAutorizadas: 5 }, medico, [], dominio)).toMatchObject({
      problemas: [],
      situacao: 'autorizada',
      diarias: 5,
    });
    const curta = conferirDecisao(
      int,
      { ...base, diariasAutorizadas: 3, critica: 5, fundamento: 'Diretriz de utilização' },
      medico,
      [],
      dominio,
    );
    expect(curta).toMatchObject({ problemas: [], situacao: 'parcial', diarias: 3 });
    expect(
      conferirDecisao(
        { ...int, diariasSolicitadas: null },
        { ...base, diariasAutorizadas: 9 },
        medico,
        [],
        dominio,
      ).situacao,
    ).toBe('autorizada');
  });

  it('negar: todos os itens negados; do médico com crítica e fundamento', () => {
    const negar = {
      ...autorizarTudo,
      decisao: 'negar' as const,
      critica: 1,
      fundamento: 'Lei 9.656/1998, art. 12',
    };
    const r = conferirDecisao(sadt, negar, medico, [bloqueante], dominio);
    expect(r).toMatchObject({ problemas: [], situacao: 'negada' });
    expect(r.itens.every((i) => i.quantidade === 0 && i.situacao === 'negado')).toBe(true);
    expect(codigos(conferirDecisao(sadt, negar, enfermeiro, [], dominio).problemas)).toEqual([
      'negativa-so-medico',
    ]);
    expect(
      codigos(
        conferirDecisao(sadt, { ...negar, critica: null, fundamento: null }, null, [], dominio).problemas,
      ),
    ).toEqual(['auditor-nao-designado', 'critica-obrigatoria', 'fundamento-obrigatorio']);
  });
});

describe('junta e designação', () => {
  const solicitante = { conselho: 'CRM', numero: '0900001', uf: 'SC' };
  const junta = { notificadosEm: '2026-10-25', desempatador: { crm: '900002', uf: 'SC' } };

  it('junta: do médico auditor, aviso já dado, desempatador outro médico', () => {
    expect(problemasDaJunta(junta, solicitante, { categoria: 'medico' }, '2026-10-25')).toEqual([]);
    expect(codigos(problemasDaJunta(junta, solicitante, { categoria: 'enfermeiro' }, '2026-10-25'))).toEqual([
      'junta-so-medico',
    ]);
    expect(
      codigos(
        problemasDaJunta(
          { notificadosEm: '2026-10-26', desempatador: { crm: '900001', uf: 'SC' } },
          solicitante,
          null,
          '2026-10-25',
        ),
      ),
    ).toEqual(['auditor-nao-designado', 'notificacao-no-futuro', 'desempatador-e-o-solicitante']);
    expect(
      problemasDaJunta(
        { notificadosEm: '2026-10-25', desempatador: { crm: '900001', uf: 'PR' } },
        solicitante,
        { categoria: 'medico' },
        '2026-10-25',
      ),
    ).toEqual([]);
    expect(
      problemasDaJunta(
        junta,
        { ...solicitante, conselho: 'CRO', numero: '900002' },
        { categoria: 'medico' },
        '2026-10-25',
      ),
    ).toEqual([]);
  });

  it('designação: conselho da categoria, início até 30 dias à frente, vigência', () => {
    expect(conselhoDoAuditor('medico')).toBe('CRM');
    expect(conselhoDoAuditor('enfermeiro')).toBe('COREN');
    expect(problemasDaDesignacao({ inicio: '2026-11-24' }, '2026-10-25')).toEqual([]);
    expect(codigos(problemasDaDesignacao({ inicio: '2026-11-25' }, '2026-10-25'))).toEqual([
      'inicio-no-futuro-distante',
    ]);
    const d = { situacao: 'ativo', inicio: '2026-10-01', fim: null };
    expect(designacaoVigente(d, '2026-10-25')).toBe(true);
    expect(designacaoVigente({ ...d, inicio: '2026-10-26' }, '2026-10-25')).toBe(false);
    expect(designacaoVigente({ ...d, fim: '2026-10-24' }, '2026-10-25')).toBe(false);
    expect(designacaoVigente({ ...d, fim: '2026-10-25' }, '2026-10-25')).toBe(true);
    expect(designacaoVigente({ ...d, situacao: 'encerrado' }, '2026-10-25')).toBe(false);
  });
});

describe('situação da guia e comunicado', () => {
  it('a situação da guia para as contas médicas', () => {
    expect(situacaoGuiaTiss('autorizada')).toBe(1);
    expect(situacaoGuiaTiss('parcial')).toBe(1);
    expect(situacaoGuiaTiss('cancelada')).toBe(5);
    expect(situacaoGuiaTiss('em-analise')).toBeNull();
    expect(situacaoGuiaTiss('negada')).toBeNull();
  });

  it('o comunicado da negativa (total e parcial); nada negado, nenhum', () => {
    const base = {
      protocolo: '90000120261025000001',
      beneficiario: 'Beneficiária Sintética',
      decididaEm: '2026-10-25T10:00:00',
      critica: 'Carência',
      fundamento: 'Cláusula 8 do contrato',
      parecer: 'Carência das demais coberturas até 2027.',
      negados: ['40301630 Creatinina (2)'],
    };
    const total = comunicadoDaNegativa({ ...base, situacao: 'negada' });
    expect(total).toContain('Protocolo 90000120261025000001, decidido em 25/10/2026.');
    expect(total).toContain('foi negado');
    expect(total).toContain('Negado: 40301630 Creatinina (2).');
    expect(total).toContain('Motivo: Carência.');
    expect(total).toContain('Fundamento: Cláusula 8 do contrato.');
    const parcial = comunicadoDaNegativa({
      ...base,
      situacao: 'parcial',
      decididaEm: null,
      critica: null,
      fundamento: null,
      parecer: null,
      negados: [],
    });
    expect(parcial).toBe(
      'Protocolo 90000120261025000001.\nBeneficiária Sintética, o pedido de autorização foi autorizado em parte.',
    );
    expect(comunicadoDaNegativa({ ...base, situacao: 'parcial' })).toContain('Não autorizado:');
    expect(comunicadoDaNegativa({ ...base, situacao: 'autorizada' })).toBeNull();
  });
});

describe('W0-10 (M7): cobertura por atendimento na elegibilidade do portal', () => {
  const de = (r: ReturnType<typeof coberturaPorAtendimento>) =>
    Object.fromEntries(r.map((x) => [x.atendimento, x.cobertura]));
  it('segue a segmentação do plano (Lei 9.656/1998, art. 12)', () => {
    expect(de(coberturaPorAtendimento('plano', 'ambulatorial'))).toEqual({
      consulta: 'cobre',
      sadt: 'cobre',
      internacao: 'nao-cobre',
      parto: 'nao-cobre',
    });
    expect(de(coberturaPorAtendimento('plano', 'hospitalarSemObstetricia'))).toEqual({
      consulta: 'nao-cobre',
      sadt: 'nao-cobre',
      internacao: 'cobre',
      parto: 'nao-cobre',
    });
    expect(de(coberturaPorAtendimento('plano', 'ambulatorialHospitalar')).parto).toBe('conferir');
    expect(Object.values(de(coberturaPorAtendimento('plano', 'referencia')))).toEqual(Array(4).fill('cobre'));
  });
  it('cartão de desconto não cobre nada', () => {
    expect(Object.values(de(coberturaPorAtendimento('cartaoDesconto', 'referencia')))).toEqual(
      Array(4).fill('nao-cobre'),
    );
  });
});
