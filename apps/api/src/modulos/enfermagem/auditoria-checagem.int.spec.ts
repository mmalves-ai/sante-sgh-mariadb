// Contrato de efeito da auditoria das checagens de enfermagem (09-AREA linha 86), no MariaDB: a abertura sorteia a
// amostra só entre as checagens feitas do período (reprodutível pela semente gravada no critério) e grava auditoria,
// auditores e itens; só o responsável e os auditores avaliam (o observador não); a não conformidade pede o motivo
// padronizado e a justificativa; a conclusão só sai com a amostra toda avaliada e grava totais e resultado; a
// cancelada fica no histórico com o motivo; trilha na mesma transação. Massa sintética própria (marca C1035).
import { randomUUID } from 'node:crypto';
import { sortearAmostra } from '@sgh/dominio-enfermagem';
import { type ContextoNucleo, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlLimparTrilha } from '../../teste/limpar-trilha.spec-util.js';
import {
  abrirAuditoriaTx,
  avaliarItemTx,
  cancelarAuditoriaTx,
  concluirAuditoriaTx,
  lerAuditoria,
  listarAuditorias,
  type PedidoAbertura,
  type PedidoAvaliacao,
  TABELAS_AUDITORIA_CHECAGEM,
} from './auditoria-checagem-propria.js';
import { fusoDe, instanteDe } from './banco-apoio.js';
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

const MARCA = 'C1035';
const MOTIVO = 'C1035-MNC';
const DIA = '2025-03-10';

describe.skipIf(SEM_BANCO)('auditoria das checagens de enfermagem (09-AREA linha 86, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let m: MassaEnfermagem | null = null;
  let enf: PortaEnfermagemPropria;
  let feitas: number[] = [];
  let pendente = 0;
  let motivo = 0;

  const ctx = (usuario = m!.usuario): ContextoNucleo => ({
    cliente: CLIENTE,
    estabelecimento: m!.est,
    usuario,
    correlacao: `t-${MARCA}-${randomUUID().slice(0, 8)}`,
  });
  const uma = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-confere` }, (l) =>
      l.uma<Record<string, unknown>>(sql, p),
    );
  const trilha = (entidade: string, id: number) =>
    enf.lerNoBanco(
      { cliente: CLIENTE, estabelecimento: m!.est, usuario: m!.usuario, correlacao: `${MARCA}-l` },
      (l) =>
        l.uma<{ n: number }>(
          'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = ? AND entidade_id = ?',
          [entidade, id],
        ),
    );
  const abrir = (c: ContextoNucleo, p: Partial<PedidoAbertura> = {}) =>
    enf.gravarNaTransacao(
      c,
      'enfermagem.abrir-auditoria-checagem',
      TABELAS_AUDITORIA_CHECAGEM,
      (r: { id: number }) => ({
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'inclusao',
        entidade: 'auditoria_checagem',
        entidadeId: r.id,
      }),
      (tx, est, an) =>
        abrirAuditoriaTx(tx, est, an, {
          inicio: `${DIA}T00:00`,
          fim: `${DIA}T23:59`,
          unidade: null,
          atendimento: m!.atendimento,
          tamanho: 4,
          semente: null,
          criterio: 'Amostra mensal da UTI',
          auditores: [{ usuario: m!.usuario2, papel: 'observador' }],
          observacao: null,
          ...p,
        }),
    );
  const avaliar = (c: ContextoNucleo, a: number, item: number, p: PedidoAvaliacao) =>
    enf.gravarNaTransacao(
      c,
      'enfermagem.avaliar-auditoria-checagem',
      TABELAS_AUDITORIA_CHECAGEM,
      {
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'alteracao',
        entidade: 'auditoria_checagem_item',
        entidadeId: item,
      },
      (tx, est, an) => avaliarItemTx(tx, est, an, a, item, p),
    );
  const concluir = (c: ContextoNucleo, a: number) =>
    enf.gravarNaTransacao(
      c,
      'enfermagem.concluir-auditoria-checagem',
      TABELAS_AUDITORIA_CHECAGEM,
      {
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'alteracao',
        entidade: 'auditoria_checagem',
        entidadeId: a,
      },
      (tx, est, an) => concluirAuditoriaTx(tx, est, an, a),
    );
  const cancelar = (c: ContextoNucleo, a: number, motivoTexto: string) =>
    enf.gravarNaTransacao(
      c,
      'enfermagem.cancelar-auditoria-checagem',
      TABELAS_AUDITORIA_CHECAGEM,
      {
        estabelecimento: null,
        usuario: null,
        correlacao: null,
        acao: 'alteracao',
        entidade: 'auditoria_checagem',
        entidadeId: a,
      },
      (tx, est, an) => cancelarAuditoriaTx(tx, est, an, a, motivoTexto),
    );

  async function limparMinha(): Promise<void> {
    if (!m) return;
    const ests = [m.est, m.outroEst];
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-limpeza` }, async (e) => {
      const em = 'estabelecimento_id IN (?, ?)';
      for (const filha of ['auditoria_checagem_item', 'auditoria_checagem_auditor'])
        await e.executar(
          `DELETE x FROM ${filha} x JOIN auditoria_checagem a ON a.id = x.auditoria_checagem_id WHERE a.${em}`,
          ests,
        );
      await e.executar(`DELETE FROM auditoria_checagem WHERE ${em}`, ests);
      await e.executar(`DELETE FROM horario_administracao WHERE ${em} AND id <> ?`, [...ests, m!.horario]);
      await e.executar('DELETE FROM motivo_nao_conformidade_checagem WHERE codigo = ?', [MOTIVO]);
      for (const sql of sqlLimparTrilha(ests)) await e.executar(sql);
    });
  }

  beforeAll(async () => {
    garantirCliente();
    nucleo = new NucleoProprio();
    // Com a prescrição e os itens da massa (hemoterapia), base dos horários sintéticos do período auditado.
    m = await montarMassa(nucleo, MARCA);
    await limparMinha();
    enf = new PortaEnfermagemPropria(nucleo);
    const fuso = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: `${MARCA}-fuso` }, (l) =>
      fusoDe(l, m!.est),
    );
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `${MARCA}-preparo2` }, async (e) => {
      const agora = new Date();
      const sit = async (categoria: string) =>
        Number(
          (
            await e.uma<{ id: number }>(
              'SELECT id FROM situacao_checagem WHERE categoria = ? ORDER BY id LIMIT 1',
              [categoria],
            )
          )?.id,
        );
      const administrado = await sit('administrado');
      const pend = await sit('pendente');
      const naoAdm = await sit('nao_administrado');
      const novo = async (hora: number, situacao: number, feito: boolean) =>
        e.inserir(
          `INSERT INTO horario_administracao (estabelecimento_id, atendimento_id, prescricao_id, prescricao_item_id,
                  previsto_em, situacao_checagem_id, situacao_checagem_em, criado_em)
           SELECT estabelecimento_id, atendimento_id, prescricao_id, prescricao_item_id, ?, ?, ?, ?
             FROM horario_administracao WHERE id = ?`,
          [
            instanteDe(`${DIA}T${String(hora).padStart(2, '0')}:00`, fuso),
            situacao,
            feito ? instanteDe(`${DIA}T${String(hora).padStart(2, '0')}:05`, fuso) : null,
            agora,
            m!.horario,
          ],
        );
      feitas = [];
      for (let hora = 6; hora <= 11; hora++)
        feitas.push(Number(await novo(hora, hora === 11 ? naoAdm : administrado, true)));
      pendente = Number(await novo(12, pend, false));
      motivo = await garantir(
        e,
        'SELECT id FROM motivo_nao_conformidade_checagem WHERE codigo = ?',
        [MOTIVO],
        "INSERT INTO motivo_nao_conformidade_checagem (codigo, descricao, tipo, criado_em) VALUES (?, 'SEM LEITURA DA PULSEIRA SINTETICO', 'paciente_sem_pulseira', ?)",
        [MOTIVO, agora],
      );
    });
  }, 120_000);

  afterAll(async () => {
    if (!nucleo) return;
    await limparMinha();
    await limparMassa(nucleo, m);
    await nucleo.encerrar();
  }, 120_000);

  it('abre sorteando a amostra só entre as checagens feitas, reprodutível pela semente, com auditores e itens', async () => {
    const c = ctx();
    const r = await abrir(c);
    expect(r.candidatas).toBe(6);
    expect(r.amostra).toHaveLength(4);
    expect(r.amostra).not.toContain(pendente);
    expect(r.amostra).toEqual(sortearAmostra(feitas, 4, r.semente));
    expect(
      await uma(
        'SELECT situacao, tamanho_amostra AS t, responsavel_usuario_id AS u, atendimento_id AS a, criterio_amostra AS c FROM auditoria_checagem WHERE id = ?',
        [r.id],
      ),
    ).toMatchObject({
      situacao: 'aberta',
      t: 4,
      u: m!.usuario,
      a: m!.atendimento,
      c: expect.stringContaining(`sorteio:${r.semente}`),
    });
    expect(
      await uma(
        "SELECT COUNT(CASE WHEN papel = 'responsavel' AND usuario_id = ? THEN 1 END) AS resp, COUNT(CASE WHEN papel = 'observador' AND usuario_id = ? THEN 1 END) AS obs, COUNT(*) AS n FROM auditoria_checagem_auditor WHERE auditoria_checagem_id = ?",
        [m!.usuario, m!.usuario2, r.id],
      ),
    ).toMatchObject({ resp: 1, obs: 1, n: 2 });
    expect(
      await uma(
        "SELECT COUNT(*) AS n, COUNT(CASE WHEN resultado = 'pendente' THEN 1 END) AS p, MIN(sequencia) AS s1, MAX(sequencia) AS s4 FROM auditoria_checagem_item WHERE auditoria_checagem_id = ?",
        [r.id],
      ),
    ).toMatchObject({ n: 4, p: 4, s1: 1, s4: 4 });
    expect(await trilha('auditoria_checagem', r.id)).toMatchObject({ n: 1 });
    // A mesma semente refaz a mesma amostra; amostra maior que as candidatas fica no que existe.
    const r2 = await abrir(ctx(), { semente: r.semente, tamanho: 4 });
    expect(r2.amostra).toEqual(r.amostra);
    const r3 = await abrir(ctx(), { tamanho: 50 });
    expect(r3.amostra).toHaveLength(6);
    // Período sem checagem feita: recusa, sem gravar.
    await expect(abrir(ctx(), { inicio: '2025-03-01T00:00', fim: '2025-03-02T00:00' })).rejects.toMatchObject(
      { problema: { codigo: 'sem-checagens' } },
    );
  });

  it('avalia (só auditor; não conformidade com motivo e justificativa) e conclui com totais e resultado', async () => {
    const r = await abrir(ctx());
    const det = await enf.lerNoBanco(ctx(), (l, est) => lerAuditoria(l, est, r.id));
    expect(det.itens.map((i) => i.horario)).toEqual(r.amostra);
    expect(det.auditores.map((a) => a.papel)).toEqual(['responsavel', 'observador']);
    const [i1, i2, i3, i4] = det.itens.map((i) => i.id) as [number, number, number, number];
    // O observador não avalia.
    await expect(
      avaliar(ctx(m!.usuario2), r.id, i1, { resultado: 'conforme', motivo: null, justificativa: null }),
    ).rejects.toMatchObject({ problema: { codigo: 'nao-auditor' } });
    // Não conformidade sem motivo: recusa.
    await expect(
      avaliar(ctx(), r.id, i1, {
        resultado: 'nao_conforme',
        motivo: null,
        justificativa: 'Sem leitura da pulseira registrada',
      }),
    ).rejects.toMatchObject({ problema: { codigo: 'motivo-obrigatorio' } });
    await avaliar(ctx(), r.id, i1, {
      resultado: 'nao_conforme',
      motivo,
      justificativa: 'Sem leitura da pulseira registrada',
    });
    expect(await uma('SELECT situacao FROM auditoria_checagem WHERE id = ?', [r.id])).toMatchObject({
      situacao: 'em_andamento',
    });
    // Concluir com pendente: recusa.
    await expect(concluir(ctx(), r.id)).rejects.toMatchObject({ problema: { codigo: 'amostra-incompleta' } });
    await avaliar(ctx(), r.id, i2, { resultado: 'conforme', motivo: null, justificativa: null });
    await avaliar(ctx(), r.id, i3, { resultado: 'conforme', motivo: null, justificativa: null });
    await avaliar(ctx(), r.id, i4, {
      resultado: 'nao_aplicavel',
      motivo: null,
      justificativa: 'Dose do protocolo suspenso antes do horário',
    });
    expect(
      await uma(
        'SELECT resultado, motivo_nao_conformidade_checagem_id AS m, auditor_usuario_id AS a, auditado_em IS NOT NULL AS em, versao FROM auditoria_checagem_item WHERE id = ?',
        [i1],
      ),
    ).toMatchObject({ resultado: 'nao_conforme', m: motivo, a: m!.usuario, em: 1, versao: 2 });
    const c = await concluir(ctx(), r.id);
    expect(c).toMatchObject({
      resultado: 'nao_conforme',
      totalAuditado: 3,
      totalConforme: 2,
      naoAplicaveis: 1,
    });
    expect(
      await uma(
        'SELECT situacao, resultado, total_auditado AS t, total_conforme AS c, concluida_em IS NOT NULL AS em FROM auditoria_checagem WHERE id = ?',
        [r.id],
      ),
    ).toMatchObject({ situacao: 'concluida', resultado: 'nao_conforme', t: 3, c: 2, em: 1 });
    // Encerrada: a avaliação não muda mais.
    await expect(
      avaliar(ctx(), r.id, i2, {
        resultado: 'nao_aplicavel',
        motivo: null,
        justificativa: 'Tentativa depois de concluir',
      }),
    ).rejects.toMatchObject({ problema: { codigo: 'auditoria-encerrada' } });
    expect(await trilha('auditoria_checagem_item', i1)).toMatchObject({ n: 1 });
    const lista = await enf.lerNoBanco(ctx(), (l, est) => listarAuditorias(l, est, 'concluida'));
    expect(lista.find((a) => a.id === r.id)).toMatchObject({
      avaliados: 4,
      totalAuditado: 3,
      totalConforme: 2,
    });
  });

  it('cancela com o motivo e mantém a auditoria e a amostra no histórico', async () => {
    const r = await abrir(ctx(), { observacao: 'Primeira tentativa' });
    await expect(cancelar(ctx(), r.id, 'curto')).rejects.toMatchObject({
      problema: { codigo: 'motivo-obrigatorio' },
    });
    await cancelar(ctx(), r.id, 'Período escolhido errado pela coordenação');
    expect(
      await uma('SELECT situacao, observacao FROM auditoria_checagem WHERE id = ?', [r.id]),
    ).toMatchObject({
      situacao: 'cancelada',
      observacao: 'Primeira tentativa\nCancelada: Período escolhido errado pela coordenação',
    });
    expect(
      await uma('SELECT COUNT(*) AS n FROM auditoria_checagem_item WHERE auditoria_checagem_id = ?', [r.id]),
    ).toMatchObject({ n: 4 });
    await expect(concluir(ctx(), r.id)).rejects.toMatchObject({
      problema: { codigo: 'auditoria-encerrada' },
    });
  });
});
