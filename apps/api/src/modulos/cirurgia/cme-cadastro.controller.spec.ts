// Cadastro da CME (F7, 04-CME linha 115) pela HTTP: a foto de conferência (até 2 MB pelo domínio) vai em base64 e passa
// de 1 MB, o teto do JSON padrão do Fastify. Com o tipo do corpo com anexos (registrado pelo controlador no
// onModuleInit), a foto de 1,9 MB chega inteira à porta; no JSON padrão, o Fastify recusa com 413 antes de chegar lá.
// Porta simulada (nada conecta a banco); a sessão é posta na requisição como a guarda faria.
import { Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TIPO_CORPO_ANEXOS_PORTAL } from '@sgh/contratos';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { criarAppComModulo } from '../../app.js';
import { CmeCadastroController } from './cme-cadastro.controller.js';
import { PORTA_CME_CADASTRO } from './cme-cadastro-propria.js';

const enviarFoto = vi.fn(async (_c: unknown, _alvo: string, _id: number, corpo: unknown) => ({
  tamanho: String((corpo as { conteudo: string }).conteudo).length,
}));

@Module({})
class ModuloTeste {}

describe('cadastro da CME: a foto pela rota HTTP', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await criarAppComModulo({
      module: ModuloTeste,
      controllers: [CmeCadastroController],
      providers: [{ provide: PORTA_CME_CADASTRO, useValue: { enviarFoto } }],
    });
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRequest', (req, _res, pronto) => {
        (req as unknown as { sgh: unknown }).sgh = {
          real: true,
          sessao: { estabelecimentoAtivo: 'aa', rede: '', usuario: { id: '1', login: 'teste' } },
          ability: { can: () => true },
        };
        pronto();
      });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  // 1,9 MB de bytes viram cerca de 2,5 MB em base64: acima do teto do JSON padrão, abaixo do teto da foto.
  const conteudo = Buffer.alloc(1_900_000, 7).toString('base64');
  const corpo = JSON.stringify({ versao: 1, conteudo, nomeOriginal: 'caixa.png' });

  it('no tipo do corpo com anexos, a foto de 1,9 MB chega inteira à porta', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/cirurgia/cme/cadastro/caixas/41/foto',
      headers: { 'content-type': TIPO_CORPO_ANEXOS_PORTAL },
      payload: corpo,
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ tamanho: conteudo.length });
    expect(enviarFoto).toHaveBeenCalledTimes(1);
    expect(enviarFoto.mock.calls[0]?.[1]).toBe('caixa');
    expect(enviarFoto.mock.calls[0]?.[2]).toBe(41);
  });

  it('no JSON padrão, o mesmo corpo para no teto de 1 MB (413) e nada chega à porta', async () => {
    enviarFoto.mockClear();
    const r = await app.inject({
      method: 'POST',
      url: '/api/cirurgia/cme/cadastro/pecas/9/foto',
      headers: { 'content-type': 'application/json' },
      payload: corpo,
    });
    expect(r.statusCode).toBe(413);
    expect(enviarFoto).not.toHaveBeenCalled();
  });
});
