// 01-ADM L62: a chave do dispositivo (WebAuthn com biometria local) como passo da entrada. Fonte sintética: a conta
// fictícia do teste.spec-util e um autenticador simulado; o desafio passa pelo armazém em memória (uso único).
import { AutenticadorWebAuthnSimulado, type CredencialCadastrada } from '@sgh/dominio-acesso';
import { describe, expect, it } from 'vitest';
import type { ServicosAcessoEmail } from './acesso-email-proprio.js';
import { SegundoFatorEmailTardio } from './acesso-email-tardio.js';
import { ArmazemMemoria } from './armazem.js';
import type { MetodoSegundoFator } from './codigo-email.js';
import {
  type CredencialDispositivoPropria,
  ServicoDispositivoSegundoFator,
} from './dispositivo-segundo-fator.js';
import { ErroSessao } from './servico-sessao.js';
import { REDE, entrada, montar } from './teste.spec-util.js';

const SERVIDOR = 'hospital.exemplo';
const ORIGEM = 'https://hospital.exemplo:5310';

function cenario(metodo: MetodoSegundoFator = 'dispositivo') {
  const guardadas: { id: number; c: CredencialCadastrada; contador: number; revogada: boolean }[] = [];
  const porta = {
    idUsuario: () => Promise.resolve(1),
    listar: () =>
      Promise.resolve(
        guardadas
          .filter((g) => !g.revogada)
          .map((g) => ({ id: g.id, nome: 'x', criadoEm: '2026-11-26T00:00:00.000Z', ultimoUsoEm: null })),
      ),
    ativas: () =>
      Promise.resolve(
        guardadas
          .filter((g) => !g.revogada)
          .map((g) => ({
            id: g.id,
            idCredencial: g.c.idCredencial,
            chavePublica: g.c.chavePublica,
            contador: g.contador,
          })),
      ),
    incluir: (_a: unknown, c: CredencialCadastrada) => {
      const id = guardadas.length + 1;
      guardadas.push({ id, c, contador: c.contador, revogada: false });
      return Promise.resolve({ id });
    },
    registrarUso: (_a: unknown, id: number, contador: number) => {
      guardadas.find((g) => g.id === id)!.contador = contador;
      return Promise.resolve();
    },
    revogar: (_a: unknown, id: number) => {
      guardadas.find((g) => g.id === id)!.revogada = true;
      return Promise.resolve();
    },
  } as unknown as CredencialDispositivoPropria;
  const dispositivo = new ServicoDispositivoSegundoFator(porta, new ArmazemMemoria(), `${ORIGEM}/`);
  const gancho = new SegundoFatorEmailTardio();
  gancho.ligar({
    preferencia: { metodo: () => Promise.resolve(metodo) },
    dispositivo,
    codigoUsuario: null,
    recuperacaoPlataforma: null,
  } as unknown as ServicosAcessoEmail);
  const { servico } = montar({ config: { segundoFatorEmail: gancho } });
  return { servico, dispositivo, guardadas };
}

async function cadastrar(d: ServicoDispositivoSegundoFator): Promise<AutenticadorWebAuthnSimulado> {
  const disp = new AutenticadorWebAuthnSimulado(-7, 3);
  const ator = { rede: REDE, hospital: 'aa', login: 'SINT.USUARIO', estacao: null, correlacao: 'c' };
  const op = await d.iniciarCadastro('sessao-cadastro', ator, 'Conta fictícia');
  await d.concluirCadastro(
    'sessao-cadastro',
    ator,
    disp.cadastrar(op.challenge, ORIGEM, SERVIDOR),
    'Celular',
  );
  return disp;
}

async function desafioDaRecusa(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(ErroSessao);
  const erro = e as ErroSessao;
  expect(erro).toMatchObject({ tipo: 'segundo-fator-necessario', codigo: 'segundo-fator-dispositivo' });
  const opcoes = erro.dados?.['opcoesDispositivo'] as { challenge: string; allowCredentials: unknown[] };
  expect(opcoes.allowCredentials).toHaveLength(1);
  return opcoes.challenge;
}

describe('chave do dispositivo como passo da entrada', () => {
  it('sem assinatura: devolve o desafio; com a assinatura do aparelho cadastrado, entra', async () => {
    const { servico, dispositivo, guardadas } = cenario();
    const disp = await cadastrar(dispositivo);
    const desafio = await desafioDaRecusa(servico.entrar(entrada('SINT.USUARIO'), REDE));
    const r = await servico.entrar(
      { ...entrada('SINT.USUARIO'), respostaDispositivo: disp.validar(desafio, ORIGEM, SERVIDOR) },
      REDE,
    );
    expect(r.sessao.usuario.login).toBe('SINT.USUARIO');
    expect(guardadas[0]!.contador).toBeGreaterThan(3);
  });

  it('assinatura repetida (desafio já usado) ou de outra origem: recusa como dispositivo inválido', async () => {
    const { servico, dispositivo } = cenario();
    const disp = await cadastrar(dispositivo);
    const desafio = await desafioDaRecusa(servico.entrar(entrada('SINT.USUARIO'), REDE));
    const resposta = disp.validar(desafio, ORIGEM, SERVIDOR);
    await servico.entrar({ ...entrada('SINT.USUARIO'), respostaDispositivo: resposta }, REDE);
    await expect(
      servico.entrar({ ...entrada('SINT.USUARIO'), respostaDispositivo: resposta }, REDE),
    ).rejects.toMatchObject({ codigo: 'segundo-fator-dispositivo-invalido' });
    const outro = await desafioDaRecusa(servico.entrar(entrada('SINT.USUARIO'), REDE));
    await expect(
      servico.entrar(
        {
          ...entrada('SINT.USUARIO'),
          respostaDispositivo: disp.validar(outro, 'https://falso.exemplo', SERVIDOR),
        },
        REDE,
      ),
    ).rejects.toMatchObject({ codigo: 'segundo-fator-dispositivo-invalido' });
  });

  it('todos os aparelhos revogados: segue o fluxo do aplicativo (não pede o dispositivo)', async () => {
    const { servico, dispositivo, guardadas } = cenario();
    await cadastrar(dispositivo);
    guardadas[0]!.revogada = true;
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    expect(r.sessao.usuario.login).toBe('SINT.USUARIO');
  });

  it('quem escolheu o aplicativo nunca recebe o desafio do dispositivo', async () => {
    const { servico, dispositivo } = cenario('aplicativo');
    await cadastrar(dispositivo);
    const r = await servico.entrar(entrada('SINT.USUARIO'), REDE);
    expect(r.sessao.usuario.login).toBe('SINT.USUARIO');
  });
});
