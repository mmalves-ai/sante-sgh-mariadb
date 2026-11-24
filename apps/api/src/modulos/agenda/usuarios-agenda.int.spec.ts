// Contrato de efeito da lista nominal de usuários por agenda (02-AGE linha 40) contra o MariaDB real, no cliente de
// teste (f22_o1 por padrão). Massa SINTÉTICA própria (estabelecimento f322u, logins teste.f322u.*), idempotente; os
// registros do lote são limpos antes e depois. Prova: a linha em agenda_usuario (pode_marcar, versao, exclusão
// lógica sem apagar), a trilha na mesma transação, as recusas do domínio, a agenda restrita sumindo da leitura de
// quem não está na lista e a marcação recusada para quem não marca nela. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { PortaAgendaPropria } from './porta-propria.js';
import { UsuariosAgendaPropria } from './usuarios-agenda.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o1';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'f322u';
const LOGINS = { a: 'teste.f322u.a', b: 'teste.f322u.b', c: 'teste.f322u.c' } as const;

describe.skipIf(SEM_BANCO)('lista nominal de usuários por agenda (porta própria, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let usuarios: UsuariosAgendaPropria;
  let porta: PortaAgendaPropria;
  const ids = { est: 0, agenda: 0, a: 0, b: 0, c: 0 };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = (e: Escritor) =>
    e.executar(
      'DELETE au FROM agenda_usuario au JOIN agenda_servico a ON a.id = au.agenda_servico_id WHERE a.estabelecimento_id = ?',
      [ids.est],
    );
  const ler = <T>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-f322u' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctxU = (login: string, gestor = false) => ({ hospital: EST, login, gestor });
  const gravar = (login: string, entrada: Record<string, unknown>) =>
    usuarios.definir(
      { ...ctxU(login, true), correlacao: 'teste-f322u', chaveIdempotencia: `f322u-${randomUUID()}` },
      { agenda: ids.agenda, ...entrada },
    );
  const ctxPorta = (login: string, gestorDeAgendas = false) => ({
    rede: 'teste',
    hospital: EST,
    login,
    gestorDeAgendas,
    correlacao: 'teste-f322u',
    chaveIdempotencia: `f322u-${randomUUID()}`,
  });
  const trilhas = async () =>
    Number(
      (
        await ler<{ n: number }>(
          "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'agenda_servico' AND entidade_id = ?",
          [ids.agenda],
        )
      )[0]?.n ?? 0,
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-f322u' }, async (e) => {
      const agora = new Date();
      ids.est = await garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [EST],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [EST, `Hospital sintético ${EST}`, `Hospital sintético ${EST} (fictício)`, agora],
      );
      for (const k of ['a', 'b', 'c'] as const)
        ids[k] = await garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [LOGINS[k]],
          'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
          [LOGINS[k], `USUARIO SINTETICO F322U ${k.toUpperCase()}`, agora],
        );
      const pf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        ['PROFISSIONAL SINTETICO F322U'],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        ['PROFISSIONAL SINTETICO F322U', agora],
      );
      const prof = await garantir(
        e,
        'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
        [pf],
        "INSERT INTO profissional (pessoa_fisica_id, tipo, criado_em) VALUES (?, 'corpo_clinico', ?)",
        [pf, agora],
      );
      const cat = await garantir(
        e,
        'SELECT id FROM categoria_agenda WHERE codigo = ?',
        ['f322u-consulta'],
        'INSERT INTO categoria_agenda (codigo, descricao, criado_em) VALUES (?, ?, ?)',
        ['f322u-consulta', 'Sintético f322u', agora],
      );
      ids.agenda = await garantir(
        e,
        'SELECT id FROM agenda_servico WHERE estabelecimento_id = ? AND nome = ?',
        [ids.est, 'AGENDA SINTETICA F322U'],
        `INSERT INTO agenda_servico (estabelecimento_id, nome, categoria_agenda_id, profissional_id, duracao_horario_minutos, criado_em)
         VALUES (?, ?, ?, ?, 15, ?)`,
        [ids.est, 'AGENDA SINTETICA F322U', cat, prof, agora],
      );
      await limpar(e);
    });
    usuarios = new UsuariosAgendaPropria(nucleo, CLIENTE);
    porta = new PortaAgendaPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-f322u' }, async (e) => {
      await limpar(e);
      await limparTrilhaDaMassa(e, { ids: [ids.est] });
    });
    await nucleo.encerrar();
  });

  it('agenda sem lista é livre: todos do escopo veem e a lista vem vazia', async () => {
    expect(await usuarios.lista(ctxU(LOGINS.c), ids.agenda)).toMatchObject({
      restrita: false,
      usuarios: [],
      meuAcesso: 'livre',
    });
    expect((await porta.agendas(ctxPorta(LOGINS.c))).map((a) => a.id)).toContain(ids.agenda);
  });

  it('a lista não nasce sem quem marca e não aceita usuário inexistente (nada gravado)', async () => {
    await expect(
      gravar(LOGINS.a, { acao: 'incluir', usuario: ids.b, podeMarcar: false }),
    ).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'lista-sem-quem-marca' }),
    });
    await expect(
      gravar(LOGINS.a, { acao: 'incluir', usuario: 999_999_999, podeMarcar: true }),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ codigo: 'usuario-inexistente' }) });
    expect(await ler('SELECT id FROM agenda_usuario WHERE agenda_servico_id = ?', [ids.agenda])).toHaveLength(
      0,
    );
  });

  it('inclui quem marca e quem só consulta: linhas, versão e trilha na mesma transação', async () => {
    const t0 = await trilhas();
    expect((await gravar(LOGINS.a, { acao: 'incluir', usuario: ids.a, podeMarcar: true })).resultado).toEqual(
      {
        agenda: ids.agenda,
        usuarios: 1,
      },
    );
    await gravar(LOGINS.a, { acao: 'incluir', usuario: ids.b, podeMarcar: false });
    const linhas = await ler<{
      usuario_id: number;
      pode_marcar: number;
      versao: number;
      excluido_em: unknown;
    }>(
      'SELECT usuario_id, pode_marcar, versao, excluido_em, criado_por FROM agenda_usuario WHERE agenda_servico_id = ? ORDER BY usuario_id',
      [ids.agenda],
    );
    expect(
      linhas.map((x) => [Number(x.usuario_id), Number(x.pode_marcar), Number(x.versao), x.excluido_em]),
    ).toEqual([
      [ids.a, 1, 1, null],
      [ids.b, 0, 1, null],
    ]);
    expect(await trilhas()).toBe(t0 + 2);
  });

  it('agenda restrita: some da leitura de quem não está na lista; o gestor a vê; a lista mostra o meu acesso', async () => {
    expect((await porta.agendas(ctxPorta(LOGINS.c))).map((a) => a.id)).not.toContain(ids.agenda);
    expect(await porta.agenda(ctxPorta(LOGINS.c), ids.agenda)).toBeNull();
    expect(await usuarios.lista(ctxU(LOGINS.c), ids.agenda)).toBeNull();
    expect((await porta.agendas(ctxPorta(LOGINS.b))).map((a) => a.id)).toContain(ids.agenda);
    expect(await porta.agenda(ctxPorta(LOGINS.c, true), ids.agenda)).not.toBeNull();
    expect(await usuarios.lista(ctxU(LOGINS.b), ids.agenda)).toMatchObject({
      restrita: true,
      meuAcesso: 'consulta',
    });
    expect(await usuarios.lista(ctxU(LOGINS.c, true), ids.agenda)).toMatchObject({ meuAcesso: 'gestor' });
  });

  it('marcação na agenda restrita: recusada para quem só consulta e para quem não está na lista; passa a trava para quem marca', async () => {
    const pedido = {
      agenda: ids.agenda,
      data: '2030-03-12',
      hora: '08:00',
      paciente: 1,
      convenio: 1,
      retorno: false,
      canal: 'telefone',
    };
    for (const login of [LOGINS.b, LOGINS.c])
      await expect(porta.executar(ctxPorta(login), 'agenda.agendarConsulta', pedido)).rejects.toMatchObject({
        problema: expect.objectContaining({ codigo: 'agenda-restrita' }),
      });
    // Quem marca passa a trava nominal (a agenda sintética não tem grade: a recusa seguinte é outra).
    const r = await porta
      .executar(ctxPorta(LOGINS.a), 'agenda.agendarConsulta', pedido)
      .catch((e: unknown) => e);
    expect((r as { problema?: { codigo?: string } }).problema?.codigo).not.toBe('agenda-restrita');
  });

  it('não deixa a agenda sem quem marca; promove, retira (exclusão lógica) e libera para todos', async () => {
    await expect(gravar(LOGINS.a, { acao: 'remover', usuario: ids.a })).rejects.toMatchObject({
      problema: expect.objectContaining({ codigo: 'lista-sem-quem-marca' }),
    });
    await gravar(LOGINS.a, { acao: 'alterar', usuario: ids.b, podeMarcar: true });
    await gravar(LOGINS.a, { acao: 'remover', usuario: ids.a });
    let linhas = await ler<{
      usuario_id: number;
      pode_marcar: number;
      versao: number;
      excluido_em: unknown;
      excluido_por: unknown;
    }>(
      'SELECT usuario_id, pode_marcar, versao, excluido_em, excluido_por FROM agenda_usuario WHERE agenda_servico_id = ? ORDER BY usuario_id',
      [ids.agenda],
    );
    expect(linhas).toHaveLength(2);
    expect(linhas[0]!.excluido_em).not.toBeNull();
    expect(Number(linhas[0]!.excluido_por)).toBe(ids.a);
    expect([Number(linhas[1]!.pode_marcar), Number(linhas[1]!.versao)]).toEqual([1, 2]);
    // Volta de quem foi retirado reaproveita a linha (sem duplicar), e liberar retira todos sem apagar.
    await gravar(LOGINS.a, { acao: 'incluir', usuario: ids.a, podeMarcar: false });
    await gravar(LOGINS.a, { acao: 'liberarTodos' });
    linhas = await ler(
      'SELECT usuario_id, pode_marcar, versao, excluido_em, excluido_por FROM agenda_usuario WHERE agenda_servico_id = ? ORDER BY usuario_id',
      [ids.agenda],
    );
    expect(linhas).toHaveLength(2);
    expect(linhas.every((x) => x.excluido_em !== null)).toBe(true);
    expect(await usuarios.lista(ctxU(LOGINS.c), ids.agenda)).toMatchObject({ restrita: false });
    expect((await porta.agendas(ctxPorta(LOGINS.c))).map((a) => a.id)).toContain(ids.agenda);
  });
});
