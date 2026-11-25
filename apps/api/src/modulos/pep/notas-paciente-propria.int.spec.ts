// Contrato de efeito das notas e lembretes livres sobre o paciente (03-PEP L102), contra o MariaDB real (cliente de
// teste f22_o3 por padrão). Massa SINTÉTICA própria (estabelecimentos c1049 e c1049b, logins teste.c1049.*, tipos e
// textos prontos c1049*), limpa antes e depois (a trilha pelo utilitário comum). Prova o que fica no banco: a nota
// com autor, tipo, texto pronto, visibilidade, validade e situação; quem vê o quê (autor, equipe do estabelecimento,
// toda a rede); o alerta só enquanto em vigor; encerrar por quem vê, cancelar só pelo autor com motivo (nada apagado,
// texto intacto), prorrogar só pelo autor; as recusas sem gravar nada; e as rotas com o vínculo assistencial.
// SGH_NUCLEO_SEM_BANCO=1 pula.
import { randomUUID } from 'node:crypto';
import { EVENTOS_AUDITAVEIS } from '@sgh/contratos';
import { criarAbility, regrasDeAcesso, VinculoSintetico } from '@sgh/dominio-acesso';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { limparTrilhaDaMassa } from '../../teste/limpar-trilha.spec-util.js';
import { NotasPacienteController } from './notas-paciente.controller.js';
import { NotasPacientePropria } from './notas-paciente-propria.js';
import { EstadoProntuario } from './sessao-prontuario.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o3';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'c1049';
const EST2 = 'c1049b';
const AUTOR = 'teste.c1049.a';
const OUTRO = 'teste.c1049.b';
const SEM_PROF = 'teste.c1049.c';
const recusada = (codigo: string) => ({ problema: expect.objectContaining({ codigo }) });
const dias = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

describe.skipIf(SEM_BANCO)('notas livres sobre o paciente (banco próprio, MariaDB)', () => {
  let nucleo: NucleoProprio;
  let notas: NotasPacientePropria;
  const ids = { est: 0, est2: 0, autor: 0, outro: 0, semProf: 0, prof: 0, prof2: 0, paciente: 0 };
  const tipo = { alerta: 0, lembrete: 0, inativo: 0 };
  const pronto = { geral: 0, alheio: 0, receita: 0 };

  const garantir = async (e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]) => {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  };
  const limpar = async (e: Escritor) => {
    if (ids.est)
      await e.executar('DELETE FROM nota_paciente WHERE estabelecimento_id IN (?, ?)', [ids.est, ids.est2]);
    if (ids.paciente) await e.executar('DELETE FROM nota_paciente WHERE paciente_id = ?', [ids.paciente]);
    if (ids.est) await limparTrilhaDaMassa(e, { codigos: [EST, EST2] });
  };
  const ler = <T = Record<string, unknown>>(sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'leitura-c1049' }, (l) =>
      l.consultar(sql, p),
    ) as Promise<T[]>;
  const ctx = (login = AUTOR, hospital = EST) => ({
    hospital,
    login,
    correlacao: 'teste-c1049',
    chaveIdempotencia: `c1049-${randomUUID()}`,
  });
  const gravar = (e: Record<string, unknown>, login = AUTOR, hospital = EST) =>
    notas.gravarNota(ctx(login, hospital), e);
  const linha = async (id: number) =>
    (await ler('SELECT * FROM nota_paciente WHERE id = ?', [id]))[0] as Record<string, unknown>;
  const contar = async () =>
    Number(
      (
        await ler<{ n: number }>('SELECT COUNT(*) AS n FROM nota_paciente WHERE paciente_id = ?', [
          ids.paciente,
        ])
      )[0]!.n,
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    notas = new NotasPacientePropria(nucleo, CLIENTE);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-c1049' }, async (e) => {
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
      ids.autor = await usuario(AUTOR, '10490490001');
      ids.outro = await usuario(OUTRO, '10490490002');
      ids.semProf = await usuario(SEM_PROF, '10490490003');
      const pessoa = (nome: string) =>
        garantir(
          e,
          'SELECT id FROM pessoa_fisica WHERE nome = ?',
          [nome],
          'INSERT INTO pessoa_fisica (nome, criado_em) VALUES (?, ?)',
          [nome, agora],
        );
      const profissional = async (nome: string, usuarioId: number) => {
        const pf = await pessoa(nome);
        const p = await garantir(
          e,
          'SELECT id FROM profissional WHERE pessoa_fisica_id = ?',
          [pf],
          "INSERT INTO profissional (pessoa_fisica_id, tipo, observacao, criado_em) VALUES (?, 'assistencial', 'massa c1049', ?)",
          [pf, agora],
        );
        await garantir(
          e,
          'SELECT id FROM usuario_profissional WHERE usuario_id = ? AND profissional_id = ?',
          [usuarioId, p],
          'INSERT INTO usuario_profissional (usuario_id, profissional_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [usuarioId, p, '2026-01-01', agora],
        );
        return p;
      };
      ids.prof = await profissional('PESSOA SINTETICA C1049 AUTORA', ids.autor);
      ids.prof2 = await profissional('PESSOA SINTETICA C1049 OUTRA', ids.outro);
      const pac = await pessoa('PESSOA SINTETICA C1049 PACIENTE');
      ids.paciente = await garantir(
        e,
        'SELECT id FROM paciente WHERE pessoa_fisica_id = ?',
        [pac],
        'INSERT INTO paciente (pessoa_fisica_id, numero_prontuario, criado_em) VALUES (?, ?, ?)',
        [pac, 104_904_901, agora],
      );
      const tipoNota = (codigo: string, alerta: boolean, ativo: boolean) =>
        garantir(
          e,
          'SELECT id FROM tipo_nota_paciente WHERE codigo = ?',
          [codigo],
          'INSERT INTO tipo_nota_paciente (codigo, descricao, exibe_como_alerta, ativo, criado_em) VALUES (?, ?, ?, ?, ?)',
          [codigo, `Tipo sintético ${codigo}`, alerta, ativo, agora],
        );
      tipo.alerta = await tipoNota('c1049alerta', true, true);
      tipo.lembrete = await tipoNota('c1049lemb', false, true);
      tipo.inativo = await tipoNota('c1049inat', false, false);
      const textoPronto = (codigo: string, aplicacao: string, prof: number | null) =>
        garantir(
          e,
          'SELECT id FROM nota_predefinida WHERE codigo = ?',
          [codigo],
          'INSERT INTO nota_predefinida (codigo, descricao, aplicacao, profissional_id, texto, criado_em) VALUES (?, ?, ?, ?, ?, ?)',
          [codigo, `Texto pronto sintético ${codigo}`, aplicacao, prof, 'Texto pronto sintético', agora],
        );
      pronto.geral = await textoPronto('c1049geral', 'nota_paciente', null);
      pronto.alheio = await textoPronto('c1049alheio', 'geral', ids.prof2);
      pronto.receita = await textoPronto('c1049rec', 'receita', null);
      await limpar(e);
    });
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-c1049' }, (e) => limpar(e));
    await nucleo.encerrar?.();
  });

  it('registra a nota com autor, tipo, texto pronto, visibilidade e validade; o alerta aparece em vigor', async () => {
    const r = await gravar({
      acao: 'registrar',
      paciente: ids.paciente,
      tipo: tipo.alerta,
      predefinida: pronto.geral,
      texto: '  Paciente surdo: falar de frente e por escrito  ',
      visibilidade: 'equipe',
      validaAte: dias(30),
    });
    expect(r.resultado.situacao).toBe('ativa');
    const n = await linha(r.resultado.nota);
    expect(n).toMatchObject({
      estabelecimento_id: ids.est,
      paciente_id: ids.paciente,
      tipo_nota_paciente_id: tipo.alerta,
      nota_predefinida_id: pronto.geral,
      autor_profissional_id: ids.prof,
      texto: 'Paciente surdo: falar de frente e por escrito',
      visibilidade: 'equipe',
      situacao: 'ativa',
      origem: 'sistema',
      versao: 1,
      excluido_em: null,
    });
    expect(n['valida_ate']).not.toBeNull();
    expect(Number(n['criado_por'])).toBe(ids.autor);
    const tela = await notas.doPaciente(ctx(), ids.paciente);
    const lida = tela.notas.find((x) => x.id === r.resultado.nota)!;
    expect(lida).toMatchObject({ situacao: 'ativa', alerta: true, doAutor: true, visibilidade: 'equipe' });
    expect(tela.alertas.map((x) => x.id)).toContain(r.resultado.nota);
    expect(tela.podeEscrever).toBe(true);
    expect(tela.tipos.map((t) => t.id)).toEqual(expect.arrayContaining([tipo.alerta, tipo.lembrete]));
    expect(tela.tipos.map((t) => t.id)).not.toContain(tipo.inativo);
    expect(tela.textosProntos.map((t) => t.id)).toContain(pronto.geral);
    expect(tela.textosProntos.map((t) => t.id)).not.toContain(pronto.alheio);
    expect(tela.textosProntos.map((t) => t.id)).not.toContain(pronto.receita);
  });

  it('visibilidade: só o autor; a equipe do mesmo estabelecimento; toda a rede', async () => {
    const reg = async (visibilidade: string) =>
      (
        await gravar({
          acao: 'registrar',
          paciente: ids.paciente,
          tipo: tipo.lembrete,
          texto: `Lembrete sintético ${visibilidade}`,
          visibilidade,
        })
      ).resultado.nota;
    const soAutor = await reg('autor');
    const equipe = await reg('equipe');
    const todos = await reg('todos');
    const vistas = async (login: string, hospital: string) =>
      (await notas.doPaciente(ctx(login, hospital), ids.paciente)).notas.map((x) => x.id);
    expect(await vistas(AUTOR, EST2)).toEqual(expect.arrayContaining([soAutor, equipe, todos]));
    const outroMesmo = await vistas(OUTRO, EST);
    expect(outroMesmo).toEqual(expect.arrayContaining([equipe, todos]));
    expect(outroMesmo).not.toContain(soAutor);
    const outroRede = await vistas(OUTRO, EST2);
    expect(outroRede).toContain(todos);
    expect(outroRede).not.toContain(equipe);
    expect(outroRede).not.toContain(soAutor);
    // Quem não vê a nota não dá passo nela: 404, como se não existisse.
    await expect(gravar({ acao: 'encerrar', nota: soAutor, versao: 1 }, OUTRO)).rejects.toMatchObject({
      problema: expect.objectContaining({ status: 404 }),
    });
    expect((await linha(soAutor))['situacao']).toBe('ativa');
  });

  it('encerrar por quem vê; cancelar só pelo autor com motivo; nada apagado e o texto intacto', async () => {
    const nota = (
      await gravar({
        acao: 'registrar',
        paciente: ids.paciente,
        tipo: tipo.lembrete,
        texto: 'Pedir exame de rotina',
      })
    ).resultado.nota;
    await gravar({ acao: 'encerrar', nota, versao: 1 }, OUTRO);
    expect(await linha(nota)).toMatchObject({ situacao: 'encerrada', versao: 2 });
    expect(Number((await linha(nota))['alterado_por'])).toBe(ids.outro);
    await expect(gravar({ acao: 'encerrar', nota, versao: 2 })).rejects.toMatchObject(
      recusada('nota-encerrada'),
    );
    await expect(
      gravar({ acao: 'cancelar', nota, versao: 2, motivo: 'Escrita no paciente errado' }, OUTRO),
    ).rejects.toMatchObject(recusada('nota-de-outro-autor'));
    await expect(gravar({ acao: 'cancelar', nota, versao: 2, motivo: 'erro' })).rejects.toMatchObject(
      recusada('motivo-obrigatorio'),
    );
    await expect(
      gravar({ acao: 'cancelar', nota, versao: 1, motivo: 'Escrita no paciente errado' }),
    ).rejects.toMatchObject(recusada('conflito-versao'));
    await gravar({ acao: 'cancelar', nota, versao: 2, motivo: 'Escrita no paciente errado' });
    const n = await linha(nota);
    expect(n).toMatchObject({
      situacao: 'cancelada',
      cancelada_profissional_id: ids.prof,
      motivo_cancelamento: 'Escrita no paciente errado',
      texto: 'Pedir exame de rotina',
      excluido_em: null,
      versao: 3,
    });
    expect(n['cancelada_em']).not.toBeNull();
    const lida = (await notas.doPaciente(ctx(), ids.paciente)).notas.find((x) => x.id === nota)!;
    expect(lida).toMatchObject({ situacao: 'cancelada', motivoCancelamento: 'Escrita no paciente errado' });
  });

  it('prorrogar a validade só pelo autor; a vencida aparece vencida e deixa de alertar', async () => {
    const nota = (
      await gravar({
        acao: 'registrar',
        paciente: ids.paciente,
        tipo: tipo.alerta,
        texto: 'Aguardando retorno da família',
        validaAte: dias(2),
      })
    ).resultado.nota;
    await expect(
      gravar({ acao: 'prorrogar', nota, versao: 1, validaAte: dias(10) }, OUTRO),
    ).rejects.toMatchObject(recusada('nota-de-outro-autor'));
    await expect(gravar({ acao: 'prorrogar', nota, versao: 1, validaAte: dias(-1) })).rejects.toMatchObject(
      recusada('validade-passada'),
    );
    await gravar({ acao: 'prorrogar', nota, versao: 1, validaAte: dias(10) });
    const n = await linha(nota);
    expect(new Date(String(n['valida_ate'])).getTime()).toBeGreaterThan(Date.now() + 9 * 86_400_000);
    // A validade passada (gravada direto, como a migração traria): vencida, fora dos alertas.
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'vencer-c1049' }, (e) =>
      e.executar('UPDATE nota_paciente SET registrada_em = ?, valida_ate = ? WHERE id = ?', [
        new Date(Date.now() - 3 * 86_400_000),
        new Date(Date.now() - 86_400_000),
        nota,
      ]),
    );
    const tela = await notas.doPaciente(ctx(), ids.paciente);
    expect(tela.notas.find((x) => x.id === nota)).toMatchObject({ situacao: 'vencida', alerta: false });
    expect(tela.alertas.map((x) => x.id)).not.toContain(nota);
  });

  it('recusas sem gravar nada: tipo inativo, texto vazio, validade passada, texto pronto alheio ou de outra aplicação, conta sem profissional', async () => {
    const antes = await contar();
    const base = { acao: 'registrar', paciente: ids.paciente, tipo: tipo.lembrete, texto: 'Lembrete válido' };
    await expect(gravar({ ...base, tipo: tipo.inativo })).rejects.toMatchObject(recusada('tipo-inativo'));
    await expect(gravar({ ...base, tipo: 999_999_999 })).rejects.toMatchObject(recusada('tipo-invalido'));
    await expect(gravar({ ...base, texto: '   ' })).rejects.toMatchObject(recusada('texto-obrigatorio'));
    await expect(gravar({ ...base, validaAte: dias(-1) })).rejects.toMatchObject(
      recusada('validade-passada'),
    );
    await expect(gravar({ ...base, predefinida: pronto.alheio })).rejects.toMatchObject(
      recusada('texto-pronto-de-outro-profissional'),
    );
    await expect(gravar({ ...base, predefinida: pronto.receita })).rejects.toMatchObject(
      recusada('texto-pronto-outra-aplicacao'),
    );
    await expect(gravar(base, SEM_PROF)).rejects.toMatchObject(recusada('usuario-sem-profissional'));
    await expect(gravar({ ...base, visibilidade: 'publica' })).rejects.toMatchObject(
      recusada('entrada-invalida'),
    );
    expect(await contar()).toBe(antes);
    expect((await notas.doPaciente(ctx(SEM_PROF), ids.paciente)).podeEscrever).toBe(false);
  });

  it('as rotas exigem o vínculo assistencial com o paciente e a leitura vai à trilha', async () => {
    const PERMS = ['pep.prontuario.ler', 'pep.evolucao.criar'];
    const montar = (vinculo: boolean) => {
      const trilha = new RegistradorTrilhaMemoria();
      const ctrl = new NotasPacienteController(
        new EstadoProntuario(),
        trilha,
        notas,
        null,
        null,
        new VinculoSintetico(
          vinculo ? [{ login: AUTOR, idPaciente: ids.paciente, forma: 'atendimento-em-curso' }] : [],
        ),
        null,
      );
      const req = () =>
        ({
          headers: { 'idempotency-key': `c1049-ctrl-${randomUUID()}`, 'x-correlation-id': 'c1049-ctrl' },
          ip: '127.0.0.1',
          sgh: {
            real: false,
            ability: criarAbility(regrasDeAcesso([...PERMS], null)),
            sessao: {
              usuario: { id: String(ids.autor), nome: 'Conta sintética', login: AUTOR },
              rede: 'rede-c1049',
              estabelecimentos: [],
              estabelecimentoAtivo: EST,
              unidadeAtiva: null,
              permissoes: [...PERMS],
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
    await expect(
      sem.ctrl.gravar(
        { acao: 'registrar', paciente: ids.paciente, tipo: tipo.lembrete, texto: 'Sem vínculo' },
        sem.req(),
      ),
    ).rejects.toMatchObject({ status: 403 });
    const [qualquer] = await ler<{ id: number }>(
      'SELECT id FROM nota_paciente WHERE paciente_id = ? LIMIT 1',
      [ids.paciente],
    );
    await expect(
      sem.ctrl.gravar({ acao: 'encerrar', nota: Number(qualquer!.id), versao: 1 }, sem.req()),
    ).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      sem.ctrl.gravar({ acao: 'encerrar', nota: 999_999_999, versao: 1 }, sem.req()),
    ).rejects.toMatchObject({
      status: 404,
    });
    expect(await contar()).toBe(antes);
    const com = montar(true);
    const tela = await com.ctrl.doPaciente(ids.paciente, com.req());
    expect(tela.notas.length).toBeGreaterThan(0);
    expect(
      com.trilha.eventos.filter(
        (e) =>
          e.evento === EVENTOS_AUDITAVEIS.consultaRes.codigo &&
          e.paciente === ids.paciente &&
          e.recurso === 'pep.prontuario',
      ),
    ).toHaveLength(1);
    const r = await com.ctrl.gravar(
      {
        acao: 'registrar',
        paciente: ids.paciente,
        tipo: tipo.lembrete,
        texto: 'Pela rota',
        visibilidade: 'todos',
      },
      com.req(),
    );
    expect(r.ok).toBe(true);
    expect(await linha(r.resultado.nota)).toMatchObject({ texto: 'Pela rota', visibilidade: 'todos' });
    await expect(com.ctrl.doPaciente(999_999_999, com.req())).rejects.toMatchObject({ status: 404 });
  });
});
