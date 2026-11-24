// M31 (TISS, competência, demonstrativos, glosa e recurso) pela HTTP, com a sessão real sobre a fonte sintética e a
// porta EM MEMÓRIA (nada conecta a banco): permissões pelas opções do perfil (403 sem elas), liberação (POL-3), o lote
// 04.03.00 validado no XSD e guardado (numeração do contador), o envio ao simulador fora de produção, o protocolo que
// congela o lote, a competência, o demonstrativo digitado e o XML (idempotentes), a baixa, a decisão, o recurso e o
// desfecho, o painel com as duas réguas e os textos de produto. Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demonstrativoSinteticoXml } from '@sgh/dominio-faturamento';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { moduloConfiguracaoDeTeste } from '../cadastro/teste.spec-util.js';
import { modulo } from './modulo.js';
import { PortaTissMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'configuracao_teste,tiss' };
const trilha = new RegistradorTrilhaMemoria();
const tiss = new PortaTissMemoria({ estado: () => 'verde' });
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      configuracao_teste: async () => ({ modulo: (ctx) => moduloConfiguracaoDeTeste(ctx) }),
      tiss: async () => ({ modulo: (ctx) => modulo(ctx, { porta: tiss, armazem: tiss.armazem }) }),
    },
  });
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
  expect(r.statusCode).toBe(201);
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
  'idempotency-key': `teste-m31-${++chave}-${Date.now()}`,
});
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `/api${url}`, headers: h(s), payload: payload as object });

const SISTEMA_ANTIGO = /SPDATA|legado|sistema antigo/i;
const V0 = '2026-10-23T00:00:00.001Z';

describe('pós-fechamento pela HTTP (memória)', () => {
  it('sem as opções da remessa e da glosa, 403; o supervisor vê as funcionalidades ligadas e o destino do envio', async () => {
    const outra = await entrar('SINT.AGENDA');
    expect((await get(outra, '/tiss/lotes')).statusCode).toBe(403);
    expect((await get(outra, '/tiss/glosas')).statusCode).toBe(403);
    const s = await entrar('SINT.TISS');
    const g = (await get(s, '/tiss/gravacao')).json();
    expect(g.funcionalidades.lote.ligada).toBe(true);
    expect(g.operacoes['faturamento.gerarLote'].ligada).toBe(true);
    expect(g.operacoes['faturamento.registrarProtocolo'].ligada).toBe(true);
    expect(g.destinoEnvio).toBe('simulador');
    const a = (await get(s, '/tiss/apoio')).json();
    expect(a.versao).toBe('04.03.00');
    expect(a.situacoesProtocolo).toHaveLength(10);
  });

  it('lote 04.03.00: contas prontas, XSD válido e guardado, contador, envio ao simulador, protocolo congela', async () => {
    const s = await entrar('SINT.TISS');
    const prontas = (await get(s, '/tiss/lotes/contas-prontas?convenio=91&tipoGuia=2')).json();
    expect(prontas.map((c: { conta: number }) => c.conta)).toEqual(expect.arrayContaining([9101, 9102]));
    expect(prontas.every((c: { beneficiario: string }) => c.beneficiario.startsWith('••••'))).toBe(true);
    // Tipo de guia que a conta não aceita: recusado (a 9103 é de internação).
    const errado = await post(s, '/tiss/lotes', {
      convenio: 91,
      tipoGuia: 2,
      contas: [{ id: 9103, versao: '2026-10-23T00:00:00.001Z' }],
    });
    expect(errado.statusCode).toBe(409);
    expect(errado.json().codigo).toBe('tipo-guia-incompativel');
    const r = await post(s, '/tiss/lotes', {
      convenio: 91,
      tipoGuia: 2,
      contas: prontas
        .filter((c: { conta: number }) => c.conta === 9101)
        .map((c: { conta: number; versao: string }) => ({ id: c.conta, versao: c.versao })),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().mensagem).toMatch(/04\.03\.00/);
    const lote = r.json().ids.lote as number;
    expect(r.json().ids.numeroLote).toBe('000000000042');
    expect(tiss.armazem.objetos.size).toBe(1);
    const d = (await get(s, `/tiss/lotes/${lote}`)).json();
    expect(d.xml.versao).toBe('04.03.00');
    expect(d.xml.hashArquivo).toMatch(/^[0-9a-f]{64}$/);
    expect(d.inferida).toBe(false);
    expect(d.contasDoLote).toHaveLength(1);
    const env = await post(s, `/tiss/lotes/${lote}/envio`);
    expect(env.statusCode).toBe(200);
    expect(env.json().resposta.protocolo).toMatch(/^SIM/);
    const p = await post(s, `/tiss/lotes/${lote}/protocolo`, {
      acao: 'registrar',
      protocolo: ` ${env.json().resposta.protocolo}\r\n`,
      data: '2026-10-20',
      recibo: env.json().resposta.recibo,
      situacao: 1,
    });
    expect(p.statusCode).toBe(200);
    expect(p.json().avisos.join(' ')).toMatch(/quebras de linha/);
    const d2 = (await get(s, `/tiss/lotes/${lote}`)).json();
    expect(d2.congelado).toBe(true);
    expect(d2.historico[0]).toMatchObject({ acao: 'registrado', situacaoNome: 'RECEBIDO' });
    expect(d2.mensagens.map((m: { destino: string }) => m.destino)).toEqual(['simulador', 'simulador']);
    // O lote antigo do outro sistema: situação inferida e sem XML do novo (o envio é recusado).
    const lista = (await get(s, '/tiss/lotes')).json();
    const antigo = lista.itens.find((l: { id: number }) => l.id === 8001);
    expect(antigo.inferida).toBe(true);
    expect((await post(s, '/tiss/lotes/8001/envio')).json().codigo).toBe('lote-sem-xml');
    expect(JSON.stringify(lista)).not.toMatch(SISTEMA_ANTIGO);
  });

  it('competência: fecha, recusa a segunda vez e a futura', async () => {
    const s = await entrar('SINT.TISS');
    const hoje = (await get(s, '/tiss/apoio')).json().hoje as string;
    const [ano, mes] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
    const r = await post(s, '/tiss/competencias', { convenio: 92, ano, mes });
    expect(r.statusCode).toBe(200);
    expect((await post(s, '/tiss/competencias', { convenio: 92, ano, mes })).json().codigo).toBe(
      'ja-fechada',
    );
    expect((await post(s, '/tiss/competencias', { convenio: 92, ano: ano + 1, mes })).json().codigo).toBe(
      'competencia-futura',
    );
    const l = (await get(s, '/tiss/competencias?convenio=92')).json();
    expect(l[0]).toMatchObject({ convenio: 92, ano, mes, fechada: true, fechadaPor: 'SINT.TISS' });
  });

  it('competência: reabre com motivo (curto recusa na entrada), reabrir a aberta recusa, fecha de novo', async () => {
    const s = await entrar('SINT.TISS');
    const hoje = (await get(s, '/tiss/apoio')).json().hoje as string;
    const [ano, mes] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
    await post(s, '/tiss/competencias', { convenio: 92, ano, mes });
    expect(
      (await post(s, '/tiss/competencias/reabrir', { convenio: 92, ano, mes, motivo: 'x' })).statusCode,
    ).toBe(400);
    const r = await post(s, '/tiss/competencias/reabrir', {
      convenio: 92,
      ano,
      mes,
      motivo: 'conta esquecida',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().mensagem).toContain('reaberta');
    expect(
      (
        await post(s, '/tiss/competencias/reabrir', { convenio: 92, ano, mes, motivo: 'de novo, sem fechar' })
      ).json().codigo,
    ).toBe('competencia-aberta');
    expect((await post(s, '/tiss/competencias', { convenio: 92, ano, mes })).statusCode).toBe(200);
    const leitor = await entrar('SINT.TISS.LEITOR');
    expect(
      (
        await post(leitor, '/tiss/competencias/reabrir', {
          convenio: 92,
          ano,
          mes,
          motivo: 'sem a permissão',
        })
      ).statusCode,
    ).toBe(403);
  });

  it('glosa: demonstrativo (XML e digitação, idempotente), baixa, decisão, recurso com alerta e desfecho parcial', async () => {
    const s = await entrar('SINT.TISS');
    const hoje = (await get(s, '/tiss/apoio')).json().hoje as string;
    const itens = (await get(s, '/tiss/glosas/contas/9201')).json();
    const nao = itens.find((i: { estado: string }) => i.estado === 'nao-conciliado');
    expect(nao.sequencial).toBe(3);
    const xml = demonstrativoSinteticoXml({
      numero: 'DEM-T-1',
      dataEmissao: hoje,
      numeroLote: '40',
      protocolo: 'P00000000040',
      guias: [
        {
          numeroGuia: '59201',
          itens: [
            { sequencial: 3, codigo: '10102019', informado: 90, liberado: 50, quantidade: 1, motivo: 1705 },
          ],
        },
      ],
    });
    const imp = await post(s, '/tiss/demonstrativos', {
      lote: 8002,
      tipo: 'analise',
      numero: 'x',
      dataEmissao: hoje,
      xml,
    });
    expect(imp.statusCode).toBe(200);
    expect(imp.json().ids).toMatchObject({ casados: 1, semCasamento: 0 });
    const rep = await post(s, '/tiss/demonstrativos', {
      lote: 8002,
      tipo: 'analise',
      numero: 'x',
      dataEmissao: hoje,
      xml,
    });
    expect(rep.json().repetida).toBe(true);
    const dem = (await get(s, `/tiss/demonstrativos/${imp.json().ids.demonstrativo}`)).json();
    const casado = dem.itens[0];
    // Glosa com motivo 0: não fecha a conciliação.
    const zero = await post(s, '/tiss/glosas/baixa', {
      itens: [{ item: casado.item, versao: casado.versaoItem, valorPago: 50, quantidadePaga: 1, motivo: 0 }],
      dataPagamento: hoje,
    });
    expect(zero.json().codigo).toBe('motivo-zero');
    const baixa = await post(s, '/tiss/glosas/baixa', {
      itens: [
        { item: casado.item, versao: casado.versaoItem, valorPago: 50, quantidadePaga: 1, motivo: 1705 },
      ],
      dataPagamento: hoje,
      demonstrativo: imp.json().ids.demonstrativo,
    });
    expect(baixa.statusCode).toBe(200);
    // Decidir recorrer (justificativa) e recorrer; o item com motivo sem reapresentação gera alerta.
    const dec = await post(s, '/tiss/glosas/decisao', {
      item: casado.item,
      decisao: 'recorrer',
      texto: 'Procedimento realizado conforme prescrição',
      evidencia: 'Evolução médica do dia do atendimento',
    });
    expect(dec.statusCode).toBe(200);
    const depois = (await get(s, '/tiss/glosas/contas/9201')).json();
    const alvo = depois.find((i: { item: number }) => i.item === casado.item);
    const rec = await post(s, '/tiss/glosas/recurso', {
      itens: [{ item: alvo.item, versao: alvo.versao }],
      dataProtocolo: hoje,
    });
    expect(rec.statusCode).toBe(200);
    const pend = depois.find((i: { estado: string; motivo: number }) => i.estado === 'pendente');
    expect(pend.alertaPrazo).toBe('prazo não cadastrado');
    // O item com recurso desde a carga: desfecho parcial com o demonstrativo; data anterior recusada.
    const emRec = depois.find(
      (i: { estado: string; item: number }) => i.estado === 'recorrida' && i.item !== casado.item,
    );
    const ant = await post(s, '/tiss/glosas/desfecho', {
      itens: [{ item: emRec.item, versao: emRec.versao, desfecho: 'acatado' }],
      data: '2000-01-01',
      numeroDemonstrativo: 'DEM-R-1',
    });
    expect(ant.json().codigo).toBe('data-anterior-ao-recurso');
    const parc = await post(s, '/tiss/glosas/desfecho', {
      itens: [{ item: emRec.item, versao: emRec.versao, desfecho: 'parcial', valor: 80 }],
      data: hoje,
      numeroDemonstrativo: 'DEM-R-1',
    });
    expect(parc.statusCode).toBe(200);
    const fim = (await get(s, '/tiss/glosas/contas/9201')).json();
    expect(fim.find((i: { item: number }) => i.item === emRec.item)).toMatchObject({
      estado: 'encerrada',
      desfecho: 'parcial',
    });
    // A evidência do prontuário: a grade só diz que existe; o conteúdo sai pela leitura auditada (glosa.decidir).
    const naGrade = fim.find((i: { item: number }) => i.item === casado.item);
    expect(naGrade.decisao.temEvidencia).toBe(true);
    expect(JSON.stringify(fim)).not.toContain('Evolução médica do dia do atendimento');
    const antes = trilha.eventos.filter((e) => e.evento === 'faturamento.evidencia.lida').length;
    const ev = await get(s, `/tiss/glosas/itens/${casado.item}/evidencia`);
    expect(ev.statusCode).toBe(200);
    expect(ev.json()).toMatchObject({
      item: casado.item,
      evidencia: 'Evolução médica do dia do atendimento',
      decididoPor: 'SINT.TISS',
    });
    const lidas = trilha.eventos.filter((e) => e.evento === 'faturamento.evidencia.lida');
    expect(lidas).toHaveLength(antes + 1);
    expect(lidas.at(-1)).toMatchObject({ tabelaAlvo: 'glosa_item', idAlvo: String(casado.item) });
    // Quem só consulta a glosa vê a grade, mas não a evidência.
    const leitor = await entrar('SINT.TISS.LEITOR');
    expect((await get(leitor, '/tiss/glosas/contas/9201')).statusCode).toBe(200);
    expect((await get(leitor, `/tiss/glosas/itens/${casado.item}/evidencia`)).statusCode).toBe(403);
    // O item sem evidência registrada: 404 com o código, nunca o texto da justificativa no lugar.
    const sem = await get(s, `/tiss/glosas/itens/${emRec.item}/evidencia`);
    expect(sem.statusCode).toBe(404);
    expect(sem.json().codigo).toBe('sem-evidencia');
  });

  it('painel: duas réguas, êxito, faixas e a régua declarada; exportação em CSV', async () => {
    const s = await entrar('SINT.TISS');
    const hoje = (await get(s, '/tiss/apoio')).json().hoje as string;
    const p = (await get(s, `/tiss/painel?de=${hoje.slice(0, 4)}-01&ate=${hoje.slice(0, 7)}`)).json();
    expect(p.regua).toBe('competencia');
    expect(p.somas.glosaLiquida).toBeGreaterThan(0);
    expect(p.somas.glosaPositiva).toBeGreaterThanOrEqual(p.somas.glosaLiquida);
    expect(p.indicadores.exitoRotulo).toMatch(/%|não recorreu/);
    const csv = await get(s, `/tiss/painel/exportacao?de=${hoje.slice(0, 4)}-01&ate=${hoje.slice(0, 7)}`);
    expect(csv.statusCode).toBe(200);
    expect(csv.body).toMatch(/Régua;competência/);
  });

  it('escopo por convênio (anti-IDOR): o faturador do convênio 92 não lê nem grava nada do 91', async () => {
    const s = await entrar('SINT.TISS.ESCOPO');
    const hoje = (await get(s, '/tiss/apoio')).json().hoje as string;
    const fora = async (r: Promise<{ statusCode: number; json: () => { codigo?: string } }>) => {
      const x = await r;
      expect(x.statusCode).toBe(403);
      expect(x.json().codigo).toBe('fora-do-escopo');
    };
    // Leituras por id de alvos do convênio 91.
    await fora(get(s, '/tiss/lotes/8002'));
    await fora(get(s, '/tiss/glosas/contas/9201'));
    await fora(get(s, '/tiss/guias/9101/impressao'));
    await fora(get(s, '/tiss/glosas/itens/70001/evidencia'));
    // Gravações com convênio, lote, conta ou item do 91.
    await fora(post(s, '/tiss/lotes', { convenio: 91, tipoGuia: 2, contas: [{ id: 9102, versao: V0 }] }));
    await fora(post(s, '/tiss/lotes/8002/protocolo', { acao: 'registrar', protocolo: 'P1', data: hoje }));
    await fora(post(s, '/tiss/competencias', { convenio: 91, ano: 2020, mes: 1 }));
    await fora(
      post(s, '/tiss/glosas/baixa', {
        itens: [{ item: 70001, versao: V0, valorPago: 1, quantidadePaga: 1, motivo: 1705 }],
        dataPagamento: hoje,
      }),
    );
    await fora(
      post(s, '/tiss/glosas/decisao', { item: 70001, decisao: 'aceitar', texto: 'Motivo sintético' }),
    );
    await fora(
      post(s, '/tiss/glosas/recurso', { itens: [{ item: 70002, versao: V0 }], dataProtocolo: hoje }),
    );
    await fora(
      post(s, '/tiss/demonstrativos', {
        lote: 8002,
        tipo: 'analise',
        numero: 'DEM-ESC',
        dataEmissao: hoje,
        itens: [],
      }),
    );
    // As listas não trazem linhas do 91, nem pedindo ?convenio=91.
    const comp = hoje.slice(0, 7);
    for (const url of [
      '/tiss/lotes',
      '/tiss/lotes?convenio=91',
      '/tiss/guias',
      '/tiss/guias?convenio=91',
      `/tiss/glosas?competencia=${comp}&estado=todas`,
      `/tiss/glosas?competencia=${comp}&estado=todas&convenio=91`,
      '/tiss/competencias',
      '/tiss/competencias?convenio=91',
      '/tiss/demonstrativos',
      '/tiss/prazos',
    ]) {
      const r = await get(s, url);
      expect(r.statusCode, url).toBe(200);
      expect(r.body, url).not.toMatch(/"convenio":91\b/);
    }
    const p = (await get(s, `/tiss/painel?de=${hoje.slice(0, 4)}-01&ate=${comp}`)).json();
    expect(p.somas.glosaPositiva).toBe(0);
    // O mesmo usuário sem restrição vê as linhas do 91 (o filtro é do escopo, não da rota).
    const livre = await entrar('SINT.TISS');
    expect((await get(livre, '/tiss/lotes')).body).toMatch(/"convenio":91\b/);
  });

  it('regra 9: a conta de competência fechada para o convênio não entra em lote (nada gravado)', async () => {
    const s = await entrar('SINT.TISS');
    const prontas = (await get(s, '/tiss/lotes/contas-prontas?convenio=91&tipoGuia=2')).json();
    const c = prontas.find((x: { conta: number }) => x.conta === 9102);
    expect(c).toBeTruthy();
    const hoje = (await get(s, '/tiss/apoio')).json().hoje as string;
    const [ano, mes] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
    const anterior = mes === 1 ? { ano: ano - 1, mes: 12 } : { ano, mes: mes - 1 };
    expect((await post(s, '/tiss/competencias', { convenio: 91, ...anterior })).statusCode).toBe(200);
    const lotes = (await get(s, '/tiss/lotes')).json().itens.length;
    const objetos = tiss.armazem.objetos.size;
    const r = await post(s, '/tiss/lotes', {
      convenio: 91,
      tipoGuia: 2,
      contas: [{ id: c.conta, versao: c.versao }],
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().codigo).toBe('competencia-fechada');
    expect((await get(s, '/tiss/lotes')).json().itens).toHaveLength(lotes);
    expect(tiss.armazem.objetos.size).toBe(objetos);
  });

  it('webservices: configuração sem credencial, endpoint com referência ao cofre (URL e cofre validados)', async () => {
    const s = await entrar('SINT.TISS');
    const c = (await get(s, '/tiss/configuracao')).json();
    expect(c.versaoGerada).toBe('04.03.00');
    expect(JSON.stringify(c)).not.toMatch(/senha|login|certificado/i);
    const ruim = await post(s, '/tiss/endpoints', {
      convenio: 91,
      transacao: 'ENVIO_LOTE_GUIAS',
      url: 'https://operadora.exemplo/tiss',
      referenciaCofre: 'senha123',
      ativo: true,
    });
    expect(ruim.statusCode).toBe(400);
    const ok = await post(s, '/tiss/endpoints', {
      convenio: 91,
      transacao: 'ENVIO_LOTE_GUIAS',
      url: 'https://operadora.exemplo/tiss',
      referenciaCofre: 'cofre:operadoras/91/tiss',
      ativo: false,
    });
    expect(ok.statusCode).toBe(200);
    expect((await get(s, '/tiss/configuracao')).json().endpoints).toHaveLength(1);
  });
});
