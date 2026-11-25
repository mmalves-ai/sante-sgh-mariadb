// Contrato de efeito do contexto da restrição clínica do pedido de exames (F3.5, 05-SADT linha 5) no MariaDB real
// (cliente f22_o2; massa SINTÉTICA). Prova o que a gravação lê e deixa no banco: o tipo de atendimento do pedido vindo
// do regime do atendimento (e o pedido de fora), com o alerta quando ele é desconhecido; a exceção permanente pelo
// setor que pede e pelo perfil de quem pede (vigência, setor e perfil de outro não liberam) registrada no evento do
// item sem criar exceção nova; e o material escolhido na tela gravado no item, avaliado pela restrição de material e
// recusado quando o exame não o aceita. Saída só com contagens.
import { ErroOperacao, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ServicoPedidoSadt } from './pedido-propria.js';
import {
  CLIENTE,
  contexto,
  limparMassaSadt,
  type MassaSadt,
  montarMassaSadt,
  SEM_BANCO,
} from './copia.spec-util.js';

const codigoDe = (e: unknown) => (e instanceof ErroOperacao ? String(e.problema['codigo'] ?? '') : String(e));
const CTX = { cliente: CLIENTE, correlacao: 't-f3503' };

describe.skipIf(SEM_BANCO)(
  'restrição clínica do pedido: tipo de atendimento, exceção e material (MariaDB)',
  () => {
    let nucleo: NucleoProprio;
    let servico: ServicoPedidoSadt;
    let m: MassaSadt | null = null;
    const reqs: number[] = [];
    const regras: number[] = [];
    const regimesCriados: number[] = [];
    const materiaisCriados: number[] = [];
    let perfil = 0;
    let outroSetor = 0;
    const um = (sql: string, p: unknown[]) => nucleo.lerSomente(CTX, (l) => l.uma(sql, p));
    const inserir = (sql: string, p: unknown[]) => nucleo.escrever(CTX, (e) => e.inserir(sql, p));
    const executar = (sql: string, p: unknown[]) => nucleo.escrever(CTX, (e) => e.executar(sql, p));
    const CAB = `INSERT INTO restricao_exame (estabelecimento_id, exame_id, tipo_restricao, permite_excecao, mensagem,
               vigencia_inicio, ativo, criado_em, versao`;
    const regra = async (colunas: string, valores: string, p: unknown[]) => {
      const id = await inserir(`${CAB}, ${colunas}) VALUES (?, ?, ${valores})`, p);
      regras.push(id);
      return id;
    };
    /** Um dia da semana que não é hoje em nenhum fuso do país (nem o de UTC): a regra aciona sem depender do relógio. */
    const diaFora = () => {
      const hojeUtc = new Date().getUTCDay() + 1;
      const ontemUtc = ((hojeUtc + 5) % 7) + 1;
      return [1, 2, 3, 4, 5, 6, 7].find((d) => d !== hojeUtc && d !== ontemUtc)!;
    };

    beforeAll(async () => {
      nucleo = new NucleoProprio();
      m = await montarMassaSadt(nucleo, 'F3R');
      servico = new ServicoPedidoSadt(nucleo);
    }, 60_000);

    afterAll(async () => {
      if (m) {
        const est = m.base.est;
        await nucleo.escrever(CTX, async (e) => {
          const x = (sql: string, p: unknown[]) => e.executar(sql, p);
          await x('UPDATE atendimento SET regime_atendimento_id = NULL WHERE id = ?', [m!.base.atendimento]);
          await x(
            `DELETE ev FROM item_exame_evento ev JOIN exame_item ei ON ei.id = ev.exame_item_id
             JOIN requisicao_exame r ON r.id = ei.requisicao_exame_id WHERE r.estabelecimento_id = ?`,
            [est],
          );
          for (const r of regras) {
            await x('DELETE FROM excecao_restricao_exame WHERE restricao_exame_id = ?', [r]);
            await x('DELETE FROM restricao_exame WHERE id = ?', [r]);
          }
          for (const r of reqs) {
            await x('DELETE FROM exame_item WHERE requisicao_exame_id = ?', [r]);
            await x('DELETE FROM requisicao_exame WHERE id = ?', [r]);
          }
          if (perfil) {
            await x('DELETE FROM usuario_perfil WHERE perfil_acesso_id = ?', [perfil]);
            await x('DELETE FROM perfil_acesso WHERE id = ?', [perfil]);
          }
          if (outroSetor) await x('DELETE FROM setor_funcional WHERE id = ?', [outroSetor]);
          for (const r of regimesCriados) await x('DELETE FROM regime_atendimento WHERE id = ?', [r]);
        });
      }
      await limparMassaSadt(nucleo, m);
      if (materiaisCriados.length)
        await nucleo.escrever(CTX, async (e) => {
          for (const mat of materiaisCriados)
            await e.executar('DELETE FROM material_biologico WHERE id = ?', [mat]);
        });
      await nucleo.encerrar();
    }, 60_000);

    it('tipo de atendimento: desconhecido vira alerta; o regime do atendimento e o pedido de fora decidem', async () => {
      const c = contexto(m!);
      const regime = async (codigo: string) => {
        const r = await um('SELECT id FROM regime_atendimento WHERE codigo_tiss = ?', [codigo]);
        if (r) return Number(r['id']);
        const id = await inserir(
          `INSERT INTO regime_atendimento (codigo_tiss, descricao, versao_fonte, criado_em, versao)
         VALUES (?, 'Regime (teste)', 'teste', UTC_TIMESTAMP(3), 1)`,
          [codigo],
        );
        regimesCriados.push(id);
        return id;
      };
      const rInternado = await regra(
        'tipo_atendimento',
        `'alerta', FALSE, 'Só para paciente internado.', '2020-01-01', TRUE, UTC_TIMESTAMP(3), 1, 'internacao'`,
        [m!.base.est, m!.exameImagem],
      );
      const pedido = {
        atendimento: m!.base.atendimento,
        setor: m!.setorImagem,
        exames: [{ exame: m!.exameImagem }],
      };
      const acionada = async (extra: Record<string, unknown> = {}) =>
        (await servico.avaliarPedido(c, { ...pedido, ...extra })).restricoes.find(
          (r) => r.regra === rInternado,
        );
      const com = (id: number | null) =>
        executar('UPDATE atendimento SET regime_atendimento_id = ? WHERE id = ?', [id, m!.base.atendimento]);

      // A massa abre o atendimento sem regime e sem internação: o tipo é desconhecido e a regra vira alerta.
      const incerta = await acionada();
      expect(incerta).toMatchObject({ motivo: 'atendimento', tipo: 'alerta' });
      expect(incerta?.mensagem).toContain('não informado');
      // Regime ambulatorial: a regra aciona com a mensagem do cadastro.
      await com(await regime('01'));
      expect(await acionada()).toMatchObject({
        motivo: 'atendimento',
        mensagem: 'Só para paciente internado.',
      });
      // Pronto-socorro e domiciliar também divergem; internação não aciona.
      await com(await regime('04'));
      expect(await acionada()).toMatchObject({ motivo: 'atendimento' });
      await com(await regime('03'));
      expect(await acionada()).toBeUndefined();
      // O pedido de fora é externo, mesmo com o atendimento em regime de internação.
      expect(await acionada({ tipo: 'externo' })).toMatchObject({ motivo: 'atendimento' });

      // Gravado: o evento "solicitado" do item guarda a restrição acionada pelo tipo de atendimento.
      await com(await regime('01'));
      const g = await servico.abrirPedido(c, { ...pedido, confirmado: true });
      reqs.push(g.requisicao);
      const ev = await um(
        `SELECT JSON_VALUE(ev.dados, '$.restricoes[0].motivo') AS motivo, JSON_LENGTH(ev.dados, '$.restricoes') AS n
         FROM item_exame_evento ev WHERE ev.exame_item_id = ? AND ev.evento = 'solicitado'`,
        [g.itens[0]!.id],
      );
      expect([String(ev?.['motivo']), Number(ev?.['n'])]).toEqual(['atendimento', 1]);
      await com(null);
      await executar('UPDATE restricao_exame SET ativo = FALSE WHERE id = ?', [rInternado]);
    });

    it('exceção permanente pelo setor que pede e pelo perfil de quem pede libera o bloqueio e fica no evento do item', async () => {
      const c = contexto(m!);
      const est = m!.base.est;
      const rBloqueio = await regra(
        'dia_semana',
        `'bloqueio', FALSE, 'Só noutro dia.', '2020-01-01', TRUE, UTC_TIMESTAMP(3), 1, ?`,
        [est, m!.exameLab, diaFora()],
      );
      const pedido = {
        atendimento: m!.base.atendimento,
        setor: m!.setorLab,
        exames: [{ exame: m!.exameLab }],
      };
      const avaliar = async (ctx = c) => {
        const av = await servico.avaliarPedido(ctx, pedido);
        return {
          segue: av.segue,
          codigo: av.codigo,
          excecao: av.restricoes.find((r) => r.regra === rBloqueio)?.excecao ?? null,
        };
      };
      expect(await avaliar()).toEqual({ segue: false, codigo: 'restricao-bloqueio', excecao: null });

      const setorDoAtendimento = Number(
        (await um('SELECT setor_funcional_id AS s FROM atendimento WHERE id = ?', [m!.base.atendimento]))?.[
          's'
        ],
      );
      expect(setorDoAtendimento).toBeGreaterThan(0);
      outroSetor = await inserir(
        `INSERT INTO setor_funcional (estabelecimento_id, codigo, nome, tipo, criado_em)
       VALUES (?, ?, 'OUTRO SETOR SINTETICO', 'assistencial', UTC_TIMESTAMP(3))`,
        [est, `X${m!.marca}`.slice(0, 30)],
      );
      const excecao = (abrangencia: 'setor' | 'perfil', alvo: number) =>
        inserir(
          `INSERT INTO excecao_restricao_exame (restricao_exame_id, abrangencia, ${abrangencia === 'setor' ? 'setor_funcional_id' : 'perfil_acesso_id'},
           justificativa, autorizado_por_usuario_id, autorizado_em, vigencia_inicio, ativo, criado_em, versao)
         VALUES (?, ?, ?, 'Exceção de teste do contrato de efeito.', ?, UTC_TIMESTAMP(3), '2020-01-01', TRUE, UTC_TIMESTAMP(3), 1)`,
          [rBloqueio, abrangencia, alvo, m!.base.usuario],
        );

      // Setor: a exceção de outro setor não libera; a do setor que pede libera; vencida ou inativa deixa de liberar.
      const eSetor = await excecao('setor', outroSetor);
      expect((await avaliar()).codigo).toBe('restricao-bloqueio');
      await executar('UPDATE excecao_restricao_exame SET setor_funcional_id = ? WHERE id = ?', [
        setorDoAtendimento,
        eSetor,
      ]);
      expect(await avaliar()).toEqual({ segue: true, codigo: null, excecao: eSetor });
      await executar("UPDATE excecao_restricao_exame SET vigencia_fim = '2020-12-31' WHERE id = ?", [eSetor]);
      expect((await avaliar()).codigo).toBe('restricao-bloqueio');
      await executar('UPDATE excecao_restricao_exame SET vigencia_fim = NULL, ativo = FALSE WHERE id = ?', [
        eSetor,
      ]);
      expect((await avaliar()).codigo).toBe('restricao-bloqueio');

      // Perfil: só libera quem tem o perfil vigente neste estabelecimento.
      perfil = await inserir(
        `INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, 'Perfil sintético da exceção', UTC_TIMESTAMP(3))`,
        [est, `P${m!.marca}`.slice(0, 30)],
      );
      const ePerfil = await excecao('perfil', perfil);
      expect((await avaliar()).codigo).toBe('restricao-bloqueio');
      await inserir(
        `INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em)
       VALUES (?, ?, ?, '2020-01-01', UTC_TIMESTAMP(3))`,
        [m!.base.usuario, perfil, est],
      );
      expect(await avaliar()).toEqual({ segue: true, codigo: null, excecao: ePerfil });
      // O colega sem o perfil continua bloqueado, na avaliação e na gravação (nada gravado).
      const colega = { ...c, usuario: m!.base.usuario2 };
      expect((await avaliar(colega)).codigo).toBe('restricao-bloqueio');
      const contar = async () =>
        Number(
          (
            await um('SELECT COUNT(*) AS n FROM requisicao_exame WHERE paciente_id = ?', [m!.base.paciente])
          )?.['n'],
        );
      const antes = await contar();
      expect(codigoDe(await servico.abrirPedido(colega, pedido).catch((e: unknown) => e))).toBe(
        'restricao-bloqueio',
      );
      expect(await contar()).toBe(antes);

      // Quem tem o perfil grava: o evento do item guarda a exceção que liberou, e nenhuma exceção nova é criada.
      const g = await servico.abrirPedido(c, pedido);
      reqs.push(g.requisicao);
      expect(g.excecoes).toBe(0);
      const ev = await um(
        `SELECT JSON_VALUE(ev.dados, '$.restricoes[0].excecao') AS excecao, JSON_VALUE(ev.dados, '$.restricoes[0].regra') AS regra
         FROM item_exame_evento ev WHERE ev.exame_item_id = ? AND ev.evento = 'solicitado'`,
        [g.itens[0]!.id],
      );
      expect([Number(ev?.['regra']), Number(ev?.['excecao'])]).toEqual([rBloqueio, ePerfil]);
      expect(
        Number(
          (
            await um(
              "SELECT COUNT(*) AS n FROM excecao_restricao_exame WHERE restricao_exame_id = ? AND abrangencia = 'item_exame'",
              [rBloqueio],
            )
          )?.['n'],
        ),
      ).toBe(0);
      await executar('UPDATE restricao_exame SET ativo = FALSE WHERE id = ?', [rBloqueio]);
    });

    it('material por exame: o escolhido na tela vai para o item e para a restrição; o que o exame não aceita é recusado', async () => {
      const c = contexto(m!);
      const material = async (codigo: string, descricao: string) => {
        const r = await um('SELECT id FROM material_biologico WHERE codigo = ?', [codigo]);
        if (r) return Number(r['id']);
        const id = await inserir(
          `INSERT INTO material_biologico (codigo, descricao, ativo, tipo, imprime_etiqueta_local, exige_sitio_anatomico, criado_em, versao)
         VALUES (?, ?, TRUE, 'liquido', FALSE, FALSE, UTC_TIMESTAMP(3), 1)`,
          [codigo, descricao],
        );
        materiaisCriados.push(id);
        return id;
      };
      const padrao = Number(
        (
          await um(
            'SELECT material_biologico_id AS m FROM exame_material WHERE exame_id = ? AND padrao = TRUE',
            [m!.exameLab],
          )
        )?.['m'],
      );
      const outro = await material(`U${m!.marca}`.slice(0, 20), 'Urina (teste)');
      const inativo = await material(`L${m!.marca}`.slice(0, 20), 'Líquor (teste)');
      await inserir(
        'INSERT INTO exame_material (exame_id, material_biologico_id, padrao, criado_em, versao) VALUES (?, ?, FALSE, UTC_TIMESTAMP(3), 1)',
        [m!.exameLab, outro],
      );
      await inserir(
        `INSERT INTO exame_material (exame_id, material_biologico_id, padrao, ativo, inativado_em, criado_em, versao)
       VALUES (?, ?, FALSE, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), 1)`,
        [m!.exameLab, inativo],
      );
      // A regra limita o exame ao material padrão: com outro material, aciona.
      const rMaterial = await regra(
        'material_biologico_id',
        `'alerta', FALSE, 'Material diferente do habitual.', '2020-01-01', TRUE, UTC_TIMESTAMP(3), 1, ?`,
        [m!.base.est, m!.exameLab, padrao],
      );
      const pedido = (mat: number | null) => ({
        atendimento: m!.base.atendimento,
        setor: m!.setorLab,
        exames: [{ exame: m!.exameLab, material: mat }],
      });

      // Sem escolha: vale o padrão do cadastro, a tela recebe as opções ativas do exame e a regra não aciona.
      const semEscolha = await servico.avaliarPedido(c, pedido(null));
      expect(semEscolha.materiais).toHaveLength(1);
      expect(semEscolha.materiais[0]).toMatchObject({ exame: m!.exameLab, escolhido: padrao });
      expect(
        semEscolha.materiais[0]!.opcoes.map((o) => [o.id, o.padrao]).sort(
          (x, y) => Number(x[0]) - Number(y[0]),
        ),
      ).toEqual(
        [
          [padrao, true],
          [outro, false],
        ].sort((x, y) => Number(x[0]) - Number(y[0])),
      );
      expect(semEscolha.restricoes.find((r) => r.regra === rMaterial)).toBeUndefined();

      // Com o outro material: a restrição de material é avaliada no escolhido.
      const comOutro = await servico.avaliarPedido(c, pedido(outro));
      expect(comOutro.materiais[0]).toMatchObject({ escolhido: outro });
      expect(comOutro.restricoes.find((r) => r.regra === rMaterial)).toMatchObject({
        motivo: 'material',
        tipo: 'alerta',
      });

      // Material inativo no exame ou fora do cadastro do exame: recusado, nada gravado.
      const contar = async () =>
        Number(
          (
            await um('SELECT COUNT(*) AS n FROM requisicao_exame WHERE paciente_id = ?', [m!.base.paciente])
          )?.['n'],
        );
      const antes = await contar();
      for (const ruim of [inativo, 4_000_000_000])
        expect(
          codigoDe(
            await servico.abrirPedido(c, { ...pedido(ruim), confirmado: true }).catch((e: unknown) => e),
          ),
        ).toBe('material-invalido');
      expect(codigoDe(await servico.avaliarPedido(c, pedido(inativo)).catch((e: unknown) => e))).toBe(
        'material-invalido',
      );
      expect(await contar()).toBe(antes);

      // Gravado com o material escolhido: fica no item, com a restrição no evento.
      const g = await servico.abrirPedido(c, { ...pedido(outro), confirmado: true });
      reqs.push(g.requisicao);
      const item = await um(
        `SELECT ei.material_biologico_id AS material, JSON_VALUE(ev.dados, '$.restricoes[0].motivo') AS motivo
         FROM exame_item ei JOIN item_exame_evento ev ON ev.exame_item_id = ei.id AND ev.evento = 'solicitado'
        WHERE ei.id = ?`,
        [g.itens[0]!.id],
      );
      expect([Number(item?.['material']), String(item?.['motivo'])]).toEqual([outro, 'material']);
    });
  },
);
