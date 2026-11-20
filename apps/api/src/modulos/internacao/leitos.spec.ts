// M16 pela HTTP, com a sessão real sobre a fonte sintética e o estabelecimento SINTÉTICO do M16 em memória (nada
// conecta a banco): liberação, painel sem dado pessoal (regra 16), abertura do cartão só com o cadastro (e na
// trilha), divergência de cadastro (regra 2), censo do dia em aberto e a série (regra 7), exportação (permissão
// própria), indicadores com ficha, recorte sem denominador recusado, painéis (o financeiro com a permissão
// própria), BI desligado com o motivo, e o canal de eventos: a internação gravada "por fora" chega em até 2 s.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ArmazemMemoria } from '../../sessao/armazem.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { FonteInternacaoMemoria } from './fonte-memoria.js';
import { MotorVigia } from './vigia.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const pasta = mkdtempSync(join(tmpdir(), 'sgh-m16-'));
const arquivo = join(pasta, 'por-fora.json');
const fonte = new FonteInternacaoMemoria({ arquivoPorFora: arquivo });
const vigia = new MotorVigia({
  rede: 'rede-teste',
  lerCanal: (h, c, m) => fonte.canal({ rede: 'rede-teste', hospital: h, traceId: 't' }, c, m),
  armazem: new ArmazemMemoria(),
  tipoArmazem: 'memoria',
  intervaloMs: 1_000,
});
let app: NestFastifyApplication;
let base = '';

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    internacao: fonte,
    vigia,
    batidaEventosMs: 300,
  });
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
afterAll(async () => {
  vigia.parar();
  await app.close();
  rmSync(pasta, { recursive: true, force: true });
});

interface Sessao {
  cookie: string;
}
async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode).toBe(201);
  const set = r.headers['set-cookie'] as string[];
  return { cookie: set.map((c) => c.split(';')[0]).join('; ') };
}
const get = (s: Sessao, url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } });

describe('painel de leitos ao vivo', () => {
  let leitos: Sessao;
  let diretoria: Sessao;
  beforeAll(async () => {
    leitos = await entrar('SINT.LEITOS');
    diretoria = await entrar('SINT.DIRETORIA');
  });

  it('liberação: painel e painéis ligados na sessão sintética; fechamento e BI desligados com o motivo', async () => {
    const r = await get(leitos, '/api/internacao/liberacao');
    expect(r.json()).toMatchObject({ painel: true, paineis: true, fechamento: false, bi: false });
    expect(r.json().motivos.bi).toMatch(/liberad|pré-requisito/);
  });

  it('o painel: grade, totais e o cartão sem nome; a abertura da tela vai à trilha', async () => {
    const antes = trilha.eventos.length;
    const r = await get(leitos, '/api/internacao/leitos/painel?abertura=1');
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.destino).toBe('memoria');
    expect(p.totais.leitos).toBe(15);
    expect(p.totais.inativos).toBe(1);
    const cartoes = p.blocos.flatMap((b: { acomodacoes: { leitos: { cartao: unknown }[] }[] }) =>
      b.acomodacoes.flatMap((a) => a.leitos.map((l) => l.cartao).filter(Boolean)),
    );
    expect(cartoes.length).toBeGreaterThan(0);
    expect(JSON.stringify(p)).not.toMatch(/PACIENTE SINT|"nome":"PACIENTE|cpf|nascimento/i);
    expect(trilha.eventos.length).toBe(antes + 1);
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'internacao.leitos.consultado' });
    // A releitura (sem abertura) não vai à trilha.
    await get(leitos, '/api/internacao/leitos/painel');
    expect(trilha.eventos.length).toBe(antes + 1);
  });

  it('a trilha do painel é decidida no servidor: a leitura sem abertura, a primeira da sessão na janela, vai à trilha', async () => {
    const outra = await entrar('SINT.LEITOS');
    const antes = trilha.eventos.length;
    // Por script ou pelo console, sem ?abertura=1: a primeira leitura da sessão vai à trilha mesmo assim.
    expect((await get(outra, '/api/internacao/leitos/painel')).statusCode).toBe(200);
    expect(trilha.eventos.length).toBe(antes + 1);
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'internacao.leitos.consultado' });
    // As releituras seguintes na janela (as do vigia) não; a abertura da tela, sempre.
    await get(outra, '/api/internacao/leitos/painel');
    expect(trilha.eventos.length).toBe(antes + 1);
    await get(outra, '/api/internacao/leitos/painel?abertura=1');
    expect(trilha.eventos.length).toBe(antes + 2);
  });

  it('abrir o cartão: o nome com o cadastro (na trilha, só o número da internação); sem o cadastro, 403', async () => {
    const p = (await get(leitos, '/api/internacao/leitos/painel')).json();
    const reg = p.blocos[0].acomodacoes
      .flatMap((a: { leitos: { cartao: { internacao: number } | null }[] }) => a.leitos)
      .find((l: { cartao: unknown }) => l.cartao).cartao.internacao;
    const r = await get(leitos, `/api/internacao/leitos/painel/${reg}/paciente`);
    expect(r.statusCode).toBe(200);
    expect(r.json().nome).toMatch(/^PACIENTE SINTÉTICO/);
    expect(trilha.eventos.at(-1)).toMatchObject({
      evento: 'internacao.leitos.pacienteAberto',
      idAlvo: String(reg),
    });
    expect(JSON.stringify(trilha.eventos.at(-1))).not.toMatch(/PACIENTE/);
    expect((await get(diretoria, `/api/internacao/leitos/painel/${reg}/paciente`)).statusCode).toBe(403);
    expect((await get(leitos, '/api/internacao/leitos/painel/999999999/paciente')).statusCode).toBe(404);
    expect((await get(leitos, '/api/internacao/leitos/painel/abc/paciente')).statusCode).toBe(400);
  });

  it('divergência de cadastro: o registro de conferência à parte (regra 2)', async () => {
    const r = await get(leitos, '/api/internacao/leitos/divergencias');
    expect(r.statusCode).toBe(200);
    expect(r.json().porTipo).toMatchObject({ 'leito-sem-espelho': 1, 'ramal-diferente': 1 });
    expect(r.json().contagens.leitosEspelhoExterno).toBe(1);
  });

  it('censo: o dia em aberto, a data futura e a inválida recusadas, a série e a exportação', async () => {
    const hoje = await get(leitos, '/api/internacao/censo');
    expect(hoje.statusCode).toBe(200);
    expect(hoje.json()).toMatchObject({ situacao: 'aberto', horaFechamento: 24 });
    const t = hoje.json().totais;
    expect(t.internados).toBeGreaterThan(0);
    expect((await get(leitos, '/api/internacao/censo?data=2099-01-01')).statusCode).toBe(400);
    expect((await get(leitos, '/api/internacao/censo?data=01/01/2026')).statusCode).toBe(400);
    const ontem = await get(leitos, '/api/internacao/censo?data=2025-06-10');
    expect(ontem.json().situacao).toBe('calculado');
    const s = await get(leitos, '/api/internacao/censo/serie?de=2025-01-01&ate=2025-03-31&agrupamento=mes');
    expect(s.json().periodos.map((x: { periodo: string }) => x.periodo)).toEqual([
      '2025-01',
      '2025-02',
      '2025-03',
    ]);
    expect((await get(leitos, '/api/internacao/censo/serie?de=2025-01-01')).statusCode).toBe(400);
    const csv = await get(leitos, '/api/internacao/censo/exportar?data=2025-06-10');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.body).toMatch(/^\uFEFFdata;bloco;acomodacao/);
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'internacao.censo.exportado' });
    const serieCsv = await get(
      leitos,
      '/api/internacao/censo/exportar?de=2025-01-01&ate=2025-02-28&agrupamento=dia',
    );
    expect(serieCsv.body.split('\r\n')).toHaveLength(61);
    // A diretoria vê o censo mas não exporta (opção do legado própria).
    expect((await get(diretoria, '/api/internacao/censo')).statusCode).toBe(200);
    expect((await get(diretoria, '/api/internacao/censo/exportar')).statusCode).toBe(403);
  });

  it('relatório das internações marcadas (regra 5): número e marca, na trilha; exportar com a permissão própria', async () => {
    const r = await get(leitos, '/api/internacao/censo/marcadas');
    expect(r.statusCode).toBe(200);
    const m = r.json() as { casos: { internacao: number; marca: string }[]; marcas: Record<string, number> };
    // Um caso por marca contada (a diferença das transferências é só contagem).
    const contados = Object.entries(m.marcas)
      .filter(([k]) => k !== 'transferencias-sem-trecho')
      .reduce((a, [, n]) => a + n, 0);
    expect(m.casos).toHaveLength(contados);
    for (const c of m.casos) expect(Object.keys(c).sort()).toEqual(['internacao', 'marca']);
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'internacao.censo.marcadas' });
    const csv = await get(leitos, '/api/internacao/censo/marcadas/exportar');
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toMatch(/^\uFEFFinternacao;marca\r\n/);
    expect(trilha.eventos.at(-1)).toMatchObject({ evento: 'internacao.censo.marcadas' });
    expect((await get(diretoria, '/api/internacao/censo/marcadas')).statusCode).toBe(200);
    expect((await get(diretoria, '/api/internacao/censo/marcadas/exportar')).statusCode).toBe(403);
  });
});

describe('indicadores e painéis gerenciais', () => {
  let diretoria: Sessao;
  let leitos: Sessao;
  beforeAll(async () => {
    diretoria = await entrar('SINT.DIRETORIA');
    leitos = await entrar('SINT.LEITOS');
  });

  it('índice com a ficha e a situação; série com ano anterior, recorte e detalhe', async () => {
    const i = await get(diretoria, '/api/relatorios/indicadores?de=2025-01&ate=2025-06');
    expect(i.statusCode).toBe(200);
    expect(i.json().indicadores).toHaveLength(13);
    expect(i.json().indicadores[0]).toMatchObject({
      ficha: { codigo: 'taxaOcupacao', meta: null },
      situacao: 'sem-meta',
    });
    const s = await get(
      diretoria,
      '/api/relatorios/indicadores/taxaOcupacao?de=2025-01&ate=2025-06&recorte=acomodacao&valor=2/UTI1',
    );
    expect(s.statusCode).toBe(200);
    expect(s.json().valores).toHaveLength(6);
    expect(s.json().anoAnterior[0].periodo).toBe('2024-01');
    expect(s.json().valores[0].denominador).toBe(5 * 31);
    expect(s.json().detalhe.length).toBeGreaterThan(0);
    expect(
      (await get(diretoria, '/api/relatorios/indicadores/taxaOcupacao?recorte=clinica&valor=M')).statusCode,
    ).toBe(400);
    expect(
      (await get(diretoria, '/api/relatorios/indicadores/taxaOcupacao?recorte=acomodacao&valor=X'))
        .statusCode,
    ).toBe(400);
    expect((await get(diretoria, '/api/relatorios/indicadores/naoExiste')).statusCode).toBe(404);
    expect((await get(diretoria, '/api/relatorios/indicadores?de=2025-13')).statusCode).toBe(400);
    const csv = await get(
      diretoria,
      '/api/relatorios/indicadores/taxaMortalidadeGeral/exportar?de=2025-01&ate=2025-03',
    );
    expect(csv.statusCode).toBe(200);
    expect(csv.body.split('\r\n')[1]).toMatch(/^2025-01;\d+;\d+;/);
    // A coordenação de leitos não tem os indicadores.
    expect((await get(leitos, '/api/relatorios/indicadores')).statusCode).toBe(403);
  });

  it('painéis: assistencial ao vivo, operacional e financeiro da cópia diária (duas réguas, com permissão)', async () => {
    const a = await get(diretoria, '/api/relatorios/paineis/assistencial?de=2025-01&ate=2025-03');
    expect(a.json()).toMatchObject({ fonte: 'ao-vivo', painel: 'assistencial' });
    const o = await get(diretoria, '/api/relatorios/paineis/operacional?de=2025-01&ate=2025-03');
    expect(o.json().fonte).toBe('copia-diaria');
    const f = await get(diretoria, '/api/relatorios/paineis/financeiro?de=2025-01&ate=2025-03');
    expect(f.statusCode).toBe(200);
    expect(f.json().series.map((x: { regua: string | null }) => x.regua)).toContain('competencia');
    expect((await get(diretoria, '/api/relatorios/paineis/outro')).statusCode).toBe(404);
  });

  it('BI: desligado (sem a cópia diária de produção), com as pendências', async () => {
    const r = await get(diretoria, '/api/relatorios/bi');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ligado: false, endereco: null });
    expect(r.json().pendencias).toHaveLength(2);
  });
});

describe('canal de eventos do vigia (regra 15)', () => {
  it('a internação gravada por fora aparece em até 2 s; a releitura mostra o cartão', async () => {
    const s = await entrar('SINT.LEITOS');
    const ctl = new AbortController();
    const resp = await fetch(`${base}/api/internacao/leitos/eventos`, {
      headers: { cookie: s.cookie, accept: 'text/event-stream' },
      signal: ctl.signal,
    });
    expect(resp.status).toBe(200);
    expect(resp.headers.get('content-type')).toMatch(/text\/event-stream/);
    const leitor = resp.body!.getReader();
    const dec = new TextDecoder();
    let texto = '';
    // Uma leitura pendente só (a corrida com o tempo não pode descartar um pedaço já lido).
    let pendente: ReturnType<typeof leitor.read> | null = null;
    const ate = async (re: RegExp, ms: number) => {
      const fim = Date.now() + ms;
      while (!re.test(texto)) {
        if (Date.now() > fim) throw new Error(`não chegou: ${re}`);
        pendente ??= leitor.read();
        const r = await Promise.race([pendente, new Promise<null>((ok) => setTimeout(() => ok(null), 200))]);
        if (r) {
          pendente = null;
          if (r.value) texto += dec.decode(r.value);
        }
      }
    };
    await ate(/retry: 3000/, 2_000);
    // Primeiro ciclo: a linha de base (sem evento). Depois, a gravação por fora.
    await new Promise((ok) => setTimeout(ok, 1_200));
    const t0 = Date.now();
    writeFileSync(
      arquivo,
      JSON.stringify({
        reg: 990_001,
        bloco: '1',
        acomodacao: 'APT1',
        leito: '03',
        iniciais: 'TPF',
        sexo: 'F',
        nascimento: '1960-05-05',
        convenio: 'CONVÊNIO SINTÉTICO A',
      }),
    );
    await ate(/event: mudanca\ndata: \{"canal":"leitos"/, 2_000);
    expect(Date.now() - t0).toBeLessThan(2_000);
    ctl.abort();
    const p = (await get(s, '/api/internacao/leitos/painel')).json();
    const apt = p.blocos[0].acomodacoes.find((a: { acomodacao: string }) => a.acomodacao === 'APT1');
    expect(apt.leitos.find((l: { leito: string }) => l.leito === '03').cartao).toMatchObject({
      internacao: 990_001,
      iniciais: 'TPF',
    });
    const saude = vigia.saude().canais.find((c) => c.canal === 'leitos');
    expect(saude?.mudancas).toBeGreaterThanOrEqual(1);
    expect(saude?.consultasUltimoCiclo).toBe(1);
  });

  it('sessão encerrada no meio do canal: a batida seguinte reconfere a sessão e fecha o canal', async () => {
    const s = await entrar('SINT.LEITOS');
    const csrf = /sgh_csrf=([^;]+)/.exec(s.cookie)?.[1] ?? '';
    const resp = await fetch(`${base}/api/internacao/leitos/eventos`, {
      headers: { cookie: s.cookie, accept: 'text/event-stream' },
    });
    expect(resp.status).toBe(200);
    const leitor = resp.body!.getReader();
    const primeiro = await leitor.read();
    expect(new TextDecoder().decode(primeiro.value)).toMatch(/retry: 3000/);
    const saiu = await app.inject({
      method: 'DELETE',
      url: '/api/sessao',
      headers: { cookie: s.cookie, 'x-csrf': csrf },
    });
    expect(saiu.statusCode).toBe(204);
    // Batida de 300 ms neste teste: o canal fecha (fim do corpo) sem o cliente fechar.
    const fim = Date.now() + 3_000;
    let acabou = false;
    while (!acabou && Date.now() < fim) {
      const r = await Promise.race([
        leitor.read(),
        new Promise<null>((ok) => setTimeout(() => ok(null), 3_000)),
      ]);
      if (r?.done) acabou = true;
    }
    expect(acabou).toBe(true);
    // Reconectar passa pela guarda: sem sessão, 401.
    const deNovo = await app.inject({
      method: 'GET',
      url: '/api/internacao/leitos/eventos',
      headers: { cookie: s.cookie },
    });
    expect(deNovo.statusCode).toBe(401);
  });
});
