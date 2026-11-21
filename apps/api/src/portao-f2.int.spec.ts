// Portão da F2 (F2.2 onda 1): pela HTTP, sobre o MariaDB real (cliente f22_o1), com os módulos migrados ligados
// (API_MODULOS=config,cadastro,atendimento): login de uma conta fictícia com perfil de administração do estabelecimento →
// cadastro do paciente → abertura do atendimento → leitura do atendimento. Confere no banco o que cada passo deixou:
// pessoa e paciente com prontuário, atendimento aberto com número da sequência, histórico, cobertura, procedimento
// principal, a linha da trilha e a mensagem de saída. Nenhum dado de pessoa real: a massa é a sintética do lote 01-02
// (cadastro/massa.spec-util.ts), limpa no fim. SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
// Rodar: vitest run --config apps/api/vitest.integracao.config.ts src/portao-f2.int.spec.ts
import { randomUUID } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { cifrarSenha } from '@sgh/dominio-acesso';
import { type Linha, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from './app.js';
import { lerConfiguracao } from './configuracao.js';
import {
  CEP_TESTE,
  CLIENTE_F22,
  CODIGO_ESTAB,
  cpfSintetico,
  garantir,
  limparMassa,
  MARCA,
  type Massa,
  prepararMassa,
  SEM_BANCO,
} from './modulos/cadastro/massa.spec-util.js';
import { COOKIE_CSRF, COOKIE_SESSAO_DEV } from './sessao/cookies.js';
import { REDE } from './sessao/teste.spec-util.js';

const LOGIN = 'f22.portao.teste';
const PERFIL = 'f22_portao_adm';

describe.skipIf(SEM_BANCO)('portão da F2: paciente cadastrado → atendimento aberto pela API (cliente f22_o1)', () => {
  let conferencia: NucleoProprio;
  let app: NestFastifyApplication;
  let m: Massa | null = null;
  let usuario = 0;
  const senha = `P${randomUUID()}8`;
  const h = { host: 'localhost' };
  let cabecalhos: Record<string, string> = {};

  const ler = <T extends Linha>(sql: string, p: unknown[]): Promise<T | null> =>
    conferencia.lerSomente({ cliente: CLIENTE_F22, correlacao: 'conferencia-portao' }, (l) => l.uma<T>(sql, p));
  const contar = async (sql: string, p: unknown[]): Promise<number> =>
    Number((await ler<{ n: number }>(sql, p))?.n ?? 0);

  beforeAll(async () => {
    conferencia = new NucleoProprio();
    expect((await conferencia.cliente(CLIENTE_F22)).banco).toBe(`cliente_${CLIENTE_F22}`);
    m = await prepararMassa(conferencia);
    const est = m.estabelecimento;
    const resumo = await cifrarSenha(senha);
    await conferencia.escrever({ cliente: CLIENTE_F22, correlacao: 'preparo-portao' }, async (e) => {
      const agora = new Date();
      await garantir(
        e,
        'SELECT id FROM politica_senha WHERE estabelecimento_id = ?',
        [est],
        `INSERT INTO politica_senha (estabelecimento_id, tamanho_minimo, exige_numero, tentativas_ate_bloqueio,
           inatividade_sessao_minutos, aviso_fim_sessao_minutos, validade_dias, criado_em) VALUES (?, 10, TRUE, 5, 20, 2, 60, ?)`,
        [est, agora],
      );
      usuario = await garantir(
        e,
        'SELECT id FROM usuario WHERE login = ?',
        [LOGIN],
        'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
        [LOGIN, `CONTA ${MARCA} PORTAO`, agora],
      );
      await e.executar(
        "UPDATE usuario SET situacao = 'ativo', bloqueado_em = NULL, expira_em = NULL, excluido_em = NULL WHERE id = ?",
        [usuario],
      );
      await garantir(
        e,
        'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?',
        [usuario, est],
        'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
        [usuario, est, '2026-01-01', agora],
      );
      const perfil = await garantir(
        e,
        'SELECT id FROM perfil_acesso WHERE estabelecimento_id = ? AND codigo = ?',
        [est, PERFIL],
        'INSERT INTO perfil_acesso (estabelecimento_id, codigo, nome, administrador, criado_em) VALUES (?, ?, ?, TRUE, ?)',
        [est, PERFIL, `ADMINISTRACAO ${MARCA}`, agora],
      );
      await garantir(
        e,
        'SELECT id FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id = ? AND estabelecimento_id = ?',
        [usuario, perfil, est],
        'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
        [usuario, perfil, est, '2026-01-01', agora],
      );
      // A chave de recurso do atendimento ambulatorial ligada para o estabelecimento inteiro (a liberação é do
      // administrador; aqui, a massa de teste a deixa ligada).
      await e.executar(
        `INSERT INTO liberacao_chave (estabelecimento_id, tipo, chave, escopo, valor, ligada, criado_em)
         VALUES (?, 'recurso', 'atendimento.ambulatorio', 'hospital', '*', TRUE, ?)
         ON DUPLICATE KEY UPDATE ligada = TRUE`,
        [est, agora],
      );
      // O pré-requisito declarado do recurso (aprovação do responsável técnico) dado como cumprido na massa.
      await e.executar(
        `INSERT INTO recurso_prerequisito (estabelecimento_id, recurso, tipo, situacao, evidencia, criado_em)
         VALUES (?, 'atendimento.ambulatorio', 'aprovacao', 'cumprido', 'teste do portão da F2', ?)
         ON DUPLICATE KEY UPDATE situacao = 'cumprido'`,
        [est, agora],
      );
      await e.executar('DELETE FROM credencial_usuario WHERE usuario_id = ?', [usuario]);
      await e.inserir(
        'INSERT INTO credencial_usuario (usuario_id, resumo_senha, senha_alterada_em, troca_obrigatoria, criado_em) VALUES (?, ?, ?, FALSE, ?)',
        [usuario, resumo, agora, agora],
      );
    });

    const env: Record<string, string> = {
      AMBIENTE: 'dev',
      PRODUTO_NOME: 'Produto de teste',
      REDE_PADRAO: REDE,
      CLIENTE_PADRAO: CLIENTE_F22,
      ACESSO_FONTE_DEV: 'propria',
      API_MODULOS: 'config,cadastro,atendimento',
    };
    app = await criarApp(lerConfiguracao(env), new NucleoProprio(), env, { encerrarNucleo: true });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
    if (conferencia) {
      await limparMassa(conferencia, m).catch(() => undefined);
      await conferencia
        .escrever({ cliente: CLIENTE_F22, correlacao: 'limpeza-portao' }, async (e) => {
          await e.executar('DELETE FROM credencial_usuario WHERE usuario_id = ?', [usuario]);
          await e.executar('DELETE FROM usuario_perfil WHERE usuario_id = ?', [usuario]);
          for (const t of ['liberacao_chave', 'recurso_prerequisito'])
            await e.executar(
              `DELETE FROM ${t} WHERE estabelecimento_id = ? AND ${t === 'liberacao_chave' ? 'chave' : 'recurso'} = 'atendimento.ambulatorio'`,
              [m?.estabelecimento ?? 0],
            );
          await e.executar("UPDATE usuario SET situacao = 'inativo' WHERE id = ?", [usuario]);
        })
        .catch(() => undefined);
      await conferencia.encerrar();
    }
  });

  const cookies = (r: { headers: Record<string, unknown> }): string[] => {
    const c = r.headers['set-cookie'];
    return Array.isArray(c) ? (c as string[]) : typeof c === 'string' ? [c] : [];
  };
  const valor = (lista: string[], nome: string): string =>
    lista.find((c) => c.startsWith(`${nome}=`))?.split(';')[0]?.slice(nome.length + 1) ?? '';

  let paciente = 0;
  let reg = 0;

  it('login pela HTTP no estabelecimento de teste (perfil de administração: todas as ações do catálogo)', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/sessao',
      headers: h,
      payload: { estabelecimento: CODIGO_ESTAB, login: LOGIN, senha },
    });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(201);
    const c = cookies(r);
    const sid = valor(c, COOKIE_SESSAO_DEV);
    const csrf = valor(c, COOKIE_CSRF);
    expect(sid).not.toBe('');
    cabecalhos = { ...h, cookie: `${COOKIE_SESSAO_DEV}=${sid}; ${COOKIE_CSRF}=${csrf}`, 'x-csrf': csrf };
  });

  it('cadastra o paciente: 201 com prontuário; pessoa, paciente, retrato e trilha no banco', async () => {
    const desde = Number((await ler<{ m: number | null }>('SELECT MAX(id) AS m FROM trilha_auditoria', []))?.m ?? 0);
    const r = await app.inject({
      method: 'POST',
      url: '/api/cadastros/pacientes',
      headers: { ...cabecalhos, 'idempotency-key': `f22-portao-${randomUUID()}` },
      payload: {
        nome: `PACIENTE PORTAO ${MARCA}`,
        nascimento: '1975-03-09',
        sexo: 'M',
        cpf: cpfSintetico('790102555'),
        nomeMae: `MAE ${MARCA}`,
        naturalidade: 'BELO HORIZONTE',
        ufNaturalidade: 'MG',
        cep: CEP_TESTE,
        numero: 42,
        celular: '31999990555',
        contatoNome: `CONTATO ${MARCA}`,
        contatoTelefone: '3133330555',
      },
    });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(201);
    const corpo = r.json<{ idPaciente: number; prontuario: number }>();
    paciente = corpo.idPaciente;
    expect(paciente).toBeGreaterThan(0);
    expect(corpo.prontuario).toBeGreaterThan(0);
    expect(
      await contar(
        `SELECT COUNT(*) AS n FROM paciente p JOIN pessoa_fisica pf ON pf.id = p.pessoa_fisica_id
          WHERE p.id = ? AND pf.nome = ? AND p.excluido_em IS NULL`,
        [paciente, `PACIENTE PORTAO ${MARCA}`],
      ),
    ).toBe(1);
    expect(await contar('SELECT COUNT(*) AS n FROM paciente_versao WHERE paciente_id = ?', [paciente])).toBeGreaterThanOrEqual(1);
    expect(
      await contar('SELECT COUNT(*) AS n FROM trilha_auditoria WHERE id > ? AND usuario_id = ?', [desde, usuario]),
    ).toBeGreaterThanOrEqual(1);
  });

  it('abre o atendimento do paciente: 201 com número da sequência; atendimento, histórico, cobertura, procedimento, trilha e saída', async () => {
    const mm = m!;
    const r = await app.inject({
      method: 'POST',
      url: '/api/atendimento',
      headers: { ...cabecalhos, 'idempotency-key': `f22-portao-${randomUUID()}` },
      payload: {
        tipo: 'consulta',
        paciente,
        convenio: mm.fonte,
        matricula: '555001',
        profissional: mm.profissional,
        especialidade: mm.especialidade,
        unidade: mm.unidade,
        centroCusto: mm.centroCusto,
        procedimento: mm.procedimento,
        cidPrincipal: mm.cid,
        carater: 'eletivo',
        local: mm.local,
      },
    });
    expect(r.statusCode, r.body.slice(0, 400)).toBe(201);
    const corpo = r.json<{ ok: true; resultado: { reg: number; cabecalho: string }; repetida: boolean }>();
    expect(corpo.ok).toBe(true);
    expect(corpo.repetida).toBe(false);
    reg = Number(corpo.resultado.reg);
    expect(reg).toBeGreaterThan(0);
    expect(String(corpo.resultado.cabecalho)).toMatch(/^AT-\d+$/);
    expect(
      await ler('SELECT paciente_id, estabelecimento_id, situacao, versao FROM atendimento WHERE id = ?', [reg]),
    ).toMatchObject({ paciente_id: paciente, estabelecimento_id: mm.estabelecimento, situacao: 'aberto', versao: 1 });
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM atendimento_situacao_historico WHERE atendimento_id = ? AND situacao_nova = 'aberto'",
        [reg],
      ),
    ).toBe(1);
    expect(
      await contar("SELECT COUNT(*) AS n FROM cobertura_atendimento WHERE atendimento_id = ? AND numero_carteira = '555001'", [reg]),
    ).toBe(1);
    expect(
      await contar('SELECT COUNT(*) AS n FROM atendimento_procedimento WHERE atendimento_id = ? AND principal', [reg]),
    ).toBe(1);
    expect(
      await contar(
        "SELECT COUNT(*) AS n FROM trilha_auditoria WHERE entidade = 'atendimento' AND entidade_id = ? AND usuario_id = ?",
        [reg, usuario],
      ),
    ).toBeGreaterThanOrEqual(1);
    expect(
      await contar("SELECT COUNT(*) AS n FROM integracao_mensagem WHERE ponto = 'atendimento.aberto' AND entidade_id = ?", [reg]),
    ).toBe(1);
  });

  it('lê o atendimento aberto pela HTTP, com o paciente cadastrado', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/atendimento/${reg}`, headers: cabecalhos });
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    const d = r.json<{ reg: number; paciente: { id: number | null } }>();
    expect(Number(d.reg)).toBe(reg);
    expect(d.paciente.id).toBe(paciente);
  });
});
