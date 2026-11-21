// Integração da fonte própria contra o MariaDB real (cliente teste_login, criado por
// `python3 -I tools/db/criar_cliente.py teste_login "Cliente de teste do login"`, que também carrega acao_sistema).
// Prepara, de forma idempotente, contas e perfis FICTÍCIOS (sem pessoa real; a senha é gerada a cada execução e
// nunca sai do processo). SGH_NUCLEO_SEM_BANCO=1 pula este arquivo.
// Rodar: vitest run --config apps/api/vitest.integracao.config.ts src/sessao/fonte-propria.int.spec.ts
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { CATALOGO_DECLARADO } from '@sgh/contratos';
import { cifrarSenha } from '@sgh/dominio-acesso';
import { type Escritor, NucleoProprio } from '@sgh/nucleo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CATALOGO_COMPLETO } from '../autorizacao/catalogo.js';
import { ServicoAutorizacao } from '../autorizacao/servico-autorizacao.js';
import { ArmazemMemoria } from './armazem.js';
import { FonteAcessoPropria } from './fonte-propria.js';
import { CONFIG_LOGIN_PADRAO } from './tipos-acesso.js';

const CLIENTE = 'teste_login';
const SEM_BANCO = process.env['SGH_NUCLEO_SEM_BANCO'] === '1';
const RAIZ = resolve(import.meta.dirname, '../../../..');
const INICIO = '2026-01-01';

/** Duas ações concedidas por perfil (não as de toda pessoa) e uma que o perfil de teste NÃO tem. */
const POR_PERFIL = CATALOGO_DECLARADO.filter((p) => p.concessaoPorPerfil !== 'todos-os-perfis-de-pessoa').map(
  (p) => p.codigo,
);
const [ACAO_A, ACAO_B, ACAO_FORA] = [POR_PERFIL[0] ?? '', POR_PERFIL[1] ?? '', POR_PERFIL[2] ?? ''];
/** Uma ação de consulta ("ver") e uma de operação, concedidas por perfil (escolhidas no banco, no preparo). */
let acaoVer = '';
let acaoOperar = '';

describe.skipIf(SEM_BANCO)('fonte própria contra o MariaDB (cliente teste_login)', () => {
  let nucleo: NucleoProprio;
  let fonte: FonteAcessoPropria;
  const avisos: string[] = [];
  const senha = `T${randomUUID()}9`;

  async function garantir(
    e: Escritor,
    sel: string,
    p: unknown[],
    ins: string,
    pi: unknown[],
  ): Promise<number> {
    const l = await e.uma<{ id: number }>(sel, p);
    return l ? Number(l.id) : e.inserir(ins, pi);
  }

  beforeAll(async () => {
    nucleo = new NucleoProprio();
    expect((await nucleo.cliente(CLIENTE)).banco).toBe('cliente_teste_login');
    const resumo = await cifrarSenha(senha);
    await nucleo.escrever({ cliente: CLIENTE, correlacao: 'preparo-teste-login' }, async (e) => {
      const agora = new Date();
      const est = async (codigo: string) =>
        garantir(
          e,
          'SELECT id FROM estabelecimento WHERE codigo = ?',
          [codigo],
          'INSERT INTO estabelecimento (codigo, nome_fantasia, razao_social, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Hospital de teste ${codigo}`, `Hospital de teste ${codigo} (fictício)`, agora],
        );
      const e1 = await est('tlogin');
      const e2 = await est('tlogin2');
      await garantir(
        e,
        'SELECT id FROM politica_senha WHERE estabelecimento_id = ?',
        [e1],
        `INSERT INTO politica_senha (estabelecimento_id, tamanho_minimo, exige_numero, tentativas_ate_bloqueio,
           inatividade_sessao_minutos, aviso_fim_sessao_minutos, validade_dias, criado_em) VALUES (?, 10, TRUE, 4, 20, 2, 60, ?)`,
        [e1, agora],
      );
      const perfil = (codigo: string, administrador: boolean) =>
        garantir(
          e,
          'SELECT id FROM perfil_acesso WHERE codigo = ? AND estabelecimento_id IS NULL',
          [codigo],
          'INSERT INTO perfil_acesso (codigo, nome, administrador, criado_em) VALUES (?, ?, ?, ?)',
          [codigo, `Perfil ${codigo} de teste`, administrador, agora],
        );
      const pTeste = await perfil('TESTE_LOGIN', false);
      const pAdm = await perfil('ADMIN_LOGIN', true);
      // Perfil que NEGA a ACAO_A (perfil_acao.permitido falso): prevalece sobre o que permite e sobre o administrador.
      const pNega = await perfil('NEGA_LOGIN', false);
      // Perfil com uma ação de consulta e uma de operação (para o recorte só de consulta).
      const porPerfil = new Set(POR_PERFIL);
      const escolher = async (sql: string) =>
        (await e.consultar<{ codigo: string }>(sql, [], { teto: 100_000 })).find((a) => porPerfil.has(a.codigo))
          ?.codigo ?? '';
      acaoVer = await escolher("SELECT codigo FROM acao_sistema WHERE ativo AND tipo_acao = 'ver' ORDER BY codigo");
      acaoOperar = await escolher(
        "SELECT codigo FROM acao_sistema WHERE ativo AND tipo_acao <> 'ver' ORDER BY codigo",
      );
      const pOpera = await perfil('OPERA_LOGIN', false);
      for (const codigo of [acaoVer, acaoOperar]) {
        const acao = await e.uma<{ id: number }>('SELECT id FROM acao_sistema WHERE codigo = ?', [codigo]);
        await garantir(
          e,
          'SELECT id FROM perfil_acao WHERE perfil_acesso_id = ? AND acao_sistema_id = ?',
          [pOpera, acao?.id],
          'INSERT INTO perfil_acao (perfil_acesso_id, acao_sistema_id, criado_em) VALUES (?, ?, ?)',
          [pOpera, acao?.id, agora],
        );
      }
      const acaoA = await e.uma<{ id: number }>('SELECT id FROM acao_sistema WHERE codigo = ?', [ACAO_A]);
      await garantir(
        e,
        'SELECT id FROM perfil_acao WHERE perfil_acesso_id = ? AND acao_sistema_id = ?',
        [pNega, acaoA?.id],
        'INSERT INTO perfil_acao (perfil_acesso_id, acao_sistema_id, permitido, criado_em) VALUES (?, ?, FALSE, ?)',
        [pNega, acaoA?.id, agora],
      );
      await e.executar(
        'UPDATE perfil_acao SET permitido = FALSE, excluido_em = NULL WHERE perfil_acesso_id = ? AND acao_sistema_id = ?',
        [pNega, acaoA?.id],
      );
      for (const codigo of [ACAO_A, ACAO_B]) {
        const acao = await e.uma<{ id: number }>('SELECT id FROM acao_sistema WHERE codigo = ?', [codigo]);
        await garantir(
          e,
          'SELECT id FROM perfil_acao WHERE perfil_acesso_id = ? AND acao_sistema_id = ?',
          [pTeste, acao?.id],
          'INSERT INTO perfil_acao (perfil_acesso_id, acao_sistema_id, criado_em) VALUES (?, ?, ?)',
          [pTeste, acao?.id, agora],
        );
      }
      const tipoEscopo = await garantir(
        e,
        "SELECT id FROM tipo_escopo_acesso WHERE codigo = 'local_estoque'",
        [],
        "INSERT INTO tipo_escopo_acesso (codigo, descricao, entidade, criado_em) VALUES ('local_estoque', 'Local de estoque', 'local_estoque', ?)",
        [agora],
      );
      // Tipo de recorte que a sessão não sabe aplicar (caixa): falha fechada.
      const tipoCaixa = await garantir(
        e,
        "SELECT id FROM tipo_escopo_acesso WHERE codigo = 'caixa'",
        [],
        "INSERT INTO tipo_escopo_acesso (codigo, descricao, entidade, criado_em) VALUES ('caixa', 'Caixa', 'caixa', ?)",
        [agora],
      );
      const recorte = async (usuarioId: number, tipo: number, entidade: number, operar: boolean) => {
        await garantir(
          e,
          'SELECT id FROM usuario_escopo WHERE usuario_id = ? AND tipo_escopo_acesso_id = ?',
          [usuarioId, tipo],
          'INSERT INTO usuario_escopo (usuario_id, tipo_escopo_acesso_id, estabelecimento_id, entidade_id, pode_consultar, pode_operar, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, TRUE, ?, ?, ?)',
          [usuarioId, tipo, e1, entidade, operar, INICIO, agora],
        );
        await e.executar(
          'UPDATE usuario_escopo SET entidade_id = ?, pode_consultar = TRUE, pode_operar = ?, excluido_em = NULL WHERE usuario_id = ? AND tipo_escopo_acesso_id = ?',
          [entidade, operar, usuarioId, tipo],
        );
      };
      const usuario = async (
        login: string,
        o: {
          est: number;
          perfil?: number;
          extra?: number;
          bloqueado?: boolean;
          credencial?: boolean;
          troca?: boolean;
        },
      ) => {
        const id = await garantir(
          e,
          'SELECT id FROM usuario WHERE login = ?',
          [login],
          'INSERT INTO usuario (login, nome, dispensa_cpf, criado_em) VALUES (?, ?, TRUE, ?)',
          [login, `Conta fictícia ${login}`, agora],
        );
        await e.executar(
          'UPDATE usuario SET situacao = ?, bloqueado_em = ?, expira_em = NULL, excluido_em = NULL WHERE id = ?',
          [o.bloqueado ? 'bloqueado' : 'ativo', o.bloqueado ? agora : null, id],
        );
        await garantir(
          e,
          'SELECT id FROM usuario_estabelecimento WHERE usuario_id = ? AND estabelecimento_id = ?',
          [id, o.est],
          'INSERT INTO usuario_estabelecimento (usuario_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?)',
          [id, o.est, INICIO, agora],
        );
        await e.executar(
          'UPDATE usuario_estabelecimento SET vigencia_fim = NULL, excluido_em = NULL WHERE usuario_id = ? AND estabelecimento_id = ?',
          [id, o.est],
        );
        // Os perfis da conta são só os desta execução (de uma execução anterior não sobra nada).
        await e.executar('DELETE FROM usuario_perfil WHERE usuario_id = ?', [id]);
        for (const perfilId of [o.perfil, o.extra])
          if (perfilId)
            await garantir(
              e,
              'SELECT id FROM usuario_perfil WHERE usuario_id = ? AND perfil_acesso_id = ? AND estabelecimento_id = ?',
              [id, perfilId, o.est],
              'INSERT INTO usuario_perfil (usuario_id, perfil_acesso_id, estabelecimento_id, vigencia_inicio, criado_em) VALUES (?, ?, ?, ?, ?)',
              [id, perfilId, o.est, INICIO, agora],
            );
        await e.executar('DELETE FROM credencial_usuario WHERE usuario_id = ?', [id]);
        if (o.credencial !== false)
          await e.inserir(
            'INSERT INTO credencial_usuario (usuario_id, resumo_senha, senha_alterada_em, troca_obrigatoria, criado_em) VALUES (?, ?, ?, ?, ?)',
            [id, resumo, agora, o.troca ?? false, agora],
          );
        return id;
      };
      const ok = await usuario('teste.login.ok', { est: e1, perfil: pTeste });
      await usuario('teste.login.adm', { est: e1, perfil: pAdm });
      await usuario('teste.login.bloq', { est: e1, perfil: pTeste, bloqueado: true });
      await usuario('teste.login.semcred', { est: e1, credencial: false });
      await usuario('teste.login.troca', { est: e1, troca: true });
      await usuario('teste.login.outro', { est: e2, perfil: pTeste });
      await usuario('teste.login.nega', { est: e1, perfil: pTeste, extra: pNega });
      await usuario('teste.login.admneg', { est: e1, perfil: pAdm, extra: pNega });
      await usuario('teste.login.vaibloq', { est: e1, perfil: pTeste });
      await recorte(ok, tipoEscopo, 7, true);
      await recorte(await usuario('teste.login.caixa', { est: e1, perfil: pTeste }), tipoCaixa, 3, true);
      await recorte(await usuario('teste.login.consulta', { est: e1, perfil: pOpera }), tipoEscopo, 8, false);
      await usuario('teste.login.opera', { est: e1, perfil: pOpera });
      const termo = await garantir(
        e,
        "SELECT id FROM termo_uso_versao WHERE numero_versao = 'teste-1' AND estabelecimento_id = ?",
        [e1],
        `INSERT INTO termo_uso_versao (estabelecimento_id, numero_versao, titulo, texto, hash_texto, situacao,
           vigencia_inicio, publicado_em, criado_em) VALUES (?, 'teste-1', 'Termo de teste', 'Texto fictício', ?, 'publicado', ?, ?, ?)`,
        [e1, 'a'.repeat(64), new Date('2026-01-01T00:00:00Z'), new Date('2026-01-01T00:00:00Z'), agora],
      );
      await garantir(
        e,
        'SELECT id FROM aceite_termo_uso WHERE termo_uso_versao_id = ? AND usuario_id = ?',
        [termo, ok],
        'INSERT INTO aceite_termo_uso (termo_uso_versao_id, usuario_id, estabelecimento_id, ocorrido_em, criado_em) VALUES (?, ?, ?, ?, ?)',
        [termo, ok, e1, new Date('2026-02-01T00:00:00Z'), agora],
      );
    });
    fonte = new FonteAcessoPropria(nucleo, CLIENTE, 'rede-teste', (m) => avisos.push(m));
    await fonte.carregar();
  });

  afterAll(async () => {
    await nucleo?.encerrar();
  });

  it('acao_sistema tem o catálogo do produto inteiro, e a recarga é idempotente', async () => {
    const [n] = await nucleo.lerSomente({ cliente: CLIENTE, correlacao: 'conferencia' }, (l) =>
      l.consultar<{ n: number }>('SELECT COUNT(*) AS n FROM acao_sistema WHERE ativo'),
    );
    expect(Number(n?.n)).toBe(CATALOGO_COMPLETO.length);
    const saida = execFileSync('python3', ['-I', 'tools/db/carregar_acoes.py', CLIENTE], {
      cwd: RAIZ,
    }).toString();
    expect(JSON.parse(saida)).toMatchObject({
      incluidas: 0,
      atualizadas: 0,
      inativadas: 0,
      ativas: CATALOGO_COMPLETO.length,
    });
  });

  it('estabelecimentos e saúde vêm do banco do cliente', () => {
    const codigos = fonte.estabelecimentos.map((e) => e.codigo);
    expect(codigos).toEqual(expect.arrayContaining(['tlogin', 'tlogin2']));
    expect(fonte.saude().find((s) => s.codigo === 'tlogin')).toMatchObject({
      disponivel: true,
      conectado: true,
    });
  });

  it('autenticar: ok, senha errada, conta inexistente, sem vínculo, impedida, sem credencial e troca obrigatória', async () => {
    const ok = await fonte.autenticar('tlogin', 'teste.login.ok', senha);
    expect(ok.desfecho).toBe('ok');
    expect(ok.desfecho === 'ok' && ok.conta).toMatchObject({
      login: 'teste.login.ok',
      ativo: true,
      bloqueado: false,
      semCifra: false,
      trocaObrigatoria: false,
    });
    expect((await fonte.autenticar('tlogin', 'teste.login.ok', `${senha}x`)).desfecho).toBe(
      'credencial-invalida',
    );
    expect((await fonte.autenticar('tlogin', 'teste.login.nao.existe', senha)).desfecho).toBe(
      'credencial-invalida',
    );
    expect((await fonte.autenticar('tlogin', 'teste.login.outro', senha)).desfecho).toBe(
      'credencial-invalida',
    );
    expect((await fonte.autenticar('naoexiste', 'teste.login.ok', senha)).desfecho).toBe(
      'credencial-invalida',
    );
    expect((await fonte.autenticar('tlogin2', 'teste.login.outro', senha)).desfecho).toBe('ok');
    expect((await fonte.autenticar('tlogin', 'teste.login.bloq', senha)).desfecho).toBe('conta-impedida');
    // Impedida só se revela com a senha certa.
    expect((await fonte.autenticar('tlogin', 'teste.login.bloq', `${senha}x`)).desfecho).toBe(
      'credencial-invalida',
    );
    // Sem credencial: a mesma resposta de senha errada (sem enumeração de contas).
    expect((await fonte.autenticar('tlogin', 'teste.login.semcred', senha)).desfecho).toBe(
      'credencial-invalida',
    );
    const troca = await fonte.autenticar('tlogin', 'teste.login.troca', senha);
    expect(troca.desfecho === 'ok' && troca.conta.trocaObrigatoria).toBe(true);
  });

  it('configLogin: a política do estabelecimento; sem política, o padrão seguro com aviso', async () => {
    const c = await fonte.configLogin('tlogin');
    expect(c.senha).toMatchObject({ minimoCaracteres: 10, exigeNumero: true, periodoTrocaDias: 60 });
    expect(c.limiteTentativas).toBe(4);
    expect(c.tempo).toEqual({ inatividadeSegundos: 1200, avisoSegundos: 120 });
    expect(await fonte.configLogin('tlogin2')).toBe(CONFIG_LOGIN_PADRAO);
    expect(avisos.some((a) => a.includes('política de senha'))).toBe(true);
  });

  it('dadosDeSessao: perfis vigentes e o termo vigente com o aceite', async () => {
    const d = await fonte.dadosDeSessao('tlogin', 'teste.login.ok');
    expect(d.papeis.map((p) => p.nome)).toEqual(['Perfil TESTE_LOGIN de teste']);
    expect(d.unidades).toEqual([]);
    expect(d.termo.vigente).toBe(true);
    expect(d.termo.aceitoEm).toBeInstanceOf(Date);
    const t = await fonte.dadosDeSessao('tlogin', 'teste.login.troca');
    expect(t.papeis).toEqual([]);
    expect(t.termo).toMatchObject({ vigente: true, aceitoEm: null });
  });

  it('autorização: ações do perfil do cliente, escopos e o perfil administrador do cliente', async () => {
    const servico = new ServicoAutorizacao(
      fonte,
      new ArmazemMemoria(),
      () => Date.now(),
      new Set(['tlogin', 'tlogin2']),
      CLIENTE,
    );
    const ok = await servico.obter('rede-teste', 'tlogin', 'teste.login.ok');
    expect(ok.permissoes).toEqual(expect.arrayContaining([ACAO_A, ACAO_B]));
    expect(ok.permissoes).not.toContain(ACAO_FORA);
    expect(ok.perfil.complementares).toContain('TESTE_LOGIN');
    expect(ok.escopos.locaisEstoque).toEqual(['7']);
    const sem = await servico.obter('rede-teste', 'tlogin', 'teste.login.troca');
    expect(sem.permissoes).not.toContain(ACAO_A);
    const adm = await servico.obter('rede-teste', 'tlogin', 'teste.login.adm');
    expect(adm.permissoes).toEqual(expect.arrayContaining([ACAO_A, ACAO_B, ACAO_FORA]));
    expect(adm.permissoes.length).toBeGreaterThan(ok.permissoes.length);
    // Negação explícita: prevalece sobre o perfil que permite e sobre o administrador do cliente.
    const nega = await servico.obter('rede-teste', 'tlogin', 'teste.login.nega');
    expect(nega.permissoes).not.toContain(ACAO_A);
    expect(nega.permissoes).toContain(ACAO_B);
    const admNega = await servico.obter('rede-teste', 'tlogin', 'teste.login.admneg');
    expect(admNega.permissoes).not.toContain(ACAO_A);
    expect(admNega.permissoes).toEqual(expect.arrayContaining([ACAO_B, ACAO_FORA]));
    // Recorte de tipo sem lugar na sessão (caixa): fecha (as ações do módulo saem), nunca abre.
    const caixa = await servico.obter('rede-teste', 'tlogin', 'teste.login.caixa');
    expect(caixa.permissoes).not.toContain(ACAO_A);
    expect(caixa.permissoes).not.toContain(ACAO_B);
    // Recorte só de consulta: fica o "ver"; a operação do módulo sai (sem recorte, o mesmo perfil opera).
    expect(acaoVer && acaoOperar).toBeTruthy();
    const opera = await servico.obter('rede-teste', 'tlogin', 'teste.login.opera');
    expect(opera.permissoes).toEqual(expect.arrayContaining([acaoVer, acaoOperar]));
    const consulta = await servico.obter('rede-teste', 'tlogin', 'teste.login.consulta');
    expect(consulta.escopos.locaisEstoque).toEqual(['8']);
    expect(consulta.permissoes).toContain(acaoVer);
    expect(consulta.permissoes).not.toContain(acaoOperar);
    // Só contagens na saída (prova do lote).
    console.log(
      `permissões: teste ${ok.permissoes.length}, sem perfil ${sem.permissoes.length}, administrador do cliente ${adm.permissoes.length} de ${CATALOGO_COMPLETO.length}, nega ${nega.permissoes.length}, administrador com negação ${admNega.permissoes.length}, recorte sem lugar ${caixa.permissoes.length}, só consulta ${consulta.permissoes.length} (sem o recorte ${opera.permissoes.length})`,
    );
  });

  it('recálculo: conta bloqueada ou vínculo encerrado perde perfis e ações', async () => {
    const login = 'teste.login.vaibloq';
    const mudar = (sql: string) =>
      nucleo.escrever({ cliente: CLIENTE, correlacao: 'teste-bloqueio' }, (e) => e.executar(sql, [login]));
    try {
      const antes = await fonte.dadosDeAutorizacao('tlogin', login);
      expect(antes.acoesDoPerfil).toEqual(expect.arrayContaining([{ perfil: 'TESTE_LOGIN', permissao: ACAO_A }]));
      await mudar("UPDATE usuario SET situacao = 'bloqueado', bloqueado_em = UTC_TIMESTAMP(3) WHERE login = ?");
      const bloqueada = await fonte.dadosDeAutorizacao('tlogin', login);
      expect(bloqueada.acoesDoPerfil).toEqual([]);
      expect(bloqueada.perfisConcedidos).toEqual([]);
      expect((await fonte.dadosDeSessao('tlogin', login)).papeis).toEqual([]);
      await mudar("UPDATE usuario SET situacao = 'ativo', bloqueado_em = NULL WHERE login = ?");
      expect((await fonte.dadosDeAutorizacao('tlogin', login)).perfisConcedidos).toHaveLength(1);
      await mudar(
        `UPDATE usuario_estabelecimento ue JOIN usuario u ON u.id = ue.usuario_id
            SET ue.vigencia_fim = UTC_DATE() - INTERVAL 1 DAY WHERE u.login = ?`,
      );
      const desvinculada = await fonte.dadosDeAutorizacao('tlogin', login);
      expect(desvinculada.acoesDoPerfil).toEqual([]);
      expect(desvinculada.perfisConcedidos).toEqual([]);
      await mudar("UPDATE usuario SET expira_em = UTC_TIMESTAMP(3) - INTERVAL 1 DAY WHERE login = ?");
      await mudar(
        `UPDATE usuario_estabelecimento ue JOIN usuario u ON u.id = ue.usuario_id
            SET ue.vigencia_fim = NULL WHERE u.login = ?`,
      );
      expect((await fonte.dadosDeAutorizacao('tlogin', login)).acoesDoPerfil).toEqual([]);
    } finally {
      await mudar("UPDATE usuario SET situacao = 'ativo', bloqueado_em = NULL, expira_em = NULL WHERE login = ?");
      await mudar(
        `UPDATE usuario_estabelecimento ue JOIN usuario u ON u.id = ue.usuario_id
            SET ue.vigencia_fim = NULL WHERE u.login = ?`,
      );
    }
  });
});
