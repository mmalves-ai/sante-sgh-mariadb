// Módulo da assinatura ICP-Brasil na API migrada (F2.2, lote 02-01): o serviço isolado (vincular certificado,
// assinar o hash, política e provedores com o segredo no cofre), a assinatura dos documentos do prontuário, a entrada
// com certificado A1/A3 e o verificador público.
// - Com núcleo e cliente: a PortaAssinaturaPropria sobre o banco do cliente; o verificador procura nos
//   estabelecimentos ativos do cliente, lidos do banco na consulta com cache curto (nenhum I/O de banco na montagem:
//   o banco fora do ar não derruba a subida da API, só o verificador responde 503; o estabelecimento novo entra sem
//   reiniciar).
// - Sem núcleo, só em dev/ci (fontesSinteticas): a porta em memória com o simulador do provedor, da ACT e da LCR.
// - Fora disso: a porta indisponível (503 em tudo).
// O conteúdo do documento a assinar (FONTE_CONTEUDO_ICP) e o armazém do PDF (ARMAZEM_PDF_ICP) vêm do módulo de
// documentos quando ele estiver montado; sem eles, a prévia e o PDF assinado respondem indisponível.
import { type DynamicModule, Module } from '@nestjs/common';
import { chaveMestra } from '@sgh/dominio-acesso';
import { fontesSinteticas } from '../../sessao/montar.js';
import { SERVICO_LOGIN_CERTIFICADO } from '../acesso/acesso.controller.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { PORTA_DOCUMENTOS, type PortaDocumentos } from '../pep/documentos-porta.js';
import { PortaDocumentosMemoria } from '../pep/documentos-porta-memoria.js';
import { LiberacaoPep } from '../pep/liberacao-pep.js';
import type { ContextoModulo } from '../registro.js';
import {
  type ArmazemPdfIcp,
  type ConfigDocumentosIcp,
  type FonteConteudoIcp,
  ServicoAssinaturaDocumentos,
} from './aplicacao/documentos.js';
import { ServicoLoginCertificado } from './aplicacao/login-certificado.js';
import { type ConfigServicoAssinatura, ServicoAssinaturaIcp } from './aplicacao/servico.js';
import { estabelecimentosDoVerificador, ServicoVerificador } from './aplicacao/verificador.js';
import { AssinaturaIcpController, CONFIG_ASSINATURA_ICP } from './assinatura.controller.js';
import { AssinaturaDocumentosController } from './assinatura-documentos.controller.js';
import { configAssinaturaDoAmbiente } from './infra/ambiente.js';
import { configDocumentosIcpDoAmbiente } from './infra/documentos-ambiente.js';
import { SimuladorSncr } from './infra/simulador-sncr.js';
import { PORTA_ASSINATURA_ICP, type PortaAssinaturaIcp, portaAssinaturaIndisponivel } from './porta.js';
import { type DocumentosMemoriaIcp, PortaAssinaturaMemoria } from './porta-memoria.js';
import { PortaAssinaturaPropria } from './porta-propria.js';
import {
  ARMAZEM_PDF_ICP,
  CONFIG_DOCUMENTOS_ICP,
  FONTE_CONTEUDO_ICP,
  SERVICO_ASSINATURA_ICP,
  SERVICO_DOCUMENTOS_ICP,
} from './simbolos.js';
import { SERVICO_VERIFICADOR, VerificadorController } from './verificador.controller.js';

export interface OpcoesModuloAssinatura {
  /** Porta pronta (testes). */
  readonly porta?: PortaAssinaturaIcp;
  /** Configuração do serviço pronta (testes: o simulador e o cofre). */
  readonly config?: ConfigServicoAssinatura;
  /** Estabelecimentos onde o verificador procura (testes). */
  readonly estabelecimentos?: readonly string[];
}

/** Validade da lista de estabelecimentos do verificador lida do banco. */
export const CACHE_ESTABELECIMENTOS_MS = 60_000;

/** A leitura dos estabelecimentos ativos com cache curto; a falha não fica no cache. */
export function estabelecimentosComCache(
  ler: () => Promise<readonly string[]>,
  ms = CACHE_ESTABELECIMENTOS_MS,
  agora: () => number = Date.now,
): () => Promise<readonly string[]> {
  let cache: { ate: number; lista: Promise<readonly string[]> } | null = null;
  return () => {
    const t = agora();
    if (!cache || cache.ate <= t) {
      const lista = ler();
      const novo = { ate: t + ms, lista };
      cache = novo;
      lista.catch(() => {
        if (cache === novo) cache = null;
      });
    }
    return cache.lista;
  };
}

/**
 * W0-10: os documentos do prontuário da sessão sintética (a porta em memória do PEP), ligados na montagem do Nest pelo
 * provedor LIGACAO_DOCUMENTOS_MEMORIA (o PEP é global e monta a porta dele à parte). Sem a ligação, a fila do autor sai
 * vazia, como no boot antigo sem o PEP.
 */
class DocumentosMemoriaLigados implements DocumentosMemoriaIcp {
  alvo: PortaDocumentosMemoria | null = null;
  todos(hospital: string) {
    return this.alvo?.documentosParaIcp(hospital) ?? [];
  }
  marcarAssinadoIcp(hospital: string, documento: number) {
    this.alvo?.marcarAssinadoIcp(hospital, documento);
  }
}

const LIGACAO_DOCUMENTOS_MEMORIA = Symbol('LIGACAO_DOCUMENTOS_MEMORIA');

/** A porta da assinatura pela regra do módulo. */
export function portaDaAssinatura(
  ctx: ContextoModulo,
  documentos: DocumentosMemoriaIcp | null = null,
): PortaAssinaturaIcp {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) return new PortaAssinaturaPropria(ctx.nucleo, cliente);
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaAssinaturaMemoria(documentos);
  return portaAssinaturaIndisponivel();
}

@Module({})
export class ModuloAssinatura {}

export async function modulo(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloAssinatura = {},
): Promise<DynamicModule> {
  const env = ctx.env as NodeJS.ProcessEnv;
  const documentosMemoria = new DocumentosMemoriaLigados();
  const porta = opcoes.porta ?? portaDaAssinatura(ctx, documentosMemoria);
  const sintetico = fontesSinteticas(ctx.env);
  const config =
    opcoes.config ??
    (await configAssinaturaDoAmbiente(
      env,
      sintetico,
      chaveMestra(env['PLATAFORMA_CHAVE_MESTRA']),
      process.cwd(),
    ));
  const estabelecimentos: readonly string[] | (() => Promise<readonly string[]>) = opcoes.estabelecimentos
    ? estabelecimentosDoVerificador(opcoes.estabelecimentos, null)
    : porta instanceof PortaAssinaturaPropria
      ? estabelecimentosComCache(() => porta.estabelecimentosAtivos())
      : [];
  const rede = ctx.configuracao.rede ?? 'rede-sintetica';
  return {
    module: ModuloAssinatura,
    // Global: a fila de assinatura remota do portal do médico externo (W0-10, M6) usa o serviço deste módulo.
    global: true,
    controllers: [AssinaturaIcpController, AssinaturaDocumentosController, VerificadorController],
    providers: [
      { provide: PORTA_ASSINATURA_ICP, useValue: porta },
      { provide: CONFIG_ASSINATURA_ICP, useValue: config },
      {
        provide: SERVICO_ASSINATURA_ICP,
        useFactory: (fonte: FonteConfiguracao | null) =>
          new ServicoAssinaturaIcp(porta, ctx.trilha, config, fonte),
        inject: [{ token: FONTE_CONFIGURACAO, optional: true }],
      },
      {
        provide: SERVICO_LOGIN_CERTIFICADO,
        useFactory: (icp: ServicoAssinaturaIcp, fonte: FonteConfiguracao | null) =>
          new ServicoLoginCertificado(icp, porta, ctx.armazem, fonte, ctx.trilha),
        inject: [SERVICO_ASSINATURA_ICP, { token: FONTE_CONFIGURACAO, optional: true }],
      },
      {
        provide: CONFIG_DOCUMENTOS_ICP,
        useValue: configDocumentosIcpDoAmbiente(
          env,
          config.modo === 'simulador' ? new SimuladorSncr() : null,
        ),
      },
      {
        provide: LIGACAO_DOCUMENTOS_MEMORIA,
        useFactory: (documentos: PortaDocumentos | null) => {
          if (documentos instanceof PortaDocumentosMemoria) documentosMemoria.alvo = documentos;
          return documentosMemoria;
        },
        inject: [{ token: PORTA_DOCUMENTOS, optional: true }],
      },
      {
        provide: SERVICO_DOCUMENTOS_ICP,
        useFactory: (
          icp: ServicoAssinaturaIcp,
          cfg: ConfigDocumentosIcp,
          fonte: FonteConteudoIcp | null,
          armazem: ArmazemPdfIcp | null,
          configuracao: FonteConfiguracao | null,
          cache: CacheConfig | null,
        ) =>
          new ServicoAssinaturaDocumentos(
            icp,
            porta,
            fonte ?? null,
            armazem ?? null,
            new LiberacaoPep(configuracao ?? null, cache ?? null),
            cfg,
          ),
        inject: [
          SERVICO_ASSINATURA_ICP,
          CONFIG_DOCUMENTOS_ICP,
          { token: FONTE_CONTEUDO_ICP, optional: true },
          { token: ARMAZEM_PDF_ICP, optional: true },
          { token: FONTE_CONFIGURACAO, optional: true },
          { token: CACHE_CONFIG, optional: true },
        ],
      },
      {
        provide: SERVICO_VERIFICADOR,
        useFactory: (cfg: { urlVerificador: string }, fonte: FonteConfiguracao | null) =>
          new ServicoVerificador(porta, ctx.armazem, fonte, {
            rede,
            estabelecimentos,
            endereco: cfg.urlVerificador,
          }),
        inject: [CONFIG_DOCUMENTOS_ICP, { token: FONTE_CONFIGURACAO, optional: true }],
      },
    ],
    // Global só para a fila do portal do médico externo: exporta só os três símbolos que ela usa. O login por
    // certificado e os demais provedores não vazam para o resto da API (a sessão do AcessoController volta a ser a de
    // antes de 6b18fddb).
    exports: [CONFIG_ASSINATURA_ICP, SERVICO_ASSINATURA_ICP, SERVICO_DOCUMENTOS_ICP],
  };
}
