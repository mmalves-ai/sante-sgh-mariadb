// Dispositivos do perfil Painel/Totem (M19; cap-08 §8.3; cap-06a §6.3): o totem e as TVs NÃO têm login de pessoa —
// entram pelo token do dispositivo (cabeçalho x-sgh-dispositivo), revogável, com validade, restrito ao estabelecimento
// e ao que foi emitido para ele. O token não abre nenhuma rota de usuário (a guarda das rotas de usuário exige a
// sessão) e as rotas daqui não aceitam sessão de pessoa no lugar do token.
//   GET  /api/dispositivo/totem                    os serviços do totem (tipo totem)
//   POST /api/dispositivo/totem/senhas             recepcao.emitirSenha pelo usuário técnico do totem (Idempotency-Key)
//   POST /api/dispositivo/totem/checkin            o agendado do dia pelo CPF (e o código, se houver): senha + chegada
//   GET  /api/dispositivo/painel                   as últimas chamadas (sem nome; iniciais só pelo parâmetro)
//   GET  /api/dispositivo/painel/eventos?bilhete   canal de eventos (text/event-stream): só avisa; o painel relê
//   GET  /api/dispositivo/paineltv                 o painel de TV de setor (leitos ao vivo do M16)
//   GET  /api/dispositivo/bloco-familia            M46: o painel para familiares do bloco (código, etapa e horário)
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  type OnModuleDestroy,
  Optional,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  definicaoParametro,
  esquemaCheckinTotem,
  EVENTOS_AUDITAVEIS,
  type LinhaPainelFamilia,
  type PainelChamadas,
  type PainelFamiliaResposta,
  type SenhaEmitida,
  type TelaPainelTv,
  type TotemConfig,
  idBanco,
} from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import { prioridadeDoGrupo } from '@sgh/dominio-recepcao';
import type { DispositivoRecepcao } from './tipos.js';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Publica } from '../../autorizacao/decoradores.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { PARAMETROS_PADRAO, SERVICO_INTERNACAO, type ServicoInternacao } from '../internacao/public-api.js';
import { ApoioRecepcao } from './apoio.js';
import type { CentralChamadas } from './chamadas.js';
import { PORTA_RECEPCAO, type PortaRecepcao } from './porta.js';
import { corpo } from './recepcao.controller.js';
import { ServicoRecepcao } from './servico.js';
import { CENTRAL_CHAMADAS, PAINEL_BLOCO_TV, PAINEL_PA_TV, REDE_RECEPCAO } from './simbolos.js';

/** M44: o painel do PA (o serviço da classificação). */
/** M46 (etapa 2): o painel para familiares do bloco (só o código anônimo, a etapa e o horário; regra 5). */
export interface PainelBlocoTv {
  painel(c: {
    rede: string;
    hospital: string;
  }): Promise<{ agora: string; linhas: readonly LinhaPainelFamilia[] }>;
}

export interface PainelPaTv {
  painel(c: { rede: string; hospital: string }): Promise<{
    agora: string;
    linhas: { rotulo: string; cor: string | null; nomeCor: string | null; minutos: number }[];
    porCor: { cor: string; total: number; estourados: number }[];
  }>;
}

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;
/** Validade do bilhete do canal de eventos do painel (o EventSource não manda cabeçalho). */
export const BILHETE_MS = 60_000;
/** Batida do canal de eventos do painel (mantém o caminho aberto e reconfere o dispositivo). */
export const BATIDA_PAINEL_MS = 15_000;
/**
 * Check-in no totem: 5 recusas (sem agendamento para os dados) em 1 minuto bloqueiam o aparelho por 5 minutos (a
 * trilha registra). Quem está diante do totem não varre CPFs nem códigos: cada tentativa exige o CPF da pessoa, e a
 * recusa é a mesma para CPF sem agendamento e para código que não é dele. O contador é do processo da API.
 */
export const CHECKIN_TENTATIVAS = 5;
export const CHECKIN_JANELA_MS = 60_000;
export const CHECKIN_BLOQUEIO_MS = 5 * 60_000;

interface RequisicaoDispositivo {
  readonly headers: Record<string, string | string[] | undefined>;
  readonly raw?: { on(evento: 'close', fn: () => void): void };
  readonly ip?: string;
}
interface RespostaEventos {
  hijack(): void;
  readonly raw: {
    writeHead(status: number, cabecalhos: Record<string, string>): void;
    write(texto: string): boolean;
    end(): void;
  };
}

const esquemaSenhaTotem = z
  .object({
    gerador: idBanco,
    grupo: z.number().int().min(0).max(9).nullable().optional(),
  })
  .strict();

const cabecalho = (req: RequisicaoDispositivo, nome: string) => {
  const v = req.headers[nome];
  return Array.isArray(v) ? v[0] : v;
};

@Controller('dispositivo')
export class DispositivoController implements OnModuleDestroy {
  private readonly apoio: ApoioRecepcao;
  private readonly servico: ServicoRecepcao;
  private readonly bilhetes = new Map<string, { id: number; token: string; ate: number }>();
  private readonly abertos = new Set<{ end(): void }>();
  private readonly tentativasCheckin = new Map<number, { inicio: number; n: number; bloqueadoAte: number }>();

  constructor(
    @Inject(PORTA_RECEPCAO) private readonly porta: PortaRecepcao,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(CENTRAL_CHAMADAS) private readonly central: CentralChamadas | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_INTERNACAO) private readonly internacao: ServicoInternacao | null = null,
    /** A rede do dispositivo: a da API (o token é de um estabelecimento desta rede). */
    @Optional() @Inject(REDE_RECEPCAO) private readonly redeDaApi: string = '',
    @Optional() @Inject(PAINEL_PA_TV) private readonly painelPa: PainelPaTv | null = null,
    @Optional() @Inject(PAINEL_BLOCO_TV) private readonly painelBloco: PainelBlocoTv | null = null,
  ) {
    this.apoio = new ApoioRecepcao(porta, trilha, configuracao, cache);
    this.servico = new ServicoRecepcao(porta, central);
  }

  /** O dispositivo do token (válido e do tipo pedido), ou 401/403; a recusa de um dispositivo conhecido vai à trilha. */
  private async dispositivo(
    token: string | undefined,
    tipos: readonly string[],
  ): Promise<DispositivoRecepcao> {
    if (!token || !TOKEN.test(token))
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Dispositivo não autorizado',
        'Cadastre este aparelho com o token do dispositivo.',
        { codigo: 'dispositivo-nao-autorizado' },
      );
    const d = await this.porta.dispositivoDoToken(token);
    if (!d)
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Dispositivo não autorizado',
        'O token não pertence a nenhum dispositivo.',
        { codigo: 'dispositivo-nao-autorizado' },
      );
    if (!d.valido || !tipos.includes(d.tipo)) {
      await this.trilha
        .registrar({
          evento: EVENTOS_AUDITAVEIS.recepcaoDispositivoRecusado.codigo,
          rede: this.redeDaApi,
          hospital: d.hospital,
          usuario: d.usuarioTecnico ?? `DISPOSITIVO.${d.id}`,
          estacao: `dispositivo:${d.id}`,
          correlacao: `dispositivo-${d.id}`,
          recurso: 'recepcao.dispositivo',
          resultado: 'falha',
          tabelaAlvo: 'dispositivo_recepcao',
          idAlvo: String(d.id),
        })
        .catch(() => undefined);
      if (!d.valido)
        throw new ErroProblema(
          'nao-autenticado',
          401,
          'Dispositivo fora de serviço',
          d.revogadoEm
            ? 'O token deste aparelho foi revogado.'
            : 'O token deste aparelho venceu: peça um novo à TI.',
          { codigo: 'dispositivo-revogado' },
        );
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Dispositivo de outro tipo',
        'Este token não abre esta tela.',
        { codigo: 'dispositivo-de-outro-tipo' },
      );
    }
    void this.porta
      .marcarUsoDispositivo({ rede: this.redeDaApi, hospital: d.hospital }, d.id)
      .catch(() => undefined);
    return d;
  }

  private ctx(d: DispositivoRecepcao) {
    return { rede: this.redeDaApi, hospital: d.hospital };
  }

  private async mostrarIniciais(d: DispositivoRecepcao): Promise<boolean> {
    const def = definicaoParametro('recepcao.painelMostraIniciais');
    if (!def || !this.configuracao) return false;
    try {
      const valores = await this.configuracao.valoresParametro(this.redeDaApi, d.hospital);
      const v = valorTipado(
        def,
        resolverParametro(
          def,
          valores,
          {
            rede: this.redeDaApi,
            empresa: null,
            estabelecimento: d.hospital,
            unidade: null,
            perfis: [],
            usuario: '',
          },
          new Date(),
        ).valor,
      );
      return v === true || v === 'sim';
    } catch {
      return false;
    }
  }

  // ── Totem ───────────────────────────────────────────────────────────────────────────────────────

  @Get('totem')
  @Publica('perfil Painel/Totem: o token do dispositivo é conferido no handler (cap-08 §8.3)')
  async totem(@Req() req: RequisicaoDispositivo): Promise<TotemConfig> {
    const d = await this.dispositivo(cabecalho(req, 'x-sgh-dispositivo'), ['totem']);
    return this.servico.totemConfig(this.ctx(d), d);
  }

  private exigirChave(req: RequisicaoDispositivo): string {
    const chave = cabecalho(req, 'idempotency-key');
    if (!chave || !IDEMPOTENCIA.test(chave))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido incompleto',
        'Falta a Idempotency-Key do pedido.',
      );
    return chave;
  }

  private async exigirServico(d: DispositivoRecepcao, gerador: number, soRecepcao = false): Promise<void> {
    const cfg = await this.servico.totemConfig(this.ctx(d), d);
    if (!cfg.servicos.some((s) => s.gerador === gerador && (!soRecepcao || s.recepcao)))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Serviço indisponível',
        'Este serviço não é oferecido neste totem.',
        { codigo: 'servico-fora-do-totem' },
      );
  }

  @Post('totem/senhas')
  @HttpCode(201)
  @Publica(
    'perfil Painel/Totem: o token do dispositivo é conferido no handler; a emissão vai à trilha na transação',
  )
  async emitir(@Body() b: unknown, @Req() req: RequisicaoDispositivo): Promise<SenhaEmitida> {
    const d = await this.dispositivo(cabecalho(req, 'x-sgh-dispositivo'), ['totem']);
    const chave = this.exigirChave(req);
    const e = corpo(esquemaSenhaTotem, b);
    await this.exigirServico(d, e.gerador);
    const r = await this.apoio.executarDoDispositivo(
      d,
      this.redeDaApi,
      'recepcao.emitirSenha',
      {
        gerador: e.gerador,
        prioridade: prioridadeDoGrupo(e.grupo),
        grupo: e.grupo ?? null,
        origem: 'totem',
        dispositivo: d.id,
      },
      chave,
      `totem:${d.id}`,
    );
    return this.servico.senhaEmitida(this.ctx(d), Number(r.resultado['senha']));
  }

  /** O aparelho bloqueado por tentativas recusadas responde 429 até o fim da espera. */
  private exigirSemBloqueio(d: DispositivoRecepcao): void {
    const t = this.tentativasCheckin.get(d.id);
    if (!t || t.bloqueadoAte <= Date.now()) return;
    throw new ErroProblema(
      'muitas-tentativas',
      429,
      'Muitas tentativas',
      'Muitas tentativas seguidas neste totem: aguarde alguns minutos ou procure a recepção.',
      { codigo: 'muitas-tentativas' },
    );
  }

  /** Conta o check-in recusado (sem agendamento para os dados); passou do limite na janela, bloqueia e vai à trilha. */
  private async registrarRecusaCheckin(d: DispositivoRecepcao): Promise<void> {
    const agora = Date.now();
    const t = this.tentativasCheckin.get(d.id) ?? { inicio: agora, n: 0, bloqueadoAte: 0 };
    if (agora - t.inicio > CHECKIN_JANELA_MS) {
      t.inicio = agora;
      t.n = 0;
    }
    t.n++;
    this.tentativasCheckin.set(d.id, t);
    if (t.n < CHECKIN_TENTATIVAS) return;
    t.bloqueadoAte = agora + CHECKIN_BLOQUEIO_MS;
    t.n = 0;
    await this.trilha
      .registrar({
        evento: EVENTOS_AUDITAVEIS.recepcaoDispositivoRecusado.codigo,
        rede: this.redeDaApi,
        hospital: d.hospital,
        usuario: d.usuarioTecnico ?? `DISPOSITIVO.${d.id}`,
        estacao: `dispositivo:${d.id}`,
        correlacao: `dispositivo-${d.id}-checkin`,
        recurso: 'recepcao.dispositivo',
        resultado: 'falha',
        tabelaAlvo: 'dispositivo_recepcao',
        idAlvo: String(d.id),
      })
      .catch(() => undefined);
  }

  @Post('totem/checkin')
  @HttpCode(201)
  @Publica(
    'perfil Painel/Totem: o token do dispositivo é conferido no handler; emissão e chegada vão à trilha',
  )
  async checkin(@Body() b: unknown, @Req() req: RequisicaoDispositivo): Promise<SenhaEmitida> {
    const d = await this.dispositivo(cabecalho(req, 'x-sgh-dispositivo'), ['totem']);
    const chave = this.exigirChave(req);
    this.exigirSemBloqueio(d);
    const e = corpo(esquemaCheckinTotem, b);
    // A chegada só se liga à senha de recepção (tipo 0): o serviço diverso não abre atendimento.
    await this.exigirServico(d, e.gerador, true);
    const codigo = e.codigo
      ? {
          tipo: e.codigo[0] === 'C' ? ('consulta' as const) : ('exame' as const),
          id: Number(e.codigo.slice(1)),
        }
      : null;
    // O CPF sempre (é de quem está no totem); o código, quando vem, só escolhe entre as marcações dessa pessoa.
    const { itens } = await this.porta.agendados(this.ctx(d), { cpf: e.cpf, marcacao: codigo });
    const alvo = itens.filter((a) => a.senha === null).sort((x, y) => x.hora.localeCompare(y.hora))[0];
    if (!alvo) {
      await this.registrarRecusaCheckin(d);
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Agendamento não encontrado',
        'Não encontramos agendamento para hoje com estes dados: retire a senha do serviço desejado.',
        { codigo: 'agendamento-nao-encontrado' },
      );
    }
    const r = await this.apoio.executarDoDispositivo(
      d,
      this.redeDaApi,
      'recepcao.emitirSenha',
      { gerador: e.gerador, prioridade: '2', origem: 'totem', dispositivo: d.id },
      chave,
      `totem:${d.id}`,
    );
    const senha = Number(r.resultado['senha']);
    // A chegada é uma segunda gravação (a senha vale mesmo se ela falhar: o balcão liga depois).
    await this.apoio
      .executarDoDispositivo(
        d,
        this.redeDaApi,
        'recepcao.registrarChegada',
        { senha, tipo: alvo.tipo, marcacao: alvo.marcacao },
        `${chave.slice(0, 70)}:chegada`,
        `totem:${d.id}`,
      )
      .catch(() => undefined);
    return this.servico.senhaEmitida(this.ctx(d), senha, { tipo: alvo.tipo, hora: alvo.hora });
  }

  // ── Painel de chamada ───────────────────────────────────────────────────────────────────────────

  @Get('painel')
  @Publica('perfil Painel/Totem: o token do dispositivo é conferido no handler; o painel não mostra nome')
  async painel(@Req() req: RequisicaoDispositivo): Promise<PainelChamadas & { bilhete: string }> {
    const token = cabecalho(req, 'x-sgh-dispositivo');
    const d = await this.dispositivo(token, ['painel']);
    const p = await this.servico.painel(this.ctx(d), d, await this.mostrarIniciais(d));
    const bilhete = randomBytes(18).toString('base64url');
    const agora = Date.now();
    for (const [k, v] of this.bilhetes) if (v.ate < agora) this.bilhetes.delete(k);
    this.bilhetes.set(bilhete, { id: d.id, token: token as string, ate: agora + BILHETE_MS });
    return { ...p, bilhete };
  }

  @Get('painel/eventos')
  @Publica(
    'perfil Painel/Totem: o bilhete de 60 s (emitido ao dispositivo pelo token) é conferido no handler',
  )
  async eventos(
    @Query('bilhete') bilhete: string | undefined,
    @Req() req: RequisicaoDispositivo,
    @Res() res: RespostaEventos,
  ): Promise<void> {
    const b = bilhete ? this.bilhetes.get(bilhete) : undefined;
    if (!b || b.ate < Date.now())
      throw new ErroProblema(
        'nao-autenticado',
        401,
        'Bilhete inválido',
        'Releia o painel para obter um bilhete novo.',
        { codigo: 'bilhete-invalido' },
      );
    this.bilhetes.delete(bilhete as string);
    const d = await this.dispositivo(b.token, ['painel']);
    if (!this.central) throw new ErroProblema('indisponivel', 503, 'Avisos de chamada indisponíveis');
    res.hijack();
    res.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });
    res.raw.write('retry: 2000\n\n');
    const cancelar = this.central.assinar(d.hospital, (versao) =>
      res.raw.write(`event: chamada\ndata: ${JSON.stringify({ versao })}\n\n`),
    );
    let fechado = false;
    const encerrar = () => {
      if (fechado) return;
      fechado = true;
      clearInterval(batida);
      cancelar();
      this.abertos.delete(res.raw);
    };
    // A batida reconfere o dispositivo: revogado ou vencido, o canal fecha (o painel volta à tela de erro).
    const batida = setInterval(() => {
      void this.porta
        .dispositivoDoToken(b.token)
        .then((x) => {
          if (fechado) return;
          if (x?.valido) {
            res.raw.write(': batida\n\n');
            return;
          }
          encerrar();
          res.raw.end();
        })
        .catch(() => undefined);
    }, BATIDA_PAINEL_MS);
    batida.unref?.();
    this.abertos.add(res.raw);
    req.raw?.on('close', encerrar);
  }

  onModuleDestroy(): void {
    for (const r of this.abertos) r.end();
    this.abertos.clear();
    this.central?.parar();
  }

  // ── Painel para familiares do bloco (M46, etapa 2) ─────────────────────────────────────────────

  @Get('bloco-familia')
  @Publica(
    'perfil Painel/Totem: o token do dispositivo é conferido no handler; só o código anônimo, a etapa e o horário',
  )
  async blocoFamilia(@Req() req: RequisicaoDispositivo): Promise<PainelFamiliaResposta> {
    const d = await this.dispositivo(cabecalho(req, 'x-sgh-dispositivo'), ['paineltv']);
    if (d.conteudo !== 'bloco' || !this.painelBloco)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Dispositivo de outro tipo',
        'Este token não abre o painel para familiares do bloco.',
        { codigo: 'dispositivo-de-outro-tipo' },
      );
    const p = await this.painelBloco.painel(this.ctx(d));
    return {
      nome: d.nome,
      atualizadoEm: p.agora,
      linhas: p.linhas.map((l) => ({
        codigo: l.codigo,
        etapa: l.etapa,
        rotuloEtapa: l.rotuloEtapa,
        desde: l.desde,
      })),
    };
  }

  // ── Painel de TV de setor ───────────────────────────────────────────────────────────────────────

  @Get('paineltv')
  @Publica('perfil Painel/Totem: o token do dispositivo é conferido no handler; o painel não mostra nome')
  async paineltv(@Req() req: RequisicaoDispositivo): Promise<TelaPainelTv> {
    const d = await this.dispositivo(cabecalho(req, 'x-sgh-dispositivo'), ['paineltv']);
    const agora = new Date().toISOString();
    if (d.conteudo === 'leitos' && this.internacao) {
      const p = await this.internacao.painel(
        { rede: this.redeDaApi, hospital: d.hospital, traceId: `paineltv-${d.id}` },
        PARAMETROS_PADRAO,
      );
      return {
        nome: d.nome,
        conteudo: 'leitos',
        atualizadoEm: p.dadosAte,
        colunas: [
          { campo: 'bloco', rotulo: 'Bloco' },
          { campo: 'acomodacao', rotulo: 'Acomodação' },
          { campo: 'ocupados', rotulo: 'Ocupados' },
          { campo: 'livres', rotulo: 'Livres' },
        ],
        linhas: p.blocos.flatMap((b) =>
          b.acomodacoes.map((a) => ({
            bloco: b.nome,
            acomodacao: a.nome,
            ocupados: a.totais.ocupados,
            livres: a.totais.livres,
          })),
        ),
        resumo: [
          { rotulo: 'Leitos ativos', valor: p.totais.ativos },
          { rotulo: 'Ocupados', valor: p.totais.ocupados },
          { rotulo: 'Livres', valor: p.totais.livres },
        ],
      };
    }
    // M44: o pronto atendimento por cor de risco (senha ou iniciais, a cor com o nome escrito e a espera).
    if (d.conteudo === 'pa' && this.painelPa) {
      const p = await this.painelPa.painel({ rede: this.redeDaApi, hospital: d.hospital });
      const ROTULO: Record<string, string> = {
        vermelho: 'Vermelho',
        laranja: 'Laranja',
        amarelo: 'Amarelo',
        verde: 'Verde',
        azul: 'Azul',
        semClassificacao: 'Aguardando classificação',
      };
      return {
        nome: d.nome,
        conteudo: 'pa',
        atualizadoEm: p.agora,
        colunas: [
          { campo: 'senha', rotulo: 'Senha' },
          { campo: 'classificacao', rotulo: 'Classificação' },
          { campo: 'espera', rotulo: 'Espera (min)' },
        ],
        linhas: p.linhas.map((l) => ({
          senha: l.rotulo,
          classificacao: l.cor
            ? `${ROTULO[l.cor] ?? l.cor} — ${l.nomeCor ?? ''}`
            : ROTULO['semClassificacao']!,
          cor: l.cor,
          espera: l.minutos,
        })),
        resumo: p.porCor.map((x) => ({ rotulo: ROTULO[x.cor] ?? x.cor, valor: x.total })),
      };
    }
    // M46 (etapa 2): o bloco cirúrgico para familiares (só o código anônimo, a etapa e o horário; regra 5).
    if (d.conteudo === 'bloco' && this.painelBloco) {
      const p = await this.painelBloco.painel(this.ctx(d));
      return {
        nome: d.nome,
        conteudo: 'bloco',
        atualizadoEm: p.agora,
        colunas: [
          { campo: 'codigo', rotulo: 'Código' },
          { campo: 'etapa', rotulo: 'Etapa' },
          { campo: 'desde', rotulo: 'Desde' },
        ],
        linhas: p.linhas.map((l) => ({ codigo: l.codigo, etapa: l.rotuloEtapa, desde: l.desde })),
        resumo: [{ rotulo: 'No painel', valor: p.linhas.length }],
      };
    }
    // Higienização (M21) entra quando o módulo dono publicar o conteúdo.
    return {
      nome: d.nome,
      conteudo: d.conteudo ?? 'outro',
      atualizadoEm: agora,
      colunas: [],
      linhas: [],
      resumo: [],
    };
  }
}
