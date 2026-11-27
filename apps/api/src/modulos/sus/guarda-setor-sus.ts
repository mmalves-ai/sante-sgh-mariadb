// C1-051 (06-SUS linha 53): a permissão por usuário e setor nas rotas do SUS que não passam pelo ServicoSus (complemento
// da conta da AIH, complementos da APAC). A sessão do SUS é a mesma do SusController (com as permissões por setor do
// usuário); a regra é a do domínio (decidirSetorSus, pelo ServicoSus). Sem permissão vigente cadastrada, vale o cargo e
// o setor nem é lido; o registro inexistente segue para a porta (que responde 404).
import { Inject, Injectable, Optional } from '@nestjs/common';
import type { AcaoSetorSus } from '@sgh/dominio-faturamento';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import {
  PORTA_ESTABELECIMENTO_SUS,
  type PortaEstabelecimentoSusPropria,
} from './estabelecimento-sus-propria.js';
import { PORTA_SUS, type PortaSus } from './porta.js';
import { PORTA_CONFIGURACAO_SUS, type PortaConfiguracaoSus } from './porta-configuracao.js';
import { PORTA_PROGRAMACAO_SUS, type PortaProgramacaoSusPropria } from './programacao-propria.js';
import type { ArmazemArquivoSus } from './servico.js';
import { ARMAZEM_ARQUIVO_SUS, SusController } from './sus.controller.js';

/** Monta o SusController com todas as portas (a da configuração traz as permissões por setor da sessão). */
export function controladorSusCompleto(
  porta: PortaSus,
  trilha: RegistradorTrilha,
  configuracao: FonteConfiguracao | null,
  cache: CacheConfig | null,
  armazem: ArmazemArquivoSus | null,
  programacao: PortaProgramacaoSusPropria | null,
  estabelecimentoSus: PortaEstabelecimentoSusPropria | null,
  portaConfiguracao: PortaConfiguracaoSus | null,
): SusController {
  return new SusController(
    porta,
    trilha,
    configuracao,
    cache,
    armazem,
    programacao,
    estabelecimentoSus,
    portaConfiguracao,
  );
}

@Injectable()
export class GuardaSetorSus {
  private readonly base: SusController;

  constructor(
    @Inject(PORTA_SUS) porta: PortaSus,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(ARMAZEM_ARQUIVO_SUS) armazem: ArmazemArquivoSus | null = null,
    @Optional() @Inject(PORTA_PROGRAMACAO_SUS) programacao: PortaProgramacaoSusPropria | null = null,
    @Optional()
    @Inject(PORTA_ESTABELECIMENTO_SUS)
    estabelecimentoSus: PortaEstabelecimentoSusPropria | null = null,
    @Optional() @Inject(PORTA_CONFIGURACAO_SUS) portaConfiguracao: PortaConfiguracaoSus | null = null,
  ) {
    this.base = controladorSusCompleto(
      porta,
      trilha,
      configuracao,
      cache,
      armazem,
      programacao,
      estabelecimentoSus,
      portaConfiguracao,
    );
  }

  /**
   * Confere o setor do registro para a ação: lê o setor só quando a sessão tem permissão por setor vigente; o setor
   * fora da lista (ou não informado) é recusado pela regra do domínio. `setorDe` devolve null quando o registro não
   * existe no estabelecimento (a porta responde 404 em seguida).
   */
  async exigir(
    req: RequisicaoAutorizada,
    acao: AcaoSetorSus,
    setorDe: () => Promise<{ readonly setor: number | null } | null>,
  ): Promise<void> {
    const s = await this.base.sessao(req);
    if (this.base.servico.setoresSus(s, acao) === null) return;
    const x = await setorDe();
    if (!x) return;
    this.base.servico.exigirSetorSus(s, x.setor, acao);
  }
}
