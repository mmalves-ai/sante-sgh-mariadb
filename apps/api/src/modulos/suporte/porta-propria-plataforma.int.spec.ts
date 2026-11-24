// Integração do suporte técnico no banco PRÓPRIO contra o MariaDB real.
// - RepositorioPlataformaPropria num banco plataforma de VALIDAÇÃO (plataforma_validacao_suporte), recriado a cada
//   execução com db/plataforma/*.sql (nunca o banco plataforma de uso): o login da conta de suporte pelo
//   ServicoPlataforma (senha errada recusada como credencial inválida, que a rota responde 401; senha certa pede o
//   cadastro do segundo fator; o código TOTP abre a sessão; depois o segundo fator é pedido e o código errado recusado),
//   o convite, o e-mail duplicado, as atribuições, a auditoria das contas e a sessão "como" (ações, leituras, encerrar).
// - FonteComoEstabelecimentoPropria no cliente de teste (só leitura): o SQL dos grupos, dos usuários e do cruzamento
//   roda contra o modelo do cliente; a correção é recusada (sem imagens no banco próprio).
// Contas FICTÍCIAS (.invalid); a senha é gerada a cada execução e nunca sai do processo. SGH_NUCLEO_SEM_BANCO=1 pula.
// Rodar: vitest run --config apps/api/vitest.integracao.config.ts src/modulos/suporte/porta-propria-plataforma.int.spec.ts
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cifrarSenha, codigoTotp } from '@sgh/dominio-acesso';
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
const CLIENTE = process.env['SGH_CLIENTE_TESTE']?.trim() || 'teste_nucleo';
const RAPIDO = { memoria: 8_192, passes: 1, paralelismo: 1 };
const REDE = 'rede-validacao';

function sql(banco: string | null, texto: string): string {
  return execFileSync('sh', [resolve(RAIZ, 'tools/db/sql.sh'), ...(banco ? [banco] : []), '-N'], {
    input: texto,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

const evento = (ator: string | null, nome: string) => ({ ator, evento: nome, detalhe: null, estacao: 'teste' });

describe.skipIf(SEM_BANCO)('suporte no banco próprio contra o MariaDB (plataforma de validação)', () => {
  let nucleoPlat: NucleoProprio;
  let nucleoCliente: NucleoProprio;
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
    nucleoCliente = new NucleoProprio();
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
    await nucleoCliente?.encerrar();
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
    expect(Number(valor(`SELECT COUNT(*) FROM conta_plataforma_evento WHERE evento = 'plataforma.login.falho' AND conta_alvo_id = ${id}`))).toBe(1);

    const cadastrar = await servico.entrar(pedido, REDE, null, 'estacao', '10.0.0.2');
    expect(cadastrar).toMatchObject({ tipo: 'segundo-fator', segundoFator: 'cadastrar' });
    const otp = cadastrar.tipo === 'segundo-fator' ? String((cadastrar as { otpauth?: string }).otpauth) : '';
    const segredo = new URL(otp).searchParams.get('secret') ?? '';
    expect(segredo).not.toBe('');
    // O segredo fica só cifrado no banco (envelope), nunca em claro.
    expect(valor(`SELECT segredo_segundo_fator LIKE '%${segredo}%' FROM conta_plataforma WHERE id = ${id}`)).toBe('0');

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
      .entrar({ ...pedido, codigo: '000000' === codigoTotp(segredo, relogio) ? '111111' : '000000' }, REDE, null, 'estacao', '10.0.0.5')
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
        { email: 'convidado@exemplo.invalid', nome: null, papel: 'SUPORTE', cifra: null, conviteHash: null, conviteAte: null, criadoPor: null },
        evento(null, 'x'),
      ),
    ).rejects.toThrow('uq_conta_plataforma_email');
    expect(await repo.contaPorEmail('CONVIDADO@exemplo.invalid')).toBe(null);
    expect((await repo.contaPorConvite(hash))?.id).toBe(id);
    expect((await repo.contaPorId(id))?.papel).toBe('PLATAFORMA');
    expect(await repo.contaPorId('nao-numero')).toBe(null);
    await repo.alterarConta(id, { conviteHash: null, conviteAte: null, ativo: false }, evento(id, 'plataforma.funcao.desligada'));
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
    expect(await repo.definirAtribuicoes(id, REDE, ['h2', 'h1'], evento(id, 'plataforma.atribuicoes'))).toEqual({
      ligados: ['h1', 'h2'],
      desligados: [],
    });
    expect(await repo.definirAtribuicoes(id, REDE, ['h2', 'h3'], evento(id, 'plataforma.atribuicoes'))).toEqual({
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
    const a1 = await repo.registrarAcao({ sessao: s.id, metodo: 'POST', caminho: '/api/x', status: 'ok', http: null, clinico: true, naoReversivel: null });
    await repo.registrarAcao({ sessao: s.id, metodo: 'PUT', caminho: '/api/y', status: 'ok', http: null, clinico: false, naoReversivel: 'envio' });
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
    expect(await repo.sessaoComo(s.id)).toMatchObject({ escritas: 2, atosClinicos: 1, fim: null, hospital: 'h2', modo: 'como' });
    expect((await repo.sessoesComo({ hospital: 'h2' })).map((x) => x.id)).toEqual([s.id]);
    expect(await repo.sessoesComo({ hospital: 'h9' })).toEqual([]);
    expect(await repo.registrarAvisoComo()).toBe(false);
    expect(await repo.encerrarSessaoComo(s.id, 'encerrada', conta)).toBe(true);
    expect(await repo.encerrarSessaoComo(s.id, 'encerrada', conta)).toBe(false);
    expect(await repo.sessaoComo(s.id)).toMatchObject({ encerramento: 'encerrada' });
  });

  it('fonte do "como" no cliente de teste: grupos, usuários e cruzamento leem o modelo; a correção é recusada', async () => {
    const fonte = new FonteComoEstabelecimentoPropria(nucleoCliente, CLIENTE);
    expect(await fonte.grupos('naoexiste')).toEqual([]);
    const est = await nucleoCliente.lerSomente({ cliente: CLIENTE, correlacao: 'teste-suporte' }, (l) =>
      l.uma<{ codigo: string }>('SELECT codigo FROM estabelecimento WHERE excluido_em IS NULL ORDER BY id LIMIT 1'),
    );
    const codigo = est?.codigo ?? 'naoexiste';
    const grupos = await fonte.grupos(codigo);
    for (const g of grupos) expect(g.usuarios).toBeGreaterThan(0);
    if (grupos[0]) expect((await fonte.usuarios(codigo, grupos[0].grupo)).length).toBe(grupos[0].usuarios);
    expect(await fonte.usuarios(codigo, 'grupo-inexistente-xyz')).toEqual([]);
    expect(
      await fonte.cruzamento(codigo, { alvo: 'login.inexistente.xyz', inicio: new Date(0), fim: new Date() }),
    ).toEqual([]);
    expect(await fonte.imagensPorAcao()).toEqual(new Map());
    await expect(fonte.previa()).rejects.toBeInstanceOf(ErroCorrigirIndisponivel);
    await expect(fonte.corrigir()).rejects.toBeInstanceOf(ErroCorrigirIndisponivel);
  });
});
