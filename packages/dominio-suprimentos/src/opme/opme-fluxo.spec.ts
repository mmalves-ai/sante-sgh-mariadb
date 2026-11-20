// Ficha do M46, etapa 3 (regra 6, teste `opme-fluxo.spec.ts`): a solicitação ligada à agenda, a máquina de estados das
// etapas (cotação, autorização com senha e guia, negativa, pedido, consignação, CME, NF, cancelamento), o consumo em
// sala com o rastreio por lote ou série e a autorização (ou a exceção do supervisor), e a devolução do não usado.
import { describe, expect, it } from 'vitest';
import {
  CODIGOS_ETAPA_OPME,
  CODIGOS_SITUACAO_OPME,
  ETAPAS_OPME_MANUAIS,
  esquemaAvancarEtapaOpme,
  esquemaConsumirOpme,
  esquemaRegistrarSaida,
  esquemaSolicitarOpme,
} from '@sgh/contratos';
import {
  conferirConsumoOpme,
  conferirDevolucaoOpme,
  conferirEtapaOpme,
  conferirSolicitacaoOpme,
  consumoExigeExcecao,
  ETAPAS_POR_SITUACAO,
  type EtapaParaConferir,
  situacaoDepoisDaEtapa,
} from '../index.js';

const codigos = (r: { codigo: string }[]) => r.map((x) => x.codigo);

describe('solicitação de OPME ligada à agenda (regra 6)', () => {
  const base = {
    classeItem: 50,
    tuss: '70000014',
    quantidade: 2,
    justificativa: 'Artroplastia de quadril: prótese cimentada.',
    agendamento: 'aberto' as const,
  };
  it('aceita a solicitação completa', () => {
    expect(conferirSolicitacaoOpme(base)).toEqual([]);
  });
  it('recusa item fora da classe de OPME, TUSS inválido, quantidade e justificativa', () => {
    expect(
      codigos(
        conferirSolicitacaoOpme({
          ...base,
          classeItem: 10,
          tuss: '123',
          quantidade: 0,
          justificativa: 'curta',
        }),
      ),
    ).toEqual(['item-nao-opme', 'tuss-invalido', 'quantidade-invalida', 'sem-justificativa']);
    expect(codigos(conferirSolicitacaoOpme({ ...base, classeItem: null }))).toEqual(['item-inexistente']);
  });
  it('recusa agenda inexistente, cancelada ou já realizada', () => {
    expect(codigos(conferirSolicitacaoOpme({ ...base, agendamento: 'inexistente' }))).toEqual([
      'agendamento-inexistente',
    ]);
    const c = conferirSolicitacaoOpme({ ...base, agendamento: 'cancelado' });
    expect(codigos(c)).toEqual(['agendamento-encerrado']);
    expect(c[0]?.mensagem).toMatch(/cancelado/);
    expect(conferirSolicitacaoOpme({ ...base, agendamento: 'realizado' })[0]?.mensagem).toMatch(
      /consumo em sala/,
    );
  });
  it('o Zod da entrada recusa TUSS sem oito dígitos e a justificativa curta', () => {
    const ok = {
      agendamento: 10,
      chave: 'opme-solic-0001',
      item: 900,
      tuss: '70000014',
      quantidade: 1,
      justificativa: 'Material especial da cirurgia de coluna.',
    };
    expect(esquemaSolicitarOpme.safeParse(ok).success).toBe(true);
    expect(esquemaSolicitarOpme.safeParse({ ...ok, tuss: '7000001' }).success).toBe(false);
    expect(esquemaSolicitarOpme.safeParse({ ...ok, justificativa: 'curta' }).success).toBe(false);
    expect(esquemaSolicitarOpme.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });
});

describe('etapas do OPME (máquina de estados)', () => {
  const e = (x: Partial<EtapaParaConferir>): EtapaParaConferir => ({
    situacao: 'solicitada',
    etapa: 'cotacao',
    quantidadeSolicitada: 2,
    quantidade: null,
    senha: null,
    guia: null,
    validade: null,
    hoje: '2026-10-26',
    fornecedor: null,
    pedido: null,
    nf: null,
    observacao: null,
    ...x,
  });
  it('toda situação tem a lista das etapas aceitas; as manuais são as da tela de suprimentos', () => {
    for (const s of CODIGOS_SITUACAO_OPME) expect(ETAPAS_POR_SITUACAO[s]).toBeDefined();
    for (const lista of Object.values(ETAPAS_POR_SITUACAO))
      for (const et of lista) expect(CODIGOS_ETAPA_OPME).toContain(et);
    expect(ETAPAS_OPME_MANUAIS).not.toContain('consumo');
    expect(ETAPAS_OPME_MANUAIS).not.toContain('devolucao');
    expect(ETAPAS_OPME_MANUAIS).toContain('autorizacao');
  });
  it('a autorização exige a senha, a guia e a quantidade (até a solicitada), com a senha válida', () => {
    expect(codigos(conferirEtapaOpme(e({ etapa: 'autorizacao' })))).toEqual([
      'sem-senha',
      'sem-guia',
      'quantidade-invalida',
    ]);
    expect(
      codigos(
        conferirEtapaOpme(
          e({ etapa: 'autorizacao', senha: 'S1', guia: 'G1', quantidade: 3, validade: '2026-10-01' }),
        ),
      ),
    ).toEqual(['autorizada-maior', 'senha-vencida']);
    expect(
      conferirEtapaOpme(
        e({ etapa: 'autorizacao', senha: 'S1', guia: 'G1', quantidade: 2, validade: '2026-11-30' }),
      ),
    ).toEqual([]);
  });
  it('a negativa e o cancelamento exigem o motivo; o pedido, a consignação e a NF exigem o documento', () => {
    expect(codigos(conferirEtapaOpme(e({ etapa: 'negativa', observacao: 'não' })))).toEqual(['sem-motivo']);
    expect(conferirEtapaOpme(e({ etapa: 'negativa', observacao: 'Fora da cobertura do plano.' }))).toEqual(
      [],
    );
    expect(codigos(conferirEtapaOpme(e({ situacao: 'autorizada', etapa: 'cancelamento' })))).toEqual([
      'sem-motivo',
    ]);
    expect(codigos(conferirEtapaOpme(e({ situacao: 'autorizada', etapa: 'pedido' })))).toEqual([
      'sem-pedido',
    ]);
    expect(
      conferirEtapaOpme(e({ situacao: 'autorizada', etapa: 'pedido', pedido: { ano: 2026, doc: 5 } })),
    ).toEqual([]);
    expect(codigos(conferirEtapaOpme(e({ situacao: 'autorizada', etapa: 'consignacao' })))).toEqual([
      'sem-fornecedor',
    ]);
    expect(conferirEtapaOpme(e({ situacao: 'autorizada', etapa: 'consignacao', fornecedor: 7 }))).toEqual([]);
    expect(codigos(conferirEtapaOpme(e({ situacao: 'consumida', etapa: 'nf' })))).toEqual(['sem-nf']);
    expect(conferirEtapaOpme(e({ situacao: 'cme', etapa: 'cme' }))).toHaveLength(1);
    expect(conferirEtapaOpme(e({ situacao: 'consignada', etapa: 'cme' }))).toEqual([]);
  });
  it('fora de ordem recusa; encerrada diz para abrir outra', () => {
    expect(codigos(conferirEtapaOpme(e({ etapa: 'pedido' })))).toEqual(['etapa-fora-de-ordem']);
    for (const s of ['negada', 'cancelada', 'faturada'] as const)
      expect(conferirEtapaOpme(e({ situacao: s, etapa: 'cotacao' }))[0]?.mensagem).toMatch(/encerrada/);
    expect(conferirEtapaOpme(e({ situacao: 'cme', etapa: 'cotacao' }))[0]?.mensagem).toMatch(
      /situação atual/,
    );
  });
  it('a situação depois de cada etapa', () => {
    const q = { autorizada: 2, consumida: 0, devolvida: 0 };
    expect(situacaoDepoisDaEtapa('solicitada', 'cotacao', q)).toBe('cotacao');
    expect(situacaoDepoisDaEtapa('cotacao', 'autorizacao', q)).toBe('autorizada');
    expect(situacaoDepoisDaEtapa('solicitada', 'negativa', q)).toBe('negada');
    expect(situacaoDepoisDaEtapa('autorizada', 'pedido', q)).toBe('pedido');
    expect(situacaoDepoisDaEtapa('autorizada', 'consignacao', q)).toBe('consignada');
    expect(situacaoDepoisDaEtapa('consignada', 'cme', q)).toBe('cme');
    expect(situacaoDepoisDaEtapa('cme', 'consumo', { ...q, consumida: 1 })).toBe('consumida');
    expect(situacaoDepoisDaEtapa('consumida', 'devolucao', { ...q, consumida: 1, devolvida: 1 })).toBe(
      'devolvida',
    );
    expect(situacaoDepoisDaEtapa('consumida', 'nf', q)).toBe('faturada');
    expect(situacaoDepoisDaEtapa('devolvida', 'nf', q)).toBe('faturada');
    expect(situacaoDepoisDaEtapa('pedido', 'nf', q)).toBe('pedido');
    expect(situacaoDepoisDaEtapa('autorizada', 'cancelamento', q)).toBe('cancelada');
    expect(situacaoDepoisDaEtapa('autorizada', 'solicitacao', q)).toBe('autorizada');
  });
  it('o Zod da etapa só aceita as manuais', () => {
    const ok = {
      solicitacao: 1,
      chave: 'opme-etapa-0001',
      versaoVista: 1,
      etapa: 'autorizacao',
      em: '2026-10-26T10:00',
      senha: 'ABC123',
      guia: '9988',
      quantidade: 1,
    };
    expect(esquemaAvancarEtapaOpme.safeParse(ok).success).toBe(true);
    expect(esquemaAvancarEtapaOpme.safeParse({ ...ok, etapa: 'consumo' }).success).toBe(false);
  });
});

describe('consumo em sala (regras 6 e 7) e devolução', () => {
  const autorizada = { situacao: 'cme' as const, item: 900, autorizada: 2, consumida: 0, devolvida: 0 };
  const base = {
    solicitacao: autorizada,
    item: 900,
    classeItem: 50,
    quantidade: 1,
    lote: 'L-77',
    serie: null,
    fabricante: 'Fabricante Sintético',
    registroAnvisa: '80123450001',
    validade: '2028-01-31',
    hoje: '2026-10-26',
    justificativa: null,
    podeExcecao: false,
  };
  it('aceita o consumo autorizado com lote, fabricante e Anvisa', () => {
    expect(conferirConsumoOpme(base)).toEqual([]);
    expect(conferirConsumoOpme({ ...base, lote: null, serie: 'SN-1' })).toEqual([]);
  });
  it('recusa sem lote nem série, sem fabricante, Anvisa inválido, vencido e item errado', () => {
    expect(
      codigos(
        conferirConsumoOpme({
          ...base,
          lote: ' ',
          serie: null,
          fabricante: 'x',
          registroAnvisa: '12',
          validade: '2026-01-01',
          item: 901,
        }),
      ),
    ).toEqual(['sem-rastreio', 'sem-fabricante', 'anvisa-invalido', 'opme-vencido', 'item-da-solicitacao']);
    expect(codigos(conferirConsumoOpme({ ...base, classeItem: 20 }))).toEqual(['item-nao-opme']);
    expect(codigos(conferirConsumoOpme({ ...base, classeItem: null, quantidade: 0 }))).toEqual([
      'item-inexistente',
      'quantidade-invalida',
    ]);
  });
  it('acima do autorizado recusa (o excedente vai sem solicitação)', () => {
    expect(
      codigos(
        conferirConsumoOpme({
          ...base,
          solicitacao: { ...autorizada, consumida: 2, devolvida: 1 },
          quantidade: 2,
        }),
      ),
    ).toEqual(['acima-do-autorizado']);
    expect(
      conferirConsumoOpme({
        ...base,
        solicitacao: { ...autorizada, consumida: 2, devolvida: 1 },
        quantidade: 1,
      }),
    ).toEqual([]);
  });
  it('sem autorização: só o supervisor, com a justificativa (OPME_SEM_AUTORIZACAO)', () => {
    expect(consumoExigeExcecao(null)).toBe(true);
    expect(consumoExigeExcecao({ ...autorizada, situacao: 'solicitada' })).toBe(true);
    expect(consumoExigeExcecao(autorizada)).toBe(false);
    expect(codigos(conferirConsumoOpme({ ...base, solicitacao: null }))).toEqual(['sem-autorizacao']);
    expect(codigos(conferirConsumoOpme({ ...base, solicitacao: null, podeExcecao: true }))).toEqual([
      'sem-justificativa',
    ]);
    expect(
      conferirConsumoOpme({
        ...base,
        solicitacao: { ...autorizada, situacao: 'cotacao' },
        podeExcecao: true,
        justificativa: 'Urgência: fratura exposta sem tempo de autorizar.',
      }),
    ).toEqual([]);
  });
  it('solicitação negada ou cancelada recusa (vai sem solicitação)', () => {
    const r = conferirConsumoOpme({
      ...base,
      solicitacao: { ...autorizada, situacao: 'negada' },
      podeExcecao: true,
    });
    expect(codigos(r)).toEqual(['solicitacao-encerrada']);
    expect(r[0]?.mensagem).toMatch(/negou/);
    expect(
      conferirConsumoOpme({ ...base, solicitacao: { ...autorizada, situacao: 'cancelada' } })[0]?.mensagem,
    ).toMatch(/encerrada/);
  });
  it('a devolução até o consumido menos o devolvido, com o motivo', () => {
    expect(
      conferirDevolucaoOpme({
        consumida: 2,
        devolvida: 1,
        quantidade: 1,
        motivo: 'Tamanho errado, não usado.',
      }),
    ).toEqual([]);
    expect(
      codigos(conferirDevolucaoOpme({ consumida: 2, devolvida: 1, quantidade: 2, motivo: 'curto' })),
    ).toEqual(['devolucao-maior', 'sem-motivo']);
    expect(
      codigos(
        conferirDevolucaoOpme({
          consumida: 2,
          devolvida: 0,
          quantidade: 0,
          motivo: 'Não usado na cirurgia.',
        }),
      ),
    ).toEqual(['quantidade-invalida']);
  });
  it('o Zod do consumo exige lote ou série; a saída com `opme` só a internado, um item', () => {
    const c = {
      agendamento: 1,
      chave: 'opme-cons-0001',
      item: 900,
      quantidade: 1,
      local: 10,
      fabricante: 'Fab',
      registroAnvisa: '801.2345.0001',
    };
    expect(esquemaConsumirOpme.safeParse({ ...c, lote: 'L1' }).success).toBe(true);
    expect(esquemaConsumirOpme.safeParse({ ...c, lote: 'L1' }).data?.registroAnvisa).toBe('80123450001');
    expect(esquemaConsumirOpme.safeParse(c).success).toBe(false);
    const saida = {
      destino: 2,
      local: 10,
      centroCusto: 300310,
      localConsumo: 11,
      itens: [{ item: 900, quantidade: 1 }],
      opme: {
        agendamento: 1,
        sala: 1,
        dataHora: '2026-10-26T08:00',
        lote: 'L1',
        fabricante: 'Fab',
        registroAnvisa: '80123450001',
      },
    };
    expect(esquemaRegistrarSaida.safeParse(saida).success).toBe(false);
    expect(esquemaRegistrarSaida.safeParse({ ...saida, destino: 1, atendimento: 5 }).success).toBe(true);
  });
});
