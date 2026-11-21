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
    expect(periodoDaCompetencia('2026-02')).toMatchObject({ inicio: '2026-02-01', fim: '2026-02-28', competencia: '2026-02-01' });
    expect(periodoDaCompetencia('2026-T3')).toMatchObject({ inicio: '2026-07-01', fim: '2026-09-30', trimestre: 3, competencia: null });
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
    porta = new PortaAnsOperadoraPropria(nucleo, CLIENTE, { gruposSip: async () => [] }, 'simulador');
  }, 120_000);
  afterAll(async () => {
    if (m) await limparNegocio(nucleo, m);
    await nucleo?.encerrar();
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
    expect(e).toMatchObject({ obrigacao: 'sib', tipo_envio: 'original', situacao: 'gerado', estabelecimento_id: m.est });
    const itens = await ler('SELECT tipo_registro, situacao, beneficiario_plano_id FROM envio_ans_item WHERE envio_ans_id = ?', [r.id]);
    expect(itens).toEqual([{ tipo_registro: 'beneficiario', situacao: 'pendente', beneficiario_plano_id: m.beneficiario }]);
    expect(await ler("SELECT id FROM trilha_auditoria WHERE entidade = 'envio_ans' AND entidade_id = ?", [r.id])).toHaveLength(1);
    expect(await ler("SELECT id FROM integracao_mensagem WHERE ponto = 'operadora.ans.gravacao' AND entidade_id = ?", [r.id])).toHaveLength(1);
    const lido = await porta.envio(contexto(m), r.id);
    expect(lido).toMatchObject({ obrigacao: 'SIB', competencia: '2026-09', sequencial: 1, situacao: 'gerado', registros: 1, destino: 'simulador', criadoPor: 'l0209.teste' });
    expect(await porta.itens(contexto(m), r.id)).toEqual([
      expect.objectContaining({ tipo: 'beneficiario', referencia: 'L02090001', resultado: 'enviado', beneficiario: m.beneficiario }),
    ]);
    expect((await porta.existentes(contexto(m), m.operadora, 'SIB', '2026-09')).map((x) => x.id)).toEqual([r.id]);
    expect((await porta.envios(contexto(m), { obrigacao: 'SIB' })).itens.map((x) => x.id)).toContain(r.id);
    expect(await porta.envio(contexto(m, m.outroEst), r.id)).toBeNull();
    expect((await porta.totais(contexto(m))).gerados).toBeGreaterThanOrEqual(1);
  });

  it('transmite, recebe o retorno e grava o CCO no beneficiário; recusa retorno sem transmissão e versão velha', async () => {
    const r = await gerar();
    const antes = await porta
      .gravar(contexto(m), trilhaTela(m, 'envio_ans', 'x'), (g) =>
        g.retorno({ id: r.id, versao: 1, usuario: 'x', situacao: 'aceito', resumo: null, itens: [], sib: true, texto: 'x' }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(antes).toBe('envio-sem-transmissao');
    const t = await porta.gravar(contexto(m), trilhaTela(m, 'envio_ans', 'operadora.ans.transmitido'), (g) =>
      g.transmitir({ id: r.id, versao: 1, usuario: 'x', recibo: 'REC-L0209', texto: 'transmitido' }),
    );
    expect(t.versao).toBe(2);
    const velha = await porta
      .gravar(contexto(m), trilhaTela(m, 'envio_ans', 'x'), (g) =>
        g.retorno({ id: r.id, versao: 1, usuario: 'x', situacao: 'aceito', resumo: null, itens: [], sib: true, texto: 'x' }),
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
    const [b] = await ler('SELECT codigo_controle_ans FROM beneficiario_plano WHERE id = ?', [m.beneficiario]);
    expect(b!['codigo_controle_ans']).toBe('90209000001');
    const lido = await porta.envio(contexto(m), r.id);
    expect(lido).toMatchObject({ situacao: 'aceito', recibo: 'REC-L0209', retornoResumo: '1 registro aceito' });
    expect((await porta.itens(contexto(m), r.id))[0]).toMatchObject({ resultado: 'aceito', cco: '90209000001' });
    expect((await porta.eventos(contexto(m), r.id)).map((x) => x.evento)).toEqual(['gerado', 'enviado', 'retorno']);
  });

  it('retificador substitui o original; recusa retificador sem original e outro estabelecimento', async () => {
    const sem = await gerar([], true).catch((e: unknown) => codigoDe(e));
    expect(sem).toBe('retificador-sem-original');
    const o = await gerar();
    const r = await gerar([o.id], true);
    const [orig] = await ler('SELECT situacao FROM envio_ans WHERE id = ?', [o.id]);
    expect(orig!['situacao']).toBe('substituido');
    const [ret] = await ler('SELECT tipo_envio, substituido_envio_ans_id FROM envio_ans WHERE id = ?', [r.id]);
    expect(ret).toMatchObject({ tipo_envio: 'retificador', substituido_envio_ans_id: o.id });
    const fora = await porta
      .gravar(contexto(m, m.outroEst), trilhaTela(m, 'envio_ans', 'x', m.outroEst), (g) =>
        g.transmitir({ id: r.id, versao: 1, usuario: 'x', recibo: null, texto: 'x' }),
      )
      .catch((e: unknown) => codigoDe(e));
    expect(fora).toBe('registro-inexistente');
  });

  it('bases e domínios: beneficiário da operadora, ativos, planos, motivos; o que falta responde 501', async () => {
    expect(await porta.beneficiarioDaOperadora(contexto(m), m.beneficiario)).toMatchObject({ operadora: m.operadora, carteirinha: 'L02090001' });
    expect(await porta.beneficiarioDaOperadora(contexto(m, m.outroEst), m.beneficiario)).toBeNull();
    const ativos = await porta.ativosNaData(contexto(m), m.operadora, '2026-09-30');
    expect(ativos.find((a) => a.produto === m.produto)?.quantidade).toBeGreaterThanOrEqual(1);
    expect((await porta.planos(contexto(m), m.operadora)).map((p) => p.produto)).toContain(m.produto);
    expect((await porta.motivosSib(contexto(m))).find((x) => x.codigo === 1)).toMatchObject({ grupo: 1 });
    expect((await porta.camposSib()).length).toBeGreaterThan(10);
    expect(await porta.arquivo().catch((e: unknown) => codigoDe(e))).toBe('modelo-pendente');
  });
});
