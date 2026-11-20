// M42 pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco): o painel
// "Acompanhamento da competência" (contas por situação e sistema que fechou, com a conta fechada aqui contando como
// deste sistema; lotes; glosas; títulos e repasse só com a leitura do setor; gravações por operação da onda), a
// exportação com as parcelas, a conferência com o outro sistema (0 diferença e com diferença), o escopo por convênio e
// a aba Onda 4 do painel de migração (nove setores na ordem, itens da onda, regra 1 no registro e o lote recusado fora
// de dev/ci; a tela de chaves conferindo o critério do setor da onda 4).
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import { ServicoMigracao } from '../coexistencia/aplicacao/servico.js';
import { PortaCoexistenciaMemoria } from '../coexistencia/porta-memoria.js';
import { criterioLigarSetor, fonteConfiguracaoMemoria } from '../config/public-api.js';

const CATALOGO = resolve(import.meta.dirname, '../../../../../docs/operacoes/catalogo');
const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', CATALOGO_OPERACOES: CATALOGO };
const trilha = new RegistradorTrilhaMemoria();
let app: NestFastifyApplication;
let chave = 0;
const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const comp = hoje.slice(0, 7);

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, { trilha, vigia: null });
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
async function entrar(login: string): Promise<Sessao> {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
  expect(r.statusCode, r.body).toBe(201);
  const set = r.headers['set-cookie'] as string[];
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
  'idempotency-key': `teste-m42-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });
const put = (s: Sessao, url: string, payload: unknown) =>
  app.inject({ method: 'PUT', url: `/api${url}`, headers: h(s), payload: payload as object });

describe('acompanhamento da competência (campos 4 e 7)', { timeout: 30_000 }, () => {
  it('conta fechada aqui conta como deste sistema; as parcelas somam; os blocos do financeiro e do repasse aparecem', async () => {
    const antes = (
      await get(await entrar('SINT.COMPETENCIA'), `/tiss/painel/competencia?competencia=${comp}`)
    ).json();
    expect(antes.contas.fechadas).toBe(antes.contas.fechadasPeloNovo + antes.contas.fechadasPeloOutro);
    // Fecha a conta 9001 (lançada fora, aberta) pela tela do faturamento: a conta é uma só (regra 2).
    const contas = await entrar('SINT.CONTAS');
    const c = (await get(contas, '/faturamento/contas/9001')).json();
    expect((await post(contas, '/faturamento/contas/9001/fechar', { versao: c.versao })).statusCode).toBe(
      200,
    );
    const s = await entrar('SINT.COMPETENCIA');
    const r = await get(s, `/tiss/painel/competencia?competencia=${comp}`);
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json();
    expect(p.contas.fechadasPeloNovo).toBe(antes.contas.fechadasPeloNovo + 1);
    expect(p.contas.fechadas).toBe(p.contas.fechadasPeloNovo + p.contas.fechadasPeloOutro);
    expect(p.contas.contas).toBe(
      p.contas.porSituacao.reduce((t: number, x: { contas: number }) => t + x.contas, 0),
    );
    expect(p.contas.porSituacao.map((x: { rotulo: string }) => x.rotulo)).toContain('Fechada');
    expect(p.lotes.lotes).toBe(p.lotes.comProtocolo + p.lotes.semProtocolo);
    expect(p.glosas.disponivel).toBe(true);
    expect(p.titulos).toMatchObject({ disponivel: true });
    expect(p.titulos.aPagar.titulos).toBeGreaterThan(0);
    expect(p.titulos.movimento[0].rotulo).toContain('a confirmar');
    expect(p.repasse).toMatchObject({ disponivel: true });
    expect(p.uso).toMatchObject({ disponivel: false });
    const fechar = p.gravacoes.find((g: { operacao: string }) => g.operacao === 'faturamento.fecharConta');
    // A tela mostra os rótulos de produto; a operação e o setor ficam como chave.
    expect(fechar).toMatchObject({
      setor: 'faturamento-convenio',
      rotulo: 'Fechamento de conta',
      setorNome: 'Faturamento por convênio',
    });
    expect(fechar.peloNovo).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(p)).not.toMatch(/spdata|legado/i);
  });

  it('sem a leitura do financeiro e do repasse, os blocos vêm indisponíveis com o motivo; filtro inválido 400; sem a leitura do painel 403', async () => {
    const s = await entrar('SINT.TISS');
    const p = (await get(s, `/tiss/painel/competencia?competencia=${comp}`)).json();
    expect(p.titulos).toMatchObject({ disponivel: false });
    expect(p.titulos.motivo).toMatch(/financeiro/);
    expect(p.repasse).toMatchObject({ disponivel: false });
    expect((await get(s, '/tiss/painel/competencia?competencia=2026-13')).statusCode).toBe(400);
    expect((await get(s, '/tiss/painel/competencia')).statusCode).toBe(400);
    expect(
      (await get(await entrar('SINT.AGENDA'), `/tiss/painel/competencia?competencia=${comp}`)).statusCode,
    ).toBe(403);
  });

  it('escopo por convênio: o convênio fora do escopo é recusado', async () => {
    const s = await entrar('SINT.TISS.ESCOPO');
    expect((await get(s, `/tiss/painel/competencia?competencia=${comp}&convenio=91`)).statusCode).toBe(403);
    const r = await get(s, `/tiss/painel/competencia?competencia=${comp}&convenio=92`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().contas.porConvenio.every((x: { convenio: number }) => x.convenio === 92)).toBe(true);
  });

  it('exportação com as parcelas (auditada)', async () => {
    const s = await entrar('SINT.COMPETENCIA');
    const r = await get(s, `/tiss/painel/competencia/exportacao?competencia=${comp}`);
    expect(r.statusCode, r.body).toBe(200);
    expect(r.body).toMatch(/Fechadas;\d+ = \d+ por este sistema \+ \d+ pelo outro sistema/);
    expect(r.body).toMatch(/Lotes;\d+ = \d+ protocolados \+ \d+ sem protocolo/);
    // Os blocos que a tela mostra também saem, com as parcelas; o sem leitura sai com o motivo.
    expect(r.body).toMatch(/^Glosas;[\d,]+;[\d,]+;[\d,]+;[\d,]+;[\d,]+;/m);
    expect(r.body).toMatch(/^A pagar;\d+ títulos;[\d,]+;pagos \d+;[\d,]+$/m);
    expect(r.body).toMatch(/^A receber;\d+ títulos;/m);
    expect(r.body).toMatch(/^Movimento;18 = 7 .+ \+ 11 .+$/m);
    expect(r.body).toMatch(/^Repasse;\d+ itens integrados;[\d,]+;\d+ eventos;[\d,]+;\d+ RPAs$/m);
    expect(r.body).toMatch(/^Fechamento de conta;Faturamento por convênio;\d+$/m);
    expect(r.body).toMatch(/^Uso do outro sistema;indisponível: /m);
    expect(r.body).not.toMatch(/faturamento\.fecharConta|spdata|legado/i);
    const semFin = await get(
      await entrar('SINT.TISS'),
      `/tiss/painel/competencia/exportacao?competencia=${comp}`,
    );
    expect(semFin.body).toMatch(/^Títulos e movimento;indisponível: .*financeiro/m);
    expect(semFin.body).toMatch(/^Repasse;indisponível: .*repasse/m);
    expect(
      trilha.eventos.some((l) => l.tabelaAlvo === 'FCCTAEXT' && l.idAlvo === `competencia ${comp}`),
    ).toBe(true);
  });

  it('conferência: o lido igual dá 0 diferença; um valor trocado e um convênio só do outro lado aparecem', async () => {
    const s = await entrar('SINT.COMPETENCIA');
    const p = (await get(s, `/tiss/painel/competencia?competencia=${comp}`)).json();
    const linhas = p.contas.porConvenio.map(
      (c: { convenio: number; contas: number; fechadas: number; valor: number }) => ({
        convenio: c.convenio,
        contas: c.contas,
        fechadas: c.fechadas,
        valor: c.valor,
      }),
    );
    expect(linhas.length).toBeGreaterThan(1);
    const ok = await post(s, '/tiss/painel/competencia/conferencia', { competencia: comp, linhas });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json()).toMatchObject({ comparados: linhas.length, diferencas: [] });
    const trocado = [
      { ...linhas[0], valor: linhas[0].valor + 10 },
      ...linhas.slice(1),
      { convenio: 99, contas: 1, fechadas: 0, valor: 5 },
    ];
    const d = (
      await post(s, '/tiss/painel/competencia/conferencia', { competencia: comp, linhas: trocado })
    ).json();
    expect(d.diferencas.some((x: { campo: string }) => x.campo === 'valor')).toBe(true);
    expect(
      d.diferencas.some(
        (x: { chave: string; campo: string }) => x.chave === 'convenio 99' && x.campo === 'presenca',
      ),
    ).toBe(true);
    expect((await post(s, '/tiss/painel/competencia/conferencia', { competencia: comp })).statusCode).toBe(
      400,
    );
  });

  it('conferência: o convênio com conta que ficou de fora do pedido é diferença de presença (nunca "nenhuma diferença")', async () => {
    const s = await entrar('SINT.COMPETENCIA');
    const p = (await get(s, `/tiss/painel/competencia?competencia=${comp}`)).json();
    const [primeiro, ...resto] = p.contas.porConvenio as {
      convenio: number;
      contas: number;
      fechadas: number;
      valor: number;
    }[];
    expect(resto.length).toBeGreaterThan(0);
    const d = (
      await post(s, '/tiss/painel/competencia/conferencia', {
        competencia: comp,
        linhas: [
          {
            convenio: primeiro!.convenio,
            contas: primeiro!.contas,
            fechadas: primeiro!.fechadas,
            valor: primeiro!.valor,
          },
        ],
      })
    ).json();
    expect(d.diferencas).toEqual(
      resto.map((c) => ({
        chave: `convenio ${c.convenio}`,
        campo: 'presenca',
        novo: 'presente',
        outro: null,
      })),
    );
    // As contas informadas vazias: todo convênio com conta vira diferença.
    const vazio = (
      await post(s, '/tiss/painel/competencia/conferencia', { competencia: comp, linhas: [] })
    ).json();
    expect(vazio.diferencas).toHaveLength(p.contas.porConvenio.length);
  });

  it('conferência dos outros blocos: lotes, glosas, títulos, movimento por tipo e repasse; o bloco sem a leitura do setor é 403', async () => {
    const s = await entrar('SINT.COMPETENCIA');
    const p = (await get(s, `/tiss/painel/competencia?competencia=${comp}`)).json();
    const blocos = {
      lotes: { lotes: p.lotes.lotes, protocolados: p.lotes.comProtocolo },
      glosas: { emitido: p.glosas.emitido, glosa: p.glosas.glosa, recuperado: p.glosas.recuperado },
      aPagar: { titulos: p.titulos.aPagar.titulos, valor: p.titulos.aPagar.valor },
      aReceber: { titulos: p.titulos.aReceber.titulos, valor: p.titulos.aReceber.valor },
      movimento: p.titulos.movimento.map((m: { tipo: string; lancamentos: number; valor: number }) => ({
        tipo: m.tipo,
        lancamentos: m.lancamentos,
        valor: m.valor,
      })),
      repasse: { eventos: p.repasse.eventos, valorEventos: p.repasse.valorEventos, rpas: p.repasse.rpas },
    };
    const ok = await post(s, '/tiss/painel/competencia/conferencia', { competencia: comp, blocos });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().diferencas).toEqual([]);
    expect(ok.json().comparados).toBe(5 + blocos.movimento.length);
    const trocado = (
      await post(s, '/tiss/painel/competencia/conferencia', {
        competencia: comp,
        blocos: {
          ...blocos,
          lotes: { ...blocos.lotes, protocolados: blocos.lotes.protocolados + 1 },
          aPagar: { ...blocos.aPagar, valor: blocos.aPagar.valor + 1 },
          // Um tipo só do outro lado e um deste sistema que ficou de fora.
          movimento: [...blocos.movimento.slice(1), { tipo: 'Z', lancamentos: 1, valor: 1 }],
          repasse: { ...blocos.repasse, rpas: blocos.repasse.rpas + 1 },
        },
      })
    ).json();
    const chaves = trocado.diferencas.map((x: { chave: string; campo: string }) => `${x.chave}/${x.campo}`);
    expect(chaves).toEqual(
      expect.arrayContaining([
        'lotes/protocolados',
        'titulos a pagar/valor',
        'movimento Z/presenca',
        `movimento ${blocos.movimento[0].tipo}/presenca`,
        'repasse/rpas',
      ]),
    );
    expect(chaves).toHaveLength(5);
    const semFin = await post(await entrar('SINT.TISS'), '/tiss/painel/competencia/conferencia', {
      competencia: comp,
      blocos: { aPagar: blocos.aPagar },
    });
    expect(semFin.statusCode, semFin.body).toBe(403);
    expect(semFin.json().codigo).toBe('sem-leitura-do-bloco');
  });

  it('escopo de contas bancárias (regra 15 do M32): o usuário restrito à conta 1 não vê o movimento da conta 2', async () => {
    const livre = (
      await get(await entrar('SINT.COMPETENCIA'), `/tiss/painel/competencia?competencia=${comp}`)
    ).json();
    expect(livre.titulos.movimento.map((m: { tipo: string }) => m.tipo)).toEqual(['I', 'O']);
    const s = await entrar('SINT.COMPETENCIA.CONTA1');
    const restrito = (await get(s, `/tiss/painel/competencia?competencia=${comp}`)).json();
    expect(restrito.titulos.movimento.map((m: { tipo: string }) => m.tipo)).toEqual(['I']);
    // A conferência do movimento também fica no escopo: o tipo da conta 2 não existe para ele.
    const d = (
      await post(s, '/tiss/painel/competencia/conferencia', {
        competencia: comp,
        blocos: { movimento: [{ tipo: 'O', lancamentos: 11, valor: 13_250.5 }] },
      })
    ).json();
    expect(d.diferencas.map((x: { chave: string }) => x.chave).sort()).toEqual([
      'movimento I',
      'movimento O',
    ]);
  });
});

describe('aba Onda 4 do painel de migração (regras 1 a 8 do M40 e as da onda)', { timeout: 30_000 }, () => {
  it('nove setores na ordem, itens da onda, regra 1, sem versão, saídas externas, SUS e códigos a confirmar', async () => {
    const s = await entrar('SINT.ADMIN');
    const r = await get(s, '/administracao/coexistencia/migracao/onda4');
    expect(r.statusCode, r.body).toBe(200);
    const p = r.json();
    expect(p.ordem.flat()).toEqual([
      'faturamento-convenio',
      'auditoria-contas',
      'tiss-lotes',
      'glosa-recurso',
      'contas-a-pagar',
      'contas-a-receber',
      'tesouraria',
      'repasse',
      'fiscal',
    ]);
    const fat = p.setores.find((x: { setor: string }) => x.setor === 'faturamento-convenio');
    expect(fat.exigeAbertura).toBe(true);
    expect(fat.momentoRotulo).toBe('Na abertura da competência');
    expect(fat.itens.map((i: { item: string }) => i.item)).toEqual(
      expect.arrayContaining(['abertura-da-competencia', 'reproducao-sem-diferenca', 'registros-conferidos']),
    );
    expect(fat.podeLiberar).toBe(false);
    expect(fat.respostas.map((x: { pergunta: string }) => x.pergunta)).toContain('FAT-01');
    expect(fat.respostas[0].comoEntra).toBe('padrao-de-mercado');
    const lancar = fat.operacoes.find((o: { nome: string }) => o.nome === 'faturamento.lancarItem');
    expect(lancar).toMatchObject({ estado: 'especificada', fora: true });
    const tiss = p.setores.find((x: { setor: string }) => x.setor === 'tiss-lotes');
    expect(tiss.exigeAbertura).toBe(false);
    expect(tiss.antesFaltam).toEqual(['faturamento-convenio', 'auditoria-contas']);
    expect(p.abertura.hoje).toBe(hoje);
    expect(p.semVersao.dias.length).toBeGreaterThan(0);
    expect(p.saidasExternas.every((x: { permitida: boolean }) => !x.permitida)).toBe(true);
    expect(p.sus).toEqual({ fora: ['SISAIH01', 'BPA', 'APAC', 'CIHA'], operacoesSus: [] });
    const tipo = p.codigosAConfirmar.find((x: { coluna: string }) => x.coluna === 'MFLANCTO.TIPO_TRF');
    expect(tipo.vistos).toEqual(expect.arrayContaining(['I', 'O']));
    expect(p.catalogos.operacoes).toContain('catalogo.importarBrasindice');
    expect(JSON.stringify(p)).not.toMatch(/spdata/i);
  });

  it('regra 1: o início registrado fora do primeiro dia útil é recusado (409) com a abertura; no dia certo grava', async () => {
    const s = await entrar('SINT.ADMIN');
    const fora = await put(s, '/administracao/coexistencia/migracao/onda4/criterio/faturamento-convenio', {
      itens: [
        {
          item: 'abertura-da-competencia',
          situacao: 'cumprido',
          evidencia: 'ata do comitê 7',
          em: '2027-03-02',
        },
      ],
      justificativa: 'início marcado pelo comitê',
    });
    expect(fora.statusCode, fora.body).toBe(409);
    expect(fora.json().codigo).toBe('fora-da-abertura-da-competencia');
    expect(fora.json().detail).toContain('01/03/2027');
    const ok = await put(s, '/administracao/coexistencia/migracao/onda4/criterio/faturamento-convenio', {
      itens: [
        {
          item: 'abertura-da-competencia',
          situacao: 'cumprido',
          evidencia: 'ata do comitê 7',
          em: '2027-03-01',
        },
      ],
      justificativa: 'início marcado pelo comitê',
    });
    expect(ok.statusCode, ok.body).toBe(200);
    // Com a configuração padrão (só os feriados nacionais), 01/01/2027 é feriado e a abertura é 04/01/2027.
    const anoNovo = (em: string) =>
      put(s, '/administracao/coexistencia/migracao/onda4/criterio/faturamento-convenio', {
        itens: [{ item: 'abertura-da-competencia', situacao: 'cumprido', evidencia: 'ata do comitê 8', em }],
        justificativa: 'início marcado pelo comitê',
      });
    const feriado = await anoNovo('2027-01-01');
    expect(feriado.statusCode, feriado.body).toBe(409);
    expect(feriado.json().detail).toContain('04/01/2027');
    expect((await anoNovo('2027-01-04')).statusCode).toBe(200);
    expect((await anoNovo('2027-03-01')).statusCode).toBe(200);
    const p = (await get(s, '/administracao/coexistencia/migracao/onda4')).json();
    const item = p.setores
      .find((x: { setor: string }) => x.setor === 'faturamento-convenio')
      .itens.find((i: { item: string }) => i.item === 'abertura-da-competencia');
    expect(item.ok).toBe(true);
    // Item de outro setor, "não se aplica" e setor fora da onda.
    expect(
      (
        await put(s, '/administracao/coexistencia/migracao/onda4/criterio/repasse', {
          itens: [
            { item: 'abertura-da-competencia', situacao: 'cumprido', evidencia: 'ata 7', em: '2027-03-01' },
          ],
          justificativa: 'início marcado pelo comitê',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await put(s, '/administracao/coexistencia/migracao/onda4/criterio/repasse', {
          itens: [
            { item: 'registros-conferidos', situacao: 'nao-se-aplica', evidencia: 'ata 7', em: '2027-03-01' },
          ],
          justificativa: 'início marcado pelo comitê',
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await put(s, '/administracao/coexistencia/migracao/onda4/criterio/farmacia-central', {
          itens: [{ item: 'aceite-jornada', situacao: 'pendente' }],
          justificativa: 'início marcado pelo comitê',
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe(
  'fora de dev/ci: o lote e a chave do setor da onda 4 conferem o critério',
  { timeout: 30_000 },
  () => {
    it('o lote de um setor da onda 4 com o critério incompleto: 409 criterio-onda4-incompleto; a chave diz o setor', async () => {
      const sessao: SessaoCadastro = {
        req: { headers: {}, ip: '127.0.0.1' } as unknown as SessaoCadastro['req'],
        hospital: 'pc',
        rede: 'r',
        login: 'SINT.ADMIN',
        porta: { rede: 'r', hospital: 'pc' },
        pode: () => true,
      };
      const servico = new ServicoMigracao({
        porta: new PortaCoexistenciaMemoria(
          new RegistradorTrilhaMemoria(),
          fonteConfiguracaoMemoria(new RegistradorTrilhaMemoria()),
        ),
        trilha: new RegistradorTrilhaMemoria(),
        administracao: null,
        fonteConfig: null,
        cache: null,
        caminhoCatalogo: CATALOGO,
        ambiente: 'homologacao',
        grafana: null,
        metodoMascaramento: null,
        primeiro: { codigo: 'pc', nome: 'ProntoCardio' },
        criterio: criterioLigarSetor(),
      });
      const e = await servico
        .aplicarLote(sessao, {
          setor: 'glosa-recurso',
          alvo: { tipo: 'setor', valores: [] },
          justificativa: 'Lote sintético da glosa (teste)',
        })
        .then(
          () => null,
          (x: unknown) => x as ErroProblema,
        );
      expect(e?.getStatus()).toBe(409);
      expect(e?.extras).toMatchObject({ codigo: 'criterio-onda4-incompleto' });
      const motivo = await servico.motivoLigarChaveOnda2(
        { rede: 'r', hospital: 'pc' },
        'operacao',
        'faturamento.registrarGlosa',
      );
      expect(motivo).toContain('Glosa e recurso');
      expect(
        await servico.motivoLigarChaveOnda2(
          { rede: 'r', hospital: 'pc' },
          'recurso',
          'suprimentos.inexistente',
        ),
      ).toBeNull();
    });
  },
);
