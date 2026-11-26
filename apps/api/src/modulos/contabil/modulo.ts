// Módulo da contabilidade (F2.2, lote 04-01, M54): os controladores do plano de contas, dos lançamentos e das
// demonstrações sobre a porta própria (MariaDB pelo @sgh/nucleo) quando o núcleo existe; a de memória só em dev/ci com
// as fontes sintéticas; fora disso, a porta indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L.
// O PDF das demonstrações sai pelo Gotenberg local (PDF/A). A liberação vem do módulo de configuração (global).
import { randomBytes } from 'node:crypto';
import type { DynamicModule } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { FONTE_CONFIGURACAO } from '../config/public-api.js';
import { converterHtmlEmPdfA } from '../documento/infra/gotenberg.js';
import { CIFRA_CPF_PESSOAS, CifraCpf, chaveCpfDoAmbiente } from '../pessoas/public-api.js';
import type { ContextoModulo } from '../registro.js';
import { ContabilController } from './contabil.controller.js';
import { ConsolidacaoController, NUCLEO_CONSOLIDACAO } from './consolidacao.controller.js';
import { DemonstracoesContabilController, GERADOR_PDF_CONTABIL } from './demonstracoes.controller.js';
import { LalurController } from './lalur.controller.js';
import { LancamentosContabilController } from './lancamentos.controller.js';
import { PORTA_CONTABIL, type PortaContabil } from './porta.js';
import { PortaContabilMemoria } from './porta-memoria.js';
import { portaContabilIndisponivel, PortaContabilPropria } from './porta-propria.js';

export interface OpcoesModuloContabil {
  /** Testes: a porta já montada. */
  readonly porta?: PortaContabil;
  /** Testes: a fonte da liberação e dos parâmetros. */
  readonly configuracao?: unknown;
  /** Testes: a cifra do arquivo SPED (null: sem cifra, a geração do SPED é recusada). */
  readonly cifra?: CifraCpf | null;
  /** Testes: o gerador de PDF (null: sem PDF). */
  readonly pdf?: ((html: string, titulo: string) => Promise<Uint8Array>) | null;
}

export function moduloContabil(ctx: ContextoModulo, opcoes: OpcoesModuloContabil = {}): DynamicModule {
  const memoria = !ctx.nucleo && fontesSinteticas(ctx.env);
  const porta: PortaContabil =
    opcoes.porta ??
    (ctx.nucleo
      ? new PortaContabilPropria(ctx.nucleo)
      : memoria
        ? new PortaContabilMemoria()
        : portaContabilIndisponivel());
  // A liberação (chaves contabil e contabil.sped) e os parâmetros vêm da FONTE_CONFIGURACAO global do módulo de
  // configuração (a mesma que a administração liga e desliga); uma fonte local só quando o teste a passa.
  const configuracao = opcoes.configuracao ?? null;
  // A cifra do arquivo SPED (traz o CPF dos signatários): a mesma chave do CPF do ambiente; em dev/ci sem chave, uma
  // chave do processo, como no módulo de pessoas.
  const chave = chaveCpfDoAmbiente(ctx.env) ?? (fontesSinteticas(ctx.env) ? randomBytes(32) : null);
  const cifra = opcoes.cifra !== undefined ? opcoes.cifra : chave ? new CifraCpf(chave) : null;
  const gotenberg = ctx.env['GOTENBERG_URL']?.trim() || 'http://127.0.0.1:3318';
  const pdf =
    opcoes.pdf !== undefined
      ? opcoes.pdf
      : async (html: string, titulo: string) =>
          (await converterHtmlEmPdfA(gotenberg, html, { metadados: { Title: titulo } })).pdf;
  return {
    module: class ModuloContabil {},
    controllers: [
      ContabilController,
      LancamentosContabilController,
      DemonstracoesContabilController,
      // C2-101 (07-FIN linha 127): consolidação gerencial de várias empresas.
      ConsolidacaoController,
      // C3-023 (07-FIN linha 115): LALUR/LACS e apuração e provisão do IRPJ e da CSLL do lucro real.
      LalurController,
    ],
    providers: [
      { provide: PORTA_CONTABIL, useValue: porta },
      { provide: NUCLEO_CONSOLIDACAO, useValue: ctx.nucleo ?? null },
      ...(pdf ? [{ provide: GERADOR_PDF_CONTABIL, useValue: pdf }] : []),
      ...(cifra ? [{ provide: CIFRA_CPF_PESSOAS, useValue: cifra }] : []),
      ...(configuracao ? [{ provide: FONTE_CONFIGURACAO, useValue: configuracao }] : []),
    ],
  };
}

export function modulo(ctx: ContextoModulo): DynamicModule {
  return moduloContabil(ctx);
}
