// Módulo do atendimento externo na API migrada (F2.2): recepção ambulatorial, consultório e pronto atendimento. A porta
// é a própria sobre o banco do cliente quando o núcleo existe; sem núcleo, a memória sintética só em dev/ci; fora
// disso, a indisponível (503, falha fechada). Os testes passam a porta pelas opções.
import { type DynamicModule, Module } from '@nestjs/common';
import { fontesSinteticas } from '../../sessao/montar.js';
import { IMPRESSAO_IDENTIFICACAO } from '../administracao/impressao-identificacao-emissao.js';
import { ImpressaoIdentificacaoPropria } from '../administracao/impressao-identificacao-propria.js';
import { ligarMapaEstabelecimentos } from '../cadastro/contexto-nucleo.js';
import { cadastroMemoriaAtual, PortaCadastroMemoria } from '../cadastro/porta-memoria.js';
import type { ContextoModulo } from '../registro.js';
import { AtendimentoController } from './atendimento.controller.js';
import { AVISOS_ATENDIMENTO, AvisosAtendimento } from './avisos.js';
import { ImpressaoIdentificacaoController } from './impressao-identificacao.controller.js';
import { LocaisAtendimentoPropria } from './locais-atendimento.js';
import { LOCAIS_ATENDIMENTO, LocaisAtendimentoController } from './locais-atendimento.controller.js';
import { PaController } from './pa.controller.js';
import { PORTA_ATENDIMENTO, type PortaAtendimento, portaAtendimentoIndisponivel } from './porta.js';
import { PortaAtendimentoMemoria } from './porta-memoria.js';
import { PortaAtendimentoPropria } from './porta-propria.js';
import { RegrasImpressaoPropria } from './regras-impressao.js';
import { REGRAS_IMPRESSAO, RegrasImpressaoController } from './regras-impressao.controller.js';

export interface OpcoesModuloAtendimento {
  /** Porta pronta (testes). */
  readonly porta?: PortaAtendimento;
}

/** A porta do atendimento pela regra do módulo (sem as opções de teste). */
export async function portaDoAtendimento(ctx: ContextoModulo): Promise<PortaAtendimento> {
  const cliente = ctx.configuracao.clientePadrao;
  if (ctx.nucleo && cliente) {
    await ligarMapaEstabelecimentos(cliente, ctx.nucleo);
    return new PortaAtendimentoPropria(ctx.nucleo, cliente);
  }
  if (!ctx.nucleo && fontesSinteticas(ctx.env)) {
    // A abertura confere o paciente no cadastro: o mesmo cadastro em memória do processo (o que a busca da recepção lê),
    // ou um próprio quando o módulo do cadastro não está montado.
    const proprio = new PortaCadastroMemoria();
    return new PortaAtendimentoMemoria(
      { estado: () => 'verde' },
      { lerPacientes: (c, ids) => (cadastroMemoriaAtual() ?? proprio).lerPacientes(c, ids) },
    );
  }
  return portaAtendimentoIndisponivel();
}

@Module({})
export class ModuloAtendimento {}

export async function modulo(
  ctx: ContextoModulo,
  opcoes: OpcoesModuloAtendimento = {},
): Promise<DynamicModule> {
  const porta = opcoes.porta ?? (await portaDoAtendimento(ctx));
  return {
    module: ModuloAtendimento,
    controllers: [
      AtendimentoController,
      PaController,
      LocaisAtendimentoController,
      RegrasImpressaoController,
      ImpressaoIdentificacaoController,
    ],
    providers: [
      { provide: PORTA_ATENDIMENTO, useValue: porta },
      // Pulseira e etiqueta com a 1ª impressão registrada e a reimpressão por motivo (01-ADM L79): só no banco próprio.
      {
        provide: IMPRESSAO_IDENTIFICACAO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new ImpressaoIdentificacaoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // Manutenção dos locais de atendimento (02-REC linha 34): só no banco próprio (sem ele, as rotas dão 503).
      {
        provide: LOCAIS_ATENDIMENTO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new LocaisAtendimentoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // Regras de impressão da recepção e emissões do atendimento (02-REC linha 35): só no banco próprio.
      {
        provide: REGRAS_IMPRESSAO,
        useValue:
          ctx.nucleo && ctx.configuracao.clientePadrao
            ? new RegrasImpressaoPropria(ctx.nucleo, ctx.configuracao.clientePadrao)
            : null,
      },
      // Os avisos ao vivo do atendimento (sem o vigia do sistema de origem: os eventos vêm das gravações).
      { provide: AVISOS_ATENDIMENTO, useValue: new AvisosAtendimento(null) },
    ],
    exports: [PORTA_ATENDIMENTO, AVISOS_ATENDIMENTO],
  };
}
