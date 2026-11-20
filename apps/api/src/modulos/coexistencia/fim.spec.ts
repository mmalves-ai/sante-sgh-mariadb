// M43 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): o painel de
// fim da coexistência (cinco itens do cap-15, quatro do cap-14 ao lado, o registro sintético), a revisão dos ativos sem
// grupo e dos logins de painel (a leitura vai à trilha), a regra 4 no bloqueio da tela de usuários (o login de TV só
// com o aparelho conferido no setor) e a regra 5 (sem grupo recebe grupo ou é bloqueado, até a lista ficar vazia).
// E o serviço com uma porta falsa: os cinco itens verdes com as datas, o fim registrável e a falha fechada.
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ChamadoLidoBanco, ChaveGravada, RetratoLido } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { lerRegistroFim, ServicoFimCoexistencia } from './aplicacao/fim.js';
import type { PortaCoexistencia } from './porta.js';

const FIXTURES = resolve(import.meta.dirname, '__fixtures__/fim');
// A API lê uma cópia do registro sintético (um teste acrescenta a substituição de painel registrada fora da tela).
const RAIZ_HTTP = mkdtempSync(join(tmpdir(), 'm43-fim-'));
cpSync(FIXTURES, RAIZ_HTTP, { recursive: true });
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', SGH_COEX_FIM: RAIZ_HTTP };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
async function entrar(login: string, estabelecimento = 'aa'): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento, login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = (r.headers['set-cookie'] as string[] | undefined) ?? [];
  return {
    cookie: set.map((c) => c.split(';')[0]).join('; '),
    csrf:
      set
        .find((c) => c.startsWith('sgh_csrf='))
        ?.split(';')[0]
        ?.slice(9) ?? '',
  };
}
const h = (s: Sessao) => ({
  cookie: s.cookie,
  'x-csrf': s.csrf,
  'idempotency-key': `teste-m43-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'POST', url, headers: h(s), payload: payload as Record<string, unknown> });
const F = '/api/administracao/coexistencia/migracao/fim';
const U = '/api/administracao/acesso/usuarios';

describe('fim da coexistência pela HTTP', { timeout: 60_000 }, () => {
  it('painel: cinco itens do critério e quatro do conjunto ao lado; falha fechada no que não se mediu; registro lido', async () => {
    const s = await entrar('SINT.ONDA5');
    const r = await get(s, F);
    expect(r.statusCode).toBe(200);
    const t = r.json();
    expect(t.painel.cap15.map((i: { item: string }) => i.item)).toEqual([
      'operacoes-liberadas',
      'usuarios-com-trilha',
      'sem-sessao-14-dias',
      'competencia-pelo-novo',
      'sem-s1-aberto',
    ]);
    expect(t.painel.cap14.map((i: { item: string }) => i.item)).toEqual([
      'sem-sessao-30-dias',
      'assinaturas-verdes',
      'contingencia-pronta',
      'aceite-diretoria',
    ]);
    const item = (k: string) =>
      [...t.painel.cap15, ...t.painel.cap14].find((i: { item: string }) => i.item === k);
    // Em memória não há retrato nem coleta: sem medida, nunca verde (regra 3).
    expect(item('sem-sessao-14-dias')).toMatchObject({ situacao: 'sem-medida', verdeDesde: null });
    // A competência sintética está inteira pelo novo, com a data da última gravação dele.
    expect(item('competencia-pelo-novo')).toMatchObject({ situacao: 'verde', verdeDesde: '2027-01-08' });
    expect(item('competencia-pelo-novo').parcelas).toEqual([
      { rotulo: 'convênios da competência', valor: 2 },
      { rotulo: 'fechados pelo novo', valor: 2 },
      { rotulo: 'lotes', valor: 3 },
      { rotulo: 'lotes enviados pelo novo', valor: 3 },
    ]);
    // O registro sintético: a contingência com um ensaio reprovado e um sem registro; a exceção listada.
    expect(item('contingencia-pronta')).toMatchObject({ situacao: 'pendente', valor: '2 de 4' });
    expect(t.excecoes).toEqual([
      {
        operacao: 'agenda.cancelarExame',
        decisao: 'fica no outro sistema por decisão sintética',
        decididaEm: '2026-10-20',
      },
    ]);
    // As operações fora de liberada em agregados (por estado e por módulo), sem a exceção decidida.
    const somaEstado = t.foraPorEstado.reduce((n: number, x: { n: number }) => n + x.n, 0);
    const somaModulo = t.foraPorModulo.reduce((n: number, x: { n: number }) => n + x.n, 0);
    expect(somaEstado).toBe(somaModulo);
    expect(item('operacoes-liberadas').parcelas[1]).toEqual({
      rotulo: 'fora de liberada',
      valor: somaEstado,
    });
    expect(t.ensaios.find((e: { tipo: string }) => e.tipo === 'pwa-offline')).toEqual({
      tipo: 'pwa-offline',
      data: '2026-10-21',
      resultado: 'reprovado',
    });
    expect(t.contasCombinadas).toBe(1);
    expect(t.dp6).toEqual({ decididaEm: null, previstaPara: '2027-03-01', decisao: null });
    expect(t.registroInvalido).toBeNull();
    expect(t.painel.fimRegistravel).toBe(false);
    expect(t.painel.fimRegistradoEm).toBeNull();
    // Antes das metas (outubro de 2026), nenhum setor atrasado.
    expect(t.setoresAtrasados).toEqual([]);
    expect(JSON.stringify(t)).not.toMatch(/SPDATA|legado/i);
  });

  it('sem a permissão do painel: 403; a revisão pede a leitura de usuários', async () => {
    const s = await entrar('SINT.RECEPCAO');
    expect((await get(s, F)).statusCode).toBe(403);
    expect((await get(s, `${F}/revisao`)).statusCode).toBe(403);
  });

  it('regras 4 e 5: revisão, bloqueio do login de TV só com o aparelho conferido, sem grupo até a lista vazia', async () => {
    const s = await entrar('SINT.ONDA5');
    const antes = trilha.eventos.length;
    const r0 = (await get(s, `${F}/revisao`)).json();
    expect(trilha.eventos.slice(antes).some((e) => e.recurso === 'config.coexistencia.fim')).toBe(true);
    expect(r0.semGrupo.map((x: { login: string }) => x.login)).toEqual(['SINT.SEMGRUPO1', 'SINT.SEMGRUPO2']);
    expect(r0.listaVazia).toBe(false);
    expect(r0.gruposDestino).not.toContain('SEM GRUPO');
    expect(r0.gruposDestino).not.toContain('PAINEIS');
    expect(r0.gruposDestino).toContain('ATENDIMENTO');
    expect(r0.paineis).toEqual([
      expect.objectContaining({ login: 'SINT.PAINELTV1', situacao: 'sem-substituicao' }),
      expect.objectContaining({ login: 'SINT.PAINELTV2', situacao: 'sem-substituicao' }),
    ]);

    // Regra 4: a TV ainda usa o login: o bloqueio pela tela de usuários é recusado com o motivo.
    const recusa = await post(s, `${U}/SINT.PAINELTV1/bloqueio`, { bloquear: true, senha: SENHA });
    expect(recusa.statusCode).toBe(409);
    expect(recusa.json()).toMatchObject({ codigo: 'login-de-painel-em-uso' });
    expect(recusa.json().detail).toContain('confira no setor');

    // A TI cadastra o aparelho com token e confere no setor que ele substitui o login da TV.
    const tv = await post(s, '/api/recepcao/dispositivos', {
      tipo: 'painel',
      nome: 'TV da espera (onda 5)',
      recepcao: 2,
      locais: [],
      geradores: [],
      conteudo: null,
      portalOrdem: null,
      usuarioLegado: null,
      validadeDias: 30,
      voz: true,
    });
    expect(tv.statusCode).toBe(201);
    const id = tv.json().id as number;
    expect(
      (await post(s, `/api/recepcao/dispositivos/${id}/conferir`, { loginSubstituido: 'SINT.USUARIO' }))
        .statusCode,
    ).toBe(400);
    const conf = await post(s, `/api/recepcao/dispositivos/${id}/conferir`, {
      loginSubstituido: 'SINT.PAINELTV1',
    });
    expect(conf.statusCode).toBe(201);
    expect(conf.json()).toMatchObject({ loginSubstituido: 'SINT.PAINELTV1', conferidoPor: 'SINT.ONDA5' });
    // (A trilha da conferência vai na transação SGH_ do banco; a porta em memória da recepção não a guarda.)
    // Um login, um aparelho válido.
    const outra = await post(s, '/api/recepcao/dispositivos', {
      tipo: 'painel',
      nome: 'TV repetida',
      recepcao: 2,
      locais: [],
      geradores: [],
      conteudo: null,
      portalOrdem: null,
      usuarioLegado: null,
      validadeDias: 30,
      voz: true,
    });
    const dup = await post(s, `/api/recepcao/dispositivos/${outra.json().id}/conferir`, {
      loginSubstituido: 'SINT.PAINELTV1',
    });
    expect(dup.statusCode).toBe(409);
    const r1 = (await get(s, `${F}/revisao`)).json();
    expect(r1.paineis[0]).toMatchObject({
      login: 'SINT.PAINELTV1',
      situacao: 'pode-bloquear',
      dispositivo: id,
      dispositivoNome: 'TV da espera (onda 5)',
    });
    expect(r1.paineisResolvidos).toBe(false);
    const ok = await post(s, `${U}/SINT.PAINELTV1/bloqueio`, { bloquear: true, senha: SENHA });
    expect(ok.statusCode).toBe(200);
    const r2 = (await get(s, `${F}/revisao`)).json();
    expect(r2.paineis[0]).toMatchObject({ login: 'SINT.PAINELTV1', situacao: 'bloqueado' });
    // A outra TV ainda usa o login (o critério de aceite só pede bloqueado o que já não tem TV ativa).
    expect(r2.paineisResolvidos).toBe(true);

    // Regra 5: um recebe grupo de trabalho (troca de grupo do M10), o outro é bloqueado; a lista fica vazia.
    const g = await post(s, `${U}/SINT.SEMGRUPO1/grupo`, { entrada: { grupo: 'ATENDIMENTO' }, senha: SENHA });
    expect(g.statusCode).toBe(200);
    const b = await post(s, `${U}/SINT.SEMGRUPO2/bloqueio`, { bloquear: true, senha: SENHA });
    expect(b.statusCode).toBe(200);
    const r3 = (await get(s, `${F}/revisao`)).json();
    expect(r3.semGrupo).toEqual([]);
    expect(r3.listaVazia).toBe(true);
  });

  it('regra 4: a substituição do registro versionado vale igual na revisão e no bloqueio (mesma fonte)', async () => {
    const s = await entrar('SINT.ONDA5');
    const tv = await post(s, '/api/recepcao/dispositivos', {
      tipo: 'painel',
      nome: 'TV conferida fora da tela',
      recepcao: 2,
      locais: [],
      geradores: [],
      conteudo: null,
      portalOrdem: null,
      usuarioLegado: null,
      validadeDias: 30,
      voz: true,
    });
    expect(tv.statusCode).toBe(201);
    const id = tv.json().id as number;
    const reg = readFileSync(join(RAIZ_HTTP, 'aa.yaml'), 'utf8');
    writeFileSync(
      join(RAIZ_HTTP, 'aa.yaml'),
      `${reg}\npaineis:\n  - { login: SINT.PAINELTV2, dispositivo: ${id}, conferidoEm: '2026-10-22', papel: ti }\n`,
    );
    try {
      const r = (await get(s, `${F}/revisao`)).json();
      expect(r.paineis.find((x: { login: string }) => x.login === 'SINT.PAINELTV2')).toMatchObject({
        situacao: 'pode-bloquear',
        dispositivo: id,
      });
      const ok = await post(s, `${U}/SINT.PAINELTV2/bloqueio`, { bloquear: true, senha: SENHA });
      expect(ok.statusCode).toBe(200);
      const r2 = (await get(s, `${F}/revisao`)).json();
      expect(r2.paineis.find((x: { login: string }) => x.login === 'SINT.PAINELTV2')).toMatchObject({
        situacao: 'bloqueado',
      });
      expect(r2.paineisResolvidos).toBe(true);
    } finally {
      writeFileSync(join(RAIZ_HTTP, 'aa.yaml'), reg);
    }
  });
});

// ── O serviço com uma porta falsa (o caminho todo verde, as datas e a falha fechada) ─────────────────────────────

const HOJE = '2027-02-20';
const dias = (n: number, ate = HOJE) =>
  Array.from({ length: n }, (_, i) =>
    new Date(Date.parse(`${ate}T00:00:00Z`) - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );

function portaFalsa(
  o: { retratosAte?: string; mon?: boolean; s1Aberto?: boolean; semAcesso?: boolean } = {},
): PortaCoexistencia {
  const retratos: RetratoLido[] = dias(60).flatMap((dia) => [
    {
      dia,
      login: 'ANA',
      modulo: 1,
      ultima: new Date(`${dia}T08:00:00Z`),
      mudou: dia < (o.retratosAte ?? '2027-01-10'),
    },
    // A conta de contingência combinada entra todo dia (fora da contagem).
    { dia, login: 'SINT.CONTINGENCIA', modulo: 1, ultima: new Date(`${dia}T09:00:00Z`), mudou: true },
  ]);
  const chamados = [
    {
      id: '1',
      severidade: 'S1',
      situacao: o.s1Aberto ? 'aberto' : 'resolvido',
      resolvidoEm: o.s1Aberto ? null : new Date('2027-01-15T10:00:00Z'),
    },
  ] as unknown as ChamadoLidoBanco[];
  const chaves: ChaveGravada[] = o.semAcesso
    ? []
    : [
        {
          id: '1',
          tipo: 'operacao',
          chave: 'agenda.agendarConsulta',
          escopo: 'grupo',
          valor: 'ATENDIMENTO',
          ligada: true,
          ligadaAntes: null,
          lote: '1',
          justificativa: null,
          alteradoPor: 'SINT.ADMIN',
          alteradoEm: '2027-01-05 10:00:00',
        },
      ];
  return {
    destino: 'memoria',
    relogio: async () => ({ agora: new Date(`${HOJE}T12:00:00Z`), hoje: HOJE }),
    pessoas: async () => [
      { id: 1, login: 'ANA', nome: null, grupo: 'ATENDIMENTO', unidades: [], locais: [] },
      { id: 2, login: 'TV01', nome: null, grupo: 'PAINEIS', unidades: [], locais: [] },
      { id: 3, login: 'SINT.CONTINGENCIA', nome: null, grupo: 'MASTER', unidades: [], locais: [] },
    ],
    conclusoes: async () => [
      {
        id: '1',
        login: 'ANA',
        papel: 'recepcao',
        onda: 1,
        versao: 1,
        turma: 'T1',
        concluidoEm: '2027-01-03',
        resultado: 'aprovado',
        registradoPor: 'SINT.ADMIN',
      },
    ],
    chaves: async () => chaves,
    setores: async () => [],
    retratos: async () => retratos,
    serieOutroSistema: async () => (o.mon === false ? [] : dias(60).map((dia) => ({ dia, conexoes: 0 }))),
    competenciaFim: async () => ({
      competencia: '2026-12',
      conveniosComConta: 2,
      conveniosFechados: 2,
      fechadosPeloNovo: 2,
      lotes: 3,
      lotesPeloNovo: 3,
      ultimaGravacaoNovo: '2027-01-08',
    }),
    chamados: async () => chamados,
  } as unknown as PortaCoexistencia;
}

const sessao = {
  porta: { rede: 'r', hospital: 'zz' },
  rede: 'r',
  hospital: 'zz',
  login: 'X',
} as SessaoCadastro;

describe('fim da coexistência: o serviço', () => {
  it('o registro do fim: ausente, de outro estabelecimento ou fora do esquema não conta como feito', () => {
    expect(lerRegistroFim(FIXTURES, 'zz').invalido).toBe('registro do fim ausente');
    expect(lerRegistroFim(FIXTURES, 'aa').invalido).toBeNull();
    expect(lerRegistroFim(resolve(FIXTURES, 'invalidos'), 'xx').invalido).toMatch(/fora do esquema/);
    expect(lerRegistroFim(resolve(FIXTURES, 'invalidos'), 'yy').invalido).toBe(
      'registro de outro estabelecimento',
    );
  });

  it('itens do critério verdes com a data (usuários, sem sessão, competência, sem S1); fora as contas combinadas', async () => {
    const s = new ServicoFimCoexistencia({
      porta: portaFalsa(),
      trilha: new RegistradorTrilhaMemoria(),
      caminhoCatalogo: resolve(import.meta.dirname, '../../../../../docs/operacoes/catalogo'),
      raizFim: resolve(FIXTURES, 'verdes'),
    });
    const t = await s.painel(sessao);
    const item = (k: string) => [...t.painel.cap15, ...t.painel.cap14].find((i) => i.item === k)!;
    expect(item('usuarios-com-trilha')).toMatchObject({
      situacao: 'verde',
      valor: '1 de 1',
      verdeDesde: '2027-01-05',
    });
    // Campo 4: o agregado por papel, com o "<5" (1 ativo da recepção, com trilha e acesso).
    expect(t.usuariosPorPapel).toEqual([{ papel: 'recepcao', ativos: '<5', semTrilha: 0, semAcesso: 0 }]);
    // Última sessão de pessoa em 2027-01-09: limpo desde 2027-01-10; 14 dias em 2027-01-23; 30 em 2027-02-08.
    expect(item('sem-sessao-14-dias')).toMatchObject({ situacao: 'verde', verdeDesde: '2027-01-23' });
    expect(item('sem-sessao-30-dias')).toMatchObject({ situacao: 'verde', verdeDesde: '2027-02-08' });
    expect(item('competencia-pelo-novo')).toMatchObject({ situacao: 'verde', verdeDesde: '2027-01-08' });
    expect(item('sem-s1-aberto')).toMatchObject({ situacao: 'verde', verdeDesde: '2027-01-15' });
    expect(item('contingencia-pronta')).toMatchObject({ situacao: 'verde', verdeDesde: '2027-02-10' });
    expect(item('aceite-diretoria')).toMatchObject({ situacao: 'verde', verdeDesde: '2027-02-12' });
    // As operações reais do catálogo ainda não estão todas liberadas: o fim não é registrável.
    expect(item('operacoes-liberadas').situacao).toBe('pendente');
    expect(t.foraPorEstado.length).toBeGreaterThan(0);
    expect(t.painel.fimRegistravel).toBe(false);
    expect(t.ata).toEqual({ data: '2027-02-15', referencia: 'ata sintética do comitê nº 9' });
    // Regra 9: sem setor gravado, todos os do catálogo seguem no outro sistema; os de meta vencida saem com a nova data.
    expect(t.setoresAtrasados.length).toBeGreaterThan(0);
    for (const x of t.setoresAtrasados) {
      expect(x.meta < HOJE).toBe(true);
      expect(x.novaData).toBe('2027-03-31');
    }
  });

  it('o critério inteiro verde: o fim é registrável (cinco itens e a contingência) e a divergência com o cap-14 sai', async () => {
    const s = new ServicoFimCoexistencia({
      porta: portaFalsa(),
      trilha: new RegistradorTrilhaMemoria(),
      caminhoCatalogo: resolve(FIXTURES, 'catalogo-liberado.yaml'),
      raizFim: resolve(FIXTURES, 'verdes'),
    });
    const t = await s.painel(sessao);
    expect(t.painel.cap15.map((i) => i.situacao)).toEqual(['verde', 'verde', 'verde', 'verde', 'verde']);
    expect(t.painel.cap15[0]).toMatchObject({ valor: '1 de 1', verdeDesde: '2026-12-20' });
    expect(t.painel.fimRegistravel).toBe(true);
    expect(t.painel.pendencias).toEqual([]);
    // O teste de assinatura da operação do catálogo sintético nunca rodou: o conjunto do cap-14 não fecha.
    expect(t.painel.divergencias[0]).toContain('assinaturas-verdes');
  });

  it('falha fechada: sem a série das conexões ao banco, S1 aberto e sem acesso ao novo, nada disso fica verde', async () => {
    const s = new ServicoFimCoexistencia({
      porta: portaFalsa({ mon: false, s1Aberto: true, semAcesso: true }),
      trilha: new RegistradorTrilhaMemoria(),
      caminhoCatalogo: resolve(FIXTURES, 'catalogo-liberado.yaml'),
      raizFim: resolve(FIXTURES, 'verdes'),
    });
    const t = await s.painel(sessao);
    const item = (k: string) => t.painel.cap15.find((i) => i.item === k)!;
    expect(item('sem-sessao-14-dias').situacao).toBe('sem-medida');
    expect(item('sem-s1-aberto')).toMatchObject({ situacao: 'pendente', valor: '1' });
    expect(item('usuarios-com-trilha')).toMatchObject({ situacao: 'pendente', valor: '0 de 1' });
    expect(t.painel.fimRegistravel).toBe(false);
  });

  it('regra 5: o login vazio segue pendente até a decisão no registro do fim; com ela, é exceção e a lista fica vazia', async () => {
    const comLoginVazio = (): PortaCoexistencia =>
      ({
        ...portaFalsa(),
        usuariosRevisao: async () => [{ login: '', grupo: 'SEM GRUPO', status: 'T', bloqueado: 'F' }],
        contagemUsuariosFim: async () => ({
          total: 3,
          ativos: 3,
          ativosSemGrupo: 1,
          ativosGrupoNulo: 0,
          paineisLivres: 0,
          paineisBloqueados: 0,
        }),
        gruposAtivos: async () => ['ATENDIMENTO', 'SEM GRUPO'],
      }) as unknown as PortaCoexistencia;
    const sem = new ServicoFimCoexistencia({
      porta: comLoginVazio(),
      trilha: new RegistradorTrilhaMemoria(),
      caminhoCatalogo: resolve(FIXTURES, 'catalogo-liberado.yaml'),
      raizFim: FIXTURES,
    });
    const req = { headers: {}, ip: '127.0.0.1' };
    const r0 = await sem.revisao({
      ...sessao,
      req,
      porta: { rede: 'r', hospital: 'aa' },
      hospital: 'aa',
    } as unknown as SessaoCadastro);
    expect(r0.semGrupo).toEqual([{ login: '', grupo: 'SEM GRUPO', loginVazio: true, excecao: null }]);
    expect(r0.listaVazia).toBe(false);
    const com = new ServicoFimCoexistencia({
      porta: comLoginVazio(),
      trilha: new RegistradorTrilhaMemoria(),
      caminhoCatalogo: resolve(FIXTURES, 'catalogo-liberado.yaml'),
      raizFim: resolve(FIXTURES, 'verdes'),
    });
    const r1 = await com.revisao({ ...sessao, req } as unknown as SessaoCadastro);
    expect(r1.semGrupo[0]?.excecao).toEqual({
      decisao: 'linha técnica sem uso confirmada pelo gestor de acessos',
      decididaEm: '2027-02-14',
    });
    expect(r1.listaVazia).toBe(true);
    expect(r1.parcelas.loginVazio).toBe(1);
  });
});
