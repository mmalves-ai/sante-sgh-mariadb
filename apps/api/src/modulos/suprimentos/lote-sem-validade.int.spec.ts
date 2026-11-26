// Lote migrado sem validade e requisição de setor migrada sem centro de custo (recusas da carga, fase 2) na porta
// própria contra o MariaDB real (cliente de teste do lote, SGH_CLIENTE_TESTE; massa SINTÉTICA). O lote com
// origem 'migracao' e validade nula aparece no saldo com o alerta `sem-validade`, por último no FEFO; a saída que
// precisaria dele no uso é recusada com "lote sem validade" (nunca "vencido" nem "sem saldo"), inclusive a saída a
// terceiro (doação, venda, empréstimo); a transferência direta e a em dois passos (envio e recebimento) o usam (D1);
// informar a validade continua permitido e não inventa validade original. A requisição
// migrada sem centro de custo é listada com centroCusto null.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import type { ContextoPortaM18, TrilhaDaGravacao } from '../exames/public-api.js';
import { PortaEtiquetaIdentificacaoPropria } from './etiqueta-identificacao.js';
import type { ContextoSuprimentos } from './porta.js';
import { PortaSuprimentosPropria } from './porta-propria.js';

const RODADA = Date.now().toString(36);
let k = 0;

describe.skipIf(SEM_BANCO)('lote sem validade e requisição sem setor migrados (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSuprimentosPropria;
  let m: MassaSuprimentos;
  let c: ContextoSuprimentos;
  let hoje: string;
  let loteSem = 0;
  let loteCom = 0;
  let requisicao = 0;
  let terceiro = 0;
  let empresaDescarte = 0;
  const ctxE = { cliente: CLIENTE, correlacao: 't-recusas-lote' };
  const ler = <T extends Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-recusas-lote' }, (l) => l.consultar<T>(sql, p));
  const op = (nome: string, entrada: unknown) =>
    porta.executar(c, `suprimentos.${nome}`, entrada, { ...c, chaveIdempotencia: `rlsv-${RODADA}-${++k}` });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassa(nucleo);
    porta = new PortaSuprimentosPropria(nucleo);
    c = { ...contexto(m, m.estA, 'recusas-lote') } as ContextoSuprimentos;
    hoje = (await porta.relogio(c)).hoje;
    await nucleo.escrever(ctxE, async (e) => {
      const lote = (numero: string, validade: string | null, origem: string) =>
        inserirMinimo(
          e,
          'lote_insumo',
          {
            estabelecimento_id: m.estA,
            insumo_id: m.insumo,
            numero_lote: numero,
            validade,
            situacao: 'liberado',
            origem,
          },
          m.marca,
        );
      loteSem = await lote(`${m.marca}SV`, null, 'migracao');
      loteCom = await lote(`${m.marca}CV`, '2027-06-30', 'sistema');
      for (const [id, q] of [
        [loteSem, 3],
        [loteCom, 1],
      ] as const)
        await inserirMinimo(
          e,
          'saldo_lote',
          {
            estabelecimento_id: m.estA,
            local_estoque_id: m.localA2,
            lote_insumo_id: id,
            quantidade: q,
            competencia: '2026-11-01',
          },
          m.marca,
        );
      // O carrinho da massa leva o lote migrado sem validade no seu item.
      await inserirMinimo(
        e,
        'kit_rastreavel_lote',
        { kit_rastreavel_item_id: m.kitItem, sequencia: 1, lote_insumo_id: loteSem, quantidade: 1 },
        m.marca,
      );
      requisicao = await inserirMinimo(
        e,
        'requisicao_material',
        {
          estabelecimento_id: m.estA,
          numero: 900_000_000 + Math.floor(Math.random() * 99_999_999),
          tipo: 'setor',
          atendente_local_estoque_id: m.localA2,
          solicitante_usuario_id: m.usuario,
          solicitado_em: new Date(),
          origem: 'migracao',
        },
        m.marca,
      );
    });
  }, 120_000);

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever(ctxE, async (e) => {
        await e.executar('DELETE FROM requisicao_material WHERE id = ?', [requisicao]);
        await e.executar('DELETE FROM terceiro_destinatario WHERE id = ?', [terceiro]);
        await e.executar('DELETE FROM pessoa_juridica WHERE id = ?', [empresaDescarte]);
      });
      await limparMassa(nucleo, m);
      await nucleo.encerrar();
    }
  });

  it('saldo: o lote sem validade aparece por último, com o alerta sem-validade', async () => {
    const lotes = await porta.lotesDoLocal(c, m.insumo, m.localA2, hoje, 30);
    expect(lotes.map((x) => x.id)).toEqual([loteCom, loteSem]);
    expect(lotes[1]).toEqual({
      id: loteSem,
      lote: `${m.marca}SV`,
      validade: '',
      quantidade: 3,
      diasParaVencer: null,
      alerta: 'sem-validade',
    });
  });

  it('carrinho: o lote sem validade aparece com o lote e a conferência não o dá como conforme', async () => {
    const kit = await porta.kit(c, m.kit, hoje, 30);
    expect(kit?.itens.find((x) => x.id === m.kitItem)).toMatchObject({
      lote: `${m.marca}SV`,
      validade: null,
    });
    const trilha = {
      estabelecimento: m.estA,
      usuario: m.usuario,
      acao: 'operacao',
      entidade: 'kit_rastreavel',
      entidadeId: null,
      dadosDepois: { evento: 'suprimentos.carrinho.conferido' },
      correlacao: null,
    } as TrilhaDaGravacao;
    const id = await porta.gravarSgh(c, trilha, (g) =>
      g.conferirCarrinho({
        kit: m.kit,
        lacre: 'L-SV',
        conferidos: [m.kitItem],
        pendencias: null,
        usuario: 'x',
      }),
    );
    const [r] = await ler<{ v: unknown; res: unknown; p: unknown }>(
      'SELECT validades_conformes AS v, resultado AS res, pendencias AS p FROM conferencia_kit_rastreavel WHERE id = ?',
      [id],
    );
    expect(Number(r?.v)).toBe(0);
    expect(r?.res).toBe('com_pendencia');
    expect(String(r?.p)).toMatch(/sem validade \(não informada na origem\)/);
  });

  it('etiqueta: o lote sem validade não recebe etiqueta de identificação', async () => {
    const etq = new PortaEtiquetaIdentificacaoPropria(nucleo);
    const ce = contexto(m, m.estA, 'recusas-lote-etq') as ContextoPortaM18;
    expect(
      await codigoDe(
        etq.emitir(
          ce,
          {
            insumo: m.insumo,
            lote: loteSem,
            local: null,
            quantidade: 1,
            etiquetas: 1,
            tipo: 'unidade',
            notaEntradaItem: null,
          },
          `rlsv-etq-${RODADA}`,
        ),
      ),
    ).toBe('lote-sem-validade');
    const [q] = await ler<{ n: unknown }>(
      'SELECT COUNT(*) AS n FROM etiqueta_identificacao WHERE lote_insumo_id = ?',
      [loteSem],
    );
    expect(Number(q?.n)).toBe(0);
  });

  it('uso: a saída que precisaria do lote sem validade é recusada com "lote sem validade", nada gravado', async () => {
    expect(
      await codigoDe(
        op('registrarSaida', {
          destino: 2,
          local: m.localA2,
          centroCusto: m.centroCusto,
          localConsumo: 1,
          itens: [{ item: m.insumo, quantidade: 2 }],
        }),
      ),
    ).toBe('lote-sem-validade');
    const [s] = await ler<{ q: unknown }>(
      'SELECT quantidade AS q FROM saldo_lote WHERE lote_insumo_id = ? AND local_estoque_id = ?',
      [loteSem, m.localA2],
    );
    expect(Number(s?.q)).toBe(3);
  });

  it('informar a validade do lote migrado: grava a validade e não inventa validade original', async () => {
    await op('corrigirValidadeLote', {
      lote: loteSem,
      validade: '2027-05-31',
      motivo: 'Validade da embalagem',
    });
    const [l] = await ler<{ validade: unknown; validade_original: unknown }>(
      'SELECT validade, validade_original FROM lote_insumo WHERE id = ?',
      [loteSem],
    );
    expect(l?.validade).not.toBeNull();
    expect(l?.validade_original).toBeNull();
    expect((await porta.lotesDoLocal(c, m.insumo, m.localA2, hoje, 30))[1]?.alerta).toBe('nenhum');
  });

  it('requisição de setor migrada sem centro de custo: listada com centroCusto null', async () => {
    const r = (await porta.requisicoes(c, { local: m.localA2, hoje })).itens.find((x) => x.id === requisicao);
    expect(r).toMatchObject({ centroCusto: null, centroCustoNome: '' });
  });

  // D1: a transferência entre locais usa o lote sem validade (último no FEFO); a saída para uso, mesmo a terceiro, não.
  const saldoDoLote = async (lote: number, local: number): Promise<number> => {
    const [s] = await ler<{ q: unknown }>(
      'SELECT quantidade AS q FROM saldo_lote WHERE lote_insumo_id = ? AND local_estoque_id = ? AND excluido_em IS NULL',
      [lote, local],
    );
    return Number(s?.q ?? 0);
  };

  it('saída a terceiro (doação, venda ou empréstimo): recusada com "lote sem validade", nada gravado', async () => {
    // O teste anterior informou a validade: o lote volta a ser o migrado sem validade.
    await nucleo.escrever(ctxE, async (e) => {
      await e.executar('UPDATE lote_insumo SET validade = NULL WHERE id = ?', [loteSem]);
      empresaDescarte = await inserirMinimo(
        e,
        'pessoa_juridica',
        { estrangeira: true, razao_social: `${m.marca} DOACAO SINTETICA` },
        m.marca,
      );
      terceiro = await inserirMinimo(
        e,
        'terceiro_destinatario',
        {
          estabelecimento_id: m.estA,
          tipo_pessoa: 'juridica',
          pessoa_juridica_id: empresaDescarte,
          nome: `${m.marca} doacao`,
          recebe_doacao: true,
          ativo: true,
        },
        m.marca,
      );
    });
    const antesCom = await saldoDoLote(loteCom, m.localA2);
    const antesSem = await saldoDoLote(loteSem, m.localA2);
    expect(
      await codigoDe(
        op('registrarSaida', {
          destino: 5,
          terceiro,
          local: m.localA2,
          centroCusto: m.centroCusto,
          localConsumo: 1,
          itens: [{ item: m.insumo, quantidade: antesCom + 1 }],
        }),
      ),
    ).toBe('lote-sem-validade');
    expect(await saldoDoLote(loteCom, m.localA2)).toBe(antesCom);
    expect(await saldoDoLote(loteSem, m.localA2)).toBe(antesSem);
  });

  it('transferência entre locais: usa o lote com validade primeiro e completa com o lote sem validade, que chega sem validade', async () => {
    const antesCom = await saldoDoLote(loteCom, m.localA2);
    const antesSem = await saldoDoLote(loteSem, m.localA2);
    const antesDestino = await saldoDoLote(loteSem, m.localA);
    await op('transferir', {
      origem: m.localA2,
      destino: m.localA,
      itens: [{ item: m.insumo, quantidade: antesCom + 1, lotes: [] }],
    });
    expect(await saldoDoLote(loteCom, m.localA2)).toBe(0);
    expect(await saldoDoLote(loteSem, m.localA2)).toBe(antesSem - 1);
    expect(await saldoDoLote(loteSem, m.localA)).toBe(antesDestino + 1);
    const [l] = await ler<{ validade: unknown }>('SELECT validade FROM lote_insumo WHERE id = ?', [loteSem]);
    expect(l?.validade).toBeNull();
  });

  it('transferência em dois passos: o envio reserva o lote sem validade e o recebimento o leva ao destino', async () => {
    const antesSem = await saldoDoLote(loteSem, m.localA2);
    const antesDestino = await saldoDoLote(loteSem, m.localA);
    const trilha = {
      estabelecimento: m.estA,
      usuario: m.usuario,
      acao: 'operacao',
      entidade: 'documento_estoque',
      entidadeId: null,
      dadosDepois: { evento: 'suprimentos.transferencia.enviada' },
      correlacao: null,
    } as TrilhaDaGravacao;
    const envio = await porta.gravarSgh(c, trilha, (g) =>
      g.enviarTransferencia({
        origem: m.localA2,
        destino: m.localA,
        observacao: null,
        itens: [{ item: m.insumo, quantidade: 1, lotes: [] }],
        usuario: 'x',
      }),
    );
    const [it] = await ler<{ lote: unknown; validade: unknown }>(
      'SELECT lote_insumo_id AS lote, data_validade AS validade FROM documento_estoque_item WHERE documento_estoque_id = ? AND excluido_em IS NULL',
      [envio],
    );
    expect(Number(it?.lote)).toBe(loteSem);
    expect(it?.validade).toBeNull();
    expect(await saldoDoLote(loteSem, m.localA2)).toBe(antesSem);
    await op('transferir', {
      origem: m.localA2,
      destino: m.localA,
      envio,
      itens: [{ item: m.insumo, quantidade: 1 }],
    });
    expect(await saldoDoLote(loteSem, m.localA2)).toBe(antesSem - 1);
    expect(await saldoDoLote(loteSem, m.localA)).toBe(antesDestino + 1);
    expect((await porta.envio(c, envio))?.etapa).not.toBe('enviada');
  });

  it('uso em setor assistencial continua recusado com o lote sem validade, depois das transferências', async () => {
    expect(
      await codigoDe(
        op('registrarSaida', {
          destino: 2,
          local: m.localA2,
          centroCusto: m.centroCusto,
          localConsumo: 1,
          itens: [{ item: m.insumo, quantidade: 1 }],
        }),
      ),
    ).toBe('lote-sem-validade');
  });
});
