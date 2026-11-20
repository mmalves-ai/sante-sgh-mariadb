// M60, etapa 2: a conferência da instalação e da conexão ao banco (Administração > Saúde do sistema).
//   GET /api/administracao/implantacao/conferencia   versão, conexão corrente, scripts do pacote × banco e os itens
//   GET /api/sistema/sonda/instalacao?hospital=      a mesma conferência para a fumaça pós-implantação, sem sessão,
//                                                    só com x-sonda-token = SONDA_TOKEN (sem ele, 404)
// Só leitura, com a permissão dos painéis de saúde (sistema.saude.ler, D-PERM-60.2). Sem gravação, sem trilha de
// escrita (nada muda); a leitura não envolve dado de pessoa.
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { Controller, Get, Headers, Inject, Optional, Query, Req } from '@nestjs/common';
import { type ConferenciaInstalacao, PERMISSAO_CONFERENCIA_INSTALACAO } from '@sgh/contratos';
import type { ScriptDoPacote } from '@sgh/dominio-config';
import { lerScriptsSgh } from '@sgh/legado';
import { Permissao, Publica } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { VersaoService } from '../../versao.service.js';
import { sessaoDe } from '../cadastro/comum.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { ServicoConferenciaInstalacao } from './aplicacao/conferencia.js';
import { PORTA_IMPLANTACAO, type PortaImplantacao } from './porta.js';

/** Os scripts SGH_ do pacote: os arquivos de packages/legado/src (o pacote leva a árvore), lidos uma vez. */
export const SCRIPTS_DO_PACOTE = Symbol('SCRIPTS_DO_PACOTE');
export function scriptsDoPacoteDoDisco(raiz: string = process.cwd()): () => readonly ScriptDoPacote[] {
  let cache: ScriptDoPacote[] | null = null;
  return () =>
    (cache ??= lerScriptsSgh(resolve(raiz, 'packages/legado/src')).map((s) => ({
      numero: s.numero,
      hash: s.hash,
    })));
}

/** Comparação de segredo em tempo constante. */
function mesmoSegredo(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

@Controller()
export class ConferenciaInstalacaoController {
  readonly servico: ServicoConferenciaInstalacao;
  private readonly rede: string;

  constructor(
    @Inject(PORTA_IMPLANTACAO) porta: PortaImplantacao,
    @Inject(CONFIGURACAO) configuracao: Configuracao,
    versao: VersaoService,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
    @Optional() @Inject(SCRIPTS_DO_PACOTE) scripts: (() => readonly ScriptDoPacote[]) | null = null,
  ) {
    this.rede = configuracao.rede ?? '';
    const esperada = process.env['SONDA_VERSAO_ESPERADA']?.trim();
    this.servico = new ServicoConferenciaInstalacao({
      porta,
      ambiente: configuracao.ambiente,
      scriptsDoPacote: scripts ?? scriptsDoPacoteDoDisco(),
      versao: () => versao.atual(configuracao.produtoNome),
      identificacaoEsperada: esperada ? esperada : null,
      configuracao: fonte,
    });
  }

  @Get('administracao/implantacao/conferencia')
  @Permissao(PERMISSAO_CONFERENCIA_INSTALACAO)
  conferencia(@Req() req: RequisicaoAutorizada): Promise<ConferenciaInstalacao> {
    return this.servico.conferir(sessaoDe(req));
  }

  @Get('sistema/sonda/instalacao')
  @Publica(
    'fumaça pós-implantação (M60): só com o segredo das sondas; versão, conexão e scripts, sem dado de pessoa',
  )
  sondaInstalacao(
    @Headers('x-sonda-token') token?: string,
    @Query('hospital') hospitalPedido?: string,
  ): Promise<ConferenciaInstalacao> {
    const segredo = (process.env['SONDA_TOKEN'] ?? '').trim();
    if (segredo.length < 32 || !token || !mesmoSegredo(token, segredo))
      throw new ErroProblema('nao-encontrado', 404, 'Não encontrado');
    const configurados = (process.env['ESTABELECIMENTOS'] ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    const hospital = hospitalPedido?.trim() || configurados[0] || '';
    if (!configurados.includes(hospital))
      throw new ErroProblema('entrada-invalida', 400, 'Estabelecimento inválido');
    return this.servico.conferirContexto({ rede: this.rede, hospital });
  }
}
