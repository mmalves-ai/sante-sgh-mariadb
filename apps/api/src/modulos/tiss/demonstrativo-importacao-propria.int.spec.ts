// Contrato de efeito da importação do demonstrativo (06-FAT linha 33, F3.7): o de análise de conta grava o cabeçalho e
// uma linha por item, casada item a item com o item da conta do lote (glosa, motivo, situação); a baixa pelo
// demonstrativo (faturamento.registrarGlosa) concilia as linhas e as liga ao item glosado; a reimportação não duplica;
// o de pagamento grava o cabeçalho com débitos, créditos e líquido, as linhas por protocolo e as deduções; líquido
// negativo é recusado sem gravar. O pagamento casa com QUALQUER lote da operadora (não só o escolhido na tela) e a linha
// casada fica pendente até a baixa; a baixa do recebimento (financeiro.baixar_pagamento_tiss) grava UM crédito pelo
// líquido, o recebimento do título da conta com a retenção (débitos) e o acréscimo (créditos), abate a parcela e o
// título, concilia as linhas e marca o cabeçalho "baixado"; repetir é recusado. Massa SINTÉTICA "D9633" (nenhuma
// pessoa real) no cliente de teste.
import { randomUUID } from 'node:crypto';
import {
  demonstrativoPagamentoSinteticoXml,
  demonstrativoSinteticoXml,
  lerDemonstrativoPagamentoXml,
  lerDemonstrativoXml,
} from '@sgh/dominio-faturamento';
import { type ContextoOperacao, type Escritor, ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { OPERACOES_BAIXA_PAGAMENTO_TISS } from '../financeiro/baixa-pagamento-tiss-propria.js';
import { armazemXmlMemoria } from './armazem-xml.js';
import type { ContextoTiss } from './porta.js';
import { PortaTissPropria } from './porta-propria.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const P = 'D9633';

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function erroDe(p: Promise<unknown>): Promise<ErroOperacao> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao) return e;
    throw e;
  }
  throw new Error('esperava recusa');
}

describe.skipIf(SEM_BANCO)('importação do demonstrativo e conciliação item a item (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaTissPropria;
  let c: ContextoTiss;
  const ids = { est: 0, usuario: 0, conta: 0, lote: 0, lote2: 0, fonte: 0, itens: [0, 0, 0] };

  const limpar = async (e: Escritor) => {
    const est = [ids.est];
    await e.executar(
      `UPDATE demonstrativo_analise_conta_item SET glosa_item_id = NULL WHERE demonstrativo_analise_conta_id IN
         (SELECT id FROM demonstrativo_analise_conta WHERE estabelecimento_id = ?)`,
      est,
    );
    await e.executar(
      'DELETE FROM glosa_item WHERE glosa_id IN (SELECT id FROM glosa WHERE estabelecimento_id = ?)',
      est,
    );
    await e.executar('DELETE FROM glosa WHERE estabelecimento_id = ?', est);
    await e.executar(
      `DELETE FROM demonstrativo_analise_conta_item WHERE demonstrativo_analise_conta_id IN
         (SELECT id FROM demonstrativo_analise_conta WHERE estabelecimento_id = ?)`,
      est,
    );
    await e.executar('DELETE FROM demonstrativo_analise_conta WHERE estabelecimento_id = ?', est);
    for (const t of ['demonstrativo_pagamento_item', 'demonstrativo_deducao'])
      await e.executar(
        `DELETE FROM ${t} WHERE demonstrativo_pagamento_id IN
           (SELECT id FROM demonstrativo_pagamento WHERE estabelecimento_id = ?)`,
        est,
      );
    await e.executar('DELETE FROM demonstrativo_pagamento WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM recebimento WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM movimento_bancario WHERE estabelecimento_id = ?', est);
    await e.executar(
      `DELETE d FROM documento_origem_titulo d JOIN titulo_receber t ON t.id = d.titulo_receber_id
        WHERE t.estabelecimento_id = ?`,
      est,
    );
    await e.executar(
      'DELETE p FROM parcela_receber p JOIN titulo_receber t ON t.id = p.titulo_receber_id WHERE t.estabelecimento_id = ?',
      est,
    );
    await e.executar('DELETE FROM titulo_receber WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM conta_bancaria WHERE estabelecimento_id = ?', est);
    await e.executar(
      'DELETE FROM lote_tiss_conta WHERE lote_tiss_id IN (SELECT id FROM lote_tiss WHERE estabelecimento_id = ?)',
      est,
    );
    await e.executar('DELETE FROM lote_tiss WHERE estabelecimento_id = ?', est);
    await e.executar(
      `DELETE FROM producao_repasse WHERE conta_hospitalar_item_id IN (SELECT ci.id FROM conta_hospitalar_item ci
         JOIN conta_hospitalar ch ON ch.id = ci.conta_hospitalar_id WHERE ch.estabelecimento_id = ?)`,
      est,
    );
    await e.executar(
      'DELETE FROM conta_hospitalar_item WHERE conta_hospitalar_id IN (SELECT id FROM conta_hospitalar WHERE estabelecimento_id = ?)',
      est,
    );
    await e.executar('DELETE FROM conta_hospitalar WHERE estabelecimento_id = ?', est);
    await e.executar('DELETE FROM sequencia_negocio WHERE estabelecimento_id = ?', est);
    await limparTrilhaDaMassa(e, { ids: est });
  };
  const lerUma = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-teste-9633' }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );
  const op = (): ContextoOperacao => ({
    cliente: c.cliente,
    estabelecimento: c.estabelecimento,
    usuario: c.usuario,
    correlacao: c.correlacao,
    chaveIdempotencia: `t9633-${randomUUID()}`,
  });
  const trilha = (tabela: string) => (r: { id: number }) => ({
    estabelecimento: null,
    usuario: null,
    correlacao: null,
    acao: 'inclusao' as const,
    entidade: tabela,
    entidadeId: r.id,
    motivo: 'importação do demonstrativo (teste)',
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-9633' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [`${P}A`],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [`${P}A`, `ESTAB ${P} SINTETICO`, `ESTAB ${P} SINTETICO`, agora],
      );
      ids.usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        ['d9633.teste'],
        "INSERT INTO usuario (login, nome, tipo_conta, criado_em) VALUES (?, ?, 'servico', ?)",
        ['d9633.teste', `USUARIO SINTETICO ${P}`, agora],
      );
      await limpar(e);
      const pessoa = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PACIENTE SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PACIENTE SINTETICO ${P}`, agora],
      );
      const paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pessoa],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pessoa, 963_301, agora],
      );
      const fonte = (ids.fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, registro_ans, criado_em) VALUES (?, ?, 'operadora', '999996', ?)",
        [`${P}FP`, `OPERADORA SINTETICA ${P}`, agora],
      ));
      const categoria = await garantir(
        e,
        'SELECT id FROM categoria_atendimento WHERE codigo = ?',
        [P],
        "INSERT INTO categoria_atendimento (codigo, descricao, tipo_base, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `CATEGORIA SINTETICA ${P}`, agora],
      );
      const carater = await garantir(
        e,
        "SELECT id FROM carater_atendimento_tiss WHERE codigo_tiss = 'L9'",
        [],
        "INSERT INTO carater_atendimento_tiss (codigo_tiss, descricao, versao_fonte, criado_em) VALUES ('L9', ?, 'teste', ?)",
        [`CARATER SINTETICO ${P}`, agora],
      );
      const pessoaProf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        [`PROFISSIONAL SINTETICO ${P}`],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        [`PROFISSIONAL SINTETICO ${P}`, agora],
      );
      const prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pessoaProf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pessoaProf, agora],
      );
      const atendimento = await garantir(
        e,
        'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
        [ids.est, `${P}-1`],
        `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
           carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, situacao, entrada_em, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'aberto', ?, ?)`,
        [ids.est, `${P}-1`, paciente, categoria, carater, fonte, prof, agora, agora],
      );
      const tipoConta = await garantir(
        e,
        'SELECT id FROM tipo_conta WHERE codigo = ?',
        [P],
        "INSERT INTO tipo_conta (codigo, descricao, natureza, criado_em) VALUES (?, ?, 'internacao', ?)",
        [P, `TIPO DE CONTA SINTETICO ${P}`, agora],
      );
      const grupo = await garantir(
        e,
        'SELECT id FROM grupo_faturamento WHERE codigo = ?',
        [P],
        "INSERT INTO grupo_faturamento (codigo, descricao, tipo_grupo, criado_em) VALUES (?, ?, 'sadt', ?)",
        [P, `GRUPO SINTETICO ${P}`, agora],
      );
      const item = await garantir(
        e,
        'SELECT id FROM item_faturavel WHERE codigo = ?',
        ['87963301'],
        "INSERT INTO item_faturavel (codigo, descricao, tipo_item, grupo_faturamento_id, criado_em) VALUES (?, ?, 'procedimento', ?, ?)",
        ['87963301', 'PROCEDIMENTO SINTETICO 87963301', grupo, agora],
      );
      await garantir(
        e,
        'SELECT id FROM motivo_glosa WHERE codigo_tuss = ?',
        ['9633'],
        `INSERT INTO motivo_glosa (codigo_tuss, descricao, permite_reapresentacao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('9633', 'MOTIVO SINTETICO 9633', TRUE, '2020-01-01', 'teste', ?)`,
        [agora],
      );
      ids.conta = await e.inserir(
        `INSERT INTO conta_hospitalar (estabelecimento_id, numero, atendimento_id, paciente_id, fonte_pagadora_id,
           tipo_conta_id, natureza, competencia, inicio_em, fim_em, situacao, valor_itens, valor_total, fechada_em,
           fechada_por_usuario_id, criado_em)
         VALUES (?, ?, ?, ?, ?, ?, 'internacao', '2026-10-01', ?, ?, 'faturada', 900, 900, ?, ?, ?)`,
        [
          ids.est,
          `${P}-C1`,
          atendimento,
          paciente,
          fonte,
          tipoConta,
          agora,
          agora,
          agora,
          ids.usuario,
          agora,
        ],
      );
      for (const seq of [1, 2, 3])
        ids.itens[seq - 1] = await e.inserir(
          `INSERT INTO conta_hospitalar_item (conta_hospitalar_id, sequencia, item_faturavel_id, realizado_em, quantidade,
             valor_unitario, valor_total, criado_em) VALUES (?, ?, ?, ?, 3, 100, 300, ?)`,
          [ids.conta, seq, item, agora, agora],
        );
      const versaoTiss = await garantir(
        e,
        "SELECT id FROM versao_padrao_tiss WHERE codigo_tiss = '04.03.00' AND ativo = TRUE ORDER BY id LIMIT 1",
        [],
        `INSERT INTO versao_padrao_tiss (codigo_tiss, componente, descricao, vigencia_inicio, versao_fonte, criado_em)
         VALUES ('04.03.00', 'troca', 'VERSAO SINTETICA D9633', '2020-01-01', 'teste', ?)`,
        [agora],
      );
      ids.lote = await e.inserir(
        `INSERT INTO lote_tiss (estabelecimento_id, fonte_pagadora_id, numero_lote, sequencial, tipo_guia,
           versao_padrao_tiss_id, gerado_em, quantidade_guias, valor_total, numero_protocolo, situacao, protocolado_em,
           criado_em)
         VALUES (?, ?, '000000963301', '000000963301', 'resumo_internacao', ?, ?, 1, 900, '963301', 'protocolado', ?, ?)`,
        [ids.est, fonte, versaoTiss, agora, agora, agora],
      );
      await e.inserir(
        'INSERT INTO lote_tiss_conta (lote_tiss_id, conta_hospitalar_id, valor, criado_em) VALUES (?, ?, 900, ?)',
        [ids.lote, ids.conta, agora],
      );
      // Outro lote da mesma operadora, sem conta: o pagamento cita os dois.
      ids.lote2 = await e.inserir(
        `INSERT INTO lote_tiss (estabelecimento_id, fonte_pagadora_id, numero_lote, sequencial, tipo_guia,
           versao_padrao_tiss_id, gerado_em, quantidade_guias, valor_total, numero_protocolo, situacao, protocolado_em,
           criado_em)
         VALUES (?, ?, '000000963302', '000000963302', 'resumo_internacao', ?, ?, 0, 0, '963302', 'protocolado', ?, ?)`,
        [ids.est, fonte, versaoTiss, agora, agora, agora],
      );
    });
    porta = new PortaTissPropria(nucleo, CLIENTE, armazemXmlMemoria());
    c = {
      cliente: CLIENTE,
      estabelecimento: ids.est,
      usuario: ids.usuario,
      correlacao: `t9633-${randomUUID()}`.slice(0, 64),
      rede: 'rede',
      hospital: `${P}A`,
    };
  }, 60_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-teste-9633' }, (e) => limpar(e));
    await nucleo.encerrar();
  });

  it('análise de conta: casa item a item, baixa concilia e liga à glosa; reimportação não duplica', async () => {
    // Item 1 pago inteiro, item 2 pago em parte (glosa 200, motivo 9633), linha 3 sem item na conta (sequencial 9).
    const lido = lerDemonstrativoXml(
      demonstrativoSinteticoXml({
        numero: `${P}AN1`,
        dataEmissao: '2026-11-10',
        numeroLote: '000000963301',
        protocolo: '963301',
        guias: [
          {
            numeroGuia: `${P}-C1`,
            itens: [
              { sequencial: 1, codigo: '87963301', informado: 300, liberado: 300, quantidade: 3, motivo: 0 },
              {
                sequencial: 2,
                codigo: '87963301',
                informado: 300,
                liberado: 100,
                quantidade: 1,
                motivo: 9633,
              },
              { sequencial: 9, codigo: '87963301', informado: 50, liberado: 0, quantidade: 1, motivo: 9633 },
            ],
          },
        ],
      }),
    );
    const importacao = {
      usuario: 'd9633.teste',
      lote: ids.lote,
      tipo: 'analise' as const,
      origem: 'xml' as const,
      numero: lido.numero,
      dataEmissao: lido.dataEmissao,
      itens: lido.itens,
      hashArquivo: null,
      chaveObjeto: null,
    };
    const r = await porta.gravarSgh(c, trilha('demonstrativo_analise_conta'), (g) =>
      g.importarDemonstrativo(importacao),
    );
    expect(r).toMatchObject({ repetido: false, casados: 2, semCasamento: 1 });
    expect(
      await lerUma(
        `SELECT lote_tiss_id, situacao, valor_informado, valor_liberado, valor_glosa, forma_entrada
           FROM demonstrativo_analise_conta WHERE id = ?`,
        [r.id],
      ),
    ).toMatchObject({
      lote_tiss_id: ids.lote,
      situacao: 'com_divergencia',
      valor_informado: '650.00',
      valor_liberado: '400.00',
      valor_glosa: '250.00',
      forma_entrada: 'xml',
    });
    expect(
      await lerUma(
        `SELECT COUNT(*) AS q, SUM(conta_hospitalar_item_id IS NOT NULL) AS casados,
                SUM(situacao_conciliacao = 'sem_correspondencia') AS sem, SUM(motivo_glosa_id IS NOT NULL) AS motivos,
                SUM(CASE WHEN conta_hospitalar_item_id = ? THEN valor_glosa ELSE 0 END) AS glosa_item2
           FROM demonstrativo_analise_conta_item WHERE demonstrativo_analise_conta_id = ?`,
        [ids.itens[1], r.id],
      ),
    ).toMatchObject({ q: 3, casados: '2', sem: '1', motivos: '2', glosa_item2: '200.00' });

    // A leitura mostra o casamento; a reimportação (mesmo número) não grava de novo.
    const det = await porta.demonstrativo(c, r.id);
    expect(det?.itens.map((i) => i.situacao)).toEqual(['casado', 'casado', 'sem-casamento']);
    const rep = await porta.gravarSgh(c, trilha('demonstrativo_analise_conta'), (g) =>
      g.importarDemonstrativo(importacao),
    );
    expect(rep).toMatchObject({ id: r.id, repetido: true, casados: 2, semCasamento: 1 });

    // A baixa pelo demonstrativo: o pago no item, a glosa ligada à linha e as linhas casadas conciliadas.
    const casados = det!.itens.filter((i) => i.item !== null);
    await porta.executar(
      c,
      'faturamento.registrarGlosa',
      {
        itens: casados.map((i) => ({
          item: i.item!,
          versao: i.versaoItem!,
          valorPago: i.valorPago,
          quantidadePaga: i.quantidadePaga,
          motivo: i.motivo,
        })),
        dataPagamento: '2026-11-10',
        demonstrativo: r.id,
      },
      op(),
    );
    expect(
      await lerUma(
        `SELECT SUM(i.situacao_conciliacao = 'conciliado') AS conciliados, COUNT(i.glosa_item_id) AS ligados,
                MAX(gi.demonstrativo_analise_conta_item_id = i.id) AS volta, MAX(g.procedencia) AS procedencia,
                MAX(g.demonstrativo_analise_conta_id) AS dem
           FROM demonstrativo_analise_conta_item i
           LEFT JOIN glosa_item gi ON gi.id = i.glosa_item_id LEFT JOIN glosa g ON g.id = gi.glosa_id
          WHERE i.demonstrativo_analise_conta_id = ?`,
        [r.id],
      ),
    ).toMatchObject({ conciliados: '2', ligados: 1, volta: 1, procedencia: 'demonstrativo', dem: r.id });
    expect(
      await lerUma('SELECT valor_pago FROM conta_hospitalar_item WHERE id = ?', [ids.itens[1]]),
    ).toMatchObject({ valor_pago: '100.00' });
    expect((await porta.demonstrativo(c, r.id))?.itens.map((i) => i.situacao)).toEqual([
      'baixado',
      'baixado',
      'sem-casamento',
    ]);
  });

  it('pagamento: cabeçalho com débitos, créditos e líquido, linhas por protocolo e deduções; líquido negativo recusa', async () => {
    const p = lerDemonstrativoPagamentoXml(
      demonstrativoPagamentoSinteticoXml({
        numero: `${P}PG1`,
        dataEmissao: '2026-11-12',
        dataPagamento: '2026-11-15',
        protocolos: [
          { numeroLote: '000000963301', protocolo: '963301', informado: 900, liberado: 700 },
          { numeroLote: '000000963302', protocolo: '963302', informado: 10, liberado: 10 },
          { numeroLote: '000000000001', protocolo: '1', informado: 5, liberado: 5 },
        ],
        descontos: [
          { indicador: 1, tipo: '01', descricao: 'IRRF RETIDO', valor: 10.5 },
          { indicador: 2, tipo: '05', descricao: 'AJUSTE A FAVOR', valor: 3 },
        ],
      }),
    );
    const base = {
      usuario: 'd9633.teste',
      lote: ids.lote,
      tipo: 'pagamento' as const,
      origem: 'xml' as const,
      dataEmissao: p.dataEmissao,
      itens: [],
      hashArquivo: null,
      chaveObjeto: null,
    };
    const r = await porta.gravarSgh(c, trilha('demonstrativo_pagamento'), (g) =>
      g.importarDemonstrativo({
        ...base,
        numero: p.numero,
        pagamento: { dataPagamento: p.dataPagamento, linhas: p.linhas, deducoes: p.deducoes },
      }),
    );
    expect(r).toMatchObject({ repetido: false, casados: 2, semCasamento: 1 });
    expect(
      await lerUma(
        `SELECT data_pagamento, valor_informado, valor_liberado, valor_glosa, valor_debitos, valor_creditos,
                valor_liquido, situacao FROM demonstrativo_pagamento WHERE id = ?`,
        [r.id],
      ),
    ).toMatchObject({
      valor_informado: '915.00',
      valor_liberado: '715.00',
      valor_glosa: '200.00',
      valor_debitos: '10.50',
      valor_creditos: '3.00',
      valor_liquido: '707.50',
      situacao: 'importado',
    });
    expect(
      await lerUma(
        `SELECT COUNT(*) AS q, SUM(lote_tiss_id = ?) AS do_lote, SUM(lote_tiss_id = ?) AS do_outro,
                SUM(situacao_conciliacao = 'divergente') AS divergentes,
                SUM(situacao_conciliacao = 'pendente') AS pendentes, SUM(situacao_conciliacao = 'conciliado') AS conc,
                SUM(situacao_conciliacao = 'sem_correspondencia') AS sem
           FROM demonstrativo_pagamento_item WHERE demonstrativo_pagamento_id = ?`,
        [ids.lote, ids.lote2, r.id],
      ),
    ).toMatchObject({
      q: 3,
      do_lote: '1',
      do_outro: '1',
      divergentes: '1',
      pendentes: '1',
      conc: '0',
      sem: '1',
    });
    expect(
      await lerUma(
        `SELECT COUNT(*) AS q, SUM(natureza = 'debito') AS deb, SUM(valor) AS total
           FROM demonstrativo_deducao WHERE demonstrativo_pagamento_id = ?`,
        [r.id],
      ),
    ).toMatchObject({ q: 2, deb: '1', total: '13.50' });

    // A tela lista o pagamento junto (tipo "pagamento") e abre as linhas dele.
    const lista = await porta.demonstrativos(c, { lote: ids.lote, convenios: null });
    expect(lista.map((d) => d.tipo).sort()).toEqual(['analise', 'pagamento']);
    expect(lista.find((d) => d.tipo === 'pagamento')).toMatchObject({
      casados: 2,
      baixados: 0,
      valorPago: 707.5,
    });
    // No outro lote da operadora o mesmo pagamento aparece (cobre os dois).
    expect(
      (await porta.demonstrativos(c, { lote: ids.lote2, convenios: null })).some((d) => d.id === r.id),
    ).toBe(true);
    const det = await porta.demonstrativo(c, r.id, 'pagamento');
    expect(det?.itens).toHaveLength(3);
    expect(det?.itens.map((i) => i.situacao)).toEqual(['casado', 'casado', 'sem-casamento']);
    expect(det?.pagamento).toMatchObject({
      situacao: 'importado',
      dataPagamento: '2026-11-15',
      liberado: 715,
      debitos: 10.5,
      creditos: 3,
      liquido: 707.5,
    });
    expect(det?.pagamento?.deducoes.map((x) => [x.natureza, x.valor])).toEqual([
      ['debito', 10.5],
      ['credito', 3],
    ]);
    expect(Object.values(det?.pagamento?.lotes ?? {})).toEqual([ids.lote, ids.lote2, 0]);

    // Débito maior que o liberado: recusa e nada fica gravado.
    const antes = await lerUma(
      'SELECT COUNT(*) AS q FROM demonstrativo_pagamento WHERE estabelecimento_id = ?',
      [ids.est],
    );
    const e = await erroDe(
      porta.gravarSgh(c, trilha('demonstrativo_pagamento'), (g) =>
        g.importarDemonstrativo({
          ...base,
          numero: `${P}PG2`,
          pagamento: {
            dataPagamento: '2026-11-15',
            linhas: [p.linhas[0]!],
            deducoes: [
              { natureza: 'debito', codigo: null, descricao: 'X', valor: 9999, dataPagamento: null },
            ],
          },
        }),
      ),
    );
    expect(String(e.problema['codigo'])).toBe('pagamento-inconsistente');
    expect(
      await lerUma('SELECT COUNT(*) AS q FROM demonstrativo_pagamento WHERE estabelecimento_id = ?', [
        ids.est,
      ]),
    ).toEqual(antes);
  });
  it('baixa do pagamento: líquido na conta, retenção e créditos no recebimento do título; linhas conciliadas; repetir recusa', async () => {
    const agora = new Date();
    const hoje = agora.toISOString().slice(0, 10);
    const prep = await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-baixa-9633' }, async (e) => {
      const g = (tabela: string, codigo: string, colunas: string, valores: unknown[]) =>
        garantir(
          e,
          `SELECT id FROM ${tabela} WHERE codigo = ?`,
          [codigo],
          `INSERT INTO ${tabela} (codigo, ${colunas}, criado_em) VALUES (?, ${valores.map(() => '?').join(', ')}, ?)`,
          [codigo, ...valores, agora],
        );
      await g('tipo_lancamento_bancario', 'recebimento_titulo', 'descricao, sentido, transferencia', [
        'TIPO recebimento_titulo',
        'credito',
        false,
      ]);
      await g('forma_recebimento', `${P}-TRF`, 'descricao, meio, uso', [
        `TRANSFERENCIA ${P}`,
        'transferencia',
        'recebimento',
      ]);
      const tipoDoc = await g('tipo_documento_financeiro', 'fatura', 'descricao, sentido', [
        'Fatura',
        'receber',
      ]);
      const grupo = await g('grupo_natureza_financeira', '9633', 'nome, tipo', [
        `GRUPO SINTETICO ${P}`,
        'ambos',
      ]);
      const sub = await garantir(
        e,
        'SELECT id FROM subgrupo_natureza_financeira WHERE grupo_natureza_financeira_id = ? AND codigo = ?',
        [grupo, '2'],
        'INSERT INTO subgrupo_natureza_financeira (grupo_natureza_financeira_id, codigo, descricao, classificacao, criado_em) VALUES (?, ?, ?, ?, ?)',
        [grupo, '2', `SUBGRUPO SINTETICO ${P}`, 'receita', agora],
      );
      const nat = await g(
        'natureza_financeira',
        '9633.2.1',
        'descricao, subgrupo_natureza_financeira_id, tipo',
        [`RECEITA SINTETICA ${P}`, sub, 'receita'],
      );
      const banco = await garantir(
        e,
        'SELECT id FROM banco WHERE codigo_ispb = ?',
        ['96330001'],
        "INSERT INTO banco (codigo_ispb, descricao, vigencia_inicio, versao_fonte, criado_em) VALUES (?, 'BANCO SINTETICO D9633', '2000-01-01', 'teste', ?)",
        ['96330001', agora],
      );
      const contaBancaria = await e.inserir(
        "INSERT INTO conta_bancaria (estabelecimento_id, codigo, descricao, tipo, banco_id, numero_conta, criado_em) VALUES (?, ?, ?, 'corrente', ?, '9633', ?)",
        [ids.est, `${P}-CB`, `CONTA ${P} SINTETICA`, banco, agora],
      );
      const titulo = await e.inserir(
        `INSERT INTO titulo_receber (estabelecimento_id, numero, tipo_devedor, fonte_pagadora_id, tipo_origem,
           tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido,
           valor_recebido, situacao, natureza_financeira_id, criado_em)
         VALUES (?, ?, 'fonte_pagadora', ?, 'avulso', ?, ?, ?, ?, 900, 900, 0, 'aberto', ?, ?)`,
        [ids.est, `${P}-T1`, ids.fonte, tipoDoc, `${P}-C1`, hoje, hoje, nat, agora],
      );
      const parcela = await e.inserir(
        `INSERT INTO parcela_receber (titulo_receber_id, sequencia, vencimento, vencimento_original, valor,
           valor_recebido, saldo, situacao, criado_em) VALUES (?, 1, ?, ?, 900, 0, 900, 'aberta', ?)`,
        [titulo, hoje, hoje, agora],
      );
      await e.inserir(
        `INSERT INTO documento_origem_titulo (natureza_titulo, titulo_receber_id, tipo_documento, entidade, entidade_id,
           criado_em) VALUES ('receber', ?, 'outro', 'conta_hospitalar', ?, ?)`,
        [titulo, ids.conta, agora],
      );
      return { contaBancaria, titulo, parcela };
    });
    const p = lerDemonstrativoPagamentoXml(
      demonstrativoPagamentoSinteticoXml({
        numero: `${P}PG9`,
        dataEmissao: '2026-11-20',
        dataPagamento: hoje,
        protocolos: [
          { numeroLote: '000000963301', protocolo: '963301', informado: 900, liberado: 800 },
          { numeroLote: '000000000001', protocolo: '1', informado: 100, liberado: 100 },
        ],
        descontos: [
          { indicador: 1, tipo: '01', descricao: 'IRRF RETIDO', valor: 13.5 },
          { indicador: 2, tipo: '05', descricao: 'AJUSTE A FAVOR', valor: 4.5 },
        ],
      }),
    );
    const imp = await porta.gravarSgh(c, trilha('demonstrativo_pagamento'), (g) =>
      g.importarDemonstrativo({
        usuario: 'd9633.teste',
        lote: ids.lote2,
        tipo: 'pagamento',
        origem: 'xml',
        numero: p.numero,
        dataEmissao: p.dataEmissao,
        itens: [],
        hashArquivo: null,
        chaveObjeto: null,
        pagamento: { dataPagamento: p.dataPagamento, linhas: p.linhas, deducoes: p.deducoes },
      }),
    );
    // Importado pelo outro lote, a linha casa com o lote da conta (mesma operadora).
    expect(imp).toMatchObject({ repetido: false, casados: 1, semCasamento: 1 });
    const executor = nucleo.criarExecutor();
    const rodar = (entrada: unknown) =>
      executor.executar(
        OPERACOES_BAIXA_PAGAMENTO_TISS['financeiro.baixarPagamentoTiss'] as never,
        CLIENTE,
        entrada,
        op(),
      );
    const entrada = { demonstrativo: imp.id, conta: prep.contaBancaria, dataRecebimento: hoje };
    const r = (await rodar(entrada)).resultado as Record<string, unknown>;
    // 800 de 900 liberados baixados: débitos e créditos na proporção (13,50 x 8/9 = 12,00; 4,50 x 8/9 = 4,00).
    expect(r).toMatchObject({
      titulos: 1,
      linhas: 1,
      recebido: 800,
      retencao: 12,
      acrescimo: 4,
      liquido: 792,
    });
    expect(r).toMatchObject({ linhasSemTitulo: 1, valorSemTitulo: 100 });
    expect(
      await lerUma(
        `SELECT COUNT(*) AS q, SUM(valor) AS valor, MAX(natureza) AS natureza FROM movimento_bancario
          WHERE estabelecimento_id = ? AND conta_bancaria_id = ?`,
        [ids.est, prep.contaBancaria],
      ),
    ).toMatchObject({ q: 1, valor: '792.00', natureza: 'credito' });
    expect(
      await lerUma(
        `SELECT COUNT(*) AS q, SUM(valor_recebido) AS recebido, SUM(valor_retencao) AS retencao,
                SUM(valor_juros) AS creditos, SUM(valor_glosa) AS glosa, MAX(meio_baixa) AS meio,
                MAX(numero_documento) AS doc, MAX(parcela_receber_id) AS parcela
           FROM recebimento WHERE estabelecimento_id = ?`,
        [ids.est],
      ),
    ).toMatchObject({
      q: 1,
      recebido: '800.00',
      retencao: '12.00',
      creditos: '4.00',
      glosa: '100.00',
      meio: 'demonstrativo',
      doc: `${P}PG9`,
      parcela: prep.parcela,
    });
    expect(
      await lerUma('SELECT saldo, valor_recebido, situacao FROM parcela_receber WHERE id = ?', [
        prep.parcela,
      ]),
    ).toMatchObject({ saldo: '100.00', valor_recebido: '800.00', situacao: 'parcial' });
    expect(
      await lerUma('SELECT valor_recebido, situacao FROM titulo_receber WHERE id = ?', [prep.titulo]),
    ).toMatchObject({ valor_recebido: '800.00', situacao: 'recebido_parcial' });
    expect(
      await lerUma(
        'SELECT situacao, conta_bancaria_id, titulo_receber_id FROM demonstrativo_pagamento WHERE id = ?',
        [imp.id],
      ),
    ).toMatchObject({
      situacao: 'baixado',
      conta_bancaria_id: prep.contaBancaria,
      titulo_receber_id: prep.titulo,
    });
    expect(
      await lerUma(
        `SELECT SUM(situacao_conciliacao = 'conciliado') AS conc, SUM(situacao_conciliacao = 'sem_correspondencia') AS sem
           FROM demonstrativo_pagamento_item WHERE demonstrativo_pagamento_id = ?`,
        [imp.id],
      ),
    ).toMatchObject({ conc: '1', sem: '1' });
    // A tela mostra o baixado e a linha como baixada.
    const det = await porta.demonstrativo(c, imp.id, 'pagamento');
    expect(det?.pagamento).toMatchObject({ situacao: 'baixado', titulo: prep.titulo });
    expect(det?.itens.map((i) => i.situacao)).toEqual(['baixado', 'sem-casamento']);
    const lista = await porta.demonstrativos(c, { lote: ids.lote, convenios: null });
    expect(lista.find((d) => d.id === imp.id && d.tipo === 'pagamento')).toMatchObject({ baixados: 1 });
    // Repetir a baixa (outra chave) é recusado, e nada muda.
    expect(String((await erroDe(rodar(entrada))).problema['codigo'])).toBe('ja-baixado');
    expect(
      await lerUma('SELECT COUNT(*) AS q FROM recebimento WHERE estabelecimento_id = ?', [ids.est]),
    ).toMatchObject({ q: 1 });
  });
});
