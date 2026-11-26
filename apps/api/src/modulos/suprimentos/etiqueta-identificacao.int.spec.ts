// Contrato de efeito da etiqueta de identificação do estoque e da leitura do código (F3.6, 05-SUP linha 14) contra o
// MariaDB real (cliente de teste do lote, massa SINTÉTICA, nenhuma pessoa real). Pelo Executor: a emissão grava as
// etiquetas com o identificador sequencial por estabelecimento (dígito de conferência), o lote, a validade, a
// quantidade, a primeira impressão e a trilha; devolve o DataMatrix GS1 e o ZPL; a repetição pela mesma chave não
// emite de novo; o item rastreável sem lote, o lote vencido e o lote de outro item são recusados. A leitura resolve a
// etiqueta (pelo Code 128 e pelo DataMatrix), o código de barras do item com a quantidade representada e o padrão de
// leitura configurado (expressão com grupos), e recusa o código desconhecido. A baixa deixa a etiqueta consumida (não
// apagada), a leitura seguinte é recusada, e a devolvida volta a ativa. Outro estabelecimento não lê a etiqueta.
// A ficha não devolve o ZPL: ele só sai pela reimpressão registrada (motivo do catálogo da impressão padrão, via 2 em
// `registro_reimpressao`, `impressoes` somado, `permite_reimpressao` respeitado). A saída do estoque consome a etiqueta
// lida na mesma transação, com o movimento em `movimento_consumo_id`; a etiqueta de outro item desfaz a saída inteira.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { randomUUID } from 'node:crypto';
import { digitoGs1, identificadorValido } from '@sgh/contratos/regras-suprimentos';
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ContextoPortaM18 } from '../exames/public-api.js';
import { PortaEtiquetaIdentificacaoPropria } from './etiqueta-identificacao.js';
import { PortaSuprimentosPropria } from './porta-propria.js';
import type { ContextoSuprimentos } from './porta.js';
import {
  CLIENTE,
  codigoDe,
  contexto,
  inserirMinimo,
  limparMassa,
  type MassaSuprimentos,
  montarMassa,
  SEM_BANCO,
} from './massa-propria.spec-util.js';

const k = () => `t-etq-${randomUUID()}`;
type L = Record<string, unknown>;
const base12 = `20${String(Date.now()).slice(-10)}`;
const GTIN = `${base12}${digitoGs1(base12)}`;
const PADRAO = `T${Date.now().toString(36).toUpperCase()}`.slice(0, 12);
const MOTIVO = `TETQ${Date.now().toString(36).toUpperCase()}`.slice(0, 30);

describe.skipIf(SEM_BANCO)('etiqueta de identificação e leitura do código (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaEtiquetaIdentificacaoPropria;
  let m: MassaSuprimentos;
  let c: ContextoPortaM18;
  let cB: ContextoPortaM18;
  let motivo = 0;
  let motivoComplemento = 0;
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-c2024' }, (l) => l.uma<L>(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaEtiquetaIdentificacaoPropria(nucleo);
    c = contexto(m, m.estA, 't-c2024') as ContextoPortaM18;
    cB = contexto(m, m.estB, 't-c2024-b') as ContextoPortaM18;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2024-massa' }, async (e) => {
      await inserirMinimo(
        e,
        'insumo_codigo_barras',
        {
          insumo_id: m.insumo,
          sequencia: 91,
          codigo_barras: GTIN,
          padrao: 'gtin',
          quantidade_representada: 10,
          unidade_medida_id: m.unidade,
        },
        m.marca,
      );
      await inserirMinimo(
        e,
        'padrao_leitura_codigo',
        {
          codigo: PADRAO,
          descricao: 'Padrão sintético de teste',
          simbologia: 'code128',
          expressao_regular: '^PX(?<produto>\\d{13})L(?<lote>[A-Z0-9]+)V(?<validade>\\d{8})$',
          formato_data: 'AAAAMMDD',
        },
        m.marca,
      );
      const agora = new Date();
      await e.executar(
        `INSERT INTO motivo_reimpressao (codigo, descricao, ativo, exige_complemento, criado_em, criado_por)
         VALUES (?, 'Etiqueta danificada (teste)', TRUE, FALSE, ?, ?), (?, 'Outro (teste)', TRUE, TRUE, ?, ?)`,
        [MOTIVO, agora, m.usuario, `${MOTIVO}C`, agora, m.usuario],
      );
      const ms = await e.consultar<L>('SELECT id, codigo FROM motivo_reimpressao WHERE codigo IN (?, ?)', [
        MOTIVO,
        `${MOTIVO}C`,
      ]);
      motivo = Number(ms.find((x) => x['codigo'] === MOTIVO)?.['id']);
      motivoComplemento = Number(ms.find((x) => x['codigo'] === `${MOTIVO}C`)?.['id']);
    });
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2024-limpa' }, async (e) => {
      await e.executar('DELETE FROM padrao_leitura_codigo WHERE codigo = ?', [PADRAO]);
      await e.executar('DELETE FROM insumo_codigo_barras WHERE codigo_barras = ?', [GTIN]);
      await e.executar(
        `DELETE FROM registro_reimpressao WHERE estabelecimento_id IN (?, ?) AND entidade = 'etiqueta_identificacao'`,
        [m.estA, m.estB],
      );
      await e.executar('DELETE FROM motivo_reimpressao WHERE codigo IN (?, ?)', [MOTIVO, `${MOTIVO}C`]);
    });
    await limparMassa(nucleo, m);
    await nucleo.encerrar?.();
  }, 120_000);

  let identificador = '';
  let datamatrix = '';
  let etiquetaId = 0;

  it('emite as etiquetas com o sequencial, o lote, a validade, a 1ª impressão e a trilha; a repetição não emite de novo', async () => {
    const chave = k();
    const entrada = {
      insumo: m.insumo,
      lote: m.lote,
      local: m.localA,
      quantidade: 1,
      etiquetas: 3,
      tipo: 'unidade' as const,
      notaEntradaItem: null,
    };
    const r = await porta.emitir(c, entrada, chave);
    expect(r.etiquetas).toHaveLength(3);
    const ids = r.etiquetas.map((x) => x.identificador);
    expect(ids.every(identificadorValido)).toBe(true);
    expect(new Set(ids).size).toBe(3);
    const [e1] = r.etiquetas;
    identificador = e1!.identificador;
    datamatrix = e1!.datamatrix;
    etiquetaId = e1!.id;
    expect(datamatrix).toContain(`01${GTIN.padStart(14, '0')}`);
    expect(datamatrix).toContain('17270331');
    expect(datamatrix).toContain(`21${identificador}`);
    expect(r.zpl.match(/\^XA/g)).toHaveLength(3);
    expect(r.zpl).toContain(`^FD${identificador}^FS`);
    expect(
      await um(
        `SELECT estabelecimento_id AS est, insumo_id AS ins, lote_insumo_id AS lote, local_estoque_id AS loc, quantidade,
                tipo, situacao, impressoes, origem, data_validade, criado_por, versao FROM etiqueta_identificacao WHERE id = ?`,
        [etiquetaId],
      ),
    ).toMatchObject({
      est: m.estA,
      ins: m.insumo,
      lote: m.lote,
      loc: m.localA,
      tipo: 'unidade',
      situacao: 'ativa',
      impressoes: 1,
      origem: 'sistema',
      criado_por: m.usuario,
      versao: 1,
    });
    expect(
      Number(
        (await um('SELECT quantidade AS q FROM etiqueta_identificacao WHERE id = ?', [etiquetaId]))?.['q'],
      ),
    ).toBe(1);
    expect(
      Number(
        (
          await um(
            `SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'etiqueta_identificacao' AND entidade_id = ?`,
            [etiquetaId],
          )
        )?.['n'],
      ),
    ).toBeGreaterThanOrEqual(1);
    // A repetição pela mesma chave devolve a primeira e não grava de novo.
    const rep = await porta.emitir(c, entrada, chave);
    expect(rep.etiquetas.map((x) => x.identificador)).toEqual(ids);
    expect(
      Number(
        (
          await um('SELECT COUNT(*) AS n FROM etiqueta_identificacao WHERE estabelecimento_id = ?', [m.estA])
        )?.['n'],
      ),
    ).toBe(3);
    // A próxima emissão segue o sequencial.
    const r2 = await porta.emitir(c, { ...entrada, etiquetas: 1 }, k());
    expect(r2.etiquetas[0]!.identificador > ids[2]!).toBe(true);
  });

  it('recusa o rastreável sem lote, o lote vencido e o lote de outro item', async () => {
    const e = {
      insumo: m.insumo,
      lote: null,
      local: null,
      quantidade: 1,
      etiquetas: 1,
      tipo: 'unidade' as const,
      notaEntradaItem: null,
    };
    expect(await codigoDe(porta.emitir(c, e, k()))).toBe('lote-obrigatorio');
    expect(await codigoDe(porta.emitir(c, { ...e, lote: m.loteSuspeito }, k()))).toBe('lote-vencido');
    expect(await codigoDe(porta.emitir(c, { ...e, insumo: m.insumoOpme, lote: m.lote }, k()))).toBe(
      'lote-inexistente',
    );
  });

  it('a ficha não traz o ZPL; a reimpressão registra motivo e via, soma as impressões e respeita o bloqueio', async () => {
    const f = await porta.ficha(c, etiquetaId);
    expect(f).toMatchObject({ identificador, situacao: 'ativa', impressoes: 1, datamatrix });
    expect(f).not.toHaveProperty('zpl');
    expect(await porta.ficha(cB, etiquetaId)).toBeNull();
    expect((await porta.motivosReimpressao(c)).map((x) => x.codigo)).toEqual(
      expect.arrayContaining([motivo, motivoComplemento]),
    );
    const registros = async () =>
      Number(
        (
          await um(
            `SELECT COUNT(*) AS n FROM registro_reimpressao WHERE entidade = 'etiqueta_identificacao' AND entidade_id = ?`,
            [etiquetaId],
          )
        )?.['n'],
      );
    // O motivo que pede complemento sem ele e o motivo inexistente: recusa, nada gravado.
    expect(
      await codigoDe(porta.reimprimir(c, etiquetaId, { motivo: motivoComplemento, complemento: null }, k())),
    ).toBe('complemento-obrigatorio');
    expect(
      await codigoDe(porta.reimprimir(c, etiquetaId, { motivo: 999_999_999, complemento: null }, k())),
    ).toBe('motivo-inexistente');
    expect(await registros()).toBe(0);
    const chave = k();
    const r = await porta.reimprimir(c, etiquetaId, { motivo, complemento: null }, chave);
    expect(r).toMatchObject({ id: etiquetaId, via: 2, impressoes: 2 });
    expect(r.zpl).toContain('^BXN');
    expect(r.zpl).toContain(`^FD${identificador}^FS`);
    // A repetição pela mesma chave não registra de novo.
    expect((await porta.reimprimir(c, etiquetaId, { motivo, complemento: null }, chave)).via).toBe(2);
    expect(await registros()).toBe(1);
    expect(
      await um(
        `SELECT r.via, r.motivo_reimpressao_id AS motivo, r.usuario_id AS usuario, e.impressoes
           FROM registro_reimpressao r JOIN etiqueta_identificacao e ON e.id = r.entidade_id
          WHERE r.entidade = 'etiqueta_identificacao' AND r.entidade_id = ?`,
        [etiquetaId],
      ),
    ).toMatchObject({ via: 2, motivo, usuario: m.usuario, impressoes: 2 });
    // Outro estabelecimento não reimprime; a etiqueta com a reimpressão bloqueada também não.
    expect(await codigoDe(porta.reimprimir(cB, etiquetaId, { motivo, complemento: null }, k()))).toBe(
      'etiqueta-desconhecida',
    );
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2024-bloqueio' }, (e) =>
      e.executar('UPDATE etiqueta_identificacao SET permite_reimpressao = FALSE WHERE id = ?', [etiquetaId]),
    );
    expect(await codigoDe(porta.reimprimir(c, etiquetaId, { motivo, complemento: null }, k()))).toBe(
      'reimpressao-nao-permitida',
    );
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-c2024-bloqueio' }, (e) =>
      e.executar('UPDATE etiqueta_identificacao SET permite_reimpressao = TRUE WHERE id = ?', [etiquetaId]),
    );
    expect(await registros()).toBe(1);
  });

  it('lê a etiqueta pelo Code 128 e pelo DataMatrix, o código do item e o padrão configurado', async () => {
    const porBarras = await porta.ler(c, identificador);
    expect(porBarras).toMatchObject({
      item: { codigo: m.insumo, rastreavel: true },
      lote: `${m.marca}L1`,
      loteId: m.lote,
      validade: '2027-03-31',
      quantidade: 1,
      identificador,
      origem: 'etiqueta',
    });
    expect((await porta.ler(c, datamatrix)).identificador).toBe(identificador);
    const porItem = await porta.ler(c, GTIN);
    expect(porItem).toMatchObject({
      item: { codigo: m.insumo },
      quantidade: 10,
      origem: 'codigo-item',
      lote: null,
    });
    const pad = await porta.ler(c, `PX${GTIN}L${m.marca}L1V20270331`);
    expect(pad.padrao).not.toBeNull();
    expect(pad).toMatchObject({
      item: { codigo: m.insumo },
      lote: `${m.marca}L1`,
      loteId: m.lote,
      validade: '2027-03-31',
    });
    expect(await codigoDe(porta.ler(c, '7000000000000X'))).toBe('codigo-desconhecido');
    expect(await codigoDe(porta.ler(cB, identificador))).toBe('etiqueta-desconhecida');
  });

  it('a baixa deixa a etiqueta consumida (sem apagar) e a leitura seguinte recusa; a devolvida volta a ativa', async () => {
    const r = await porta.baixar(
      c,
      { identificadores: [identificador.toLowerCase()], situacao: 'consumida', movimento: null },
      k(),
    );
    expect(r).toMatchObject({ id: etiquetaId, baixadas: 1 });
    expect(
      await um('SELECT situacao, versao, excluido_em FROM etiqueta_identificacao WHERE id = ?', [etiquetaId]),
      // versão 3: a reimpressão (via 2) somou as impressões antes da baixa.
    ).toMatchObject({ situacao: 'consumida', versao: 3, excluido_em: null });
    expect(await codigoDe(porta.ler(c, identificador))).toBe('etiqueta-inativa');
    expect(
      await codigoDe(
        porta.baixar(c, { identificadores: [identificador], situacao: 'consumida', movimento: null }, k()),
      ),
    ).toBe('etiqueta-inativa');
    expect(
      await codigoDe(
        porta.baixar(c, { identificadores: [identificador], situacao: 'reativar', movimento: null }, k()),
      ),
    ).toBe('etiqueta-nao-devolvida');
    const [, outra] = (
      await porta.emitir(
        c,
        {
          insumo: m.insumo,
          lote: m.lote,
          local: null,
          quantidade: 2,
          etiquetas: 2,
          tipo: 'caixa',
          notaEntradaItem: null,
        },
        k(),
      )
    ).etiquetas;
    await porta.baixar(
      c,
      { identificadores: [outra!.identificador], situacao: 'devolvida', movimento: null },
      k(),
    );
    await porta.baixar(
      c,
      { identificadores: [outra!.identificador], situacao: 'reativar', movimento: null },
      k(),
    );
    expect(await um('SELECT situacao FROM etiqueta_identificacao WHERE id = ?', [outra!.id])).toMatchObject({
      situacao: 'ativa',
    });
    expect(
      await codigoDe(
        porta.baixar(
          cB,
          { identificadores: [outra!.identificador], situacao: 'consumida', movimento: null },
          k(),
        ),
      ),
    ).toBe('etiqueta-desconhecida');
  });

  it('a saída do estoque consome a etiqueta lida na mesma transação, com o movimento; a de outro item desfaz tudo', async () => {
    const estoque = new PortaSuprimentosPropria(nucleo);
    const cs = c as unknown as ContextoSuprimentos;
    let n = 0;
    const saida = (etiquetas: string[]) =>
      estoque.executar(
        cs,
        'suprimentos.registrarSaida',
        {
          destino: 2,
          local: m.localA,
          centroCusto: m.centroCusto,
          localConsumo: 1,
          itens: [
            {
              item: m.insumo,
              quantidade: 1,
              lotes: [{ lote: `${m.marca}L1`, validade: '2027-03-31', quantidade: 1 }],
              etiquetas,
            },
          ],
        },
        { ...cs, chaveIdempotencia: `t-etq-saida-${Date.now().toString(36)}-${++n}` },
      );
    const saldo = async () =>
      Number(
        (
          await um('SELECT quantidade AS q FROM saldo_estoque WHERE local_estoque_id = ? AND insumo_id = ?', [
            m.localA,
            m.insumo,
          ])
        )?.['q'],
      );
    const [a] = (
      await porta.emitir(
        c,
        {
          insumo: m.insumo,
          lote: m.lote,
          local: m.localA,
          quantidade: 1,
          etiquetas: 1,
          tipo: 'unidade',
          notaEntradaItem: null,
        },
        k(),
      )
    ).etiquetas;
    // A etiqueta de outro item (o OPME): a saída inteira é desfeita e a etiqueta lida continua ativa.
    const [deOutro] = (
      await porta.emitir(
        c,
        {
          insumo: m.insumoOpme,
          lote: null,
          local: null,
          quantidade: 1,
          etiquetas: 1,
          tipo: 'unidade',
          notaEntradaItem: null,
        },
        k(),
      )
    ).etiquetas;
    expect(deOutro).toBeDefined();
    const antes = await saldo();
    {
      expect(await codigoDe(saida([a!.identificador, deOutro.identificador]))).toBe('etiqueta-de-outro-item');
      expect(await saldo()).toBe(antes);
      expect(await um('SELECT situacao FROM etiqueta_identificacao WHERE id = ?', [a!.id])).toMatchObject({
        situacao: 'ativa',
      });
    }
    expect(await codigoDe(saida(['EX0000000000']))).toBe('etiqueta-desconhecida');
    expect(await saldo()).toBe(antes);
    const r = await saida([a!.identificador.toLowerCase()]);
    expect(r.resultado['etiquetas']).toBe(1);
    expect(await saldo()).toBe(antes - 1);
    const e = await um(
      `SELECT e.situacao, e.movimento_consumo_id AS mov, mv.insumo_id AS ins, e.excluido_em
         FROM etiqueta_identificacao e JOIN movimento_estoque mv ON mv.id = e.movimento_consumo_id WHERE e.id = ?`,
      [a!.id],
    );
    expect(e).toMatchObject({ situacao: 'consumida', ins: m.insumo, excluido_em: null });
    // A mesma etiqueta não sai de novo.
    expect(await codigoDe(saida([a!.identificador]))).toBe('etiqueta-inativa');
    expect(await saldo()).toBe(antes - 1);
  });
});
