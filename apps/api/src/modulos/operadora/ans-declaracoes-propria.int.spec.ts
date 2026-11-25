// Contrato de efeito das declarações periódicas da operadora (08-SGO L110; F78.08) contra o MariaDB real (cliente f22_o2).
// Massa SINTÉTICA pela carteira da F1 (operadora, produto, contrato de pessoa física, titular e dependente). Prova o que
// fica no banco: a apuração da TPS do trimestre (vidas, valor por vida, total, vencimento) com guia e pagamento; a
// conferência cadastral com o arquivo recebido guardado e cada divergência, tratada até a conferência concluída; e a
// DMED do ano com o que cada pessoa pagou, titular antes do dependente, o arquivo gerado guardado e a entrega com recibo.
// SGH_NUCLEO_SEM_BANCO=1 pula o banco.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { criarArmazemLocal, type NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { cpfSintetico } from '@sgh/dominio-operadora';
import { PortaDeclaracoesAnsPropria } from './ans-declaracoes-propria.js';
import { PortaAnsOperadoraPropria } from './ans-porta-propria.js';
import {
  CLIENTE,
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

let nucleo: NucleoProprio | null = null;
let massa: MassaBase | null = null;
let porta: PortaDeclaracoesAnsPropria | null = null;
let cart: Awaited<ReturnType<typeof montarCarteira>> | null = null;
let raiz = '';
const COD_VIG = 'c1036-sintetica';

const trilha =
  (evento: string) =>
  (r: { id: number }): RegistroTrilhaTela => ({
    estabelecimento: massa?.est ?? null,
    usuario: massa?.usuario ?? null,
    acao: 'operacao',
    entidade: 'operadora',
    entidadeId: r.id,
    dadosDepois: { evento, recurso: 'operadora.declaracoes' },
    correlacao: 'teste-c1036',
  });

const q = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
  nucleo!.lerSomente({ cliente: CLIENTE, correlacao: 'teste-c1036' }, (l) =>
    l.consultar(sql, p, { teto: 1000 }),
  ) as Promise<T[]>;

async function limpar(n: NucleoProprio, m: MassaBase) {
  await n.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c1036' }, async (e) => {
    const ests = [m.est, m.outroEst];
    const ope =
      'SELECT operadora_saude_id FROM operadora_saude_estabelecimento WHERE estabelecimento_id IN (?, ?)';
    await e.executar(
      `DELETE i FROM conferencia_cadastral_ans_item i JOIN conferencia_cadastral_ans c ON c.id = i.conferencia_cadastral_ans_id WHERE c.estabelecimento_id IN (?, ?)`,
      ests,
    );
    await e.executar('DELETE FROM conferencia_cadastral_ans WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(
      `DELETE i FROM declaracao_servicos_medicos_item i JOIN declaracao_servicos_medicos d ON d.id = i.declaracao_servicos_medicos_id WHERE d.estabelecimento_id IN (?, ?)`,
      ests,
    );
    await e.executar(
      'UPDATE declaracao_servicos_medicos SET retificada_declaracao_servicos_medicos_id = NULL, retificadora = FALSE WHERE estabelecimento_id IN (?, ?)',
      ests,
    );
    await e.executar('DELETE FROM declaracao_servicos_medicos WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar(
      `DELETE FROM apuracao_taxa_saude_suplementar WHERE operadora_saude_id IN (${ope})`,
      ests,
    );
    await e.executar(
      `DELETE FROM arquivo WHERE estabelecimento_id IN (?, ?) AND finalidade IN ('conferencia_cadastral_ans','declaracao_servicos_medicos')`,
      ests,
    );
    await e.executar(
      'DELETE i FROM fatura_plano_item i JOIN fatura_plano f ON f.id = i.fatura_plano_id WHERE f.estabelecimento_id IN (?, ?)',
      ests,
    );
    await e.executar('DELETE FROM fatura_plano WHERE estabelecimento_id IN (?, ?)', ests);
    await e.executar('DELETE FROM taxa_saude_suplementar_vigencia WHERE codigo_ans = ?', [COD_VIG]);
  });
}

beforeAll(async () => {
  if (!PODE) return;
  nucleo = criarNucleo();
  massa = await prepararBase(nucleo);
  await limpar(nucleo, massa);
  await limparMassa(nucleo, massa);
  const { servico } = servicoNoBanco(nucleo);
  cart = await montarCarteira(servico, sessao(massa), { registro: '410361', base: '1036' });
  raiz = mkdtempSync(join(tmpdir(), 'c1036-'));
  const ans = new PortaAnsOperadoraPropria(nucleo, CLIENTE, { gruposSip: async () => [] }, 'simulador');
  porta = new PortaDeclaracoesAnsPropria(
    nucleo,
    CLIENTE,
    ans,
    criarArmazemLocal(nucleo, { raiz, executor: nucleo.criarExecutor() }),
  );
  const m = massa;
  const c = cart;
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c1036' }, async (e) => {
    // Valor por vida sintético quando o catálogo da TPS não está carregado (o real vem do carregador da ANS).
    const vig = await e.uma('SELECT COUNT(*) AS n FROM taxa_saude_suplementar_vigencia');
    if (Number(vig?.['n'] ?? 0) === 0)
      await e.executar(
        `INSERT INTO taxa_saude_suplementar_vigencia (codigo_ans, descricao, ano_recolhimento, periodicidade, meses_recolhimento,
            valor_anual, valor_trimestral, vigencia_inicio, versao_fonte, criado_em)
         VALUES (?, 'Vigência sintética do teste', 2015, 'trimestral', '[3,6,9,12]', 5.39, 1.3475, '2015-09-01', 'teste', NOW(3))`,
        [COD_VIG],
      );
    // O titular aceito no SIB (código de controle sintético).
    await e.executar('UPDATE beneficiario_plano SET codigo_controle_ans = ? WHERE id = ?', [
      '000000103611',
      c.titular.id,
    ]);
    // Uma fatura de 2025 paga pela pessoa física: R$ 300,00 do titular e R$ 150,00 do dependente.
    const forma = await e.uma('SELECT id FROM forma_cobranca_plano ORDER BY id LIMIT 1');
    const tipo = await e.uma('SELECT id FROM tipo_lancamento_fatura ORDER BY id LIMIT 1');
    const f = await e.inserir(
      `INSERT INTO fatura_plano (estabelecimento_id, numero, contrato_plano_id, competencia, data_emissao, data_vencimento,
          forma_cobranca_plano_id, valor_bruto, valor_total, valor_pago, data_pagamento, situacao, criado_em)
       VALUES (?, 'C1036-1', ?, '2025-12-01', '2025-12-01', '2025-12-10', ?, 450, 450, 450, '2025-12-09', 'paga', NOW(3))`,
      [m.est, c.contrato, forma?.['id']],
    );
    let k = 0;
    for (const [b, v] of [
      [c.titular.id, 300],
      [c.dependente, 150],
    ] as const)
      await e.executar(
        `INSERT INTO fatura_plano_item (fatura_plano_id, sequencia, tipo_lancamento_fatura_id, beneficiario_plano_id, descricao,
            valor_unitario, valor, criado_em) VALUES (?, ?, ?, ?, 'Mensalidade sintética', ?, ?, NOW(3))`,
        [f, ++k, tipo?.['id'], b, v, v],
      );
  });
}, 120_000);

afterAll(async () => {
  if (nucleo && massa) {
    await limpar(nucleo, massa);
    await limparMassa(nucleo, massa);
  }
  if (raiz) rmSync(raiz, { recursive: true, force: true });
  await nucleo?.encerrar();
});

describe.skipIf(!PODE)('declarações periódicas da operadora no banco (08-SGO L110)', () => {
  it('TPS: apura o trimestre com a conta do demonstrativo, recusa a repetida, emite a guia e registra o pagamento', async () => {
    const c = contexto(massa!);
    const op = cart!.operadora;
    const r = await porta!.apurarTps(c, op, 2026, 2, trilha('tps.apurada'));
    // Titular e dependente ativos no último dia de abril, maio e junho: média 2 × R$ 1,3475 = R$ 2,70.
    expect(r.apuracao.valorTotal).toBe(2.7);
    const [l] = await q(
      'SELECT periodicidade, ano, trimestre, quantidade_vidas, valor_por_vida, valor_total, vencimento, situacao, versao FROM apuracao_taxa_saude_suplementar WHERE id = ?',
      [r.id],
    );
    expect(l).toMatchObject({
      periodicidade: 'trimestral',
      ano: 2026,
      trimestre: 2,
      quantidade_vidas: 2,
      situacao: 'apurada',
    });
    // O valor por vida é o do catálogo vigente (guardado com 4 casas).
    expect(Number(l!['valor_por_vida'])).toBeCloseTo(r.apuracao.valorPorVida, 4);
    expect(Number(l!['valor_total'])).toBe(2.7);
    expect(
      String(
        l!['vencimento'] instanceof Date ? (l!['vencimento'] as Date).toISOString() : l!['vencimento'],
      ).slice(0, 10),
    ).toBe('2026-06-10');
    await expect(porta!.apurarTps(c, op, 2026, 2, trilha('tps.apurada'))).rejects.toThrow(/ja-apurada/);
    await expect(porta!.apurarTps(contexto(massa!, true), op, 2026, 3, trilha('x'))).rejects.toThrow(
      /nao-encontrado/,
    );
    const g = await porta!.passoTps(
      c,
      r.id,
      1,
      { para: 'guia_emitida', nossoNumero: 'GRU-C1036' },
      trilha('tps.guia'),
    );
    await expect(
      porta!.passoTps(
        c,
        r.id,
        g.versao,
        { para: 'paga', dataPagamento: '2026-06-09', valorPago: 2.5 },
        trilha('tps.paga'),
      ),
    ).rejects.toThrow(/pago-menor/);
    await porta!.passoTps(
      c,
      r.id,
      g.versao,
      { para: 'paga', dataPagamento: '2026-06-09', valorPago: 2.7 },
      trilha('tps.paga'),
    );
    const [p] = await q(
      'SELECT situacao, nosso_numero, valor_pago, versao FROM apuracao_taxa_saude_suplementar WHERE id = ?',
      [r.id],
    );
    expect(p).toMatchObject({ situacao: 'paga', nosso_numero: 'GRU-C1036', versao: 3 });
    expect(Number(p!['valor_pago'])).toBe(2.7);
    const lista = await porta!.apuracoesTps(c, op);
    expect(lista.map((x) => [x.trimestre, x.situacao])).toEqual([[2, 'paga']]);
  });

  it('conferência cadastral: guarda o arquivo recebido, grava as divergências e conclui quando todas são tratadas', async () => {
    const c = contexto(massa!);
    const op = cart!.operadora;
    const [t] = await q(
      `SELECT pf.cpf, pp.numero_registro_ans FROM beneficiario_plano b JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
         JOIN contrato_plano cp ON cp.id = b.contrato_plano_id JOIN produto_plano pp ON pp.id = cp.produto_plano_id WHERE b.id = ?`,
      [cart!.titular.id],
    );
    const texto = [
      'cco;nome;nascimento;cpf;cns;registro_plano;situacao',
      `000000103611;TITULAR SINTETICA DA INTEGRACAO;11/05/1980;${String(t!['cpf'] ?? '')};;${String(t!['numero_registro_ans'] ?? '')};ATIVO`,
      '000000109999;PESSOA FORA DO CADASTRO;01/01/2000;;;;ATIVO',
      'linha;quebrada',
    ].join('\n');
    const r = await porta!.importarConferencia(
      c,
      op,
      {
        competencia: '2026-10',
        nome: 'conferencia-sintetica.csv',
        base64: Buffer.from(texto).toString('base64'),
      },
      trilha('conferencia.importada'),
    );
    const [k] = await q(
      `SELECT c.total_registros, c.total_divergencias, c.situacao, c.observacao, a.imutavel, a.finalidade, a.tamanho_bytes
         FROM conferencia_cadastral_ans c JOIN arquivo a ON a.id = c.arquivo_id WHERE c.id = ?`,
      [r.id],
    );
    expect(k).toMatchObject({
      total_registros: 2,
      total_divergencias: 2,
      situacao: 'em_conferencia',
      finalidade: 'conferencia_cadastral_ans',
      tamanho_bytes: Buffer.byteLength(texto),
    });
    expect(Boolean(k!['imutavel'])).toBe(true);
    expect(String(k!['observacao'])).toContain('1 linha');
    const itens = await porta!.divergencias(c, r.id);
    expect(itens.map((i) => [i.beneficiario, i.tipo, i.campo, i.correcao])).toEqual([
      [cart!.titular.id, 'campo_divergente', 'nascimento', 'pendente'],
      [null, 'nao_localizado_cadastro', null, 'pendente'],
    ]);
    const [a, b] = itens;
    await expect(
      porta!.tratarDivergencia(c, b!.id, b!.versao, { para: 'ignorada', justificativa: null }, trilha('x')),
    ).rejects.toThrow(/sem-justificativa/);
    const a1 = await porta!.tratarDivergencia(
      c,
      a!.id,
      a!.versao,
      { para: 'corrigir_cadastro', justificativa: null },
      trilha('div'),
    );
    await porta!.tratarDivergencia(
      c,
      a!.id,
      a1.versao,
      { para: 'corrigida', justificativa: null },
      trilha('div'),
    );
    expect((await porta!.conferencias(c, op))[0]).toMatchObject({ situacao: 'em_conferencia', pendentes: 1 });
    await porta!.tratarDivergencia(
      c,
      b!.id,
      b!.versao,
      { para: 'ignorada', justificativa: 'Registro de outra operadora' },
      trilha('div'),
    );
    const [f] = await q(
      `SELECT c.situacao, c.conferida_em IS NOT NULL AS concluida,
              (SELECT COUNT(*) FROM conferencia_cadastral_ans_item i WHERE i.conferencia_cadastral_ans_id = c.id AND i.corrigido_em IS NOT NULL) AS tratados
         FROM conferencia_cadastral_ans c WHERE c.id = ?`,
      [r.id],
    );
    expect(f).toMatchObject({ situacao: 'conferida', tratados: 2 });
    expect(Number(f!['concluida'])).toBe(1);
  });

  it('DMED: o que cada pessoa pagou no ano, titular antes do dependente, arquivo guardado e entrega com recibo', async () => {
    const c = contexto(massa!);
    const op = cart!.operadora;
    const entrada = {
      anoCalendario: 2025,
      retifica: null,
      responsavelCpf: '52998224725',
      responsavelNome: 'Responsável Sintético',
      responsavelDdd: '11',
      responsavelTelefone: '30000000',
      responsavelEmail: null,
    };
    await expect(
      porta!.gerarDmed(c, op, { ...entrada, responsavelCpf: '12345678900' }, trilha('x')),
    ).rejects.toThrow(/cpf-responsavel/);
    const r = await porta!.gerarDmed(c, op, entrada, trilha('dmed.gerada'));
    const [d] = await q(
      `SELECT d.ano_calendario, d.ano_referencia, d.situacao, d.retificadora, a.imutavel, a.finalidade
         FROM declaracao_servicos_medicos d JOIN arquivo a ON a.id = d.arquivo_id WHERE d.id = ?`,
      [r.id],
    );
    expect(d).toMatchObject({
      ano_calendario: 2025,
      ano_referencia: 2026,
      situacao: 'gerada',
      finalidade: 'declaracao_servicos_medicos',
    });
    const itens = await porta!.itensDeclaracao(c, r.id);
    expect(itens).toEqual([
      { sequencia: 1, beneficiario: cart!.titular.id, titular: null, tipo: 'titular', valor: 300 },
      {
        sequencia: 2,
        beneficiario: cart!.dependente,
        titular: cart!.titular.id,
        tipo: 'dependente',
        valor: 150,
      },
    ]);
    await expect(porta!.gerarDmed(c, op, entrada, trilha('x'))).rejects.toThrow(/declaracao-aberta/);
    const arq = await porta!.arquivoDeclaracao(c, r.id);
    const linhas = Buffer.from(arq!.base64, 'base64').toString('latin1').split('\r\n');
    expect(linhas[0]).toBe('DMED|2026|2025|N||');
    expect(
      linhas.filter((x) => x.startsWith('TOP|') || x.startsWith('DTOP|')).map((x) => x.split('|').at(-2)),
    ).toEqual(['30000', '15000']);
    expect(await porta!.arquivoDeclaracao(contexto(massa!, true), r.id)).toBeNull();
    await expect(
      porta!.passoDmed(c, r.id, 1, { para: 'transmitida', recibo: null }, trilha('x')),
    ).rejects.toThrow(/sem-recibo/);
    await porta!.passoDmed(
      c,
      r.id,
      1,
      { para: 'transmitida', recibo: 'REC-C1036' },
      trilha('dmed.transmitida'),
    );
    const [t] = await q(
      'SELECT situacao, numero_recibo, transmitido_em IS NOT NULL AS tx FROM declaracao_servicos_medicos WHERE id = ?',
      [r.id],
    );
    expect(t).toMatchObject({ situacao: 'transmitida', numero_recibo: 'REC-C1036' });
    // A retificadora aponta a declaração entregue e leva o recibo dela.
    const ret = await porta!.gerarDmed(c, op, { ...entrada, retifica: r.id }, trilha('dmed.retificadora'));
    const [rt] = await q(
      'SELECT retificadora, retificada_declaracao_servicos_medicos_id AS origem FROM declaracao_servicos_medicos WHERE id = ?',
      [ret.id],
    );
    expect(Number(rt!['retificadora'])).toBe(1);
    expect(Number(rt!['origem'])).toBe(r.id);
    const arqRet = Buffer.from((await porta!.arquivoDeclaracao(c, ret.id))!.base64, 'base64').toString(
      'latin1',
    );
    expect(arqRet.split('\r\n')[0]).toBe('DMED|2026|2025|S|REC-C1036|');
  });

  it('operadora em dois estabelecimentos: a conferência e a DMED são da operadora (um CNPJ), com a trava única', async () => {
    const op = cart!.operadora;
    const cB = contexto(massa!, true);
    await nucleo!.escrever({ cliente: CLIENTE, correlacao: 'preparo-c1036' }, (e) =>
      e.inserir(
        'INSERT INTO operadora_saude_estabelecimento (operadora_saude_id, estabelecimento_id, principal, vigencia_inicio, criado_em) VALUES (?, ?, TRUE, ?, ?)',
        [op, massa!.outroEst, '2020-01-01', new Date()],
      ),
    );
    const { servico } = servicoNoBanco(nucleo!);
    const sB = sessao(massa!, 'todas', true);
    const prod = await servico.gravarProduto(sB, null, {
      operadora: op,
      codigo: 'INT-410361-B',
      nome: 'Plano sintético do segundo estabelecimento',
      natureza: 'plano',
      registroAns: '941036102',
      tipoContratacao: 1,
      segmentacao: 'ambulatorialHospitalar',
      abrangencia: 'estadual',
      acomodacao: 2,
      coparticipacao: { tipo: 2, valor: 30 },
      carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 24 },
      precos: [100, 120, 130, 140, 150, 170, 200, 240, 300, 400],
      situacao: 'ativo',
    });
    const ctr = await servico.gravarContrato(sB, null, {
      produto: prod.id,
      numero: 'INT-410361-B1',
      tipo: 1,
      contratanteNome: 'Contratante Sintético B',
      contratanteDocumento: cpfSintetico('910368881'),
      formaReajuste: 1,
      mesReajuste: 5,
      tipoVigencia: 2,
      inicio: '2025-01-01',
      fim: null,
      diaVencimento: null,
      situacao: 'ativo',
      motivoSituacao: null,
    });
    const cpfB = cpfSintetico('910368882');
    const titB = await servico.gravarBeneficiario(sB, null, {
      contrato: ctr.id,
      titular: null,
      vinculo: 1,
      nome: 'Titular Sintetico B',
      nomeSocial: null,
      cpf: cpfB,
      nascimento: '1990-01-02',
      sexo: 'M',
      cns: null,
      nomeMae: 'Mae Sintetica B',
      inclusao: '2025-01-01',
      pacienteHospital: null,
    });
    await nucleo!.escrever({ cliente: CLIENTE, correlacao: 'preparo-c1036' }, async (e) => {
      await e.executar('UPDATE beneficiario_plano SET codigo_controle_ans = ? WHERE id = ?', [
        '000000103622',
        titB.id,
      ]);
      const forma = await e.uma('SELECT id FROM forma_cobranca_plano ORDER BY id LIMIT 1');
      const tipo = await e.uma('SELECT id FROM tipo_lancamento_fatura ORDER BY id LIMIT 1');
      const f = await e.inserir(
        `INSERT INTO fatura_plano (estabelecimento_id, numero, contrato_plano_id, competencia, data_emissao, data_vencimento,
            forma_cobranca_plano_id, valor_bruto, valor_total, valor_pago, data_pagamento, situacao, criado_em)
         VALUES (?, 'C1036-B1', ?, '2025-11-01', '2025-11-01', '2025-11-10', ?, 200, 200, 200, '2025-11-08', 'paga', NOW(3))`,
        [massa!.outroEst, ctr.id, forma?.['id']],
      );
      await e.executar(
        `INSERT INTO fatura_plano_item (fatura_plano_id, sequencia, tipo_lancamento_fatura_id, beneficiario_plano_id, descricao,
            valor_unitario, valor, criado_em) VALUES (?, 1, ?, ?, 'Mensalidade sintética B', 200, 200, NOW(3))`,
        [f, tipo?.['id'], titB.id],
      );
    });

    // Conferência importada em B com a base da operadora inteira: o titular de A é localizado (sem divergência) e o
    // registro inativo na agência que o cadastro não tem não vira item.
    const [t] = await q(
      `SELECT pf.cpf, pp.numero_registro_ans FROM beneficiario_plano b JOIN pessoa_fisica pf ON pf.id = b.pessoa_fisica_id
         JOIN contrato_plano cp ON cp.id = b.contrato_plano_id JOIN produto_plano pp ON pp.id = cp.produto_plano_id WHERE b.id = ?`,
      [cart!.titular.id],
    );
    const texto = [
      'cco;nome;nascimento;cpf;cns;registro_plano;situacao',
      `000000103611;TITULAR SINTETICA DA INTEGRACAO;10/05/1980;${String(t!['cpf'] ?? '')};;${String(t!['numero_registro_ans'] ?? '')};ATIVO`,
      `000000103622;TITULAR SINTETICO B;02/01/1990;${cpfB};;941036102;ATIVO`,
      '000000108888;PESSOA JA INATIVA;01/01/1970;;;;INATIVO',
    ].join('\n');
    const conf = await porta!.importarConferencia(
      cB,
      op,
      { competencia: '2026-11', nome: 'conferencia-b.csv', base64: Buffer.from(texto).toString('base64') },
      trilha('conferencia.importada'),
    );
    const [k] = await q(
      'SELECT estabelecimento_id, total_registros, total_divergencias, situacao FROM conferencia_cadastral_ans WHERE id = ?',
      [conf.id],
    );
    expect(k).toMatchObject({ total_registros: 3, total_divergencias: 0, situacao: 'conferida' });
    expect(Number(k!['estabelecimento_id'])).toBe(massa!.outroEst);
    expect(await porta!.divergencias(cB, conf.id)).toEqual([]);
    // A mesma operadora vista de A e de B: as mesmas conferências.
    const deA = (await porta!.conferencias(contexto(massa!), op)).map((x) => x.id);
    expect((await porta!.conferencias(cB, op)).map((x) => x.id)).toEqual(deA);
    expect(deA).toContain(conf.id);

    // DMED: a retificadora aberta em A trava a geração em B (um CNPJ, uma declaração do ano).
    const entrada = {
      anoCalendario: 2025,
      retifica: null,
      responsavelCpf: '52998224725',
      responsavelNome: 'Responsável Sintético',
      responsavelDdd: '11',
      responsavelTelefone: '30000000',
      responsavelEmail: null,
    };
    await expect(porta!.gerarDmed(cB, op, entrada, trilha('x'))).rejects.toThrow(/declaracao-aberta/);
    const doAno = await porta!.declaracoes(cB, op);
    const aberta = doAno.find((d) => d.situacao === 'gerada')!;
    const original = doAno.find((d) => !d.retificadora && d.situacao === 'transmitida')!;
    expect(doAno.map((d) => d.id)).toEqual((await porta!.declaracoes(contexto(massa!), op)).map((d) => d.id));
    await porta!.passoDmed(
      cB,
      aberta.id,
      aberta.versao,
      { para: 'cancelada', recibo: null },
      trilha('dmed.cancelada'),
    );
    // A original já entregue: outra original do mesmo ano é recusada; só a retificadora passa.
    await expect(porta!.gerarDmed(cB, op, entrada, trilha('x'))).rejects.toThrow(/original-entregue/);
    const ret = await porta!.gerarDmed(
      cB,
      op,
      { ...entrada, retifica: original.id },
      trilha('dmed.retificadora'),
    );
    const [rd] = await q(
      'SELECT estabelecimento_id, retificadora, retificada_declaracao_servicos_medicos_id AS origem FROM declaracao_servicos_medicos WHERE id = ?',
      [ret.id],
    );
    expect(Number(rd!['estabelecimento_id'])).toBe(massa!.outroEst);
    expect(Number(rd!['origem'])).toBe(original.id);
    // Os pagamentos dos dois estabelecimentos numa declaração só: R$ 300 + R$ 150 (A) e R$ 200 (B) = R$ 650.
    const itens = await porta!.itensDeclaracao(cB, ret.id);
    expect(
      itens.map((i) => [i.beneficiario, i.tipo, i.valor]).sort((x, y) => Number(x[0]) - Number(y[0])),
    ).toEqual(
      [
        [cart!.titular.id, 'titular', 300],
        [cart!.dependente, 'dependente', 150],
        [titB.id, 'titular', 200],
      ].sort((x, y) => Number(x[0]) - Number(y[0])),
    );
    expect(itens.reduce((a, i) => a + i.valor, 0)).toBe(650);
  });
});
