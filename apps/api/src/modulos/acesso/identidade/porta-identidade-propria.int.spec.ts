// Integração da porta PRÓPRIA da identidade contra o MariaDB real, no cliente de teste da onda 2 (f22_o2). Massa
// SINTÉTICA do lote 02-03 (estabelecimentos l0203e e l0203f, contas teste.l0203a/b/c, perfil L0203-2FA), idempotente
// no beforeAll e limpa no afterAll. Contrato de efeito: a credencial não Argon2id recusa no login (fluxo real do
// serviço) e só volta pela redefinição do gestor (mesma linha, versão +1, trilha com o GESTOR como usuário, sem o
// resumo); a troca já gravada pela porta da senha não é regravada (versão e trilha intactas); o ciclo do segundo fator (pendente → ativo → revogado, segredo
// descartado, anti-repetição do passo), a exigência pelo perfil (exige segundo fator ou privilegiado) como adesão no
// login, a lista e as contagens; e as recusas (outro
// estabelecimento, política sem modelo, repetição). A mesma bateria do segundo fator roda na memória e no banco.
// SGH_NUCLEO_SEM_BANCO=1 pula o arquivo.
import { randomUUID } from 'node:crypto';
import { cifrarSenha, conferirSenha } from '@sgh/dominio-acesso';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PortaIdentidadeMemoria } from './porta-identidade-memoria.js';
import { PortaIdentidadePropria } from './porta-identidade-propria.js';
import { type AtorIdentidade, type PortaIdentidade, ServicoIdentidade } from './servico-identidade.js';
import type { TrilhaIdentidade } from './tipos-identidade.js';

const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'f22_o2';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const EST = 'l0203e';
const OUTRO = 'l0203f';
const A = 'teste.l0203a';
const B = 'teste.l0203b';
const C = 'teste.l0203c';
const PERFIL = 'L0203-2FA';
const PERFIL_PRIV = 'L0203-PRIV';
const ARGON_TESTE = { memoria: 8192, passes: 1, paralelismo: 1 };
/** Resumo fictício de uma senha anterior em bcrypt (não confere com nada). */
const RESUMO_ANTERIOR = '$2b$10$abcdefghijklmnopqrstuuSinteticoSinteticoSinteticoSinte';

const ids = { est: 0, outro: 0, a: 0, b: 0, c: 0, perfil: 0, priv: 0 };
let nucleo: NucleoProprio;
let porta: PortaIdentidadePropria;
let servico: ServicoIdentidade;
const avisos: string[] = [];
const ator = (login: string, idUsuario: number): AtorIdentidade => ({
  rede: 'teste',
  hospital: EST,
  login,
  idUsuario,
  estacao: null,
  correlacao: `teste-l0203-${randomUUID()}`.slice(0, 64),
});
const credencial = (id: number) =>
  linha(
    `SELECT c.id, c.versao, c.algoritmo, c.senha_alterada_em, c.troca_obrigatoria,
            (SELECT COUNT(*) FROM trilha_auditoria t WHERE t.entidade = 'credencial_usuario' AND t.entidade_id = c.id) AS trilhas
       FROM credencial_usuario c WHERE c.usuario_id = ?`,
    [id],
  );

const trilha = (idUsuario: number, evento: string): TrilhaIdentidade => ({
  rede: 'teste',
  hospital: EST,
  usuario: 'teste.l0203',
  idUsuario,
  evento,
  recurso: 'acesso.identidade',
  operacao: evento,
  resultado: 'sucesso',
  estacao: null,
  correlacao: `teste-l0203-${randomUUID()}`.slice(0, 64),
});
const linha = (sql: string, p: unknown[]) =>
  nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'teste-l0203-conferir' }, (l) => l.uma(sql, p));
const trilhaDe = (entidade: string, id: number) =>
  linha(
    `SELECT acao, usuario_id, estabelecimento_id, dados_depois FROM trilha_auditoria
      WHERE entidade = ? AND entidade_id = ? ORDER BY id DESC LIMIT 1`,
    [entidade, id],
  );

async function garantir(e: Escritor, sel: string, p: unknown[], ins: string, pi: unknown[]): Promise<number> {
  const l = await e.uma<{ id: number }>(sel, p);
  return l ? Number(l.id) : e.inserir(ins, pi);
}
async function limpar(e: Escritor) {
  const contas = [ids.a, ids.b, ids.c].filter((x) => x > 0);
  if (!contas.length) return;
  const em = contas.map(() => '?').join(',');
  await e.executar(`DELETE FROM segundo_fator_usuario WHERE usuario_id IN (${em})`, contas);
  await e.executar(`DELETE FROM credencial_usuario WHERE usuario_id IN (${em})`, contas);
}

beforeAll(async () => {
  if (SEM_BANCO) return;
  nucleo = new NucleoProprio();
  expect((await nucleo.cliente(CLIENTE)).banco).toBe(`cliente_${CLIENTE}`);
  await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-l0203' }, async (e) => {
    const agora = new Date();
    const est = (cod: string) =>
      garantir(
        e,
        'SELECT id FROM estabelecimento WHERE codigo = ?',
        [cod],
        'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
        [cod, `Hospital sintético ${cod}`, `Hospital sintético ${cod} (fictício)`, agora],
      );
    ids.est = await est(EST);
    ids.outro = await est(OUTRO);
    const conta = (login: string, estab: number) =>
      garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [login],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [login, `USUARIO SINTETICO ${login.toUpperCase()}`, agora],
      ).then(async (id) => {
        await garantir(
          e,
          'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?',
          [id, estab],
          `INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em)
           VALUES (?, ?, '2020-01-01', ?)`,
          [id, estab, agora],
        );
        return id;
      });
    ids.a = await conta(A, ids.est);
    ids.b = await conta(B, ids.est);
    ids.c = await conta(C, ids.outro);
    await e.executar("UPDATE usuario SET situacao = 'ativo', expira_em = NULL WHERE id IN (?, ?, ?)", [
      ids.a,
      ids.b,
      ids.c,
    ]);
    ids.perfil = await garantir(
      e,
      'SELECT id FROM perfil_acesso WHERE codigo = ? AND estabelecimento_id = ?',
      [PERFIL, ids.est],
      `INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, exige_segundo_fator, ativado_em, criado_em)
       VALUES (?, ?, 'Perfil sintético do lote 02-03', TRUE, '2026-01-01', ?)`,
      [ids.est, PERFIL, agora],
    );
    await garantir(
      e,
      'SELECT id FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id = ?',
      [ids.b, ids.perfil],
      `INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em)
       VALUES (?, ?, ?, '2020-01-01', ?)`,
      [ids.b, ids.perfil, ids.est, agora],
    );
    // Perfil só privilegiado (exige_segundo_fator = FALSE): o DDL diz que privilegiado exige segundo fator.
    ids.priv = await garantir(
      e,
      'SELECT id FROM perfil_acesso WHERE codigo = ? AND estabelecimento_id = ?',
      [PERFIL_PRIV, ids.est],
      `INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, privilegiado, exige_segundo_fator, ativado_em, criado_em)
       VALUES (?, ?, 'Perfil privilegiado sintético do lote 02-03', TRUE, FALSE, '2026-01-01', ?)`,
      [ids.est, PERFIL_PRIV, agora],
    );
    await limpar(e);
    // A: senha anterior (bcrypt, da migração). B: credencial forte. C: outro estabelecimento.
    await e.inserir(
      `INSERT INTO credencial_usuario (usuario_id, algoritmo, resumo_senha, senha_alterada_em, criado_em)
       VALUES (?, 'bcrypt', ?, '2026-02-01 10:00:00', ?)`,
      [ids.a, RESUMO_ANTERIOR, agora],
    );
    await e.inserir(
      `INSERT INTO credencial_usuario (usuario_id, algoritmo, resumo_senha, senha_alterada_em, criado_em)
       VALUES (?, 'argon2id', ?, ?, ?)`,
      [ids.b, await cifrarSenha('Sintetica#B1', ARGON_TESTE), agora, agora],
    );
    await e.inserir(
      `INSERT INTO credencial_usuario (usuario_id, algoritmo, resumo_senha, senha_alterada_em, criado_em)
       VALUES (?, 'bcrypt', ?, '2026-02-01 10:00:00', ?)`,
      [ids.c, RESUMO_ANTERIOR, agora],
    );
  });
  porta = new PortaIdentidadePropria(nucleo, CLIENTE);
  servico = new ServicoIdentidade({
    porta,
    chave: Buffer.alloc(32, 5),
    emissor: 'Produto sintético',
    argon2: ARGON_TESTE,
    aviso: (m) => avisos.push(m),
  });
});

afterAll(async () => {
  await nucleo?.escrever({ cliente: CLIENTE, correlacao: 'limpeza-l0203' }, (e) => limpar(e));
  await nucleo?.encerrar();
});

describe.skipIf(SEM_BANCO)('porta própria da identidade contra o MariaDB (cliente f22_o2)', () => {
  it('conta: só com vínculo vigente; senha anterior visível sem valor; outro estabelecimento não alcança', async () => {
    expect(await porta.prontas(EST)).toBe(true);
    expect(await porta.prontas('l0203x')).toBe(false);
    const a = await porta.conta(EST, A);
    expect(a).toMatchObject({
      id: ids.a,
      login: A,
      ativo: true,
      bloqueado: false,
      senhaPresente: true,
      redefinicaoObrigatoria: true,
    });
    expect(JSON.stringify(a)).not.toContain('$2b$');
    expect((await porta.conta(EST, B))?.grupo).toContain(PERFIL);
    expect(await porta.conta(EST, C)).toBeNull();
    expect(await porta.conta(OUTRO, C)).toMatchObject({ id: ids.c });
    expect(await porta.forte(EST, A, ids.a)).toBeNull();
    expect(await porta.forte(EST, B, ids.b)).toMatchObject({ algoritmo: 'argon2id', parametros: 'm=8192,t=1,p=1' });
    const r = await porta.autenticarForte(EST, B, ids.b, 'Sintetica#B1', conferirSenha);
    expect(r?.confere).toBe(true);
    expect((await porta.autenticarForte(EST, B, ids.b, 'errada', conferirSenha))?.confere).toBe(false);
  });

  it('credencial não Argon2id: o login (fluxo real do serviço) recusa sem gravar nada', async () => {
    const antes = await credencial(ids.a);
    expect(await servico.autenticar(EST, A, 'qualquer#1')).toEqual({ tipo: 'forte-invalida' });
    expect(avisos).toContain('credencial a redefinir pelo gestor');
    expect(await credencial(ids.a)).toEqual(antes);
  });

  it('redefinição pelo gestor: mesma linha, versão +1, trilha com o gestor como usuário e sem o resumo', async () => {
    const antes = await credencial(ids.a);
    expect(await servico.regravar(ator(A, ids.a), 'Provisoria#A1', 'senha-provisoria', ator(B, ids.b))).toBe(true);
    const depois = await credencial(ids.a);
    expect(depois).toMatchObject({ id: antes?.['id'], algoritmo: 'argon2id', versao: Number(antes?.['versao']) + 1 });
    expect(Boolean(depois?.['troca_obrigatoria'])).toBe(true);
    expect(Number(depois?.['trilhas'])).toBe(Number(antes?.['trilhas']) + 1);
    const t = await trilhaDe('credencial_usuario', Number(antes?.['id']));
    expect(t).toMatchObject({ usuario_id: ids.b, estabelecimento_id: ids.est });
    expect(JSON.stringify(t)).not.toContain('$argon2');
    expect((await porta.conta(EST, A))?.redefinicaoObrigatoria).toBe(false);
    expect(await servico.autenticar(EST, A, 'Provisoria#A1')).toMatchObject({ tipo: 'forte-ok', provisoria: true });
  });

  it('troca já gravada pela porta da senha (Argon2id): regravar não toca a linha (versão e trilha intactas)', async () => {
    const antes = await credencial(ids.b);
    expect(await servico.regravar(ator(B, ids.b), 'Trocada#B2', 'troca-senha')).toBe(true);
    expect(await credencial(ids.b)).toEqual(antes);
    expect((await porta.autenticarForte(EST, B, ids.b, 'Sintetica#B1', conferirSenha))?.confere).toBe(true);
  });

  it('conta sem vínculo com o estabelecimento da sessão: a conversão recusa sem gravar', async () => {
    const antes = await credencial(ids.c);
    const hashPhc = await cifrarSenha('Sintetica#C1', ARGON_TESTE);
    await expect(
      porta.gravarForte(
        EST,
        { idUsuario: ids.c, login: C, hashPhc, algoritmo: 'argon2id', parametros: 'm=8192,t=1,p=1', origem: 'senha-provisoria' },
        trilha(ids.b, 'acesso.credencial.regravada'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'fora-do-estabelecimento' } });
    expect(await credencial(ids.c)).toEqual(antes);
  });

  it('exigência pelo perfil (exige segundo fator ou privilegiado): no login, entra e é levado ao cadastro', async () => {
    const p = await porta.politicas(EST);
    expect(p).toContainEqual(
      expect.objectContaining({ alvo: 'perfil', valor: PERFIL_PRIV, origem: 'cadastro-perfil' }),
    );
    expect(
      await servico.segundoFatorNoLogin(EST, { login: B, id: ids.b }, { perfil: PERFIL, complementares: [], grupo: null }, undefined),
    ).toEqual({
      tipo: 'entrar',
      info: { cadastrado: false, disponivel: true, exigencia: 'adesao', prazoAdesaoAte: null },
    });
    expect(
      (await servico.meuSegundoFator(ator(B, ids.b), { perfil: PERFIL_PRIV, complementares: [], grupo: null }))
        .exigencia,
    ).toBe('adesao');
  });

  it('exigência pelo perfil; política por onda sem modelo: recusa sem gravar', async () => {
    const p = await porta.politicas(EST);
    expect(p).toContainEqual(expect.objectContaining({ alvo: 'perfil', valor: PERFIL, inicio: '2026-01-01', onda: 1 }));
    expect(await porta.politicas(OUTRO)).not.toContainEqual(expect.objectContaining({ valor: PERFIL }));
    await expect(
      porta.incluirPolitica(
        EST,
        {
          hospital: EST,
          alvo: 'todos',
          valor: null,
          onda: 2,
          inicio: '2026-12-01',
          prazoAdesaoDias: 30,
          motivo: 'teste',
          criadaPor: 'teste.l0203',
        },
        trilha(ids.b, 'acesso.politicaSegundoFator.incluida'),
      ),
    ).rejects.toMatchObject({ problema: { codigo: 'modelo-pendente', status: 409 } });
  });

  it('lista e contagens do estabelecimento, com o filtro da senha antes da paginação', async () => {
    const todos = await porta.usuarios(EST, { busca: 'teste.l0203', pagina: 1, tamanho: 50 });
    expect(todos.itens.map((u) => u.login)).toEqual([A, B]);
    const fortes = await porta.usuarios(EST, { busca: 'teste.l0203', senha: 'forte', pagina: 1, tamanho: 1 });
    expect(fortes.itens).toHaveLength(1);
    expect(fortes.temMais).toBe(true);
    const n = (await porta.contagens(EST)).reduce((s, g) => s + g.n, 0);
    expect(n).toBeGreaterThanOrEqual(2);
  });

  it('segundo fator de outro estabelecimento: confirmar e revogar recusam sem gravar', async () => {
    const r = await porta.iniciar2fa(
      OUTRO,
      { idUsuario: ids.c, login: C, segredoEnvelope: 'v1.a.b.c' },
      { ...trilha(ids.c, 'acesso.segundofator.iniciado'), hospital: OUTRO },
    );
    expect(r).not.toBeNull();
    expect(await porta.confirmar2fa(EST, r!.id, trilha(ids.b, 'acesso.segundofator.confirmado'))).toBe(false);
    expect(await porta.revogar2fa(EST, r!.id, trilha(ids.b, 'acesso.segundofator.revogado'))).toBe(false);
    expect((await porta.segundoFator(OUTRO, C, ids.c))?.situacao).toBe('pendente');
  });
});

/** A mesma bateria do segundo fator na memória e no banco. */
describe.each([
  ['memória', () => ({ p: new PortaIdentidadeMemoria().usuario({ login: B, id: 1 }) as PortaIdentidade, id: 1, h: EST })],
  ['banco', () => ({ p: porta as PortaIdentidade, id: ids.b, h: EST })],
] as const)('ciclo do segundo fator (%s)', (nome, fabrica) => {
  it.skipIf(nome === 'banco' && SEM_BANCO)('pendente → ativo → revogado, sem repetir o passo', async () => {
    const { p, id, h } = fabrica();
    const t = (e: string) => trilha(id, e);
    const r1 = await p.iniciar2fa(h, { idUsuario: id, login: B, segredoEnvelope: 'v1.x.y.z' }, t('acesso.segundofator.iniciado'));
    const r2 = await p.iniciar2fa(h, { idUsuario: id, login: B, segredoEnvelope: 'v1.x.y.w' }, t('acesso.segundofator.iniciado'));
    expect(r2?.id).toBe(r1?.id);
    expect(await p.segundoFator(h, B, id)).toMatchObject({ situacao: 'pendente', segredoEnvelope: 'v1.x.y.w' });
    expect(await p.marcar2fa(h, r1!.id, new Date('2026-11-21T10:00:00Z'))).toBe(false);
    expect(await p.confirmar2fa(h, r1!.id, t('acesso.segundofator.confirmado'))).toBe(true);
    expect(await p.confirmar2fa(h, r1!.id, t('acesso.segundofator.confirmado'))).toBe(false);
    expect(await p.iniciar2fa(h, { idUsuario: id, login: B, segredoEnvelope: 'v1.n.o.p' }, t('x'))).toBeNull();
    const passo = new Date('2026-11-21T10:00:00Z');
    expect(await p.marcar2fa(h, r1!.id, passo)).toBe(true);
    expect(await p.marcar2fa(h, r1!.id, passo)).toBe(false);
    expect(await p.marcar2fa(h, r1!.id, new Date(passo.getTime() + 30_000))).toBe(true);
    expect(await p.revogar2fa(h, r1!.id, t('acesso.segundofator.revogado'))).toBe(true);
    expect(await p.revogar2fa(h, r1!.id, t('acesso.segundofator.revogado'))).toBe(false);
    const f = await p.segundoFator(h, B, id);
    expect(f?.situacao).toBe('revogado');
    expect(f?.segredoEnvelope).not.toBe('v1.x.y.w');
    if (nome === 'banco') {
      const l = await linha('SELECT situacao, referencia_cofre, revogado_em, versao FROM segundo_fator_usuario WHERE id = ?', [
        Number(r1!.id),
      ]);
      expect(l).toMatchObject({ situacao: 'revogado', referencia_cofre: 'descartado' });
      expect(l?.['revogado_em']).not.toBeNull();
      expect(await trilhaDe('segundo_fator_usuario', Number(r1!.id))).toMatchObject({ usuario_id: ids.b });
    }
  });
});
