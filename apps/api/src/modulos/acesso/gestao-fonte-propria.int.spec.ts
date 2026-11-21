// Integração da fonte PRÓPRIA da gestão de acessos contra o MariaDB real, no cliente de teste da onda 2 (f22_o2).
// Massa SINTÉTICA do lote 02-02 (estabelecimento l0202e, contas teste.l0202.op e teste.l0202.alvo, perfis do teste),
// idempotente no beforeAll; as concessões, os papéis, os vínculos e a linha do tempo da conta são limpos no afterAll
// (as contas e o estabelecimento ficam, porque a trilha os referencia). Contrato de efeito: as linhas, a versão e a
// trilha (trilha_auditoria pela correlação, com o estado anterior em dados.antes) de cada gravação; recusas sem linha
// nova na trilha: perfil inexistente, concessão sobreposta, a si mesmo, versão velha, conta e concessão de outro
// estabelecimento, revogação repetida, papel já concedido, bloqueio repetido, operação de grupo e as pendências;
// idempotência: a mesma chave com outra entrada é recusada; reconcessão após revogação no mesmo dia reabre a linha.
// A bateria comum memória × banco fica no fim (describe.each).
// SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
import { randomUUID } from 'node:crypto';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { fonteGestaoPropria } from './gestao-fonte-propria.js';
import { type FonteGestao, fonteGestaoMemoria } from './gestao-fonte.js';
import type { TrilhaGestao } from './gestao-tipos.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'l0202e';
const OUTRO = 'l0202f';
const OP = 'teste.l0202.op';
const ALVO = 'teste.l0202.alvo';
const FORA = 'teste.l0202.fora';
const PERFIL = 'l0202-teste';

describe.skipIf(SEM_BANCO)('fonte própria da gestão de acessos contra o MariaDB (cliente f22_o2)', () => {
  let nucleo: NucleoProprio;
  let fonte: FonteGestao;
  const ids = { est: 0, outro: 0, op: 0, alvo: 0, fora: 0, papel: 0, papelCriado: false, concessaoFora: 0 };

  async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  }
  const usuarios = () => [ids.op, ids.alvo, ids.fora];
  async function limpar(e: Escritor) {
    if (!ids.op) return;
    const u = usuarios();
    await e.executar('DELETE FROM usuario_situacao_historico WHERE usuario_id IN (?, ?, ?)', u);
    await e.executar('DELETE FROM usuario_papel_seguranca WHERE usuario_id IN (?, ?, ?)', u);
    await e.executar('DELETE FROM usuario_perfil WHERE usuario_id IN (?, ?, ?)', u);
    await e.executar("UPDATE usuario SET situacao = 'ativo', bloqueado_em = NULL WHERE id IN (?, ?, ?)", u);
  }
  const ler = (sql: string, p: unknown[]) =>
    nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l0202-conferir' }, (l) => l.uma(sql, p));
  const trilha = (): TrilhaGestao => ({
    evento: 'acesso.perfil.concedido',
    rede: 'teste',
    hospital: EST,
    usuario: OP,
    estacao: 'teste:l0202',
    correlacao: `teste-l0202-${randomUUID()}`.slice(0, 64),
    recurso: 'acesso.perfil',
    resultado: 'sucesso',
  });
  const ctx = () => ({
    rede: 'teste',
    hospital: EST,
    usuario: OP,
    correlacao: `teste-l0202-${randomUUID()}`.slice(0, 64),
    chaveIdempotencia: `teste-l0202:${randomUUID()}`,
  });
  const codigo = async (p: Promise<unknown>) =>
    p.then(
      () => 'ok',
      (e: { problema?: { codigo?: string } }) => e.problema?.codigo ?? String(e),
    );

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-l0202' }, async (e) => {
      const agora = new Date();
      const est = (c: string) =>
        garantir(e, 'SELECT id FROM estabelecimento WHERE codigo = ?', [c],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [c, `Hospital sintético ${c}`, `Hospital sintético ${c} (fictício)`, agora]);
      ids.est = await est(EST);
      ids.outro = await est(OUTRO);
      const usuario = (login: string) =>
        garantir(e, 'SELECT id FROM usuario WHERE login = ?', [login],
          'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
          [login, `USUARIO SINTETICO ${login.toUpperCase()}`, agora]);
      ids.op = await usuario(OP);
      ids.alvo = await usuario(ALVO);
      ids.fora = await usuario(FORA);
      await limpar(e);
      for (const [u, es] of [[ids.op, ids.est], [ids.alvo, ids.est], [ids.fora, ids.outro]] as const)
        await garantir(e, 'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?', [u, es],
          'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [u, es, '2026-01-01', agora]);
      for (const p of [PERFIL, 'gestor-acessos'])
        await garantir(e, 'SELECT id FROM perfil_acesso WHERE codigo = ? AND estabelecimento_id = ?', [p, ids.est],
          'INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
          [ids.est, p, `Perfil sintético ${p}`, agora]);
      // Uma concessão de OUTRO estabelecimento (a recusa por estabelecimento).
      const perfilFora = await garantir(e, 'SELECT id FROM perfil_acesso WHERE codigo = ? AND estabelecimento_id = ?', [PERFIL, ids.outro],
        'INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, criado_em) VALUES (?, ?, ?, ?)',
        [ids.outro, PERFIL, `Perfil sintético ${PERFIL}`, agora]);
      ids.concessaoFora = await e.inserir(
        'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, provisorio, motivo, criado_em) VALUES (?, ?, ?, ?, FALSE, ?, ?)',
        [ids.fora, perfilFora, ids.outro, '2026-01-01', 'Concessão sintética de outro hospital', agora]);
      const papel = await e.uma<{ id: number }>("SELECT id FROM papel_seguranca WHERE codigo = 'gestor_acessos'");
      ids.papelCriado = !papel;
      ids.papel = papel
        ? Number(papel.id)
        : await e.inserir("INSERT INTO papel_seguranca (codigo, nome, criado_em) VALUES ('gestor_acessos', 'Gestor de acessos', ?)", [agora]);
    });
    fonte = fonteGestaoPropria(nucleo, CLIENTE);
  });

  afterAll(async () => {
    if (!nucleo) return;
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'limpeza-l0202' }, async (e) => {
      await limpar(e);
      if (ids.papelCriado) await e.executar('DELETE FROM papel_seguranca WHERE id = ?', [ids.papel]);
    });
    await nucleo.encerrar();
  });

  it('busca e lê só as contas com vínculo vigente no estabelecimento', async () => {
    const achados = await fonte.buscarUsuarios('teste', EST, 'teste.l0202');
    expect(achados.map((u) => u.login).sort()).toEqual([ALVO, OP]);
    expect(await fonte.usuario('teste', EST, FORA)).toBeNull();
    expect(await fonte.usuario('teste', EST, ALVO)).toMatchObject({ login: ALVO, grupo: null, ativo: true, bloqueado: false });
  });

  const conceder = (login: string, inicio: string | null, motivo: string, fim: string | null = null) =>
    fonte.concederPerfil('teste', EST, {
      idUsuario: 0, login, perfil: PERFIL, concedidoPor: OP, areaAprovou: 'TI',
      inicio: inicio ? new Date(`${inicio}T12:00:00Z`) : null, fim: fim ? new Date(`${fim}T12:00:00Z`) : null, motivo,
    }, trilha());
  const trilhas = async () =>
    Number((await ler('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE estabelecimento_id = ?', [ids.est]))?.['n']);
  const json = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : v) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  it('concede, altera e revoga o perfil: linhas, versão, trilha com o anterior; recusas sem trilha', async () => {
    const t = trilha();
    const { id } = await fonte.concederPerfil('teste', EST, {
      idUsuario: ids.alvo, login: ALVO, perfil: PERFIL, concedidoPor: OP, areaAprovou: 'TI',
      inicio: new Date('2026-02-01T12:00:00Z'), fim: null, motivo: 'Concessão sintética do teste',
    }, t);
    const linha = await ler('SELECT usuario_id, estabelecimento_id, vigencia_inicio, versao, criado_por FROM usuario_perfil WHERE id = ?', [Number(id)]);
    expect(linha).toMatchObject({ usuario_id: ids.alvo, estabelecimento_id: ids.est, versao: 1, criado_por: ids.op });
    expect(await ler('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ? AND entidade = ?', [t.correlacao, 'usuario_perfil'])).toMatchObject({ n: 1 });

    // Recusas: nenhuma linha nova na trilha.
    const n0 = await trilhas();
    expect(await codigo(conceder(ALVO, '2026-02-01', 'Repetida'))).toBe('perfil-ja-concedido');
    expect(await codigo(conceder(ALVO, '2026-06-01', 'Sobreposta, outro início'))).toBe('perfil-ja-concedido');
    expect(await codigo(fonte.concederPerfil('teste', EST, {
      idUsuario: ids.alvo, login: ALVO, perfil: 'nao-existe-l0202', concedidoPor: OP, areaAprovou: 'TI', inicio: null, fim: null, motivo: 'x',
    }, trilha()))).toBe('perfil-inexistente');
    expect(await codigo(conceder(FORA, null, 'Conta de outro estabelecimento'))).toBe('nao-encontrado');
    expect(await codigo(fonte.alterarPerfil('teste', EST, { id, inicio: new Date(), fim: null, motivo: 'x', justificativa: 'x', por: ALVO }, trilha()))).toBe('a-si-mesmo');
    expect(await codigo(fonte.alterarPerfil('teste', EST, {
      id, inicio: new Date('2026-02-01T12:00:00Z'), fim: null, motivo: 'Versão velha', justificativa: 'Tela desatualizada', por: OP, versao: 99,
    }, trilha()))).toBe('conflito-versao');
    // Concessão de OUTRO estabelecimento: 404 na revogação e na alteração.
    expect(await codigo(fonte.revogarPerfil('teste', EST, String(ids.concessaoFora), OP, trilha(), 'Outro hospital'))).toBe('nao-encontrado');
    expect(await codigo(fonte.alterarPerfil('teste', EST, {
      id: String(ids.concessaoFora), inicio: new Date(), fim: null, motivo: 'x', justificativa: 'Outro hospital', por: OP,
    }, trilha()))).toBe('nao-encontrado');
    expect(await trilhas()).toBe(n0);
    expect(await ler('SELECT versao, excluido_em FROM usuario_perfil WHERE id = ?', [ids.concessaoFora])).toMatchObject({ versao: 1, excluido_em: null });

    // Alteração com a versão lida: a trilha guarda o anterior (vigência e motivo).
    const ta = trilha();
    const alt = await fonte.alterarPerfil('teste', EST, {
      id, inicio: new Date('2026-02-01T12:00:00Z'), fim: new Date('2027-02-01T12:00:00Z'), motivo: 'Novo prazo', justificativa: 'Ajuste sintético', por: OP, versao: 1,
    }, ta);
    expect(alt).toMatchObject({ situacao: 'ok', login: ALVO, perfil: PERFIL, alteracao: `${id}.2` });
    expect(await ler('SELECT versao FROM usuario_perfil WHERE id = ?', [Number(id)])).toMatchObject({ versao: 2 });
    const ra = await ler('SELECT motivo, dados_depois FROM trilha_auditoria WHERE correlacao = ?', [ta.correlacao]);
    expect(ra?.['motivo']).toBe('Ajuste sintético');
    expect(json(ra?.['dados_depois'])['dados']).toMatchObject({
      antes: { vigenciaInicio: '2026-02-01', vigenciaFim: null, motivo: 'Concessão sintética do teste', versao: 1 },
      depois: { inicio: '2026-02-01', fim: '2027-02-01', motivo: 'Novo prazo' },
    });

    const hist = await fonte.historicoPerfis('teste', EST, ALVO);
    expect(hist[0]).toMatchObject({ id, perfil: PERFIL, concedidoPor: OP, revogadoEm: null, versao: 2 });

    const tr = trilha();
    expect(await fonte.revogarPerfil('teste', EST, id, OP, tr, 'Revogação sintética')).toEqual({ login: ALVO, perfil: PERFIL });
    const rev = await ler('SELECT versao, excluido_por, excluido_em FROM usuario_perfil WHERE id = ?', [Number(id)]);
    expect(rev).toMatchObject({ versao: 3, excluido_por: ids.op });
    expect(rev?.['excluido_em']).not.toBeNull();
    const rr = await ler('SELECT motivo, dados_depois FROM trilha_auditoria WHERE correlacao = ?', [tr.correlacao]);
    expect(rr?.['motivo']).toBe('Revogação sintética');
    expect(json(rr?.['dados_depois'])['dados']).toMatchObject({ antes: { vigenciaFim: '2027-02-01', motivo: 'Novo prazo', versao: 2 } });
    const n1 = await trilhas();
    expect(await codigo(fonte.revogarPerfil('teste', EST, id, OP, trilha(), 'De novo'))).toBe('nao-encontrado');
    expect(await trilhas()).toBe(n1);
    expect((await fonte.historicoPerfis('teste', EST, ALVO))[0]).toMatchObject({ revogadoPor: OP });

    // Revogada por engano: conceder de novo no mesmo início reabre a mesma concessão (a chave única cobre as revogadas).
    const tc = trilha();
    const de0 = await fonte.concederPerfil('teste', EST, {
      idUsuario: ids.alvo, login: ALVO, perfil: PERFIL, concedidoPor: OP, areaAprovou: 'TI',
      inicio: new Date('2026-02-01T12:00:00Z'), fim: null, motivo: 'Reconcessão sintética',
    }, tc);
    expect(de0.id).toBe(id);
    expect(await ler('SELECT versao, excluido_em, vigencia_fim, motivo FROM usuario_perfil WHERE id = ?', [Number(id)]))
      .toMatchObject({ versao: 4, excluido_em: null, vigencia_fim: null, motivo: 'Reconcessão sintética' });
    const rc = await ler('SELECT dados_depois FROM trilha_auditoria WHERE correlacao = ?', [tc.correlacao]);
    expect(json(rc?.['dados_depois'])['dados']).toMatchObject({ antes: { revogada: true, versao: 3 } });
  });

  it('idempotência: a mesma chave com a mesma entrada repete sem gravar; com outra entrada é recusada', async () => {
    const c = ctx();
    await fonte.executar('acesso.concederPapelUsuario', EST, { login: ALVO, papel: 0 }, c);
    const n = await trilhas();
    await fonte.executar('acesso.concederPapelUsuario', EST, { login: ALVO, papel: 0 }, c);
    expect(await trilhas()).toBe(n);
    expect(await codigo(fonte.executar('acesso.concederPapelUsuario', EST, { login: OP, papel: 0 }, c))).toBe('idempotencia-divergente');
    expect(await fonte.papeisDoUsuario('teste', EST, OP)).toEqual([]);
    const k = `teste-l0202:${randomUUID()}`;
    const dupla = { ...ctx(), chaveIdempotencia: k };
    await fonte.executar('acesso.revogarPapelUsuario', EST, { login: ALVO, papel: 0 }, dupla);
    expect(await codigo(fonte.executar('acesso.reativarPapelUsuario', EST, { login: ALVO, papel: 0 }, dupla))).toBe('ok');
    expect(await codigo(fonte.executar('acesso.revogarPapelUsuario', EST, { login: OP, papel: 0 }, dupla))).toBe('idempotencia-divergente');
    await fonte.executar('acesso.revogarPapelUsuario', EST, { login: ALVO, papel: 0 }, ctx());
  });

  it('papel de segurança: concede, retira e reativa; o gestor aparece; recusas', async () => {
    expect(fonte.receita('acesso.concederPapelUsuario', EST).ligada).toBe(true);
    await fonte.executar('acesso.concederPapelUsuario', EST, { login: OP, papel: 0 }, ctx());
    expect(await codigo(fonte.executar('acesso.concederPapelUsuario', EST, { login: OP, papel: 0 }, ctx()))).toBe('papel-ja-concedido');
    expect(await fonte.papeisDoUsuario('teste', EST, OP)).toEqual([expect.objectContaining({ papel: 0, ativo: true })]);
    expect((await fonte.gestoresAcesso('teste', EST)).find((g) => g.login === OP)).toMatchObject({ papelGestor: true });
    await fonte.executar('acesso.revogarPapelUsuario', EST, { login: OP, papel: 0 }, ctx());
    expect((await fonte.papeisDoUsuario('teste', EST, OP))[0]?.ativo).toBe(false);
    expect(await codigo(fonte.executar('acesso.revogarPapelUsuario', EST, { login: OP, papel: 0 }, ctx()))).toBe('papel-nao-concedido');
    await fonte.executar('acesso.reativarPapelUsuario', EST, { login: OP, papel: 0 }, ctx());
    expect((await fonte.papeisDoUsuario('teste', EST, OP))[0]?.ativo).toBe(true);
    expect(await ler('SELECT COUNT(*) AS n FROM usuario_papel_seguranca WHERE usuario_id = ?', [ids.op])).toMatchObject({ n: 1 });
  });

  it('bloqueia a conta com a linha do tempo; repetir é recusado; grupo e pendências recusados sem gravar', async () => {
    const c = ctx();
    await fonte.executar('acesso.bloquearUsuario', EST, { login: ALVO }, c);
    expect(await ler('SELECT situacao, versao > 1 AS mudou FROM usuario WHERE id = ?', [ids.alvo])).toMatchObject({ situacao: 'bloqueado', mudou: 1 });
    expect(await ler('SELECT situacao_anterior, situacao_nova, evento, responsavel_usuario_id FROM usuario_situacao_historico WHERE usuario_id = ? ORDER BY id DESC', [ids.alvo]))
      .toMatchObject({ situacao_anterior: 'ativo', situacao_nova: 'bloqueado', evento: 'bloqueio', responsavel_usuario_id: ids.op });
    expect(await ler('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE correlacao = ?', [c.correlacao])).toMatchObject({ n: 1 });
    expect(await codigo(fonte.executar('acesso.bloquearUsuario', EST, { login: ALVO }, ctx()))).toBe('ja-bloqueado');
    expect((await fonte.contasDormencia('teste', EST)).map((x) => x.login)).not.toContain(ALVO);
    expect(await codigo(fonte.executar('acesso.trocarGrupoUsuario', EST, { login: ALVO, grupo: 'X' }, ctx()))).toBe('sem-grupos');
    expect(fonte.receita('acesso.criarGrupo', EST).ligada).toBe(false);
    expect(await codigo(fonte.executar('acesso.bloquearUsuario', EST, { login: 1 }, ctx()))).toBe('entrada-invalida');
    expect(await codigo(fonte.publicarPoliticaSenha('teste', EST, {} as never, new Date(), trilha()))).toBe('modelo-pendente');
    expect(await codigo(fonte.pedidosAcesso('teste', EST))).toBe('adaptador-pendente');
    expect(await fonte.grupos('teste', EST)).toEqual([]);
  });

  // A mesma bateria nas duas fontes: a memória responde null/situação, o banco lança o código; o desfecho é o mesmo.
  describe.each([
    ['memória', () => fonteGestaoMemoria(new RegistradorTrilhaMemoria())],
    ['banco', () => fonte],
  ] as const)('bateria comum da concessão de perfil (%s)', (_nome, criar) => {
    const desfecho = (p: Promise<unknown>) =>
      p.then(
        (r) => {
          if (r === null) return 'nao-encontrado';
          const s = (r as { situacao?: string }).situacao;
          return s === 'inexistente' ? 'nao-encontrado' : (s ?? 'ok');
        },
        (e: { problema?: { codigo?: string } }) => e.problema?.codigo ?? String(e),
      );
    it('concede, recusa a alteração do próprio perfil, revoga uma vez só', async () => {
      const f = criar();
      const { id } = await f.concederPerfil('teste', EST, {
        idUsuario: ids.alvo, login: ALVO, perfil: 'gestor-acessos', concedidoPor: OP, areaAprovou: 'TI',
        inicio: new Date('2026-03-01T12:00:00Z'), fim: null, motivo: 'Bateria comum',
      }, trilha());
      expect(id).toMatch(/^\d+$|^[\w-]+$/);
      expect(await desfecho(f.alterarPerfil('teste', EST, {
        id, inicio: new Date('2026-03-01T12:00:00Z'), fim: null, motivo: 'x', justificativa: 'Próprio perfil', por: ALVO,
      }, trilha()))).toBe('a-si-mesmo');
      expect(await desfecho(f.alterarPerfil('teste', EST, {
        id, inicio: new Date('2026-03-01T12:00:00Z'), fim: new Date('2027-03-01T12:00:00Z'), motivo: 'Prazo', justificativa: 'Ajuste da bateria', por: OP,
      }, trilha()))).toBe('ok');
      expect(await desfecho(f.revogarPerfil('teste', EST, id, OP, trilha(), 'Bateria comum'))).toBe('ok');
      expect(await desfecho(f.revogarPerfil('teste', EST, id, OP, trilha(), 'De novo'))).toBe('nao-encontrado');
      expect(await desfecho(f.alterarPerfil('teste', EST, {
        id, inicio: new Date('2026-03-01T12:00:00Z'), fim: null, motivo: 'x', justificativa: 'Já revogada', por: OP,
      }, trilha()))).toBe('nao-encontrado');
    });
  });
});
