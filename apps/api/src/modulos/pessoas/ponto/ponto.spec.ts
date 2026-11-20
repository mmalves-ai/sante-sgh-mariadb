// M52.4 (fatia F4) pela HTTP, com a sessão real sobre a fonte sintética e as portas da gestão de pessoas, da escala e do
// ponto EM MEMÓRIA (nada conecta a banco; CPF SINTÉTICO): o RH importa o arquivo do relógio (o repetido é recusado; o
// com defeito fica em quarentena inteiro), lança ajustes e a justificativa; a coordenação (SINT.PONTO) aprova (o próprio
// pedido não), fecha com o banco de horas, gera o AEJ e reabre com o estorno; o colaborador dá a ciência do próprio
// espelho (o RH não dá a ciência por ele); quem não tem o ponto não vê.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { linhaCabecalhoAfd, linhaMarcacaoAfd, linhaTrailerAfd } from '@sgh/dominio-pessoas';
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../../config/public-api.js';
import { CifraCpf } from '../cifra-cpf.js';
import { PortaEscalaMemoria } from '../escala/porta-escala-memoria.js';
import { PESSOAS_SINTETICAS_M52, PortaPessoasMemoria } from '../porta-memoria.js';
import { PortaPontoMemoria } from './porta-ponto-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const chave = (c: string): ChaveGravada => ({
  id: c,
  tipo: 'recurso',
  chave: c,
  escopo: 'hospital',
  valor: '*',
  ligada: true,
  ligadaAntes: null,
  lote: null,
  justificativa: 'teste sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});
const cumprido = (recurso: string): PrerequisitoGravado => ({
  recurso,
  tipo: 'aprovacao',
  situacao: 'cumprido',
  validade: null,
  evidencia: 'conferência sintética',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-25T10:00:00',
});

let app: NestFastifyApplication;
const trilha = new RegistradorTrilhaMemoria();
const pessoas = new PortaPessoasMemoria();
pessoas.hojeFixo = '2026-10-25';
const escala = new PortaEscalaMemoria(pessoas);
const ponto = new PortaPontoMemoria(pessoas);
ponto.agoraFixo = '2026-10-25T10:00';
const C = PESSOAS_SINTETICAS_M52;

beforeAll(async () => {
  const recursos = ['pessoas.colaborador', 'pessoas.escala', 'pessoas.ponto'];
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    pessoas,
    escala,
    ponto,
    cifraCpf: new CifraCpf(Buffer.alloc(32, 7)),
    configuracao: fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => recursos.map(chave),
      prerequisitosIniciais: () => recursos.map(cumprido),
    }),
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);
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
let n = 0;
const pedir = (s: Sessao) => {
  const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `m52-4-teste-${++n}` });
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: h() }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
  };
};
const P = '/api/pessoas';

const cab = linhaCabecalhoAfd({
  cnpj: '00000000000191',
  razaoSocial: 'HOSPITAL SINTETICO',
  numeroRep: '00004000000000123',
  dataInicial: '2026-09-01',
  dataFinal: '2026-09-30',
  geradoEm: '2026-10-01T08:00:00-0300',
});
const marcas = [
  '2026-09-02T06:58',
  '2026-09-02T19:03',
  '2026-09-04T07:20',
  '2026-09-04T19:00',
  '2026-09-05T08:00',
  '2026-09-08T19:00',
  '2026-09-09T07:00',
];
const afd = (linhas: string[]) => [cab, ...linhas, linhaTrailerAfd({ '3': linhas.length })].join('\r\n');
const valido = afd(marcas.map((m, i) => linhaMarcacaoAfd(i + 1, `${m}:00-0300`, C.comLogin.cpf)));
const quebrado = afd([
  linhaMarcacaoAfd(20, '2026-09-11T07:00:00-0300', C.comLogin.cpf),
  linhaMarcacaoAfd(22, '2026-09-11T19:00:00-0300', C.comLogin.cpf),
]);

describe('ponto, fatia F4, pela HTTP', { timeout: 180_000 }, () => {
  it('importar → quarentena → ajustes → aprovar → fechar com o banco → ciência → AEJ → reabrir com o estorno', async () => {
    // Admissão do colaborador com login (SINT.COLAB) e a escala de setembro publicada com o regime 12x36.
    const rh = pedir(await entrar('SINT.RH'));
    const pv = await rh.post(`${P}/admissao/previa`, { cpf: C.comLogin.cpf });
    expect(pv.statusCode).toBe(200);
    const usuario = pv.json().usuarios[0].id as number;
    const adm = await rh.post(`${P}/colaboradores`, {
      cpf: C.comLogin.cpf,
      nome: 'ENFERMEIRA SINTETICA UM',
      tipo: 'clt',
      admissao: '2026-08-01',
      cargo: 'Enfermeira assistencial',
      funcao: null,
      cargaSemanalHoras: 36,
      lotacao: { centroCusto: 9521, unidade: 1, setor: 'Posto 1' },
      matricula: 'PONTO-1',
      profissional: C.comLogin.profissional,
      usuario,
    });
    expect(adm.statusCode).toBe(200);
    const vinculo = adm.json().id as number;
    const v = (await pessoas.vinculo({ rede: '', hospital: 'aa' }, vinculo))!;
    const c = { rede: '', hospital: 'aa' };
    const regime = await escala.gravarSgh(c, {} as never, async (g) => {
      const r = await g.incluirRegime({
        codigo: '12x36',
        nome: 'Plantão 12 por 36',
        jornada: 2,
        contratoParcial: 0,
        folgaPadrao: null,
        minutosPlantao: 720,
        descansoMinimoMin: 2160,
        limiteSemanalHoras: 48,
        acordo: 'Convenção coletiva sintética',
        ativo: true,
        por: 'SINT.ESCALA',
      });
      await g.atribuirRegime({ vinculo, regime: r, desde: '2026-08-01', por: 'SINT.ESCALA' });
      const es = await g.incluirEscala({
        unidade: 1,
        setor: 'Posto 1',
        competencia: '2026-09',
        tipo: 'apoio',
        cobertura: { manha: 0, tarde: 0, noite: 0 },
        por: 'SINT.ESCALA',
      });
      for (const [inicio, fim] of [
        ['2026-09-02T07:00', '2026-09-02T19:00'],
        ['2026-09-04T07:00', '2026-09-04T19:00'],
        ['2026-09-08T19:00', '2026-09-09T07:00'],
        ['2026-09-10T07:00', '2026-09-10T19:00'],
      ] as const)
        await g.incluirPlantao({
          escala: es,
          vinculo,
          pessoa: v.pessoa,
          profissional: null,
          registro: null,
          tipo: 'presencial',
          inicio,
          fim,
          chegadaMin: null,
          alertaConselho: null,
          redeNaoConferida: false,
          motivo: null,
          por: 'SINT.ESCALA',
        });
      await g.publicarEscala({ id: es, versao: 0, justificativaFuro: null, por: 'SINT.ESCALA' });
      return r;
    });

    // A regra do banco do regime (quem edita regimes).
    const esc = pedir(await entrar('SINT.ESCALA'));
    const rb = await esc.post(`${P}/ponto/regras-banco`, {
      regime,
      destino: 2,
      inicio: 4,
      desde: '2026-09',
      cicloMeses: 6,
    });
    expect(rb.statusCode).toBe(200);
    expect(
      (
        await esc.post(`${P}/ponto/regras-banco`, {
          regime,
          destino: 2,
          inicio: 4,
          desde: '2026-09',
          cicloMeses: 6,
        })
      ).json().codigo,
    ).toBe('regra-existente');
    expect((await esc.get(`${P}/ponto/regras-banco`)).json().itens).toEqual([
      expect.objectContaining({ regime, destino: 2, inicio: 4, versao: 0 }),
    ]);

    // Importação: válido; o mesmo arquivo de novo é recusado; o com defeito fica inteiro em quarentena.
    const apoio = await rh.get(`${P}/ponto/apoio`);
    expect(apoio.statusCode).toBe(200);
    expect(apoio.json()).toMatchObject({
      competenciaPadrao: '2026-09',
      acoes: { importar: true, justificar: true, aprovar: false },
      biometria: { ligada: false },
    });
    const imp = await rh.post(`${P}/ponto/arquivos`, {
      nome: 'afd-setembro.txt',
      tipoRep: 'REP-C',
      conteudo: valido,
    });
    expect(imp.statusCode).toBe(200);
    expect(imp.json()).toMatchObject({ situacao: 'importado', novas: 7, jaImportadas: 0, semColaborador: 0 });
    expect(JSON.stringify(imp.json())).not.toContain(C.comLogin.cpf);
    const rep = await rh.post(`${P}/ponto/arquivos`, {
      nome: 'de novo.txt',
      tipoRep: 'REP-C',
      conteudo: valido,
    });
    expect(rep.statusCode).toBe(409);
    expect(rep.json().codigo).toBe('arquivo-ja-importado');
    const q = await rh.post(`${P}/ponto/arquivos`, {
      nome: 'quebrado.txt',
      tipoRep: 'REP-C',
      conteudo: quebrado,
    });
    expect(q.statusCode).toBe(200);
    expect(q.json()).toMatchObject({ situacao: 'quarentena', novas: 0, totalFalhas: 1 });
    expect(q.json().falhas).toEqual([expect.objectContaining({ codigo: 'sequencia-quebrada', linha: 3 })]);
    const lista = (await rh.get(`${P}/ponto/arquivos`)).json().itens;
    expect(lista.map((a: { situacao: string }) => a.situacao)).toEqual(['quarentena', 'importado']);
    expect((await rh.get(`${P}/ponto/arquivos/${lista[0].id}`)).json().falhas).toHaveLength(1);
    // O filtro da lista: a situação, o período coberto e a página (um por página: há a seguinte).
    const soQuarentena = (await rh.get(`${P}/ponto/arquivos?situacao=quarentena`)).json();
    expect(soQuarentena.itens.map((a: { nome: string }) => a.nome)).toEqual(['quebrado.txt']);
    const pag = (await rh.get(`${P}/ponto/arquivos?limite=1`)).json();
    expect(pag).toMatchObject({ pagina: 0, temMais: true });
    expect(pag.itens).toHaveLength(1);
    const pag2 = (await rh.get(`${P}/ponto/arquivos?limite=1&pagina=1`)).json();
    expect(pag2).toMatchObject({ pagina: 1, temMais: false });
    expect(pag2.itens[0].situacao).toBe('importado');
    expect((await rh.get(`${P}/ponto/arquivos?de=2027-01-01`)).json().itens).toEqual([]);
    expect((await rh.get(`${P}/ponto/arquivos?de=2026-09-10&ate=2026-09-01`)).statusCode).toBe(400);

    // O espelho aberto: a marcação ímpar do dia 5 e a falta do dia 10.
    let esp = (await rh.get(`${P}/ponto/espelho/${vinculo}/2026-09`)).json();
    expect(esp.estado).toBe('aberto');
    expect(esp.diasInconsistentes).toBe(1);
    const dia5 = esp.dias.find((d: { dia: string }) => d.dia === '2026-09-05');
    expect(dia5.inconsistencias[0].codigo).toBe('marcacao-impar');
    const solta = dia5.marcacoes[0].id as number;
    expect(esp.dias.find((d: { dia: string }) => d.dia === '2026-09-10').minutos).toEqual([
      expect.objectContaining({ classe: 7, minutos: 720 }),
    ]);
    expect(esp.acoes).toMatchObject({ justificar: true, aprovar: false, fechar: false });

    // Ajustes do RH (marcação a desconsiderar; atestado do dia 10); o RH não aprova.
    const a1 = await rh.post(`${P}/ponto/ajustes`, {
      vinculo,
      tipo: 'desconsiderar',
      dia: '2026-09-05',
      marcacao: solta,
      motivo: 'Batida por engano no dia de folga',
    });
    expect(a1.statusCode).toBe(200);
    const a2 = await rh.post(`${P}/ponto/ajustes`, {
      vinculo,
      tipo: 'justificativa',
      dia: '2026-09-10',
      movimento: 7,
      motivo: 'Atestado médico apresentado ao RH',
    });
    expect(a2.statusCode).toBe(200);
    const semInstante = await rh.post(`${P}/ponto/ajustes`, {
      vinculo,
      tipo: 'inclusao',
      dia: '2026-09-11',
      motivo: 'Esqueceu a batida de saída',
    });
    expect(semInstante.statusCode).toBe(400);
    expect(
      (await rh.post(`${P}/ponto/ajustes/${a1.json().id}/decisao`, { decisao: 'aprovar' })).statusCode,
    ).toBe(403);

    // A coordenação aprova os dois; o próprio pedido (de agosto) não.
    const co = pedir(await entrar('SINT.PONTO'));
    const fechaCedo = await co.post(`${P}/ponto/fechamento`, { vinculo, competencia: '2026-09' });
    expect(fechaCedo.json().codigo).toBe('ajustes-pendentes');
    for (const a of [a1, a2])
      expect(
        (await co.post(`${P}/ponto/ajustes/${a.json().id}/decisao`, { decisao: 'aprovar' })).statusCode,
      ).toBe(200);
    const proprio = await co.post(`${P}/ponto/ajustes`, {
      vinculo,
      tipo: 'justificativa',
      dia: '2026-08-20',
      movimento: 8,
      minutos: 30,
      motivo: 'Saída para consulta (teste)',
    });
    expect(proprio.statusCode).toBe(200);
    const autoaprova = await co.post(`${P}/ponto/ajustes/${proprio.json().id}/decisao`, {
      decisao: 'aprovar',
    });
    expect(autoaprova.json().codigo).toBe('aprovador-e-solicitante');
    expect(
      (await co.post(`${P}/ponto/ajustes/${proprio.json().id}/decisao`, { decisao: 'recusar' })).statusCode,
    ).toBe(400);

    // Fechamento: 720 + 700 + 720 trabalhadas (a variação tolerada do dia 2 não conta), 20 de atraso ao banco (−20), adicional noturno de 617 min.
    esp = (await co.get(`${P}/ponto/espelho/${vinculo}/2026-09`)).json();
    expect(esp.diasInconsistentes).toBe(0);
    expect(esp.acoes).toMatchObject({ fechar: true, aprovar: true });
    expect(esp.totais).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ classe: 1, minutos: 2140 }),
        expect.objectContaining({ classe: 2, minutos: 20 }),
        expect.objectContaining({ classe: 8, minutos: 720 }),
      ]),
    );
    expect(esp.parcelas[0]).toContain('720 + 700 + 720 = 2140');
    const f = await co.post(`${P}/ponto/fechamento`, { vinculo, competencia: '2026-09' });
    expect(f.statusCode).toBe(200);
    expect((await co.post(`${P}/ponto/fechamento`, { vinculo, competencia: '2026-09' })).json().codigo).toBe(
      'ja-fechado',
    );
    expect((await co.post(`${P}/ponto/fechamento`, { vinculo, competencia: '2026-10' })).json().codigo).toBe(
      'periodo-em-curso',
    );
    esp = (await co.get(`${P}/ponto/espelho/${vinculo}/2026-09`)).json();
    expect(esp).toMatchObject({ estado: 'fechado', versao: 1, ciencia: null });
    expect(esp.banco).toMatchObject({ debitoMin: 20, creditoMin: 0, saldoFinalMin: -20 });
    expect(esp.eventos.find((x: { codigo: number }) => x.codigo === 5).minutos).toBe(617);
    expect(esp.eventos.find((x: { codigo: number }) => x.codigo === 4).minutos).toBe(0);
    expect(ponto.eventos('aa').map((x) => x.tipo)).toEqual([
      'PESSOAS_AFD_IMPORTADO',
      'PESSOAS_PONTO_FECHADO',
    ]);
    expect(
      (
        await rh.post(`${P}/ponto/ajustes`, {
          vinculo,
          tipo: 'justificativa',
          dia: '2026-09-04',
          movimento: 8,
          minutos: 20,
          motivo: 'Atraso do transporte',
        })
      ).json().codigo,
    ).toBe('periodo-fechado');

    // Ciência: só o próprio colaborador, sobre o resumo que viu; uma vez.
    const colab = pedir(await entrar('SINT.COLAB'));
    const meu = (await colab.get(`${P}/ponto/meu`)).json();
    expect(meu.competencias).toEqual(['2026-09']);
    expect(meu.espelho).toMatchObject({ competencia: '2026-09', acoes: { ciencia: true } });
    expect((await colab.get(`${P}/ponto/espelho/${vinculo}/2026-09`)).statusCode).toBe(403);
    const porOutro = await rh.post(`${P}/ponto/meu/ciencia`, {
      vinculo,
      competencia: '2026-09',
      hash: meu.espelho.hash,
      concorda: true,
    });
    expect(porOutro.json().codigo).toBe('nao-e-o-proprio');
    const errado = await colab.post(`${P}/ponto/meu/ciencia`, {
      vinculo,
      competencia: '2026-09',
      hash: 'f'.repeat(64),
      concorda: true,
    });
    expect(errado.json().codigo).toBe('espelho-mudou');
    const ci = await colab.post(`${P}/ponto/meu/ciencia`, {
      vinculo,
      competencia: '2026-09',
      hash: meu.espelho.hash,
      concorda: false,
      observacao: 'O atraso do dia 4 foi do transporte fretado',
    });
    expect(ci.statusCode).toBe(200);
    expect(
      (
        await colab.post(`${P}/ponto/meu/ciencia`, {
          vinculo,
          competencia: '2026-09',
          hash: meu.espelho.hash,
          concorda: true,
        })
      ).json().codigo,
    ).toBe('ja-ciente');
    expect((await colab.get(`${P}/ponto/meu/pdf`)).statusCode).toBe(200);

    // AEJ e eventos para a folha (exportar); o RH não exporta.
    const aej = await co.get(`${P}/ponto/aej?competencia=2026-09`);
    expect(aej.statusCode).toBe(200);
    const linhas = aej.body.trim().split('\r\n');
    expect(linhas[0]).toMatch(/^01\|1\|00000000000191\|\|\|HOSPITAL SINTETICO\|2026-09-01\|2026-09-30\|/);
    expect(linhas.filter((l) => l.startsWith('05|'))).toHaveLength(7);
    expect(linhas.some((l) => l.startsWith(`03|${vinculo}|${C.comLogin.cpf}|`))).toBe(true);
    expect(linhas[linhas.length - 1]).toMatch(/^99\|1\|1\|1\|/);
    expect((await rh.get(`${P}/ponto/aej?competencia=2026-09`)).statusCode).toBe(403);
    expect((await co.get(`${P}/ponto/aej?competencia=2026-07`)).json().codigo).toBe('sem-fechamento');
    const csv = await co.get(`${P}/ponto/eventos-folha?competencia=2026-09`);
    expect(csv.body).toContain(`${vinculo};PONTO-1;2026-09;5;617`);
    expect(csv.body).not.toContain(C.comLogin.cpf);
    expect((await co.get(`${P}/ponto/espelho/${vinculo}/2026-09/pdf`)).statusCode).toBe(200);

    // Painel do período.
    const painel = (await co.get(`${P}/ponto/painel?competencia=2026-09`)).json();
    expect(painel.contagens).toMatchObject({ fechados: 1, semCiencia: 0 });
    expect(painel.itens[0]).toMatchObject({
      vinculo,
      estado: 'fechado',
      ciencia: true,
      saldoBancoMin: -20,
      marcacoes: 7,
    });
    expect((await co.get(`${P}/ponto/painel?competencia=2026-09&situacao=abertos`)).json().itens).toEqual([]);

    // Acerto do banco no período aberto; reabertura com o estorno (o saldo volta).
    expect(
      (
        await co.post(`${P}/ponto/banco/acerto`, {
          vinculo,
          competencia: '2026-09',
          minutos: 30,
          motivo: 'Saldo inicial do banco',
        })
      ).json().codigo,
    ).toBe('periodo-fechado');
    const rea = await co.post(`${P}/ponto/reabertura`, {
      vinculo,
      competencia: '2026-09',
      motivo: 'Discordância do colaborador sobre o dia 4',
    });
    expect(rea.statusCode).toBe(200);
    esp = (await co.get(`${P}/ponto/espelho/${vinculo}/2026-09`)).json();
    expect(esp).toMatchObject({ estado: 'aberto', ciencia: null, versao: 1 });
    expect((await co.get(`${P}/ponto/painel?competencia=2026-09`)).json().itens[0].saldoBancoMin).toBe(0);
    expect(
      (
        await co.post(`${P}/ponto/banco/acerto`, {
          vinculo,
          competencia: '2026-09',
          minutos: 30,
          motivo: 'Saldo inicial do banco',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await co.post(`${P}/ponto/reabertura`, {
          vinculo,
          competencia: '2026-09',
          motivo: 'De novo sem fechamento',
        })
      ).json().codigo,
    ).toBe('nao-fechado');

    // Quem não tem o ponto não vê.
    const consulta = pedir(await entrar('SINT.RH.CONSULTA'));
    expect((await consulta.get(`${P}/ponto/apoio`)).statusCode).toBe(403);
    expect((await consulta.get(`${P}/ponto/espelho/${vinculo}/2026-09`)).statusCode).toBe(403);
  });
});
