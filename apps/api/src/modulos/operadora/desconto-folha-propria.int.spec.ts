// Integração do desconto em folha da mensalidade (C3-028, 08-SGO L97) contra o MariaDB real (cliente f22_o2). Massa
// sintética "L0209". Contrato de efeito: a remessa (remessa_desconto_folha) e os itens com a cobrança
// (remessa_desconto_folha_item.fatura_plano_id), o arquivo, o envio, o retorno que grava o descontado e baixa as
// cobranças (paga, paga_parcial com o saldo, não descontada em aberto), a conferência, e as recusas sem escrita
// (remessa repetida, retorno com matrícula fora da remessa, cancelar depois do retorno, outro estabelecimento).
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaCobrancaOperadoraPropria } from './cobranca-porta-propria.js';
import { PortaDescontoFolhaPropria } from './desconto-folha-propria.js';
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

const FORMA = 'L0209-FOLHA';
const VENCE = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(SEM_BANCO)('desconto em folha da mensalidade (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaDescontoFolhaPropria;
  let cobranca: PortaCobrancaOperadoraPropria;
  let m: MassaOperadora;
  const faturas: number[] = [];
  const ler = (sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c3028' }, (l) => l.consultar(sql, p));
  const T = (ev: string) => trilhaTela(m, 'remessa_desconto_folha', ev);

  async function limpar(): Promise<void> {
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c3028' }, async (e) => {
      const est = [m.est, m.outroEst];
      await e.executar(
        'DELETE i FROM remessa_desconto_folha_item i JOIN remessa_desconto_folha r ON r.id = i.remessa_desconto_folha_id WHERE r.estabelecimento_id IN (?, ?)',
        est,
      );
      await e.executar('DELETE FROM remessa_desconto_folha WHERE estabelecimento_id IN (?, ?)', est);
      await e.executar(
        'DELETE cf FROM contrato_forma_cobranca cf JOIN forma_cobranca_plano f ON f.id = cf.forma_cobranca_plano_id WHERE f.codigo = ?',
        [FORMA],
      );
    });
  }

  const incluir = async (competencia: string, valor: number) => {
    const r = await cobranca.gravar(contexto(m), trilhaTela(m, 'fatura_plano', 'operadora.cobranca.incluida'), (g) =>
      g.incluir({
        operadora: m.operadora,
        contrato: m.contrato,
        beneficiario: m.beneficiario,
        tipo: 3,
        competencia,
        descricao: 'MENSALIDADE SINTETICA FOLHA',
        valor,
        vencimento: VENCE,
        acordoOrigem: null,
        parcela: null,
        parcelas: null,
        itens: [],
        por: 'c3028.teste',
      }),
    );
    faturas.push(r.id);
    return r.id;
  };

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await prepararMassa(nucleo);
    await limpar();
    await limparNegocio(nucleo, m);
    porta = new PortaDescontoFolhaPropria(nucleo, CLIENTE);
    cobranca = new PortaCobrancaOperadoraPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'massa-c3028' }, async (e) => {
      await e.executar(
        `INSERT INTO forma_cobranca_plano (codigo, descricao, meio, criado_em) VALUES (?, 'DESCONTO EM FOLHA SINTETICO', 'desconto_folha', NOW(3))
         ON DUPLICATE KEY UPDATE meio = 'desconto_folha', ativo = TRUE`,
        [FORMA],
      );
      await e.executar(
        `INSERT INTO contrato_forma_cobranca (contrato_plano_id, forma_cobranca_plano_id, dia_vencimento, vigencia_inicio, criado_em)
         SELECT ?, id, 10, '2020-01-01', NOW(3) FROM forma_cobranca_plano WHERE codigo = ?`,
        [m.contrato, FORMA],
      );
      await e.executar("UPDATE beneficiario_plano SET matricula_empresa = 'MF-0209' WHERE id = ?", [m.beneficiario]);
    });
  }, 120_000);
  afterAll(async () => {
    if (m) {
      await limpar();
      await limparNegocio(nucleo, m);
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c3028' }, (e) =>
        e.executar('UPDATE beneficiario_plano SET matricula_empresa = NULL WHERE id = ?', [m.beneficiario]),
      );
    }
    await nucleo?.encerrar();
  });

  it('gera a remessa com a cobrança em atraso e a da competência, envia e lê o retorno baixando as cobranças', async () => {
    const atrasada = await incluir('2026-10', 40);
    const atual = await incluir('2026-11', 100);
    await incluir('2026-12', 70); // competência posterior: fora
    const e = { operadora: m.operadora, contratante: m.contratante, competencia: '2026-11' };
    const previa = await porta.previa(contexto(m), e);
    expect(previa.itens.map((i) => [i.fatura, i.valorEnviado, i.valorAtrasado])).toEqual([
      [atrasada, 40, 40],
      [atual, 100, 0],
    ]);
    expect(previa.valorTotal).toBe(140);

    const g = await porta.gerar(contexto(m), { ...e, tipo: 'mensal', observacao: null }, T('operadora.desconto-folha.gerada'));
    const [r] = await ler('SELECT * FROM remessa_desconto_folha WHERE id = ?', [g.id]);
    expect(r).toMatchObject({ estabelecimento_id: m.est, contratante_plano_id: m.contratante, situacao: 'gerada', tipo_remessa: 'mensal' });
    expect(String(r!['numero'])).toMatch(/^DF-\d+$/);
    expect(Number(r!['valor_enviado'])).toBe(140);
    const itens = await ler(
      'SELECT sequencia, fatura_plano_id, matricula_funcional, valor_enviado, valor_atrasado, situacao_retorno FROM remessa_desconto_folha_item WHERE remessa_desconto_folha_id = ? ORDER BY sequencia',
      [g.id],
    );
    expect(itens.map((i) => [Number(i['fatura_plano_id']), i['matricula_funcional'], Number(i['valor_enviado']), i['situacao_retorno']])).toEqual([
      [atrasada, 'MF-0209', 40, 'pendente'],
      [atual, 'MF-0209', 100, 'pendente'],
    ]);
    const trilha = await ler("SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'remessa_desconto_folha' AND entidade_id = ?", [String(g.id)]);
    expect(Number(trilha[0]!['n'])).toBeGreaterThanOrEqual(1);

    // a mesma remessa de novo é recusada, sem escrita
    const dup = await porta.gerar(contexto(m), { ...e, tipo: 'mensal', observacao: null }, T('x')).catch((x: unknown) => x);
    expect(codigoDe(dup)).toBe('remessa-ja-gerada');
    // a cobrança pendente na remessa não entra noutra (a prévia a critica)
    expect((await porta.previa(contexto(m), e)).criticas.map((x) => x.codigo)).toEqual(['ja-em-remessa', 'ja-em-remessa']);

    const arq = await porta.arquivo(contexto(m), g.id);
    expect(arq.conteudo.trim().split('\n')).toHaveLength(3);
    // retorno antes do envio: recusado
    expect(codigoDe(await porta.lerRetorno(contexto(m), g.id, { versao: 1, texto: 'MF-0209;90', creditoEm: VENCE }, T('x')).catch((x: unknown) => x))).toBe('situacao-invalida');

    const env = await porta.enviar(contexto(m), g.id, 1, T('operadora.desconto-folha.enviada'));
    expect(env.versao).toBe(2);
    // retorno com matrícula fora da remessa: recusado inteiro, nada gravado
    const ruim = await porta
      .lerRetorno(contexto(m), g.id, { versao: 2, texto: 'MF-0209;90\nOUTRA;5', creditoEm: VENCE }, T('x'))
      .catch((x: unknown) => x);
    expect(codigoDe(ruim)).toBe('retorno-com-problemas');
    expect((await ler('SELECT situacao FROM fatura_plano WHERE id = ?', [atrasada]))[0]!['situacao']).toBe('aberta');

    const ret = await porta.lerRetorno(contexto(m), g.id, { versao: 2, texto: 'matricula;valor\nMF-0209;90,00', creditoEm: VENCE }, T('operadora.desconto-folha.retorno'));
    expect(ret.versao).toBe(3);
    const [r2] = await ler('SELECT situacao, retorno_linhas, valor_descontado, retorno_lido_em FROM remessa_desconto_folha WHERE id = ?', [g.id]);
    expect(r2).toMatchObject({ situacao: 'retorno_recebido', retorno_linhas: 1 });
    expect(Number(r2!['valor_descontado'])).toBe(90);
    const it2 = await ler('SELECT valor_descontado, situacao_retorno FROM remessa_desconto_folha_item WHERE remessa_desconto_folha_id = ? ORDER BY sequencia', [g.id]);
    expect(it2.map((i) => [Number(i['valor_descontado']), i['situacao_retorno']])).toEqual([
      [40, 'descontado'],
      [50, 'descontado_parcial'],
    ]);
    const fs = await ler('SELECT id, situacao, valor_pago, data_pagamento FROM fatura_plano WHERE id IN (?, ?) ORDER BY id', [atrasada, atual]);
    expect(fs.map((f) => [f['situacao'], Number(f['valor_pago'])])).toEqual([
      ['paga', 40],
      ['paga_parcial', 50],
    ]);

    // depois do retorno não se cancela; confere
    expect(codigoDe(await porta.cancelar(contexto(m), g.id, { versao: 3, motivo: 'teste de recusa' }, T('x')).catch((x: unknown) => x))).toBe('situacao-invalida');
    const conf = await porta.conferir(contexto(m), g.id, 3, T('operadora.desconto-folha.conferida'));
    expect(conf.versao).toBe(4);
    expect((await ler('SELECT situacao, atrasos_validados_em FROM remessa_desconto_folha WHERE id = ?', [g.id]))[0]).toMatchObject({ situacao: 'conferida' });

    // o saldo da parcial entra na remessa seguinte
    const prox = await porta.previa(contexto(m), { ...e, competencia: '2026-12' });
    expect(prox.itens.map((i) => [i.fatura, i.valorEnviado])).toContainEqual([atual, 50]);
    // outro estabelecimento não vê a remessa
    expect(codigoDe(await porta.remessa(contexto(m, m.outroEst), g.id).catch((x: unknown) => x))).toBe('nao-encontrado');
    expect((await porta.remessas(contexto(m), m.operadora)).map((x) => x.id)).toContain(g.id);
  });

  it('cancela a remessa gerada e libera as cobranças para outra', async () => {
    const e = { operadora: m.operadora, contratante: m.contratante, competencia: '2026-12', tipo: 'complementar' as const, observacao: 'SINTETICA' };
    const g = await porta.gerar(contexto(m), e, T('operadora.desconto-folha.gerada'));
    const c = await porta.cancelar(contexto(m), g.id, { versao: 1, motivo: 'gerada por engano' }, T('operadora.desconto-folha.cancelada'));
    expect(c.versao).toBe(2);
    expect((await ler('SELECT situacao FROM remessa_desconto_folha WHERE id = ?', [g.id]))[0]!['situacao']).toBe('cancelada');
    expect((await porta.previa(contexto(m), e)).criticas.filter((x) => x.codigo === 'ja-em-remessa')).toHaveLength(0);
    expect(codigoDe(await porta.arquivo(contexto(m), g.id).catch((x: unknown) => x))).toBe('situacao-invalida');
  });
});
