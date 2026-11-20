// Balanço hídrico (M45, etapa 3; ficha, seções 4, 5 e 7; regras 6, 15 e 16):
//   GET  /api/enfermagem/balanco/unidades                          as unidades de internação (para escolher o paciente)
//   GET  /api/enfermagem/balanco/unidades/:unidade/pacientes       os internados da unidade
//   GET  /api/enfermagem/balanco/:atendimento?inicio=&ate=&peso=   o balanço na janela de 24 horas (a em curso, sem
//                                                                  `inicio`), com os pendentes, o cálculo e a impressão
//   POST /api/enfermagem/balanco/:atendimento/lancamentos          enfermagem.lancarBalanco (Idempotency-Key)
//   POST /api/enfermagem/balanco/:atendimento/lancamentos/:id/estorno   o estorno com o motivo
//   POST /api/enfermagem/balanco/:atendimento/fechamentos          enfermagem.fecharBalanco (parcial ou 24 horas)
// Operações só do novo (SGH_), com a SGH_TRILHA na mesma transação e o ator real; o estabelecimento vem da sessão (o
// atendimento de outro não é achado). A hora de corte e a fórmula das perdas insensíveis são os parâmetros da unidade
// do paciente. A funcionalidade nasce desligada (chave `enfermagem.balanco`, POL-3): desligada, a tela fica em consulta.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type BalancoDoPaciente,
  CHAVE_LIBERACAO_BALANCO,
  definicaoParametro,
  esquemaEstornarBalanco,
  esquemaFecharBalanco,
  esquemaLancarBalanco,
  EVENTOS_AUDITAVEIS,
  PARAMETRO_BALANCO_FORMULA,
  PARAMETRO_BALANCO_HORA_CORTE,
  PERMISSOES_BALANCO as P,
  type ResultadoBalanco,
} from '@sgh/contratos';
import { resolverParametro } from '@sgh/dominio-config';
import {
  conferirEstorno,
  conferirFechamento,
  conferirLancamento,
  formulaInsensivel,
  horaDoCorte,
  janelaDoInstante,
  textoDoFechamento,
} from '@sgh/dominio-enfermagem';
import type { InternadoLido } from '@sgh/legado';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { type GravadorBalanco, PORTA_BALANCO, type PortaBalanco } from './balanco-porta.js';
import { type ParametrosBalanco, ServicoBalanco } from './balanco-servico.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';

const E = EVENTOS_AUDITAVEIS;
const TABELA = 'SGH_PEP_BALANCO';
const UNIDADE = /^[A-Za-z0-9 ._-]{1,5}$/;
const HORA = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
const EXTRAS = { lancar: P.lancar, estornar: P.lancar, fechar: P.fechar } as const;

function horaDaConsulta(v: string | undefined, campo: string): string | null {
  if (v === undefined || v === '') return null;
  if (!HORA.test(v))
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'Hora no formato AAAA-MM-DDTHH:mm.', {
      campos: [campo],
    });
  return v;
}

function pesoDaConsulta(v: string | undefined): number | null {
  if (v === undefined || v === '') return null;
  const n = Number(v.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0.3 || n > 400)
    throw new ErroProblema('entrada-invalida', 400, 'Dados inválidos', 'O peso vai de 0,3 a 400 kg.', {
      campos: ['peso'],
    });
  return Math.round(n * 10) / 10;
}

/** A chave do ato (o mesmo cabeçalho Idempotency-Key das outras gravações). */
function chaveDoPedido(s: SessaoCadastro): string {
  const bruto = s.req.headers['idempotency-key'];
  const k = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof k !== 'string' || !CHAVE.test(k))
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Pedido incompleto',
      'Falta a Idempotency-Key do pedido de gravação.',
    );
  return k;
}

@Controller('enfermagem/balanco')
export class BalancoController {
  private readonly apoio: ApoioGravacao<GravadorBalanco>;
  private readonly servico: ServicoBalanco;

  constructor(
    @Inject(PORTA_BALANCO) private readonly porta: PortaBalanco,
    @Inject(PORTA_ENFERMAGEM) private readonly enfermagem: PortaEnfermagem,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_LIBERACAO_BALANCO, nome: 'o balanço hídrico', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.servico = new ServicoBalanco(porta);
  }

  /** Os parâmetros do balanço na unidade do paciente (sem valor: o padrão do registro). */
  private async parametros(s: SessaoCadastro, unidade: string | null): Promise<ParametrosBalanco> {
    let valores: Awaited<ReturnType<FonteConfiguracao['valoresParametro']>> = [];
    try {
      valores = this.configuracao ? await this.configuracao.valoresParametro(s.rede, s.hospital) : [];
    } catch {
      valores = [];
    }
    const valor = (chave: string) => {
      const def = definicaoParametro(chave);
      if (!def) return '';
      return (
        resolverParametro(
          def,
          valores,
          { rede: s.rede, empresa: null, estabelecimento: s.hospital, unidade, perfis: [], usuario: s.login },
          new Date(),
        ).valor ?? def.padrao
      ).trim();
    };
    const corte = valor(PARAMETRO_BALANCO_HORA_CORTE) || '0700';
    let formula: ParametrosBalanco['formula'];
    try {
      formula = formulaInsensivel(valor(PARAMETRO_BALANCO_FORMULA) || 'PI-2026.1');
    } catch (x) {
      throw new ErroProblema('erro-interno', 500, 'Parâmetro do balanço', (x as Error).message);
    }
    try {
      return { horaCorte: horaDoCorte(corte), formula };
    } catch {
      return { horaCorte: '07:00', formula };
    }
  }

  private async contexto(s: SessaoCadastro, atendimento: number) {
    const internado = await this.servico.internado(s.porta, atendimento);
    const [agora, parametros, desde] = await Promise.all([
      this.porta.relogio(s.porta),
      this.parametros(s, internado.unidade || null),
      this.porta.entrada(s.porta, internado.atendimento),
    ]);
    return { internado, agora: agora.slice(0, 16), parametros, desde };
  }

  private gravacao(s: SessaoCadastro) {
    return this.apoio.gravacao(s, EXTRAS);
  }

  @Get('unidades')
  @Permissao(P.ler)
  unidades(@Req() req: RequisicaoAutorizada) {
    return this.enfermagem.unidades(sessaoDe(req).porta);
  }

  @Get('unidades/:unidade/pacientes')
  @Permissao(P.ler)
  @Auditar(E.balancoLido.codigo)
  async pacientes(
    @Param('unidade') unidade: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Pick<InternadoLido, 'paciente' | 'atendimento' | 'numero' | 'nome' | 'leito' | 'unidade'>[]> {
    const u = unidade.trim();
    if (!UNIDADE.test(u))
      throw new ErroProblema('entrada-invalida', 400, 'Unidade inválida', 'Escolha a unidade.');
    req.sghAlvo = { tabelaAlvo: 'RICADINT' };
    return (await this.enfermagem.internados(sessaoDe(req).porta, u)).map((i) => ({
      paciente: i.paciente,
      atendimento: i.atendimento,
      numero: i.numero,
      nome: i.nome,
      leito: i.leito,
      unidade: i.unidade,
    }));
  }

  @Get(':atendimento')
  @Permissao(P.ler)
  @Auditar(E.balancoLido.codigo)
  async balanco(
    @Param('atendimento') atendimento: string,
    @Query('inicio') inicio: string | undefined,
    @Query('ate') ate: string | undefined,
    @Query('peso') peso: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<BalancoDoPaciente> {
    const s = sessaoDe(req);
    const c = await this.contexto(s, idDaRota(atendimento));
    req.sghAlvo = { paciente: c.internado.paciente, tabelaAlvo: TABELA };
    const [m, g] = await Promise.all([
      this.servico.montar(s.porta, {
        ...c,
        inicio: horaDaConsulta(inicio, 'inicio'),
        ate: horaDaConsulta(ate, 'ate'),
        pesoKg: pesoDaConsulta(peso),
      }),
      this.gravacao(s),
    ]);
    return this.servico.resposta(m, c.parametros.horaCorte.replace(':', ''), g);
  }

  @Post(':atendimento/lancamentos')
  @HttpCode(201)
  @Permissao(P.lancar)
  @AuditadoNoHandler('enfermagem.lancarBalanco: SGH_PEP_BALANCO com a SGH_TRILHA na mesma transação')
  async lancar(
    @Param('atendimento') atendimento: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoBalanco> {
    const s = sessaoDe(req);
    const e = corpo(esquemaLancarBalanco, b);
    const chave = chaveDoPedido(s);
    const c = await this.contexto(s, idDaRota(atendimento));
    const [dominios, fechamentos] = await Promise.all([
      this.porta.dominios(s.porta),
      this.porta.fechamentos(s.porta, c.internado.atendimento),
    ]);
    const fechadas = new Set(fechamentos.filter((f) => f.tipo === 'total').map((f) => f.inicio));
    const conferidos = e.lancamentos.map((x, i) => {
      const r = conferirLancamento(x, dominios, {
        agora: c.agora,
        horaCorte: c.parametros.horaCorte,
        fechadas,
        desde: c.desde,
      });
      if (!r.ok)
        throw new ErroProblema('entrada-invalida', 422, 'Lançamento do balanço', r.mensagem, {
          codigo: r.codigo,
          campos: [`lancamentos.${i}`],
        });
      return r;
    });
    const r = await this.apoio.sgh(
      s,
      E.balancoLancado.codigo,
      P.lancar,
      (x: { ids: number[] }) => ({
        tabela: TABELA,
        id: String(x.ids[0] ?? ''),
        paciente: c.internado.paciente,
        chave: `${c.internado.atendimento}:${x.ids.length}`,
      }),
      async (g) => {
        const ids: number[] = [];
        for (const [i, x] of conferidos.entries()) {
          const feito = await g.lancar({
            sentido: x.sentido,
            grupo: x.grupo,
            via: x.via,
            tipoEliminacao: x.tipoEliminacao,
            intensidade: x.intensidade,
            aspecto: x.aspecto,
            estimado: x.estimado,
            volumeMl: x.volumeMl,
            horaReal: x.horaReal,
            descricao: x.descricao,
            origemOffline: x.origemOffline,
            paciente: c.internado.paciente,
            atendimento: c.internado.atendimento,
            usuario: s.login,
            chave: `${chave}:${i}`.slice(0, 80),
            janelaInicio: janelaDoInstante(x.horaReal, c.parametros.horaCorte).inicio,
          });
          ids.push(feito.id);
        }
        return { ids };
      },
    );
    return {
      ok: true,
      ids: r.ids,
      mensagem:
        r.ids.length === 1
          ? 'Lançamento registrado no balanço.'
          : `${r.ids.length} lançamentos registrados no balanço.`,
    };
  }

  @Post(':atendimento/lancamentos/:id/estorno')
  @HttpCode(201)
  @Permissao(P.lancar)
  @AuditadoNoHandler(
    'enfermagem.lancarBalanco (estorno): SGH_PEP_BALANCO com a SGH_TRILHA na mesma transação',
  )
  async estornar(
    @Param('atendimento') atendimento: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoBalanco> {
    const s = sessaoDe(req);
    const e = corpo(esquemaEstornarBalanco, b);
    const c = await this.contexto(s, idDaRota(atendimento));
    const lido = await this.porta.lancamento(s.porta, idDaRota(id));
    const doAtendimento = lido && lido.atendimento === c.internado.atendimento ? lido : null;
    const fechamentos = await this.porta.fechamentos(s.porta, c.internado.atendimento);
    const fechadas = new Set(fechamentos.filter((f) => f.tipo === 'total').map((f) => f.inicio));
    const k = conferirEstorno(doAtendimento, { horaCorte: c.parametros.horaCorte, fechadas });
    if (!k.ok)
      throw new ErroProblema(
        k.codigo === 'nao-encontrado' ? 'nao-encontrado' : 'recusa-de-negocio',
        k.codigo === 'nao-encontrado' ? 404 : 409,
        'Estorno do lançamento',
        k.mensagem,
        { codigo: k.codigo },
      );
    const novo = await this.apoio.sgh(
      s,
      E.balancoEstornado.codigo,
      P.lancar,
      (x: number) => ({
        tabela: TABELA,
        id: String(x),
        paciente: c.internado.paciente,
        chave: `estorno:${id}`,
      }),
      (g) =>
        g.estornar({
          atendimento: c.internado.atendimento,
          id: idDaRota(id),
          motivo: e.motivo,
          usuario: s.login,
          janelaInicio: (h) => janelaDoInstante(h, c.parametros.horaCorte).inicio,
        }),
    );
    return { ok: true, ids: [novo], mensagem: 'Lançamento estornado. O original fica guardado.' };
  }

  @Post(':atendimento/fechamentos')
  @HttpCode(201)
  @Permissao(P.fechar)
  @AuditadoNoHandler(
    'enfermagem.fecharBalanco: SGH_PEP_BALANCO (ganhos da checagem e diurese dos sinais) e SGH_PEP_BALANCO_FECH com a SGH_TRILHA na mesma transação',
  )
  async fechar(
    @Param('atendimento') atendimento: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoBalanco> {
    const s = sessaoDe(req);
    const e = corpo(esquemaFecharBalanco, b);
    const c = await this.contexto(s, idDaRota(atendimento));
    const janela = this.servico.janela(c.agora, c.parametros.horaCorte, e.inicio);
    const fechamentos = await this.porta.fechamentos(s.porta, c.internado.atendimento);
    if (e.ate > c.agora)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Fechamento do balanço',
        'O fim do cálculo é depois de agora.',
        {
          campos: ['ate'],
        },
      );
    const k = conferirFechamento({
      tipo: e.tipo,
      janela,
      agora: e.tipo === 'total' ? c.agora : e.ate,
      fechamentos,
    });
    if (!k.ok)
      throw new ErroProblema('recusa-de-negocio', 409, 'Fechamento do balanço', k.mensagem, {
        codigo: k.codigo,
      });
    const m = await this.servico.montar(s.porta, {
      ...c,
      inicio: janela.inicio,
      ate: k.ate,
      pesoKg: e.pesoKg,
    });
    if (m.calculo.impressao !== e.impressaoVista)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Fechamento do balanço',
        'O balanço mudou depois da leitura (outro lançamento, checagem ou sinal vital): confira e feche de novo.',
        { codigo: 'balanco-mudou' },
      );
    const calc = m.calculo;
    // Os lançamentos que o cálculo contou, no mesmo intervalo que a gravação relê: [inicio, ate] no parcial até um
    // minuto antes do fim da janela (o lançamento do próprio minuto conta, como no cálculo), [inicio, fim) no resto.
    const fimInclusivo = m.ate < m.janela.fim;
    const vistos = m.vigentes.filter(
      (l) => l.horaReal >= m.janela.inicio && (fimInclusivo ? l.horaReal <= m.ate : l.horaReal < m.ate),
    );
    const r = await this.apoio.sgh(
      s,
      E.balancoFechado.codigo,
      P.fechar,
      (x: { id: number }) => ({
        tabela: 'SGH_PEP_BALANCO_FECH',
        id: String(x.id),
        paciente: c.internado.paciente,
        chave: `${e.tipo}:${janela.inicio}:${k.ate}`,
      }),
      (g) =>
        g.fechar({
          paciente: c.internado.paciente,
          atendimento: c.internado.atendimento,
          unidade: c.internado.unidade || null,
          horaCorte: c.parametros.horaCorte,
          tipo: e.tipo,
          inicio: janela.inicio,
          fim: m.ate,
          fimInclusivo,
          lancamentosVistos: vistos.map((l) => l.id),
          pendentes: m.pendentes,
          ganhosMl: calc.ganhosMl,
          perdasMl: calc.perdasMl,
          insensiveisMl: calc.insensiveisMl,
          saldoMl: calc.saldoMl,
          diureseMl: calc.diureseMl,
          pesoKg: calc.pesoKg,
          temperaturaMaxima: calc.temperaturaMaxima,
          debitoUrinario: calc.debitoUrinario,
          oliguria: calc.oliguria,
          formula: calc.formula,
          lancamentos: calc.lancamentos,
          parcelas: textoDoFechamento(calc),
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      ids: [r.id],
      mensagem:
        e.tipo === 'total'
          ? `Balanço de 24 horas fechado: saldo de ${calc.saldoMl.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} mL.`
          : `Balanço parcial fechado: saldo de ${calc.saldoMl.toLocaleString('pt-BR', { minimumFractionDigits: 1 })} mL.`,
    };
  }
}
