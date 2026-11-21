// W1-04 (mercado): termos de consentimento e LGPD pela HTTP, com a sessão real sobre a fonte sintética e a porta da
// recepção EM MEMÓRIA: modelo versionado (alterar = versão nova), inativar/reativar com motivo, excluir só o nunca
// assinado (com assinatura, recusa com a contagem e oferece inativar), assinatura em tela com hash e sem edição,
// revogação única, termo faltando e o bloqueio suave só com o parâmetro ligado.
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { esquemaTermosDoPaciente } from '@sgh/contratos';
import { RegistradorTrilhaMemoria } from '../../autorizacao/trilha.js';
import { envTeste, SENHA } from '../../sessao/teste.spec-util.js';
import {
  chavesIniciaisSinteticas,
  fonteConfiguracaoMemoria,
  parametrosIniciaisSinteticos,
  prerequisitosIniciaisSinteticos,
} from '../config/public-api.js';
import { criarAppRecepcao } from './app-recepcao.spec-util.js';
import { PortaRecepcaoMemoria } from './porta-memoria.js';

const env: Record<string, string> = { ...envTeste, AMBIENTE: 'dev' };
const trilha = new RegistradorTrilhaMemoria();
const recepcao = new PortaRecepcaoMemoria(
  { estado: () => 'verde' },
  { agora: () => new Date('2026-10-21T11:30:00Z') },
);
// A configuração sintética (liberação e parâmetros) montada aqui: o parâmetro é definido pela fonte, como a tela de
// parâmetros da administração faria (o módulo de configuração não é montado neste teste).
const configuracao = fonteConfiguracaoMemoria(trilha, {
  chavesIniciais: chavesIniciaisSinteticas,
  prerequisitosIniciais: prerequisitosIniciaisSinteticos,
  parametrosIniciais: parametrosIniciaisSinteticos,
});
let app: NestFastifyApplication;
let chave = 0;

beforeAll(async () => {
  app = await criarAppRecepcao(env, { trilha, recepcao, configuracao });
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
  'idempotency-key': `teste-termo-${++chave}-${Date.now()}`,
});
const T = '/api/recepcao/termos';
const get = (s: Sessao, url: string) =>
  app.inject({ method: 'GET', url: `${T}${url}`, headers: { cookie: s.cookie } });
const post = (s: Sessao, url: string, payload: unknown = {}) =>
  app.inject({ method: 'POST', url: `${T}${url}`, headers: h(s), payload: payload as object });

const TEXTO = 'Autorizo o atendimento e o tratamento dos meus dados de saúde para esta finalidade.';
const modelo = {
  codigo: 'lgpd-consulta',
  titulo: 'Consentimento LGPD da consulta',
  finalidade: 'atendimento',
  tiposAtendimento: ['consulta', 'pa'],
  exigido: true,
  texto: TEXTO,
};
// PNG mínimo (1 pixel) em base64: o traço sintético.
const TRACO =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

describe('termos de consentimento (W1-04)', () => {
  it('quem só atende no guichê não cadastra modelo (403); o cadastro inclui a versão 1', async () => {
    const guiche = await entrar('SINT.GUICHE');
    expect((await post(guiche, '/modelos', modelo)).statusCode).toBe(403);
    const s = await entrar('SINT.SENHAS');
    const r = await post(s, '/modelos', modelo);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ ok: true, versao: 1 });
    expect((await post(s, '/modelos', modelo)).json()).toMatchObject({ codigo: 'termo-codigo-existe' });
    expect(trilha.eventos.some((e) => e.evento === 'recepcao.termo.modelo')).toBe(true);
  });

  it('finalidade fora do catálogo e texto curto são recusados', async () => {
    const s = await entrar('SINT.SENHAS');
    expect(
      (await post(s, '/modelos', { ...modelo, codigo: 'x-1', finalidade: 'marketing' })).statusCode,
    ).toBe(400);
    expect((await post(s, '/modelos', { ...modelo, codigo: 'x-2', texto: 'curto' })).statusCode).toBe(400);
  });

  it('termo exigido faltando aparece; sem o parâmetro ligado não há bloqueio suave', async () => {
    const s = await entrar('SINT.SENHAS');
    const r = await get(s, '/paciente?prontuario=900001&tipo=consulta');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({
      exigir: false,
      bloqueioSuave: false,
      faltando: [{ codigo: 'lgpd-consulta', versao: 1 }],
      // Quem pode assinar vem junto (a tela do guichê monta o combo do signatário).
      signatarios: [
        { codigo: 1, rotulo: 'Paciente' },
        { codigo: 2, rotulo: 'Representante legal' },
      ],
    });
    expect(esquemaTermosDoPaciente.parse(r.json()).prontuario).toBe(900001);
    // O exame não exige este termo.
    expect((await get(s, '/paciente?prontuario=900001&tipo=exame')).json().faltando).toEqual([]);
  });

  it('com recepcao.termos.exigir ligado, o termo faltando dá bloqueio suave', async () => {
    await configuracao.definirParametro(
      {
        rede: 'rede-sintetica',
        hospital: 'aa',
        fechar: [],
        nova: {
          chave: 'recepcao.termos.exigir',
          nivel: 'estabelecimento',
          alvo: 'aa',
          valor: 'sim',
          vigenteDesde: '2026-01-01T00:00:00',
          vigenteAte: null,
          justificativa: 'teste do bloqueio suave',
          autor: 'SINT.ADMIN',
        },
      },
      {
        rede: 'rede-sintetica',
        hospital: 'aa',
        usuario: 'SINT.ADMIN',
        evento: 'config.parametro.definido',
        recurso: 'config.parametro',
        operacao: 'definirParametro',
        chaveNaturalAlvo: 'recepcao.termos.exigir',
        resultado: 'sucesso',
        estacao: null,
        correlacao: 'teste-termos-exigir',
      },
    );
    const s = await entrar('SINT.SENHAS');
    expect((await get(s, '/paciente?prontuario=900001&tipo=consulta')).json()).toMatchObject({
      exigir: true,
      bloqueioSuave: true,
    });
  });

  it('assinatura em tela grava o hash; não há rota de edição; revogar é fato novo, uma vez só', async () => {
    const s = await entrar('SINT.SENHAS');
    const [m] = (await get(s, '/modelos')).json() as { versoes: { id: number }[] }[];
    const id = m?.versoes[0]?.id ?? 0;
    const pedido = {
      modelo: id,
      prontuario: 900001,
      senha: null,
      tipoAtendimento: 'consulta',
      meio: 'tela',
      signatario: 1,
      nomeSignatario: 'Ana Sintética',
      imagem: null,
    };
    expect((await post(s, '/assinaturas', pedido)).statusCode).toBe(400);
    const a = await post(s, '/assinaturas', { ...pedido, imagem: TRACO });
    expect(a.statusCode, a.body).toBe(201);
    const { id: assinatura, hash } = a.json() as { id: number; hash: string };
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    // O hash não vai à trilha.
    expect(JSON.stringify(trilha.eventos)).not.toContain(hash);
    const depois = (await get(s, '/paciente?prontuario=900001&tipo=consulta')).json();
    expect(depois).toMatchObject({ bloqueioSuave: false, faltando: [] });
    expect(depois.assinaturas[0]).toMatchObject({ id: assinatura, hash, revogacao: null, versao: 1 });
    // Não existe alteração do termo assinado (só a revogação).
    const editar = await app.inject({
      method: 'PUT',
      url: `${T}/assinaturas/${assinatura}`,
      headers: h(s),
      payload: { nomeSignatario: 'Outra' },
    });
    expect(editar.statusCode).toBe(404);
    expect((await post(s, `/assinaturas/${assinatura}/revogar`, { motivo: 'curto' })).statusCode).toBe(400);
    const rv = await post(s, `/assinaturas/${assinatura}/revogar`, {
      motivo: 'Paciente revogou o consentimento.',
    });
    expect(rv.statusCode, rv.body).toBe(200);
    expect(
      (
        await post(s, `/assinaturas/${assinatura}/revogar`, { motivo: 'Paciente revogou o consentimento.' })
      ).json(),
    ).toMatchObject({ codigo: 'termo-revogado' });
    const fim = (await get(s, '/paciente?prontuario=900001&tipo=consulta')).json();
    expect(fim.assinaturas[0]).toMatchObject({
      id: assinatura,
      hash,
      revogacao: { motivo: expect.any(String) },
    });
    expect(fim.faltando).toHaveLength(1);
  });

  it('alterar o modelo é versão nova (a anterior fica) e a assinatura antiga não vale para a nova', async () => {
    const s = await entrar('SINT.SENHAS');
    const novo = {
      titulo: modelo.titulo,
      tiposAtendimento: ['consulta'],
      exigido: true,
      texto: `${TEXTO} Versão 2.`,
    };
    expect(
      (await post(s, '/modelos/lgpd-consulta/versoes', { ...novo, versaoVista: 9 })).json(),
    ).toMatchObject({
      codigo: 'termo-concorrente',
    });
    const r = await post(s, '/modelos/lgpd-consulta/versoes', { ...novo, versaoVista: 1 });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ versao: 2 });
    const [m] = (await get(s, '/modelos')).json() as { versoes: { versao: number; texto: string }[] }[];
    expect(m?.versoes.map((v) => v.versao)).toEqual([2, 1]);
    expect(m?.versoes[1]?.texto).toBe(TEXTO);
    expect((await get(s, '/paciente?prontuario=900001&tipo=consulta')).json().faltando).toMatchObject([
      { versao: 2 },
    ]);
  });

  it('excluir com assinatura recusa com a contagem e oferece inativar; inativar e reativar com motivo', async () => {
    const s = await entrar('SINT.SENHAS');
    const ex = await post(s, '/modelos/lgpd-consulta/excluir', { motivo: 'Cadastrado por engano no teste.' });
    expect(ex.statusCode).toBe(409);
    expect(ex.json()).toMatchObject({
      codigo: 'com-dependentes',
      podeInativar: true,
      dependentes: [{ quantidade: 1 }],
    });
    const motivo = 'Texto em revisão pelo jurídico.';
    expect((await post(s, '/modelos/lgpd-consulta/situacao', { ativo: false, motivo })).statusCode).toBe(200);
    expect((await post(s, '/modelos/lgpd-consulta/situacao', { ativo: false, motivo })).json()).toMatchObject(
      {
        codigo: 'termo-situacao',
      },
    );
    // Inativo não é exigido.
    expect((await get(s, '/paciente?prontuario=900001&tipo=consulta')).json().faltando).toEqual([]);
    expect((await post(s, '/modelos/lgpd-consulta/situacao', { ativo: true, motivo })).statusCode).toBe(200);
  });

  it('o código nunca assinado se exclui', async () => {
    const s = await entrar('SINT.SENHAS');
    expect((await post(s, '/modelos', { ...modelo, codigo: 'engano' })).statusCode).toBe(201);
    const r = await post(s, '/modelos/engano/excluir', { motivo: 'Cadastrado por engano no teste.' });
    expect(r.statusCode, r.body).toBe(200);
    expect(((await get(s, '/modelos')).json() as { codigo: string }[]).map((m) => m.codigo)).toEqual([
      'lgpd-consulta',
    ]);
  });
});
