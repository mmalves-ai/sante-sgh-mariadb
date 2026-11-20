// M60, etapa 3: a fumaça do servidor (testes pós-implantação).
//   GET /api/administracao/implantacao/fumaca     fuso e relógio contra o banco, Valkey, worker e filas, estrutura do
//                                                 banco contra a homologada e chaves de liberação, do estabelecimento
//                                                 ativo (sistema.saude.ler, D-PERM-60.2)
//   GET /api/sistema/sonda/fumaca?hospital=       a mesma fumaça sem sessão, só com x-sonda-token = SONDA_TOKEN (sem
//                                                 ele, 404), para `pnpm implantacao:verificar`
// Só leitura (nada muda, sem trilha de escrita); só códigos e contagens, sem dado de pessoa.
import { timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Get,
  Headers,
  Inject,
  type OnApplicationShutdown,
  Optional,
  Query,
  Req,
} from '@nestjs/common';
import {
  chavesEsperadasLiberacaoFull,
  type FumacaServidor,
  PERMISSAO_CONFERENCIA_INSTALACAO,
} from '@sgh/contratos';
import { lerChavesEsperadas } from '@sgh/dominio-config';
import type { MarcaSchema } from '@sgh/legado';
import { Permissao, Publica } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { ErroProblema } from '../../problema.filter.js';
import { sessaoDe } from '../cadastro/comum.js';
import { FONTE_COEXISTENCIA, type FonteCoexistencia } from '../config/fonte.js';
import { FONTE_CONFIGURACAO, type FonteConfiguracao } from '../config/public-api.js';
import { ServicoFumacaServidor } from './aplicacao/fumaca.js';
import { FILAS_IMPLANTACAO, type PortaFilasImplantacao } from './filas.js';
import { consultarNtp } from './ntp.js';
import { PORTA_IMPLANTACAO, type PortaImplantacao } from './porta.js';

/** Comparação de segredo em tempo constante. */
function mesmoSegredo(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A marca sintética (dev/ci sem o núcleo): a estrutura igual à homologada. */
function marcaSintetica(hospital: string): MarcaSchema {
  return {
    estabelecimento: hospital,
    estado: 'homologado',
    verificadaEm: new Date().toISOString(),
    resumo: 'sintetico0000000',
    resumoHomologado: 'sintetico0000000',
    contagens: null,
    diferencas: {},
    tabelasBloqueadas: [],
    bloqueiaTudo: false,
    motivo: null,
    duracaoMs: 0,
  };
}

/** O fuso do processo: a variável TZ, senão o que o Node resolveu. */
export function fusoDoProcesso(env: NodeJS.ProcessEnv = process.env): string {
  return env['TZ']?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || '';
}

/**
 * IMPLANTACAO_CHAVES_ESPERADAS; inválida conta como vazia (toda chave ligada sai como inesperada: falha fechada). Sem a
 * variável (ou vazia), o padrão da instalação (M61, liberação full; ADR 0034): todas, menos as que o comando
 * `liberacao:ligar-tudo` não liga NESTE ambiente (fora de dev/ci, também as da decisão do dono; em dev/ci, só as que
 * nunca ligam em massa e as que mandam mensagem). `nenhuma`: nenhuma chave ligada.
 */
export function chavesEsperadasDoAmbiente(
  env: NodeJS.ProcessEnv,
  ambiente: string = env['AMBIENTE']?.trim() ?? '',
): string[] {
  try {
    return lerChavesEsperadas(
      env['IMPLANTACAO_CHAVES_ESPERADAS']?.trim() || chavesEsperadasLiberacaoFull(ambiente),
    );
  } catch {
    return [];
  }
}

@Controller()
export class FumacaServidorController implements OnApplicationShutdown {
  readonly servico: ServicoFumacaServidor;
  private readonly rede: string;

  constructor(
    @Inject(PORTA_IMPLANTACAO) porta: PortaImplantacao,
    @Inject(FILAS_IMPLANTACAO) private readonly filas: PortaFilasImplantacao,
    @Inject(CONFIGURACAO) configuracao: Configuracao,
    @Optional() @Inject(FONTE_COEXISTENCIA) coexistencia: FonteCoexistencia | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) fonte: FonteConfiguracao | null = null,
  ) {
    this.rede = configuracao.rede ?? '';
    const sintetica = porta.destino === 'memoria';
    this.servico = new ServicoFumacaServidor({
      porta,
      filas,
      ambiente: configuracao.ambiente,
      marcaSchema: (h) =>
        coexistencia
          ? (coexistencia.saude().find((s) => s.codigo === h)?.schema ?? null)
          : sintetica
            ? marcaSintetica(h)
            : undefined,
      configuracao: fonte,
      chavesEsperadas: chavesEsperadasDoAmbiente(process.env, configuracao.ambiente),
      fuso: () => fusoDoProcesso(),
      // W0-09 (M2): o servidor sintético tem o relógio em dia por construção; o real consulta o NTP do parâmetro.
      ntp: sintetica ? () => Promise.resolve(0) : consultarNtp(),
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.filas.encerrar?.();
  }

  @Get('administracao/implantacao/fumaca')
  @Permissao(PERMISSAO_CONFERENCIA_INSTALACAO)
  fumaca(@Req() req: RequisicaoAutorizada): Promise<FumacaServidor> {
    const s = sessaoDe(req);
    return this.servico.conferir({ rede: s.rede, hospital: s.hospital });
  }

  @Get('sistema/sonda/fumaca')
  @Publica(
    'fumaça pós-implantação (M60): só com o segredo das sondas; relógio, filas e estrutura, sem dado de pessoa',
  )
  sondaFumaca(
    @Headers('x-sonda-token') token?: string,
    @Query('hospital') hospitalPedido?: string,
  ): Promise<FumacaServidor> {
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
    return this.servico.conferir({ rede: this.rede, hospital });
  }
}
