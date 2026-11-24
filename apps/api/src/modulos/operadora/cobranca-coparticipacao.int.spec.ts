// F7 (08-SGO linha 98): contrato de efeito da coparticipação no MariaDB real (cliente f22_o2, massa sintética "L0209").
// O serviço lê a regra geral vigente (a do contrato prevalece sobre a do plano, a vencida não vale), aplica os tetos por
// evento, mês e ano com o que já foi lançado ao beneficiário (fatura cancelada não conta) e grava a fatura de
// coparticipação (fatura_plano tipo coparticipacao e fatura_plano_item com o valor do evento). SGH_NUCLEO_SEM_BANCO=1 pula.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { PortaCobrancaOperadoraPropria } from './cobranca-porta-propria.js';
import { ServicoCobrancaOperadora } from './cobranca-servico.js';
import {
  CLIENTE,
  contexto,
  limparNegocio,
  type MassaOperadora,
  P,
  prepararMassa,
  SEM_BANCO,
} from './infra/massa-operadora.spec-util.js';

const COD = `${P}-CP`;
const hoje = new Date().toISOString().slice(0, 10);
const ano = hoje.slice(0, 4);
const competencia = `${ano}-${hoje.slice(5, 7)}`;
const vencimento = `${competencia}-28`;

describe.skipIf(SEM_BANCO)('coparticipação com regra e tetos (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaCobrancaOperadoraPropria;
  let servico: ServicoCobrancaOperadora;
  let m: MassaOperadora;
  let s: SessaoCadastro;
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't0982' }, (l) => l.consultar(sql, p));
  const escrever = (sql: string, p: unknown[] = []) =>
    nucleo.escrever({ cliente: CLIENTE, correlacao: 't0982-massa' }, (e) => e.executar(sql, p));
  const limparRegras = () =>
    escrever('DELETE FROM regra_coparticipacao WHERE operadora_saude_id = ? AND codigo LIKE ?', [
      m.operadora,
      `${COD}%`,
    ]);
  /** Uma regra geral do plano comercializado da massa ou do contrato. */
  const regra = async (codigo: string, x: Record<string, unknown>) => {
    const plano = (
      await ler('SELECT id FROM plano_comercializado WHERE estabelecimento_id = ? AND produto_plano_id = ?', [
        m.est,
        m.produto,
      ])
    )[0]?.['id'];
    const v = {
      operadora_saude_id: m.operadora,
      codigo: `${COD}-${codigo}`,
      descricao: 'REGRA SINTETICA L0982',
      plano_comercializado_id: x['contrato_plano_id'] ? null : plano,
      vigencia_inicio: '2020-01-01',
      ativo: true,
      criado_em: new Date(),
      ...x,
    };
    const cols = Object.keys(v);
    await escrever(
      `INSERT INTO regra_coparticipacao (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      Object.values(v),
    );
  };
  const lancar = (valorEvento: number, beneficiario = m.dependente) =>
    servico.coparticipacao(s, {
      beneficiario,
      competencia,
      vencimento,
      valorEvento,
      descricao: 'CONSULTA SINTETICA L0982',
    });
  const codigo = async (p: Promise<unknown>) => {
    try {
      await p;
      return null;
    } catch (e) {
      return `${(e as Error).message} ${JSON.stringify(e)}`;
    }
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limparNegocio(nucleo, m);
    await limparRegras();
    porta = new PortaCobrancaOperadoraPropria(nucleo, CLIENTE);
    servico = new ServicoCobrancaOperadora(
      porta,
      { exigir: async () => undefined } as unknown as ConstructorParameters<
        typeof ServicoCobrancaOperadora
      >[1],
      null,
      'teste',
    );
    const porta0 = contexto(m);
    s = {
      req: { headers: {}, ip: '127.0.0.1', sgh: { sessao: { unidadeAtiva: null } } } as never,
      hospital: porta0.hospital,
      rede: porta0.rede,
      login: 'l0982.teste',
      porta: porta0,
      pode: () => true,
    };
  }, 120_000);
  afterAll(async () => {
    if (m) {
      await limparNegocio(nucleo, m);
      await limparRegras();
    }
    await nucleo?.encerrar();
  });

  it('sem regra vigente: recusa produto-sem-coparticipacao e nada grava', async () => {
    await regra('VENCIDA', {
      tipo_coparticipacao: 'percentual',
      percentual: 30,
      vigencia_inicio: '2020-01-01',
      vigencia_fim: '2021-12-31',
    });
    expect((await porta.contrato(contexto(m), m.contrato))?.coparticipacao.tipo).toBe(1);
    expect(await codigo(lancar(250))).toMatch(/não tem coparticipação/);
    expect(
      await ler(
        "SELECT COUNT(*) AS n FROM fatura_plano WHERE estabelecimento_id = ? AND tipo_fatura = 'coparticipacao'",
        [m.est],
      ),
    ).toEqual([expect.objectContaining({ n: 0 })]);
  });

  it('regra do plano com 30%: grava a fatura de coparticipação com o item do beneficiário (efeito no banco)', async () => {
    await regra('PLANO', {
      tipo_coparticipacao: 'percentual',
      percentual: 30,
      teto_mensal: 100,
      teto_anual: 150,
    });
    const k = await porta.contrato(contexto(m), m.contrato);
    expect(k?.coparticipacao).toMatchObject({
      tipo: 2,
      valor: 30,
      tetoMensal: 100,
      tetoAnual: 150,
      tetoEvento: null,
    });
    const r = await lancar(250);
    expect(r).toMatchObject({ ok: true, avisos: [] });
    const [f] = await ler(
      'SELECT tipo_fatura, situacao, valor_total, contrato_plano_id, competencia FROM fatura_plano WHERE id = ?',
      [r.id],
    );
    expect(f).toMatchObject({
      tipo_fatura: 'coparticipacao',
      situacao: 'aberta',
      contrato_plano_id: m.contrato,
    });
    expect(Number(f?.['valor_total'])).toBe(75);
    const itens = await ler(
      'SELECT beneficiario_plano_id, valor_unitario, valor, natureza FROM fatura_plano_item WHERE fatura_plano_id = ?',
      [r.id],
    );
    expect(itens).toHaveLength(1);
    expect(itens[0]).toMatchObject({ beneficiario_plano_id: m.dependente, natureza: 'debito' });
    expect([Number(itens[0]?.['valor_unitario']), Number(itens[0]?.['valor'])]).toEqual([250, 75]);
    expect(await porta.coparticipacaoAcumulada(contexto(m), m.dependente, competencia)).toEqual({
      mes: 75,
      ano: 75,
    });
  });

  it('teto mensal: o segundo evento lança só o que falta (25) com aviso; o terceiro recusa teto atingido', async () => {
    const r = await lancar(250);
    expect(r.avisos[0]).toMatch(/teto do mês.*Calculado R\$ 75\.00, lançado R\$ 25\.00/);
    const [f] = await ler('SELECT valor_total FROM fatura_plano WHERE id = ?', [r.id]);
    expect(Number(f?.['valor_total'])).toBe(25);
    expect(await codigo(lancar(250))).toMatch(/atingiu o teto de coparticipação/);
    expect(await porta.coparticipacaoAcumulada(contexto(m), m.dependente, competencia)).toEqual({
      mes: 100,
      ano: 100,
    });
  });

  it('fatura cancelada não conta no acumulado; o outro beneficiário tem o próprio acumulado', async () => {
    const [x] = await ler(
      "SELECT id, versao FROM fatura_plano WHERE estabelecimento_id = ? AND tipo_fatura = 'coparticipacao' AND valor_total = 25",
      [m.est],
    );
    await servico.cancelar(s, Number(x?.['id']), {
      versao: Number(x?.['versao']),
      motivo: 'Lançada por engano no teste sintético',
    });
    expect(await porta.coparticipacaoAcumulada(contexto(m), m.dependente, competencia)).toEqual({
      mes: 75,
      ano: 75,
    });
    expect(await porta.coparticipacaoAcumulada(contexto(m), m.beneficiario, competencia)).toEqual({
      mes: 0,
      ano: 0,
    });
    expect(await porta.coparticipacaoAcumulada(contexto(m, m.outroEst), m.dependente, competencia)).toEqual({
      mes: 0,
      ano: 0,
    });
  });

  it('a regra do contrato prevalece sobre a do plano: valor fixo com teto por evento', async () => {
    await regra('CONTRATO', {
      contrato_plano_id: m.contrato,
      tipo_coparticipacao: 'valor_fixo',
      valor: 40,
      teto_por_evento: 30,
    });
    const k = await porta.contrato(contexto(m), m.contrato);
    expect(k?.coparticipacao).toMatchObject({ tipo: 3, valor: 40, tetoEvento: 30, tetoMensal: null });
    const r = await lancar(250, m.beneficiario);
    expect(r.avisos[0]).toMatch(/teto por evento/);
    const [f] = await ler('SELECT valor_total FROM fatura_plano WHERE id = ?', [r.id]);
    expect(Number(f?.['valor_total'])).toBe(30);
  });
});
