// W0-07 (mercado M4): a integração da OS da manutenção com o bloqueio do leito, atrás do parâmetro adt.osBloqueiaLeito
// (desligado por padrão). O módulo da manutenção chama esta integração (opcional por injeção) depois de gravar a OS:
//   - na abertura, se o local da OS nomeia um leito livre e sem bloqueio, devolve a proposta do bloqueio por manutenção
//     (quem abriu confirma pelo POST /api/leitos/estados, com a observação "OS <número>", a ligação com a OS);
//   - no encerramento, encerra o bloqueio desta OS (o de observação "OS <número>"; o bloqueio manual ou de outra OS fica)
//     e solicita a higienização do leito pela receita do executor (hotelaria.solicitarLimpeza).
//   - no cancelamento, encerra o bloqueio desta OS (sem higienização). O bloqueio é procurado pelo número da OS em todos
//     os leitos, não só no do local atual (o local pode ter mudado), e a alteração do estado não apaga o prefixo.
// Com o parâmetro desligado, nada acontece (devolve null). Falha da integração nunca desfaz a OS: vira aviso.
import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import {
  type AvisoOsNoLeito,
  chaveTextoLeito,
  EVENTOS_AUDITAVEIS,
  leitoDaChaveTexto,
  bloqueioDaOs,
  leitoDoLocalDaOs,
  observacaoBloqueioOs,
  type OsNoLeito,
  PARAMETRO_OS_BLOQUEIA_LEITO,
} from '@sgh/contratos';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { CONFIGURACAO_M16, type ConfiguracaoM16 } from '../internacao/public-api.js';
import type { AvisosAtendimento } from '../atendimento/public-api.js';
import { ApoioGravacao } from '../exames/public-api.js';
import { ApoiosAdt, CHAVE_LIMPEZA, ctxAdt, janelaOutroSistema } from './apoios.js';
import type { GravadorSghAdt } from './porta.js';
import { intensivasDe } from './internacao.controller.js';
import { PORTA_ADT, type PortaAdt } from './porta.js';
import { ServicoAdt } from './servico.js';
import { AVISOS_ADT } from './simbolos.js';

export const INTEGRACAO_OS_LEITO = Symbol('INTEGRACAO_OS_LEITO');

/** A OS como a integração a vê: o número (a ligação com o bloqueio) e o local livre digitado. */
export interface OsParaLeito {
  readonly numero: string | null;
  readonly local: string | null;
}

export interface IntegracaoOsLeito {
  aoAbrir(s: SessaoCadastro, os: OsParaLeito): Promise<OsNoLeito | null>;
  aoEncerrar(s: SessaoCadastro, os: OsParaLeito): Promise<OsNoLeito | null>;
  /** O cancelamento da OS encerra o bloqueio dela (sem solicitar a higienização: o reparo não foi concluído). */
  aoCancelar(s: SessaoCadastro, os: OsParaLeito): Promise<OsNoLeito | null>;
}

/** O tipo de limpeza depois da manutenção: o de nome "terminal" no cadastro; sem ele, o primeiro do cadastro. */
export function tipoLimpezaPosManutencao(tipos: readonly { codigo: number; nome: string }[]): number | null {
  const terminal = tipos.find((t) => /TERMINAL/i.test(t.nome));
  return (terminal ?? tipos[0])?.codigo ?? null;
}

/**
 * A sessão com a Idempotency-Key própria da consequência (a requisição é a do encerramento da OS, que pode não trazer
 * a chave; a chave pela OS faz a repetição do encerramento devolver a mesma solicitação de limpeza).
 */
function comChaveIdempotente(s: SessaoCadastro, chave: string): SessaoCadastro {
  const req = Object.assign(Object.create(s.req) as object, {
    headers: { ...s.req.headers, 'idempotency-key': chave.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 80) },
  }) as SessaoCadastro['req'];
  return Object.assign(Object.create(Object.getPrototypeOf(s) as object) as object, s, {
    req,
  }) as SessaoCadastro;
}

@Injectable()
export class IntegracaoOsLeitoAdt implements IntegracaoOsLeito {
  private readonly apoios: ApoiosAdt;
  /**
   * A higienização depois da OS é consequência autorizada pelo parâmetro (quem encerra a OS é o solicitante, sem a
   * permissão da hotelaria): mesma chave de liberação e mesma receita do executor, sem a permissão da tela; a trilha
   * registra quem encerrou a OS.
   */
  private readonly limpezaPosOs: ApoioGravacao<GravadorSghAdt>;
  private readonly servico: ServicoAdt;
  private readonly log = new Logger('OsLeito');

  constructor(
    @Inject(PORTA_ADT) private readonly porta: PortaAdt,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(CONFIGURACAO_M16) private readonly cfg16: ConfiguracaoM16 | null = null,
    @Optional() @Inject(AVISOS_ADT) private readonly avisos: AvisosAtendimento | null = null,
  ) {
    this.apoios = new ApoiosAdt(porta, trilha, configuracao, cache);
    this.limpezaPosOs = new ApoioGravacao<GravadorSghAdt>(
      { chave: CHAVE_LIMPEZA, nome: 'a higienização', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.servico = new ServicoAdt(porta, janelaOutroSistema(configuracao));
  }

  private async ligada(s: SessaoCadastro): Promise<boolean> {
    const v = await this.apoios.mapa.parametroValor(s, PARAMETRO_OS_BLOQUEIA_LEITO, null).catch(() => null);
    return v === true || v === 'sim';
  }

  /** O leito do local da OS no mapa (com a situação), ou null quando o local não nomeia um leito. */
  private async leitoDaOs(s: SessaoCadastro, os: OsParaLeito) {
    if (!os.local || !os.numero) return null;
    const mapa = await this.servico.mapa(ctxAdt(s), await intensivasDe(this.cfg16, s));
    const chave = leitoDoLocalDaOs(
      os.local,
      mapa.leitos.map((l) => ({
        bloco: l.leito.bloco,
        acomodacao: l.leito.acomodacao,
        leito: l.leito.leito,
      })),
    );
    if (!chave) return null;
    const l = mapa.leitos.find((x) => x.chave === chaveTextoLeito(chave));
    return l ? { chave, l } : null;
  }

  private static desfecho(
    chave: OsNoLeito['leito'],
    numero: string,
    o: Partial<Omit<OsNoLeito, 'leito' | 'chave' | 'observacao'>>,
  ): OsNoLeito {
    return {
      leito: chave,
      chave: chaveTextoLeito(chave),
      observacao: observacaoBloqueioOs(numero),
      propostaBloqueio: false,
      bloqueioEncerrado: false,
      higienizacao: null,
      aviso: null,
      ...o,
    };
  }

  async aoAbrir(s: SessaoCadastro, os: OsParaLeito): Promise<OsNoLeito | null> {
    if (!(await this.ligada(s))) return null;
    const achado = await this.leitoDaOs(s, os).catch((e: unknown) => {
      this.log.warn(`OS ${os.numero}: leitura do mapa falhou (${(e as Error).message})`);
      return null;
    });
    if (!achado || !os.numero) return null;
    const bloqueado = achado.l.estados.some((x) => x.estado === 'bloqueio');
    const livre = achado.l.situacao === 'livre';
    // Só propõe a quem pode bloquear o leito (o POST /leitos/estados pede leitos.bloqueio.criar): os outros recebem o
    // aviso de que a hotelaria ou o NIR bloqueia. Com o leito ocupado não há bloqueio adiado: o aviso pede bloquear
    // pelo mapa quando ele vagar, citando a OS.
    const podeBloquear = s.pode('leitos.bloqueio.criar');
    return IntegracaoOsLeitoAdt.desfecho(achado.chave, os.numero, {
      propostaBloqueio: livre && !bloqueado && podeBloquear,
      aviso: bloqueado
        ? 'leito-bloqueado'
        : !livre
          ? 'leito-ocupado'
          : podeBloquear
            ? null
            : 'sem-permissao-bloqueio',
    });
  }

  /**
   * O bloqueio por manutenção aberto desta OS, procurado pelo número em todos os leitos (o local da OS pode ter mudado
   * depois do bloqueio); com mais de um, o do leito do local atual primeiro.
   */
  private async bloqueioAberto(s: SessaoCadastro, numero: string, preferido: string | null) {
    const estados = await this.porta.estadosDoMapa(ctxAdt(s));
    const dela = estados.estados.filter(
      (x) => x.estado === 'bloqueio' && x.motivo === 'manutencao' && bloqueioDaOs(x.observacao, numero),
    );
    const x = dela.find((y) => y.chave === preferido) ?? dela[0];
    const chave = x ? leitoDaChaveTexto(x.chave) : null;
    return chave;
  }

  private async encerrarBloqueio(s: SessaoCadastro, chave: OsNoLeito['leito']) {
    await this.apoios.mapa.sgh(
      s,
      EVENTOS_AUDITAVEIS.leitosLeitoBloqueado.codigo,
      'leitos.bloqueio.criar',
      { tabela: 'SGH_INT_LEITO_ESTADO', chave: chaveTextoLeito(chave) },
      (g) => g.encerrarEstadoLeito({ leito: chave, estado: 'bloqueio', usuario: s.login }),
    );
  }

  async aoCancelar(s: SessaoCadastro, os: OsParaLeito): Promise<OsNoLeito | null> {
    if (!os.numero || !(await this.ligada(s))) return null;
    const numero = os.numero;
    const achado = await this.leitoDaOs(s, os).catch(() => null);
    const chave = await this.bloqueioAberto(s, numero, achado ? chaveTextoLeito(achado.chave) : null);
    if (!chave) return null;
    await this.encerrarBloqueio(s, chave);
    this.avisos?.avisar(s.hospital);
    return IntegracaoOsLeitoAdt.desfecho(chave, numero, {
      bloqueioEncerrado: true,
      aviso: 'cancelada',
    });
  }

  async aoEncerrar(s: SessaoCadastro, os: OsParaLeito): Promise<OsNoLeito | null> {
    if (!os.numero || !(await this.ligada(s))) return null;
    const numero = os.numero;
    const c = ctxAdt(s);
    const achado = await this.leitoDaOs(s, os).catch(() => null);
    const chave = await this.bloqueioAberto(s, numero, achado ? chaveTextoLeito(achado.chave) : null);
    if (!chave)
      return achado
        ? IntegracaoOsLeitoAdt.desfecho(achado.chave, numero, {
            aviso: 'sem-bloqueio-da-os',
          })
        : null;
    await this.encerrarBloqueio(s, chave);
    let higienizacao: number | null = null;
    let aviso: AvisoOsNoLeito | null = null;
    try {
      const tipo = tipoLimpezaPosManutencao((await this.porta.apoio(c)).tiposLimpeza);
      if (tipo === null) aviso = 'sem-tipo-limpeza';
      else {
        const r = (await this.limpezaPosOs.executar(
          comChaveIdempotente(s, `os-leito.limpeza.${numero}`),
          'hotelaria.solicitarLimpeza',
          {
            leito: chave,
            tipoLimpeza: tipo,
            origem: 'manual',
            observacao: `Após a ${observacaoBloqueioOs(numero)} (manutenção)`,
          },
          'Limpeza solicitada.',
        )) as { resultado?: { id?: number; solicitacao?: number } | null };
        higienizacao = r.resultado?.solicitacao ?? r.resultado?.id ?? 0;
      }
    } catch (e) {
      this.log.warn(`OS ${numero}: a higienização não foi solicitada (${(e as Error).message})`);
      aviso = 'higienizacao-nao-solicitada';
    }
    this.avisos?.avisar(s.hospital);
    return IntegracaoOsLeitoAdt.desfecho(chave, numero, { bloqueioEncerrado: true, higienizacao, aviso });
  }
}
