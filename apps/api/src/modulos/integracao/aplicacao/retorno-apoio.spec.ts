// Regra 13 (M34) pela HTTP: o resultado do laboratório de apoio entra estruturado pelo de-para, aparece na fila de
// conferência e só é gravado no exame depois da aprovação do responsável técnico habilitado (a receita
// sadt.registrarResultado, com ele como emissor); recusar exige o motivo; o valor sem de-para segura a aprovação; quem
// não é responsável técnico não aprova. Os FHIR R4 nos perfis fixados, o HL7 pelo motor e as mensagens pela Hal-AI
// (sem canal próprio; envio desligado). Dados sintéticos.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { criarApp } from '../../../app.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { lerConfiguracao } from '../../../configuracao.js';
import { envTeste, SENHA } from '../../../sessao/teste.spec-util.js';
import { moduloIntegracao } from '../modulo.js';
import { ArmazemConteudoMemoria, chaveDoConteudo, resumoSha256 } from '../infra/armazem-conteudo.js';
import { EXAME_SINTETICO_APOIO, PortaIntegracaoMemoria } from '../porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev', API_MODULOS: 'integracao' };
const trilha = new RegistradorTrilhaMemoria();
const armazem = new ArmazemConteudoMemoria();
const integracao = new PortaIntegracaoMemoria(armazem, trilha);
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarApp(lerConfiguracao(env), null, env, {
    trilha,
    registro: {
      integracao: async () => ({ modulo: (ctx) => moduloIntegracao(ctx, { porta: integracao, armazem }) }),
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app.close();
});

async function entrar(login: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/sessao',
    payload: { estabelecimento: 'aa', login, senha: SENHA },
  });
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
type S = Awaited<ReturnType<typeof entrar>>;
const get = (s: S, url: string) =>
  app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie: s.cookie } });
const post = (s: S, url: string, payload: unknown = {}) =>
  app.inject({
    method: 'POST',
    url: `/api${url}`,
    headers: {
      cookie: s.cookie,
      'x-csrf': s.csrf,
      'idempotency-key': `teste-m34-apoio-${++chave}-${Date.now()}`,
    },
    payload: payload as object,
  });

describe('retorno do laboratório de apoio (regra 13)', () => {
  it('o retorno casado pelo de-para é aprovado pelo responsável técnico e gravado no exame', async () => {
    const rt = await entrar('SINT.BIOMEDICO');
    const fila = (await get(rt, '/integracoes/apoio/retornos')).json();
    expect(fila).toHaveLength(1);
    expect(fila[0]).toMatchObject({
      exame: EXAME_SINTETICO_APOIO,
      protocolo: 'AP-2026-0001',
      semDePara: [],
      elementos: [{ elemento: 0, codigoApoio: 'GLI', numerico: 92, unidade: 'mg/dL', referencia: '70-99' }],
    });
    expect(trilha.eventos.some((e) => e.evento === 'integracao.retorno.lido')).toBe(true);
    // Recusar exige o motivo.
    expect(
      (
        await post(rt, `/integracoes/apoio/retornos/${fila[0].recebida}`, {
          decisao: 'recusar',
          motivo: null,
        })
      ).statusCode,
    ).toBe(400);
    const ok = await post(rt, `/integracoes/apoio/retornos/${fila[0].recebida}`, {
      decisao: 'aprovar',
      motivo: null,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ situacao: 'processada', exame: EXAME_SINTETICO_APOIO });
    expect((await get(rt, '/integracoes/apoio/retornos')).json()).toHaveLength(0);
    // A segunda aprovação não acha a fila (nada é gravado duas vezes).
    expect(
      (
        await post(rt, `/integracoes/apoio/retornos/${fila[0].recebida}`, {
          decisao: 'aprovar',
          motivo: null,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('valor sem de-para segura a aprovação; quem não é responsável técnico não confere', async () => {
    const conteudo = [
      'MSH|^~\\&|LAB-APOIO|LABSINT|SANTE|SINTETICO|20261022090000||ORU^R01^ORU_R01|LABSINT-0002|T|2.5',
      `OBR|1|${EXAME_SINTETICO_APOIO}|AP-2026-0002|XYZ^EXAME SEM DE-PARA`,
      'OBX|1|NM|XYZ^DESCONHECIDO||1|u|0-1||||F',
    ].join('\r');
    const resumo = resumoSha256(conteudo);
    const k = chaveDoConteudo('aa', 'lab-apoio-sintetico', 'entrada', resumo);
    await armazem.gravar('x', k, conteudo);
    await integracao.gravar({ rede: 'x', hospital: 'aa' }, {} as never, (g) =>
      g.registrarRecebida({
        parceiro: 'lab-apoio-sintetico',
        tipo: 'ORU^R01',
        chaveParceiro: 'LABSINT-0002',
        hash: resumo,
        chaveS3: k,
        tamanho: conteudo.length,
        situacao: 'conferir',
        detalhe: null,
        tabelaObjeto: 'exame_item',
        idObjeto: String(EXAME_SINTETICO_APOIO),
      }),
    );
    const rt = await entrar('SINT.BIOMEDICO');
    const fila = (await get(rt, '/integracoes/apoio/retornos')).json() as {
      recebida: string;
      semDePara: string[];
    }[];
    const sem = fila.find((f) => f.semDePara.length > 0)!;
    expect(sem.semDePara).toEqual(['XYZ']);
    const r = await post(rt, `/integracoes/apoio/retornos/${sem.recebida}`, {
      decisao: 'aprovar',
      motivo: null,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().detail).toMatch(/sem de-para/);
    const recusa = await post(rt, `/integracoes/apoio/retornos/${sem.recebida}`, {
      decisao: 'recusar',
      motivo: 'Exame sem de-para no estabelecimento.',
    });
    expect(recusa.json()).toMatchObject({ situacao: 'recusada' });
    // O administrador lê a fila, mas sem conselho e sem as opções do responsável técnico não confere.
    const outro = await entrar('SINT.ADMIN');
    expect(
      (await post(outro, `/integracoes/apoio/retornos/${sem.recebida}`, { decisao: 'aprovar', motivo: null }))
        .statusCode,
    ).toBe(403);
  });
});

describe('FHIR R4, HL7 v2 e mensagens (regras 12, 14 e 15a)', () => {
  it('os perfis BR Core fixados validam; o envio de vacina fica desligado com o motivo; o teste vai ao simulador', async () => {
    const s = await entrar('SINT.ADMIN');
    const f = (await get(s, '/integracoes/fhir')).json();
    expect(f.versaoBrCore).toBe('1.6.1');
    expect(f.perfis.every((p: { valido: boolean }) => p.valido)).toBe(true);
    expect(f.rnds.ambiente).toBe('simulador');
    expect(f.rnds.envioVacina.ligado).toBe(false);
    expect(f.rnds.prerequisitos.map((p: { descricao: string }) => p.descricao).join(' ')).toMatch(
      /ICP-Brasil/,
    );
    const t = (await post(s, '/integracoes/fhir/teste')).json();
    expect(t).toMatchObject({ ambiente: 'simulador', valido: true, problemas: [] });
  });

  it('os canais versionados do motor; a classificação externa sem caminho até a DP-16', async () => {
    const s = await entrar('SINT.ADMIN');
    const h = (await get(s, '/integracoes/hl7')).json();
    expect(h.canais.map((c: { canal: string }) => c.canal)).toEqual([
      'oie-apoio-orm',
      'oie-classificacao-adt',
    ]);
    expect(h.classificacaoExterna.caminho).toBe('nenhum');
    expect(h.canais.find((c: { canal: string }) => c.canal === 'oie-classificacao-adt').ligado).toBe(false);
  });

  it('as mensagens ao paciente só pela Hal-AI: sem canal próprio, envio desligado até a base legal', async () => {
    const s = await entrar('SINT.ADMIN');
    const m = (await get(s, '/integracoes/mensagens')).json();
    expect(m).toMatchObject({ canalProprio: false, envioLigado: false, tokenConfigurado: false });
    expect(m.motivo).toMatch(/Hal-AI/);
  });
});
