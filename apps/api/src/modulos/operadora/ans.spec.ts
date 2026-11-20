// M56 (etapa 7, F6) pela HTTP, com a sessão real sobre a fonte sintética e as portas EM MEMÓRIA (nada conecta a banco;
// dados SINTÉTICOS): os envios à ANS nascem desligados (o apoio diz o motivo; o resto dá 403 recurso-desligado);
// ligados, o ciclo: a carteira da F1 → a pendência do SIB sem endereço → o complemento → a prévia e a geração do SIB
// com o SHA-256 → o arquivo → a transmissão ao simulador (sem recibo) → outro SIB recusado enquanto aguarda o retorno →
// o retorno simulado com o CCO → nada mais a enviar; a TPS do trimestre com a GRU; o DIOPS sem balancete, desequilibrado
// e certo; o SIP com os expostos; o monitoramento sem guias; o ressarcimento ao SUS (a análise de cada atendimento, a
// decisão, o protocolo do dossiê, o retorno e a GRU) → a lista e as contagens → quem não pode.
import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { cnpjSintetico, cpfSintetico } from '@sgh/dominio-operadora';
import type { ChaveGravada, PrerequisitoGravado } from '@sgh/legado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../app.js';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../configuracao.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import { fonteConfiguracaoMemoria } from '../config/public-api.js';
import { PortaAnsOperadoraMemoria } from './ans-porta-memoria.js';
import { PortaCobrancaOperadoraMemoria } from './cobranca-porta-memoria.js';
import { PortaOperadoraMemoria } from './porta-memoria.js';

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
  alteradoEm: '2026-10-24T10:00:00',
});
const pre = (recurso: string, tipo: PrerequisitoGravado['tipo']): PrerequisitoGravado => ({
  recurso,
  tipo,
  situacao: 'cumprido',
  validade: null,
  evidencia: 'sintético',
  alteradoPor: 'SINT.ADMIN',
  alteradoEm: '2026-10-24T10:00:00',
});

const trilha = new RegistradorTrilhaMemoria();
const operadora = new PortaOperadoraMemoria(trilha);
const cobranca = new PortaCobrancaOperadoraMemoria(operadora);
const ans = new PortaAnsOperadoraMemoria(operadora, cobranca, null);
ans.agora = () => '2026-10-26T10:00:00';
let ligado: NestFastifyApplication;
let desligado: NestFastifyApplication;

beforeAll(async () => {
  ligado = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    operadora,
    cobrancaOperadora: cobranca,
    ansOperadora: ans,
    configuracao: fonteConfiguracaoMemoria(trilha, {
      chavesIniciais: () => [chave('operadora'), chave('operadora.beneficiarios'), chave('operadora.ans')],
      prerequisitosIniciais: () => [
        pre('operadora', 'credenciamento'),
        pre('operadora.ans', 'certificado'),
        pre('operadora.ans', 'aprovacao'),
      ],
    }),
  });
  desligado = await criarApp(lerConfiguracao(env), null, env, {});
  for (const a of [ligado, desligado]) {
    await a.init();
    await a.getHttpAdapter().getInstance().ready();
  }
}, 60_000);
afterAll(async () => {
  await ligado.close();
  await desligado.close();
});

interface Sessao {
  cookie: string;
  csrf: string;
}
let n = 0;
async function entrar(app: NestFastifyApplication, login: string): Promise<Sessao> {
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
const pedir = (app: NestFastifyApplication, s: Sessao) => {
  const h = () => ({ cookie: s.cookie, 'x-csrf': s.csrf, 'idempotency-key': `m56-7-${++n}-${Date.now()}` });
  return {
    get: (url: string) => app.inject({ method: 'GET', url, headers: { cookie: s.cookie } }),
    post: (url: string, payload: unknown) =>
      app.inject({ method: 'POST', url, payload: payload as object, headers: h() }),
    put: (url: string, payload: unknown) =>
      app.inject({ method: 'PUT', url, payload: payload as object, headers: h() }),
  };
};
const O = '/api/operadora';
const A = `${O}/ans`;
const REGISTRO = '900007';

const COMPLEMENTO = {
  versao: 0,
  logradouro: 'Rua Sintética',
  numero: '10',
  complemento: null,
  bairro: 'Centro',
  municipio: 4205407,
  cep: '88000000',
  resideExterior: false,
  dnv: null,
  coberturaParcial: false,
  itensExcluidos: false,
  cco: null,
  motivoCancelamento: null,
};

describe('envios à ANS (F6) pela HTTP', () => {
  it('desligados: o apoio diz o motivo e o resto dá 403', async () => {
    const adm = pedir(desligado, await entrar(desligado, 'SINT.ADMIN'));
    expect((await adm.get(`${A}/apoio`)).statusCode).toBe(403);
    const g = pedir(desligado, await entrar(desligado, 'SINT.OPERADORA'));
    const apoio = await g.get(`${A}/apoio`);
    expect(apoio.statusCode, apoio.body).toBe(200);
    expect(apoio.json().situacao.vale).toBe(false);
    expect(apoio.json().destino).toBe('simulador');
    const lista = await g.get(`${A}/envios`);
    expect(lista.statusCode).toBe(403);
    expect(lista.json().codigo).toBe('recurso-desligado');
  });

  it('o ciclo: SIB, TPS, DIOPS, SIP, monitoramento e ressarcimento ao SUS', async () => {
    const g = pedir(ligado, await entrar(ligado, 'SINT.OPERADORA'));
    const apoio = (await g.get(`${A}/apoio`)).json();
    expect(apoio.situacao).toEqual({ vale: true, motivo: null });
    expect(apoio.motivosSib).toHaveLength(12);
    expect(apoio.camposSib).toHaveLength(19);
    expect(apoio.valoresTps.at(-1).valorTrimestral).toBe(1.3475);
    expect(apoio.obrigacoes.map((o: { codigo: string }) => o.codigo)).toContain('RESSARCIMENTO_SUS');

    // A carteira sintética da F1.
    const ope = (
      await g.post(`${O}/empresas`, {
        registroAns: REGISTRO,
        cnpj: cnpjSintetico('900000070001'),
        razaoSocial: 'Operadora Sintética F6',
        modalidade: 'medicinaGrupo',
      })
    ).json().id as number;
    const prod = await g.post(`${O}/produtos`, {
      operadora: ope,
      codigo: 'F6',
      nome: 'Plano sintético F6',
      natureza: 'plano',
      registroAns: '900000071',
      tipoContratacao: 1,
      segmentacao: 'ambulatorial',
      abrangencia: 'estadual',
      acomodacao: null,
      coparticipacao: { tipo: 1, valor: null },
      carencias: { urgencia: 1, partos: 300, demais: 180, cpt: 0 },
      precos: [100, 120, 130, 140, 150, 170, 200, 240, 300, 400],
    });
    expect(prod.statusCode, prod.body).toBe(201);
    const ctr = await g.post(`${O}/contratos`, {
      produto: prod.json().id,
      numero: 'F6-0001',
      tipo: 1,
      contratanteNome: 'Contratante Sintético F6',
      contratanteDocumento: cpfSintetico('900000071'),
      formaReajuste: 1,
      mesReajuste: 5,
      tipoVigencia: 2,
      inicio: '2026-01-01',
    });
    expect(ctr.statusCode, ctr.body).toBe(201);
    const ben = await g.post(`${O}/beneficiarios`, {
      contrato: ctr.json().id,
      vinculo: 1,
      nome: 'Beneficiário Sintético ANS',
      cpf: cpfSintetico('900000072'),
      nascimento: '1975-03-10',
      sexo: 'F',
      nomeMae: 'Mãe Sintética',
      inclusao: '2026-07-15',
    });
    expect(ben.statusCode, ben.body).toBe(201);
    const bid = ben.json().id as number;
    const carteira = ben.json().carteirinha as string;

    // SIB: a competência ainda aberta e a futura são recusadas na prévia.
    const aberta = (
      await g.post(`${A}/previa`, { operadora: ope, obrigacao: 'SIB', competencia: '2026-10' })
    ).json();
    expect(aberta.problemas.map((p: { codigo: string }) => p.codigo)).toEqual(['competencia-futura']);
    expect(
      (await g.post(`${A}/previa`, { operadora: ope, obrigacao: 'SIB', competencia: '2026-T3' })).json()
        .podeGerar,
    ).toBe(false);
    // Sem endereço: o beneficiário fica pendente e o arquivo não tem movimento.
    const sem = (
      await g.post(`${A}/previa`, { operadora: ope, obrigacao: 'SIB', competencia: '2026-09' })
    ).json();
    expect(sem.podeGerar).toBe(false);
    expect(sem.problemas.map((p: { codigo: string }) => p.codigo)).toEqual([
      'sem-endereco',
      'sem-movimentos',
    ]);
    const pend = await g.get(`${A}/sib/pendencias?operadora=${ope}`);
    expect(pend.json().itens[0]).toMatchObject({ beneficiario: bid, movimento: 'inclusao' });
    // O complemento: município inválido recusado; certo, gravado.
    expect(
      (await g.put(`${A}/sib/beneficiarios/${bid}`, { ...COMPLEMENTO, municipio: 1000000 })).statusCode,
    ).toBe(409);
    const comp = await g.put(`${A}/sib/beneficiarios/${bid}`, COMPLEMENTO);
    expect(comp.statusCode, comp.body).toBe(200);
    expect(comp.json()).toMatchObject({ versao: 1, municipio: 4205407, cco: null });
    expect((await g.put(`${A}/sib/beneficiarios/${bid}`, COMPLEMENTO)).statusCode).toBe(409);
    expect((await g.get(`${A}/sib/beneficiarios/999999`)).statusCode).toBe(404);

    const previa = (
      await g.post(`${A}/previa`, { operadora: ope, obrigacao: 'SIB', competencia: '2026-09' })
    ).json();
    expect(previa).toMatchObject({ podeGerar: true, registros: 1, destino: 'simulador' });
    const gerado = await g.post(`${A}/envios`, { operadora: ope, obrigacao: 'SIB', competencia: '2026-09' });
    expect(gerado.statusCode, gerado.body).toBe(200);
    const sib = gerado.json().id as number;
    const ficha = (await g.get(`${A}/envios/${sib}`)).json();
    expect(ficha).toMatchObject({
      situacao: 'gerado',
      sequencial: 1,
      registros: 1,
      acoes: ['baixar', 'transmitir'],
    });
    expect(ficha.itens[0]).toMatchObject({ tipo: 'inclusao', referencia: carteira });
    const arq = (await g.get(`${A}/envios/${sib}/arquivo`)).json();
    const xml = Buffer.from(arq.base64, 'base64');
    expect(createHash('sha256').update(xml).digest('hex')).toBe(arq.sha256);
    expect(arq.nome).toBe(`SIB_${REGISTRO}_202609_001.xml`);
    expect(xml.toString('utf8')).toContain('<numeroPlanoANS>900000071</numeroPlanoANS>');

    // Fora de produção não há recibo.
    expect((await g.post(`${A}/envios/${sib}/envio`, { versao: 1, recibo: 'R1' })).json().codigo).toBe(
      'recibo-no-simulador',
    );
    const env1 = await g.post(`${A}/envios/${sib}/envio`, { versao: 1 });
    expect(env1.statusCode, env1.body).toBe(200);
    expect(env1.json().situacao).toBe('enviado');
    // Enquanto o SIB enviado não tem retorno, outro SIB não sai.
    const bloq = (
      await g.post(`${A}/previa`, { operadora: ope, obrigacao: 'SIB', competencia: '2026-09' })
    ).json();
    expect(bloq.problemas.map((p: { codigo: string }) => p.codigo)).toEqual(['aguardando-retorno']);
    expect((await g.post(`${A}/envios/${sib}/retorno`, { versao: 1, simular: true })).json().codigo).toBe(
      'envio-desatualizado',
    );
    const ret = await g.post(`${A}/envios/${sib}/retorno`, { versao: 2, simular: true });
    expect(ret.statusCode, ret.body).toBe(200);
    expect(ret.json().situacao).toBe('aceito');
    const aceito = (await g.get(`${A}/sib/beneficiarios/${bid}`)).json();
    expect(aceito.cco).toMatch(/^99\d{10}$/);
    expect(aceito.aceitoEm).toBe('2026-10-26T10:00:00');
    const nada = (
      await g.post(`${A}/previa`, { operadora: ope, obrigacao: 'SIB', competencia: '2026-09' })
    ).json();
    expect(nada.problemas.map((p: { codigo: string }) => p.codigo)).toEqual(['sem-movimentos']);
    expect(
      (
        await g.post(`${A}/envios/${sib}/pagamento`, {
          versao: 3,
          gru: '1234567890',
          valor: 1,
          data: '2026-10-26',
        })
      ).json().codigo,
    ).toBe('sem-gru');

    // TPS do 3º trimestre: o beneficiário ativo no fim de julho, de agosto e de setembro (incluído em 15/07).
    const tps = (
      await g.post(`${A}/previa`, { operadora: ope, obrigacao: 'TPS', competencia: '2026-T3' })
    ).json();
    expect(tps.podeGerar).toBe(true);
    expect(tps.quadros[0].parcelas[0].rotulo).toContain('(1 + 1 + 1 ÷ 3) × R$ 1,3475');
    expect(tps.quadros[0].total.valor).toBe(1.35);
    const t = (
      await g.post(`${A}/envios`, { operadora: ope, obrigacao: 'TPS', competencia: '2026-T3' })
    ).json().id;
    expect(
      (
        await g.post(`${A}/envios/${t}/pagamento`, {
          versao: 1,
          gru: '1234567890',
          valor: 1.35,
          data: '2026-10-26',
        })
      ).json().codigo,
    ).toBe('gru-antes-do-aceite');
    await g.post(`${A}/envios/${t}/envio`, { versao: 1 });
    await g.post(`${A}/envios/${t}/retorno`, { versao: 2, simular: true });
    const gru = await g.post(`${A}/envios/${t}/pagamento`, {
      versao: 3,
      gru: '1234567890',
      valor: 1.35,
      data: '2026-10-26',
    });
    expect(gru.statusCode, gru.body).toBe(200);
    expect((await g.get(`${A}/envios/${t}`)).json()).toMatchObject({
      gru: '1234567890',
      valorPago: 1.35,
      acoes: ['baixar'],
    });

    // DIOPS: sem balancete e desequilibrado não saem; certo, sai.
    const d0 = (
      await g.post(`${A}/previa`, { operadora: ope, obrigacao: 'DIOPS', competencia: '2026-T3' })
    ).json();
    expect(d0.problemas.map((p: { codigo: string }) => p.codigo)).toEqual(['sem-balancete']);
    const bal = {
      ativo: 1000,
      passivo: 600,
      patrimonioLiquido: 400,
      provisoesTecnicas: 50,
      responsavel: 'Contador Sintético',
    };
    const d1 = (
      await g.post(`${A}/previa`, {
        operadora: ope,
        obrigacao: 'DIOPS',
        competencia: '2026-T3',
        balancete: { ...bal, ativo: 999 },
      })
    ).json();
    expect(d1.problemas.map((p: { codigo: string }) => p.codigo)).toEqual(['balancete-desequilibrado']);
    const d2 = await g.post(`${A}/envios`, {
      operadora: ope,
      obrigacao: 'DIOPS',
      competencia: '2026-T3',
      balancete: bal,
    });
    expect(d2.statusCode, d2.body).toBe(200);
    // O DIOPS gerado e não enviado é substituído pelo seguinte.
    const d3 = (
      await g.post(`${A}/envios`, {
        operadora: ope,
        obrigacao: 'DIOPS',
        competencia: '2026-T3',
        balancete: bal,
      })
    ).json();
    expect((await g.get(`${A}/envios/${d2.json().id}`)).json().situacao).toBe('substituido');
    expect((await g.get(`${A}/envios/${d3.id}`)).json().sequencial).toBe(2);

    // SIP: sem contas médicas, só os expostos; monitoramento sem guias não sai.
    const sip = (
      await g.post(`${A}/previa`, { operadora: ope, obrigacao: 'SIP', competencia: '2026-T3' })
    ).json();
    expect(sip.podeGerar).toBe(true);
    expect(sip.quadros[1].parcelas).toEqual([{ rotulo: 'Ambulatorial', valor: 0, quantidade: 1 }]);
    const mon = (
      await g.post(`${A}/previa`, { operadora: ope, obrigacao: 'MONITORAMENTO_TISS', competencia: '2026-09' })
    ).json();
    expect(mon.problemas.map((p: { codigo: string }) => p.codigo)).toEqual(['sem-registros']);
    expect(
      (
        await g.post(`${A}/envios`, {
          operadora: ope,
          obrigacao: 'MONITORAMENTO_TISS',
          competencia: '2026-09',
        })
      ).statusCode,
    ).toBe(409);

    // Ressarcimento ao SUS: a internação na carência e o desconhecido; a decisão; o protocolo; o retorno; a GRU.
    const aviso = await g.post(`${A}/ressarcimento`, {
      operadora: ope,
      aviso: '7701',
      recebidoEm: '2026-10-20',
      atendimentos: [
        {
          tipo: 'AIH',
          numero: '4126000000011',
          identificacao: carteira,
          inicio: '2026-09-01',
          fim: '2026-09-04',
          procedimento: '0303010010',
          valor: 1500.5,
        },
        {
          tipo: 'APAC',
          numero: '4126000000022',
          identificacao: '123456789012345',
          inicio: '2026-09-10',
          fim: '2026-09-10',
          procedimento: '0304010014',
          valor: 300,
        },
      ],
    });
    expect(aviso.statusCode, aviso.body).toBe(200);
    const res = aviso.json().id as number;
    const fr = (await g.get(`${A}/envios/${res}`)).json();
    expect(fr).toMatchObject({
      obrigacao: 'RESSARCIMENTO_SUS',
      prazo: '2026-11-19',
      acoes: ['decidir'],
      hash: null,
    });
    expect(fr.itens.map((i: { sugestao: string }) => i.sugestao)).toEqual(['carencia', 'naoBeneficiario']);
    expect(
      (
        await g.post(`${A}/ressarcimento`, {
          operadora: ope,
          aviso: '7701',
          recebidoEm: '2026-10-20',
          atendimentos: [
            {
              tipo: 'AIH',
              numero: '4126000000099',
              identificacao: carteira,
              inicio: '2026-09-01',
              fim: '2026-09-04',
              procedimento: '0303010010',
              valor: 1,
            },
          ],
        })
      ).statusCode,
    ).toBe(409);
    expect((await g.post(`${A}/envios/${res}/envio`, { versao: 1 })).json().codigo).toBe('decisao-pendente');
    const [i1, i2] = fr.itens as { id: number }[];
    expect(
      (
        await g.post(`${A}/envios/${res}/itens/${i1!.id}/decisao`, {
          versao: 1,
          decisao: 'impugnar',
          motivo: null,
          justificativa: null,
        })
      ).json().codigo,
    ).toBe('impugnacao-sem-motivo');
    expect(
      (
        await g.post(`${A}/envios/${res}/itens/${i1!.id}/decisao`, {
          versao: 1,
          decisao: 'impugnar',
          motivo: 'carencia',
          justificativa: null,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await g.post(`${A}/envios/${res}/itens/${i2!.id}/decisao`, {
          versao: 2,
          decisao: 'aceitar',
          motivo: null,
          justificativa: null,
        })
      ).statusCode,
    ).toBe(200);
    const prot = await g.post(`${A}/envios/${res}/envio`, { versao: 3 });
    expect(prot.statusCode, prot.body).toBe(200);
    const dossie = (await g.get(`${A}/envios/${res}/arquivo`)).json();
    expect(Buffer.from(dossie.base64, 'base64').toString('utf8')).toContain('<aviso>7701</aviso>');
    const rr = await g.post(`${A}/envios/${res}/retorno`, {
      versao: 4,
      itens: [{ ordem: 1, aceito: false }],
    });
    expect(rr.statusCode, rr.body).toBe(200);
    expect(rr.json().mensagem).toContain('R$ 1.800,50');
    expect(
      (
        await g.post(`${A}/envios/${res}/pagamento`, {
          versao: 5,
          gru: '9876543210',
          valor: 1800.5,
          data: '2026-10-26',
        })
      ).statusCode,
    ).toBe(200);

    // A lista, os filtros e as contagens.
    const lista = (await g.get(`${A}/envios?operadora=${ope}`)).json();
    expect(lista.itens).toHaveLength(5);
    expect(lista.totais).toMatchObject({ aguardandoRetorno: 0, rejeitados: 0 });
    expect((await g.get(`${A}/envios?obrigacao=TPS&competencia=2026`)).json().itens).toHaveLength(1);
    expect((await g.get(`${A}/envios?competencia=x`)).statusCode).toBe(400);
    expect((await g.get(`${A}/envios/999999`)).statusCode).toBe(404);
  });

  it('quem não tem a permissão dos envios não lê nem gera', async () => {
    const atende = pedir(ligado, await entrar(ligado, 'SINT.OPE.ATENDE'));
    expect((await atende.get(`${A}/envios`)).statusCode).toBe(403);
    expect(
      (await atende.post(`${A}/envios`, { operadora: 1, obrigacao: 'SIB', competencia: '2026-09' }))
        .statusCode,
    ).toBe(403);
  });
});
