// Módulo dos catálogos oficiais (M13) na API migrada (F2.2 onda 2): painel de cargas, envio (preparação, validação e
// comparação), aprovação, rejeição e cancelamento, consulta paginada e histórico SIGTAP.
// - Com núcleo e cliente: a FonteCatalogosPropria sobre o banco do cliente (área de preparação pelo Executor).
// - Sem núcleo, só em dev/ci (fontesSinteticas): a fonte em memória com os catálogos sintéticos.
// - Fora disso: a fonte indisponível (503 em tudo; nunca a memória).
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import type { ContextoModulo } from '../registro.js';
import { CatalogosController } from './catalogos.controller.js';
import { FONTE_CATALOGOS, type FonteCatalogos, fonteCatalogosIndisponivel } from './fonte.js';
import { FonteCatalogosMemoria } from './fonte-memoria.js';
import { guardarArquivoCatalogo } from './guardar-arquivo.js';
import { FonteCatalogosPropria } from './porta-propria.js';
import { SERVICO_CATALOGOS, ServicoCatalogos } from './servico.js';

export interface OpcoesModuloCatalogos {
  /** Fonte pronta (testes). */
  readonly fonte?: FonteCatalogos;
}

/** A fonte dos catálogos pela regra do módulo. */
export function fonteDosCatalogos(ctx: ContextoModulo): FonteCatalogos {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) return new FonteCatalogosPropria(ctx.nucleo, cliente);
  if (!ctx.nucleo && fontesSinteticas(ctx.env))
    return new FonteCatalogosMemoria(async (t) => {
      await ctx.trilha.registrar({
        evento: t.evento,
        rede: t.rede,
        hospital: t.hospital,
        usuario: t.usuario,
        estacao: t.estacao ?? '',
        correlacao: t.correlacao,
        recurso: t.recurso,
        resultado: 'sucesso',
        tabelaAlvo: t.tabelaAlvo,
        idAlvo: t.idAlvo,
        ...(t.chaveNaturalAlvo ? { chaveNaturalAlvo: t.chaveNaturalAlvo } : {}),
      });
    });
  return fonteCatalogosIndisponivel();
}

@Module({})
export class ModuloCatalogos {}

export function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloCatalogos = {}): DynamicModule {
  const fonte = opcoes.fonte ?? fonteDosCatalogos(ctx);
  // O original da carga vai ao armazenamento com retenção só com o banco (na memória, nada sai do processo).
  const guardar = fonte.destino === 'banco' ? guardarArquivoCatalogo(ctx.configuracao, ctx.env) : undefined;
  const servico = new ServicoCatalogos(fonte, {
    ambiente: ctx.configuracao.ambiente,
    janela: ctx.env['CATALOGO_JANELA_PUBLICACAO'] ?? null,
    ...(guardar ? { guardarArquivo: guardar } : {}),
  });
  return {
    module: ModuloCatalogos,
    controllers: [CatalogosController],
    providers: [
      { provide: FONTE_CATALOGOS, useValue: fonte },
      { provide: SERVICO_CATALOGOS, useValue: servico },
    ],
    exports: [FONTE_CATALOGOS, SERVICO_CATALOGOS],
  };
}
