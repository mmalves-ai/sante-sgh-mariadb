// Contrato de efeito do reajuste da operadora além do anual digitado (08-SGO L96, C1-086) contra o MariaDB real (cliente
// f22_o2). Massa SINTÉTICA pela carteira da F1 (operadora, plano individual com um contrato) e um plano coletivo com um
// contrato pequeno (2 vidas) e um grande (30 vidas). Prova o que fica no banco: o teto da ANS cadastrado como índice e
// lido pela situação do reajuste anual (gravado com o índice de origem); o agrupamento do coletivo pequeno com só o
// contrato elegível, o percentual único com a memória e a aplicação no aniversário (reajuste do tipo agrupamento ligado
// ao grupo); a regra por sinistralidade com faixas e o reajuste do contrato grande pela sinistralidade apurada das
// mensalidades do período. SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import { cnpjSintetico, cpfSintetico } from '@sgh/dominio-operadora';
import type { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { PortaCobrancaOperadoraPropria } from './cobranca-porta-propria.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  criarNucleo,
  limparMassa,
  type MassaBase,
  montarCarteira,
  PODE,
  prepararBase,
  servicoNoBanco,
  sessao,
} from './infra/copia.spec-util.js';
import { PortaReajusteColetivoPropria } from './reajuste-coletivo-propria.js';

let nucleo: NucleoProprio | null = null;
let massa: MassaBase | null = null;
let porta: PortaReajusteColetivoPropria | null = null;
let cart: Awaited<ReturnType<typeof montarCarteira>> | null = null;
let pequeno = 0;
let grande = 0;
const COD = 'C1086';

const trilha =
  (evento: string) =>
  (r: { id: number }): RegistroTrilhaTela => ({
    estabelecimento: massa?.est ?? null,
    usuario: massa?.usuario ?? null,
    acao: 'operacao',
    entidade: 'operadora',
    entidadeId: r.id,
    dadosDepois: { evento, recurso: 'operadora.reajuste-coletivo' },
    correlacao: 'teste-c1086',
  });

const q = (sql: string, p: unknown[] = []) =>
  nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'teste-c1086' }, (l) =>
    l.consultar(sql, p, { teto: 1000 }),
  );

async function limpar(n: NucleoProprio, m: MassaBase) {
  await n.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c1086' }, async (e) => {
    const ests = [m.est, m.outroEst];
    const ope =
      'SELECT operadora_saude_id FROM operadora_saude_estabelecimento WHERE estabelecimento_id IN (?, ?)';
    await e.executar('DELETE FROM reajuste_contrato_plano WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(
      `DELETE x FROM agrupamento_reajuste_contrato x JOIN agrupamento_reajuste_coletivo a ON a.id = x.agrupamento_reajuste_coletivo_id WHERE a.estabelecimento_id IN (?, ?)`,
      ests,
    );
    await e.executar('DELETE FROM agrupamento_reajuste_coletivo WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(
      `DELETE f FROM regra_reajuste_sinistralidade_faixa f JOIN regra_reajuste_sinistralidade r ON r.id = f.regra_reajuste_sinistralidade_id WHERE r.operadora_saude_id IN (${ope})`,
      ests,
    );
    await e.executar(`DELETE FROM regra_reajuste_sinistralidade WHERE operadora_saude_id IN (${ope})`, ests);
    await e.executar(
      'DELETE i FROM fatura_plano_item i JOIN fatura_plano f ON f.id = i.fatura_plano_id WHERE f.estabelecimento_id IN (?, ?)',
      ests,
    );
    await e.executar('DELETE FROM fatura_plano WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar('DELETE FROM indice_reajuste_plano WHERE codigo_indice LIKE ?', [`${COD}%`]);
  });
}

beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  massa = await prepararBase(nucleo);
  await limpar(nucleo, massa);
  await limparMassa(nucleo, massa);
  const { servico } = servicoNoBanco(nucleo);
  const s = sessao(massa);
  cart = await montarCarteira(servico, s, { registro: '410861', base: '1086' });
  porta = new PortaReajusteColetivoPropria(nucleo, CLIENTE);
  // Plano coletivo empresarial com um contrato pequeno (titular e dependente) e um grande (titular e 29 dependentes).
  const prod = await servico.gravarProduto(s, null, {
    operadora: cart.operadora,
    codigo: 'COL-410861',
    nome: 'Coletivo sintético',
    natureza: 'plano',
    registroAns: '941086102',
    tipoContratacao: 2,
    segmentacao: 'ambulatorialHospitalar',
    abrangencia: 'estadual',
    acomodacao: 2,
    coparticipacao: { tipo: 2, valor: 30 },
    carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
    precos: [100, 120, 130, 140, 150, 170, 200, 240, 300, 400],
    situacao: 'ativo',
  });
  const contrato = async (numero: string, doc: string, cpf: string, deps: number) => {
    const k = await servico.gravarContrato(s, null, {
      produto: prod.id,
      numero,
      tipo: 2,
      contratanteNome: `Empresa Sintética ${numero}`,
      contratanteDocumento: cnpjSintetico(doc),
      formaReajuste: 1,
      mesReajuste: 5,
      tipoVigencia: 2,
      inicio: '2026-01-01',
      fim: null,
      diaVencimento: null,
      situacao: 'ativo',
      motivoSituacao: null,
    });
    const t = await servico.gravarBeneficiario(s, null, {
      contrato: k.id,
      titular: null,
      vinculo: 1,
      nome: 'Titular Sintético Coletivo',
      nomeSocial: null,
      cpf: cpfSintetico(cpf),
      nascimento: '1985-02-10',
      sexo: 'M',
      cns: null,
      nomeMae: 'Mãe Sintética',
      inclusao: '2026-02-01',
      pacienteHospital: null,
    });
    for (let i = 0; i < deps; i++)
      await servico.gravarBeneficiario(s, null, {
        contrato: k.id,
        titular: t.id,
        vinculo: 5,
        nome: `Dependente Sintético ${i + 1}`,
        nomeSocial: null,
        cpf: null,
        nascimento: '2015-03-01',
        sexo: 'F',
        cns: null,
        nomeMae: 'Mãe Sintética',
        inclusao: '2026-02-01',
        pacienteHospital: null,
      });
    return k.id;
  };
  pequeno = await contrato('COL-1086-P', '108600010001', '910860001', 1);
  grande = await contrato('COL-1086-G', '108600020001', '910860002', 29);
  // Mensalidades sintéticas do contrato grande no período apurado (a receita da sinistralidade).
  const m = massa;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c1086' }, async (e) => {
    const forma = await e.uma('SELECT id FROM forma_cobranca_plano ORDER BY id LIMIT 1');
    for (const [i, comp] of ['2026-06-01', '2026-07-01'].entries())
      await e.executar(
        `INSERT INTO fatura_plano (estabelecimento_id, numero, contrato_plano_id, competencia, data_emissao, data_vencimento,
                                   forma_cobranca_plano_id, tipo_fatura, valor_bruto, valor_total, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'mensalidade', 5000, 5000, NOW(3))`,
        [m.est, `C1086-${i + 1}`, grande, comp, comp, comp, forma?.['id']],
      );
  });
}, 300_000);

afterAll(async () => {
  if (nucleo && massa) {
    await limpar(nucleo, massa);
    await limparMassa(nucleo, massa);
  }
  await nucleo?.encerrar();
});

describe.skipIf(!PODE)('reajuste coletivo da operadora no banco próprio (C1-086)', () => {
  it('cadastra o teto da ANS e a situação do reajuste anual lê o teto vigente; o reajuste guarda o índice', async () => {
    const c = contexto(massa!);
    const g = await porta!.gravarIndice(
      c,
      {
        codigo: `${COD}-TETO`,
        descricao: 'Teto individual sintético',
        tipo: 'teto_individual_ans',
        vigenciaInicio: '2027-05-01',
        vigenciaFim: '2027-05-31',
        percentual: 6.06,
        protocolo: 'OF-SINT-1086',
      },
      trilha('indice'),
    );
    const sem = codigoDe(
      porta!.gravarIndice(
        c,
        {
          codigo: `${COD}-TETO`,
          descricao: 'Sobreposto',
          tipo: 'teto_individual_ans',
          vigenciaInicio: '2027-05-01',
          vigenciaFim: null,
          percentual: 5,
          protocolo: null,
        },
        trilha('indice'),
      ),
    );
    expect(await sem).toBe('indice-sem-protocolo');
    const cob = new PortaCobrancaOperadoraPropria(nucleo!, CLIENTE);
    const sit = await cob.situacaoReajuste(c, cart!.contrato, '2027-05');
    expect(sit.teto).toEqual({ id: g.id, percentual: 6.06, protocolo: 'OF-SINT-1086' });
    expect((await cob.situacaoReajuste(c, cart!.contrato, '2027-06')).teto).toBeNull();
    const ci = { ...c, chaveIdempotencia: `c1086-reajuste-${Date.now()}` };
    const r = await cob.gravar(ci, trilha('reajuste')({ id: 0 }), (x) =>
      x.registrarReajuste({
        operadora: cart!.operadora,
        contrato: cart!.contrato,
        competencia: '2027-05',
        percentual: 6,
        tetoAns: 6.06,
        oficioAns: 'OF-SINT-1086',
        indice: g.id,
        vidas: 2,
        motivo: 'reajuste anual sintético',
        por: 'x',
      }),
    );
    const [linha] = await q(
      'SELECT tipo_reajuste, indice_reajuste_plano_id, percentual FROM reajuste_contrato_plano WHERE id = ?',
      [r.id],
    );
    expect(linha).toMatchObject({ tipo_reajuste: 'anual', indice_reajuste_plano_id: g.id });
    expect(Number(linha!['percentual'])).toBe(6);
  });

  it('agrupa só o coletivo pequeno, calcula o percentual único e aplica no aniversário', async () => {
    const c = contexto(massa!);
    const a = await porta!.criarAgrupamento(
      c,
      cart!.operadora,
      { descricao: 'Agrupamento sintético 2027', vigencia: '2027-05-01', limiteVidas: 29 },
      trilha('agrupamento'),
    );
    expect(a).toMatchObject({ contratos: 1, vidas: 2 });
    const membros = await porta!.contratosDoAgrupamento(c, a.id);
    expect(membros.map((x) => x.contrato)).toEqual([pequeno]);
    expect(await codigoDe(porta!.aplicarAgrupamento(c, a.id, a.versao, '2027-05', trilha('x')))).toBe(
      'agrupamento-sem-calculo',
    );
    const calc = await porta!.calcularAgrupamento(
      c,
      a.id,
      a.versao,
      { regra: null, percentual: 9.5, justificativa: 'Nota atuarial sintética do agrupamento' },
      trilha('calculo'),
    );
    const ap = await porta!.aplicarAgrupamento(c, a.id, calc.versao, '2027-05', trilha('aplicacao'));
    expect(ap).toMatchObject({ aplicados: 1, ignorados: '' });
    const [grupo] = await q(
      'SELECT situacao, percentual_reajuste, data_aplicacao, quantidade_contratos, memoria_calculo FROM agrupamento_reajuste_coletivo WHERE id = ?',
      [a.id],
    );
    expect(grupo).toMatchObject({ situacao: 'aplicado', quantidade_contratos: 1 });
    expect(Number(grupo!['percentual_reajuste'])).toBe(9.5);
    expect(grupo!['data_aplicacao']).not.toBeNull();
    expect(String(grupo!['memoria_calculo'])).toContain('Nota atuarial');
    const reaj = await q(
      'SELECT contrato_plano_id, tipo_reajuste, percentual, situacao FROM reajuste_contrato_plano WHERE agrupamento_reajuste_coletivo_id = ?',
      [a.id],
    );
    expect(reaj).toHaveLength(1);
    expect(reaj[0]).toMatchObject({
      contrato_plano_id: pequeno,
      tipo_reajuste: 'agrupamento',
      situacao: 'aplicado',
    });
    expect(
      await codigoDe(porta!.cancelarAgrupamento(c, a.id, ap.versao, 'teste sintético', trilha('x'))),
    ).toBe('agrupamento-ja-aplicado');
  });

  it('regra por sinistralidade: grava as faixas, recusa o contrato pequeno e reajusta o grande pela apuração', async () => {
    const c = contexto(massa!);
    const r = await porta!.gravarRegra(
      c,
      cart!.operadora,
      {
        codigo: `${COD}-SIN`,
        descricao: 'Sinistralidade sintética',
        base: 'sinistralidade',
        meses: 12,
        meta: 70,
        vigenciaInicio: '2026-01-01',
        vigenciaFim: null,
        faixas: [
          { de: 0, ate: 70, percentual: 3 },
          { de: 70, ate: null, percentual: 12 },
        ],
      },
      trilha('regra'),
    );
    const [faixas] = await q(
      'SELECT COUNT(*) AS n FROM regra_reajuste_sinistralidade_faixa WHERE regra_reajuste_sinistralidade_id = ?',
      [r.id],
    );
    expect(Number(faixas!['n'])).toBe(2);
    const pp = await porta!.previaSinistralidade(c, pequeno, '2027-05', r.id);
    expect(pp.problemasContrato.map((x) => x.codigo)).toEqual(['sinistralidade-contrato-de-agrupamento']);
    const pg = await porta!.previaSinistralidade(c, grande, '2027-05', r.id);
    expect(pg).toMatchObject({ receita: 10_000, despesa: 0, valorApurado: 0, percentual: 3 });
    expect(pg.periodo).toEqual({ inicio: '2026-05-01', fim: '2027-04-30' });
    expect(pg.problemasContrato).toEqual([]);
    const g = await porta!.reajustarPorSinistralidade(c, grande, '2027-05', r.id, trilha('sinistralidade'));
    const [linha] = await q(
      'SELECT tipo_reajuste, percentual, quantidade_vidas, observacao FROM reajuste_contrato_plano WHERE id = ?',
      [g.id],
    );
    expect(linha).toMatchObject({ tipo_reajuste: 'sinistralidade', quantidade_vidas: 30 });
    expect(Number(linha!['percentual'])).toBe(3);
    expect(String(linha!['observacao'])).toContain('despesa 0,00 / receita 10000,00');
    expect(await codigoDe(porta!.reajustarPorSinistralidade(c, grande, '2027-05', r.id, trilha('x')))).toBe(
      'reajuste-ja-registrado',
    );
  });
});
