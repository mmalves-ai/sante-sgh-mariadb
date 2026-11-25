// Módulo da qualidade na API migrada (F2.2, M48): a notificação de incidentes e a segurança do paciente (NSP), a CCIH, a
// notificação compulsória, a gestão da qualidade e a revisão de prontuários. Cada porta é a própria sobre o banco do
// cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci; fora disso, a indisponível (503, falha
// fechada). O resumo da sugestão resolvida é um HMAC com a chave derivada da chave mestra da plataforma (fora do banco);
// na sessão sintética, aleatória; sem ela fora de dev/ci, as sugestões ficam desligadas. Os testes passam as portas.
// Os indicadores do censo na gestão (o índice da internação) vêm do serviço da internação montado pela regra do módulo
// dela (a fonte própria com núcleo; a sintética só em dev/ci), como o atendimento.
// Pendente: a central de avisos (pendência de prontuário ao médico) entra quando o módulo do Início a exportar; até lá a
// revisão de prontuários registra a pendência sem o aviso no sino (o controlador a recebe como opcional).
import { randomBytes } from 'node:crypto';
import { type DynamicModule, Module } from '@nestjs/common';
import { chaveMestra } from '@sgh/dominio-acesso';
import { criarArmazemLocal, lerRaizArquivos } from '@sgh/nucleo';
import { fontesSinteticas } from '../../sessao/montar.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import { portaDoAtendimento } from '../atendimento/modulo.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { fonteDaInternacao } from '../internacao/modulo.js';
import {
  CONFIGURACAO_M16,
  ConfiguracaoM16,
  SERVICO_INTERNACAO,
  ServicoInternacao,
} from '../internacao/public-api.js';
import { PORTA_ATENDIMENTO, type PortaAtendimento } from '../atendimento/porta.js';
import type { ContextoModulo } from '../registro.js';
import { CENTRAL_AVISOS_QUALIDADE, type CentralAvisosQualidade } from './central-pendencias.js';
import { AgravoController } from './agravo.controller.js';
import { AnaliseCulturaController, PORTA_ANALISE_CULTURA } from './analise-cultura.controller.js';
import { PortaAnaliseCulturaPropria } from './porta-analise-cultura-propria.js';
import { CcihController } from './ccih.controller.js';
import { GestaoQualidadeController } from './gestao.controller.js';
import { NotificacaoController } from './notificacao.controller.js';
import { PORTA_QUALIDADE, type PortaQualidade, portaQualidadeIndisponivel } from './porta.js';
import { PORTA_AGRAVO, type PortaAgravo, portaAgravoIndisponivel } from './porta-agravo.js';
import { PortaAgravoMemoria } from './porta-agravo-memoria.js';
import { PortaAgravoPropria } from './porta-agravo-propria.js';
import { PORTA_CCIH, type PortaCcih, portaCcihIndisponivel } from './porta-ccih.js';
import { PortaCcihMemoria } from './porta-ccih-memoria.js';
import { PortaCcihPropria } from './porta-ccih-propria.js';
import { PORTA_GESTAO, type PortaGestao, portaGestaoIndisponivel } from './porta-gestao.js';
import { PortaGestaoMemoria } from './porta-gestao-memoria.js';
import { PortaGestaoPropriaCompleta } from './gestao-porta-propria-completa.js';
import { PortaQualidadeMemoria } from './porta-memoria.js';
import { PortaQualidadePropria } from './porta-propria.js';
import { RevisaoProntuarioController } from './revisao-prontuario.controller.js';
import { SegurancaPacienteController } from './seguranca.controller.js';
import { RESUMO_SUGESTAO, ResumoSugestao } from './servico-seguranca.js';

export interface PortasQualidade {
  readonly qualidade: PortaQualidade;
  readonly ccih: PortaCcih;
  readonly agravo: PortaAgravo;
  readonly gestao: PortaGestao;
}

export interface OpcoesModuloQualidade extends Partial<PortasQualidade> {
  /** Resumo da sugestão resolvida (testes; null: sugestões desligadas). */
  readonly resumoSugestao?: ResumoSugestao | null;
  /** Porta do atendimento (os indicadores da gestão; testes). */
  readonly atendimento?: PortaAtendimento;
  /** Serviço da internação (os indicadores do censo na gestão; testes). */
  readonly internacao?: ServicoInternacao | null;
  /** Central de avisos (a pendência de prontuário ao médico; testes, até o Início exportá-la). */
  readonly centralAvisos?: CentralAvisosQualidade | null;
}

/** As portas da qualidade pela regra do módulo (sem as opções de teste). */
export async function portasDaQualidade(ctx: ContextoModulo): Promise<PortasQualidade> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return {
      qualidade: new PortaQualidadePropria(ctx.nucleo),
      ccih: new PortaCcihPropria(ctx.nucleo),
      agravo: new PortaAgravoPropria(ctx.nucleo),
      // Os envios regulatórios com o arquivo guardado no disco da instalação (ADR 0004); sem ARQUIVOS_RAIZ, gerar o
      // envio recusa 409 modelo-pendente.
      gestao: new PortaGestaoPropriaCompleta(
        ctx.nucleo,
        lerRaizArquivos(ctx.env) ? criarArmazemLocal(ctx.nucleo, { env: ctx.env }) : null,
      ),
    };
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env))
    return {
      qualidade: PortaQualidadeMemoria.sintetica(),
      ccih: new PortaCcihMemoria(),
      agravo: new PortaAgravoMemoria(),
      gestao: new PortaGestaoMemoria(),
    };
  return {
    qualidade: portaQualidadeIndisponivel(),
    ccih: portaCcihIndisponivel(),
    agravo: portaAgravoIndisponivel(),
    gestao: portaGestaoIndisponivel(),
  };
}

@Module({})
export class ModuloQualidade {}

export async function modulo(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloQualidade = {},
): Promise<DynamicModule> {
  const faltam = !opcoes.qualidade || !opcoes.ccih || !opcoes.agravo || !opcoes.gestao;
  const padrao = faltam ? await portasDaQualidade(ctx) : null;
  const mestra =
    chaveMestra(ctx.env['PLATAFORMA_CHAVE_MESTRA']) ?? (fontesSinteticas(ctx.env) ? randomBytes(32) : null);
  const resumo =
    opcoes.resumoSugestao !== undefined ? opcoes.resumoSugestao : mestra ? new ResumoSugestao(mestra) : null;
  const atendimento = opcoes.atendimento ?? (await portaDoAtendimento(ctx));
  const internacao =
    opcoes.internacao !== undefined
      ? opcoes.internacao
      : new ServicoInternacao(await fonteDaInternacao(ctx), null);
  return {
    module: ModuloQualidade,
    controllers: [
      NotificacaoController,
      SegurancaPacienteController,
      CcihController,
      AnaliseCulturaController,
      AgravoController,
      GestaoQualidadeController,
      RevisaoProntuarioController,
    ],
    providers: [
      { provide: PORTA_QUALIDADE, useValue: opcoes.qualidade ?? padrao?.qualidade },
      { provide: PORTA_CCIH, useValue: opcoes.ccih ?? padrao?.ccih },
      // A análise da cultura positiva (F7, 09-AREA linha 68): só a porta própria; sem banco, a rota responde 503.
      {
        provide: PORTA_ANALISE_CULTURA,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao ? new PortaAnaliseCulturaPropria(ctx.nucleo) : null,
      },
      { provide: PORTA_AGRAVO, useValue: opcoes.agravo ?? padrao?.agravo },
      { provide: PORTA_GESTAO, useValue: opcoes.gestao ?? padrao?.gestao },
      { provide: RESUMO_SUGESTAO, useValue: resumo },
      // Os indicadores da gestão que vêm do atendimento (retorno ao PA, permanência): a porta pela regra do módulo dele.
      { provide: PORTA_ATENDIMENTO, useValue: atendimento },
      // Os indicadores do censo (M16) na competência da gestão.
      ...(internacao
        ? [
            { provide: SERVICO_INTERNACAO, useValue: internacao },
            {
              provide: CONFIGURACAO_M16,
              useFactory: (cfg: FonteConfiguracao | null, cache: CacheConfig | null) =>
                new ConfiguracaoM16(cfg, cache),
              inject: [
                { token: FONTE_CONFIGURACAO, optional: true },
                { token: CACHE_CONFIG, optional: true },
              ],
            },
          ]
        : []),
      ...(opcoes.centralAvisos
        ? [{ provide: CENTRAL_AVISOS_QUALIDADE, useValue: opcoes.centralAvisos }]
        : []),
    ],
    exports: [PORTA_QUALIDADE, PORTA_CCIH, PORTA_AGRAVO, PORTA_GESTAO],
  };
}
