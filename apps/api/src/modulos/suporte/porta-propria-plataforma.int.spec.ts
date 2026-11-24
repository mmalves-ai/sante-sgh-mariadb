// Integração do suporte técnico no banco PRÓPRIO contra o MariaDB real.
// - RepositorioPlataformaPropria num banco plataforma de VALIDAÇÃO (plataforma_validacao_suporte), recriado a cada
//   execução com db/plataforma/*.sql (nunca o banco plataforma de uso): o login da conta de suporte pelo
//   ServicoPlataforma (senha errada recusada como credencial inválida, que a rota responde 401; senha certa pede o
//   cadastro do segundo fator; o código TOTP abre a sessão; depois o segundo fator é pedido e o código errado recusado),
//   o convite, o e-mail duplicado, as atribuições, a auditoria das contas e a sessão "como" (ações, leituras, encerrar).
// - O aviso ao Auditor registrado (sessao_suporte_aviso) e o convite de uso único (dois aceites simultâneos: um passa).
// - FonteComoEstabelecimentoPropria num cliente de teste (cliente_f22_o4) com massa sintética mínima, apagada no fim:
//   perfil vigente e vencido, conta ativa e bloqueada, dois estabelecimentos, trilha com e sem origem de sessão.
// Contas FICTÍCIAS (.invalid); a senha é gerada a cada execução e nunca sai do processo. SGH_NUCLEO_SEM_BANCO=1 pula.
// Rodar: vitest run --config apps/api/vitest.integracao.config.ts src/modulos/suporte/porta-propria-plataforma.int.spec.ts
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cifrarSenha, codigoTotp, hashConvite } from '@sgh/dominio-acesso';
import { NucleoProprio, ambienteEfetivo } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { nucleoPlataforma } from '../../sessao/fonte-plataforma.js';
import { FonteComoEstabelecimentoPropria, RepositorioPlataformaPropria } from './porta-propria-plataforma.js';
import { ErroCorrigirIndisponivel } from './repositorio.js';
import { ErroPlataforma, ServicoPlataforma } from './servico-plataforma.js';

const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../../..');
const BANCO = 'plataforma_validacao_suporte';
const RAPIDO = { memoria: 8_192, passes: 1, paralelismo: 1 };
const REDE = 'rede-validacao';

function sql(banco: string | null, texto: string): string {
  return execFileSync('sh', [resolve(RAIZ, 'tools/db/sql.sh'), ...(banco ? [banco] : []), '-N'], {
    input: texto,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

const evento = (ator: string | null, nome: string) => ({
  ator,
  evento: nome,
  contaAlvo: null,
  detalhe: null,
  estacao: 'teste',
});

describe.skipIf(SEM_BANCO)('suporte no banco próprio contra o MariaDB (plataforma de validação)', () => {
  let nucleoPlat: NucleoProprio;
  let repo: RepositorioPlataformaPropria;
  let servico: ServicoPlataforma;
  const senha = `S${randomUUID()}9`;
  let relogio = Date.now();
  const valor = (q: string): string => sql(BANCO, q).trim();

  beforeAll(async () => {
    sql(
      null,
      `DROP DATABASE IF EXISTS ${BANCO};
       CREATE DATABASE ${BANCO} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;`,
    );
    for (const arq of readdirSync(resolve(RAIZ, 'db/plataforma'))
      .filter((a) => a.endsWith('.sql'))
      .sort())
      sql(BANCO, readFileSync(resolve(RAIZ, 'db/plataforma', arq), 'utf8'));
    nucleoPlat = new NucleoProprio({ env: { ...ambienteEfetivo().env, SGH_BANCO_PLATAFORMA: BANCO } });
    const np = nucleoPlataforma(nucleoPlat);
    if (!np) throw new Error('núcleo sem o banco plataforma');
    repo = new RepositorioPlataformaPropria(np, () => relogio);
    servico = new ServicoPlataforma(repo, new ArmazemMemoria(), {
      ambiente: 'producao',
      produto: 'Validação',
      chaveMestra: randomBytes(32),
      agora: () => relogio,
    });
  });

  afterAll(async () => {
    await nucleoPlat?.encerrar();
    sql(null, `DROP DATABASE IF EXISTS ${BANCO};`);
  });

  it('login do suporte: senha errada recusada (401), senha certa pede o segundo fator, o código abre a sessão', async () => {
    const cifra = await cifrarSenha(senha, RAPIDO);
    const id = await repo.criarConta(
      {
        email: 'suporte.validacao@exemplo.invalid',
        nome: 'Suporte fictício',
        papel: 'SUPORTE',
        cifra,
        conviteHash: null,
        conviteAte: null,
        criadoPor: null,
      },
      evento(null, 'plataforma.conta.criada'),
    );
    const pedido = { email: 'suporte.validacao@exemplo.invalid', senha };

    const errada = await servico
      .entrar({ ...pedido, senha: `${senha}x` }, REDE, null, 'estacao', '10.0.0.1')
      .catch((e: unknown) => e);
    expect(errada).toBeInstanceOf(ErroPlataforma);
    expect((errada as ErroPlataforma).tipo).toBe('credencial-invalida');
    expect(
      Number(
        valor(
          `SELECT COUNT(*) FROM conta_plataforma_evento WHERE evento = 'plataforma.login.falho' AND conta_alvo_id = ${id}`,
        ),
      ),
    ).toBe(1);

    const cadastrar = await servico.entrar(pedido, REDE, null, 'estacao', '10.0.0.2');
    expect(cadastrar).toMatchObject({ tipo: 'segundo-fator', segundoFator: 'cadastrar' });
    const otp = cadastrar.tipo === 'segundo-fator' ? String((cadastrar as { otpauth?: string }).otpauth) : '';
    const segredo = new URL(otp).searchParams.get('secret') ?? '';
    expect(segredo).not.toBe('');
    // O segredo fica só cifrado no banco (envelope), nunca em claro.
    expect(
      valor(`SELECT segredo_segundo_fator LIKE '%${segredo}%' FROM conta_plataforma WHERE id = ${id}`),
    ).toBe('0');

    const sessao = await servico.entrar(
      { ...pedido, codigo: codigoTotp(segredo, relogio) },
      REDE,
      null,
      'estacao',
      '10.0.0.3',
    );
    expect(sessao.tipo).toBe('sessao');
    expect(valor(`SELECT segundo_fator_ativo FROM conta_plataforma WHERE id = ${id}`)).toBe('1');

    relogio += 60_000;
    expect(await servico.entrar(pedido, REDE, null, 'estacao', '10.0.0.4')).toMatchObject({
      tipo: 'segundo-fator',
      segundoFator: 'pedir',
    });
    const codigoErrado = await servico
      .entrar(
        { ...pedido, codigo: '000000' === codigoTotp(segredo, relogio) ? '111111' : '000000' },
        REDE,
        null,
        'estacao',
        '10.0.0.5',
      )
      .catch((e: unknown) => e);
    expect((codigoErrado as ErroPlataforma).tipo).toBe('credencial-invalida');
    const ok = await servico.entrar(
      { ...pedido, codigo: codigoTotp(segredo, relogio) },
      REDE,
      null,
      'estacao',
      '10.0.0.6',
    );
    expect(ok.tipo).toBe('sessao');
    expect(await servico.conferirSenhaDaConta(id, senha)).toBe(true);
  });

  it('e-mail exato e único, convite pelo resumo, alterar conta e eventos do mais novo ao mais velho', async () => {
    const hash = 'a'.repeat(64);
    const id = await repo.criarConta(
      {
        email: 'convidado@exemplo.invalid',
        nome: null,
        papel: 'PLATAFORMA',
        cifra: null,
        conviteHash: hash,
        conviteAte: new Date(relogio + 3_600_000),
        criadoPor: null,
      },
      evento(null, 'plataforma.convite.criado'),
    );
    await expect(
      repo.criarConta(
        {
          email: 'convidado@exemplo.invalid',
          nome: null,
          papel: 'SUPORTE',
          cifra: null,
          conviteHash: null,
          conviteAte: null,
          criadoPor: null,
        },
        evento(null, 'x'),
      ),
    ).rejects.toThrow('uq_conta_plataforma_email');
    expect(await repo.contaPorEmail('CONVIDADO@exemplo.invalid')).toBe(null);
    expect((await repo.contaPorConvite(hash))?.id).toBe(id);
    expect((await repo.contaPorId(id))?.papel).toBe('PLATAFORMA');
    expect(await repo.contaPorId('nao-numero')).toBe(null);
    await repo.alterarConta(
      id,
      { conviteHash: null, conviteAte: null, ativo: false },
      evento(id, 'plataforma.funcao.desligada'),
    );
    const c = await repo.contaPorId(id);
    expect(c).toMatchObject({ ativo: false, conviteHash: null, conviteAte: null });
    await expect(repo.alterarConta('999999999', { ativo: true }, null)).rejects.toThrow('não alterada');
    const ev = await repo.eventosConta(2);
    expect(ev.map((e) => e.evento)).toEqual(['plataforma.funcao.desligada', 'plataforma.convite.criado']);
    expect((await repo.contas()).map((x) => x.email)).toEqual([
      'suporte.validacao@exemplo.invalid',
      'convidado@exemplo.invalid',
    ]);
  });

  it('atribuições: liga, desliga e religa por rede, com o evento do que mudou', async () => {
    const [sup] = await repo.contas();
    const id = sup?.id ?? '';
    expect(
      await repo.definirAtribuicoes(id, REDE, ['h2', 'h1'], evento(id, 'plataforma.atribuicoes')),
    ).toEqual({
      ligados: ['h1', 'h2'],
      desligados: [],
    });
    expect(
      await repo.definirAtribuicoes(id, REDE, ['h2', 'h3'], evento(id, 'plataforma.atribuicoes')),
    ).toEqual({
      ligados: ['h3'],
      desligados: ['h1'],
    });
    expect((await repo.atribuicoes(id)).map((a) => a.hospital)).toEqual(['h2', 'h3']);
    expect((await repo.atribuicoes()).length).toBe(2);
    expect((await repo.eventosConta(1))[0]?.detalhe).toBe(
      JSON.stringify({ rede: REDE, ligados: ['h3'], desligados: ['h1'] }),
    );
  });

  it('sessão "como": abre, registra ações e leituras, conta escritas e atos clínicos e encerra uma vez só', async () => {
    const [sup] = await repo.contas();
    const conta = sup?.id ?? '';
    const s = await repo.abrirSessaoComo({
      idConta: conta,
      atorTipo: 'suporte',
      rede: REDE,
      hospital: 'h2',
      alvoLogin: 'alvo.ficticio',
      alvoId: null,
      motivo: 'chamado de teste',
      minutos: 30,
      estacao: 'teste',
    });
    expect(s.expiraEm.getTime() - s.inicio.getTime()).toBe(30 * 60_000);
    const a1 = await repo.registrarAcao({
      sessao: s.id,
      metodo: 'POST',
      caminho: '/api/x',
      status: 'ok',
      http: null,
      clinico: true,
      naoReversivel: null,
    });
    await repo.registrarAcao({
      sessao: s.id,
      metodo: 'PUT',
      caminho: '/api/y',
      status: 'ok',
      http: null,
      clinico: false,
      naoReversivel: 'envio',
    });
    await repo.finalizarAcao(a1, 'error', 500);
    const acoes = await repo.acoes(s.id);
    expect(acoes.map((a) => [a.metodo, a.status, a.http, a.clinico, a.naoReversivel])).toEqual([
      ['POST', 'error', 500, true, null],
      ['PUT', 'ok', null, false, 'envio'],
    ]);
    const t0 = new Date(relogio);
    await repo.somarLeituras(s.id, '/api/l', 2, t0, t0);
    await repo.somarLeituras(s.id, '/api/l', 3, new Date(relogio + 1_000), new Date(relogio + 5_000));
    const [l] = await repo.leituras(s.id);
    expect(l).toMatchObject({ caminho: '/api/l', quantidade: 5 });
    expect(l?.primeira.getTime()).toBe(t0.getTime());
    expect(l?.ultima.getTime()).toBe(relogio + 5_000);
    expect(await repo.sessaoComo(s.id)).toMatchObject({
      escritas: 2,
      atosClinicos: 1,
      fim: null,
      hospital: 'h2',
      modo: 'como',
    });
    expect((await repo.sessoesComo({ hospital: 'h2' })).map((x) => x.id)).toEqual([s.id]);
    expect(await repo.sessoesComo({ hospital: 'h9' })).toEqual([]);
    expect(await repo.encerrarSessaoComo(s.id, 'encerrada', conta)).toBe(true);
    expect(await repo.encerrarSessaoComo(s.id, 'encerrada', conta)).toBe(false);
    expect(await repo.sessaoComo(s.id)).toMatchObject({ encerramento: 'encerrada' });
  });

  it('aviso ao Auditor registrado em sessao_suporte_aviso (só de acréscimo); dois aceites do mesmo convite: um passa', async () => {
    const conta = await repo.criarConta(
      {
        email: `aviso-${randomUUID()}@exemplo.invalid`,
        nome: null,
        papel: 'SUPORTE',
        cifra: null,
        conviteHash: null,
        conviteAte: null,
        criadoPor: null,
      },
      evento(null, 'plataforma.conta.criada'),
    );
    const s = await repo.abrirSessaoComo({
      idConta: conta,
      atorTipo: 'suporte',
      rede: REDE,
      hospital: 'h3',
      alvoLogin: 'alvo',
      alvoId: 1,
      motivo: null,
      minutos: 30,
      estacao: 'teste',
    });
    const aviso = {
      tipo: 'alerta-suporte',
      chave: `suporte:h3:${s.id}`,
      carga: { idSessao: s.id, motivo: 'm1' },
    };
    expect(await repo.registrarAvisoComo(aviso)).toBe(false);
    expect(await repo.avisosDaSessao(s.id)).toEqual([aviso]);
    // a chave é única: o mesmo aviso não entra duas vezes
    await expect(repo.registrarAvisoComo(aviso)).rejects.toThrow();
    expect(valor(`SELECT COUNT(*) FROM sessao_suporte_aviso WHERE sessao_suporte_id = ${Number(s.id)}`)).toBe(
      '1',
    );

    const token = randomBytes(16).toString('hex');
    const id = await repo.criarConta(
      {
        email: `convite-${randomUUID()}@exemplo.invalid`,
        nome: null,
        papel: 'SUPORTE',
        cifra: null,
        conviteHash: hashConvite(token),
        conviteAte: new Date(relogio + 3_600_000),
        criadoPor: null,
      },
      evento(null, 'plataforma.convite.criado'),
    );
    const r = await Promise.allSettled([
      servico.aceitarConvite(token, `A${randomUUID()}9`, 'e1'),
      servico.aceitarConvite(token, `B${randomUUID()}9`, 'e2'),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const falha = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect((falha.reason as ErroPlataforma).tipo).toBe('nao-encontrado');
    expect((await repo.contaPorId(id))?.conviteHash).toBeNull();
    expect(
      valor(
        `SELECT COUNT(*) FROM conta_plataforma_evento WHERE conta_alvo_id = ${Number(id)} AND evento = 'plataforma.senha.definida'`,
      ),
    ).toBe('1');
  });

  describe('fonte do "como" num cliente de teste com massa sintética mínima', () => {
    // Massa FICTÍCIA no cliente de teste (nunca o cliente real): 2 estabelecimentos, 2 perfis, 4 usuários e 4 linhas
    // de trilha; apagada no fim (as linhas de trilha inseridas aqui não entram na cadeia nem no fecho do SBIS-16).
    const C = process.env['SGH_CLIENTE_TESTE_COMO']?.trim() || 'f22_o4';
    const DB = `cliente_${C}`;
    const tag = `z${randomBytes(3).toString('hex')}`;
    const q = (t: string): string => sql(DB, t).trim();
    const ids: Record<string, number> = {};
    const trilha: number[] = [];
    let nucleoComo: NucleoProprio;

    beforeAll(() => {
      const ins = (t: string): number => Number(q(`${t}; SELECT LAST_INSERT_ID();`));
      for (const e of ['a', 'b'])
        ids[`e${e}`] = ins(
          `INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES ('${tag}${e}', 'Teste ${e}', 'Teste ${e}', UTC_TIMESTAMP(3))`,
        );
      for (const p of ['p1', 'p2'])
        ids[p] = ins(
          `INSERT INTO perfil_acesso (codigo, nome, criado_em) VALUES ('${tag}${p}', 'Perfil ${p}', UTC_TIMESTAMP(3))`,
        );
      for (const u of ['u1', 'u2', 'u3', 'u4'])
        ids[u] = ins(
          `INSERT INTO usuario (login, nome, dispensa_cpf, criado_em${u === 'u2' ? ', situacao, bloqueado_em' : ''})
           VALUES ('${tag}${u}', 'Usuario ${u}', TRUE, UTC_TIMESTAMP(3)${u === 'u2' ? ", 'bloqueado', UTC_TIMESTAMP(3)" : ''})`,
        );
      const vinculo = (u: string, e: string) =>
        q(
          `INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (${ids[u]}, ${ids[e]}, '2020-01-01', UTC_TIMESTAMP(3))`,
        );
      const perfil = (u: string, p: string, e: string, fim: string | null) =>
        q(`INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, vigencia_fim, criado_em)
           VALUES (${ids[u]}, ${ids[p]}, ${ids[e]}, '2020-01-01', ${fim ? `'${fim}'` : 'NULL'}, UTC_TIMESTAMP(3))`);
      vinculo('u1', 'ea');
      vinculo('u2', 'ea');
      vinculo('u3', 'ea');
      vinculo('u4', 'eb');
      perfil('u1', 'p1', 'ea', null); // ativo, vigente
      perfil('u2', 'p1', 'ea', null); // bloqueado: fora
      perfil('u3', 'p1', 'ea', '2021-01-01'); // perfil vencido: fora do p1
      perfil('u3', 'p2', 'ea', null);
      perfil('u4', 'p1', 'eb', null); // outro estabelecimento
      const linha = (e: string, quando: string, origem: string | null) =>
        trilha.push(
          ins(`INSERT INTO trilha_auditoria (usuario_id, estabelecimento_id, ocorrido_em, acao, entidade, endereco_ip, dados_depois, criado_em)
               VALUES (${ids['u1']}, ${ids[e]}, '${quando}', 'alteracao', 'teste_suporte', '10.0.0.9',
                       ${origem ? `'{"origem":{"sessao":"${origem}"}}'` : 'NULL'}, UTC_TIMESTAMP(3))`),
        );
      linha('ea', '2030-01-01 10:00:00.000', '901');
      linha('ea', '2030-01-01 10:01:00.000', null);
      linha('ea', '2030-01-01 10:02:00.000', '902');
      linha('eb', '2030-01-01 10:03:00.000', '901');
      nucleoComo = new NucleoProprio();
    });

    afterAll(async () => {
      await nucleoComo?.encerrar();
      const lista = (xs: (number | undefined)[]) => xs.filter((x) => x !== undefined).join(',') || '0';
      q(`DELETE FROM trilha_auditoria WHERE id IN (${lista(trilha)}) AND entidade = 'teste_suporte';
         DELETE FROM usuario_perfil WHERE usuario_id IN (${lista([ids['u1'], ids['u2'], ids['u3'], ids['u4']])});
         DELETE FROM usuario_estabelecimento WHERE usuario_id IN (${lista([ids['u1'], ids['u2'], ids['u3'], ids['u4']])});
         DELETE FROM usuario WHERE id IN (${lista([ids['u1'], ids['u2'], ids['u3'], ids['u4']])}) AND login LIKE '${tag}%';
         DELETE FROM perfil_acesso WHERE id IN (${lista([ids['p1'], ids['p2']])}) AND codigo LIKE '${tag}%';
         DELETE FROM estabelecimento WHERE id IN (${lista([ids['ea'], ids['eb']])}) AND codigo LIKE '${tag}%';`);
      expect(q(`SELECT COUNT(*) FROM usuario WHERE login LIKE '${tag}%'`)).toBe('0');
    });

    it('grupos e usuários: perfil vigente, conta ativa e só o estabelecimento pedido; contagem por grupo', async () => {
      const fonte = new FonteComoEstabelecimentoPropria(nucleoComo, C);
      expect(await fonte.grupos('naoexiste')).toEqual([]);
      expect(await fonte.grupos(`${tag}a`)).toEqual([
        { grupo: `${tag}p1`, usuarios: 1 },
        { grupo: `${tag}p2`, usuarios: 1 },
      ]);
      expect(await fonte.grupos(`${tag}b`)).toEqual([{ grupo: `${tag}p1`, usuarios: 1 }]);
      expect(await fonte.usuarios(`${tag}a`, `${tag}p1`)).toEqual([
        { login: `${tag}u1`, nome: 'Usuario u1' },
      ]);
      expect(await fonte.usuarios(`${tag}a`, `${tag}p2`)).toEqual([
        { login: `${tag}u3`, nome: 'Usuario u3' },
      ]);
      expect(await fonte.usuarios(`${tag}a`, 'grupo-inexistente-xyz')).toEqual([]);
    });

    it('cruzamento: só o estabelecimento da sessão; do suporte só a origem da sessão consultada; correção recusada', async () => {
      const fonte = new FonteComoEstabelecimentoPropria(nucleoComo, C);
      const janela = {
        alvo: `${tag}u1`,
        inicio: new Date('2030-01-01T00:00:00Z'),
        fim: new Date('2030-01-02T00:00:00Z'),
      };
      const r = await fonte.cruzamento(`${tag}a`, { ...janela, sessao: '901' });
      expect(r.truncado).toBe(false);
      expect(r.linhas.map((l) => [l.idTrilha, l.origem, l.doSuporte])).toEqual([
        [String(trilha[0]), '901', true],
        [String(trilha[1]), null, false],
        [String(trilha[2]), '902', false],
      ]);
      expect(
        (await fonte.cruzamento(`${tag}a`, { ...janela, sessao: '902' })).linhas.map((l) => l.doSuporte),
      ).toEqual([false, false, true]);
      expect(
        (await fonte.cruzamento(`${tag}b`, { ...janela, sessao: '901' })).linhas.map((l) => l.idTrilha),
      ).toEqual([String(trilha[3])]);
      expect(
        (await fonte.cruzamento(`${tag}a`, { ...janela, alvo: 'login.inexistente.xyz', sessao: '901' }))
          .linhas,
      ).toEqual([]);
      expect(await fonte.imagensPorAcao()).toEqual(new Map());
      await expect(fonte.previa()).rejects.toBeInstanceOf(ErroCorrigirIndisponivel);
      await expect(fonte.corrigir()).rejects.toBeInstanceOf(ErroCorrigirIndisponivel);
    });
  });
});
