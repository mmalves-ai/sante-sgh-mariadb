// Contrato de efeito do transplante para a central estadual (F8, 06-SUS linha 65) contra o MariaDB real (cliente de
// teste). Massa SINTÉTICA: dois estabelecimentos com o código do teste (removidos na limpeza, com o que foi gravado
// neles); paciente, profissional e usuário são ids já existentes do cliente (só lidos, nenhum valor sai do teste); os
// órgãos são os da lista do Sistema Nacional de Transplantes (migração 13_SUS/96). Prova o que fica no banco: a
// notificação com o número pela sequência do estabelecimento, os instantes e quem gravou; as recusas sem gravar
// (protocolo invertido, encerramento sem desfecho, órgão inexistente); o encerramento com a doação efetivada e os
// órgãos; a situação que não volta; o protocolo da central; a inscrição com a linha "inclusao" no histórico; a
// duplicada recusada; a alteração de aptidão com motivo ("alteracao"); a saída da lista ("exclusao", nada apagado);
// o número da central com o envio das pendências; o CSV de conferência; o isolamento por estabelecimento e a trilha.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaTransplantePropria, SEQUENCIA_NOTIFICACAO_DOADOR } from './transplante-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o5';
const P = 'c2014tx';
const P2 = 'c2014tx2';

async function limpar(e: Escritor): Promise<void> {
  const ests = 'SELECT id FROM estabelecimento WHERE codigo IN (?, ?)';
  await e.executar(
    `DELETE FROM inscricao_transplante_historico WHERE inscricao_transplante_id IN
       (SELECT id FROM inscricao_transplante WHERE estabelecimento_id IN (${ests}))`,
    [P, P2],
  );
  await e.executar(`DELETE FROM inscricao_transplante WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM notificacao_doador WHERE estabelecimento_id IN (${ests})`, [P, P2]);
  await e.executar(`DELETE FROM sequencia_negocio WHERE tipo = ? AND estabelecimento_id IN (${ests})`, [
    SEQUENCIA_NOTIFICACAO_DOADOR,
    P,
    P2,
  ]);
  await limparTrilhaDaMassa(e, { codigos: [P, P2] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo IN (?, ?)', [P, P2]);
}

describe.skipIf(SEM_BANCO)('PortaTransplantePropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaTransplantePropria;
  let m: { est: number; usuario: number; paciente: number; prof: number; rim: number; figado: number };
  const ctx = (hospital = P) => ({ cliente: CLIENTE, hospital, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const um = async (sql: string) => {
        const r = await e.uma(sql);
        if (!r?.['id']) throw new Error(`O cliente de teste precisa de: ${sql}`);
        return Number(r['id']);
      };
      const usuario = await um('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const paciente = await um('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const prof = await um('SELECT MIN(id) AS id FROM profissional WHERE excluido_em IS NULL');
      const rim = await um("SELECT id FROM orgao_transplante WHERE codigo = 'rim'");
      const figado = await um("SELECT id FROM orgao_transplante WHERE codigo = 'figado'");
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P2, `Hospital sintético ${P2}`, `Hospital sintético ${P2} (fictício)`, agora],
      );
      return { est, usuario, paciente, prof, rim, figado };
    });
    porta = new PortaTransplantePropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
    await nucleo.encerrar?.();
  });

  let notificacao = 0;
  let inscricao = 0;

  it('notifica com número pela sequência e recusa sem gravar a notificação incoerente', async () => {
    const base = {
      paciente: m.paciente,
      tipoDoador: 'morte_encefalica',
      notificadoEm: '2026-11-01T10:00',
      notificante: m.prof,
      protocoloInicioEm: '2026-11-01T08:00',
    };
    const r = await porta.notificar(ctx(), base);
    notificacao = r.id;
    expect(r.numero).toBe('ND-1');
    const r2 = await porta.notificar(ctx(), {
      ...base,
      tipoDoador: 'coracao_parado',
      protocoloInicioEm: null,
    });
    expect(r2.numero).toBe('ND-2');
    const [n] = await ler(
      `SELECT numero, paciente_id, tipo_doador, situacao, versao, criado_por,
              DATE_FORMAT(notificado_em, '%Y-%m-%d %H:%i') AS em, DATE_FORMAT(protocolo_morte_encefalica_inicio_em, '%H:%i') AS ini
         FROM notificacao_doador WHERE id = ?`,
      [notificacao],
    );
    // 10h em São Paulo é 13h no banco (UTC).
    expect(n).toMatchObject({
      numero: 'ND-1',
      paciente_id: m.paciente,
      tipo_doador: 'morte_encefalica',
      situacao: 'notificada',
      versao: 1,
      criado_por: m.usuario,
      em: '2026-11-01 13:00',
      ini: '11:00',
    });
    await expect(
      porta.notificar(ctx(), { ...base, protocoloFimEm: '2026-11-01T07:00' }),
    ).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await expect(porta.notificar(ctx(), { ...base, situacao: 'encerrada' })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await expect(porta.notificar(ctx(), { ...base, notificante: 999_999_999 })).rejects.toMatchObject({
      problema: { status: 404 },
    });
    await expect(porta.notificar(ctx(), { ...base, paciente: undefined })).rejects.toMatchObject({
      problema: { status: 400 },
    });
    const [c] = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM notificacao_doador WHERE estabelecimento_id = ?',
      [m.est],
    );
    expect(Number(c!.n)).toBe(2);
  });

  it('encerra com a doação efetivada e os órgãos; não volta; guarda o protocolo da central', async () => {
    const completo = {
      tipoDoador: 'morte_encefalica',
      notificadoEm: '2026-11-01T10:00',
      notificante: m.prof,
      protocoloInicioEm: '2026-11-01T08:00',
      protocoloFimEm: '2026-11-01T20:00',
      abordagemFamiliarEm: '2026-11-01T21:00',
      familiaConsentiu: true,
      orgaosDoados: ['rim', 'figado'],
      desfecho: 'doacao_efetivada',
      desfechoEm: '2026-11-02T06:00',
      situacao: 'encerrada',
    };
    await expect(
      porta.alterarNotificacao(ctx(), notificacao, { ...completo, orgaosDoados: ['inexistente'], versao: 1 }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    await porta.alterarNotificacao(ctx(), notificacao, { ...completo, versao: 1 });
    await expect(
      porta.alterarNotificacao(ctx(), notificacao, {
        ...completo,
        desfecho: null,
        desfechoEm: null,
        situacao: 'em_avaliacao',
        orgaosDoados: [],
        versao: 2,
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await porta.registrarProtocolo(ctx(), notificacao, { protocoloCentral: 'CNCDO-SINT-1', versao: 2 });
    const lida = await porta.lerNotificacao(ctx(), notificacao);
    expect(lida).toMatchObject({
      situacao: 'encerrada',
      desfecho: 'doacao_efetivada',
      familiaConsentiu: true,
      orgaosDoados: ['rim', 'figado'],
      protocoloCentral: 'CNCDO-SINT-1',
      protocoloFimEm: '2026-11-01T20:00',
      versao: 3,
    });
    expect((await porta.listarNotificacoes(ctx(), m.paciente)).map((x) => x.numero)).toEqual([
      'ND-2',
      'ND-1',
    ]);
  });

  it('inscreve com histórico; duplicada recusada; aptidão com motivo; saída da lista sem apagar', async () => {
    const r = await porta.inscrever(ctx(), {
      paciente: m.paciente,
      orgao: m.rim,
      dataInscricao: '2026-10-01',
      prioridade: 'urgente',
    });
    inscricao = r.id;
    await expect(
      porta.inscrever(ctx(), { paciente: m.paciente, orgao: m.rim, dataInscricao: '2026-10-05' }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const altera = {
      dataInscricao: '2026-10-01',
      prioridade: 'urgente',
      apto: false,
      motivo: null,
      versao: 1,
    };
    await expect(porta.alterarInscricao(ctx(), inscricao, altera)).rejects.toMatchObject({
      problema: { status: 422 },
    });
    expect(
      (await porta.alterarInscricao(ctx(), inscricao, { ...altera, motivo: 'infecção ativa' })).operacao,
    ).toBe('alteracao');
    const [i] = await ler(
      `SELECT numero_inscricao_central, situacao, apto, motivo_aptidao, prioridade, versao, alterado_por,
              data_alteracao_aptidao IS NOT NULL AS aptidao_datada
         FROM inscricao_transplante WHERE id = ?`,
      [inscricao],
    );
    expect(i).toMatchObject({
      numero_inscricao_central: null,
      situacao: 'ativa',
      apto: 0,
      motivo_aptidao: 'infecção ativa',
      prioridade: 'urgente',
      versao: 2,
      alterado_por: m.usuario,
      aptidao_datada: 1,
    });
    const hist = await ler(
      'SELECT operacao, usuario_id, enviado_central_em, JSON_VALID(dados) AS valido FROM inscricao_transplante_historico WHERE inscricao_transplante_id = ? ORDER BY id',
      [inscricao],
    );
    expect(hist).toEqual([
      { operacao: 'inclusao', usuario_id: m.usuario, enviado_central_em: null, valido: 1 },
      { operacao: 'alteracao', usuario_id: m.usuario, enviado_central_em: null, valido: 1 },
    ]);
  });

  it('registra o número da central, envia as pendências, sai da lista e gera o CSV; outro estabelecimento não vê', async () => {
    await expect(porta.registrarCentral(ctx(), inscricao, { versao: 2 })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    expect(
      await porta.registrarCentral(ctx(), inscricao, { numeroCentral: 'RS-SINT-77', versao: 2 }),
    ).toEqual({
      id: inscricao,
      enviados: 2,
    });
    const saida = await porta.alterarInscricao(ctx(), inscricao, {
      dataInscricao: '2026-10-01',
      prioridade: 'urgente',
      apto: false,
      motivo: 'transplantado',
      situacao: 'transplantado',
      dataTransplante: '2026-11-02',
      notificacaoDoador: notificacao,
      numeroCentral: 'RS-SINT-77',
      versao: 3,
    });
    expect(saida.operacao).toBe('exclusao');
    const lida = await porta.lerInscricao(ctx(), inscricao);
    expect(lida).toMatchObject({
      situacao: 'transplantado',
      numeroCentral: 'RS-SINT-77',
      notificacaoDoador: notificacao,
      pendentesEnvio: 1,
      versao: 4,
    });
    expect(lida.historico.map((h) => [h.operacao, h.enviadoCentralEm === null])).toEqual([
      ['exclusao', true],
      ['alteracao', false],
      ['inclusao', false],
    ]);
    // A inscrição final não muda; uma nova inscrição do mesmo órgão volta a ser aceita.
    await expect(
      porta.alterarInscricao(ctx(), inscricao, { dataInscricao: '2026-10-01', versao: 4 }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await porta.inscrever(ctx(), { paciente: m.paciente, orgao: m.figado, dataInscricao: '2026-11-03' });
    expect((await porta.listarInscricoes(ctx(), { pendentes: true })).length).toBe(2);
    const csv = await porta.conferencia(ctx(), { situacao: 'transplantado' });
    const linhas = csv.trim().split('\r\n');
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toMatch(/^prontuario;paciente;cns;orgao/);
    expect(linhas[1]).toContain(';Rim;2026-10-01;transplantado;urgente;nao;RS-SINT-77;sim');
    const [cont] = await ler<{ n: number }>(
      `SELECT COUNT(*) AS n FROM inscricao_transplante WHERE estabelecimento_id = ? AND excluido_em IS NULL`,
      [m.est],
    );
    expect(Number(cont!.n)).toBe(2);
    expect(await porta.listarInscricoes(ctx(P2))).toEqual([]);
    expect(await porta.listarNotificacoes(ctx(P2))).toEqual([]);
    await expect(
      porta.registrarCentral(ctx(P2), inscricao, { numeroCentral: 'X', versao: 4 }),
    ).rejects.toMatchObject({
      problema: { status: 404 },
    });
    const op = await porta.opcoes(ctx());
    expect(op.orgaos.map((o) => o.id)).toEqual(expect.arrayContaining([m.rim, m.figado]));
    const [t] = await ler<{ n: number }>(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?',
      [m.est, m.usuario],
    );
    expect(Number(t!.n)).toBeGreaterThanOrEqual(9);
  });
});
