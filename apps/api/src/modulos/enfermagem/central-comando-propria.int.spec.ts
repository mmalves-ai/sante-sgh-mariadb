// Contrato de efeito da central de comando assistencial (C2-053, 01-ADM L117), no MariaDB: o tema e a regra de risco
// com critérios gravam no banco (a regra inválida é recusada sem gravar); a apuração abre a ocorrência com a gravidade
// e a evidência para o paciente com taquicardia e sem a profilaxia, não duplica na segunda apuração e encerra pelo
// sistema a que deixou de ocorrer (fora da janela), nunca apagando; a ocorrência é reconhecida e resolvida com a
// conduta (curta: recusa); o alerta de fluxo é medido no quadro e inativado sem apagar; as metas das 24 horas são
// incluídas, cumpridas e não cumpridas só com justificativa; o quadro e a visão por paciente leem tudo; trilha na
// mesma transação.
import { randomUUID } from 'node:crypto';
import { type ContextoNucleo, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLimparTrilha } from '../../teste/limpar-trilha.spec-util.js';
import {
  apurarRiscosTx,
  centralDoAtendimento,
  encerrarMetaTx,
  incluirAlertaFluxoTx,
  incluirMetaTx,
  incluirRegraTx,
  incluirTemaTx,
  inativarAlertaFluxoTx,
  passarOcorrenciaTx,
  type PedidoRegra,
  quadroDaUnidade,
  type ResultadoApuracao,
  TABELAS_ALERTA_FLUXO,
  TABELAS_META_24H,
  TABELAS_OCORRENCIA_RISCO,
  TABELAS_REGRA_RISCO,
} from './central-comando-propria.js';
import {
  CLIENTE,
  garantirCliente,
  limparMassa,
  type MassaEnfermagem,
  montarMassa,
  SEM_BANCO,
} from './massa-enfermagem.spec-util.js';
import { PortaEnfermagemPropria } from './porta-propria.js';

const MARCA = 'C2053';

describe.skipIf(SEM_BANCO)(
  'central de comando assistencial: riscos, alertas de fluxo e metas das 24 horas (MariaDB)',
  () => {
    let nucleo: NucleoProprio;
    let m: MassaEnfermagem | null = null;
    let enf: PortaEnfermagemPropria;
    let tema = 0;
    let fc = 0;
    let item = 0;
    let regraA = 0;
    let regraB = 0;
    const agora = new Date();

    const ctx = (): ContextoNucleo => ({
      cliente: CLIENTE,
      estabelecimento: m!.est,
      usuario: m!.usuario,
      correlacao: `t-${MARCA}-${randomUUID().slice(0, 8)}`,
    });
    const op = () => ({ ...ctx(), chaveIdempotencia: `t-${MARCA}-${randomUUID()}` });
    const ler = (sql: string, p: unknown[]) =>
      nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-confere` }, (l) => l.consultar(sql, p));
    const contar = async (sql: string, p: unknown[]) => Number((await ler(sql, p))[0]!['n']);
    const trilha = (entidade: string, entidadeId: number | null) => ({
      estabelecimento: null,
      usuario: null,
      correlacao: null,
      acao: 'inclusao' as const,
      entidade,
      entidadeId,
    });
    const gravar = <T>(
      nome: string,
      tabelas: readonly string[],
      ent: string,
      fn: Parameters<PortaEnfermagemPropria['gravarNaTransacao']>[4],
    ) => enf.gravarNaTransacao(op(), nome, tabelas, trilha(ent, null), fn) as Promise<T>;
    const apurar = (quando: Date) =>
      gravar<ResultadoApuracao>(
        'enfermagem.apurar-riscos',
        TABELAS_OCORRENCIA_RISCO,
        'ocorrencia_risco_clinico',
        (tx, est, an) => apurarRiscosTx(tx, est, an, m!.usuario, quando),
      );
    const ocorrencias = (regra: number) =>
      ler(
        'SELECT id, situacao, gravidade, evidencia, resolucao, reconhecido_por_usuario_id, versao FROM ocorrencia_risco_clinico WHERE regra_risco_clinico_id = ? AND atendimento_id = ? ORDER BY id',
        [regra, m!.atendimento],
      );
    const regra = (x: Partial<PedidoRegra>): PedidoRegra => ({
      codigo: `${MARCA}-X`,
      nome: 'Regra sintética',
      tema,
      fichaTecnica: null,
      paraTodaRede: false,
      gravidade: 'alta',
      sexo: 'ambos',
      idadeMinimaDias: null,
      idadeMaximaDias: null,
      combinacao: 'todos',
      janelaHoras: 6,
      vigenciaInicio: '2026-01-01',
      vigenciaFim: null,
      criterios: [],
      ...x,
    });

    async function limparMinha(): Promise<void> {
      if (!m) return;
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-limpeza` }, async (e) => {
        const minhas = `regra_risco_clinico_id IN (SELECT id FROM regra_risco_clinico WHERE codigo LIKE '${MARCA}%')`;
        await e.executar('DELETE FROM meta_cuidado_24h WHERE atendimento_id = ?', [m!.atendimento]);
        await e.executar(`DELETE FROM ocorrencia_risco_clinico WHERE ${minhas}`);
        await e.executar(`DELETE FROM regra_risco_clinico_criterio WHERE ${minhas}`);
        await e.executar(`DELETE FROM regra_risco_clinico WHERE codigo LIKE '${MARCA}%'`);
        await e.executar(`DELETE FROM tema_clinico WHERE codigo LIKE '${MARCA}%'`);
        await e.executar('DELETE FROM alerta_fluxo_unidade WHERE criado_por IN (?, ?)', [
          m!.usuario,
          m!.usuario2,
        ]);
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
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-preparo` }, async (e) => {
        const p = await e.uma('SELECT id FROM parametro_vital WHERE codigo = ?', ['fc']);
        fc = p
          ? Number(p['id'])
          : await e.inserir('INSERT INTO parametro_vital (codigo, descricao, criado_em) VALUES (?, ?, ?)', [
              'fc',
              'Frequência cardíaca',
              new Date(),
            ]);
        await e.executar('UPDATE parametro_vital SET ativo = TRUE WHERE id = ?', [fc]);
        const i = await e.uma('SELECT id FROM item_prescritivel ORDER BY id LIMIT 1');
        item = Number(i!['id']);
        // Taquicardia aferida há 1 hora no atendimento da massa.
        const a = await e.inserir(
          'INSERT INTO afericao (estabelecimento_id, paciente_id, atendimento_id, aferido_em, criado_em) VALUES (?, ?, ?, ?, ?)',
          [m!.est, m!.paciente, m!.atendimento, new Date(agora.getTime() - 3_600_000), new Date()],
        );
        await e.executar(
          'INSERT INTO afericao_valor (afericao_id, sequencia, parametro_vital_id, valor_numerico, criado_em) VALUES (?, 1, ?, 132, ?)',
          [a, fc, new Date()],
        );
      });
    }, 120_000);

    afterAll(async () => {
      await limparMinha();
      await limparMassa(nucleo, m);
      await nucleo?.encerrar?.();
    });

    it('o tema e a regra com critérios gravam; a regra inválida é recusada sem gravar', async () => {
      tema = (
        await gravar<{ id: number }>(
          'enfermagem.incluir-tema-clinico',
          TABELAS_REGRA_RISCO,
          'tema_clinico',
          (tx, _e, an) =>
            incluirTemaTx(tx, an, {
              codigo: `${MARCA}-T`,
              descricao: 'Deterioração sintética',
              categoria: 'risco_assistencial',
            }),
        )
      ).id;
      expect(tema).toBeGreaterThan(0);
      await expect(
        gravar('enfermagem.incluir-regra-risco', TABELAS_REGRA_RISCO, 'regra_risco_clinico', (tx, est, an) =>
          incluirRegraTx(tx, est, an, regra({ codigo: `${MARCA}-R`, criterios: [] })),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'sem-criterio' } });
      regraA = (
        await gravar<{ id: number }>(
          'enfermagem.incluir-regra-risco',
          TABELAS_REGRA_RISCO,
          'regra_risco_clinico',
          (tx, est, an) =>
            incluirRegraTx(
              tx,
              est,
              an,
              regra({
                codigo: `${MARCA}-A`,
                nome: 'Taquicardia sustentada',
                gravidade: 'critica',
                criterios: [
                  {
                    tipo: 'sinal_vital',
                    exame: null,
                    item: null,
                    cid: null,
                    parametroVital: fc,
                    valorMinimo: 120,
                    valorMaximo: null,
                    permanenciaMinimaHoras: null,
                    negado: false,
                  },
                ],
              }),
            ),
        )
      ).id;
      regraB = (
        await gravar<{ id: number }>(
          'enfermagem.incluir-regra-risco',
          TABELAS_REGRA_RISCO,
          'regra_risco_clinico',
          (tx, est, an) =>
            incluirRegraTx(
              tx,
              est,
              an,
              regra({
                codigo: `${MARCA}-B`,
                nome: 'Taquicardia sem a profilaxia',
                gravidade: 'moderada',
                criterios: [
                  {
                    tipo: 'sinal_vital',
                    exame: null,
                    item: null,
                    cid: null,
                    parametroVital: fc,
                    valorMinimo: 120,
                    valorMaximo: null,
                    permanenciaMinimaHoras: null,
                    negado: false,
                  },
                  {
                    tipo: 'medicamento',
                    exame: null,
                    item,
                    cid: null,
                    parametroVital: null,
                    valorMinimo: null,
                    valorMaximo: null,
                    permanenciaMinimaHoras: null,
                    negado: true,
                  },
                ],
              }),
            ),
        )
      ).id;
      expect(
        await contar("SELECT COUNT(*) AS n FROM regra_risco_clinico WHERE codigo LIKE 'C2053%'", []),
      ).toBe(2);
      expect(
        await contar(
          'SELECT COUNT(*) AS n FROM regra_risco_clinico_criterio WHERE regra_risco_clinico_id = ? AND negado AND tipo_criterio = ?',
          [regraB, 'medicamento'],
        ),
      ).toBe(1);
      expect(
        await contar(
          "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'regra_risco_clinico' AND estabelecimento_id = ?",
          [m!.est],
        ),
      ).toBeGreaterThanOrEqual(2);
    });

    it('a apuração abre com gravidade e evidência, não duplica e encerra a que deixou de ocorrer', async () => {
      const r1 = await apurar(agora);
      expect(r1.abertas).toBeGreaterThanOrEqual(2);
      const [a] = await ocorrencias(regraA);
      expect(a).toMatchObject({ situacao: 'aberta', gravidade: 'critica' });
      const [b] = await ocorrencias(regraB);
      expect(b!['gravidade']).toBe('media');
      const ev = typeof b!['evidencia'] === 'string' ? JSON.parse(String(b!['evidencia'])) : b!['evidencia'];
      expect(ev.criterios.map((c: { tipo: string; negado: boolean }) => [c.tipo, c.negado])).toEqual([
        ['sinal_vital', false],
        ['medicamento', true],
      ]);
      await apurar(agora);
      expect(await ocorrencias(regraA)).toHaveLength(1);
      expect(await ocorrencias(regraB)).toHaveLength(1);
      // Sete horas depois a aferição sai da janela de 6 horas: a B (ainda aberta) é encerrada pelo sistema.
      await apurar(new Date(agora.getTime() + 7 * 3_600_000));
      const [b2] = await ocorrencias(regraB);
      expect(b2).toMatchObject({ situacao: 'resolvida', reconhecido_por_usuario_id: m!.usuario });
      expect(String(b2!['resolucao'])).toContain('deixaram de ocorrer');
    });

    it('a ocorrência é reconhecida e resolvida com a conduta; conduta curta é recusada', async () => {
      // A apuração das 7 horas também encerrou a A (sem a aferição na janela): reabre-se pela nova apuração agora.
      expect((await ocorrencias(regraA))[0]!['situacao']).toBe('resolvida');
      await apurar(new Date());
      const [aberta] = (await ocorrencias(regraA)).filter((o) => o['situacao'] === 'aberta');
      const idAberta = Number(aberta!['id']);
      const passarAberta = (acao: 'reconhecer' | 'resolver', versao: number, resolucao: string | null) =>
        gravar<{ versao: number }>(
          'enfermagem.passar-ocorrencia-risco',
          TABELAS_OCORRENCIA_RISCO,
          'ocorrencia_risco_clinico',
          (tx, est, an) =>
            passarOcorrenciaTx(tx, est, an, m!.usuario, idAberta, { acao, versao, resolucao }, new Date()),
        );
      const r1 = await passarAberta('reconhecer', Number(aberta!['versao']), null);
      await expect(passarAberta('resolver', r1.versao, 'curto')).rejects.toMatchObject({
        problema: { codigo: 'resolucao-curta' },
      });
      await passarAberta('resolver', r1.versao, 'Avaliado pelo médico, betabloqueador prescrito');
      const final = (await ocorrencias(regraA)).find((o) => Number(o['id']) === idAberta)!;
      expect(final).toMatchObject({ situacao: 'resolvida', reconhecido_por_usuario_id: m!.usuario });
      // O histórico fica: nenhuma ocorrência apagada.
      expect((await ocorrencias(regraA)).length).toBeGreaterThanOrEqual(1);
    });

    it('o alerta de fluxo é medido no quadro e inativado sem apagar; as metas das 24 horas com justificativa', async () => {
      const u = await ler(
        'SELECT id FROM unidade_assistencial WHERE estabelecimento_id = ? ORDER BY id LIMIT 1',
        [m!.est],
      );
      const unidade = u.length ? Number(u[0]!['id']) : null;
      const alerta = await gravar<{ id: number }>(
        'enfermagem.incluir-alerta-fluxo',
        TABELAS_ALERTA_FLUXO,
        'alerta_fluxo_unidade',
        (tx, est, an) =>
          incluirAlertaFluxoTx(tx, est, an, {
            unidade,
            tipo: 'leito_bloqueado',
            unidadeLimite: 'quantidade',
            limiteAtencao: null,
            limiteCritico: 0,
            indicador: null,
          }),
      );
      if (unidade !== null)
        await expect(
          gravar(
            'enfermagem.incluir-alerta-fluxo',
            TABELAS_ALERTA_FLUXO,
            'alerta_fluxo_unidade',
            (tx, est, an) =>
              incluirAlertaFluxoTx(tx, est, an, {
                unidade,
                tipo: 'leito_bloqueado',
                unidadeLimite: 'quantidade',
                limiteAtencao: null,
                limiteCritico: 3,
                indicador: null,
              }),
          ),
        ).rejects.toMatchObject({ problema: { codigo: 'alerta-repetido' } });
      await expect(
        gravar(
          'enfermagem.incluir-alerta-fluxo',
          TABELAS_ALERTA_FLUXO,
          'alerta_fluxo_unidade',
          (tx, est, an) =>
            incluirAlertaFluxoTx(tx, est, an, {
              unidade,
              tipo: 'ocupacao',
              unidadeLimite: 'minutos',
              limiteAtencao: 90,
              limiteCritico: 95,
              indicador: null,
            }),
        ),
      ).rejects.toMatchObject({ problema: { codigo: 'unidade-incoerente' } });

      const prazo = new Date(Date.now() + 4 * 3_600_000).toISOString();
      const meta = (descricao: string) =>
        gravar<{ id: number }>(
          'enfermagem.incluir-meta-24h',
          TABELAS_META_24H,
          'meta_cuidado_24h',
          (tx, est, an) =>
            incluirMetaTx(
              tx,
              est,
              an,
              {
                atendimento: m!.atendimento,
                categoria: 'mobilizacao',
                descricao,
                prazoEm: prazo,
                ocorrencia: null,
              },
              new Date(),
            ),
        );
      const m1 = await meta('Sentar na poltrona duas vezes');
      const m2 = await meta('Retirar a sonda vesical');
      const encerrar = (id: number, situacao: 'cumprida' | 'nao_cumprida', justificativa: string | null) =>
        gravar<{ versao: number }>(
          'enfermagem.encerrar-meta-24h',
          TABELAS_META_24H,
          'meta_cuidado_24h',
          (tx, est, an) =>
            encerrarMetaTx(tx, est, an, m!.usuario, id, { versao: 1, situacao, justificativa }, new Date()),
        );
      await encerrar(m1.id, 'cumprida', null);
      await expect(encerrar(m2.id, 'nao_cumprida', null)).rejects.toMatchObject({
        problema: { codigo: 'justificativa-obrigatoria' },
      });
      await encerrar(m2.id, 'nao_cumprida', 'Paciente com dor, reavaliar amanhã cedo');
      const metas = await ler(
        'SELECT situacao, justificativa, encerrada_por_usuario_id FROM meta_cuidado_24h WHERE atendimento_id = ? ORDER BY id',
        [m!.atendimento],
      );
      expect(metas.map((x) => x['situacao'])).toEqual(['cumprida', 'nao_cumprida']);
      expect(metas.every((x) => Number(x['encerrada_por_usuario_id']) === m!.usuario)).toBe(true);

      const q = await enf.lerNoBanco(ctx(), (l, est) => quadroDaUnidade(l, est, new Date(), null));
      const meu = q.pacientes.find((p) => p.atendimento === m!.atendimento)!;
      expect(meu.metas).toHaveLength(2);
      expect(meu.cumprimento).toMatchObject({ total: 2, cumpridas: 1 });
      const a = q.alertas.find((x) => x.id === alerta.id)!;
      expect(a.medida).not.toBeNull();
      expect(['normal', 'critico']).toContain(a.nivel);
      const v = await enf.lerNoBanco(ctx(), (l, est) =>
        centralDoAtendimento(l, est, m!.atendimento, new Date()),
      );
      expect(v.ocorrencias.length).toBeGreaterThanOrEqual(3);
      expect(v.metas).toHaveLength(2);

      await gravar(
        'enfermagem.inativar-alerta-fluxo',
        TABELAS_ALERTA_FLUXO,
        'alerta_fluxo_unidade',
        (tx, est, an) => inativarAlertaFluxoTx(tx, est, an, alerta.id, 1, 'Limite revisto pela coordenação'),
      );
      expect(
        await contar('SELECT COUNT(*) AS n FROM alerta_fluxo_unidade WHERE id = ? AND NOT ativo', [
          alerta.id,
        ]),
      ).toBe(1);
      expect(
        await contar(
          "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'meta_cuidado_24h' AND estabelecimento_id = ?",
          [m!.est],
        ),
      ).toBeGreaterThanOrEqual(3);
    });
  },
);
