// Boot mínimo da API (F2-L): sessão, autorização e sistema sobre o banco do cliente pelo @sgh/nucleo, sem o boot antigo.
// Monta só:
// - saúde e versão (SistemaController);
// - a porta de entrada (AcessoController) com o ServicoSessao sobre a fonte própria (ou a sintética em dev/ci);
// - a autorização global (GuardaPermissao, ResolvedorSessao) e a auditoria (@Auditar → InterceptadorAuditoria), com
//   a trilha própria do cliente (trilha_auditoria) quando a fonte é a própria.
// Por cima, os módulos migrados que API_MODULOS pede (modulos/registro.ts). O app.module.ts fica como referência para
// desmontar, fora do grafo do build. A entrada com certificado, o "Esqueci a senha" e a troca rápida dependem de
// módulos ainda não migrados (configuração e assinatura): ficam fora e respondem 501.
import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { NucleoProprio } from '@sgh/nucleo';
import { InterceptadorAuditoria } from './autorizacao/auditoria.interceptor.js';
import { GuardaPermissao } from './autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, ResolvedorSessao } from './autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from './autorizacao/simbolos.js';
import { type RegistradorTrilha, RegistradorTrilhaMemoria } from './autorizacao/trilha.js';
import { RegistradorTrilhaPropria } from './autorizacao/trilha-propria.js';
import { CONFIGURACAO, type Configuracao } from './configuracao.js';
import { logger } from './logger.js';
import {
  AcessoController,
  RESOLVEDOR_REDE,
  SERVICO_SESSAO,
  SERVICOS_NAO_MIGRADOS,
  type ServicoOpcionalAcesso,
  SESSAO_SINTETICA,
} from './modulos/acesso/acesso.controller.js';
import { SessaoSintetica } from './modulos/acesso/sessao-sintetica.js';
import {
  portaSenhaDoNucleo,
  portaSenhaMemoria,
  type PortaSenha,
} from './modulos/acesso/senha/porta-senha.js';
import { type CarregadorModulo, carregarModulos } from './modulos/registro.js';
import { ArmazemMemoria, type ArmazemSessao } from './sessao/armazem.js';
import type { FonteAcesso } from './sessao/fonte-acesso.js';
import { FontePlataformaPropria, nucleoPlataforma } from './sessao/fonte-plataforma.js';
import { criarFonteAcessoPropria } from './sessao/fonte-propria.js';
import type { FontePlataforma } from './sessao/tipos-acesso.js';
import { fonteAcessoEfetiva, fontesSinteticas, montarServicoSessao } from './sessao/montar.js';
import { ResolvedorRedeConfigurado } from './sessao/rede.js';
import type { ServicoSessao } from './sessao/servico-sessao.js';
import { SistemaController } from './sistema.controller.js';
import { VersaoService } from './versao.service.js';

/** O NucleoProprio do processo (null em dev/ci sem banco e nos testes), para os módulos migrados. */
export const NUCLEO_PROPRIO = Symbol('NUCLEO_PROPRIO');

/** Serviços da porta de entrada que dependem de módulos ainda não migrados (respondem 501). */
export const NAO_MIGRADOS_F2L: ReadonlySet<ServicoOpcionalAcesso> = new Set([
  'certificado',
  'recuperacao',
  'trocaRapida',
]);

export interface OpcoesAppBase {
  /** Armazém das sessões (padrão: memória; o servidor passa o Valkey). */
  readonly armazem?: ArmazemSessao;
  /** Serviço de sessão já montado (testes); null desliga o login (503). */
  readonly servico?: ServicoSessao | null;
  /** Fonte de acesso (testes); padrão: a própria sobre o núcleo, quando o núcleo existe e a fonte efetiva é a própria. */
  readonly fonteAcesso?: FonteAcesso | null;
  /** Registrador da trilha (padrão: a própria do cliente com a fonte própria; memória na sintética). */
  readonly trilha?: RegistradorTrilha;
  /** Registro dos módulos migrados (padrão: modulos/registro.ts). */
  readonly registro?: Readonly<Record<string, CarregadorModulo>>;
  /** Fonte do login do administrador da plataforma (testes); padrão: a do banco plataforma pelo núcleo. */
  readonly plataforma?: FontePlataforma;
  /** Fecha os pools do núcleo no desligamento da app (o main.ts liga; os testes cuidam do próprio núcleo). */
  readonly encerrarNucleo?: boolean;
}

const aviso = (mensagem: string, campos: Record<string, unknown>): void => logger.warn(campos, mensagem);

@Injectable()
class EncerramentoNucleo implements OnApplicationShutdown {
  constructor(@Optional() @Inject(NUCLEO_PROPRIO) private readonly nucleo: NucleoProprio | null = null) {}

  async onApplicationShutdown(): Promise<void> {
    await this.nucleo?.encerrar();
  }
}

@Module({})
export class AppBaseModule {
  /**
   * Mesma assinatura do AppModule.com de referência, com o NucleoProprio no lugar do núcleo antigo. Assíncrono: a fonte
   * própria lê os estabelecimentos do cliente antes de servir, e os módulos migrados são importados sob demanda.
   * Lança (a partida é recusada) sem CLIENTE_PADRAO ou REDE_PADRAO com a fonte própria, ou com API_MODULOS inválido.
   */
  static async com(
    configuracao: Configuracao,
    nucleo: NucleoProprio | null = null,
    env: NodeJS.ProcessEnv = process.env,
    opcoes: OpcoesAppBase = {},
  ): Promise<DynamicModule> {
    const armazem = opcoes.armazem ?? new ArmazemMemoria();
    const real: FonteAcesso | null =
      opcoes.fonteAcesso !== undefined
        ? opcoes.fonteAcesso
        : nucleo && fonteAcessoEfetiva(env, true) === 'propria'
          ? await criarFonteAcessoPropria(nucleo, env, aviso)
          : null;
    const propria = real !== null && !fontesSinteticas(env, true);
    const cliente = env['CLIENTE_PADRAO']?.trim() || null;
    const trilha: RegistradorTrilha =
      opcoes.trilha ??
      (propria && nucleo && cliente
        ? new RegistradorTrilhaPropria(nucleo, cliente)
        : new RegistradorTrilhaMemoria());
    // Troca de senha: com o banco, a operação do Executor (credencial, histórico e trilha numa transação); na fonte
    // sintética, em memória (nada no banco).
    let senha: PortaSenha | undefined;
    if (propria && nucleo && cliente) {
      const executor = nucleo.criarExecutor({ log: aviso });
      senha = portaSenhaDoNucleo(nucleo, () => executor, cliente);
    } else if (fontesSinteticas(env, real !== null)) {
      senha = portaSenhaMemoria();
    }
    // Decisão do dono (b): o login do administrador da plataforma (credencial no banco plataforma), só com a fonte
    // própria e o núcleo que lê o banco plataforma; sem ele, a entrada da plataforma responde 503.
    let plataforma: FontePlataforma | undefined = opcoes.plataforma ?? undefined;
    if (plataforma === undefined && propria && nucleo && cliente) {
      const np = nucleoPlataforma(nucleo);
      if (np) plataforma = new FontePlataformaPropria(np, () => new Date(), aviso);
      else aviso('núcleo sem acesso ao banco plataforma: entrada da plataforma indisponível', {});
    }
    const servico =
      opcoes.servico !== undefined
        ? opcoes.servico
        : montarServicoSessao(env, real, armazem, trilha, aviso, {
            ...(senha ? { senha } : {}),
            ...(plataforma ? { plataforma } : {}),
          });
    // A trava da sintética olha o NÚCLEO (o banco do cliente), não a fonte de acesso: com o núcleo em AMBIENTE=dev e
    // ACESSO_FONTE_DEV=sintetica, a sessão sintética (papéis de administrador) só vale com SESSAO_SINTETICA=sim.
    const sintetica = new SessaoSintetica(env, { nucleoReal: nucleo !== null || real !== null });
    const resolvedorRede = new ResolvedorRedeConfigurado(env);
    const resolvedorSessao = new ResolvedorSessao(
      servico,
      sintetica,
      resolvedorRede,
      !['dev', 'ci'].includes(configuracao.ambiente),
    );
    const modulos = await carregarModulos(
      { configuracao, nucleo, env, armazem, servico, trilha },
      opcoes.registro,
    );
    return {
      module: AppBaseModule,
      // Os módulos migrados injetam a configuração, a sessão, a trilha e o núcleo da base.
      global: true,
      imports: modulos,
      controllers: [SistemaController, AcessoController],
      providers: [
        { provide: CONFIGURACAO, useValue: configuracao },
        { provide: NUCLEO_PROPRIO, useValue: nucleo },
        { provide: SERVICO_SESSAO, useValue: servico },
        { provide: SESSAO_SINTETICA, useValue: sintetica },
        { provide: RESOLVEDOR_REDE, useValue: resolvedorRede },
        { provide: SERVICOS_NAO_MIGRADOS, useValue: NAO_MIGRADOS_F2L },
        { provide: RESOLVEDOR_SESSAO, useValue: resolvedorSessao },
        { provide: REGISTRADOR_TRILHA, useValue: trilha },
        { provide: APP_GUARD, useClass: GuardaPermissao },
        { provide: APP_INTERCEPTOR, useClass: InterceptadorAuditoria },
        VersaoService,
        ...(opcoes.encerrarNucleo && nucleo ? [EncerramentoNucleo] : []),
      ],
      exports: [
        CONFIGURACAO,
        NUCLEO_PROPRIO,
        SERVICO_SESSAO,
        SESSAO_SINTETICA,
        RESOLVEDOR_REDE,
        RESOLVEDOR_SESSAO,
        REGISTRADOR_TRILHA,
      ],
    };
  }
}
