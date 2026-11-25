// Contrato de efeito da importação do demonstrativo (06-FAT linha 33, F3.7): o de análise de conta grava o cabeçalho e
// uma linha por item, casada item a item com o item da conta do lote (glosa, motivo, situação); a baixa pelo
// demonstrativo (faturamento.registrarGlosa) concilia as linhas e as liga ao item glosado; a reimportação não duplica;
// o de pagamento grava o cabeçalho com débitos, créditos e líquido, as linhas por protocolo e as deduções; líquido
// negativo é recusado sem gravar. Massa SINTÉTICA "D9633" (nenhuma pessoa real) no cliente de teste.
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
  const ids = { est: 0, usuario: 0, conta: 0, lote: 0, itens: [0, 0, 0] };

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
      const fonte = await garantir(
        e,
        'SELECT id FROM fonte_pagadora WHERE codigo = ?',
        [`${P}FP`],
        "INSERT INTO fonte_pagadora (codigo, nome, tipo, registro_ans, criado_em) VALUES (?, ?, 'operadora', '999996', ?)",
        [`${P}FP`, `OPERADORA SINTETICA ${P}`, agora],
      );
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
          { numeroLote: '000000000001', protocolo: '1', informado: 10, liberado: 10 },
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
    expect(r).toMatchObject({ repetido: false, casados: 1, semCasamento: 1 });
    expect(
      await lerUma(
        `SELECT data_pagamento, valor_informado, valor_liberado, valor_glosa, valor_debitos, valor_creditos,
                valor_liquido, situacao FROM demonstrativo_pagamento WHERE id = ?`,
        [r.id],
      ),
    ).toMatchObject({
      valor_informado: '910.00',
      valor_liberado: '710.00',
      valor_glosa: '200.00',
      valor_debitos: '10.50',
      valor_creditos: '3.00',
      valor_liquido: '702.50',
      situacao: 'importado',
    });
    expect(
      await lerUma(
        `SELECT COUNT(*) AS q, SUM(lote_tiss_id = ?) AS do_lote, SUM(situacao_conciliacao = 'divergente') AS divergentes,
                SUM(situacao_conciliacao = 'sem_correspondencia') AS sem
           FROM demonstrativo_pagamento_item WHERE demonstrativo_pagamento_id = ?`,
        [ids.lote, r.id],
      ),
    ).toMatchObject({ q: 2, do_lote: '1', divergentes: '1', sem: '1' });
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
    expect((await porta.demonstrativo(c, r.id, 'pagamento'))?.itens).toHaveLength(2);

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
});
