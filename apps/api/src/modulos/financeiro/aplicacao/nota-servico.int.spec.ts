// F3.8, 07-FIN linha 113: contrato de efeito do ciclo da nota de serviço, contra o MariaDB real (massa SINTÉTICA
// "L0207NS", em estabelecimentos só deste teste; nenhuma pessoa real). A emissão por lote grava o lote, as notas com o
// tomador do cadastro, as deduções da base, os eventos e a ligação com a fatura; a fatura com nota ativa não ganha
// outra; repetir o pedido (a mesma chave) não emite de novo. O cancelamento e a substituição exigem motivo ativo do
// catálogo, justificativa e o prazo do município; nada é apagado: a nota fica "cancelada" ou "substituida", com o
// evento e a substituta ligada. Fora do simulador a nota fica só com o RPS gerado.
import { randomUUID } from 'node:crypto';
import type { ContextoNucleo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  faturasSemNotaServico,
  historicoNotaServico,
  motivosNotaServico,
  notasServico,
  OPERACOES_NOTA_SERVICO,
  parametrosNotaServico,
} from '../nota-servico-propria.js';
import {
  CLIENTE,
  codigoDaGravacao,
  limparMassa,
  type MassaFinanceiro,
  montarMassa,
  P,
  SEM_BANCO,
} from './massa-banco.spec-util.js';

const CNPJ_SINTETICO = '11222333000181';
const JUSTIFICATIVA = 'Valor da fatura corrigido depois da conferência.';

describe.skipIf(SEM_BANCO)('ciclo da nota de serviço: lote, cancelamento e substituição (MariaDB)', () => {
  let m: MassaFinanceiro;
  let est = 0;
  let outroEst = 0;
  let municipio = 0;
  let motivo = 0;
  let motivoDesligado = 0;
  const fat: Record<string, number> = {};
  const corr = { cliente: CLIENTE, correlacao: 'ns-113' };
  const consultar = (sql: string, p: unknown[] = []) => m.nucleo.lerSomente(corr, (l) => l.consultar(sql, p));
  const ler = <T>(fn: Parameters<typeof m.nucleo.lerSomente<T>>[1]) => m.nucleo.lerSomente(corr, fn);
  const ctx = (e = est): ContextoNucleo & { chaveIdempotencia: string } => ({
    ...m.ctx(m.lanca, e),
    chaveIdempotencia: `t0207-ns-${randomUUID()}`,
  });
  const executar = (
    nome: keyof typeof OPERACOES_NOTA_SERVICO,
    entrada: unknown,
    c: ContextoNucleo & { chaveIdempotencia: string } = ctx(),
  ) => m.nucleo.criarExecutor().executar(OPERACOES_NOTA_SERVICO[nome] as never, CLIENTE, entrada, c);
  const nota = (titulo: number, valor: number, deducoes: unknown[] = []) => ({
    tituloReceber: titulo,
    classificacao: '010101',
    itemServico: '4.03',
    valorServicos: valor,
    aliquotaIss: 2,
    deducoes,
  });
  const emitir = (notas: unknown[], destino = 'simulador', c = ctx()) =>
    executar('financeiro.emitirNotasServico', { destino, notas }, c);
  /** O resultado plano da emissão, com as notas na ordem do pedido. */
  const emitidas = (r: { resultado: Readonly<Record<string, unknown>> }) => {
    const numeros = String(r.resultado['numeros']).split(',');
    return {
      lote: Number(r.resultado['lote']),
      quantidade: Number(r.resultado['quantidade']),
      notas: String(r.resultado['notas'])
        .split(',')
        .map((id, i) => ({ id: Number(id), numero: numeros[i] || null })),
    };
  };
  const umaNota = async (id: number) => {
    const [n] = await consultar(
      `SELECT situacao, numero_nota, ambiente, valor_servicos, valor_deducoes, base_calculo, valor_iss, valor_liquido,
              tipo_tomador, CHAR_LENGTH(tomador_documento) AS doc, titulo_receber_id, lote_nota_servico_id,
              substitui_nota_servico_id, motivo_cancelamento_documento_fiscal_id, cancelada_em IS NOT NULL AS cancelada
         FROM nota_servico WHERE id = ?`,
      [id],
    );
    return n as Record<string, unknown>;
  };
  const eventos = async (id: number) =>
    (
      await consultar('SELECT tipo_evento FROM evento_nota_servico WHERE nota_servico_id = ? ORDER BY id', [
        id,
      ])
    ).map((e) => String(e['tipo_evento']));
  const notaDaFatura = async (titulo: number) =>
    Number(
      (await consultar('SELECT nota_servico_id AS n FROM titulo_receber WHERE id = ?', [titulo]))[0]?.['n'],
    );
  const limpar = () =>
    m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-ns-113' }, async (e) => {
      const ests = [est, outroEst];
      const x = (sql: string) => e.executar(sql, ests);
      await x('UPDATE titulo_receber SET nota_servico_id = NULL WHERE estabelecimento_id IN (?, ?)');
      for (const t of ['evento_nota_servico', 'deducao_nota_servico', 'tributo_nota_servico'])
        await x(
          `DELETE x FROM ${t} x JOIN nota_servico n ON n.id = x.nota_servico_id WHERE n.estabelecimento_id IN (?, ?)`,
        );
      await x('UPDATE nota_servico SET substitui_nota_servico_id = NULL WHERE estabelecimento_id IN (?, ?)');
      await x('DELETE FROM nota_servico WHERE estabelecimento_id IN (?, ?)');
      await x('DELETE FROM lote_nota_servico WHERE estabelecimento_id IN (?, ?)');
      await x('DELETE FROM regra_iss_municipio WHERE estabelecimento_id IN (?, ?)');
      await x('UPDATE estabelecimento SET municipio_ibge_id = NULL WHERE id IN (?, ?)');
    });

  beforeAll(async () => {
    m = await montarMassa();
    const ids = await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-ns-113' }, async (e) => {
      const agora = new Date();
      const um = async (sql: string, p: unknown[] = []) => Number((await e.uma<{ id: number }>(sql, p))?.id);
      const garantir = async (sel: string, p: unknown[], ins: string, pi: unknown[]) =>
        (await um(sel, p)) || (await e.inserir(ins, pi));
      const estab = (codigo: string) =>
        garantir(
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `ESTAB ${codigo} SINTETICO`, `ESTAB ${codigo} SINTETICO`, agora],
        );
      const pj = await garantir(
        'SELECT id FROM pessoa_juridica WHERE cnpj = ?',
        [CNPJ_SINTETICO],
        'INSERT INTO pessoa_juridica (cnpj, razao_social, criado_em) VALUES (?, ?, ?)',
        [CNPJ_SINTETICO, `OPERADORA SINTETICA ${P}NS`, agora],
      );
      const fonte = (codigo: string, pessoa: number | null) =>
        garantir(
          'SELECT id FROM fonte_pagadora WHERE codigo = ?',
          [codigo],
          "INSERT INTO fonte_pagadora (codigo, nome, tipo, pessoa_juridica_id, situacao, criado_em) VALUES (?, ?, 'operadora', ?, 'ativa', ?)",
          [codigo, `OPERADORA SINTETICA ${codigo}`, pessoa, agora],
        );
      const desligado = await garantir(
        'SELECT id FROM motivo_cancelamento_documento_fiscal WHERE codigo = ?',
        [`${P}-ns-off`],
        'INSERT INTO motivo_cancelamento_documento_fiscal (codigo, descricao, ativo, criado_em) VALUES (?, ?, FALSE, ?)',
        [`${P}-ns-off`, 'MOTIVO SINTETICO DESLIGADO', agora],
      );
      return {
        est: await estab(`${P}NS`),
        outroEst: await estab(`${P}NT`),
        comCnpj: await fonte(`${P}-NSPJ`, pj),
        semCnpj: await fonte(`${P}-NSSEM`, null),
        municipio: await um('SELECT id FROM municipio_ibge ORDER BY id LIMIT 1'),
        motivo: await um(
          "SELECT id FROM motivo_cancelamento_documento_fiscal WHERE codigo = 'erro_valor_tributo'",
        ),
        desligado,
        natureza: await um("SELECT id FROM natureza_financeira WHERE codigo = '9207.1.1'"),
        tipoDoc: await um("SELECT id FROM tipo_documento_financeiro WHERE codigo = 'fatura'"),
      };
    });
    ({ est, outroEst, municipio, motivo } = ids);
    motivoDesligado = ids.desligado;
    await limpar();
    await limparMassa(m.nucleo, [est, outroEst]);
    await m.nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-ns-113' }, async (e) => {
      const agora = new Date();
      const titulo = async (doc: string, valor: number, fonte: number, e0 = est) => {
        const t = await e.inserir(
          `INSERT INTO titulo_receber (estabelecimento_id, numero, tipo_devedor, fonte_pagadora_id, tipo_origem,
             tipo_documento_financeiro_id, numero_documento, data_emissao, data_lancamento, valor_bruto, valor_liquido,
             situacao, natureza_financeira_id, criado_em)
           VALUES (?, ?, 'fonte_pagadora', ?, 'avulso', ?, ?, '2026-10-05', '2026-10-05', ?, ?, 'aberto', ?, ?)`,
          [e0, `${P}-${doc}`, fonte, ids.tipoDoc, doc, valor, valor, ids.natureza, agora],
        );
        await e.inserir(
          `INSERT INTO parcela_receber (titulo_receber_id, sequencia, vencimento, vencimento_original, valor, saldo, criado_em)
           VALUES (?, 1, '2026-10-30', '2026-10-30', ?, ?, ?)`,
          [t, valor, valor, agora],
        );
        return t;
      };
      for (const [doc, valor] of [
        ['NS1', 1000],
        ['NS2', 500],
        ['NS3', 800],
        ['NS4', 300],
        ['NS5', 700],
      ] as const)
        fat[doc] = await titulo(doc, valor, ids.comCnpj);
      fat['SEM'] = await titulo('NS6', 200, ids.semCnpj);
      fat['OUTRO'] = await titulo('NS7', 400, ids.comCnpj, outroEst);
    });
  });

  afterAll(async () => {
    if (!m) return;
    await limpar();
    await limparMassa(m.nucleo, [est, outroEst]);
    await m.nucleo.encerrar();
  });

  it('emite o lote: lote, notas com tomador e dedução, eventos e a fatura ligada; sem repetir nem duplicar', async () => {
    // Sem o município do estabelecimento a nota não tem onde ser prestada.
    expect(await codigoDaGravacao(emitir([nota(fat['NS1'] as number, 1000)]))).toBe(
      'municipio-estabelecimento',
    );
    await m.nucleo.escrever(corr, (e) =>
      e.executar('UPDATE estabelecimento SET municipio_ibge_id = ? WHERE id IN (?, ?)', [
        municipio,
        est,
        outroEst,
      ]),
    );
    expect(await codigoDaGravacao(emitir([nota(fat['SEM'] as number, 200)]))).toBe('tomador-sem-documento');
    expect(await codigoDaGravacao(emitir([nota(fat['OUTRO'] as number, 400)]))).toBe('titulo-inexistente');
    expect(await codigoDaGravacao(emitir([]))).toBe('lote-vazio');
    expect(
      await codigoDaGravacao(emitir([nota(fat['NS1'] as number, 1000), nota(fat['NS1'] as number, 1000)])),
    ).toBe('fatura-repetida');
    // A dedução sem o documento que a comprova recusa o lote inteiro: nada fica gravado.
    expect(
      await codigoDaGravacao(
        emitir([
          nota(fat['NS1'] as number, 1000),
          nota(fat['NS2'] as number, 500, [{ tipo: 'material', descricao: 'ORTESE SINTETICA', valor: 100 }]),
        ]),
      ),
    ).toBe('deducao-documento');
    expect(
      Number(
        (await consultar('SELECT COUNT(*) AS n FROM nota_servico WHERE estabelecimento_id = ?', [est]))[0]?.[
          'n'
        ],
      ),
    ).toBe(0);
    expect(
      Number(
        (
          await consultar('SELECT COUNT(*) AS n FROM lote_nota_servico WHERE estabelecimento_id = ?', [est])
        )[0]?.['n'],
      ),
    ).toBe(0);

    const antes = await ler((l) => faturasSemNotaServico(l, est));
    expect(antes.map((f) => f.titulo)).toEqual(expect.arrayContaining([fat['NS1'], fat['NS2']]));
    expect(antes.map((f) => f.titulo)).not.toContain(fat['OUTRO']);

    const c = ctx();
    const pedido = [
      nota(fat['NS1'] as number, 1000),
      nota(fat['NS2'] as number, 500, [
        { tipo: 'material', descricao: 'ORTESE SINTETICA', documento: 'NF-SINT-1', valor: 100 },
      ]),
    ];
    const r = await emitir(pedido, 'simulador', c);
    const res = emitidas(r);
    expect(res.quantidade).toBe(2);
    const [lote] = await consultar(
      'SELECT quantidade_rps, valor_total_servicos, valor_total_deducoes, situacao FROM lote_nota_servico WHERE id = ?',
      [res.lote],
    );
    expect([
      Number(lote?.['quantidade_rps']),
      Number(lote?.['valor_total_servicos']),
      Number(lote?.['valor_total_deducoes']),
      lote?.['situacao'],
    ]).toEqual([2, 1500, 100, 'processado']);
    const [n1, n2] = [await umaNota(res.notas[0]?.id as number), await umaNota(res.notas[1]?.id as number)];
    expect(n1).toMatchObject({
      situacao: 'autorizada',
      ambiente: 'homologacao',
      tipo_tomador: 'pessoa_juridica',
    });
    expect(String(n1['numero_nota'])).toMatch(/^SIM\d{9}$/);
    expect([Number(n1['doc']), Number(n1['titulo_receber_id']), Number(n1['lote_nota_servico_id'])]).toEqual([
      14,
      fat['NS1'],
      res.lote,
    ]);
    expect([Number(n1['base_calculo']), Number(n1['valor_iss']), Number(n1['valor_liquido'])]).toEqual([
      1000, 20, 1000,
    ]);
    // A dedução reduz a base do ISS (500 − 100 = 400; 2% = 8), não o valor cobrado.
    expect([
      Number(n2['valor_servicos']),
      Number(n2['valor_deducoes']),
      Number(n2['base_calculo']),
      Number(n2['valor_iss']),
      Number(n2['valor_liquido']),
    ]).toEqual([500, 100, 400, 8, 500]);
    const ded = await consultar(
      'SELECT tipo, valor, comprovante_numero FROM deducao_nota_servico WHERE nota_servico_id = ?',
      [res.notas[1]?.id],
    );
    expect(ded.map((d) => [d['tipo'], Number(d['valor']), d['comprovante_numero']])).toEqual([
      ['material', 100, 'NF-SINT-1'],
    ]);
    expect(await eventos(res.notas[0]?.id as number)).toEqual(['emissao', 'autorizacao']);
    expect(await notaDaFatura(fat['NS1'] as number)).toBe(res.notas[0]?.id);

    // O mesmo pedido de novo (a mesma chave) não emite outra nota; outra emissão para a fatura é recusada.
    const de_novo = await emitir(pedido, 'simulador', c);
    expect(de_novo.repetida).toBe(true);
    expect(
      Number(
        (await consultar('SELECT COUNT(*) AS n FROM nota_servico WHERE estabelecimento_id = ?', [est]))[0]?.[
          'n'
        ],
      ),
    ).toBe(2);
    expect(await codigoDaGravacao(emitir([nota(fat['NS1'] as number, 1000)]))).toBe('fatura-com-nota');
    const depois = await ler((l) => faturasSemNotaServico(l, est));
    expect(depois.map((f) => f.titulo)).not.toContain(fat['NS1']);
    const lista = await ler((l) => notasServico(l, est));
    expect(lista.map((n) => n.id).sort()).toEqual(res.notas.map((n) => n.id).sort());
    // Outro estabelecimento não enxerga as notas.
    expect(await ler((l) => notasServico(l, outroEst))).toEqual([]);
  });

  it('cancela com motivo do catálogo e justificativa: a nota fica, cancelada, e a fatura volta a poder ter nota', async () => {
    const id = await notaDaFatura(fat['NS1'] as number);
    const cancelar = (motivoId: number, justificativa: string, e0 = est) =>
      executar('financeiro.cancelarNotaServico', { nota: id, motivo: motivoId, justificativa }, ctx(e0));
    expect((await ler((l) => motivosNotaServico(l))).map((x) => x.id)).toContain(motivo);
    expect((await ler((l) => motivosNotaServico(l))).map((x) => x.id)).not.toContain(motivoDesligado);
    expect(await codigoDaGravacao(cancelar(motivoDesligado, JUSTIFICATIVA))).toBe('motivo-invalido');
    expect(await codigoDaGravacao(cancelar(999_999_999, JUSTIFICATIVA))).toBe('motivo-invalido');
    expect(await codigoDaGravacao(cancelar(motivo, 'curta'))).toBe('justificativa-curta');
    expect(await codigoDaGravacao(cancelar(motivo, JUSTIFICATIVA, outroEst))).toBe('nota-inexistente');
    expect((await umaNota(id))['situacao']).toBe('autorizada');

    await cancelar(motivo, JUSTIFICATIVA);
    const n = await umaNota(id);
    expect(n).toMatchObject({ situacao: 'cancelada' });
    expect([Number(n['cancelada']), Number(n['motivo_cancelamento_documento_fiscal_id'])]).toEqual([
      1,
      motivo,
    ]);
    expect(String(n['numero_nota'])).toMatch(/^SIM/);
    const [ev] = await consultar(
      "SELECT motivo, motivo_cancelamento_documento_fiscal_id AS m, usuario_id FROM evento_nota_servico WHERE nota_servico_id = ? AND tipo_evento = 'cancelamento'",
      [id],
    );
    expect([ev?.['motivo'], Number(ev?.['m']), Number(ev?.['usuario_id'])]).toEqual([
      JUSTIFICATIVA,
      motivo,
      m.lanca,
    ]);
    expect(await eventos(id)).toEqual(['emissao', 'autorizacao', 'cancelamento']);
    expect(await notaDaFatura(fat['NS1'] as number)).toBe(0);
    expect(await codigoDaGravacao(cancelar(motivo, JUSTIFICATIVA))).toBe('nota-nao-alteravel');

    // A fatura volta à seleção e ganha outra nota; a cancelada continua no banco.
    expect((await ler((l) => faturasSemNotaServico(l, est))).map((f) => f.titulo)).toContain(fat['NS1']);
    await emitir([nota(fat['NS1'] as number, 950)]);
    const doTitulo = await consultar(
      'SELECT situacao FROM nota_servico WHERE titulo_receber_id = ? ORDER BY id',
      [fat['NS1']],
    );
    expect(doTitulo.map((x) => x['situacao'])).toEqual(['cancelada', 'autorizada']);
  });

  it('substitui: a original fica substituída, a substituta aponta para ela e a fatura passa à substituta', async () => {
    const id = await notaDaFatura(fat['NS2'] as number);
    const substituir = (nova: unknown, justificativa = JUSTIFICATIVA) =>
      executar('financeiro.substituirNotaServico', {
        nota: id,
        motivo,
        justificativa,
        destino: 'simulador',
        nova,
      });
    expect(await codigoDaGravacao(substituir(nota(fat['NS3'] as number, 450)))).toBe('tomador-diferente');
    expect(await codigoDaGravacao(substituir(nota(fat['NS2'] as number, 450), 'curta'))).toBe(
      'justificativa-curta',
    );
    expect(
      await codigoDaGravacao(
        substituir(
          nota(fat['NS2'] as number, 450, [{ tipo: 'material', descricao: 'X', documento: 'D', valor: 450 }]),
        ),
      ),
    ).toBe('deducoes-acima');
    expect((await umaNota(id))['situacao']).toBe('autorizada');

    const r = await substituir(nota(fat['NS2'] as number, 450));
    const res = { substituta: Number(r.resultado['substituta']) };
    const [original, substituta] = [await umaNota(id), await umaNota(res.substituta)];
    expect(original).toMatchObject({ situacao: 'substituida' });
    expect(Number(original['motivo_cancelamento_documento_fiscal_id'])).toBe(motivo);
    expect(substituta).toMatchObject({ situacao: 'autorizada' });
    expect([Number(substituta['substitui_nota_servico_id']), Number(substituta['valor_servicos'])]).toEqual([
      id,
      450,
    ]);
    const [ev] = await consultar(
      "SELECT substituta_nota_servico_id AS s, motivo FROM evento_nota_servico WHERE nota_servico_id = ? AND tipo_evento = 'substituicao'",
      [id],
    );
    expect([Number(ev?.['s']), ev?.['motivo']]).toEqual([res.substituta, JUSTIFICATIVA]);
    expect(await notaDaFatura(fat['NS2'] as number)).toBe(res.substituta);
    // A dedução da original continua no banco; a substituída não se altera de novo.
    expect(
      Number(
        (
          await consultar('SELECT COUNT(*) AS n FROM deducao_nota_servico WHERE nota_servico_id = ?', [id])
        )[0]?.['n'],
      ),
    ).toBe(1);
    expect(await codigoDaGravacao(substituir(nota(fat['NS2'] as number, 440)))).toBe('nota-nao-alteravel');
    const h = await ler((l) => historicoNotaServico(l, est, id));
    expect(h?.eventos.map((e) => e.tipo)).toEqual(['emissao', 'autorizacao', 'substituicao']);
    expect(h?.eventos.at(-1)).toMatchObject({ substituta: res.substituta, justificativa: JUSTIFICATIVA });
    expect(h?.deducoes).toHaveLength(1);
    expect(await ler((l) => historicoNotaServico(l, outroEst, id))).toBeNull();
    const linha = (await ler((l) => notasServico(l, est))).find((n) => n.id === id);
    expect(linha).toMatchObject({ situacao: 'substituida', substituta: res.substituta });
  });

  it('o prazo do município fica na regra do ISS e barra o cancelamento e a substituição fora dele', async () => {
    const prazo = (c: number, s: number, aliquota: number | null = null) =>
      executar('financeiro.definirPrazoNotaServico', {
        prazoCancelamentoDias: c,
        prazoSubstituicaoDias: s,
        aliquota,
      });
    const p0 = await ler((l) => parametrosNotaServico(l, est));
    expect(p0).toMatchObject({ temRegra: false, prazoPadrao: true, prazoCancelamentoDias: 30 });
    expect(p0.municipio?.ibge).toMatch(/^\d{7}$/);
    expect(await codigoDaGravacao(prazo(5, 10))).toBe('aliquota-obrigatoria');
    expect(await codigoDaGravacao(prazo(4000, 10, 2))).toBe('prazo-invalido');
    expect(await codigoDaGravacao(prazo(1.5, 10, 2))).toBe('prazo-invalido');
    await prazo(5, 10, 2);
    await prazo(5, 8);
    const regras = await consultar(
      'SELECT aliquota, prazo_cancelamento_dias AS c, prazo_substituicao_dias AS s FROM regra_iss_municipio WHERE estabelecimento_id = ?',
      [est],
    );
    expect(regras.map((r) => [Number(r['aliquota']), Number(r['c']), Number(r['s'])])).toEqual([[2, 5, 8]]);
    expect(await ler((l) => parametrosNotaServico(l, est))).toMatchObject({
      temRegra: true,
      prazoPadrao: false,
      aliquota: 2,
      prazoCancelamentoDias: 5,
      prazoSubstituicaoDias: 8,
    });
    // O outro estabelecimento segue no padrão.
    expect(await ler((l) => parametrosNotaServico(l, outroEst))).toMatchObject({ temRegra: false });

    const r = await emitir([nota(fat['NS3'] as number, 800)]);
    const id = emitidas(r).notas[0]?.id as number;
    const recuar = (dias: number) =>
      m.nucleo.escrever(corr, (e) =>
        e.executar('UPDATE nota_servico SET data_emissao = DATE_SUB(NOW(3), INTERVAL ? DAY) WHERE id = ?', [
          dias,
          id,
        ]),
      );
    await recuar(9);
    expect(
      await codigoDaGravacao(
        executar('financeiro.cancelarNotaServico', { nota: id, motivo, justificativa: JUSTIFICATIVA }),
      ),
    ).toBe('prazo-cancelamento-vencido');
    expect(
      await codigoDaGravacao(
        executar('financeiro.substituirNotaServico', {
          nota: id,
          motivo,
          justificativa: JUSTIFICATIVA,
          destino: 'simulador',
          nova: nota(fat['NS3'] as number, 790),
        }),
      ),
    ).toBe('prazo-substituicao-vencido');
    expect((await umaNota(id))['situacao']).toBe('autorizada');
    // Dentro do prazo da substituição (8 dias) e fora do de cancelamento (5): só a substituição passa.
    await recuar(7);
    expect(
      await codigoDaGravacao(
        executar('financeiro.cancelarNotaServico', { nota: id, motivo, justificativa: JUSTIFICATIVA }),
      ),
    ).toBe('prazo-cancelamento-vencido');
    await executar('financeiro.substituirNotaServico', {
      nota: id,
      motivo,
      justificativa: JUSTIFICATIVA,
      destino: 'simulador',
      nova: nota(fat['NS3'] as number, 790),
    });
    expect((await umaNota(id))['situacao']).toBe('substituida');
  });

  it('fora do simulador a nota fica com o RPS gerado, sem número, e o lote só gerado', async () => {
    const r = await emitir([nota(fat['NS4'] as number, 300), nota(fat['NS5'] as number, 700)], 'prefeitura');
    const res = emitidas(r);
    expect(res.notas.map((n) => n.numero)).toEqual([null, null]);
    const n = await umaNota(res.notas[0]?.id as number);
    expect(n).toMatchObject({ situacao: 'rps_gerado', numero_nota: null, ambiente: 'producao' });
    expect(await eventos(res.notas[0]?.id as number)).toEqual(['emissao']);
    const [lote] = await consultar('SELECT situacao, protocolo FROM lote_nota_servico WHERE id = ?', [
      res.lote,
    ]);
    expect(lote).toMatchObject({ situacao: 'gerado', protocolo: null });
    // A nota à espera da prefeitura ocupa a fatura e ainda não pode ser cancelada nem substituída.
    expect(await codigoDaGravacao(emitir([nota(fat['NS4'] as number, 300)]))).toBe('fatura-com-nota');
    expect(
      await codigoDaGravacao(
        executar('financeiro.cancelarNotaServico', {
          nota: res.notas[0]?.id,
          motivo,
          justificativa: JUSTIFICATIVA,
        }),
      ),
    ).toBe('nota-nao-alteravel');
    // Os RPS do estabelecimento saem em sequência, sem repetir.
    const rps = await consultar(
      'SELECT numero_rps FROM nota_servico WHERE estabelecimento_id = ? ORDER BY id',
      [est],
    );
    const numeros = rps.map((x) => Number(x['numero_rps']));
    expect(new Set(numeros).size).toBe(numeros.length);
    expect(numeros).toEqual([...numeros].sort((a, b) => a - b));
  });
});
