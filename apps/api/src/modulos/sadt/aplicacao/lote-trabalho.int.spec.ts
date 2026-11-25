// Lote de trabalho da bancada no MariaDB real (cliente f22_o2; massa SINTÉTICA), F3.5, 05-SADT linha 8. Contrato de
// efeito do lote materializado: abrir grava o lote da bancada (número da sequência de negócio, setor, modelo de mapa,
// analista, dia de trabalho) com os exames em análise fora de lote, os urgentes primeiro, até o limite do modelo,
// cada um com a sequência e a posição no suporte, e a trilha; o exame que já está num lote em andamento não entra em
// outro; o retido não entra em lote e a retenção de um exame do lote fica no próprio lote; a bancada de outro
// estabelecimento é recusada; fechar marca o processado, devolve o pendente à fila (ele entra no lote seguinte) e não
// apaga nada; o lote fechado não fecha de novo; imprimir grava a hora da impressão com a trilha. O mapa de trabalho e
// o lote leem a MESMA fila: os exames da massa foram pedidos três dias antes (não são do dia), aparecem no mapa da
// bancada pela leitura da rota (do começo da fila até hoje), a contagem fora de lote que a tela recebe é a do mapa
// menos os que já estão em lote, e é exatamente o que a abertura leva.
import { INICIO_DA_FILA_DA_BANCADA } from '@sgh/dominio-sadt';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';
import { ServicoLoteTrabalho } from './lote-trabalho-propria.js';
import { ServicoMapaTrabalho } from './mapa-trabalho-propria.js';
import { PortaSadtPropria } from '../porta-propria.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const dia = () => new Date().toISOString().slice(0, 10);

describe.skipIf(SEM_BANCO)('lote de trabalho da bancada: abrir, fechar e imprimir (MariaDB, f22_o2)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoLoteTrabalho;
  let mapa: ServicoMapaTrabalho;
  let m: MassaSadt | null = null;
  const bancadas: number[] = [];
  const modelos: number[] = [];
  let bA = 0; // bancada do setor do laboratório da massa, limite de 2 exames por lote
  let bOutro = 0; // bancada de OUTRO estabelecimento
  let itemU = 0; // urgente, pedido por último
  let itemR = 0; // de rotina
  let itemT = 0; // de rotina, retido antes de abrir o lote
  const C = { cliente: CLIENTE, correlacao: 't-s35lot' };
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente(C, (l) => l.uma(sql, p));
  const varias = (sql: string, p: unknown[]) => nucleo.lerSomente(C, (l) => l.consultar(sql, p));
  const trilhas = async (lote: number) =>
    Number(
      (
        await um(
          "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'grupo_trabalho_bancada' AND entidade_id = ?",
          [lote],
        )
      )?.['n'],
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S5L');
    servico = new ServicoLoteTrabalho(nucleo);
    mapa = new ServicoMapaTrabalho(nucleo);
    const mm = m;
    await nucleo.escrever(C, async (e) => {
      const agora = new Date();
      const bancada = async (setor: number, cod: string, limite: number | null) => {
        const b = await e.inserir(
          'INSERT INTO bancada_analitica (codigo, descricao, setor_diagnostico_id, criado_em) VALUES (?, ?, ?, ?)',
          [`${cod}${mm.marca}`.slice(0, 30), `Bancada ${cod} ${mm.marca}`, setor, agora],
        );
        const mo = await e.inserir(
          `INSERT INTO modelo_mapa_bancada (sigla, descricao, setor_diagnostico_id, bancada_analitica_id, limite_exames, criado_em)
           VALUES (?, 'Modelo de teste', ?, ?, ?, ?)`,
          [`${cod}${mm.marca}`.slice(0, 40), setor, b, limite, agora],
        );
        await e.inserir(
          'INSERT INTO modelo_mapa_bancada_exame (modelo_mapa_bancada_id, sequencia, exame_id, criado_em) VALUES (?, 1, ?, ?)',
          [mo, mm.exameLab, agora],
        );
        bancadas.push(b);
        modelos.push(mo);
        return b;
      };
      const setorOutro = await e.inserir(
        `INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em, versao)
         VALUES (?, ?, 'SETOR O SINTETICO', 'laboratorio', ?, 1)`,
        [mm.base.outroEst, `${mm.marca}O`, agora],
      );
      bOutro = await bancada(setorOutro, 'O', 50);
      bA = await bancada(mm.setorLab, 'A', 2);
      const extra = (seq: number, urgente: boolean) =>
        e.inserir(
          `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, material_biologico_id, situacao, urgente,
             criado_em, versao)
           SELECT requisicao_exame_id, ?, exame_id, material_biologico_id, 'em_analise', ?, ?, 1 FROM exame_item WHERE id = ?`,
          [seq, urgente, agora, mm.itemLab],
        );
      itemR = await extra(7, false);
      itemT = await extra(8, false);
      itemU = await extra(9, true);
      // Só os exames deste teste ficam em análise no setor da massa: a requisição de rotina e um exame urgente.
      // Pedidos três dias antes: a fila da bancada não depende do dia do pedido.
      await e.executar("UPDATE requisicao_exame SET prioridade = 'rotina', solicitado_em = ? WHERE id = ?", [
        new Date(agora.getTime() - 3 * 86_400_000),
        mm.requisicao,
      ]);
      await e.executar("UPDATE exame_item SET situacao = 'em_analise', urgente = FALSE WHERE id = ?", [
        mm.itemLab,
      ]);
    });
  }, 60_000);

  afterAll(async () => {
    if (m && bancadas.length)
      await nucleo.escrever(C, async (e) => {
        const q = bancadas.map(() => '?').join(', ');
        await e.executar(
          `DELETE gi FROM grupo_trabalho_bancada_item gi JOIN grupo_trabalho_bancada g ON g.id = gi.grupo_trabalho_bancada_id
            WHERE g.bancada_analitica_id IN (${q})`,
          bancadas,
        );
        await e.executar(`DELETE FROM grupo_trabalho_bancada WHERE bancada_analitica_id IN (${q})`, bancadas);
        const qm = modelos.map(() => '?').join(', ');
        await e.executar(
          `DELETE FROM modelo_mapa_bancada_exame WHERE modelo_mapa_bancada_id IN (${qm})`,
          modelos,
        );
        await e.executar(`DELETE FROM modelo_mapa_bancada WHERE id IN (${qm})`, modelos);
        await e.executar(`DELETE FROM bancada_analitica WHERE id IN (${q})`, bancadas);
      });
    if (m) await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  });

  it('abre o lote com urgentes primeiro, até o limite, com sequência, posição, analista e trilha', async () => {
    const c = contexto(m!);
    // Recusas: entrada inválida, bancada de outro estabelecimento, analista que não existe.
    expect(codigoDe(await servico.abrir(c, { bancada: 0 }).catch((e: unknown) => e))).toMatch(
      /entrada|too_small|Number|ZodError/i,
    );
    expect(codigoDe(await servico.abrir(c, { bancada: bOutro }).catch((e: unknown) => e))).toBe(
      'bancada-inexistente',
    );
    expect(
      codigoDe(await servico.abrir(c, { bancada: bA, analista: 4_000_000_000 }).catch((e: unknown) => e)),
    ).toBe('analista-inexistente');
    expect(
      Number(
        (await um('SELECT COUNT(*) AS n FROM grupo_trabalho_bancada WHERE bancada_analitica_id = ?', [bA]))?.[
          'n'
        ],
      ),
    ).toBe(0);

    // Mapa x lote: os exames em análise pedidos em dia anterior estão no mapa da bancada (a leitura da rota, do
    // começo da fila até hoje) e na fila fora de lote; a leitura só do dia de hoje não os traria.
    const porta = new PortaSadtPropria(nucleo);
    const hoje = (await porta.relogio(c)).hoje;
    const noMapa = async (inicio: string) => {
      const r = await porta.mapa(c, { setor: 'laboratorio', inicio, fim: hoje });
      const b = r.bancadas.find((x) => x.codigo === bA);
      return (b?.exames ?? []).map((x) => x.id).sort((x, y) => x - y);
    };
    const fila = async (ctx = c) => (await servico.fila(ctx)).find((f) => f.bancada === bA)?.foraDeLote ?? 0;
    const quatro = [m!.itemLab, itemR, itemT, itemU].sort((x, y) => x - y);
    expect(await noMapa(hoje)).toEqual([]);
    expect(await noMapa(INICIO_DA_FILA_DA_BANCADA)).toEqual(quatro);
    expect(await fila()).toBe(4);
    expect(await fila(contexto(m!, m!.base.outroEst))).toBe(0);

    // O retido antes da abertura não entra em lote de exames a processar.
    const ret = await mapa.reter(c, { exame: itemT, motivo: 'Aguardando reagente' });
    const tres = quatro.filter((x) => x !== itemT);
    expect(await noMapa(INICIO_DA_FILA_DA_BANCADA)).toEqual(tres);
    expect(await fila()).toBe(3);

    const l1 = await servico.abrir(c, { bancada: bA });
    expect(l1.numero).toMatch(/^LT-\d+$/);
    expect(l1).toMatchObject({ bancada: bA, situacao: 'aberto', data: expect.any(String), fechadoEm: null });
    expect(l1.analista).toBe(c.usuario);
    // Limite 2: o urgente (pedido por último) na frente, depois o primeiro de rotina na ordem de chegada.
    expect(l1.itens.map((i) => [i.exame, i.sequencia, i.posicaoSuporte, i.situacao])).toEqual([
      [itemU, 1, '001', 'pendente'],
      [m!.itemLab, 2, '002', 'pendente'],
    ]);
    expect(l1.itens[0]!.urgente).toBe(true);
    const g = await um(
      `SELECT estabelecimento_id, setor_diagnostico_id, bancada_analitica_id, modelo_mapa_bancada_id, analista_usuario_id,
              aberto_por_usuario_id, situacao, fechado_em, impresso_em, DATE_FORMAT(data_trabalho, '%Y-%m-%d') AS data
         FROM grupo_trabalho_bancada WHERE id = ?`,
      [l1.id],
    );
    expect(g).toMatchObject({ situacao: 'aberto', fechado_em: null, impresso_em: null, data: l1.data });
    expect(Number(g!['estabelecimento_id'])).toBe(m!.base.est);
    expect(Number(g!['setor_diagnostico_id'])).toBe(m!.setorLab);
    expect(Number(g!['modelo_mapa_bancada_id'])).toBe(modelos[bancadas.indexOf(bA)]);
    expect(Number(g!['analista_usuario_id'])).toBe(c.usuario);
    expect(Number(g!['aberto_por_usuario_id'])).toBe(c.usuario);
    expect(Math.abs(Date.parse(l1.data) - Date.parse(dia()))).toBeLessThanOrEqual(86_400_000);
    expect(await trilhas(l1.id)).toBeGreaterThanOrEqual(1);
    // O lote levou os dois primeiros do mapa; sobra um fora de lote. O mapa continua mostrando os três (os do lote
    // seguem em análise) e a lista de lotes diz em que lote cada um está.
    expect(await fila()).toBe(1);
    expect(await noMapa(INICIO_DA_FILA_DA_BANCADA)).toEqual(tres);

    // O segundo lote leva só o que sobrou (o de rotina fora do limite); o retido e os do lote 1 não entram.
    const l2 = await servico.abrir(c, { bancada: bA });
    expect(l2.id).not.toBe(l1.id);
    expect(l2.numero).not.toBe(l1.numero);
    expect(l2.itens.map((i) => [i.exame, i.sequencia])).toEqual([[itemR, 1]]);
    // Fila zerada no servidor: a tela desabilita o botão; a abertura forçada é recusada.
    expect(await fila()).toBe(0);
    expect(codigoDe(await servico.abrir(c, { bancada: bA }).catch((e: unknown) => e))).toBe('sem-exames');
    const emLote = (await servico.listar(c, l1.data))
      .filter((x) => x.bancada === bA && x.situacao === 'aberto')
      .flatMap((x) => x.itens.filter((i) => i.situacao === 'pendente').map((i) => i.exame))
      .sort((x, y) => x - y);
    expect(emLote).toEqual(tres);

    // A retenção de um exame que está no lote fica no PRÓPRIO lote (o exame não se duplica em outro lote).
    const r = await mapa.reter(c, { exame: itemR, motivo: 'Amostra hemolisada' });
    expect(r.lote).toBe(l2.numero);
    expect(
      Number(
        (
          await um(
            `SELECT COUNT(*) AS n FROM grupo_trabalho_bancada_item WHERE exame_item_id = ? AND excluido_em IS NULL`,
            [itemR],
          )
        )?.['n'],
      ),
    ).toBe(1);
    await mapa.soltar(c, { exame: itemR });

    // A lista do dia traz os lotes da bancada (o da retenção inicial e os dois abertos), cada um com os seus exames.
    const lista = (await servico.listar(c, l1.data)).filter((x) => x.bancada === bA);
    expect(lista.map((x) => x.numero).sort()).toEqual([ret.lote, l1.numero, l2.numero].sort());
    expect(await servico.listar(contexto(m!, m!.base.outroEst), l1.data)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ bancada: bA })]),
    );

    // Imprimir grava a hora da impressão e a trilha; em outro estabelecimento o lote não existe.
    const antes = await trilhas(l1.id);
    const impresso = await servico.imprimir(c, { lote: l1.id });
    expect(impresso.impressoEm).not.toBeNull();
    expect(impresso.itens).toHaveLength(2);
    expect(
      (await um('SELECT impresso_em FROM grupo_trabalho_bancada WHERE id = ?', [l1.id]))?.['impresso_em'],
    ).not.toBeNull();
    expect(await trilhas(l1.id)).toBeGreaterThan(antes);
    expect(
      codigoDe(
        await servico.imprimir(contexto(m!, m!.base.outroEst), { lote: l1.id }).catch((e: unknown) => e),
      ),
    ).toBe('lote-inexistente');
    expect(
      codigoDe(
        await servico.fechar(contexto(m!, m!.base.outroEst), { lote: l1.id }).catch((e: unknown) => e),
      ),
    ).toBe('lote-inexistente');

    // Fechar: o exame que saiu da análise (digitado) fica processado; o que continua em análise volta à fila.
    await nucleo.escrever(C, (e) =>
      e.executar("UPDATE exame_item SET situacao = 'resultado_digitado' WHERE id = ?", [itemU]),
    );
    const fechado = await servico.fechar(c, { lote: l1.id });
    expect(fechado).toMatchObject({ situacao: 'fechado' });
    expect(fechado.fechadoEm).not.toBeNull();
    const itens = await varias(
      'SELECT exame_item_id, situacao, processado_em, excluido_em FROM grupo_trabalho_bancada_item WHERE grupo_trabalho_bancada_id = ? ORDER BY sequencia',
      [l1.id],
    );
    expect(itens).toHaveLength(2);
    expect(itens[0]).toMatchObject({ situacao: 'processado', excluido_em: null });
    expect(itens[0]!['processado_em']).not.toBeNull();
    expect(itens[1]).toMatchObject({ situacao: 'pendente', processado_em: null, excluido_em: null });
    const gf = await um(
      'SELECT situacao, fechado_em, fechado_por_usuario_id FROM grupo_trabalho_bancada WHERE id = ?',
      [l1.id],
    );
    expect(gf).toMatchObject({ situacao: 'fechado' });
    expect(gf!['fechado_em']).not.toBeNull();
    expect(Number(gf!['fechado_por_usuario_id'])).toBe(c.usuario);
    expect(codigoDe(await servico.fechar(c, { lote: l1.id }).catch((e: unknown) => e))).toBe(
      'lote-encerrado',
    );
    // O lote fechado ainda imprime (segunda via); o pendente que voltou à fila entra no lote seguinte.
    expect((await servico.imprimir(c, { lote: l1.id })).situacao).toBe('fechado');
    const l3 = await servico.abrir(c, { bancada: bA });
    expect(l3.itens.map((i) => i.exame)).toEqual([m!.itemLab]);
    // O retido antes de tudo continua retido, no lote em que foi retido.
    expect(await um('SELECT situacao FROM grupo_trabalho_bancada_item WHERE id = ?', [ret.id])).toMatchObject(
      { situacao: 'retido' },
    );
  }, 120_000);
});
