// OPME (M46, etapa 3; ficha, seções 4, 5, 7 e 8; regras 6 a 9 e 13):
//   GET  /api/suprimentos/opme?de=&ate=                         as solicitações do período com as etapas
//   GET  /api/suprimentos/opme/cirurgias?data=                  as cirurgias do dia com o OPME pedido e consumido
//   GET  /api/suprimentos/opme/itens?termo=&local=              os itens de OPME (classe 50) com o saldo no local
//   GET  /api/suprimentos/opme/fornecedores?termo=              os fornecedores (código e nome) para a busca da tela
//   POST /api/suprimentos/opme                                  suprimentos.solicitarOpme (ligada à agenda)
//   POST /api/suprimentos/opme/:id/etapas                       suprimentos.avancarEtapaOpme (a autorização da operadora
//                                                               à mão, com a senha e a guia; DP-37)
//   GET  /api/suprimentos/opme/cirurgias/:agenda                o consumo em sala da cirurgia (leitura de prontuário)
//   POST /api/suprimentos/opme/cirurgias/:agenda/consumos       a saída do estoque a internado com o rastreio (OPME_CONSUMIDO,
//                                                               OPME_SEM_AUTORIZACAO) e a etiqueta em três vias
//   GET  /api/suprimentos/opme/consumos/:id/etiqueta            a etiqueta de novo (a mesma, do rastreio gravado)
//   POST /api/suprimentos/opme/cirurgias/:agenda/devolucoes     a devolução do OPME não usado ao estoque
//   GET  /api/suprimentos/opme/conciliacao?de=&ate=             a conciliação com a conta (o indicador, regra 9)
//   GET  /api/suprimentos/opme/rastreio?item=&lote=&serie=&registroAnvisa=  o rastreio reverso (lote, série ou registro
//                                                               Anvisa → pacientes; as saídas do lote no estoque; regra 8)
// O consumo e a devolução vão pelo EXECUTOR (o rastreio na mesma transação da saída, passo 7); a solicitação e as etapas,
// diretas, com a trilha na mesma transação. Nasce desligado (chave `suprimentos.opme`, POL-3).
import { createHash } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type ConciliacaoOpme,
  type ConsumoOpme,
  type ConsumoOpmeRegistrado,
  type ContextoConsumoOpme,
  esquemaAvancarEtapaOpme,
  esquemaConsumirOpme,
  esquemaDevolverOpme,
  esquemaRastreioReversoOpme,
  esquemaSolicitarOpme,
  type EtiquetaOpme,
  EVENTOS_AUDITAVEIS,
  type GravacaoAgenda,
  type ItemOpme,
  PERMISSOES_OPME_CODIGOS as P,
  PERMISSOES_BLOCO_SEGURO_CODIGOS,
  type RastreioReversoOpme,
  type SolicitacaoOpme,
} from '@sgh/contratos';
import { zplEtiquetaOpme } from '@sgh/dominio-documento';
import {
  conciliarOpme,
  conferirConsumoOpme,
  conferirDevolucaoOpme,
  conferirEtapaOpme,
  conferirSolicitacaoOpme,
  consumoExigeExcecao,
  situacaoDepoisDaEtapa,
} from '@sgh/dominio-suprimentos';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, linhaTrilha, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_CIRURGIA, type PortaCirurgia } from '../cirurgia/porta.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { type ConsumoOpmeLeitura, type GravadorOpme, PORTA_OPME, type PortaOpme } from './opme-porta.js';
import { PORTA_SUPRIMENTOS, type PortaSuprimentos } from './porta.js';

const E = EVENTOS_AUDITAVEIS;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
export const CHAVE_LIBERACAO_OPME = 'suprimentos.opme';
/** O período máximo das listas (as solicitações e a conciliação): 62 dias. */
const PERIODO_MAXIMO_DIAS = 62;
const instanteT = (v: string) => v.trim().replace(' ', 'T').slice(0, 16);
const diaBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** As iniciais do nome (a etiqueta leva as iniciais; o nome completo fica no prontuário). */
export const iniciais = (nome: string | null) =>
  (nome ?? '')
    .split(/\s+/)
    .filter((p) => p.length > 2 || /^[A-Z]$/i.test(p))
    .map((p) => `${p[0]!.toUpperCase()}.`)
    .join('')
    .slice(0, 12) || '-';

export interface ResultadoOpme {
  readonly ok: true;
  readonly id: number;
  readonly mensagem: string;
}

/** A etiqueta das três vias a partir do consumo gravado (sempre a mesma: a reimpressão confere pelo SHA-256). */
export function etiquetaDoConsumo(
  c: ConsumoOpme,
  o: { paciente: string | null; tuss: string | null },
): EtiquetaOpme {
  const zpl = zplEtiquetaOpme({
    consumo: c.id,
    lancamento: c.lancamento,
    atendimento: c.atendimento,
    conta: c.conta,
    iniciais: iniciais(o.paciente),
    data: diaBr(c.dataHora),
    item: c.itemNome ?? `ITEM ${c.item}`,
    tuss: o.tuss,
    quantidade: c.quantidade,
    fabricante: c.fabricante,
    modelo: c.modelo,
    lote: c.lote,
    serie: c.serie,
    registroAnvisa: c.registroAnvisa,
    validade: c.validade ? diaBr(c.validade) : null,
  });
  return {
    zpl,
    vias: ['prontuario', 'paciente', 'faturamento'],
    sha256: createHash('sha256').update(zpl, 'utf8').digest('hex'),
  };
}

function periodo(de: string | undefined, ate: string | undefined, hoje: string): { de: string; ate: string } {
  const d = de && DATA.test(de) ? de : hoje;
  const a = ate && DATA.test(ate) ? ate : d;
  if (a < d)
    throw new ErroProblema('entrada-invalida', 400, 'Período inválido', 'O fim vem antes do início.');
  const dias = (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000;
  if (dias > PERIODO_MAXIMO_DIAS)
    throw new ErroProblema(
      'entrada-invalida',
      400,
      'Período longo demais',
      `Consulte no máximo ${PERIODO_MAXIMO_DIAS} dias de cada vez.`,
    );
  return { de: d, ate: a };
}

function recusaOpme(codigo: string, mensagem: string, campos?: readonly string[]): ErroProblema {
  return new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });
}

@Controller('suprimentos/opme')
export class OpmeController {
  private readonly apoio: ApoioGravacao<GravadorOpme>;

  constructor(
    @Inject(PORTA_OPME) private readonly porta: PortaOpme,
    @Inject(PORTA_CIRURGIA) private readonly cirurgia: PortaCirurgia,
    @Inject(PORTA_SUPRIMENTOS) private readonly suprimentos: PortaSuprimentos,
    @Inject(REGISTRADOR_TRILHA) private readonly trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      {
        chave: CHAVE_LIBERACAO_OPME,
        nome: 'o OPME',
        operacoes: {
          'suprimentos.registrarSaida': P.consumir,
          'suprimentos.registrarDevolucao': P.consumir,
        },
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  // ── Apoio ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private async agora(s: SessaoCadastro): Promise<string> {
    const r = await this.cirurgia.relogio(s.porta);
    return `${r.hoje}T${r.hhmm.slice(0, 2)}:${r.hhmm.slice(2, 4)}`;
  }

  private chave(s: SessaoCadastro, doCorpo: string): string {
    const bruto = s.req.headers['idempotency-key'];
    const k = Array.isArray(bruto) ? bruto[0] : bruto;
    if (typeof k !== 'string' || !CHAVE.test(k) || k !== doCorpo)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido incompleto',
        'A Idempotency-Key do pedido falta ou difere da chave do corpo.',
      );
    return k;
  }

  private gravacao(s: SessaoCadastro): Promise<GravacaoAgenda> {
    return this.apoio.gravacao(s, {
      solicitar: P.solicitar,
      avancar: P.avancar,
      autorizar: P.autorizar,
      consumir: P.consumir,
    });
  }

  /** O supervisor registra o consumo sem a autorização da operadora (D-SUP-463). */
  private podeExcecao(s: SessaoCadastro): boolean {
    return s.pode(P.autorizar) || s.pode(PERMISSOES_BLOCO_SEGURO_CODIGOS.checklistExcecao);
  }

  private async agendamento(s: SessaoCadastro, id: number) {
    const a = await this.cirurgia.agendamento(s.porta, id);
    if (!a)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Cirurgia não encontrada',
        'O agendamento não existe mais (pode ter sido cancelado).',
      );
    return a;
  }

  private corpoDaRota(e: { agendamento: number }, agenda: string): number {
    const id = idDaRota(agenda);
    if (e.agendamento !== id)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inconsistente',
        'O agendamento do corpo difere da rota.',
      );
    return id;
  }

  private async registrarTrilha(
    s: SessaoCadastro,
    evento: string,
    recurso: string,
    alvo: { tabela: string; id: string; paciente: number | null; chave: string },
  ): Promise<void> {
    const l = linhaTrilha(s, evento, recurso, evento, alvo);
    await this.trilha.registrar({
      evento,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      estacao: String((l.dadosDepois as { estacao?: unknown } | undefined)?.estacao ?? ''),
      correlacao: l.correlacao ?? '',
      recurso,
      resultado: 'sucesso',
      tabelaAlvo: alvo.tabela,
      idAlvo: alvo.id,
      chaveNaturalAlvo: alvo.chave,
      ...(alvo.paciente !== null ? { paciente: alvo.paciente } : {}),
    });
  }

  // ── Solicitações e etapas (suprimentos) ────────────────────────────────────────────────────────────────────────

  @Get()
  @Permissao(P.ler)
  async solicitacoes(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    de: string;
    ate: string;
    solicitacoes: SolicitacaoOpme[];
    cortada: boolean;
    gravacao: GravacaoAgenda;
  }> {
    const s = sessaoDe(req);
    const p = periodo(de, ate, (await this.agora(s)).slice(0, 10));
    const [r, gravacao] = await Promise.all([
      this.porta.solicitacoesDoPeriodo(s.porta, p.de, p.ate),
      this.gravacao(s),
    ]);
    return { ...p, solicitacoes: r.itens, cortada: r.cortada, gravacao };
  }

  @Get('cirurgias')
  @Permissao(P.ler)
  @Auditar(E.opmeConsumoLido.codigo)
  async cirurgias(@Query('data') data: string | undefined, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'solicitacao_opme' };
    const agora = await this.agora(s);
    const dia = data && DATA.test(data) ? data : agora.slice(0, 10);
    const { itens, truncado } = await this.cirurgia.agendamentos(s.porta, dia, dia, null);
    const ids = itens.map((a) => a.id);
    const [sols, cons, procs, gravacao, locais] = await Promise.all([
      this.porta.solicitacoesDosAgendamentos(s.porta, ids),
      this.porta.consumosDosAgendamentos(s.porta, ids),
      this.cirurgia.nomesProcedimentos(s.porta, [...new Set(itens.map((a) => a.procedimento))]),
      this.gravacao(s),
      this.suprimentos.locais(s.porta),
    ]);
    return {
      data: dia,
      truncado,
      locais,
      localSugerido: await this.localSugerido(s, locais),
      cirurgias: itens.map((a) => ({
        agendamento: a.id,
        sala: a.sala,
        inicio: instanteT(a.inicio),
        atendimento: a.reg,
        paciente: a.paciente.trim(),
        procedimento: procs.get(a.procedimento) ?? null,
        solicitacoes: sols.filter((x) => x.agendamento === a.id).length,
        consumos: cons.filter((x) => x.agendamento === a.id).length,
      })),
      gravacao,
    };
  }

  @Get('itens')
  @Permissao(P.ler)
  async itens(
    @Query('termo') termo: string | undefined,
    @Query('local') local: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: ItemOpme[]; cortada: boolean }> {
    const s = sessaoDe(req);
    const l = Number(local);
    const hoje = (await this.agora(s)).slice(0, 10);
    return this.porta.itens(s.porta, {
      termo: (termo ?? '').slice(0, 60),
      local: Number.isInteger(l) && l >= 1 && l <= 99 ? l : 10,
      hoje,
    });
  }

  @Get('fornecedores')
  @Permissao(P.ler)
  async fornecedores(
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: { codigo: number; nome: string }[]; cortada: boolean }> {
    return this.porta.fornecedores(sessaoDe(req).porta, (termo ?? '').slice(0, 60));
  }

  /**
   * O fornecedor, o pedido de compra e a nota fiscal citados existem no cadastro (ficha, seção 6: o pedido de compra
   * e a nota de entrada); o pedido e a nota são do fornecedor da solicitação quando ele é conhecido.
   */
  private async conferirDocumentos(
    s: SessaoCadastro,
    d: {
      fornecedor: number | null;
      pedido: { ano: number; doc: number } | null;
      nf: { ano: number; mes: number; doc: number } | null;
    },
    fornecedorDaSolicitacao: number | null,
  ): Promise<void> {
    if (d.fornecedor === null && !d.pedido && !d.nf) return;
    const r = await this.porta.documentosCompra(s.porta, d);
    if (d.fornecedor !== null && r.fornecedor === null)
      throw recusaOpme('fornecedor-inexistente', 'O fornecedor não está no cadastro.', ['fornecedor']);
    const forn = d.fornecedor ?? fornecedorDaSolicitacao;
    if (d.pedido) {
      if (!r.pedido)
        throw recusaOpme('pedido-inexistente', 'O pedido de compra não foi encontrado.', ['pedido']);
      const fs = r.pedido.fornecedores.filter((f) => f > 0);
      if (forn !== null && fs.length > 0 && !fs.includes(forn))
        throw recusaOpme('pedido-de-outro-fornecedor', 'O pedido de compra é de outro fornecedor.', [
          'pedido',
        ]);
    }
    if (d.nf) {
      if (!r.nf) throw recusaOpme('nf-inexistente', 'A nota fiscal de entrada não foi encontrada.', ['nf']);
      if (forn !== null && r.nf.fornecedor > 0 && r.nf.fornecedor !== forn)
        throw recusaOpme('nf-de-outro-fornecedor', 'A nota fiscal é de outro fornecedor.', ['nf']);
    }
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.solicitar)
  @AuditadoNoHandler('suprimentos.solicitarOpme: solicitacao_opme e a etapa com a trilha na mesma transação')
  async solicitar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoOpme> {
    const s = sessaoDe(req);
    const e = corpo(esquemaSolicitarOpme, b);
    const chave = this.chave(s, e.chave);
    const [a, estado, classe, consignado, agora] = await Promise.all([
      this.agendamento(s, e.agendamento),
      this.cirurgia.estado(s.porta, e.agendamento),
      this.porta.classeDoItem(s.porta, e.item),
      this.porta.itemConsignado(s.porta, e.item),
      this.agora(s),
    ]);
    const r = conferirSolicitacaoOpme({
      classeItem: classe,
      tuss: e.tuss,
      quantidade: e.quantidade,
      justificativa: e.justificativa,
      agendamento:
        estado?.estado === 'cancelado' || estado?.estado === 'suspenso'
          ? 'cancelado'
          : estado?.estado === 'realizado'
            ? 'realizado'
            : 'aberto',
    })[0];
    if (r) throw recusaOpme(r.codigo, r.mensagem, r.campos);
    await this.conferirDocumentos(s, { fornecedor: e.fornecedor, pedido: null, nf: null }, null);
    const x = await this.apoio.sgh(
      s,
      E.opmeSolicitado.codigo,
      P.solicitar,
      (y: { id: number }) => ({
        tabela: 'solicitacao_opme',
        id: String(y.id),
        paciente: estado?.idPaciente ?? null,
        chave: `${e.agendamento}:${e.item}`,
      }),
      (g) =>
        g.solicitar({
          agendamento: e.agendamento,
          sala: a.sala,
          dataHora: instanteT(a.inicio),
          reg: a.reg,
          paciente: estado?.idPaciente ?? null,
          item: e.item,
          tuss: e.tuss,
          quantidade: e.quantidade,
          fornecedor: e.fornecedor,
          justificativa: e.justificativa,
          consignado,
          em: agora,
          usuario: s.login,
          chave,
        }),
    );
    return {
      ok: true,
      id: x.id,
      mensagem: x.repetida ? 'A solicitação já estava registrada.' : 'OPME solicitado.',
    };
  }

  @Post(':id/etapas')
  @HttpCode(201)
  @Permissao(P.avancar)
  @AuditadoNoHandler(
    'suprimentos.avancarEtapaOpme: solicitacao_opme_item e a solicitação com a trilha na mesma transação',
  )
  async avancar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoOpme> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAvancarEtapaOpme, b);
    if (e.solicitacao !== idDaRota(id))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inconsistente',
        'A solicitação do corpo difere da rota.',
      );
    const chave = this.chave(s, e.chave);
    // A autorização e a negativa da operadora são de quem autoriza (suprimentos com a alçada).
    if ((e.etapa === 'autorizacao' || e.etapa === 'negativa') && !s.pode(P.autorizar))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'Só quem autoriza registra a resposta da operadora.',
        {
          codigo: 'sem-permissao',
        },
      );
    const agora = await this.agora(s);
    if (e.em.slice(0, 16) > agora.slice(0, 16))
      throw recusaOpme('horario-futuro', 'O horário informado é depois de agora.', ['em']);
    const r = await this.apoio.sgh(
      s,
      E.opmeEtapa.codigo,
      e.etapa === 'autorizacao' || e.etapa === 'negativa' ? P.autorizar : P.avancar,
      (y: { etapa: number }) => ({
        tabela: 'solicitacao_opme_item',
        id: String(y.etapa),
        chave: `${e.solicitacao}:${e.etapa}`,
      }),
      async (g) => {
        const pedido = {
          solicitacao: e.solicitacao,
          etapa: e.etapa,
          em: e.em,
          quantidade: e.quantidade,
          fornecedor: e.fornecedor,
          senha: e.senha,
          guia: e.guia,
          validade: e.validade,
          pedido: e.pedido,
          nf: e.nf,
          observacao: e.observacao,
        };
        const ja = await g.etapaPelaChave(chave, pedido);
        if (ja) {
          if (ja.solicitacao !== e.solicitacao)
            throw recusaOpme('chave-reutilizada', 'A chave do pedido já foi usada.');
          return { etapa: ja.id, versao: 0 };
        }
        const sol = await g.solicitacao(e.solicitacao);
        if (!sol)
          throw new ErroProblema(
            'nao-encontrado',
            404,
            'Solicitação não encontrada',
            'A solicitação não existe.',
          );
        if (sol.versao !== e.versaoVista)
          throw recusaOpme('opme-mudou', 'A solicitação de OPME mudou em outra tela: recarregue e confira.');
        const x = conferirEtapaOpme({
          situacao: sol.situacao,
          etapa: e.etapa,
          quantidadeSolicitada: sol.quantidade,
          quantidade: e.quantidade,
          senha: e.senha,
          guia: e.guia,
          validade: e.validade,
          hoje: agora.slice(0, 10),
          fornecedor: e.fornecedor,
          pedido: e.pedido,
          nf: e.nf,
          observacao: e.observacao,
        })[0];
        if (x) throw recusaOpme(x.codigo, x.mensagem, x.campos);
        await this.conferirDocumentos(
          s,
          { fornecedor: e.fornecedor, pedido: e.pedido, nf: e.nf },
          sol.fornecedor,
        );
        const situacao = situacaoDepoisDaEtapa(sol.situacao, e.etapa, sol);
        return g.avancar({
          ...pedido,
          solicitacao: sol.id,
          versaoVista: sol.versao,
          usuario: s.login,
          chave,
          mudanca: {
            situacao,
            ...(e.etapa === 'autorizacao'
              ? { autorizada: e.quantidade ?? 0, senha: e.senha, guia: e.guia, validade: e.validade }
              : {}),
            ...(e.etapa === 'consignacao' ? { fornecedor: e.fornecedor, consignado: true } : {}),
          },
        });
      },
    );
    return { ok: true, id: r.etapa, mensagem: 'Etapa do OPME registrada.' };
  }

  // ── Consumo em sala (bloco) ────────────────────────────────────────────────────────────────────────────────────

  @Get('cirurgias/:agenda')
  @Permissao(P.ler)
  @Auditar(E.opmeConsumoLido.codigo)
  async contexto(
    @Param('agenda') agenda: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ContextoConsumoOpme> {
    const s = sessaoDe(req);
    const id = idDaRota(agenda);
    const a = await this.agendamento(s, id);
    const [estado, sols, cons, procs, salas, locais, gravacao] = await Promise.all([
      this.cirurgia.estado(s.porta, id),
      this.porta.solicitacoesDosAgendamentos(s.porta, [id]),
      this.porta.consumosDosAgendamentos(s.porta, [id]),
      this.cirurgia.nomesProcedimentos(s.porta, [a.procedimento]),
      this.cirurgia.salas(s.porta, s.login),
      this.suprimentos.locais(s.porta),
      this.gravacao(s),
    ]);
    req.sghAlvo = {
      ...(estado?.idPaciente ? { paciente: estado.idPaciente } : {}),
      tabelaAlvo: 'consumo_opme',
    };
    const cirurgiao = estado?.cirurgiao ?? a.pares['ID_CRM'] ?? null;
    const nomes = cirurgiao
      ? await this.cirurgia.nomesProfissionais(s.porta, [cirurgiao])
      : new Map<number, string>();
    return {
      agendamento: {
        id,
        sala: a.sala,
        salaNome: salas.find((x) => x.codigo === a.sala)?.nome ?? null,
        dataHora: instanteT(a.inicio),
        atendimento: a.reg,
        paciente: a.paciente.trim() || null,
        procedimento: procs.get(a.procedimento) ?? null,
        cirurgiao: cirurgiao ? (nomes.get(cirurgiao) ?? null) : null,
      },
      solicitacoes: sols,
      consumos: cons.map((c) => this.consumoPublico(c)),
      locais,
      localSugerido: await this.localSugerido(s, locais),
      podeExcecao: this.podeExcecao(s),
      gravacao,
    };
  }

  /** O local sugerido: o primeiro local com saldo de OPME (contrato); sem nenhum, o primeiro da lista. */
  private async localSugerido(
    s: SessaoCadastro,
    locais: readonly { codigo: number }[],
  ): Promise<number | null> {
    const l = await this.porta.localComSaldo(
      s.porta,
      locais.map((x) => x.codigo),
    );
    return l ?? locais[0]?.codigo ?? null;
  }

  private consumoPublico(c: ConsumoOpmeLeitura): ConsumoOpme {
    const { paciente: _p, cirurgiao: _c, fornecedor: _f, ...resto } = c;
    void _p;
    void _c;
    void _f;
    return resto;
  }

  @Post('cirurgias/:agenda/consumos')
  @HttpCode(201)
  @Permissao(P.consumir)
  @AuditadoNoHandler(
    'suprimentos.registrarSaida pelo executor com o rastreio do OPME (consumo_opme) na mesma transação',
  )
  async consumir(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ConsumoOpmeRegistrado> {
    const s = sessaoDe(req);
    const e = corpo(esquemaConsumirOpme, b);
    const id = this.corpoDaRota(e, agenda);
    const chave = this.chave(s, e.chave);
    const ja = await this.porta.consumoPelaChave(s.porta, chave);
    // A chave de outro consumo (de outra cirurgia) não devolve aquele consumo nem mistura a etiqueta de dois pacientes.
    if (ja && ja.agendamento !== id)
      throw recusaOpme('chave-reutilizada', 'A chave do pedido já foi usada.', ['chave']);
    const a = await this.agendamento(s, id);
    if (ja) return this.registrado(s, ja, a.paciente, true);
    const [estado, salas, centros, classe, consignado, agora, sol] = await Promise.all([
      this.cirurgia.estado(s.porta, id),
      this.cirurgia.salas(s.porta, s.login),
      this.suprimentos.centrosCusto(s.porta),
      this.porta.classeDoItem(s.porta, e.item),
      this.porta.itemConsignado(s.porta, e.item),
      this.agora(s),
      e.solicitacao !== null ? this.porta.solicitacao(s.porta, e.solicitacao) : Promise.resolve(null),
    ]);
    if (estado?.estado === 'cancelado' || estado?.estado === 'suspenso')
      throw recusaOpme('agendamento-encerrado', 'O agendamento da cirurgia foi cancelado.', ['agendamento']);
    if (!(a.reg > 0))
      throw recusaOpme(
        'sem-internacao',
        'O paciente da cirurgia ainda não está internado: o consumo de OPME é lançado no atendimento da internação.',
        ['agendamento'],
      );
    if (e.solicitacao !== null && (!sol || sol.agendamento !== id))
      throw recusaOpme('solicitacao-inexistente', 'A solicitação não é desta cirurgia.', ['solicitacao']);
    const podeExcecao = this.podeExcecao(s);
    const excecao = consumoExigeExcecao(sol);
    const r = conferirConsumoOpme({
      solicitacao: sol,
      item: e.item,
      classeItem: classe,
      quantidade: e.quantidade,
      lote: e.lote,
      serie: e.serie,
      fabricante: e.fabricante,
      registroAnvisa: e.registroAnvisa,
      validade: e.validade,
      hoje: agora.slice(0, 10),
      justificativa: e.justificativa,
      podeExcecao,
    })[0];
    if (r) throw recusaOpme(r.codigo, r.mensagem, r.campos);
    const cdc = salas.find((x) => x.codigo === a.sala)?.centroCusto ?? 0;
    const centro = centros.find((x) => x.codigo === cdc);
    if (!centro)
      throw recusaOpme(
        'sala-sem-centro-custo',
        'A sala da cirurgia não tem centro de custo do estoque: a saída do OPME não tem destino.',
      );
    const cirurgiao = estado?.cirurgiao ?? a.pares['ID_CRM'] ?? null;
    await this.apoio.executar(
      s,
      'suprimentos.registrarSaida',
      {
        destino: 1,
        origem: 'E',
        local: e.local,
        centroCusto: centro.codigo,
        localConsumo: centro.localConsumo,
        atendimento: a.reg,
        itens: [{ item: e.item, quantidade: e.quantidade, lotes: [] }],
        opme: {
          agendamento: id,
          sala: a.sala,
          dataHora: instanteT(a.inicio),
          paciente: estado?.idPaciente ?? null,
          cirurgiao,
          solicitacao: sol?.id ?? null,
          versaoVista: sol?.versao ?? null,
          lote: e.lote,
          serie: e.serie,
          fabricante: e.fabricante,
          modelo: e.modelo,
          registroAnvisa: e.registroAnvisa,
          validade: e.validade,
          codigoLido: e.codigoLido,
          consignado,
          fornecedor: sol?.fornecedor ?? null,
          semAutorizacao: excecao ? { por: s.login, motivo: e.justificativa ?? '' } : null,
          chave,
        },
      },
      'OPME consumido.',
      { chaveIdempotencia: chave },
    );
    const c = await this.porta.consumoPelaChave(s.porta, chave);
    if (!c)
      throw new ErroProblema('indisponivel', 503, 'Consumo não relido', 'O consumo gravado não foi relido.');
    const alvo = {
      tabela: 'consumo_opme',
      id: String(c.id),
      paciente: estado?.idPaciente ?? null,
      chave: `${id}:${e.item}`,
    };
    await this.registrarTrilha(s, E.opmeConsumido.codigo, P.consumir, alvo);
    if (excecao) await this.registrarTrilha(s, E.opmeSemAutorizacao.codigo, P.consumir, alvo);
    return this.registrado(s, c, a.paciente, false, sol?.tuss ?? null);
  }

  private async registrado(
    s: SessaoCadastro,
    c: ConsumoOpmeLeitura,
    paciente: string,
    repetida: boolean,
    tuss?: string | null,
  ): Promise<ConsumoOpmeRegistrado> {
    const t =
      tuss !== undefined
        ? tuss
        : c.solicitacao !== null
          ? ((await this.porta.solicitacao(s.porta, c.solicitacao))?.tuss ?? null)
          : null;
    return {
      consumo: c.id,
      saida: c.saida,
      lancamento: c.lancamento,
      etiqueta: etiquetaDoConsumo(c, { paciente, tuss: t }),
      repetida,
    };
  }

  @Get('consumos/:id/etiqueta')
  @Permissao(P.consumir)
  @Auditar(E.opmeConsumoLido.codigo)
  async etiqueta(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<EtiquetaOpme> {
    const s = sessaoDe(req);
    const c = await this.porta.consumo(s.porta, idDaRota(id));
    if (!c)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Consumo não encontrado',
        'O consumo de OPME não existe.',
      );
    req.sghAlvo = { ...(c.paciente ? { paciente: c.paciente } : {}), tabelaAlvo: 'consumo_opme' };
    const a = await this.cirurgia.agendamento(s.porta, c.agendamento);
    return (await this.registrado(s, c, a?.paciente ?? '', true)).etiqueta;
  }

  @Post('cirurgias/:agenda/devolucoes')
  @HttpCode(201)
  @Permissao(P.consumir)
  @AuditadoNoHandler(
    'suprimentos.registrarDevolucao pelo executor com a devolução do OPME na mesma transação',
  )
  async devolver(
    @Param('agenda') agenda: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoOpme> {
    const s = sessaoDe(req);
    const e = corpo(esquemaDevolverOpme, b);
    const id = this.corpoDaRota(e, agenda);
    const chave = this.chave(s, e.chave);
    const c = await this.porta.consumo(s.porta, e.consumo);
    if (!c || c.agendamento !== id)
      throw recusaOpme('consumo-inexistente', 'O consumo de OPME não é desta cirurgia.', ['consumo']);
    const r = conferirDevolucaoOpme({
      consumida: c.quantidade,
      devolvida: c.devolvida,
      quantidade: e.quantidade,
      motivo: e.motivo,
    })[0];
    if (r) throw recusaOpme(r.codigo, r.mensagem, r.campos);
    // A devolução volta ao local de onde a saída do consumo partiu (o executor confere o ARM da saída).
    const local = await this.porta.localDaSaida(s.porta, c.saida);
    if (local === null)
      throw recusaOpme('saida-inexistente', 'A saída do consumo de OPME não foi encontrada.', ['consumo']);
    const x = await this.apoio.executar(
      s,
      'suprimentos.registrarDevolucao',
      {
        saida: c.saida.id,
        local,
        itens: [{ lancamentoSaida: c.lancamento, item: c.item, quantidade: e.quantidade, lotes: [] }],
        opme: { consumo: c.id, motivo: e.motivo, chave },
      },
      'OPME devolvido ao estoque.',
      { chaveIdempotencia: chave },
    );
    await this.registrarTrilha(s, E.opmeDevolvido.codigo, P.consumir, {
      tabela: 'consumo_opme',
      id: String(c.id),
      paciente: c.paciente,
      chave: `${id}:${c.item}`,
    });
    return { ok: true, id: Number(x.resultado['id'] ?? c.id), mensagem: x.mensagem };
  }

  // ── Conciliação e rastreio reverso ─────────────────────────────────────────────────────────────────────────────

  @Get('conciliacao')
  @Permissao(P.conciliar)
  async conciliacao(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ConciliacaoOpme> {
    const s = sessaoDe(req);
    const p = periodo(de, ate, (await this.agora(s)).slice(0, 10));
    const { itens: consumos, cortada } = await this.porta.consumosDoPeriodo(s.porta, p.de, p.ate);
    const solIds = [...new Set(consumos.map((c) => c.solicitacao).filter((x): x is number => x !== null))];
    const [conta, sols] = await Promise.all([
      this.porta.itensDaConta(
        s.porta,
        consumos.map((c) => c.conta),
        consumos.map((c) => c.item),
      ),
      Promise.all(solIds.map((x) => this.porta.solicitacao(s.porta, x))),
    ]);
    const porSol = new Map(sols.filter((x): x is SolicitacaoOpme => x !== null).map((x) => [x.id, x]));
    const r = conciliarOpme(consumos, conta);
    return {
      ...p,
      linhas: consumos.map((c, i) => {
        const sol = c.solicitacao !== null ? porSol.get(c.solicitacao) : undefined;
        const nf = sol?.etapas.filter((x) => x.etapa === 'nf').at(-1)?.nf ?? null;
        const l = r.linhas[i]!;
        return {
          consumo: c.id,
          solicitacao: c.solicitacao,
          atendimento: c.atendimento,
          conta: c.conta,
          dataHora: c.dataHora,
          item: c.item,
          itemNome: c.itemNome,
          tuss: sol?.tuss ?? null,
          lote: c.lote,
          serie: c.serie,
          consignado: c.consignado,
          usada: l.usada,
          naConta: l.naConta,
          situacao: l.situacao,
          nf,
        };
      }),
      indicador: r.indicador,
      cortada,
    };
  }

  @Get('rastreio')
  @Permissao('suprimentos.lote.rastrear')
  @Auditar(E.opmeRastreioReverso.codigo)
  async rastreio(
    @Query('item') item: string | undefined,
    @Query('lote') lote: string | undefined,
    @Query('serie') serie: string | undefined,
    @Query('registroAnvisa') registroAnvisa: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<RastreioReversoOpme> {
    const s = sessaoDe(req);
    const f = corpo(esquemaRastreioReversoOpme, {
      item: item?.trim() ? Number(item) : null,
      lote: lote?.trim() || null,
      serie: serie?.trim() || null,
      registroAnvisa: registroAnvisa?.trim() || null,
    });
    req.sghAlvo = { tabelaAlvo: 'consumo_opme' };
    const r = await this.porta.rastreioReverso(s.porta, f);
    return { item: f.item, lote: f.lote, serie: f.serie, registroAnvisa: f.registroAnvisa, ...r };
  }
}
