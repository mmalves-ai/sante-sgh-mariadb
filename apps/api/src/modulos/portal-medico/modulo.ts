// Módulo do portal do médico externo (M50, etapa 3) na API migrada (F2.2): o portal (sessão do portal de resultados do
// SADT) e a tela interna das contas, sobre a porta própria (MariaDB pelo @sgh/nucleo) quando o núcleo existe; a de
// memória só em dev/ci com as fontes sintéticas (a situação e a credencial da conta vêm da memória do SADT); fora
// disso, a porta indisponível (503 em tudo, falha fechada) — a mesma regra do F2-L.
// Dependências (globais ou exportadas): SERVICO_PORTAL e PORTA_SADT (sadt), PORTA_CIRURGIA (cirurgia), PORTA_REPASSE
// (repasse), FONTE_CONFIGURACAO (config); "meus pacientes" usa SERVICO_DOCUMENTOS, PORTA_PRESCRICAO e PORTA_WORKLIST
// (pep) quando presentes (sem eles, 503 com o motivo). Sem sadt, cirurgia ou repasse, a partida recusa com a mensagem.
// A fila de assinatura remota (M49) usa o serviço dos documentos do módulo assinatura (global), quando montado.
// Pendência registrada: a vigia da notificação do crítico só roda na memória (com SADT_VIGIA_CRITICOS=sintetica, nos
// estabelecimentos sintéticos, como a vigia do SADT); no banco, o modelo da notificação por conta do portal ainda falta
// (OPERACOES_PENDENTES).
// Melhoria: o contexto do núcleo por id (cliente, estabelecimento e usuário) em toda leitura e gravação.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { lerEstabelecimentosSinteticos } from '../acesso/estabelecimentos-sinteticos.js';
import {
  CONFIG_ASSINATURA_ICP,
  type ConfigServicoAssinatura,
  SERVICO_ASSINATURA_ICP,
  SERVICO_DOCUMENTOS_ICP,
  type ServicoAssinaturaDocumentos,
  type ServicoAssinaturaIcp,
} from '../assinatura/public-api.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import type { PortaCirurgia } from '../cirurgia/public-api.js';
import { PORTA_CIRURGIA } from '../cirurgia/public-api.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { ServicoWorklistMedico } from '../pep/aplicacao/worklist-medico.js';
import { SERVICO_DOCUMENTOS } from '../pep/documentos.controller.js';
import type { ServicoDocumentos } from '../pep/documentos-servico.js';
import { PORTA_PRESCRICAO, type PortaPrescricao } from '../pep/prescricao-porta.js';
import { PORTA_WORKLIST, type PortaWorklist } from '../pep/worklist-porta.js';
import type { ContextoModulo } from '../registro.js';
import { PORTA_REPASSE, type PortaRepasse, ServicoRepasse } from '../repasse/public-api.js';
import { PORTA_SADT, type PortaSadt, SERVICO_PORTAL, type ServicoPortal } from '../sadt/public-api.js';
import { PortaSadtMemoria } from '../sadt/porta-memoria.js';
import { retornoDoPortalMedico } from './aplicacao/assinatura-remota.js';
import { canalMedicoDoAmbiente } from './aplicacao/canal.js';
import { ServicoPortalMedico } from './aplicacao/servico.js';
import { PORTA_PORTAL_MEDICO, type PortaPortalMedico } from './porta.js';
import { PortaPortalMedicoMemoria } from './porta-memoria.js';
import { portaPortalMedicoIndisponivel, PortaPortalMedicoPropria } from './porta-propria.js';
import { PortalMedicoController, SERVICO_PORTAL_MEDICO } from './portal-medico.controller.js';
import { PortalMedicoInternoController } from './portal-medico-interno.controller.js';

export interface OpcoesModuloPortalMedico {
  /** Testes: a porta já montada. */
  readonly porta?: PortaPortalMedico;
  /** Testes: liga a vigia da notificação do crítico nestes estabelecimentos (só na memória). */
  readonly hospitaisAvisoCritico?: readonly string[];
}

/** A porta pela regra do módulo (a memória precisa da porta do SADT para a situação e a credencial da conta). */
export async function portaDoPortalMedico(
  ctx: ContextoModulo,
  sadt: PortaSadt | null,
): Promise<PortaPortalMedico> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaPortalMedicoPropria(ctx.nucleo);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env) && sadt)
    return new PortaPortalMedicoMemoria(
      async (c, a) => (await sadt.acessoPorId(c, a))?.situacao ?? null,
      undefined,
      (c, a, x) => (sadt instanceof PortaSadtMemoria ? sadt.definirSituacaoAcesso(c, a, x) : undefined),
      (c, a, x) => (sadt instanceof PortaSadtMemoria ? sadt.definirCredencialAcesso(c, a, x) : undefined),
    );
  return portaPortalMedicoIndisponivel();
}

const exigir = <T>(v: T | null | undefined, modulo: string): T => {
  if (v === null || v === undefined)
    throw new Error(
      `O módulo portal-medico depende do módulo ${modulo} (inclua-o em API_MODULOS, montado como global ou exportando a porta).`,
    );
  return v;
};

@Module({})
export class ModuloPortalMedico {}

export async function moduloPortalMedico(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloPortalMedico = {},
): Promise<DynamicModule> {
  const rede = ctx.configuracao.rede ?? '';
  return {
    module: ModuloPortalMedico,
    controllers: [PortalMedicoController, PortalMedicoInternoController],
    providers: [
      {
        provide: PORTA_PORTAL_MEDICO,
        useFactory: (sadt: PortaSadt | null | undefined) =>
          opcoes.porta ?? portaDoPortalMedico(ctx, sadt ?? null),
        inject: [{ token: PORTA_SADT, optional: true }],
      },
      {
        provide: SERVICO_PORTAL_MEDICO,
        useFactory: (
          porta: PortaPortalMedico,
          sessoes: ServicoPortal | undefined,
          sadt: PortaSadt | undefined,
          cirurgia: PortaCirurgia | undefined,
          repasse: PortaRepasse | undefined,
          configuracao: FonteConfiguracao | undefined,
          documentos: ServicoDocumentos | undefined,
          prescricao: PortaPrescricao | undefined,
          worklist: PortaWorklist | undefined,
          documentosIcp: ServicoAssinaturaDocumentos | undefined,
          icp: ServicoAssinaturaIcp | undefined,
          cfgIcp: ConfigServicoAssinatura | undefined,
        ) => {
          const fonte = configuracao ?? null;
          const s = new ServicoPortalMedico(
            exigir(sessoes, 'sadt'),
            exigir(sadt, 'sadt'),
            porta,
            exigir(cirurgia, 'cirurgia'),
            new ServicoRepasse(exigir(repasse, 'repasse'), ctx.trilha, fonte, null),
            fonte,
            rede,
          );
          s.canal = canalMedicoDoAmbiente(ctx.configuracao.ambiente);
          s.pacientes =
            documentos && prescricao && worklist
              ? new ServicoWorklistMedico(documentos, prescricao, worklist)
              : null;
          // W0-10 (M6): a fila de assinatura remota pelo serviço dos documentos (M49), com o redirect_uri do portal.
          s.assinatura =
            documentosIcp && icp && cfgIcp
              ? {
                  retorno: retornoDoPortalMedico(cfgIcp.retorno),
                  fila: (x) => documentosIcp.fila(x),
                  prepararLote: (x, e) => documentosIcp.prepararLote(x, e),
                  pedir: (x, e, r) => documentosIcp.pedir(x, e, r),
                  concluir: (x, q, r) => icp.retornoPsc(x, q, r),
                }
              : null;
          // W0-10 (M5): na memória, onde roda a vigia do valor crítico do SADT (SADT_VIGIA_CRITICOS=sintetica).
          const vigiaSintetica =
            fontesSinteticas(ctx.env) && ctx.env['SADT_VIGIA_CRITICOS'] === 'sintetica'
              ? lerEstabelecimentosSinteticos(ctx.env).map((e) => e.codigo)
              : [];
          s.hospitaisAvisoCritico =
            porta.destino === 'memoria' ? (opcoes.hospitaisAvisoCritico ?? vigiaSintetica) : [];
          s.iniciarAvisosCriticos();
          return s;
        },
        inject: [
          PORTA_PORTAL_MEDICO,
          { token: SERVICO_PORTAL, optional: true },
          { token: PORTA_SADT, optional: true },
          { token: PORTA_CIRURGIA, optional: true },
          { token: PORTA_REPASSE, optional: true },
          { token: FONTE_CONFIGURACAO, optional: true },
          { token: SERVICO_DOCUMENTOS, optional: true },
          { token: PORTA_PRESCRICAO, optional: true },
          { token: PORTA_WORKLIST, optional: true },
          { token: SERVICO_DOCUMENTOS_ICP, optional: true },
          { token: SERVICO_ASSINATURA_ICP, optional: true },
          { token: CONFIG_ASSINATURA_ICP, optional: true },
        ],
      },
    ],
    exports: [PORTA_PORTAL_MEDICO, SERVICO_PORTAL_MEDICO],
  };
}

export function modulo(ctx: ContextoModulo): Promise<DynamicModule> {
  return moduloPortalMedico(ctx);
}
