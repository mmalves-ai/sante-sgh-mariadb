// Contrato de efeito dos critérios de entrada e das etapas com meta dos protocolos gerenciados (C2-042, 03-PEP L134), no
// MariaDB: o modelo de mercado da sepse grava os critérios (tipo pela categoria), a fórmula e as etapas uma vez só; o
// critério inválido e a fórmula com grupo inexistente são recusados sem gravar; o paciente com dois sinais alterados
// aparece no alerta de elegível e sai dele quando o protocolo é aberto; as etapas da inclusão guardam o prazo de cada
// meta a partir do horário zero e o retrato dos critérios avaliados; a conclusão grava meta atingida ou perdida (com
// justificativa obrigatória); só a etapa opcional é cancelada, com motivo; o critério inativado fica no banco
// (ativo = 0); trilha na mesma transação.
import { randomUUID } from 'node:crypto';
import { type ContextoNucleo, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLimparTrilha } from '../../teste/limpar-trilha.spec-util.js';
import { fusoDe, instanteDe, localNoFuso } from './banco-apoio.js';
import {
  CLIENTE,
  garantir,
  garantirCliente,
  limparMassa,
  type MassaEnfermagem,
  montarMassa,
  SEM_BANCO,
} from './massa-enfermagem.spec-util.js';
import { PortaEnfermagemPropria } from './porta-propria.js';
import {
  aplicarModeloTx,
  cancelarEtapaTx,
  concluirEtapaTx,
  definicaoProtocolo,
  elegiveisDoEstabelecimento,
  etapasDaInclusao,
  gravarFormulaTx,
  inativarCriterioTx,
  incluirCriterioTx,
  inclusoesAbertas,
  iniciarEtapasTx,
  type PedidoCriterio,
  TABELAS_CONFIG_PROTOCOLO,
  TABELAS_ETAPAS_INCLUSAO,
} from './protocolo-criterios-propria.js';

const MARCA = 'C2042';

describe.skipIf(SEM_BANCO)(
  'protocolos gerenciados: critérios, alerta e etapas com meta (03-PEP L134, MariaDB)',
  () => {
    let nucleo: NucleoProprio;
    let m: MassaEnfermagem | null = null;
    let enf: PortaEnfermagemPropria;
    let fuso = '';
    let agora = '';
    let protocolo = 0;
    let inclusao = 0;

    const ctx = (): ContextoNucleo => ({
      cliente: CLIENTE,
      estabelecimento: m!.est,
      usuario: m!.usuario,
      correlacao: `t-${MARCA}-${randomUUID().slice(0, 8)}`,
    });
    const op = () => ({ ...ctx(), chaveIdempotencia: `t-${MARCA}-${randomUUID()}` });
    const ler = <T>(sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-confere` }, (l) =>
        l.consultar<T & Record<string, unknown>>(sql, p),
      );
    const contar = async (sql: string, p: unknown[]) => Number((await ler<{ n: unknown }>(sql, p))[0]!.n);
    const lerNoBanco = <T>(fn: Parameters<PortaEnfermagemPropria['lerNoBanco']>[1]) =>
      enf.lerNoBanco(ctx(), fn) as Promise<T>;
    const trilha = (entidade: string, entidadeId: number) => ({
      estabelecimento: null,
      usuario: null,
      correlacao: null,
      acao: 'inclusao' as const,
      entidade,
      entidadeId,
    });
    const config = <T>(nome: string, fn: Parameters<PortaEnfermagemPropria['gravarNaTransacao']>[4]) =>
      enf.gravarNaTransacao(
        op(),
        nome,
        TABELAS_CONFIG_PROTOCOLO,
        trilha('protocolo_gerenciado', protocolo),
        fn,
      ) as Promise<T>;
    const naInclusao = <T>(nome: string, fn: Parameters<PortaEnfermagemPropria['gravarNaTransacao']>[4]) =>
      enf.gravarNaTransacao(
        op(),
        nome,
        TABELAS_ETAPAS_INCLUSAO,
        trilha('inclusao_protocolo_etapa', inclusao),
        fn,
      ) as Promise<T>;
    const criterio = (x: Partial<PedidoCriterio>): PedidoCriterio => ({
      finalidade: 'entrada',
      grupo: null,
      categoria: 'sinal_vital',
      campo: 'fc',
      termo: null,
      valorTexto: null,
      valorMinimo: null,
      valorMaximo: null,
      sexo: 'todos',
      idadeMinimaDias: null,
      idadeMaximaDias: null,
      validadeHoras: null,
      descricao: null,
      ...x,
    });

    async function limparMinha(): Promise<void> {
      if (!m) return;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-limpeza` }, async (e) => {
        const doMeu = `IN (SELECT id FROM protocolo_gerenciado WHERE codigo LIKE '${MARCA}%')`;
        const daInclusao = `inclusao_protocolo_paciente_id IN (SELECT id FROM inclusao_protocolo_paciente WHERE protocolo_gerenciado_id ${doMeu})`;
        await e.executar(`DELETE FROM inclusao_protocolo_criterio WHERE ${daInclusao}`);
        await e.executar(`DELETE FROM inclusao_protocolo_etapa WHERE ${daInclusao}`);
        await e.executar(`DELETE FROM inclusao_protocolo_evento WHERE ${daInclusao}`);
        await e.executar(`DELETE FROM inclusao_protocolo_paciente WHERE protocolo_gerenciado_id ${doMeu}`);
        await e.executar(`DELETE FROM protocolo_gerenciado_criterio WHERE protocolo_gerenciado_id ${doMeu}`);
        await e.executar(`DELETE FROM protocolo_gerenciado_etapa WHERE protocolo_gerenciado_id ${doMeu}`);
        await e.executar(`DELETE FROM protocolo_gerenciado WHERE codigo LIKE '${MARCA}%'`);
        await e.executar(
          'DELETE v FROM afericao_valor v JOIN afericao a ON a.id = v.afericao_id WHERE a.paciente_id = ?',
          [m!.paciente],
        );
        await e.executar('DELETE FROM afericao WHERE paciente_id = ?', [m!.paciente]);
        for (const sql of sqlLimparTrilha([m!.est, m!.outroEst])) await e.executar(sql);
      });
    }

    beforeAll(async () => {
      garantirCliente();
      nucleo = new NucleoProprio();
      m = await montarMassa(nucleo, MARCA, false);
      await limparMinha();
      enf = new PortaEnfermagemPropria(nucleo);
      fuso = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-fuso` }, (l) =>
        fusoDe(l, m!.est),
      );
      agora = localNoFuso(new Date(), fuso).slice(0, 16);
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-preparo` }, async (e) => {
        const instante = new Date();
        for (const [codigo, descricao] of [
          ['temperatura', 'Temperatura'],
          ['fc', 'Frequência cardíaca'],
          ['fr', 'Frequência respiratória'],
          ['pas', 'Pressão arterial sistólica'],
        ] as const)
          await garantir(
            e,
            'SELECT id FROM parametro_vital WHERE codigo = ?',
            [codigo],
            'INSERT INTO parametro_vital (codigo, descricao, criado_em) VALUES (?, ?, ?)',
            [codigo, descricao, instante],
          );
        await e.executar(
          "UPDATE parametro_vital SET ativo = TRUE WHERE codigo IN ('temperatura', 'fc', 'fr', 'pas')",
        );
        // Paciente adulto (o modelo da sepse vale a partir de 18 anos).
        await e.executar(
          "UPDATE pessoa_fisica SET data_nascimento = '1970-05-10' WHERE id = (SELECT pessoa_fisica_id FROM paciente WHERE id = ?)",
          [m!.paciente],
        );
        protocolo = await e.inserir(
          `INSERT INTO protocolo_gerenciado (estabelecimento_id, codigo, nome, tipo, publico, situacao, mensagem_alerta, criado_em)
         VALUES (?, ?, 'SEPSE SINTETICO', 'sepse', 'adulto', 'ativo', 'Paciente com sinais de sepse', ?)`,
          [m!.est, `${MARCA}-${randomUUID().slice(0, 8)}`, instante],
        );
      });
    }, 120_000);

    afterAll(async () => {
      await limparMinha();
      await limparMassa(nucleo, m);
      await nucleo?.encerrar();
    });

    it('o modelo de mercado grava os critérios, a fórmula e as metas uma vez só', async () => {
      const r = await config<{ etapas: number; criterios: number; formula: boolean }>(
        'enfermagem.aplicar-modelo-protocolo',
        (tx, est, an) => aplicarModeloTx(tx, est, an, protocolo),
      );
      expect(r).toEqual({ etapas: 6, criterios: 5, formula: true });
      const crit = await ler<{ categoria: string; campo: string; ativo: unknown }>(
        `SELECT t.categoria, c.campo, c.ativo FROM protocolo_gerenciado_criterio c
         JOIN tipo_criterio_clinico t ON t.id = c.tipo_criterio_clinico_id WHERE c.protocolo_gerenciado_id = ? ORDER BY c.sequencia`,
        [protocolo],
      );
      expect(crit.map((c) => c.campo)).toEqual(['temperatura', 'temperatura', 'fc', 'fr', 'pas']);
      expect(new Set(crit.map((c) => c.categoria))).toEqual(new Set(['sinal_vital']));
      const metas = await ler<{ meta_minutos: unknown; obrigatoria: unknown }>(
        'SELECT meta_minutos, obrigatoria FROM protocolo_gerenciado_etapa WHERE protocolo_gerenciado_id = ? ORDER BY sequencia',
        [protocolo],
      );
      expect(metas.map((x) => Number(x.meta_minutos))).toEqual([60, 60, 60, 180, 60, 360]);
      const formula = await ler<{ formula_entrada: string }>(
        'SELECT formula_entrada FROM protocolo_gerenciado WHERE id = ?',
        [protocolo],
      );
      expect(formula[0]!.formula_entrada).toMatch(/^PELO_MENOS 2/);
      const denovo = await config<{ etapas: number; criterios: number; formula: boolean }>(
        'enfermagem.aplicar-modelo-protocolo',
        (tx, est, an) => aplicarModeloTx(tx, est, an, protocolo),
      );
      expect(denovo).toEqual({ etapas: 0, criterios: 0, formula: false });
      expect(
        await contar(
          "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'protocolo_gerenciado' AND entidade_id = ?",
          [protocolo],
        ),
      ).toBeGreaterThanOrEqual(2);
    });

    it('recusa o critério inválido e a fórmula com grupo inexistente, sem gravar', async () => {
      const antes = await contar(
        'SELECT COUNT(*) AS n FROM protocolo_gerenciado_criterio WHERE protocolo_gerenciado_id = ?',
        [protocolo],
      );
      await expect(
        config('enfermagem.incluir-criterio-protocolo', (tx, est, an) =>
          incluirCriterioTx(tx, est, an, protocolo, criterio({ valorMinimo: 100, valorMaximo: 50 })),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'faixa-invertida' } });
      await expect(
        config('enfermagem.incluir-criterio-protocolo', (tx, est, an) =>
          incluirCriterioTx(tx, est, an, protocolo, criterio({ campo: 'inexistente_x', valorMinimo: 1 })),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'sinal-inexistente' } });
      const def = await lerNoBanco<Awaited<ReturnType<typeof definicaoProtocolo>>>((l, est) =>
        definicaoProtocolo(l, est, protocolo),
      );
      await expect(
        config('enfermagem.gravar-formula-protocolo', (tx, est, an) =>
          gravarFormulaTx(tx, est, an, protocolo, def.protocolo.versao, 'temperatura E lactato'),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'formula-invalida' } });
      expect(
        await contar(
          'SELECT COUNT(*) AS n FROM protocolo_gerenciado_criterio WHERE protocolo_gerenciado_id = ?',
          [protocolo],
        ),
      ).toBe(antes);
      expect(def.problemaFormula).toBeNull();
    });

    it('o paciente com dois sinais alterados aparece no alerta de elegível', async () => {
      const elegiveis = () =>
        lerNoBanco<Awaited<ReturnType<typeof elegiveisDoEstabelecimento>>>((l, est) =>
          elegiveisDoEstabelecimento(l, est, agora),
        );
      const meu = (r: Awaited<ReturnType<typeof elegiveis>>) =>
        r.alertas.filter((a) => a.protocolo === protocolo && a.atendimento === m!.atendimento);
      expect(meu(await elegiveis())).toHaveLength(0);
      const hora = localNoFuso(new Date(Date.now() - 20 * 60_000), fuso).slice(0, 16);
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-afericao` }, async (e) => {
        const instante = new Date();
        const a = await e.inserir(
          'INSERT INTO afericao (estabelecimento_id, paciente_id, atendimento_id, aferido_em, criado_em) VALUES (?, ?, ?, ?, ?)',
          [m!.est, m!.paciente, m!.atendimento, instanteDe(hora, fuso), instante],
        );
        let seq = 0;
        for (const [codigo, valor] of [
          ['temperatura', 38.9],
          ['fc', 118],
          ['pas', 120],
        ] as const)
          await e.executar(
            `INSERT INTO afericao_valor (afericao_id, sequencia, parametro_vital_id, valor_numerico, criado_em)
           VALUES (?, ?, (SELECT id FROM parametro_vital WHERE codigo = ?), ?, ?)`,
            [a, ++seq, codigo, valor, instante],
          );
      });
      const r = meu(await elegiveis());
      expect(r).toHaveLength(1);
      expect(r[0]!.criteriosAtendidos).toHaveLength(2);
      expect(r[0]!.regraAvaliada).toContain('hipotensao: não');
      expect(r[0]!.desde).toBe(hora);

      // O protocolo aberto tira o paciente do alerta (horário zero 90 min atrás: a meta de 60 min já venceu).
      const zero = localNoFuso(new Date(Date.now() - 90 * 60_000), fuso).slice(0, 16);
      inclusao = await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-inclusao` }, (e) =>
        e.inserir(
          `INSERT INTO inclusao_protocolo_paciente (estabelecimento_id, protocolo_gerenciado_id, paciente_id, atendimento_id,
           forma_inclusao, horario_zero_em, situacao, aceito_por_usuario_id, aceito_em, criado_em)
         VALUES (?, ?, ?, ?, 'alerta_automatico', ?, 'ativo', ?, ?, ?)`,
          [
            m!.est,
            protocolo,
            m!.paciente,
            m!.atendimento,
            instanteDe(zero, fuso),
            m!.usuario,
            new Date(),
            new Date(),
          ],
        ),
      );
      expect(meu(await elegiveis())).toHaveLength(0);
    });

    it('as etapas da inclusão guardam o prazo de cada meta e o retrato dos critérios', async () => {
      const r = await naInclusao<{ etapas: number; criterios: number; elegivel: boolean }>(
        'enfermagem.iniciar-etapas-protocolo',
        (tx, est, an) => iniciarEtapasTx(tx, est, an, inclusao, agora),
      );
      expect(r).toMatchObject({ etapas: 6, criterios: 5, elegivel: true });
      const linhas = await ler<{ minutos: unknown; situacao: string }>(
        `SELECT TIMESTAMPDIFF(MINUTE, ie.iniciada_em, ie.prazo_meta_em) AS minutos, ie.situacao FROM inclusao_protocolo_etapa ie
        WHERE ie.inclusao_protocolo_paciente_id = ? ORDER BY ie.sequencia`,
        [inclusao],
      );
      expect(linhas.map((x) => Number(x.minutos))).toEqual([60, 60, 60, 180, 60, 360]);
      expect(new Set(linhas.map((x) => x.situacao))).toEqual(new Set(['em_andamento']));
      expect(
        await contar(
          'SELECT COUNT(*) AS n FROM inclusao_protocolo_criterio WHERE inclusao_protocolo_paciente_id = ? AND atendido',
          [inclusao],
        ),
      ).toBe(2);
      const abertos = await lerNoBanco<Awaited<ReturnType<typeof inclusoesAbertas>>>((l, est) =>
        inclusoesAbertas(l, est, agora),
      );
      expect(abertos.find((x) => x.inclusao === inclusao)).toMatchObject({
        etapas: 6,
        pendentes: 6,
        vencidas: 4,
      });
      await expect(
        naInclusao('enfermagem.iniciar-etapas-protocolo', (tx, est, an) =>
          iniciarEtapasTx(tx, est, an, inclusao, agora),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'etapas-ja-iniciadas' } });
    });

    it('conclui com meta atingida ou perdida (justificativa obrigatória) e cancela só a opcional', async () => {
      const tela = () =>
        lerNoBanco<Awaited<ReturnType<typeof etapasDaInclusao>>>((l, est) =>
          etapasDaInclusao(l, est, inclusao, agora),
        );
      let t = await tela();
      const [lactato, , , cristaloide] = t.etapas;
      expect(lactato!.estado).toBe('vencida');
      expect(cristaloide!.estado).toBe('no_prazo');
      const concluir = (id: number, versao: number, justificativa: string | null) =>
        naInclusao<{ situacao: string }>('enfermagem.concluir-etapa-protocolo', (tx, est, an) =>
          concluirEtapaTx(
            tx,
            est,
            an,
            id,
            { versao, concluidaEm: agora, justificativa, usuario: m!.usuario },
            agora,
          ),
        );
      await expect(concluir(lactato!.id, lactato!.versao, null)).rejects.toMatchObject({
        problema: { codigo: 'justificativa-obrigatoria' },
      });
      expect(
        (await concluir(lactato!.id, lactato!.versao, 'Coleta atrasada por acesso venoso difícil.')).situacao,
      ).toBe('meta_perdida');
      expect((await concluir(cristaloide!.id, cristaloide!.versao, null)).situacao).toBe('meta_atingida');
      t = await tela();
      const [, hemocultura, , , vasopressor] = t.etapas;
      const cancelar = (id: number, versao: number) =>
        naInclusao<{ situacao: string }>('enfermagem.cancelar-etapa-protocolo', (tx, est, an) =>
          cancelarEtapaTx(
            tx,
            est,
            an,
            id,
            { versao, motivo: 'Sem hipotensão persistente.', usuario: m!.usuario },
            agora,
          ),
        );
      await expect(cancelar(hemocultura!.id, hemocultura!.versao)).rejects.toMatchObject({
        problema: { codigo: 'etapa-obrigatoria' },
      });
      expect((await cancelar(vasopressor!.id, vasopressor!.versao)).situacao).toBe('cancelada');
      const fim = await ler<{ situacao: string; com_hora: unknown; obs: unknown; resp: unknown }>(
        `SELECT situacao, concluida_em IS NOT NULL AS com_hora, observacao IS NOT NULL AS obs, responsavel_usuario_id AS resp
         FROM inclusao_protocolo_etapa WHERE inclusao_protocolo_paciente_id = ? ORDER BY sequencia`,
        [inclusao],
      );
      expect(fim.map((x) => x.situacao)).toEqual([
        'meta_perdida',
        'em_andamento',
        'em_andamento',
        'meta_atingida',
        'cancelada',
        'em_andamento',
      ]);
      expect(Number(fim[0]!.obs)).toBe(1);
      expect(Number(fim[0]!.resp)).toBe(m!.usuario);
      t = await tela();
      expect([t.cumpridas, t.perdidas]).toEqual([1, 1]);
      expect(
        await contar(
          "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'inclusao_protocolo_etapa' AND estabelecimento_id = ?",
          [m!.est],
        ),
      ).toBeGreaterThanOrEqual(4);
    });

    it('o critério inativado fica no banco; a fórmula não fica apontando para grupo vazio', async () => {
      const def = await lerNoBanco<Awaited<ReturnType<typeof definicaoProtocolo>>>((l, est) =>
        definicaoProtocolo(l, est, protocolo),
      );
      const pas = def.criterios.find((c) => c.campo === 'pas')!;
      const hipotermia = def.criterios.find((c) => c.campo === 'temperatura' && c.valorMaximo !== null)!;
      const inativar = (id: number, versao: number) =>
        config('enfermagem.inativar-criterio-protocolo', (tx, est, an) =>
          inativarCriterioTx(tx, est, an, id, versao, 'Revisão do protocolo pela comissão.'),
        );
      await expect(inativar(pas.id, pas.versao)).rejects.toMatchObject({
        problema: { codigo: 'formula-quebrada' },
      });
      await inativar(hipotermia.id, hipotermia.versao);
      const r = await ler<{ ativo: unknown }>(
        'SELECT ativo FROM protocolo_gerenciado_criterio WHERE id IN (?, ?) ORDER BY id',
        [Math.min(pas.id, hipotermia.id), Math.max(pas.id, hipotermia.id)],
      );
      expect(r).toHaveLength(2);
      expect(r.map((x) => Number(x.ativo)).sort()).toEqual([0, 1]);
    });
  },
);
