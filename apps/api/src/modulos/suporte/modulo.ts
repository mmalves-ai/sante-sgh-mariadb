// Módulo do suporte técnico e do "login como" (ADR 0021; F2.2): as rotas da conta da plataforma (login próprio,
// segundo fator, designação das contas de suporte e atribuições) e do "como" (entrar como o usuário, a auditoria da
// sessão, a correção das escritas). O repositório das contas e a fonte do "como":
//   - dev/ci com as fontes sintéticas e sem núcleo: as contas SINTÉTICAS da plataforma em memória e os alvos sintéticos;
//   - com o núcleo: aguardam a decisão de onde ficam a credencial, o segundo fator e o convite das contas de suporte
//     (banco plataforma × conta_plataforma do cliente; pedido do lote 01-06). Até lá, as rotas respondem 503 (falha
//     fechada), como o controlador faz sem os serviços.
// A guarda da sessão "como" (conferir a sessão de suporte a cada requisição) é da base: a sessão nasce com ganchos
// tardios (ContextoModulo.ganchosComo) que este módulo liga ao serviço do "como"; sem eles, nenhuma sessão "como" vale.
// O módulo é global: a guarda da base lê a AUDITORIA_COMO (bloqueio) e o interceptor do "como" registra cada escrita
// ANTES do handler e agrega as leituras por caminho.
// Melhoria: o padrão "em nome de quem gravar" do acesso total sai do app.module para o módulo dono.
import type { DynamicModule } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { cifrarSenha, chaveMestra, minutosSessaoComo } from '@sgh/dominio-acesso';
import { InterceptadorComo } from '../../autorizacao/interceptor-como.js';
import { AUDITORIA_COMO } from '../../autorizacao/simbolos.js';
import { logger } from '../../logger.js';
import { fontesSinteticas } from '../../sessao/montar.js';
import { lerRedePadrao } from '../../sessao/rede.js';
import { lerEstabelecimentosSinteticos } from '../acesso/estabelecimentos-sinteticos.js';
import { FonteAcessoSintetica } from '../acesso/fonte-sintetica.js';
import type { ContextoModulo } from '../registro.js';
import { PlataformaController, SERVICO_COMO, SERVICO_PLATAFORMA } from './plataforma.controller.js';
import {
  type FonteComoEstabelecimento,
  FonteComoMemoria,
  type RepositorioPlataforma,
  RepositorioPlataformaMemoria,
} from './repositorio.js';
import { ServicoComo } from './servico-como.js';
import { ServicoPlataforma } from './servico-plataforma.js';

/**
 * ADR 0022: PLATAFORMA_EM_NOME_DE="pc=LOGIN;hs=OUTRO" (login exato por estabelecimento). Entrada fora do formato é
 * ignorada (o modal pede a escolha): a configuração nunca derruba a API.
 */
export function emNomeDePadrao(valor: string | undefined): (hospital: string) => string | null {
  const mapa = new Map<string, string>();
  for (const parte of (valor ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i <= 0) continue;
    const cod = parte.slice(0, i).trim();
    const login = parte.slice(i + 1);
    if (/^[a-z][a-z0-9]{1,9}$/.test(cod) && /^\S.{0,30}$/.test(login) && login.trim() === login)
      mapa.set(cod, login);
  }
  return (h) => mapa.get(h) ?? null;
}

export interface OpcoesModuloSuporte {
  /** Testes: o repositório das contas (null: sem serviço, 503). */
  readonly repositorio?: RepositorioPlataforma | null;
  /** Testes: a fonte do "como" por estabelecimento. */
  readonly fonteComo?: FonteComoEstabelecimento | null;
  /** Testes: os serviços já montados (o teste liga os ganchos do "como" na sessão). */
  readonly servicos?: { readonly plataforma: ServicoPlataforma | null; readonly como: ServicoComo | null };
}

/** Os serviços do suporte pela regra do módulo; liga os ganchos tardios do "como" na sessão da base. */
export function servicosSuporte(
  ctx: ContextoModulo,
  opcoes: Pick<OpcoesModuloSuporte, 'repositorio' | 'fonteComo'> = {},
): { plataforma: ServicoPlataforma | null; como: ServicoComo | null } {
  const sintetico = !ctx.nucleo && fontesSinteticas(ctx.env);
  const rede = lerRedePadrao(ctx.env) ?? ctx.configuracao.rede ?? 'rede-sintetica';
  const repo =
    opcoes.repositorio !== undefined
      ? opcoes.repositorio
      : sintetico
        ? RepositorioPlataformaMemoria.sintetico(
            rede,
            lerEstabelecimentosSinteticos(ctx.env).map((e) => e.codigo),
            (x) => cifrarSenha(x),
          )
        : null;
  const fonte =
    opcoes.fonteComo !== undefined
      ? opcoes.fonteComo
      : sintetico
        ? new FonteComoMemoria(new FonteAcessoSintetica(ctx.env))
        : null;
  const plataforma = repo
    ? new ServicoPlataforma(repo, ctx.armazem, {
        ambiente: ctx.configuracao.ambiente,
        produto: ctx.configuracao.produtoNome,
        chaveMestra: chaveMestra(ctx.env['PLATAFORMA_CHAVE_MESTRA']),
      })
    : null;
  const servico = ctx.servico;
  const como =
    repo && fonte
      ? new ServicoComo(repo, fonte, ctx.armazem, {
          rede,
          estabelecimentos: () => {
            try {
              return servico ? servico.estabelecimentos(servico.rede).estabelecimentos : [];
            } catch {
              return [];
            }
          },
          minutos: minutosSessaoComo(ctx.env['SUPORTE_SESSAO_MINUTOS']),
          avisoAuditor: (ctx.env['SUPORTE_AVISO_AUDITOR'] ?? '').trim() !== 'nao',
          aviso: (m, c) => logger.warn(c, m),
          emNomeDe: emNomeDePadrao(ctx.env['PLATAFORMA_EM_NOME_DE']),
        })
      : null;
  if (como && servico) como.ligarSessao(servico);
  // Liga os ganchos do "como" na sessão da base (sem o serviço do "como", nenhuma sessão "como" vale).
  if (como)
    ctx.ganchosComo?.ligar({
      guarda: (c, r, h) => como.guarda(c, r, h),
      reautenticar: (c, senha) =>
        plataforma ? plataforma.conferirSenhaDaConta(c.idConta, senha) : Promise.resolve(false),
      aoEncerrar: (c, motivo) => como.aoEncerrar(c, motivo),
    });
  return { plataforma, como };
}

export function moduloSuporte(ctx: ContextoModulo, opcoes: OpcoesModuloSuporte = {}): DynamicModule {
  const s = opcoes.servicos ?? servicosSuporte(ctx, opcoes);
  return {
    module: class ModuloSuporte {},
    global: true,
    controllers: [PlataformaController],
    providers: [
      { provide: SERVICO_PLATAFORMA, useValue: s.plataforma },
      { provide: SERVICO_COMO, useValue: s.como },
      { provide: AUDITORIA_COMO, useValue: s.como },
      { provide: APP_INTERCEPTOR, useClass: InterceptadorComo },
    ],
    exports: [AUDITORIA_COMO],
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloSuporte(ctx);
}
