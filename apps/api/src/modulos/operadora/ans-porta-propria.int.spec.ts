// Integração da porta própria das obrigações com a ANS contra o MariaDB real (cliente f22_o2). Massa sintética
// "L0209". Contrato de efeito: o envio e os registros (envio_ans, envio_ans_item), a transmissão com o recibo, o
// retorno (envio_ans_retorno) com o CCO no beneficiário, o retificador que substitui o original, a versão, a trilha e o
// outbox; e as recusas (retorno sem transmissão, conflito de versão, outro estabelecimento, retificador sem original).
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaAnsOperadoraPropria, periodoDaCompetencia } from './ans-porta-propria.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  limparNegocio,
  type MassaOperadora,
  prepararMassa,
  SEM_BANCO,
  trilhaTela,
} from './infra/massa-operadora.spec-util.js';

describe('competência do envio → período do banco', () => {
  it('mês, trimestre e dia', () => {
    expect(periodoDaCompetencia('2026-02')).toMatchObject({
      inicio: '2026-02-01',
      fim: '2026-02-28',
      competencia: '2026-02-01',
    });
    expect(periodoDaCompetencia('2026-T3')).toMatchObject({
      inicio: '2026-07-01',
      fim: '2026-09-30',
      trimestre: 3,
      competencia: null,
    });
    expect(periodoDaCompetencia('2026-10-05')).toMatchObject({ inicio: '2026-10-05', fim: '2026-10-05' });
    expect(() => periodoDaCompetencia('2026/10')).toThrow();
  });
});

describe.skipIf(SEM_BANCO)('porta própria das obrigações com a ANS (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaAnsOperadoraPropria;
  let m: MassaOperadora;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't0209' }, (l) => l.consultar(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    m = await prepararMassa(nucleo);
    await limparNegocio(nucleo, m);
    await limparRessarcimento();
    porta = new PortaAnsOperadoraPropria(nucleo, CLIENTE, { gruposSip: async () => [] }, 'simulador');
  }, 120_000);
  afterAll(async () => {
    if (m) {
      await limparNegocio(nucleo, m);
      await limparRessarcimento();
    }
    await nucleo?.encerrar();
  });

  /** O ressarcimento da massa (depois dos envios, por causa das chaves). */
  const limparRessarcimento = () =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-ressarcimento' }, async (e) => {
      const est = [m.est, m.outroEst];
      await e.executar(
        'DELETE i FROM impugnacao_ressarcimento_sus i JOIN ressarcimento_sus_atendimento a ON a.id = i.ressarcimento_sus_atendimento_id JOIN cobranca_ressarcimento_sus c ON c.id = a.cobranca_ressarcimento_sus_id WHERE c.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar(
        'DELETE a FROM ressarcimento_sus_atendimento a JOIN cobranca_ressarcimento_sus c ON c.id = a.cobranca_ressarcimento_sus_id WHERE c.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar('DELETE FROM cobranca_ressarcimento_sus WHERE estabelecimento_id IN (?, ?)', est);
    });

  const gerar = (substituir: number[] = [], retificador = false) =>
    porta.gravar(contexto(m), trilhaTela(m, 'envio_ans', 'operadora.ans.gerado'), (g) =>
      g.gerar({
        operadora: m.operadora,
        obrigacao: 'SIB',
        competencia: '2026-09',
        sequencial: 1,
        retificador,
        destino: 'simulador',
        leiaute: 'SIB-XML-1.1',
        registros: 1,
        valorTotal: null,
        quadros: '{}',
        arquivo: null,
        substituir,
        itens: [
          {
            ordem: 1,
            tipo: 'beneficiario',
            referencia: `L02090001`,
            descricao: 'Inclusão do beneficiário sintético',
            beneficiario: m.beneficiario,
            valor: null,
            dados: '{"movimento":1}',
          },
        ],
        usuario: 'l0209.teste',
      }),
    );

  it('gera o envio: envio, registro, trilha e outbox; lê o envio, os registros e os existentes', async () => {
    const r = await gerar();
    const [e] = await ler('SELECT * FROM envio_ans WHERE id = ?', [r.id]);
    expect(e).toMatchObject({
      obrigacao: 'sib',
      tipo_envio: 'original',
      situacao: 'gerado',
      estabelecimento_id: m.est,
    });
    const itens = await ler(
      'SELECT tipo_registro, situacao, beneficiario_plano_id FROM envio_ans_item WHERE envio_ans_id = ?',
      [r.id],
    );
    expect(itens).toEqual([
      { tipo_registro: 'beneficiario', situacao: 'pendente', beneficiario_plano_id: m.beneficiario },
    ]);
    expect(
      await ler("SELECT id FROM trilha_auditoria WHERE entidade = 'envio_ans' AND entidade_id = ?", [r.id]),
    ).toHaveLength(1);
    expect(
      await ler(
        "SELECT id FROM integracao_mensagem WHERE ponto = 'operadora.ans.gravacao' AND entidade_id = ?",
        [r.id],
      ),
    ).toHaveLength(1);
    const lido = await porta.envio(contexto(m), r.id);
    expect(lido).toMatchObject({
      obrigacao: 'SIB',
      competencia: '2026-09',
      sequencial: 1,
      situacao: 'gerado',
      registros: 1,
      destino: 'simulador',
      criadoPor: 'l0209.teste',
    });
    expect(await porta.itens(contexto(m), r.id)).toEqual([
      expect.objectContaining({
        tipo: 'beneficiario',
        referencia: 'L02090001',
        resultado: 'enviado',
        beneficiario: m.beneficiario,
      }),
    ]);
    expect((await porta.existentes(contexto(m), m.operadora, 'SIB', '2026-09')).map((x) => x.id)).toEqual([
      r.id,
    ]);
    expect((await porta.envios(contexto(m), { obrigacao: 'SIB' })).itens.map((x) => x.id)).toContain(r.id);
    expect(await porta.envio(contexto(m, m.outroEst), r.id)).toBeNull();
    expect((await porta.totais(contexto(m))).gerados).toBeGreaterThanOrEqual(1);
  });

  it('transmite, recebe o retorno e grava o CCO no beneficiário; recusa retorno sem transmissão e versão velha', async () => {
    const r = await gerar();
    const antes = await porta
      .gravar(contexto(m), trilhaTela(m, 'envio_ans', 'x'), (g) =>
        g.retorno({
          id: r.id,
          versao: 1,
          usuario: 'x',
          situacao: 'aceito',
          resumo: null,
          itens: [],
          sib: true,
          texto: 'x',
        }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(antes).toBe('envio-sem-transmissao');
    const t = await porta.gravar(contexto(m), trilhaTela(m, 'envio_ans', 'operadora.ans.transmitido'), (g) =>
      g.transmitir({ id: r.id, versao: 1, usuario: 'x', recibo: 'REC-L0209', texto: 'transmitido' }),
    );
    expect(t.versao).toBe(2);
    const velha = await porta
      .gravar(contexto(m), trilhaTela(m, 'envio_ans', 'x'), (g) =>
        g.retorno({
          id: r.id,
          versao: 1,
          usuario: 'x',
          situacao: 'aceito',
          resumo: null,
          itens: [],
          sib: true,
          texto: 'x',
        }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(velha).toBe('conflito-versao');
    const [item] = await porta.itens(contexto(m), r.id);
    await porta.gravar(contexto(m), trilhaTela(m, 'envio_ans', 'operadora.ans.retorno'), (g) =>
      g.retorno({
        id: r.id,
        versao: 2,
        usuario: 'x',
        situacao: 'aceito',
        resumo: '1 registro aceito',
        itens: [{ id: item!.id, aceito: true, cco: '90209000001', erro: null }],
        sib: true,
        texto: 'retorno',
      }),
    );
    const [b] = await ler('SELECT codigo_controle_ans FROM beneficiario_plano WHERE id = ?', [
      m.beneficiario,
    ]);
    expect(b!['codigo_controle_ans']).toBe('90209000001');
    const lido = await porta.envio(contexto(m), r.id);
    expect(lido).toMatchObject({
      situacao: 'aceito',
      recibo: 'REC-L0209',
      retornoResumo: '1 registro aceito',
    });
    expect((await porta.itens(contexto(m), r.id))[0]).toMatchObject({
      resultado: 'aceito',
      cco: '90209000001',
    });
    expect((await porta.eventos(contexto(m), r.id)).map((x) => x.evento)).toEqual([
      'gerado',
      'enviado',
      'retorno',
    ]);
  });

  it('retificador substitui o original; recusa retificador sem original e outro estabelecimento', async () => {
    const sem = await gerar([], true).catch((e: unknown) => codigoDe(e));
    expect(sem).toBe('retificador-sem-original');
    const o = await gerar();
    const r = await gerar([o.id], true);
    const [orig] = await ler('SELECT situacao FROM envio_ans WHERE id = ?', [o.id]);
    expect(orig!['situacao']).toBe('substituido');
    const [ret] = await ler('SELECT tipo_envio, substituido_envio_ans_id FROM envio_ans WHERE id = ?', [
      r.id,
    ]);
    expect(ret).toMatchObject({ tipo_envio: 'retificador', substituido_envio_ans_id: o.id });
    const fora = await porta
      .gravar(contexto(m, m.outroEst), trilhaTela(m, 'envio_ans', 'x', m.outroEst), (g) =>
        g.transmitir({ id: r.id, versao: 1, usuario: 'x', recibo: null, texto: 'x' }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(fora).toBe('registro-inexistente');
  });

  it('ressarcimento ao SUS: o aviso gera a cobrança e os atendimentos; decide cada um; registra a GRU paga', async () => {
    const r = await porta.gravar(contexto(m), trilhaTela(m, 'envio_ans', 'operadora.ans.gerado'), (g) =>
      g.gerar({
        operadora: m.operadora,
        obrigacao: 'RESSARCIMENTO_SUS',
        competencia: '2026-09',
        sequencial: 1,
        retificador: false,
        destino: 'simulador',
        leiaute: 'ABI-1',
        registros: 2,
        valorTotal: 1800,
        quadros: '{}',
        arquivo: null,
        aviso: { numero: 'AV-L0209-1', recebidoEm: '2026-10-01', prazo: '2026-11-15' },
        substituir: [],
        itens: [
          {
            ordem: 1,
            tipo: 'AIH',
            referencia: '3526100000001',
            descricao: 'AIH sintética',
            beneficiario: m.beneficiario,
            valor: 1500,
            dados: '{"inicio":"2026-08-10","fim":"2026-08-15"}',
            sugestao: 'carencia',
            decisao: 'pendente',
          },
          {
            ordem: 2,
            tipo: 'APAC',
            referencia: '3526100000002',
            descricao: 'APAC sintética',
            beneficiario: m.beneficiario,
            valor: 300,
            dados: '{"inicio":"2026-08-20"}',
            sugestao: null,
            decisao: 'pendente',
          },
        ],
        usuario: 'l0209.teste',
      }),
    );
    const [e] = await ler('SELECT obrigacao, cobranca_ressarcimento_sus_id FROM envio_ans WHERE id = ?', [
      r.id,
    ]);
    expect(e!['obrigacao']).toBe('ressarcimento_sus');
    const [cr] = await ler('SELECT * FROM cobranca_ressarcimento_sus WHERE id = ?', [
      e!['cobranca_ressarcimento_sus_id'],
    ]);
    expect(cr).toMatchObject({
      numero_oficio: 'AV-L0209-1',
      situacao: 'notificada',
      estabelecimento_id: m.est,
    });
    expect(Number(cr!['valor_oficio'])).toBe(1800);
    const ats = await ler(
      'SELECT tipo_atendimento, situacao_validacao FROM ressarcimento_sus_atendimento WHERE cobranca_ressarcimento_sus_id = ? ORDER BY sequencia',
      [cr!['id']],
    );
    expect(ats).toEqual([
      { tipo_atendimento: 'internacao', situacao_validacao: 'pendente' },
      { tipo_atendimento: 'ambulatorial', situacao_validacao: 'pendente' },
    ]);
    expect(await porta.envio(contexto(m), r.id)).toMatchObject({
      aviso: 'AV-L0209-1',
      recebidoEm: '2026-10-01',
      prazo: '2026-11-15',
      gru: null,
    });
    const itens = await porta.itens(contexto(m), r.id);
    const decidir = (item: number, versao: number, decisao: 'impugnar' | 'aceitar', motivo: string | null) =>
      porta.gravar(contexto(m), trilhaTela(m, 'envio_ans', 'operadora.ans.decidido'), (g) =>
        g.decidir({
          id: r.id,
          versao,
          item,
          decisao,
          motivo,
          justificativa: 'Justificativa sintética',
          texto: 't',
          usuario: 'l0209.teste',
        }),
      );
    const d1 = await decidir(itens[0]!.id, r.versao, 'impugnar', 'carencia');
    const d2 = await decidir(itens[1]!.id, d1.versao, 'aceitar', null);
    expect(await decidir(itens[1]!.id, r.versao, 'aceitar', null).catch((x: unknown) => codigoDe(x))).toBe(
      'conflito-versao',
    );
    const [imp] = await ler(
      'SELECT i.situacao, i.natureza_motivo, i.valor_impugnado, i.prazo_final FROM impugnacao_ressarcimento_sus i JOIN ressarcimento_sus_atendimento a ON a.id = i.ressarcimento_sus_atendimento_id WHERE a.cobranca_ressarcimento_sus_id = ?',
      [cr!['id']],
    );
    expect(imp).toMatchObject({ situacao: 'em_elaboracao', natureza_motivo: 'administrativo' });
    expect(Number(imp!['valor_impugnado'])).toBe(1500);
    expect(
      (
        await ler(
          'SELECT situacao_validacao AS s FROM ressarcimento_sus_atendimento WHERE cobranca_ressarcimento_sus_id = ? ORDER BY sequencia',
          [cr!['id']],
        )
      ).map((x) => x['s']),
    ).toEqual(['impugnado', 'devido']);
    const lidos = await porta.itens(contexto(m), r.id);
    expect(lidos[0]).toMatchObject({
      decisao: 'impugnar',
      motivo: 'carencia',
      justificativa: 'Justificativa sintética',
      decididoPor: 'l0209.teste',
    });
    // Mudar para aceitar desiste da impugnação aberta.
    const d3 = await decidir(itens[0]!.id, d2.versao, 'aceitar', null);
    expect(
      (await ler('SELECT situacao FROM impugnacao_ressarcimento_sus WHERE situacao = ? ', ['desistida']))
        .length,
    ).toBeGreaterThanOrEqual(1);
    const pagar = (versao: number) =>
      porta.gravar(contexto(m), trilhaTela(m, 'envio_ans', 'operadora.ans.pago'), (g) =>
        g.pagar({
          id: r.id,
          versao,
          gru: 'GRU-L0209-1',
          valor: 1800,
          data: '2026-11-20',
          usuario: 'l0209.teste',
        }),
      );
    const p = await pagar(d3.versao);
    expect(await porta.envio(contexto(m), r.id)).toMatchObject({
      gru: 'GRU-L0209-1',
      pagoEm: '2026-11-20',
      valorPago: 1800,
    });
    const [pago] = await ler('SELECT situacao FROM cobranca_ressarcimento_sus WHERE id = ?', [cr!['id']]);
    expect(pago!['situacao']).toBe('paga');
    expect(await pagar(p.versao).catch((x: unknown) => codigoDe(x))).toBe('situacao-nao-permite');
    expect(await porta.envio(contexto(m, m.outroEst), r.id)).toBeNull();
  });

  it('TPS: a GRU e o pagamento ficam no próprio envio, uma vez só', async () => {
    const r = await porta.gravar(contexto(m), trilhaTela(m, 'envio_ans', 'operadora.ans.gerado'), (g) =>
      g.gerar({
        operadora: m.operadora,
        obrigacao: 'TPS',
        competencia: '2026-07',
        sequencial: 1,
        retificador: false,
        destino: 'simulador',
        leiaute: 'TPS-1',
        registros: 0,
        valorTotal: 950,
        quadros: '{}',
        arquivo: null,
        aviso: null,
        substituir: [],
        itens: [],
        usuario: 'l0209.teste',
      }),
    );
    const pagar = (versao: number) =>
      porta.gravar(contexto(m), trilhaTela(m, 'envio_ans', 'operadora.ans.pago'), (g) =>
        g.pagar({
          id: r.id,
          versao,
          gru: 'GRU-TPS-L0209',
          valor: 950,
          data: '2026-11-19',
          usuario: 'l0209.teste',
        }),
      );
    const p = await pagar(r.versao);
    expect(await porta.envio(contexto(m), r.id)).toMatchObject({
      gru: 'GRU-TPS-L0209',
      pagoEm: '2026-11-19',
      valorPago: 950,
    });
    const [e] = await ler('SELECT valor_gru, valor_pago_gru FROM envio_ans WHERE id = ?', [r.id]);
    expect(Number(e!['valor_gru'])).toBe(950);
    expect(await pagar(p.versao).catch((x: unknown) => codigoDe(x))).toBe('situacao-nao-permite');
    expect(await porta.envio(contexto(m, m.outroEst), r.id)).toBeNull();
  });

  it('bases e domínios: beneficiário da operadora, ativos, planos, motivos; o que falta responde 501', async () => {
    expect(await porta.beneficiarioDaOperadora(contexto(m), m.beneficiario)).toMatchObject({
      operadora: m.operadora,
      carteirinha: 'L02090001',
    });
    expect(await porta.beneficiarioDaOperadora(contexto(m, m.outroEst), m.beneficiario)).toBeNull();
    const ativos = await porta.ativosNaData(contexto(m), m.operadora, '2026-09-30');
    expect(ativos.find((a) => a.produto === m.produto)?.quantidade).toBeGreaterThanOrEqual(1);
    expect((await porta.planos(contexto(m), m.operadora)).map((p) => p.produto)).toContain(m.produto);
    expect((await porta.motivosSib(contexto(m))).find((x) => x.codigo === 1)).toMatchObject({ grupo: 1 });
    expect((await porta.camposSib()).length).toBeGreaterThan(10);
    expect(await porta.arquivo().catch((e: unknown) => codigoDe(e))).toBe('modelo-pendente');
  });

  it('complemento do SIB: inclui, altera sobre a versão vista, CCO único e o retrato aceito; endereço só do cadastro', async () => {
    const T = trilhaTela(m, 'complemento_sib_beneficiario', 'operadora.ans.complemento');
    // O retorno aceito do caso anterior já criou o complemento, com o retrato aceito (o registro do envio).
    const vazio = await porta.complementoSib(contexto(m), m.beneficiario);
    expect(vazio).toMatchObject({
      beneficiario: m.beneficiario,
      versao: 1,
      dnv: null,
      itensExcluidos: false,
    });
    expect(vazio!.aceito).not.toBeNull();
    expect(vazio!.aceitoEm).not.toBeNull();
    const v = vazio!.versao;
    expect(await porta.complementoSib(contexto(m, m.outroEst), m.beneficiario)).toBeNull();
    const base = {
      beneficiario: m.beneficiario,
      logradouro: vazio!.logradouro,
      numero: vazio!.numero,
      complemento: vazio!.complemento,
      bairro: vazio!.bairro,
      municipio: vazio!.municipio,
      cep: vazio!.cep,
      resideExterior: false,
      dnv: '12345678901',
      coberturaParcial: true,
      itensExcluidos: true,
      cco: '90209000077',
      motivoCancelamento: null,
      usuario: 'x',
    };
    expect(await porta.gravar(contexto(m), T, (g) => g.complemento({ ...base, versao: v }))).toEqual({
      id: m.beneficiario,
      versao: v + 1,
    });
    expect(await porta.complementoSib(contexto(m), m.beneficiario)).toMatchObject({
      versao: v + 1,
      dnv: '12345678901',
      coberturaParcial: true,
      itensExcluidos: true,
      cco: '90209000077',
    });
    const velha = await porta
      .gravar(contexto(m), T, (g) => g.complemento({ ...base, versao: v }))
      .catch((e: unknown) => codigoDe(e));
    expect(velha).toBe('envio-desatualizado');
    const endereco = await porta
      .gravar(contexto(m), T, (g) =>
        g.complemento({ ...base, versao: v + 1, logradouro: 'Rua Sintética Diferente', cep: '01001000' }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(endereco).toBe('endereco-do-cadastro');
    expect(
      await porta.gravar(contexto(m), T, (g) => g.complemento({ ...base, versao: v + 1, dnv: null })),
    ).toEqual({ id: m.beneficiario, versao: v + 2 });
    expect(
      await ler(
        'SELECT codigo_controle_ans, cobertura_parcial_temporaria FROM beneficiario_plano WHERE id = ?',
        [m.beneficiario],
      ),
    ).toEqual([{ codigo_controle_ans: '90209000077', cobertura_parcial_temporaria: 1 }]);
    expect(
      (await ler("SELECT id FROM trilha_auditoria WHERE entidade = 'complemento_sib_beneficiario'")).length,
    ).toBeGreaterThanOrEqual(2);
    // Desfaz o CCO para não colidir com os outros casos.
    await porta.gravar(contexto(m), T, (g) =>
      g.complemento({ ...base, versao: v + 2, cco: null, coberturaParcial: false }),
    );
  });

  it('base do DIOPS (eventos): contas recebidas da rede no período, sem as de outro estabelecimento', async () => {
    const r = await porta.contasDiops(contexto(m), m.operadora, '2000-01-01', '2099-12-31');
    expect(Array.isArray(r.contas)).toBe(true);
    expect(Array.isArray(r.pagamentos)).toBe(true);
    for (const k of r.contas) expect(['recebida', 'analisada', 'paga', 'devolvida']).toContain(k.situacao);
    expect(await porta.contasDiops(contexto(m), m.operadora, '1990-01-01', '1990-01-31')).toEqual({
      contas: [],
      pagamentos: [],
    });
  });
});
