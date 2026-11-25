// Módulo do faturamento SUS próprio na API migrada (F2.2 onda 3, M51): competência, crítica prévia, CIHA, BPA, APAC,
// AIH (faixa, laudo, espelho, retorno) e a equivalência SIGTAP. A porta é a própria sobre o banco do cliente quando o
// núcleo existe; sem núcleo, a memória sintética só em dev/ci; fora disso, a indisponível (503, falha fechada). O
// arquivo exportado (tem dado pessoal) vai ao disco local, sob a raiz de arquivos, como o TISS (ADR 0004); na memória,
// à memória.
// Os testes passam a porta e o armazém pelas opções.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import type { ContextoModulo } from '../registro.js';
import { localizadorDoNucleo } from '../tiss/armazem-xml.js';
import { LeitosUtiSusController } from './leitos-uti.controller.js';
import { EstabelecimentoSusController } from './estabelecimento-sus.controller.js';
import { PORTA_ESTABELECIMENTO_SUS, PortaEstabelecimentoSusPropria } from './estabelecimento-sus-propria.js';
import { LaudoInternacaoSusController } from './laudo-internacao-sus.controller.js';
import { ContaAihComplementoController } from './conta-aih-complemento.controller.js';
import {
  PORTA_CONTA_AIH_COMPLEMENTO,
  PortaContaAihComplementoPropria,
} from './conta-aih-complemento-propria.js';
import {
  PORTA_LAUDO_INTERNACAO_SUS,
  PortaLaudoInternacaoSusPropria,
} from './laudo-internacao-sus-propria.js';
import { PORTA_LEITOS_UTI, PortaLeitosUtiPropria } from './leitos-uti-propria.js';
import { armazemSusLocal, armazemSusMemoria } from './armazem.js';
import { PORTA_SUS, type PortaSus, portaSusIndisponivel } from './porta.js';
import { PortaSusMemoria } from './porta-memoria.js';
import { PortaSusPropria } from './porta-propria.js';
import { ApacComplementosController } from './apac-complementos.controller.js';
import { PORTA_APAC_COMPLEMENTOS, PortaApacComplementosPropria } from './apac-complementos-propria.js';
import { ProgramacaoSusController } from './programacao.controller.js';
import { RaasSusController } from './raas.controller.js';
import { PORTA_RAAS, PortaRaasPropria } from './raas-propria.js';
import { PORTA_PROGRAMACAO_SUS, PortaProgramacaoSusPropria } from './programacao-propria.js';
import type { ArmazemArquivoSus } from './servico.js';
import { ENVIADOR_SERVICO_WEB_SUS, enviadorServicoWebSusDoAmbiente } from './servico-web-enviador.js';
import { NUCLEO_SERVICO_WEB_SUS, ServicoWebSusController } from './servico-web.controller.js';
import { SusAihController } from './sus-aih.controller.js';
import { TransplanteSusController } from './transplante.controller.js';
import { PORTA_TRANSPLANTE, PortaTransplantePropria } from './transplante-propria.js';
import { ARMAZEM_ARQUIVO_SUS, SusController } from './sus.controller.js';

export interface OpcoesModuloSus {
  /** Porta pronta (testes). */
  readonly porta?: PortaSus;
  readonly armazem?: ArmazemArquivoSus;
}

/** A porta do faturamento SUS pela regra do módulo (sem as opções de teste). */
export function portaDoSus(ctx: ContextoModulo): PortaSus {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) return new PortaSusPropria(ctx.nucleo, cliente);
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) return new PortaSusMemoria();
  return portaSusIndisponivel();
}

/** O armazém do arquivo exportado: o disco local quando a porta é a do banco; senão, a memória. */
export function armazemDoSus(ctx: ContextoModulo, porta: PortaSus): ArmazemArquivoSus {
  if (porta.destino !== 'banco') return armazemSusMemoria();
  return armazemSusLocal(localizadorDoNucleo(ctx.nucleo, ctx.env), ctx.configuracao.clientePadrao ?? '');
}

@Module({})
export class ModuloSus {}

export function modulo(ctx: ContextoModulo, opcoes: OpcoesModuloSus = {}): DynamicModule {
  const porta = opcoes.porta ?? portaDoSus(ctx);
  const armazem = opcoes.armazem ?? armazemDoSus(ctx, porta);
  return {
    module: ModuloSus,
    controllers: [
      SusController,
      SusAihController,
      ServicoWebSusController,
      LeitosUtiSusController,
      EstabelecimentoSusController,
      LaudoInternacaoSusController,
      ContaAihComplementoController,
      TransplanteSusController,
      ProgramacaoSusController,
      ApacComplementosController,
      RaasSusController,
    ],
    providers: [
      { provide: PORTA_SUS, useValue: porta },
      { provide: ARMAZEM_ARQUIVO_SUS, useValue: armazem },
      // F7 (08-INTG linha 131): serviço web do SUS; o simulador fora de produção (regra 6).
      { provide: NUCLEO_SERVICO_WEB_SUS, useValue: ctx.nucleo ?? null },
      { provide: ENVIADOR_SERVICO_WEB_SUS, useValue: enviadorServicoWebSusDoAmbiente(ctx.env) },
      // F7 (06-SUS linha 57): laudo de internação SUS (devolução, reenvio, laudo especial, impressão e lote).
      {
        provide: PORTA_LAUDO_INTERNACAO_SUS,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaLaudoInternacaoSusPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F7 (06-SUS linha 58): equipe, diagnósticos secundários e incrementos da conta da AIH.
      {
        provide: PORTA_CONTA_AIH_COMPLEMENTO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaContaAihComplementoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F7 (06-SUS linha 59): leitos de UTI habilitados por tipo e vigência (só com o banco do cliente).
      {
        provide: PORTA_LEITOS_UTI,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaLeitosUtiPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F7 (06-SUS linha 61): habilitações, serviços e regras por tipo de prestador do estabelecimento.
      {
        provide: PORTA_ESTABELECIMENTO_SUS,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaEstabelecimentoSusPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F8 (06-SUS linha 65): notificação de doador e inscrição de receptor para a central de transplantes.
      {
        provide: PORTA_TRANSPLANTE,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaTransplantePropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F7 (06-SUS linha 54): programação físico-orçamentária, tetos e cotas (a crítica consulta o saldo).
      {
        provide: PORTA_PROGRAMACAO_SUS,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaProgramacaoSusPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F7 (06-SUS linha 56): laudos específicos (oncologia, auditiva, medicamento, odontologia) e sessões da APAC.
      {
        provide: PORTA_APAC_COMPLEMENTOS,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaApacComplementosPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // F8 (06-SUS linha 64): RAAS da atenção psicossocial e domiciliar (registro, crítica e remessa).
      {
        provide: PORTA_RAAS,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new PortaRaasPropria(ctx.nucleo, ctx.configuracao.clientePadrao, armazem)
            : null,
      },
    ],
    exports: [PORTA_SUS, ARMAZEM_ARQUIVO_SUS],
  };
}
