// Massa SINTÉTICA do financeiro no MariaDB real (cliente f22_o2, já criado pela obra da onda 2), para os testes de
// integração da porta própria (códigos "L0207"; nenhuma pessoa real). Monta os cadastros que o financeiro lê
// (estabelecimentos, usuários, naturezas, tipos, banco e contas, fornecedor, convênio, contas hospitalares) e limpa
// a massa de negócio no fim. Ficam o estabelecimento, os usuários e os cadastros de catálogo, que a trilha (só
// inclusão) e as sequências referenciam. Só contagens e ids saem nos logs.
import { type ContextoNucleo, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';

export const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
export const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
export const P = 'L0207';
export const COMPETENCIA = '2026-10-01';

export interface MassaFinanceiro {
  readonly nucleo: NucleoProprio;
  readonly est: number;
  readonly outroEst: number;
  readonly lanca: number;
  readonly aprova: number;
  readonly paga: number;
  readonly restrito: number;
  readonly contaA: number;
  readonly contaB: number;
  readonly contaOutroEst: number;
  readonly fornecedor: number;
  readonly tributo: number;
  readonly centro: number;
  readonly convenio: number;
  readonly contasHospitalares: readonly number[];
  readonly ctx: (usuario: number, est?: number) => ContextoNucleo;
}

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}

export function codigoDe(e: unknown): string {
  return e instanceof ErroOperacao
    ? String(e.problema['codigo'] ?? '')
    : `outro: ${(e as Error)?.name ?? ''}`;
}

export async function codigoDaGravacao(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'gravou';
  } catch (e) {
    return codigoDe(e);
  }
}

/** Apaga a massa de negócio dos estabelecimentos de teste (ordem das chaves estrangeiras). */
export async function limparMassa(nucleo: NucleoProprio, ests: readonly number[]): Promise<void> {
  if (ests.length === 0) return;
  const q = ests.map(() => '?').join(', ');
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-02-07' }, async (e) => {
    const x = (sql: string) => e.executar(sql, [...ests]);
    await x(
      `DELETE d FROM documento_origem_titulo d JOIN titulo_receber t ON t.id = d.titulo_receber_id WHERE t.estabelecimento_id IN (${q})`,
    );
    await x(
      `DELETE c FROM conciliacao_bancaria_item c JOIN conciliacao_bancaria b ON b.id = c.conciliacao_bancaria_id WHERE b.estabelecimento_id IN (${q})`,
    );
    await x(
      `UPDATE movimento_bancario SET conciliado = FALSE, conciliacao_bancaria_id = NULL, baixa_titulo_id = NULL WHERE estabelecimento_id IN (${q})`,
    );
    await x(
      `UPDATE linha_extrato l JOIN extrato_bancario x ON x.id = l.extrato_bancario_id SET l.movimento_bancario_id = NULL WHERE x.estabelecimento_id IN (${q})`,
    );
    await x(`DELETE FROM conciliacao_bancaria WHERE estabelecimento_id IN (${q})`);
    await x(`DELETE FROM credito_nao_identificado WHERE estabelecimento_id IN (${q})`);
    await x(
      `DELETE l FROM linha_extrato l JOIN extrato_bancario x ON x.id = l.extrato_bancario_id WHERE x.estabelecimento_id IN (${q})`,
    );
    await x(`DELETE FROM extrato_bancario WHERE estabelecimento_id IN (${q})`);
    await x(`DELETE FROM recebimento WHERE estabelecimento_id IN (${q})`);
    await x(
      `DELETE g FROM glosa_titulo_receber g JOIN titulo_receber t ON t.id = g.titulo_receber_id WHERE t.estabelecimento_id IN (${q})`,
    );
    await x(`DELETE FROM arquivo_fiscal_gerado WHERE estabelecimento_id IN (${q})`);
    await x(
      `DELETE p FROM parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id WHERE t.estabelecimento_id IN (${q})`,
    );
    await x(`DELETE FROM titulo_receber WHERE estabelecimento_id IN (${q})`);
    await x(
      `DELETE c FROM compensacao_adiantamento c JOIN adiantamento a ON a.id = c.adiantamento_id WHERE a.estabelecimento_id IN (${q})`,
    );
    await x(`DELETE FROM adiantamento WHERE estabelecimento_id IN (${q})`);
    await x(`DELETE FROM baixa_titulo WHERE estabelecimento_id IN (${q})`);
    await x(`DELETE FROM movimento_bancario WHERE estabelecimento_id IN (${q})`);
    await x(`DELETE FROM grupo_lancamento_financeiro WHERE estabelecimento_id IN (${q})`);
    await x(`DELETE FROM bordero_pagamento WHERE estabelecimento_id IN (${q})`);
    await x(`DELETE FROM remessa_bancaria WHERE estabelecimento_id IN (${q})`);
    await x(`DELETE FROM lote_exportacao_contabil WHERE estabelecimento_id IN (${q})`);
    await x(
      `DELETE d FROM decisao_aprovacao d JOIN pedido_aprovacao p ON p.id = d.pedido_aprovacao_id WHERE p.estabelecimento_id IN (${q})`,
    );
    await x(`UPDATE titulo_pagar SET pedido_aprovacao_id = NULL WHERE estabelecimento_id IN (${q})`);
    await x(`DELETE FROM pedido_aprovacao WHERE estabelecimento_id IN (${q})`);
    await x(
      `DELETE r FROM retencao_titulo r JOIN parcela_pagar p ON p.id = r.parcela_pagar_id JOIN titulo_pagar t ON t.id = p.titulo_pagar_id WHERE t.estabelecimento_id IN (${q})`,
    );
    await x(
      `DELETE r FROM rateio_lancamento r JOIN titulo_pagar t ON t.id = r.titulo_pagar_id WHERE t.estabelecimento_id IN (${q})`,
    );
    await x(
      `DELETE p FROM parcela_pagar p JOIN titulo_pagar t ON t.id = p.titulo_pagar_id WHERE t.estabelecimento_id IN (${q})`,
    );
    await x(`DELETE FROM titulo_pagar WHERE estabelecimento_id IN (${q})`);
    await x(
      `DELETE e FROM etapa_fluxo_aprovacao e JOIN fluxo_aprovacao f ON f.id = e.fluxo_aprovacao_id WHERE f.estabelecimento_id IN (${q})`,
    );
    await x(`DELETE FROM fluxo_aprovacao WHERE estabelecimento_id IN (${q})`);
    await x(`DELETE FROM permissao_conta_bancaria WHERE estabelecimento_id IN (${q})`);
    await x(
      `DELETE i FROM conta_hospitalar_item i JOIN conta_hospitalar c ON c.id = i.conta_hospitalar_id WHERE c.estabelecimento_id IN (${q})`,
    );
    await x(`DELETE FROM conta_hospitalar WHERE estabelecimento_id IN (${q})`);
  });
}

/** Monta (ou reaproveita) os cadastros sintéticos; a massa de negócio começa limpa. */
export async function montarMassa(): Promise<MassaFinanceiro> {
  const nucleo = new NucleoProprio();
  const banco = (await nucleo.cliente(CLIENTE)).banco;
  if (banco !== `cliente_${CLIENTE}`) throw new Error('Cliente de teste inesperado.');
  const ids = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-02-07' }, async (e) => {
    const agora = new Date();
    const g = (sel: string, p: unknown[], ins: string, pi: unknown[]) => garantir(e, sel, p, ins, pi);
    const est = (codigo: string) =>
      g(
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [codigo],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
      );
    const usuario = (login: string) =>
      g(
        'SELECT id FROM usuario WHERE login = ?',
        [login],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        [login, `USUARIO SINTETICO ${login.toUpperCase()}`, agora],
      );
    const porCodigo = (tabela: string, codigo: string, colunas: string, valores: unknown[]) =>
      g(
        `SELECT id FROM ${tabela} WHERE codigo = ?`,
        [codigo],
        `INSERT INTO ${tabela} (codigo, ${colunas}, criado_em) VALUES (?, ${valores.map(() => '?').join(', ')}, ?)`,
        [codigo, ...valores, agora],
      );
    const e1 = await est(P);
    const e2 = await est(`${P}B`);
    const grupo = await porCodigo('grupo_natureza_financeira', '9207', 'nome, tipo', [
      'GRUPO SINTETICO L0207',
      'ambos',
    ]);
    const sub = async (codigo: string, classificacao: string) =>
      g(
        'SELECT id FROM subgrupo_natureza_financeira WHERE grupo_natureza_financeira_id = ? AND codigo = ?',
        [grupo, codigo],
        'INSERT INTO subgrupo_natureza_financeira (grupo_natureza_financeira_id, codigo, descricao, classificacao, criado_em) VALUES (?, ?, ?, ?, ?)',
        [grupo, codigo, `SUBGRUPO ${codigo} L0207`, classificacao, agora],
      );
    const subDespesa = await sub('1', 'despesa');
    const subReceita = await sub('2', 'receita');
    await porCodigo('natureza_financeira', '9207.1.1', 'descricao, subgrupo_natureza_financeira_id, tipo', [
      'DESPESA SINTETICA L0207',
      subDespesa,
      'despesa',
    ]);
    await porCodigo('natureza_financeira', '9207.2.1', 'descricao, subgrupo_natureza_financeira_id, tipo', [
      'RECEITA SINTETICA L0207',
      subReceita,
      'receita',
    ]);
    await porCodigo('tipo_credor', 'fornecedor', 'descricao, natureza', ['Fornecedor', 'fornecedor']);
    await porCodigo('tipo_documento_financeiro', 'nota_fiscal', 'descricao, sentido', [
      'Nota fiscal',
      'pagar',
    ]);
    await porCodigo('tipo_documento_financeiro', 'fatura', 'descricao, sentido', ['Fatura', 'receber']);
    for (const [codigo, sentido] of [
      ['pagamento_titulo', 'debito'],
      ['recebimento_titulo', 'credito'],
      ['tarifa', 'debito'],
      ['fechamento_caixa', 'transferencia'],
      ['transferencia', 'transferencia'],
      ['credito_avulso', 'credito'],
      ['debito_avulso', 'debito'],
    ] as const)
      await porCodigo('tipo_lancamento_bancario', codigo, 'descricao, sentido, transferencia', [
        `TIPO ${codigo}`,
        sentido,
        sentido === 'transferencia',
      ]);
    await porCodigo('forma_recebimento', `${P}-TRF`, 'descricao, meio', [
      'TRANSFERENCIA L0207',
      'transferencia',
    ]);
    const tributo = await porCodigo('tributo', `${P}-IRRF`, 'descricao, esfera, forma_apuracao, incidencia', [
      'IRRF SINTETICO L0207',
      'federal',
      'por_pagamento',
      'retido',
    ]);
    const bancoId = await g(
      'SELECT id FROM banco WHERE codigo_ispb = ?',
      ['92070001'],
      "INSERT INTO banco (codigo_ispb, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES (?, 'BANCO SINTETICO L0207', '2000-01-01', 'teste', ?)",
      ['92070001', agora],
    );
    await g(
      'SELECT id FROM leiaute_bancario WHERE codigo = ?',
      [`${P}-240`],
      "INSERT INTO leiaute_bancario (banco_id, codigo, descricao, servico, padrao, versao_leiaute, criado_em) VALUES (?, ?, 'CNAB240 L0207', 'pagamento', 'cnab240', '1', ?)",
      [bancoId, `${P}-240`, agora],
    );
    const conta = (estab: number, codigo: string) =>
      g(
        'SELECT id FROM conta_bancaria WHERE estabelecimento_id = ? AND codigo = ?',
        [estab, codigo],
        "INSERT INTO conta_bancaria (estabelecimento_id, codigo, descricao, tipo, banco_id, numero_conta, criado_em) VALUES (?, ?, ?, 'corrente', ?, ?, ?)",
        [estab, codigo, `CONTA ${codigo} SINTETICA`, bancoId, codigo.replace(/\D/g, '') || '1', agora],
      );
    const fornecedor = await g(
      'SELECT id FROM empresa_fornecedora WHERE cnpj = ?',
      ['92070000000107'],
      "INSERT INTO empresa_fornecedora (tipo_pessoa, cnpj, razao_social, criado_em) VALUES ('juridica', ?, 'FORNECEDOR SINTETICO L0207', ?)",
      ['92070000000107', agora],
    );
    const centro = await g(
      'SELECT id FROM centro_custo WHERE estabelecimento_id = ? AND codigo = ?',
      [e1, `${P}-CC`],
      "INSERT INTO centro_custo (estabelecimento_id, codigo, nome, vigencia_inicio, criado_em) VALUES (?, ?, 'CENTRO SINTETICO L0207', '2000-01-01', ?)",
      [e1, `${P}-CC`, agora],
    );
    const convenio = await g(
      'SELECT id FROM fonte_pagadora WHERE codigo = ?',
      [`${P}-CONV`],
      "INSERT INTO fonte_pagadora (codigo, nome, tipo, situacao, criado_em) VALUES (?, 'OPERADORA SINTETICA L0207', 'operadora', 'ativa', ?)",
      [`${P}-CONV`, agora],
    );
    const pessoa = await g(
      'SELECT id FROM pessoa_fisica WHERE nome = ?',
      [`PACIENTE SINTETICO ${P}`],
      'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
      [`PACIENTE SINTETICO ${P}`, agora],
    );
    const paciente = await g(
      'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
      [pessoa],
      "INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, situacao, criado_em) VALUES (?, ?, 'ativo', ?)",
      [pessoa, 910_207_001, agora],
    );
    const medico = await g(
      'SELECT id FROM pessoa_fisica WHERE nome = ?',
      [`MEDICO SINTETICO ${P}`],
      'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
      [`MEDICO SINTETICO ${P}`, agora],
    );
    const profissional = await g(
      'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
      [medico],
      "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
      [medico, agora],
    );
    const tiss = await g(
      'SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = ?',
      ['E9'],
      "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('E9', 'CARATER L0207', 'teste', ?)",
      [agora],
    );
    const categoria = await porCodigo('categoria_atendimento', `${P}-AMB`, 'descricao, tipo_base', [
      'AMBULATORIO L0207',
      'externo',
    ]);
    const atendimento = await g(
      'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
      [e1, `${P}-AT1`],
      `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id, carater_atendimento_tiss_id,
         fonte_pagadora_id, profissional_id, entrada_em, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [e1, `${P}-AT1`, paciente, categoria, tiss, convenio, profissional, agora, agora],
    );
    const tipoExterna = await porCodigo('tipo_conta', `${P}-EXT`, 'descricao, natureza', [
      'EXTERNA L0207',
      'externa',
    ]);
    const tipoInternacao = await porCodigo('tipo_conta', `${P}-INT`, 'descricao, natureza', [
      'INTERNACAO L0207',
      'internacao',
    ]);
    const lanca = await usuario('l0207.lanca');
    const aprova = await usuario('l0207.aprova');
    const paga = await usuario('l0207.paga');
    const restrito = await usuario('l0207.restrito');
    return {
      est: e1,
      outroEst: e2,
      lanca,
      aprova,
      paga,
      restrito,
      contaA: await conta(e1, `${P}-A1`),
      contaB: await conta(e1, `${P}-B2`),
      contaOutroEst: await conta(e2, `${P}-C3`),
      fornecedor,
      tributo,
      centro,
      convenio,
      paciente,
      atendimento,
      tipoExterna,
      tipoInternacao,
    };
  });
  await limparMassa(nucleo, [ids.est, ids.outroEst]);
  // As contas hospitalares fechadas da competência, sem título: duas externas e uma de internação.
  const contasHospitalares = await nucleo.escrever(
    { cliente: CLIENTE, correlacao: 'preparo-teste-02-07' },
    async (e) => {
      const agora = new Date();
      const conta = (n: number, natureza: string, tipo: number, valor: number) =>
        e.inserir(
          `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, situacao, fechada_em, fechada_por_usuario_id, valor_itens,
           valor_total, criado_em) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'fechada', ?, ?, ?, ?, ?)`,
          [
            ids.est,
            `${P}-CH${n}`,
            ids.atendimento,
            ids.paciente,
            ids.convenio,
            tipo,
            natureza,
            COMPETENCIA,
            agora,
            agora,
            ids.lanca,
            valor,
            valor,
            agora,
          ],
        );
      return [
        await conta(1, 'ambulatorial', ids.tipoExterna, 100.1),
        await conta(2, 'ambulatorial', ids.tipoExterna, 200.2),
        await conta(3, 'internacao', ids.tipoInternacao, 1000.55),
      ];
    },
  );
  return {
    nucleo,
    est: ids.est,
    outroEst: ids.outroEst,
    lanca: ids.lanca,
    aprova: ids.aprova,
    paga: ids.paga,
    restrito: ids.restrito,
    contaA: ids.contaA,
    contaB: ids.contaB,
    contaOutroEst: ids.contaOutroEst,
    fornecedor: ids.fornecedor,
    tributo: ids.tributo,
    centro: ids.centro,
    convenio: ids.convenio,
    contasHospitalares,
    ctx: (usuario, est = ids.est) => ({
      cliente: CLIENTE,
      estabelecimento: est,
      usuario,
      correlacao: 'teste-02-07',
    }),
  };
}

/** Título a pagar sintético (fornecedor da massa, classificação 9207.1.1). */
export function tituloDaMassa(m: MassaFinanceiro, documento: number, valor: number, parcelas = 1) {
  const hoje = new Date().toISOString().slice(0, 10);
  const cada = Math.round((valor / parcelas) * 100) / 100;
  return {
    acao: 'incluir' as const,
    tipo: 'F' as const,
    credor: m.fornecedor,
    documento,
    emissao: hoje,
    valorDocumento: valor,
    referente: 'SINTETICO L0207',
    parcelas: Array.from({ length: parcelas }, (_, i) => ({
      parcela: i + 1,
      vencimento: hoje,
      valor: i === parcelas - 1 ? Math.round((valor - cada * (parcelas - 1)) * 100) / 100 : cada,
    })),
    classificacao: { grupo: 9207, subgrupo: 1, item: 1 },
  };
}
