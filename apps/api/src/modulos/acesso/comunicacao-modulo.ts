// Parte do módulo `acesso` deste lote (02-01), para o integrador juntar em acesso/modulo.ts: a comunicação interna do
// M27 (ComunicacaoController, a porta pela regra do F2-L: própria com o núcleo, memória só em dev/ci sintético,
// indisponível 503 fora disso) e, com a fonte da gestão, a rotina das contas dormentes e a conferência do conselho
// (com a regra do conselho ligada na autorização da sessão).
// O despertar diário das contas dormentes só liga com o banco, fora de dev/ci, salvo ACESSO_CONTAS_DORMENTES_DESPERTAR
// (sim/nao), nos estabelecimentos de ACESSO_CONTAS_DORMENTES_ESTABELECIMENTOS (códigos separados por vírgula).
import type { Provider, Type } from '@nestjs/common';
import { parametrosConselhoPelaConfiguracao } from '../../autorizacao/conselho.js';
import { fontesSinteticas } from '../../sessao/montar.js';
import { AvisosAtendimento } from '../atendimento/avisos.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/configuracao-fonte.js';
import type { ContextoModulo } from '../registro.js';
import { AVISOS_INICIO, ComunicacaoController } from './comunicacao.controller.js';
import {
  PORTA_COMUNICACAO,
  type PortaComunicacao,
  portaComunicacaoIndisponivel,
} from './comunicacao-porta.js';
import { PortaComunicacaoMemoria } from './comunicacao-porta-memoria.js';
import { PortaComunicacaoPropria } from './comunicacao-porta-propria.js';
import { ConselhoGestaoController } from './conselho-gestao.controller.js';
import { ContasDormentesController, DESPERTAR_CONTAS_DORMENTES } from './contas-dormentes.controller.js';
import {
  DespertarContasDormentes,
  SERVICO_CONTAS_DORMENTES,
  ServicoContasDormentes,
} from './contas-dormentes.js';
import {
  parametrosDormenciaPelaConfiguracao,
  portaDormenciaDaFonte,
  responsavelDaFonte,
} from './contas-dormentes-porta.js';
import type { FonteGestao } from './gestao-fonte.js';

/** A porta da comunicação pela regra do módulo. */
export function portaComunicacaoDoModulo(ctx: ContextoModulo): PortaComunicacao {
  if (ctx.nucleo) return new PortaComunicacaoPropria(ctx.nucleo);
  if (fontesSinteticas(ctx.env)) return new PortaComunicacaoMemoria({ estado: () => 'verde' });
  return portaComunicacaoIndisponivel();
}

export function parteComunicacaoDoAcesso(
  ctx: ContextoModulo,
  gestao: FonteGestao | null,
  opcoes: { readonly comunicacao?: PortaComunicacao; readonly avisos?: AvisosAtendimento } = {},
): { controllers: Type[]; providers: Provider[]; exports: (string | symbol)[] } {
  const comunicacao = opcoes.comunicacao ?? portaComunicacaoDoModulo(ctx);
  const providers: Provider[] = [
    { provide: PORTA_COMUNICACAO, useValue: comunicacao },
    { provide: AVISOS_INICIO, useValue: opcoes.avisos ?? new AvisosAtendimento(null) },
  ];
  const controllers: Type[] = [ComunicacaoController];
  if (gestao) {
    let fonteConfig: FonteConfiguracao | null = null;
    const porta = portaDormenciaDaFonte({
      fonte: () => gestao,
      parametros: parametrosDormenciaPelaConfiguracao(() => fonteConfig),
      trilha: ctx.trilha,
    });
    const servico = new ServicoContasDormentes({ porta, responsavel: responsavelDaFonte(() => gestao) });
    // W1-01 (parte 11d): a conferência do conselho retira os atos privativos na hora, pelo parâmetro do estabelecimento.
    ctx.servico?.servicoAutorizacao?.definirRegraConselho(
      parametrosConselhoPelaConfiguracao(() => fonteConfig),
    );
    const env = (ctx.env['ACESSO_CONTAS_DORMENTES_DESPERTAR'] ?? '').trim();
    const codigos = (ctx.env['ACESSO_CONTAS_DORMENTES_ESTABELECIMENTOS'] ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const despertar =
      gestao.destino !== 'memoria' &&
      env !== 'nao' &&
      (env === 'sim' || !['dev', 'ci'].includes(ctx.configuracao.ambiente))
        ? new DespertarContasDormentes(servico, porta, ctx.configuracao.rede ?? '', codigos)
        : null;
    providers.push(
      {
        provide: SERVICO_CONTAS_DORMENTES,
        inject: [{ token: FONTE_CONFIGURACAO, optional: true }],
        useFactory: (f: FonteConfiguracao | null | undefined) => {
          fonteConfig = f ?? null;
          return servico;
        },
      },
      { provide: DESPERTAR_CONTAS_DORMENTES, useValue: despertar },
    );
    controllers.push(ContasDormentesController, ConselhoGestaoController);
  }
  return { controllers, providers, exports: [PORTA_COMUNICACAO, AVISOS_INICIO] };
}
