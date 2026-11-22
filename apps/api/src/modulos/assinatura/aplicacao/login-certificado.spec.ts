// M49, etapa 3: a entrada com certificado A1/A3 (agente local) sobre a porta em memória e o SIMULADOR (ICP sintética):
// o desafio de uso único, a assinatura conferida no servidor (cadeia, LCR, CPF), só o certificado VINCULADO e ativo da
// conta, a chave `acesso.loginCertificado` (POL-3), o limite de tentativas e a trilha de cada recusa sem CPF nem
// certificado. Certificados e CPF SINTÉTICOS; nenhum dado de pessoa.
import { randomBytes } from 'node:crypto';
import {
  assinarHashRsa,
  CPF_SINTETICO_OUTRO,
  CPF_SINTETICO_SESSAO,
  emitirSintetico,
} from '@sgh/dominio-documento';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RequisicaoAutorizada } from '../../../autorizacao/guarda.js';
import { RegistradorTrilhaMemoria } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { ArmazemMemoria } from '../../../sessao/armazem.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import { configAssinaturaDoAmbiente } from '../infra/ambiente.js';
import type { SimuladorIcp } from '../infra/simulador.js';
import { PortaAssinaturaMemoria } from '../porta-memoria.js';
import {
  CHAVE_LOGIN_CERTIFICADO,
  DESAFIOS_POR_ORIGEM_LOGIN_CERTIFICADO,
  ServicoLoginCertificado,
  TENTATIVAS_LOGIN_CERTIFICADO,
} from './login-certificado.js';
import { ServicoAssinaturaIcp } from './servico.js';

const LOGIN = 'MEDICO.SINTETICO';
const REDE = 'rede-sintetica';
const AGENTE = 'http://127.0.0.1:47999';
const origem = { estacao: 'ESTACAO:teste', correlacao: 'login-certificado' };

function sessao(): SessaoCadastro {
  return {
    req: { headers: {}, ip: '127.0.0.1' } as unknown as RequisicaoAutorizada,
    hospital: 'pc',
    rede: REDE,
    login: LOGIN,
    porta: {
      rede: REDE,
      hospital: 'pc',
      cliente: 'teste',
      estabelecimento: 1,
      usuario: 1,
      correlacao: 'teste',
    },
    pode: () => true,
  };
}

const configuracao = (ligada: boolean, prerequisito = true) =>
  ({
    chaves: async () => [
      { chave: CHAVE_LOGIN_CERTIFICADO, tipo: 'recurso', escopo: 'hospital', valor: '*', ligada },
    ],
    prerequisitos: async () =>
      prerequisito
        ? [
            {
              recurso: CHAVE_LOGIN_CERTIFICADO,
              tipo: 'aprovacao',
              situacao: 'dispensado',
              validade: null,
              evidencia: 'teste',
              alteradoPor: 'SINT.ADMIN',
              alteradoEm: '2026-10-24T00:00:00.000Z',
            },
          ]
        : [],
    valoresParametro: async () => [],
  }) as never;

async function recusada(p: Promise<unknown>): Promise<{ status: number; motivo: string | undefined }> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroProblema)
      return { status: e.getStatus(), motivo: (e.extras as { motivo?: string }).motivo };
    throw e;
  }
  throw new Error('Era para ser recusada.');
}

let porta: PortaAssinaturaMemoria;
let trilha: RegistradorTrilhaMemoria;
let sim: SimuladorIcp;
let icp: ServicoAssinaturaIcp;
let armazem: ArmazemMemoria;
let login: ServicoLoginCertificado;

async function montar(o: { agente?: boolean; ligada?: boolean; prerequisito?: boolean } = {}) {
  porta = new PortaAssinaturaMemoria();
  trilha = new RegistradorTrilhaMemoria();
  const env = o.agente === false ? {} : { ASSINATURA_AGENTE_LOCAL_URL: AGENTE };
  const cfg = await configAssinaturaDoAmbiente(env, true, null, process.cwd());
  sim = cfg.simulador!;
  icp = new ServicoAssinaturaIcp(porta, trilha, cfg);
  armazem = new ArmazemMemoria();
  login = new ServicoLoginCertificado(
    icp,
    porta,
    armazem,
    configuracao(o.ligada ?? true, o.prerequisito ?? true),
    trilha,
  );
}

/** Vincula à conta o certificado A3 do agente simulado (a parte pública, pela tela "Meu certificado"). */
async function vincularA3() {
  const der = Buffer.from(sim.agente(CPF_SINTETICO_SESSAO).certificado).toString('base64');
  return icp.vincularArquivo(sessao(), { midia: 'a3', provedor: null, certificado: der });
}

beforeEach(async () => {
  await montar();
});

describe('entrada com certificado A1/A3', () => {
  it('disponível só com a chave ligada (e o pré-requisito) e o agente configurado', async () => {
    expect(await login.disponivel(REDE, 'pc')).toEqual({ disponivel: true, agenteLocal: AGENTE });
    expect(await login.disponivel(REDE, 'PC!')).toEqual({ disponivel: false, agenteLocal: null });
    await montar({ ligada: false });
    expect(await login.disponivel(REDE, 'pc')).toEqual({ disponivel: false, agenteLocal: null });
    await expect(
      recusada(login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN })),
    ).resolves.toMatchObject({
      status: 403,
    });
    await montar({ prerequisito: false });
    expect((await login.disponivel(REDE, 'pc')).disponivel).toBe(false);
    await montar({ agente: false });
    expect(await login.disponivel(REDE, 'pc')).toEqual({ disponivel: false, agenteLocal: null });
  });

  it('caminho principal: o agente assina o hash do desafio; servidor confere e devolve a conta (uma vez só)', async () => {
    await vincularA3();
    const d = await login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN });
    expect(d).toMatchObject({ tipo: 'agente-local', algoritmo: 'sha256', agenteLocal: AGENTE });
    expect(d.hashes).toHaveLength(1);
    const resp = sim.assinarNoAgente(CPF_SINTETICO_SESSAO, d.hashes);
    expect(await login.conferir(REDE, { desafio: d.desafio, ...resp }, origem)).toEqual({
      estabelecimento: 'pc',
      login: LOGIN,
    });
    // O desafio vale uma vez: a mesma resposta de novo é recusada (e vai à trilha).
    expect(await recusada(login.conferir(REDE, { desafio: d.desafio, ...resp }, origem))).toMatchObject({
      status: 401,
      motivo: 'desafio-expirado',
    });
    expect(trilha.eventos.at(-1)).toMatchObject({
      evento: 'sessao.login.certificado-falho',
      resultado: 'falha',
    });
  });

  it('recusas: certificado não vinculado, outro hash, assinatura que não confere, CPF de outra pessoa', async () => {
    // Sem vínculo: o certificado do agente não é da conta.
    let d = await login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN });
    let resp = sim.assinarNoAgente(CPF_SINTETICO_SESSAO, d.hashes);
    expect((await recusada(login.conferir(REDE, { desafio: d.desafio, ...resp }, origem))).motivo).toBe(
      'certificado-nao-vinculado',
    );
    await vincularA3();
    // Outro hash que não o do desafio.
    d = await login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN });
    resp = sim.assinarNoAgente(CPF_SINTETICO_SESSAO, ['a'.repeat(64)]);
    expect((await recusada(login.conferir(REDE, { desafio: d.desafio, ...resp }, origem))).motivo).toBe(
      'resposta-invalida',
    );
    // Assinatura de outra chave sobre o hash certo, com o certificado vinculado: não confere.
    d = await login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN });
    const outro = emitirSintetico(sim.raiz, { cpf: CPF_SINTETICO_SESSAO }, new Date());
    const falsa = Buffer.from(assinarHashRsa(outro.chave, Buffer.from(d.hashes[0]!, 'hex'))).toString(
      'base64',
    );
    const cert = Buffer.from(sim.agente(CPF_SINTETICO_SESSAO).certificado).toString('base64');
    expect(
      (
        await recusada(
          login.conferir(
            REDE,
            {
              desafio: d.desafio,
              assinaturas: [{ hash: d.hashes[0]!, assinatura: falsa }],
              certificado: cert,
            },
            origem,
          ),
        )
      ).motivo,
    ).toBe('validacao-invalida');
    // O certificado de outra pessoa (CPF diferente do da conta), mesmo vinculado por engano, não entra.
    const der2 = Buffer.from(sim.agente(CPF_SINTETICO_OUTRO).certificado).toString('base64');
    porta.identidade = async () =>
      ({
        cpf: CPF_SINTETICO_SESSAO,
        cpfProfissional: CPF_SINTETICO_SESSAO,
        registros: [],
      }) as never;
    const certs = porta.certificados.bind(porta);
    const um = porta.certificado.bind(porta);
    porta.certificados = async (c, l) => [{ ...(await certs(c, l))[0]!, id: 999 }];
    porta.certificado = async (c, id) =>
      id === 999
        ? { ...(await um(c, (await certs(c, LOGIN))[0]!.id))!, id: 999, certificadoDer: der2 }
        : um(c, id);
    d = await login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN });
    resp = sim.assinarNoAgente(CPF_SINTETICO_OUTRO, d.hashes);
    expect((await recusada(login.conferir(REDE, { desafio: d.desafio, ...resp }, origem))).motivo).toBe(
      'cpf-divergente',
    );
    // Nada de CPF nem de certificado na trilha.
    const t = JSON.stringify(trilha.eventos);
    expect(t).not.toContain(CPF_SINTETICO_SESSAO);
    expect(t).not.toContain(cert.slice(0, 40));
  });

  it('cadastro sem CPF: recusa; desafio vencido ou inexistente: expirado', async () => {
    await vincularA3();
    porta.identidade = async () => ({ cpf: null, cpfProfissional: null, registros: [] }) as never;
    let d = await login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN });
    let resp = sim.assinarNoAgente(CPF_SINTETICO_SESSAO, d.hashes);
    expect((await recusada(login.conferir(REDE, { desafio: d.desafio, ...resp }, origem))).motivo).toBe(
      'cpf-divergente',
    );
    // Desafio vencido: o relógio passou do prazo.
    let agora = Date.now();
    const venc = new ServicoLoginCertificado(
      icp,
      porta,
      armazem,
      configuracao(true),
      trilha,
      () => new Date(agora),
    );
    d = await venc.desafio(REDE, { estabelecimento: 'pc', login: LOGIN });
    resp = sim.assinarNoAgente(CPF_SINTETICO_SESSAO, d.hashes);
    agora += 121_000;
    expect((await recusada(venc.conferir(REDE, { desafio: d.desafio, ...resp }, origem))).motivo).toBe(
      'desafio-expirado',
    );
    // Desafio inexistente.
    expect(
      (
        await recusada(
          login.conferir(REDE, { desafio: randomBytes(32).toString('base64url'), ...resp }, origem),
        )
      ).motivo,
    ).toBe('desafio-expirado');
  });

  it('pedir desafios sem responder não bloqueia a conta; a emissão é limitada por origem (IPv6 pelo /64)', async () => {
    await vincularA3();
    // Um terceiro pede desafios da conta alheia de várias origens: a conta segue entrando.
    for (let i = 0; i < 3 * TENTATIVAS_LOGIN_CERTIFICADO; i++)
      await login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN }, `198.51.100.${i % 3}`);
    const d = await login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN }, '203.0.113.50');
    const resp = sim.assinarNoAgente(CPF_SINTETICO_SESSAO, d.hashes);
    expect(await login.conferir(REDE, { desafio: d.desafio, ...resp }, origem)).toEqual({
      estabelecimento: 'pc',
      login: LOGIN,
    });
    // A origem que pede demais só esgota a própria cota (e trocar de endereço no mesmo /64 não zera).
    for (let i = 0; i < DESAFIOS_POR_ORIGEM_LOGIN_CERTIFICADO; i++)
      await login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN }, `2001:db8:5:6::${i + 1}`);
    expect(
      await recusada(login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN }, '2001:db8:5:6:ffff::1')),
    ).toMatchObject({ status: 429 });
    expect((await login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN }, '2001:db8:5:7::1')).tipo).toBe(
      'agente-local',
    );
  });

  it('limite de recusas por conta normalizada (o vencido não conta) e porta fora do ar: 503', async () => {
    // Recusas da conferência (certificado não vinculado), alternando a caixa do login: um contador só.
    for (let i = 0; i < TENTATIVAS_LOGIN_CERTIFICADO; i++) {
      const conta = i % 2 ? LOGIN.toLowerCase() : LOGIN;
      const d = await login.desafio(REDE, { estabelecimento: 'pc', login: conta });
      const resp = sim.assinarNoAgente(CPF_SINTETICO_SESSAO, d.hashes);
      expect((await recusada(login.conferir(REDE, { desafio: d.desafio, ...resp }, origem))).status).toBe(
        401,
      );
    }
    expect(await recusada(login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN }))).toMatchObject({
      status: 429,
    });
    expect(
      await recusada(login.desafio(REDE, { estabelecimento: 'pc', login: ` ${LOGIN.toLowerCase()} ` })),
    ).toMatchObject({ status: 429 });
    // O desafio vencido ou inexistente não conta.
    await montar();
    for (let i = 0; i < 2 * TENTATIVAS_LOGIN_CERTIFICADO; i++)
      await recusada(
        login.conferir(
          REDE,
          { desafio: randomBytes(32).toString('base64url'), assinaturas: [], certificado: 'x' } as never,
          origem,
        ),
      );
    expect((await login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN })).tipo).toBe('agente-local');
    await montar();
    await vincularA3();
    const d = await login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN });
    const resp = sim.assinarNoAgente(CPF_SINTETICO_SESSAO, d.hashes);
    porta.certificados = async () => {
      throw new Error('fora');
    };
    expect((await recusada(login.conferir(REDE, { desafio: d.desafio, ...resp }, origem))).status).toBe(503);
  });

  it('uso único atômico: duas respostas iguais ao mesmo tempo abrem uma conta só', async () => {
    await vincularA3();
    const d = await login.desafio(REDE, { estabelecimento: 'pc', login: LOGIN });
    const resp = sim.assinarNoAgente(CPF_SINTETICO_SESSAO, d.hashes);
    const r = await Promise.allSettled([
      login.conferir(REDE, { desafio: d.desafio, ...resp }, origem),
      login.conferir(REDE, { desafio: d.desafio, ...resp }, origem),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const recusa = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect((recusa.reason as ErroProblema).getStatus()).toBe(401);
  });
});
