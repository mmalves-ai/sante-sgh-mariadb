// Contrato de efeito do posto de coleta, da etiqueta da recoleta e da alíquota e de quem cancelou a recoleta (F3.5,
// 05-SADT linha 7) no MariaDB real (cliente de teste; massa SINTÉTICA). Prova o que fica no banco: o posto incluído,
// alterado (versão nova) e inativado sem ser apagado, com a trilha; a etiqueta da alíquota e a da recoleta na fila da
// estação (uma por amostra, com a marca do tipo), a impressão gravada na amostra e na passagem dela, a via seguinte só
// na reimpressão pedida e nenhuma etiqueta de amostra rejeitada; a recoleta coletada no posto escolhido (posto inativo
// ou de outro estabelecimento recusado); e a recoleta cancelada com quem cancelou. Saída só com contagens.
import { ArmazemMemoria, type TrabalhoZpl } from '@sgh/dominio-documento';
import { codigoDaAmostra } from '@sgh/dominio-sadt';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaSadtPropria } from '../porta-propria.js';
import { ServicoPedidoSadt } from './pedido-propria.js';
import { type FilaDeEtiquetas, ServicoPostoColeta } from './posto-coleta-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  linhaTela,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));

describe.skipIf(SEM_BANCO)('posto de coleta, etiquetas e cancelamento da recoleta (MariaDB)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaSadtPropria;
  let pedidos: ServicoPedidoSadt;
  let postos: ServicoPostoColeta;
  let m: MassaSadt | null = null;
  let regraSub = 0;
  let posto = 0;
  const trabalhos: (TrabalhoZpl & { readonly id: string })[] = [];
  const fila: FilaDeEtiquetas = {
    armazem: new ArmazemMemoria(),
    destino: { enviar: (t) => Promise.resolve(void trabalhos.push(t)) },
    novoId: () => randomUUID(),
  };
  const ctxT = { cliente: CLIENTE, correlacao: 't-f3504' };
  const um = (sql: string, p: unknown[]) => nucleo.lerSomente(ctxT, (l) => l.uma(sql, p));
  const conta = async (sql: string, p: unknown[]) => Number((await um(sql, p))?.['n']);
  const impressao = (reimpressao: boolean) => ({
    rede: 'rede-teste',
    estabelecimento: contexto(m!).hospital!,
    estacao: 'bancada 01',
    reimpressao,
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await montarMassaSadt(nucleo, 'F3P');
    porta = new PortaSadtPropria(nucleo);
    pedidos = new ServicoPedidoSadt(nucleo);
    postos = new ServicoPostoColeta(nucleo);
    // A etiqueta exige o segundo identificador (nascimento): a massa sintética ganha um, se não tiver.
    await nucleo.escrever(ctxT, (e) =>
      e.executar(
        `UPDATE pessoa_fisica pf JOIN paciente p ON p.pessoa_fisica_id = pf.id
            SET pf.data_nascimento = '1980-05-17' WHERE p.id = ? AND pf.data_nascimento IS NULL`,
        [m!.base.paciente],
      ),
    );
  }, 60_000);

  afterAll(async () => {
    if (m) {
      const est = m.base.est;
      await nucleo.escrever(ctxT, async (e) => {
        const x = (sql: string, p: unknown[]) => e.executar(sql, p);
        await x('DELETE FROM nova_coleta WHERE estabelecimento_id = ?', [est]);
        await x(
          `DELETE ev FROM item_exame_evento ev JOIN exame_item ei ON ei.id = ev.exame_item_id
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id WHERE r.estabelecimento_id = ?`,
          [est],
        );
        await x(
          `DELETE ev FROM amostra_biologica_evento ev JOIN amostra_biologica a ON a.id = ev.amostra_biologica_id
            WHERE a.estabelecimento_id = ? AND (a.amostra_pai_id IS NOT NULL OR ev.evento = 'etiqueta_impressa')`,
          [est],
        );
        await x(
          `DELETE x FROM amostra_biologica_exame x JOIN amostra_biologica a ON a.id = x.amostra_biologica_id
            WHERE a.estabelecimento_id = ? AND a.amostra_pai_id IS NOT NULL`,
          [est],
        );
        await x('DELETE FROM amostra_biologica WHERE estabelecimento_id = ? AND amostra_pai_id IS NOT NULL', [
          est,
        ]);
        await x('DELETE FROM regra_subamostra WHERE id = ?', [regraSub]);
        await x('UPDATE amostra_biologica SET ponto_coleta_id = NULL WHERE estabelecimento_id = ?', [est]);
        await x('DELETE FROM ponto_coleta WHERE estabelecimento_id IN (?, ?)', [est, m!.base.outroEst]);
      });
    }
    await limparMassaSadt(nucleo, m);
    await nucleo.encerrar();
  }, 60_000);

  it('o posto é incluído, alterado com versão nova e inativado sem ser apagado', async () => {
    const c = contexto(m!);
    const dados = {
      codigo: ` pc${m!.marca} `,
      descricao: 'Posto de coleta (teste)',
      tipo: 'interno' as const,
      setorLaboratorio: m!.setorLab,
      horarioInicio: '07:00',
      horarioFim: '17:00',
    };
    const novo = await postos.salvarPosto(c, dados);
    posto = novo.id;
    expect(
      await um(
        'SELECT codigo, tipo, setor_diagnostico_id AS setor, ativo, versao, criado_por FROM ponto_coleta WHERE id = ?',
        [posto],
      ),
    ).toMatchObject({
      codigo: `PC${m!.marca}`.toUpperCase(),
      tipo: 'interno',
      setor: m!.setorLab,
      ativo: 1,
      versao: 1,
      criado_por: m!.base.usuario,
    });
    // Código repetido, horário incoerente e setor de outro estabelecimento são recusados (nada gravado).
    expect(codigoDe(await postos.salvarPosto(c, dados).catch((e: unknown) => e))).toBe(
      'posto-codigo-repetido',
    );
    expect(
      codigoDe(
        await postos
          .salvarPosto(c, { ...dados, codigo: 'OUTRO', horarioFim: '06:00' })
          .catch((e: unknown) => e),
      ),
    ).toBe('posto-horario-invalido');
    expect(
      codigoDe(
        await postos
          .salvarPosto(contexto(m!, m!.base.outroEst), { ...dados, codigo: 'FORA' })
          .catch((e: unknown) => e),
      ),
    ).toBe('setor-inexistente');
    expect(
      await conta('SELECT COUNT(*) AS n FROM ponto_coleta WHERE estabelecimento_id IN (?, ?)', [
        m!.base.est,
        m!.base.outroEst,
      ]),
    ).toBe(1);
    // Alteração: versão nova; outro estabelecimento não altera o posto.
    const alterado = await postos.salvarPosto(c, {
      ...dados,
      id: posto,
      versao: 1,
      horarioFim: '19:00',
      funcionaFimDeSemana: true,
    });
    expect(alterado).toEqual({ id: posto, versao: 2 });
    expect(
      await um(
        "SELECT TIME_FORMAT(horario_fim, '%H:%i') AS fim, funciona_fim_semana AS fds, alterado_por FROM ponto_coleta WHERE id = ?",
        [posto],
      ),
    ).toMatchObject({ fim: '19:00', fds: 1, alterado_por: m!.base.usuario });
    expect(
      codigoDe(
        await postos
          .salvarPosto(contexto(m!, m!.base.outroEst), { ...dados, id: posto })
          .catch((e: unknown) => e),
      ),
    ).not.toBe('');
    expect(
      codigoDe(
        await postos
          .situarPosto(contexto(m!, m!.base.outroEst), posto, { ativo: false })
          .catch((e: unknown) => e),
      ),
    ).toBe('posto-inexistente');
    // Inativar não apaga: o posto some da lista da coleta e fica no cadastro.
    await postos.situarPosto(c, posto, { ativo: false });
    expect(await um('SELECT ativo, excluido_em FROM ponto_coleta WHERE id = ?', [posto])).toMatchObject({
      ativo: 0,
      excluido_em: null,
    });
    expect((await postos.postos(c)).map((p) => p.id)).not.toContain(posto);
    expect((await postos.postos(c, { ativos: false })).map((p) => p.id)).toContain(posto);
    // A trilha de cada gravação do posto, na mesma transação.
    expect(
      await conta(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND entidade = 'ponto_coleta' AND entidade_id = ?",
        [m!.base.est, posto],
      ),
    ).toBeGreaterThanOrEqual(3);
  });

  it('etiqueta da alíquota e da recoleta na fila, recoleta no posto e quem cancelou a recoleta', async () => {
    const c = contexto(m!);
    const at = await porta.atendimentoDosExames(c, [m!.itemLab, m!.itemLab2]);
    const col = await porta.gravarSgh(
      c,
      (x: { id: number }) => linhaTela(m!, 'sadt.amostra.coletada', 'amostra_biologica', x.id),
      (g) =>
        g.registrarColeta({
          codigo: (id) => codigoDaAmostra(c.hospital!, id),
          paciente: at!.paciente,
          atendimento: at!.atendimento,
          reg: at!.reg,
          atend: at!.atend,
          recipiente: null,
          exames: [
            { id: m!.itemLab, chave: 'a' },
            { id: m!.itemLab2, chave: 'b' },
          ],
          pulseiraConferida: true,
          estacao: 'teste',
          usuario: m!.base.login,
        }),
    );
    await porta.gravarSgh(c, linhaTela(m!, 'sadt.amostra.estado', 'amostra_biologica', col.id), (g) =>
      g.mudarEstadoAmostra({
        amostra: col.id,
        de: 'coletada',
        para: 'recebida',
        motivo: null,
        detalhe: null,
        usuario: m!.base.login,
        estacao: 'teste',
      }),
    );
    regraSub = await nucleo.escrever(ctxT, (e) =>
      e.inserir(
        `INSERT INTO regra_subamostra (codigo, descricao, exame_id, setor_diagnostico_id, gera_subamostra, exame_primario,
           agrupamento_etiqueta, ativo, criado_em, versao) VALUES (?, 'Alíquota (teste)', ?, ?, TRUE, FALSE, 'por_setor', TRUE, UTC_TIMESTAMP(3), 1)`,
        [`RP${m!.marca}`, m!.exameLab, m!.setorLab],
      ),
    );
    const sub = await pedidos.gerarSubamostras(c, col.id);
    const aliquota = sub.subamostras[0]!;
    const eventos = (amostra: number) =>
      conta(
        "SELECT COUNT(*) AS n FROM amostra_biologica_evento WHERE amostra_biologica_id = ? AND evento = 'etiqueta_impressa'",
        [amostra],
      );

    // Alíquota: uma etiqueta na fila da estação, com "qual de quantas", e a impressão gravada na amostra.
    const e1 = await postos.imprimirEtiquetas(c, [aliquota.id], fila, impressao(false));
    expect(e1).toMatchObject({
      total: 1,
      naFila: 1,
      vias: [{ amostra: aliquota.id, via: 1, tipo: 'aliquota' }],
    });
    expect(trabalhos).toHaveLength(1);
    expect(trabalhos[0]).toMatchObject({
      modelo: 'etiqueta-amostra',
      estacao: 'bancada-01',
      chaveIdempotencia: `amostra-${aliquota.codigo}`,
    });
    expect(trabalhos[0]!.zpl).toContain(`^FD${aliquota.codigo}^FS`);
    expect(trabalhos[0]!.zpl).toContain('A1/1');
    expect(
      await um('SELECT etiqueta_impressa_em IS NOT NULL AS impressa FROM amostra_biologica WHERE id = ?', [
        aliquota.id,
      ]),
    ).toMatchObject({ impressa: 1 });
    expect(
      await um(
        `SELECT usuario_id, JSON_VALUE(dados, '$.via') AS via, JSON_VALUE(dados, '$.estacao') AS estacao
           FROM amostra_biologica_evento WHERE amostra_biologica_id = ? AND evento = 'etiqueta_impressa'`,
        [aliquota.id],
      ),
    ).toMatchObject({ usuario_id: m!.base.usuario, via: '1', estacao: 'bancada-01' });
    // O clique repetido não imprime nem registra de novo; a reimpressão pedida é a via 2.
    expect((await postos.imprimirEtiquetas(c, [aliquota.id], fila, impressao(false))).naFila).toBe(0);
    expect(trabalhos).toHaveLength(1);
    expect(await eventos(aliquota.id)).toBe(1);
    const e2 = await postos.imprimirEtiquetas(c, [aliquota.id], fila, impressao(true));
    expect(e2.vias).toEqual([{ amostra: aliquota.id, via: 2, tipo: 'aliquota' }]);
    expect(trabalhos).toHaveLength(2);
    expect(await eventos(aliquota.id)).toBe(2);
    // Sem a fila (serviço de documentos desligado) nada é dado como impresso; outro estabelecimento não imprime.
    expect((await postos.imprimirEtiquetas(c, [col.id], null, impressao(false))).naFila).toBe(0);
    expect(await eventos(col.id)).toBe(0);
    expect(
      codigoDe(
        await postos
          .imprimirEtiquetas(contexto(m!, m!.base.outroEst), [aliquota.id], fila, impressao(true))
          .catch((e: unknown) => e),
      ),
    ).toBe('amostra-inexistente');

    // Recoleta: a primária e a alíquota ficam rejeitadas e já não ganham etiqueta.
    const hemolise = Number(
      (await um("SELECT id FROM motivo_nova_coleta WHERE codigo = 'HEMOLISE'", []))?.['id'],
    );
    const r = await pedidos.pedirRecoleta(c, col.id, { motivo: hemolise });
    expect(
      codigoDe(
        await postos.imprimirEtiquetas(c, [aliquota.id], fila, impressao(true)).catch((e: unknown) => e),
      ),
    ).toBe('amostra-inativa');
    expect(trabalhos).toHaveLength(2);
    // A coleta da recoleta no posto: inativo e inexistente são recusados; ativo, fica na amostra nova e na passagem.
    const conferida = {
      identificadoresConferidos: true,
      pulseira: `P${m!.base.paciente}`,
      estacao: 'posto-teste',
    };
    expect(
      codigoDe(await pedidos.coletarRecoleta(c, r.id, { ...conferida, posto }).catch((e: unknown) => e)),
    ).toBe('posto-inativo');
    expect(
      codigoDe(
        await pedidos
          .coletarRecoleta(c, r.id, { ...conferida, posto: 2_000_000_000 })
          .catch((e: unknown) => e),
      ),
    ).toBe('posto-inexistente');
    expect(await um('SELECT situacao FROM nova_coleta WHERE id = ?', [r.id])).toMatchObject({
      situacao: 'pendente',
    });
    await postos.situarPosto(c, posto, { ativo: true });
    const nova = await pedidos.coletarRecoleta(c, r.id, { ...conferida, posto });
    expect(
      await um('SELECT ponto_coleta_id AS posto, repeticao FROM amostra_biologica WHERE id = ?', [
        nova.amostra,
      ]),
    ).toMatchObject({ posto, repeticao: 1 });
    expect(
      Number(
        (
          await um(
            `SELECT JSON_VALUE(dados, '$.posto') AS posto FROM amostra_biologica_evento
              WHERE amostra_biologica_id = ? AND evento = 'coletada'`,
            [nova.amostra],
          )
        )?.['posto'],
      ),
    ).toBe(posto);
    // A etiqueta da recoleta vai à fila marcada como recoleta.
    const e3 = await postos.imprimirEtiquetas(c, [nova.amostra], fila, impressao(false));
    expect(e3.vias).toEqual([{ amostra: nova.amostra, via: 1, tipo: 'recoleta' }]);
    expect(trabalhos).toHaveLength(3);
    expect(trabalhos[2]!.zpl).toContain(`^FD${nova.codigo}^FS`);
    expect(trabalhos[2]!.zpl).toMatch(/ RC /);
    expect(await eventos(nova.amostra)).toBe(1);

    // Quem cancelou a recoleta fica na própria recoleta.
    const r2 = await pedidos.pedirRecoleta(c, nova.amostra, { motivo: hemolise });
    await pedidos.cancelarRecoleta(c, r2.id, {
      motivo: 'Paciente recebeu alta antes da coleta',
      destinoExames: 'manter',
    });
    expect(
      await um(
        'SELECT situacao, cancelada_por_usuario_id AS quem, cancelada_em IS NOT NULL AS quando FROM nova_coleta WHERE id = ?',
        [r2.id],
      ),
    ).toMatchObject({ situacao: 'cancelada', quem: m!.base.usuario, quando: 1 });
  });
});
