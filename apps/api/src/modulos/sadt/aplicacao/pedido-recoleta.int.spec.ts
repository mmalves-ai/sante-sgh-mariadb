// Contrato de efeito do pedido de exames, do cancelamento do item, do kit com versão, da recoleta e das sub-amostras
// (F3.5, 05-SADT linhas 4, 5 e 7) no MariaDB real (cliente f22_o2; massa SINTÉTICA). Prova o que fica no banco: a
// requisição numerada com os itens e o evento "solicitado" (com a versão do kit), a restrição clínica decidida na
// gravação e a exceção do item registrada com quem autorizou; o item cancelado com motivo e evento, e a requisição
// cancelada com o último item; a versão anterior do kit encerrada e mantida; as alíquotas ligadas à primária; a
// recoleta como fato próprio, com a original e as alíquotas rejeitadas, a coleta com identificação positiva e um único
// vínculo vivo por exame; o cancelamento da recoleta com o destino dos exames; as restrições pelas colunas reais e a
// exceção só com a permissão de autorizar. Saída só com contagens.
import { codigoDaAmostra, codigoValido } from '@sgh/dominio-sadt';
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaSadtPropria } from '../porta-propria.js';
import { ServicoPedidoSadt } from './pedido-propria.js';
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

describe.skipIf(SEM_BANCO)(
  'pedido, cancelamento, kit, recoleta e sub-amostras (MariaDB, cliente f22_o2)',
  () => {
    let nucleo: NucleoProprio;
    let porta: PortaSadtPropria;
    let servico: ServicoPedidoSadt;
    let m: MassaSadt | null = null;
    const kits: number[] = [];
    const reqs: number[] = [];
    let restricao = 0;
    const restricoesExtra: number[] = [];
    let regraSub = 0;
    const um = (sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f352' }, (l) => l.uma(sql, p));
    const todos = (sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: 't-f352' }, (l) => l.consultar(sql, p));
    const motivo = async (tabela: string, codigo: string) =>
      Number((await um(`SELECT id FROM ${tabela} WHERE codigo = ?`, [codigo]))?.['id']);

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await montarMassaSadt(nucleo, 'F35');
      porta = new PortaSadtPropria(nucleo);
      servico = new ServicoPedidoSadt(nucleo);
    }, 60_000);

    afterAll(async () => {
      if (m) {
        const est = m.base.est;
        await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f352' }, async (e) => {
          const x = (sql: string, p: unknown[]) => e.executar(sql, p);
          await x('DELETE FROM nova_coleta WHERE estabelecimento_id = ?', [est]);
          await x(
            `DELETE ev FROM item_exame_evento ev JOIN exame_item ei ON ei.id = ev.exame_item_id
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id WHERE r.estabelecimento_id = ?`,
            [est],
          );
          await x('DELETE FROM excecao_restricao_exame WHERE restricao_exame_id = ?', [restricao]);
          await x('DELETE FROM restricao_exame WHERE id = ?', [restricao]);
          for (const r of restricoesExtra) {
            await x('DELETE FROM excecao_restricao_exame WHERE restricao_exame_id = ?', [r]);
            await x('DELETE FROM restricao_exame WHERE id = ?', [r]);
          }
          // As alíquotas primeiro (a primária é apagada pela limpeza da massa).
          await x(
            `DELETE ev FROM amostra_biologica_evento ev JOIN amostra_biologica a ON a.id = ev.amostra_biologica_id
            WHERE a.estabelecimento_id = ? AND a.amostra_pai_id IS NOT NULL`,
            [est],
          );
          await x(
            `DELETE x FROM amostra_biologica_exame x JOIN amostra_biologica a ON a.id = x.amostra_biologica_id
            WHERE a.estabelecimento_id = ? AND a.amostra_pai_id IS NOT NULL`,
            [est],
          );
          await x(
            'DELETE FROM amostra_biologica WHERE estabelecimento_id = ? AND amostra_pai_id IS NOT NULL',
            [est],
          );
          await x('DELETE FROM regra_subamostra WHERE id = ?', [regraSub]);
          for (const r of reqs) {
            await x('DELETE FROM exame_item WHERE requisicao_exame_id = ?', [r]);
            await x('DELETE FROM requisicao_exame WHERE id = ?', [r]);
          }
          for (const k of kits) {
            await x(
              'DELETE i FROM kit_exame_versao_item i JOIN kit_exame_versao v ON v.id = i.kit_exame_versao_id WHERE v.kit_exame_id = ?',
              [k],
            );
            await x('DELETE FROM kit_exame_versao WHERE kit_exame_id = ?', [k]);
            await x('DELETE FROM kit_exame WHERE id = ?', [k]);
          }
        });
      }
      await limparMassaSadt(nucleo, m);
      await nucleo.encerrar();
    }, 60_000);

    it('kit com versão, pedido com restrição e exceção, e cancelamento do item com motivo', async () => {
      const c = contexto(m!);
      // Kit: a 1ª versão e a 2ª; a 1ª fica encerrada (nunca apagada).
      const v1 = await servico.salvarVersaoKit(c, {
        codigo: `K${m!.marca}`,
        nome: 'Kit de teste',
        itens: [{ exame: m!.exameLab }],
      });
      kits.push(v1.id);
      const v2 = await servico.salvarVersaoKit(c, {
        kit: v1.id,
        nome: 'Kit de teste',
        itens: [{ exame: m!.exameLab }, { exame: m!.exameImagem }],
      });
      expect(v2).toMatchObject({ id: v1.id, numeroVersao: 2 });
      expect(
        await todos(
          'SELECT numero_versao, vigencia_fim IS NULL AS vigente FROM kit_exame_versao WHERE kit_exame_id = ? ORDER BY numero_versao',
          [v1.id],
        ),
      ).toEqual([
        { numero_versao: 1, vigente: 0 },
        { numero_versao: 2, vigente: 1 },
      ]);
      expect((await servico.kits(c)).find((k) => k.id === v1.id)?.itens.length).toBe(2);

      // Restrição: o mesmo exame não se repete em 30 dias (a massa já pediu o exame do laboratório), com exceção.
      restricao = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f352' }, (e) =>
        e.inserir(
          `INSERT INTO restricao_exame (estabelecimento_id, exame_id, tipo_restricao, intervalo_minimo_dias, permite_excecao,
           mensagem, vigencia_inicio, ativo, criado_em, versao) VALUES (?, ?, 'bloqueio', 30, TRUE, 'Exame repetido em menos de 30 dias.', '2020-01-01', TRUE, UTC_TIMESTAMP(3), 1)`,
          [m!.base.est, m!.exameLab],
        ),
      );
      const pedido = {
        atendimento: m!.base.atendimento,
        setor: m!.setorLab,
        exames: [{ exame: m!.exameLab }],
        kits: [v1.id],
        confirmado: true,
      };
      const av = await servico.avaliarPedido(c, pedido);
      expect(av).toMatchObject({ segue: false, codigo: 'restricao-justificativa' });
      expect(av.restricoes.map((r) => [r.regra, r.motivo])).toEqual([[restricao, 'repeticao']]);
      expect(av.itens.map((i) => i.kitVersao)).toEqual([null, v2.versao]);
      expect(codigoDe(await servico.abrirPedido(c, pedido).catch((e: unknown) => e))).toBe(
        'restricao-justificativa',
      );
      // Quem só pede (sem sadt.requisicao.autorizarExcecao) não libera a própria exceção: nada é gravado.
      const antes = Number(
        (await um('SELECT COUNT(*) AS n FROM requisicao_exame WHERE paciente_id = ?', [m!.base.paciente]))?.[
          'n'
        ],
      );
      expect(
        codigoDe(
          await servico
            .abrirPedido(c, { ...pedido, justificativa: 'controle pós-operatório pedido pelo médico' }, false)
            .catch((e: unknown) => e),
        ),
      ).toBe('restricao-autorizacao');
      expect(
        Number(
          (
            await um('SELECT COUNT(*) AS n FROM requisicao_exame WHERE paciente_id = ?', [m!.base.paciente])
          )?.['n'],
        ),
      ).toBe(antes);
      const g = await servico.abrirPedido(
        c,
        { ...pedido, justificativa: 'controle pós-operatório pedido pelo médico' },
        true,
      );
      reqs.push(g.requisicao);
      expect(g.excecoes).toBe(1);
      expect(g.numero).toMatch(/\d+/);
      expect(
        await um('SELECT situacao, tipo_solicitacao, paciente_id FROM requisicao_exame WHERE id = ?', [
          g.requisicao,
        ]),
      ).toMatchObject({
        situacao: 'solicitada',
        tipo_solicitacao: 'lancado_no_setor',
        paciente_id: m!.base.paciente,
      });
      expect(g.itens.map((i) => i.exame)).toEqual([m!.exameLab, m!.exameImagem]);
      const evs = await todos(
        `SELECT ev.evento, JSON_EXTRACT(ev.dados, '$.kitVersao') AS kit FROM item_exame_evento ev
         JOIN exame_item ei ON ei.id = ev.exame_item_id WHERE ei.requisicao_exame_id = ? ORDER BY ei.sequencia`,
        [g.requisicao],
      );
      expect(evs.map((e) => [e['evento'], e['kit'] === null ? null : Number(e['kit'])])).toEqual([
        ['solicitado', null],
        ['solicitado', v2.versao],
      ]);
      expect(
        await um(
          'SELECT abrangencia, exame_item_id, autorizado_por_usuario_id FROM excecao_restricao_exame WHERE restricao_exame_id = ?',
          [restricao],
        ),
      ).toMatchObject({
        abrangencia: 'item_exame',
        exame_item_id: g.itens[0]!.id,
        autorizado_por_usuario_id: m!.base.usuario,
      });
      expect(
        Number(
          (
            await um(
              "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'requisicao_exame' AND entidade_id = ?",
              [g.requisicao],
            )
          )?.['n'],
        ),
      ).toBe(1);

      // Cancelamento: o motivo "outro" pede o complemento; o último item cancela a requisição.
      const outro = await motivo('motivo_cancelamento_item_exame', 'OUTRO');
      const dup = await motivo('motivo_cancelamento_item_exame', 'PEDIDO_DUPLICADO');
      const [a, b] = g.itens;
      expect(codigoDe(await servico.cancelarItem(c, a!.id, { motivo: outro }).catch((e: unknown) => e))).toBe(
        'complemento-obrigatorio',
      );
      expect(
        await servico.cancelarItem(c, a!.id, { motivo: outro, complemento: 'exame trocado pelo médico' }),
      ).toEqual({
        id: a!.id,
        requisicaoCancelada: false,
        conta: 'sem_lancamento',
      });
      expect(await servico.cancelarItem(c, b!.id, { motivo: dup })).toEqual({
        id: b!.id,
        requisicaoCancelada: true,
        conta: 'sem_lancamento',
      });
      expect(codigoDe(await servico.cancelarItem(c, b!.id, { motivo: dup }).catch((e: unknown) => e))).toBe(
        'item-nao-cancelavel',
      );
      expect(
        await um('SELECT situacao, motivo_cancelamento_item_exame_id AS m FROM exame_item WHERE id = ?', [
          a!.id,
        ]),
      ).toMatchObject({ situacao: 'cancelado', m: outro });
      expect(await um('SELECT situacao FROM requisicao_exame WHERE id = ?', [g.requisicao])).toMatchObject({
        situacao: 'cancelada',
      });
      expect((await servico.eventosDoItem(c, a!.id))?.map((e) => e.evento)).toEqual([
        'solicitado',
        'cancelado',
      ]);
      // Outro estabelecimento não enxerga nem cancela o item.
      expect(await servico.eventosDoItem(contexto(m!, m!.base.outroEst), a!.id)).toBeNull();
    });

    it('restrições lidas das colunas reais (sexo, idade, material), alerta confirmado no evento e setor de outro estabelecimento', async () => {
      const c = contexto(m!);
      const pac = await um(
        `SELECT sx.sigla AS sexo, pf.data_nascimento AS nasc FROM paciente pa JOIN pessoa_fisica pf ON pf.id = pa.pessoa_fisica_id
         LEFT JOIN sexo sx ON sx.id = pf.sexo_id WHERE pa.id = ?`,
        [m!.base.paciente],
      );
      const sigla = String(pac?.['sexo'] ?? '').toUpperCase();
      const outroSexo = sigla === 'F' ? 'masculino' : 'feminino';
      const padrao = await um(
        'SELECT MIN(material_biologico_id) AS m FROM exame_material WHERE exame_id = ?',
        [m!.exameImagem],
      );
      const outroMaterial = await um(
        'SELECT MIN(id) AS m FROM material_biologico WHERE id <> COALESCE(?, 0)',
        [padrao?.['m'] ?? null],
      );
      const inserir = (sql: string, p: unknown[]) =>
        nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f352' }, (e) => e.inserir(sql, p));
      const cab = `INSERT INTO restricao_exame (estabelecimento_id, exame_id, tipo_restricao, permite_excecao, mensagem,
                   vigencia_inicio, ativo, criado_em, versao`;
      const rSexo = await inserir(
        `${cab}, sexo) VALUES (?, ?, 'alerta', FALSE, 'Exame de outro sexo.', '2020-01-01', TRUE, UTC_TIMESTAMP(3), 1, ?)`,
        [m!.base.est, m!.exameImagem, outroSexo],
      );
      const rIdade = await inserir(
        `${cab}, idade_maxima_dias) VALUES (?, ?, 'alerta', FALSE, 'Só recém-nascido.', '2020-01-01', TRUE, UTC_TIMESTAMP(3), 1, 1)`,
        [m!.base.est, m!.exameImagem],
      );
      const rMaterial = await inserir(
        `${cab}, material_biologico_id) VALUES (?, ?, 'alerta', FALSE, 'Material diferente.', '2020-01-01', TRUE, UTC_TIMESTAMP(3), 1, ?)`,
        [m!.base.est, m!.exameImagem, Number(outroMaterial?.['m'])],
      );
      // Dia e horário sem depender do relógio: um dia da semana que não é hoje em nenhum fuso do país (nem o de UTC) e
      // uma janela de uma hora que começa 10 horas depois de agora (UTC), fora da hora local de qualquer fuso do país.
      const agora = new Date();
      const hojeUtc = agora.getUTCDay() + 1;
      const ontemUtc = ((hojeUtc + 5) % 7) + 1;
      const diaFora = [1, 2, 3, 4, 5, 6, 7].find((d) => d !== hojeUtc && d !== ontemUtc)!;
      const hh = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, '0')}:00:00`;
      const rDia = await inserir(
        `${cab}, dia_semana) VALUES (?, ?, 'alerta', FALSE, 'Só noutro dia.', '2020-01-01', TRUE, UTC_TIMESTAMP(3), 1, ?)`,
        [m!.base.est, m!.exameImagem, diaFora],
      );
      const rHora = await inserir(
        `${cab}, hora_inicio, hora_fim) VALUES (?, ?, 'alerta', FALSE, 'Só noutro horário.', '2020-01-01', TRUE, UTC_TIMESTAMP(3), 1, ?, ?)`,
        [m!.base.est, m!.exameImagem, hh(agora.getUTCHours() + 10), hh(agora.getUTCHours() + 11)],
      );
      restricoesExtra.push(rSexo, rIdade, rMaterial, rDia, rHora);
      const pedido = {
        atendimento: m!.base.atendimento,
        setor: m!.setorImagem,
        exames: [{ exame: m!.exameImagem }],
      };
      const av = await servico.avaliarPedido(c, pedido);
      const motivoDe = (regra: number) => av.restricoes.find((r) => r.regra === regra);
      // Sexo: o do paciente diverge da regra, ou é desconhecido (vira alerta, nunca aprovação calada).
      expect(motivoDe(rSexo)).toMatchObject({ motivo: 'sexo', tipo: 'alerta' });
      if (pac?.['nasc'] !== null && pac?.['nasc'] !== undefined)
        expect(motivoDe(rIdade)).toMatchObject({ motivo: 'idade' });
      else expect(motivoDe(rIdade)).toBeUndefined();
      // Material: o padrão do cadastro do exame entra na avaliação; sem padrão, vira alerta.
      expect(motivoDe(rMaterial)).toMatchObject({ motivo: 'material' });
      expect(motivoDe(rDia)).toMatchObject({ motivo: 'dia', tipo: 'alerta' });
      expect(motivoDe(rHora)).toMatchObject({ motivo: 'horario', tipo: 'alerta' });
      expect(av).toMatchObject({ segue: false, codigo: 'restricao-confirmar' });
      const g = await servico.abrirPedido(c, { ...pedido, confirmado: true });
      reqs.push(g.requisicao);
      const ev = await um(
        `SELECT JSON_LENGTH(ev.dados, '$.restricoes') AS n FROM item_exame_evento ev WHERE ev.exame_item_id = ? AND ev.evento = 'solicitado'`,
        [g.itens[0]!.id],
      );
      expect(Number(ev?.['n'])).toBe(av.restricoes.length);
      // O setor do item precisa ser deste estabelecimento.
      const setorFora = await um(
        'SELECT MIN(id) AS id FROM setor_diagnostico WHERE estabelecimento_id <> ? AND excluido_em IS NULL',
        [m!.base.est],
      );
      if (setorFora?.['id'] !== null && setorFora?.['id'] !== undefined)
        expect(
          codigoDe(
            await servico
              .avaliarPedido(c, {
                ...pedido,
                exames: [{ exame: m!.exameImagem, setor: Number(setorFora['id']) }],
              })
              .catch((e: unknown) => e),
          ),
        ).toBe('setor-inexistente');
    });

    it('sub-amostras pela regra do exame e a recoleta ligada à amostra original', async () => {
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
      // Antes do recebimento, a alíquota é recusada.
      expect(codigoDe(await servico.gerarSubamostras(c, col.id).catch((e: unknown) => e))).toBe(
        'amostra-nao-recebida',
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
      expect(codigoDe(await servico.gerarSubamostras(c, col.id).catch((e: unknown) => e))).toBe(
        'sem-regra-subamostra',
      );
      regraSub = await nucleo.escrever({ cliente: CLIENTE, correlacao: 't-f352' }, (e) =>
        e.inserir(
          `INSERT INTO regra_subamostra (codigo, descricao, exame_id, setor_diagnostico_id, gera_subamostra, exame_primario,
           agrupamento_etiqueta, ativo, criado_em, versao) VALUES (?, 'Alíquota (teste)', ?, ?, TRUE, FALSE, 'por_setor', TRUE, UTC_TIMESTAMP(3), 1)`,
          [`RS${m!.marca}`, m!.exameLab, m!.setorLab],
        ),
      );
      const sub = await servico.gerarSubamostras(c, col.id);
      expect(sub.subamostras).toHaveLength(1);
      expect(codigoValido(sub.subamostras[0]!.codigo)).toBe(true);
      expect(
        await um('SELECT amostra_pai_id, regra_subamostra_id, situacao FROM amostra_biologica WHERE id = ?', [
          sub.subamostras[0]!.id,
        ]),
      ).toMatchObject({ amostra_pai_id: col.id, regra_subamostra_id: regraSub, situacao: 'recebida' });
      expect(await um('SELECT situacao FROM amostra_biologica WHERE id = ?', [col.id])).toMatchObject({
        situacao: 'aliquotada',
      });
      expect(codigoDe(await servico.gerarSubamostras(c, col.id).catch((e: unknown) => e))).toBe(
        'amostra-aliquotada',
      );

      // Recoleta: a primária é rejeitada, os exames voltam à coleta e a pendência nasce numerada.
      const hemolise = await motivo('motivo_nova_coleta', 'HEMOLISE');
      const fora = contexto(m!, m!.base.outroEst);
      // Outro estabelecimento não pede recoleta nem gera alíquota da amostra; a alíquota não pede recoleta.
      expect(
        codigoDe(await servico.pedirRecoleta(fora, col.id, { motivo: hemolise }).catch((e: unknown) => e)),
      ).toBe('amostra-inexistente');
      expect(codigoDe(await servico.gerarSubamostras(fora, col.id).catch((e: unknown) => e))).toBe(
        'amostra-inexistente',
      );
      expect(
        codigoDe(
          await servico
            .pedirRecoleta(c, sub.subamostras[0]!.id, { motivo: hemolise })
            .catch((e: unknown) => e),
        ),
      ).toBe('recoleta-pela-primaria');
      const r = await servico.pedirRecoleta(c, col.id, { motivo: hemolise, observacao: null });
      expect(
        codigoDe(await servico.pedirRecoleta(c, col.id, { motivo: hemolise }).catch((e: unknown) => e)),
      ).toBe('recoleta-aberta');
      expect(
        await um('SELECT situacao, motivo_nova_coleta_id AS m FROM amostra_biologica WHERE id = ?', [col.id]),
      ).toMatchObject({ situacao: 'rejeitada', m: hemolise });
      expect(
        await um('SELECT situacao, refazimento, coleta_pendente FROM exame_item WHERE id = ?', [m!.itemLab]),
      ).toMatchObject({
        situacao: 'solicitado',
        refazimento: 1,
        coleta_pendente: 1,
      });
      // A alíquota viva da primária é rejeitada junto, com evento; o vínculo antigo fica como histórico.
      expect(
        await um('SELECT situacao FROM amostra_biologica WHERE id = ?', [sub.subamostras[0]!.id]),
      ).toMatchObject({
        situacao: 'rejeitada',
      });
      expect(
        Number(
          (
            await um(
              "SELECT COUNT(*) AS n FROM amostra_biologica_evento WHERE amostra_biologica_id = ? AND evento = 'rejeitada'",
              [sub.subamostras[0]!.id],
            )
          )?.['n'],
        ),
      ).toBe(1);
      expect((await servico.recoletas(c, { abertas: true })).map((x) => x.id)).toContain(r.id);
      // Sem a identificação positiva, a recoleta não é coletada; outro estabelecimento não a enxerga.
      expect(codigoDe(await servico.coletarRecoleta(c, r.id, {}).catch((e: unknown) => e))).toBe(
        'coleta-nao-conferida',
      );
      const conferida = {
        identificadoresConferidos: true,
        pulseira: `P${m!.base.paciente}`,
        estacao: 'posto-teste',
      };
      expect(codigoDe(await servico.coletarRecoleta(fora, r.id, conferida).catch((e: unknown) => e))).toBe(
        'recoleta-inexistente',
      );
      const nova = await servico.coletarRecoleta(c, r.id, conferida);
      // Cada exame fica com um único vínculo a amostra viva: a nova.
      const vivos = await todos(
        `SELECT abe.exame_item_id AS i, COUNT(*) AS n FROM amostra_biologica_exame abe
           JOIN amostra_biologica am ON am.id = abe.amostra_biologica_id
          WHERE abe.excluido_em IS NULL AND am.situacao NOT IN ('rejeitada','cancelada','descartada')
            AND abe.exame_item_id IN (?, ?) GROUP BY abe.exame_item_id`,
        [m!.itemLab, m!.itemLab2],
      );
      expect(vivos.map((v) => Number(v['n']))).toEqual(vivos.map(() => 1));
      expect(
        await um(
          `SELECT JSON_UNQUOTE(JSON_EXTRACT(dados, '$.estacao')) AS estacao,
                  JSON_EXTRACT(dados, '$.identificadoresConferidos') AS ok
             FROM amostra_biologica_evento WHERE amostra_biologica_id = ? AND evento = 'coletada'`,
          [nova.amostra],
        ),
      ).toMatchObject({ estacao: 'posto-teste' });
      // A trilha da recoleta: pedida e coletada, cada uma com a sua linha.
      expect(
        Number(
          (
            await um(
              "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'nova_coleta' AND entidade_id = ?",
              [r.id],
            )
          )?.['n'],
        ),
      ).toBe(2);
      expect(codigoValido(nova.codigo)).toBe(true);
      expect(
        await um(
          'SELECT situacao, amostra_biologica_id AS o, nova_amostra_biologica_id AS n FROM nova_coleta WHERE id = ?',
          [r.id],
        ),
      ).toMatchObject({ situacao: 'coletada', o: col.id, n: nova.amostra });
      expect(
        await um(
          'SELECT repeticao, motivo_nova_coleta_id AS m, situacao FROM amostra_biologica WHERE id = ?',
          [nova.amostra],
        ),
      ).toMatchObject({ repeticao: 1, m: hemolise, situacao: 'coletada' });
      expect(
        await um('SELECT situacao, coleta_pendente FROM exame_item WHERE id = ?', [m!.itemLab]),
      ).toMatchObject({
        situacao: 'coletado',
        coleta_pendente: 0,
      });
      // A original continua no banco, com os eventos.
      expect(
        Number(
          (
            await um('SELECT COUNT(*) AS n FROM amostra_biologica_evento WHERE amostra_biologica_id = ?', [
              col.id,
            ])
          )?.['n'],
        ),
      ).toBeGreaterThanOrEqual(4);
      expect(codigoDe(await servico.coletarRecoleta(c, r.id, conferida).catch((e: unknown) => e))).toBe(
        'recoleta-fechada',
      );

      // Cancelar a recoleta pede o destino dos exames; "cancelar" cancela cada exame com motivo e evento.
      const r2 = await servico.pedirRecoleta(c, nova.amostra, { motivo: hemolise });
      expect(
        codigoDe(
          await servico.cancelarRecoleta(c, r2.id, { motivo: 'paciente teve alta' }).catch((e: unknown) => e),
        ),
      ).toBe('destino-obrigatorio');
      const susp = await motivo('motivo_cancelamento_item_exame', 'ALTA_OU_TRANSFERENCIA');
      const canc = await servico.cancelarRecoleta(c, r2.id, {
        motivo: 'paciente teve alta',
        destinoExames: 'cancelar',
        motivoCancelamentoExame: susp,
      });
      expect(canc.exames).toBeGreaterThanOrEqual(1);
      expect(await um('SELECT situacao FROM nova_coleta WHERE id = ?', [r2.id])).toMatchObject({
        situacao: 'cancelada',
      });
      expect(
        await um(
          'SELECT situacao, coleta_pendente, motivo_cancelamento_item_exame_id AS m FROM exame_item WHERE id = ?',
          [m!.itemLab],
        ),
      ).toMatchObject({ situacao: 'cancelado', coleta_pendente: 0, m: susp });
      expect(
        await um(
          `SELECT usuario_id FROM item_exame_evento WHERE exame_item_id = ? AND evento = 'cancelado'
            ORDER BY id DESC LIMIT 1`,
          [m!.itemLab],
        ),
      ).toMatchObject({ usuario_id: m!.base.usuario });
    });
  },
);
