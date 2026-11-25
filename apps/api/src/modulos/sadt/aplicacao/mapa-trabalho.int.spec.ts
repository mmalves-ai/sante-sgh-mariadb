// Mapa de trabalho da bancada no MariaDB real (cliente f22_o2; massa SINTÉTICA), F3.5, 05-SADT linha 8. Contrato de
// efeito pelo caminho real (PortaSadtPropria.mapa, a mesma leitura da rota GET /api/sadt/mapa-trabalho, conferida
// pelo esquema do contrato): cada exame pedido vai para a bancada do modelo de mapa do SEU setor (dois setores, duas
// bancadas para o mesmo exame), o modelo mais antigo do setor vence, o modelo de outro estabelecimento nunca entra
// (nem no mapa, nem na retenção), o exame sem modelo fica em "Sem bancada", os lotes seguem o limite do modelo; reter
// grava o lote aberto do dia da bancada escolhida e o item "retido" com o motivo e a trilha; o retido sai da fila e da
// contagem; soltar devolve a "pendente" sem apagar nada, inclusive depois de o exame ser cancelado.
import { esquemaMapaTrabalho } from '@sgh/contratos';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaSadtPropria } from '../porta-propria.js';
import { ServicoMapaTrabalho } from './mapa-trabalho-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const dia = (deslocamento: number) =>
  new Date(Date.now() + deslocamento * 86_400_000).toISOString().slice(0, 10);

describe.skipIf(SEM_BANCO)('mapa de trabalho: bancada do exame e retenção (MariaDB, cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let servico: ServicoMapaTrabalho;
  let porta: PortaSadtPropria;
  let m: MassaSadt | null = null;
  const bancadas: number[] = [];
  const modelos: number[] = [];
  let bA = 0; // setor do laboratório da massa: modelo mais antigo, limite 1
  let bB = 0; // segundo setor de laboratório: o mesmo exame em outra bancada
  let bC = 0; // modelo mais novo do setor da massa (perde para o de A)
  let bOutro = 0; // modelo de OUTRO estabelecimento, criado antes de todos (menor id)
  let itemX = 0; // segundo exame do setor da massa (bancada A)
  let itemSem = 0; // exame de um setor sem modelo de mapa
  let motivoCanc = 0; // motivo de cancelamento sintético (o cancelamento exige data e motivo, pelo CHECK)
  const um = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-s35map' }, (l) => l.uma(sql, p));

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'S5M');
    servico = new ServicoMapaTrabalho(nucleo);
    porta = new PortaSadtPropria(nucleo);
    const mm = m;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35map' }, async (e) => {
      const agora = new Date();
      const setor = (est: number, cod: string) =>
        e.inserir(
          `INSERT INTO setor_diagnostico (estabelecimento_id, codigo, nome, tipo, criado_em, versao)
           VALUES (?, ?, ?, 'laboratorio', ?, 1)`,
          [est, `${mm.marca}${cod}`, `SETOR ${cod} SINTETICO`, agora],
        );
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
      const setorOutro = await setor(mm.base.outroEst, 'O');
      bOutro = await bancada(setorOutro, 'O', 50);
      bA = await bancada(mm.setorLab, 'A', 1);
      const setorB = await setor(mm.base.est, 'B');
      bB = await bancada(setorB, 'B', null);
      bC = await bancada(mm.setorLab, 'C', 5);
      const setorSem = await setor(mm.base.est, 'S');
      const extra = (seq: number, setorItem: number | null) =>
        e.inserir(
          `INSERT INTO exame_item (requisicao_exame_id, sequencia, exame_id, material_biologico_id, setor_diagnostico_id,
             situacao, criado_em, versao)
           SELECT requisicao_exame_id, ?, exame_id, material_biologico_id, ?, 'em_analise', ?, 1 FROM exame_item WHERE id = ?`,
          [seq, setorItem, agora, mm.itemLab],
        );
      itemX = await extra(8, null);
      itemSem = await extra(9, setorSem);
      await e.executar("UPDATE exame_item SET situacao = 'em_analise' WHERE id = ?", [mm.itemLab]);
      await e.executar(
        "UPDATE exame_item SET situacao = 'em_analise', setor_diagnostico_id = ? WHERE id = ?",
        [setorB, mm.itemLab2],
      );
    });
  }, 60_000);

  afterAll(async () => {
    // Só o que este teste criou: os lotes das suas bancadas, os modelos e as bancadas (os setores e os itens saem
    // com a massa).
    if (m && bancadas.length)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35map' }, async (e) => {
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
    await limparMassaSadt(nucleo, m);
    if (motivoCanc)
      await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35map' }, (e) =>
        e.executar('DELETE FROM motivo_cancelamento_item_exame WHERE id = ?', [motivoCanc]),
      );
    await nucleo.encerrar();
  });

  /** O mapa pela porta, conferido pelo esquema do contrato, só com os exames desta massa. */
  const lerMapa = async () => {
    const r = await porta.mapa(contexto(m!), { setor: 'laboratorio', inicio: dia(-1), fim: dia(1) });
    const v = esquemaMapaTrabalho.parse({ setor: 'laboratorio', ...r });
    const nossos = new Set([m!.itemLab, m!.itemLab2, itemX, itemSem]);
    return v.bancadas
      .map((b) => ({
        ...b,
        exames: b.exames.filter((e) => nossos.has(e.id)).map((e) => e.id),
        retidos: (b.retidos ?? [])
          .filter((e) => nossos.has(e.id))
          .map((e) => ({ id: e.id, motivo: e.motivo })),
      }))
      .filter((b) => b.exames.length || b.retidos.length);
  };

  it('distribui pelo setor do exame, isola o estabelecimento, conta os lotes e mostra "Sem bancada"', async () => {
    const mapa = await lerMapa();
    const porCodigo = new Map(mapa.map((b) => [b.codigo, b]));
    expect(porCodigo.has(bOutro)).toBe(false);
    expect(porCodigo.has(bC)).toBe(false);
    expect(porCodigo.get(bA)).toMatchObject({ limite: 1, lotes: 2, retidos: [] });
    expect(porCodigo.get(bA)!.exames.sort()).toEqual([m!.itemLab, itemX].sort());
    expect(porCodigo.get(bB)).toMatchObject({ limite: null, lotes: 1, exames: [m!.itemLab2] });
    expect(porCodigo.get(null)).toMatchObject({ nome: 'Sem bancada', exames: [itemSem] });
    expect(mapa[mapa.length - 1]!.codigo).toBeNull();
  });

  it('retém no lote do dia da bancada escolhida, tira o retido da fila e devolve à fila sem apagar', async () => {
    const c = contexto(m!);
    expect(
      codigoDe(await servico.reter(c, { exame: m!.itemLab, motivo: 'abc' }).catch((e: unknown) => e)),
    ).toMatch(/entrada|motivo|too_small|String/i);
    expect(
      codigoDe(
        await servico
          .reter(contexto(m!, m!.base.outroEst), { exame: m!.itemLab, motivo: 'Controle fora' })
          .catch((e: unknown) => e),
      ),
    ).toBe('exame-inexistente');
    expect(codigoDe(await servico.soltar(c, { exame: m!.itemLab }).catch((e: unknown) => e))).toBe(
      'nao-retido',
    );
    expect(
      codigoDe(await servico.reter(c, { exame: itemSem, motivo: 'Controle fora' }).catch((e: unknown) => e)),
    ).toBe('sem-bancada');
    expect(
      codigoDe(
        await servico.reter(c, { exame: m!.itemLiberado, motivo: 'Controle fora' }).catch((e: unknown) => e),
      ),
    ).toBe('exame-fechado');

    const r = await servico.reter(c, { exame: m!.itemLab, motivo: 'Controle de qualidade fora' });
    expect(r).toMatchObject({ exame: m!.itemLab, situacao: 'retido' });
    expect(r.lote).toMatch(/^LT-\d+$/);
    const lote = await um(
      `SELECT g.numero, g.situacao, g.estabelecimento_id, g.bancada_analitica_id, g.modelo_mapa_bancada_id, g.setor_diagnostico_id
         FROM grupo_trabalho_bancada g JOIN grupo_trabalho_bancada_item gi ON gi.grupo_trabalho_bancada_id = g.id WHERE gi.id = ?`,
      [r.id],
    );
    expect(lote).toMatchObject({ numero: r.lote, situacao: 'aberto' });
    expect(Number(lote!['estabelecimento_id'])).toBe(m!.base.est);
    expect(Number(lote!['bancada_analitica_id'])).toBe(bA);
    expect(Number(lote!['modelo_mapa_bancada_id'])).toBe(modelos[bancadas.indexOf(bA)]);
    expect(Number(lote!['setor_diagnostico_id'])).toBe(m!.setorLab);
    expect(
      await um('SELECT situacao, motivo FROM grupo_trabalho_bancada_item WHERE id = ?', [r.id]),
    ).toMatchObject({ situacao: 'retido', motivo: 'Controle de qualidade fora' });
    expect(
      Number(
        (
          await um(
            "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'grupo_trabalho_bancada_item' AND entidade_id = ?",
            [r.id],
          )
        )?.['n'],
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      codigoDe(
        await servico.reter(c, { exame: m!.itemLab, motivo: 'Outra vez retido' }).catch((e: unknown) => e),
      ),
    ).toBe('ja-retido');

    let a = (await lerMapa()).find((b) => b.codigo === bA)!;
    expect(a).toMatchObject({
      lotes: 1,
      exames: [itemX],
      retidos: [{ id: m!.itemLab, motivo: 'Controle de qualidade fora' }],
    });

    const s = await servico.soltar(c, { exame: m!.itemLab });
    expect(s).toMatchObject({ id: r.id, situacao: 'pendente', lote: r.lote });
    expect(
      await um('SELECT situacao, motivo, versao FROM grupo_trabalho_bancada_item WHERE id = ?', [r.id]),
    ).toMatchObject({ situacao: 'pendente', motivo: 'Controle de qualidade fora', versao: 2 });
    a = (await lerMapa()).find((b) => b.codigo === bA)!;
    expect(a).toMatchObject({ lotes: 2, retidos: [] });

    // Reter de novo reaproveita o item do mesmo lote; o segundo exame entra no mesmo lote, na sequência seguinte.
    const r2 = await servico.reter(c, { exame: m!.itemLab, motivo: 'Reagente vencido' });
    expect(r2).toMatchObject({ id: r.id, lote: r.lote, situacao: 'retido' });
    const rx = await servico.reter(c, { exame: itemX, motivo: 'Amostra lipêmica' });
    expect(rx.lote).toBe(r.lote);
    expect(
      Number(
        (
          await um(
            `SELECT COUNT(*) AS n FROM grupo_trabalho_bancada WHERE bancada_analitica_id IN (${bancadas.map(() => '?').join(', ')})`,
            bancadas,
          )
        )?.['n'],
      ),
    ).toBe(1);

    // O exame cancelado com a retenção aberta: soltar fecha a retenção (nada fica retido para sempre).
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-s35map' }, async (e) => {
      const agora = new Date();
      motivoCanc = await e.inserir(
        `INSERT INTO motivo_cancelamento_item_exame (codigo, descricao, criado_em) VALUES (?, 'Cancelamento sintetico', ?)`,
        [`${m!.marca}CM`.slice(0, 30), agora],
      );
      await e.executar(
        "UPDATE exame_item SET situacao = 'cancelado', cancelado_em = ?, motivo_cancelamento_item_exame_id = ? WHERE id = ?",
        [agora, motivoCanc, itemX],
      );
    });
    expect(await servico.soltar(c, { exame: itemX })).toMatchObject({ id: rx.id, situacao: 'pendente' });
  });
});
