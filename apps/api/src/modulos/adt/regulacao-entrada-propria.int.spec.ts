// Contrato de efeito da regulação de entrada (C1-080, 02-REC linha 38) contra o MariaDB real (cliente de teste). Massa
// SINTÉTICA: um estabelecimento com o código do teste e duas centrais de regulação fictícias (uma de registro manual e
// outra ligada por webservice); usuário, paciente e especialidade são ids já existentes do cliente de teste (só lidos,
// nunca alterados).
// Prova o que fica no banco: o pedido recebido em `solicitacao_regulacao` (sentido 'entrada', 'solicitada', número,
// tipo, prioridade, paciente, resumo) com o evento do recebimento; o aceite (autorizada, regulado_em) e a recusa com o
// motivo padronizado (negada, encerrado_em) com o evento 'resposta'; no aceite de consulta, a entrada em `lista_espera`
// ligada ao pedido; com a central por webservice, a devolução na outbox (`integracao_mensagem`, só IDs e códigos); as
// recusas (número repetido, urgência sem resumo, versão velha, pedido já respondido, recusa sem motivo, consulta sem
// especialidade) sem gravar nada; a fila dos recebidos e a trilha das operações.
// SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaRegulacaoEntradaPropria } from './regulacao-entrada-propria.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o4';
const P = 'c1080re';
const SIGLA_MANUAL = 'C1080-MAN';
const SIGLA_WS = 'C1080-WS';

interface Massa {
  est: number;
  usuario: number;
  paciente: number;
  especialidade: number;
  manual: number;
  ws: number;
}

async function limpar(e: Escritor): Promise<void> {
  const est = '(SELECT id FROM estabelecimento WHERE codigo = ?)';
  const sol = `(SELECT id FROM solicitacao_regulacao WHERE estabelecimento_id IN ${est})`;
  await e.executar('SET FOREIGN_KEY_CHECKS = 0');
  try {
    await e.executar(`DELETE FROM lista_espera WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar(`DELETE FROM evento_regulacao WHERE solicitacao_regulacao_id IN ${sol}`, [P]);
    await e.executar(
      `DELETE FROM integracao_mensagem WHERE estabelecimento_id IN ${est} AND entidade = 'solicitacao_regulacao'`,
      [P],
    );
    await e.executar(`DELETE FROM solicitacao_regulacao WHERE estabelecimento_id IN ${est}`, [P]);
    await e.executar('DELETE FROM central_reguladora WHERE sigla IN (?, ?)', [SIGLA_MANUAL, SIGLA_WS]);
  } finally {
    await e.executar('SET FOREIGN_KEY_CHECKS = 1');
  }
  await limparTrilhaDaMassa(e, { codigos: [P] });
  await e.executar('DELETE FROM estabelecimento WHERE codigo = ?', [P]);
}

const json = (v: unknown): unknown => (typeof v === 'string' ? JSON.parse(v) : v);
const haMinutos = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

describe.skipIf(SEM_BANCO)('PortaRegulacaoEntradaPropria contra o MariaDB (contrato de efeito)', () => {
  let nucleo: NucleoProprio;
  let porta: PortaRegulacaoEntradaPropria;
  let m: Massa;
  const ctx = () => ({ cliente: CLIENTE, hospital: P, usuario: m.usuario, correlacao: P });
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[] = []) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: P }, (l) => l.consultar(sql, p)) as Promise<T[]>;
  const linha = async (id: number) =>
    (await ler('SELECT * FROM solicitacao_regulacao WHERE id = ?', [id]))[0]!;
  const contar = async (tabela: 'solicitacao_regulacao' | 'lista_espera' | 'integracao_mensagem') =>
    Number(
      (
        await ler(
          tabela === 'integracao_mensagem'
            ? "SELECT COUNT(*) AS n FROM integracao_mensagem WHERE estabelecimento_id = ? AND entidade = 'solicitacao_regulacao'"
            : tabela === 'lista_espera'
              ? 'SELECT COUNT(*) AS n FROM lista_espera WHERE estabelecimento_id = ?'
              : 'SELECT COUNT(*) AS n FROM solicitacao_regulacao WHERE estabelecimento_id = ?',
          [m.est],
        )
      )[0]!['n'],
    );
  const eventos = (id: number) =>
    ler('SELECT * FROM evento_regulacao WHERE solicitacao_regulacao_id = ? ORDER BY id', [id]);

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    m = await nucleo.escrever({ cliente: CLIENTE, correlacao: `preparo-${P}` }, async (e) => {
      await limpar(e);
      const agora = new Date();
      const usuario = await e.uma('SELECT MIN(id) AS id FROM usuario WHERE excluido_em IS NULL');
      const paciente = await e.uma('SELECT MIN(id) AS id FROM paciente WHERE excluido_em IS NULL');
      const especialidade = await e.uma('SELECT MIN(id) AS id FROM especialidade_medica WHERE ativo = TRUE');
      if (!usuario?.['id'] || !paciente?.['id'] || !especialidade?.['id'])
        throw new Error('O cliente de teste precisa de usuário, paciente e especialidade.');
      const est = await e.inserir(
        `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, fuso_horario, criado_em)
         VALUES (?, ?, ?, 'America/Sao_Paulo', ?)`,
        [P, `Hospital sintético ${P}`, `Hospital sintético ${P} (fictício)`, agora],
      );
      const central = (sigla: string, conexao: string, ponto: string | null) =>
        e.inserir(
          `INSERT INTO central_reguladora (sigla, nome, esfera, forma_conexao, ponto_integracao, telefone, criado_em)
           VALUES (?, ?, 'estadual', ?, ?, '0000-0000', ?)`,
          [sigla, `Central sintética ${sigla}`, conexao, ponto, agora],
        );
      return {
        est,
        usuario: Number(usuario['id']),
        paciente: Number(paciente['id']),
        especialidade: Number(especialidade['id']),
        manual: await central(SIGLA_MANUAL, 'manual', null),
        ws: await central(SIGLA_WS, 'webservice', 'regulacao_teste_c1080'),
      };
    });
    porta = new PortaRegulacaoEntradaPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (nucleo) {
      await nucleo.escrever({ cliente: CLIENTE, correlacao: `limpeza-${P}` }, limpar);
      await nucleo.encerrar?.();
    }
  });

  it('recebe o pedido de internação da central manual, aceita e registra a devolução manual', async () => {
    const op = await porta.opcoes(ctx());
    expect(op.centrais.map((x) => x.sigla)).toEqual(expect.arrayContaining([SIGLA_MANUAL, SIGLA_WS]));
    expect(op.especialidades.length).toBeGreaterThan(0);

    const r = await porta.receber(ctx(), {
      central: m.manual,
      numero: 'reg-c1080-001',
      tipo: 'internacao',
      prioridade: 'urgente',
      paciente: m.paciente,
      solicitadoEm: haMinutos(30),
      resumoClinico: 'Quadro sintético de teste, estável, aguarda leito clínico.',
      observacao: 'Recebido por telefone',
    });
    const s = await linha(r.id);
    expect(s).toMatchObject({
      estabelecimento_id: m.est,
      central_reguladora_id: m.manual,
      numero: 'REG-C1080-001',
      sentido: 'entrada',
      tipo_solicitacao: 'internacao',
      prioridade: 'urgente',
      situacao: 'solicitada',
      paciente_id: m.paciente,
      origem: 'sistema',
      regulado_em: null,
      encerrado_em: null,
    });
    expect(Number(s['criado_por'])).toBe(m.usuario);
    expect((await eventos(r.id)).map((x) => [x['tipo_evento'], x['situacao_nova']])).toEqual([
      ['contato_central', 'solicitada'],
    ]);

    // Recusas sem gravar: número repetido na mesma central, urgência sem resumo, central inexistente.
    const antes = await contar('solicitacao_regulacao');
    await expect(
      porta.receber(ctx(), {
        central: m.manual,
        numero: 'REG-C1080-001',
        tipo: 'internacao',
        prioridade: 'eletivo',
        paciente: m.paciente,
      }),
    ).rejects.toMatchObject({ problema: { status: 409 } });
    await expect(
      porta.receber(ctx(), {
        central: m.manual,
        numero: 'REG-C1080-002',
        tipo: 'internacao',
        prioridade: 'emergencia',
        paciente: m.paciente,
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    await expect(
      porta.receber(ctx(), {
        central: 999_999_999,
        numero: 'REG-C1080-003',
        tipo: 'internacao',
        prioridade: 'eletivo',
        paciente: m.paciente,
      }),
    ).rejects.toMatchObject({ problema: { status: 404 } });
    expect(await contar('solicitacao_regulacao')).toBe(antes);

    // Versão velha e motivo no aceite são recusados; o aceite autoriza sem encerrar e sem outbox.
    const v = Number(s['versao']);
    await expect(porta.responder(ctx(), r.id, { decisao: 'aceitar', versao: v + 7 })).rejects.toMatchObject({
      problema: { status: 409 },
    });
    await expect(
      porta.responder(ctx(), r.id, { decisao: 'aceitar', motivo: 'outro', versao: v }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    const ok = await porta.responder(ctx(), r.id, { decisao: 'aceitar', versao: v });
    expect(ok).toMatchObject({ situacao: 'autorizada', listaEspera: null, devolucao: 'manual' });
    const depois = await linha(r.id);
    expect(depois).toMatchObject({
      situacao: 'autorizada',
      encerrado_em: null,
      mensagem_central: 'Pedido aceito',
    });
    expect(depois['regulado_em']).not.toBeNull();
    const evs = await eventos(r.id);
    expect(evs.map((x) => [x['tipo_evento'], x['situacao_anterior'], x['situacao_nova']])).toEqual([
      ['contato_central', null, 'solicitada'],
      ['resposta', 'solicitada', 'autorizada'],
    ]);
    expect(evs[1]!['integracao_mensagem_id']).toBeNull();
    expect(json(evs[1]!['dados'])).toMatchObject({ decisao: 'aceitar', devolucao: 'manual' });
    expect(await contar('integracao_mensagem')).toBe(0);

    // Já respondido: nova resposta recusada.
    await expect(
      porta.responder(ctx(), r.id, {
        decisao: 'recusar',
        motivo: 'sem_leito_compativel',
        versao: Number(depois['versao']),
      }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
  });

  it('aceita a consulta regulada pela central conectada: lista de espera ligada e devolução pela outbox', async () => {
    const r = await porta.receber(ctx(), {
      central: m.ws,
      numero: 'WS-C1080-010',
      tipo: 'consulta',
      prioridade: 'prioritario',
      paciente: m.paciente,
    });
    const v = Number((await linha(r.id))['versao']);
    await expect(porta.responder(ctx(), r.id, { decisao: 'aceitar', versao: v })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    expect(await contar('lista_espera')).toBe(0);
    const ok = await porta.responder(ctx(), r.id, {
      decisao: 'aceitar',
      especialidade: m.especialidade,
      complemento: 'Agenda na próxima semana',
      versao: v,
    });
    expect(ok).toMatchObject({ situacao: 'autorizada', devolucao: 'conector' });
    const [le] = await ler('SELECT * FROM lista_espera WHERE solicitacao_regulacao_id = ?', [r.id]);
    expect(le).toMatchObject({
      estabelecimento_id: m.est,
      paciente_id: m.paciente,
      especialidade_medica_id: m.especialidade,
      prioridade: 'preferencial',
      situacao: 'aguardando',
      responsavel_usuario_id: m.usuario,
    });
    expect(Number(le!['id'])).toBe(ok.listaEspera);
    const [msg] = await ler(
      "SELECT * FROM integracao_mensagem WHERE entidade = 'solicitacao_regulacao' AND entidade_id = ?",
      [r.id],
    );
    expect(msg).toMatchObject({ ponto: 'regulacao_teste_c1080', direcao: 'saida', situacao: 'pendente' });
    expect(json(msg!['conteudo'])).toEqual({
      solicitacao: r.id,
      numero: 'WS-C1080-010',
      resposta: 'aceito',
      motivo: null,
    });
    const evs = await eventos(r.id);
    expect(Number(evs.at(-1)!['integracao_mensagem_id'])).toBe(Number(msg!['id']));
  });

  it('recusa com motivo padronizado, encerra o pedido e mostra a fila dos recebidos', async () => {
    const a = await porta.receber(ctx(), {
      central: m.manual,
      numero: 'REG-C1080-020',
      tipo: 'cirurgia',
      prioridade: 'eletivo',
      paciente: m.paciente,
      solicitadoEm: haMinutos(120),
    });
    const b = await porta.receber(ctx(), {
      central: m.manual,
      numero: 'REG-C1080-021',
      tipo: 'transferencia',
      prioridade: 'emergencia',
      paciente: m.paciente,
      solicitadoEm: haMinutos(10),
      resumoClinico: 'Quadro sintético de emergência para o teste.',
    });
    const fila = await porta.recebidos(ctx(), {});
    expect(fila.map((x) => x.id)).toEqual([b.id, a.id]);
    expect(fila[0]!.eventos).toHaveLength(1);

    const v = Number((await linha(a.id))['versao']);
    await expect(porta.responder(ctx(), a.id, { decisao: 'recusar', versao: v })).rejects.toMatchObject({
      problema: { status: 422 },
    });
    await expect(
      porta.responder(ctx(), a.id, { decisao: 'recusar', motivo: 'outro', complemento: 'curto', versao: v }),
    ).rejects.toMatchObject({ problema: { status: 422 } });
    expect((await linha(a.id))['situacao']).toBe('solicitada');
    const ok = await porta.responder(ctx(), a.id, {
      decisao: 'recusar',
      motivo: 'outro',
      complemento: 'Sala cirúrgica em reforma até o fim do mês',
      versao: v,
    });
    expect(ok).toMatchObject({ situacao: 'negada', listaEspera: null, devolucao: 'manual' });
    const s = await linha(a.id);
    expect(s).toMatchObject({
      situacao: 'negada',
      mensagem_central: 'Outro motivo: Sala cirúrgica em reforma até o fim do mês',
    });
    expect(s['encerrado_em']).not.toBeNull();
    const ev = (await eventos(a.id)).at(-1)!;
    expect(json(ev['dados'])).toMatchObject({ decisao: 'recusar', motivo: 'outro' });

    // A fila mostra só os que pedem resposta; `todos` traz os respondidos depois, sem apagar nada.
    expect((await porta.recebidos(ctx(), {})).map((x) => x.id)).toEqual([b.id]);
    const todos = await porta.recebidos(ctx(), { todos: 'sim' });
    expect(todos[0]!.id).toBe(b.id);
    expect(todos.map((x) => x.situacao)).toEqual(
      expect.arrayContaining(['negada', 'autorizada', 'solicitada']),
    );
    expect(todos.find((x) => x.id === a.id)!.eventos.at(-1)).toMatchObject({
      tipo: 'resposta',
      motivo: 'outro',
      devolucao: 'manual',
    });
    expect(await contar('solicitacao_regulacao')).toBe(4);

    const [tr] = await ler(
      'SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ? AND usuario_id = ?',
      [m.est, m.usuario],
    );
    // 4 recebimentos + 3 respostas.
    expect(Number(tr!['n'])).toBeGreaterThanOrEqual(7);
  });
});
