// Contrato de efeito da anotação administrativa do caso (03-PEP L147), contra o MariaDB real (cliente de teste f22_o3
// por padrão). Massa SINTÉTICA própria (estabelecimentos c1109 e c1109b, logins teste.c1109.*, categorias c1109*,
// atendimentos C1109-*), limpa antes e depois (a trilha pelo utilitário comum). Prova o que fica no banco: a anotação
// com o atendimento, a categoria, o autor, o alcance e os destinatários (sem repetição e sem o autor); quem vê o quê
// (equipe do estabelecimento, só destinatários, toda a rede); a fila de leitura de quem recebeu; marcar como lida
// (uma vez, só o destinatário); cancelar só pelo autor com motivo (nada apagado, texto intacto); as recusas sem
// gravar nada (conta bloqueada ou vencida não é destinatária nem aparece na busca); a reserva de leito do NIR como
// contexto (só do paciente); e as rotas com o vínculo assistencial, inclusive o destinatário que só lê dando baixa. SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { AnotacoesAdministrativasController } from './anotacoes-administrativas.controller.js';
import { AnotacoesAdministrativasPropria } from './anotacoes-administrativas-propria.js';
import { EstadoProntuario } from './sessao-prontuario.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'c1109';
const EST2 = 'c1109b';
const AUTOR = 'teste.c1109.a';
const DEST = 'teste.c1109.b';
const EQUIPE = 'teste.c1109.c';
const SEM_CONTA = 'teste.c1109.inexistente';
const BLOQUEADA = 'teste.c1109.d';
const VENCIDA = 'teste.c1109.e';
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });

describe.skipIf(SEM_BANCO)('anotação administrativa do caso (banco próprio, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let anot: AnotacoesAdministrativasPropria;
  const ids = {
    est: 0,
    est2: 0,
    autor: 0,
    dest: 0,
    equipe: 0,
    bloqueada: 0,
    vencida: 0,
    paciente: 0,
    atend: 0,
    atendFora: 0,
    reserva: 0,
    reservaOutro: 0,
  };
  const cat = { ativa: 0, inativa: 0 };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    if (!ids.est) return;
    await e.executar(
      `DELETE d FROM anotacao_administrativa_caso_destinatario d
         JOIN anotacao_administrativa_caso a ON a.id = d.anotacao_administrativa_caso_id
        WHERE a.estabelecimento_id IN (?, ?) OR a.paciente_id = ?`,
      [ids.est, ids.est2, ids.paciente],
    );
    await e.executar(
      'DELETE FROM anotacao_administrativa_caso WHERE estabelecimento_id IN (?, ?) OR paciente_id = ?',
      [ids.est, ids.est2, ids.paciente],
    );
    await e.executar('DELETE FROM reserva_leito WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.est2]);
    await limparTrilhaDaMassa(e, { codigos: [EST, EST2] });
  };
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c1109' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctx = (login = AUTOR, hospital = EST) => ({
    hospital,
    login,
    correlacao: 'teste-c1109',
    chaveIdempotencia: `c1109-${randomUUID()}`,
  });
  const gravar = (e: Record<string, unknown>, login = AUTOR, hospital = EST) =>
    anot.gravarAnotacao(ctx(login, hospital), e);
  const linha = async (id: number) =>
    (await ler('SELECT * FROM anotacao_administrativa_caso WHERE id = ?', [id]))[0] as Record<
      string,
      unknown
    >;
  const destinos = (id: number) =>
    ler<{ usuario_id: number; lida_em: Date | null }>(
      'SELECT usuario_id, lida_em FROM anotacao_administrativa_caso_destinatario WHERE anotacao_administrativa_caso_id = ? ORDER BY usuario_id',
      [id],
    );
  const contar = async () =>
    Number(
      (
        await ler<{ n: number }>(
          `SELECT (SELECT COUNT(*) FROM anotacao_administrativa_caso WHERE paciente_id = ?) +
                  (SELECT COUNT(*) FROM anotacao_administrativa_caso_destinatario d
                     JOIN anotacao_administrativa_caso a ON a.id = d.anotacao_administrativa_caso_id
                    WHERE a.paciente_id = ?) AS n`,
          [ids.paciente, ids.paciente],
        )
      )[0]!.n,
    );
  const base = () => ({
    acao: 'registrar',
    paciente: ids.paciente,
    atendimento: ids.atend,
    categoria: cat.ativa,
    texto: 'Família aguarda a vaga da casa de apoio',
  });

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    anot = new AnotacoesAdministrativasPropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c1109' }, async (e) => {
      const agora = new Date();
      const est = (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital sintético ${codigo}`, `Hospital sintético ${codigo} (fictício)`, agora],
        );
      ids.est = await est(EST);
      ids.est2 = await est(EST2);
      const usuario = (login: string, cpf: string) =>
        garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, cpf, criado_em) VALUES (?, ?, ?, ?)',
          [login, `Conta sintética ${login}`, cpf, agora],
        );
      ids.autor = await usuario(AUTOR, '11091090001');
      ids.dest = await usuario(DEST, '11091090002');
      ids.equipe = await usuario(EQUIPE, '11091090003');
      ids.bloqueada = await usuario(BLOQUEADA, '11091090004');
      ids.vencida = await usuario(VENCIDA, '11091090005');
      await e.executar("UPDATE usuario SET situacao = 'bloqueado', bloqueado_em = ? WHERE id = ?", [
        agora,
        ids.bloqueada,
      ]);
      await e.executar('UPDATE usuario SET expira_em = ? WHERE id = ?', [
        new Date(agora.getTime() - 86_400_000),
        ids.vencida,
      ]);
      const pf = await garantir(
        e,
        'SELECT id FROM pessoa_fisica WHERE nome = ?',
        ['PESSOA SINTETICA C1109 PACIENTE'],
        'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
        ['PESSOA SINTETICA C1109 PACIENTE', agora],
      );
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pf],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pf, 110_910_901, agora],
      );
      // O atendimento sintético reaproveita só as referências (ids) de um atendimento que já existe no cliente.
      const atendimento = (estab: number, numero: string) =>
        garantir(
          e,
          'SELECT id FROM atendimento WHERE estabelecimento_id = ? AND numero = ?',
          [estab, numero],
          `INSERT INTO atendimento (estabelecimento_id, numero, paciente_id, categoria_atendimento_id,
             carater_atendimento_tiss_id, fonte_pagadora_id, profissional_id, entrada_em, criado_em)
           SELECT ?, ?, ?, categoria_atendimento_id, carater_atendimento_tiss_id, fonte_pagadora_id,
                  profissional_id, ?, ? FROM atendimento ORDER BY id LIMIT 1`,
          [estab, numero, ids.paciente, agora, agora],
        );
      ids.atend = await atendimento(ids.est, 'C1109-1');
      ids.atendFora = await atendimento(ids.est2, 'C1109-2');
      const categoria = (codigo: string, ativo: boolean) =>
        garantir(
          e,
          'SELECT id FROM categoria_anotacao_administrativa WHERE codigo = ?',
          [codigo],
          'INSERT INTO categoria_anotacao_administrativa (codigo, descricao, ativo, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Categoria sintética ${codigo}`, ativo, agora],
        );
      cat.ativa = await categoria('c1109adm', true);
      cat.inativa = await categoria('c1109inat', false);
      await limpar(e);
      // Reservas de leito sintéticas, já expiradas (não ocupam leito): uma do paciente, outra de outro paciente.
      const reserva = (paciente: number) =>
        e.inserir(
          `INSERT INTO reserva_leito (estabelecimento_id, leito_hospitalar_id, paciente_id, reservado_em, valida_ate,
             situacao, encerrada_em, criado_em)
           SELECT ?, id, ?, ?, ?, 'expirada', ?, ? FROM leito_hospitalar ORDER BY id LIMIT 1`,
          [ids.est, paciente, agora, new Date(agora.getTime() + 3_600_000), agora, agora],
        );
      ids.reserva = await reserva(ids.paciente);
      const outro = await e.uma<{ id: number }>('SELECT id FROM paciente WHERE id <> ? ORDER BY id LIMIT 1', [
        ids.paciente,
      ]);
      ids.reservaOutro = await reserva(Number(outro!.id));
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c1109' }, (e) => limpar(e));
    await nucleo.encerrar?.();
  });

  it('registra com atendimento, categoria, autor e alcance; destinatários sem repetição e sem o autor', async () => {
    const r = await gravar({
      ...base(),
      texto: '  Família aguarda a vaga da casa de apoio  ',
      destinatarios: [ids.dest, ids.dest, ids.autor],
      finalizaAcao: true,
    });
    expect(r.resultado.situacao).toBe('ativa');
    expect(await linha(r.resultado.anotacao)).toMatchObject({
      estabelecimento_id: ids.est,
      atendimento_id: ids.atend,
      paciente_id: ids.paciente,
      categoria_anotacao_administrativa_id: cat.ativa,
      registrado_por_usuario_id: ids.autor,
      texto: 'Família aguarda a vaga da casa de apoio',
      acesso: 'equipe',
      finaliza_acao: 1,
      automatica: 0,
      cancelada_em: null,
      origem: 'sistema',
      criado_por: ids.autor,
      versao: 1,
    });
    expect(await destinos(r.resultado.anotacao)).toEqual([{ usuario_id: ids.dest, lida_em: null }]);
    // A equipe do estabelecimento vê; o destinatário tem a pendência; o autor não.
    const daEquipe = await anot.doPaciente(ctx(EQUIPE), ids.paciente);
    expect(daEquipe.anotacoes.map((a) => a.id)).toContain(r.resultado.anotacao);
    expect(daEquipe.atendimentos.map((a) => a.id)).toEqual([ids.atend]);
    expect(daEquipe.categorias.map((c) => c.id)).toContain(cat.ativa);
    expect(daEquipe.categorias.map((c) => c.id)).not.toContain(cat.inativa);
    const doDest = await anot.doPaciente(ctx(DEST), ids.paciente);
    expect(doDest.pendentesParaMim).toBe(1);
    expect((await anot.doPaciente(ctx(AUTOR), ids.paciente)).anotacoes[0]).toMatchObject({
      doAutor: true,
      pendenteParaMim: false,
      finalizaAcao: true,
      destinatarios: [expect.objectContaining({ usuario: ids.dest, lidaEm: null })],
    });
    const fila = await anot.pendentes(ctx(DEST));
    expect(fila).toEqual([
      expect.objectContaining({
        anotacao: r.resultado.anotacao,
        paciente: ids.paciente,
        atendimento: 'C1109-1',
      }),
    ]);
    expect(await anot.pendentes(ctx(EQUIPE))).toEqual([]);
  });

  it('quem lê: restrita só ao autor e aos destinatários; equipe só no estabelecimento; "todos" na rede', async () => {
    const restrita = await gravar({ ...base(), acesso: 'destinatarios', destinatarios: [ids.dest] });
    const todos = await gravar({ ...base(), acesso: 'todos' });
    const vistos = async (login: string, hospital = EST) =>
      (await anot.doPaciente(ctx(login, hospital), ids.paciente)).anotacoes.map((a) => a.id);
    expect(await vistos(EQUIPE)).not.toContain(restrita.resultado.anotacao);
    expect(await vistos(DEST, EST2)).toContain(restrita.resultado.anotacao);
    expect(await vistos(AUTOR, EST2)).toContain(restrita.resultado.anotacao);
    const deFora = await vistos(EQUIPE, EST2);
    expect(deFora).toContain(todos.resultado.anotacao);
    expect(deFora).not.toContain(restrita.resultado.anotacao);
    expect(deFora.length).toBe(1);
    // Quem não vê não dá passo nenhum (nem fica sabendo que existe).
    await expect(
      gravar({ acao: 'marcar_lida', anotacao: restrita.resultado.anotacao }, EQUIPE),
    ).rejects.toMatchObject({ problema: expect.objectContaining({ status: 404 }) });
  });

  it('marcar como lida: só o destinatário e uma vez; a fila de leitura esvazia', async () => {
    const r = await gravar({ ...base(), destinatarios: [ids.dest] });
    await expect(
      gravar({ acao: 'marcar_lida', anotacao: r.resultado.anotacao }, EQUIPE),
    ).rejects.toMatchObject(recusada('nao-destinatario'));
    const antes = (await anot.pendentes(ctx(DEST))).length;
    await gravar({ acao: 'marcar_lida', anotacao: r.resultado.anotacao }, DEST);
    const [d] = await destinos(r.resultado.anotacao);
    expect(d!.lida_em).toBeInstanceOf(Date);
    expect((await anot.pendentes(ctx(DEST))).length).toBe(antes - 1);
    await expect(gravar({ acao: 'marcar_lida', anotacao: r.resultado.anotacao }, DEST)).rejects.toMatchObject(
      recusada('ja-lida'),
    );
  });

  it('cancelar: só o autor, com motivo e versão; nada apagado e o texto intacto', async () => {
    const r = await gravar({ ...base(), texto: 'Lançada no caso errado', destinatarios: [ids.dest] });
    const id = r.resultado.anotacao;
    const antes = await contar();
    await expect(
      gravar({ acao: 'cancelar', anotacao: id, versao: 1, motivo: 'Não é minha' }, EQUIPE),
    ).rejects.toMatchObject(recusada('so-autor-cancela'));
    await expect(gravar({ acao: 'cancelar', anotacao: id, versao: 1, motivo: ' ok ' })).rejects.toMatchObject(
      recusada('motivo-obrigatorio'),
    );
    await expect(
      gravar({ acao: 'cancelar', anotacao: id, versao: 7, motivo: 'Registrada no caso errado' }),
    ).rejects.toMatchObject(recusada('conflito-versao'));
    const c = await gravar({
      acao: 'cancelar',
      anotacao: id,
      versao: 1,
      motivo: 'Registrada no caso errado',
    });
    expect(c.resultado.situacao).toBe('cancelada');
    expect(await linha(id)).toMatchObject({
      texto: 'Lançada no caso errado',
      cancelada_por_usuario_id: ids.autor,
      motivo_cancelamento: 'Registrada no caso errado',
      excluido_em: null,
      versao: 2,
    });
    expect((await linha(id))['cancelada_em']).toBeInstanceOf(Date);
    expect(await contar()).toBe(antes);
    await expect(gravar({ acao: 'marcar_lida', anotacao: id }, DEST)).rejects.toMatchObject(
      recusada('anotacao-cancelada'),
    );
    expect((await anot.pendentes(ctx(DEST))).map((p) => p.anotacao)).not.toContain(id);
    const vista = (await anot.doPaciente(ctx(DEST), ids.paciente)).anotacoes.find((a) => a.id === id);
    expect(vista).toMatchObject({ situacao: 'cancelada', pendenteParaMim: false });
  });

  it('recusa sem gravar: categoria inativa, atendimento de fora, restrita sem destinatário, destinatário inexistente, conta inexistente', async () => {
    const antes = await contar();
    await expect(gravar({ ...base(), categoria: cat.inativa })).rejects.toMatchObject(
      recusada('categoria-inativa'),
    );
    await expect(gravar({ ...base(), atendimento: ids.atendFora })).rejects.toMatchObject(
      recusada('atendimento-de-outro-estabelecimento'),
    );
    await expect(gravar({ ...base(), acesso: 'destinatarios' })).rejects.toMatchObject(
      recusada('destinatario-obrigatorio'),
    );
    await expect(gravar({ ...base(), destinatarios: [999_999_999] })).rejects.toMatchObject(
      recusada('destinatario-inexistente'),
    );
    for (const conta of [ids.bloqueada, ids.vencida])
      await expect(gravar({ ...base(), destinatarios: [conta] })).rejects.toMatchObject(
        recusada('destinatario-inexistente'),
      );
    await expect(gravar({ ...base(), reserva: ids.reservaOutro })).rejects.toMatchObject(
      recusada('reserva-de-outro-paciente'),
    );
    await expect(gravar({ ...base(), reserva: 999_999_999 })).rejects.toMatchObject(
      recusada('reserva-inexistente'),
    );
    await expect(gravar({ ...base(), texto: '   ' })).rejects.toMatchObject(recusada('texto-obrigatorio'));
    await expect(gravar(base(), SEM_CONTA)).rejects.toMatchObject(recusada('usuario-sem-conta'));
    await expect(gravar({ ...base(), acesso: 'publica' })).rejects.toMatchObject(
      recusada('entrada-invalida'),
    );
    expect(await contar()).toBe(antes);
    expect(await anot.usuarios('c1')).toEqual([]);
    expect((await anot.usuarios('teste.c1109')).map((u) => u.id).sort()).toEqual(
      [ids.autor, ids.dest, ids.equipe].sort(),
    );
  });

  it('a reserva de leito do NIR fica ligada à anotação e aparece na leitura', async () => {
    const r = await gravar({ ...base(), reserva: ids.reserva, texto: 'Reserva aguarda a família' });
    expect(await linha(r.resultado.anotacao)).toMatchObject({ reserva_leito_id: ids.reserva });
    const vista = (await anot.doPaciente(ctx(), ids.paciente)).anotacoes.find(
      (a) => a.id === r.resultado.anotacao,
    );
    expect(vista?.reserva).toBe(ids.reserva);
    expect(await anot.pacienteDaReserva(ids.reserva)).toBe(ids.paciente);
    expect(await anot.pacienteDaReserva(999_999_999)).toBeNull();
  });

  it('as rotas exigem o vínculo assistencial com o paciente e a leitura vai à trilha', async () => {
    const PERMS = ['pep.social.ler', 'pep.social.registrar'];
    const montar = (vinculo: boolean, login = AUTOR, usuario = ids.autor, perms = PERMS) => {
      const trilha = new RegistradorTrilhaMemoria();
      const ctrl = new AnotacoesAdministrativasController(
        new EstadoProntuario(),
        trilha,
        anot,
        null,
        null,
        new VinculoSintetico(
          vinculo ? [{ login, idPaciente: ids.paciente, forma: 'atendimento-em-curso' }] : [],
        ),
        null,
      );
      const req = () =>
        ({
          headers: { 'idempotency-key': `c1109-ctrl-${randomUUID()}`, 'x-correlation-id': 'c1109-ctrl' },
          ip: '127.0.0.1',
          sgh: {
            real: false,
            ability: criarAbility(regrasDeAcesso([...perms], null)),
            sessao: {
              usuario: { id: String(usuario), nome: 'Conta sintética', login },
              rede: 'rede-c1109',
              estabelecimentos: [],
              estabelecimentoAtivo: EST,
              unidadeAtiva: null,
              permissoes: [...perms],
              restricaoVinculo: true,
              sintetica: true,
              bloqueioInatividadeSegundos: 0,
              expiraEm: '',
            },
          },
        }) as unknown as RequisicaoAutorizada;
      return { trilha, ctrl, req };
    };
    const antes = await contar();
    const sem = montar(false);
    await expect(sem.ctrl.doPaciente(ids.paciente, sem.req())).rejects.toMatchObject({ status: 403 });
    expect(
      sem.trilha.eventos.some(
        (e) => e.evento === EVENTOS_AUDITAVEIS.permissaoNegada.codigo && e.paciente === ids.paciente,
      ),
    ).toBe(true);
    await expect(sem.ctrl.gravar(base(), sem.req())).rejects.toMatchObject({ status: 403 });
    await expect(
      sem.ctrl.gravar({ acao: 'marcar_lida', anotacao: 999_999_999 }, sem.req()),
    ).rejects.toMatchObject({ status: 404 });
    expect(await contar()).toBe(antes);
    const com = montar(true);
    const tela = await com.ctrl.doPaciente(ids.paciente, com.req());
    expect(tela.anotacoes.length).toBeGreaterThan(0);
    expect(
      com.trilha.eventos.filter(
        (e) =>
          e.evento === EVENTOS_AUDITAVEIS.consultaRes.codigo &&
          e.paciente === ids.paciente &&
          e.recurso === 'pep.prontuario',
      ),
    ).toHaveLength(1);
    const r = await com.ctrl.gravar({ ...base(), texto: 'Pela rota', acesso: 'todos' }, com.req());
    expect(r.ok).toBe(true);
    expect(await linha(r.resultado.anotacao)).toMatchObject({ texto: 'Pela rota', acesso: 'todos' });
    expect(Array.isArray(await com.ctrl.pendentes(com.req()))).toBe(true);
    await expect(com.ctrl.doPaciente(999_999_999, com.req())).rejects.toMatchObject({ status: 404 });
    expect(await com.ctrl.daReserva(ids.reserva, com.req())).toEqual({
      reserva: ids.reserva,
      paciente: ids.paciente,
    });
    await expect(sem.ctrl.daReserva(ids.reserva, sem.req())).rejects.toMatchObject({ status: 403 });

    // O destinatário que só LÊ (sem permissão de escrita) dá baixa pela rota da leitura confirmada.
    const restrita = await com.ctrl.gravar(
      { ...base(), texto: 'Para quem só lê', acesso: 'destinatarios', destinatarios: [ids.dest] },
      com.req(),
    );
    const leitor = montar(true, DEST, ids.dest, ['internacao.solicitacaoLeito.ler']);
    const vista = await leitor.ctrl.doPaciente(ids.paciente, leitor.req());
    expect(vista.anotacoes.find((a) => a.id === restrita.resultado.anotacao)?.pendenteParaMim).toBe(true);
    const baixa = await leitor.ctrl.marcarLida(restrita.resultado.anotacao, leitor.req());
    expect(baixa).toMatchObject({ ok: true, resultado: { situacao: 'ativa' } });
    expect((await destinos(restrita.resultado.anotacao))[0]!.lida_em).not.toBeNull();
    expect(
      (await leitor.ctrl.pendentes(leitor.req())).some((p) => p.anotacao === restrita.resultado.anotacao),
    ).toBe(false);
    // Quem não é destinatário não dá baixa (recusa do domínio, nada gravado).
    await expect(com.ctrl.marcarLida(restrita.resultado.anotacao, com.req())).rejects.toMatchObject(
      recusada('nao-destinatario'),
    );
  });
});
