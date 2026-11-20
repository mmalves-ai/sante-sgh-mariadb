// Manipulação e capelas (M46, etapa 4; ficha, seções 4, 5, 7 e 8; regras 11 e 13):
//   GET  /api/farmacia/manipulacao?de=&ate=               os itens validados a manipular (leitura de prontuário: o leito e
//                                                         as iniciais), as ordens do período, as capelas e os grupos, os
//                                                         locais e os centros de custo
//   GET  /api/farmacia/manipulacao/insumos?termo=         os insumos do cadastro do estoque para a busca da tela
//   GET  /api/farmacia/manipulacao/insumos/:item?local=   o saldo e os lotes do insumo no local
//   POST /api/farmacia/manipulacao                        suprimentos.abrirOrdemManipulacao (só do item validado)
//   POST /api/farmacia/manipulacao/:id/conferencias       suprimentos.conferirManipulacao (a dupla conferência por outro
//                                                         farmacêutico; MANIPULACAO_CONFERIDA)
//   POST /api/farmacia/manipulacao/:id/baixa              a baixa do insumo: a saída do estoque a paciente internado
//                                                         (suprimentos.registrarSaida com o bloco `manipulacao`)
// A abertura e a conferência só do novo (SGH_), com a SGH_TRILHA na mesma transação; a baixa pelo EXECUTOR (a ordem
// ligada na mesma transação da saída). Nasce desligado (chave `suprimentos.manipulacao`, POL-3).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type CapelaManipulacao,
  esquemaAbrirOrdemManipulacao,
  esquemaBaixarManipulacao,
  esquemaConferirManipulacao,
  EVENTOS_AUDITAVEIS,
  type GravacaoAgenda,
  type ItemAManipular,
  type ItemBusca,
  type OrdemManipulacao,
  PERMISSOES_MANIPULACAO_CODIGOS as P,
  REGRA_SOBRA_MANIPULACAO,
  type SaldoItem,
} from '@sgh/contratos';
import {
  conferirAberturaManipulacao,
  conferirBaixaManipulacao,
  conferirConferenciaManipulacao,
  situacaoDepoisDaConferencia,
} from '@sgh/dominio-suprimentos';
import { categoriaDoCbo } from '@sgh/dominio-pep';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import { PORTA_CIRURGIA, type PortaCirurgia } from '../cirurgia/porta.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { type GravadorManipulacao, PORTA_MANIPULACAO, type PortaManipulacao } from './manipulacao-porta.js';
import { PORTA_SUPRIMENTOS, type PortaSuprimentos } from './porta.js';

const E = EVENTOS_AUDITAVEIS;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
export const CHAVE_LIBERACAO_MANIPULACAO = 'suprimentos.manipulacao';
/** A fila mostra os itens validados nos últimos dias (a manipulação é do dia; o atraso aparece). */
const DIAS_FILA = 2;
const PERIODO_MAXIMO_DIAS = 31;
const ALERTA_LOTE_DIAS = 30;

export const MOTIVO_SO_FARMACEUTICO =
  'A dupla conferência é do farmacêutico: a sessão precisa do vínculo de farmacêutico com o conselho ativo.';

const menosDias = (iso: string, dias: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);

function recusaManipulacao(codigo: string, mensagem: string, campos?: readonly string[]): ErroProblema {
  return new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });
}

export interface ResultadoManipulacao {
  readonly ok: true;
  readonly id: number;
  readonly versao: number;
  readonly mensagem: string;
}

@Controller('farmacia/manipulacao')
export class ManipulacaoController {
  private readonly apoio: ApoioGravacao<GravadorManipulacao>;

  constructor(
    @Inject(PORTA_MANIPULACAO) private readonly porta: PortaManipulacao,
    @Inject(PORTA_SUPRIMENTOS) private readonly suprimentos: PortaSuprimentos,
    @Inject(PORTA_CIRURGIA) private readonly cirurgia: PortaCirurgia,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      {
        chave: CHAVE_LIBERACAO_MANIPULACAO,
        nome: 'a manipulação',
        operacoes: { 'suprimentos.registrarSaida': P.abrir },
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
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

  /** A sessão tem o vínculo ativo de farmacêutico (o CBO 2234), com o conselho (revisão do M46.4, D-CONFERE-FARM-464). */
  private async farmaceutico(s: SessaoCadastro): Promise<boolean> {
    const vs = await this.porta.vinculos(s.porta, s.login).catch(() => []);
    return vs.some((v) => v.ativo && categoriaDoCbo(v.cbo) === 'farmacia');
  }

  /** O relógio do banco (AAAA-MM-DDTHH:mm). */
  private async agora(s: SessaoCadastro): Promise<string> {
    const r = await this.cirurgia.relogio(s.porta);
    return `${r.hoje}T${r.hhmm.slice(0, 2)}:${r.hhmm.slice(2, 4)}`;
  }

  private async insumoNoLocal(
    s: SessaoCadastro,
    item: number,
    local: number,
    hoje: string,
  ): Promise<SaldoItem | null> {
    const r = await this.suprimentos.saldos(s.porta, {
      item,
      local,
      comSaldo: false,
      hoje,
      alertaDias: ALERTA_LOTE_DIAS,
    });
    return r.itens.find((x) => x.item === item && x.local === local) ?? null;
  }

  @Get()
  @Permissao(P.ler)
  @Auditar(E.manipulacaoLida.codigo)
  async painel(
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    hoje: string;
    de: string;
    ate: string;
    itens: ItemAManipular[];
    ordens: OrdemManipulacao[];
    capelas: CapelaManipulacao[];
    locais: { codigo: number; nome: string }[];
    centros: { codigo: number; nome: string }[];
    regraSobra: { versao: string; horasMaximas: number };
    cortada: boolean;
    gravacao: GravacaoAgenda;
  }> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'SGH_SUP_MANIPULACAO' };
    const hoje = (await this.suprimentos.relogio(s.porta)).hoje;
    const d = de && DATA.test(de) ? de : hoje;
    const a = ate && DATA.test(ate) ? ate : d;
    if (
      a < d ||
      (Date.parse(`${a}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86_400_000 > PERIODO_MAXIMO_DIAS
    )
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Período inválido',
        `Consulte no máximo ${PERIODO_MAXIMO_DIAS} dias, com o fim depois do início.`,
      );
    const [itens, ordens, capelas, locais, centros, g, farmaceutico] = await Promise.all([
      this.porta.itensAManipular(s.porta, menosDias(hoje, DIAS_FILA)),
      this.porta.ordens(s.porta, d, a),
      this.porta.capelas(s.porta),
      this.suprimentos.locais(s.porta),
      this.suprimentos.centrosCusto(s.porta),
      this.apoio.gravacao(s, { abrir: P.abrir, conferir: P.conferir }),
      this.farmaceutico(s),
    ]);
    const gravacao =
      g.operacoes['conferir']?.pode && !farmaceutico
        ? { ...g, operacoes: { ...g.operacoes, conferir: { pode: false, motivo: MOTIVO_SO_FARMACEUTICO } } }
        : g;
    return {
      hoje,
      de: d,
      ate: a,
      itens: itens.itens,
      ordens: ordens.itens,
      capelas,
      locais,
      centros: centros.filter((c) => !c.tecnico).map((c) => ({ codigo: c.codigo, nome: c.nome })),
      regraSobra: { ...REGRA_SOBRA_MANIPULACAO },
      cortada: itens.cortada || ordens.cortada,
      gravacao,
    };
  }

  @Get('insumos')
  @Permissao(P.ler)
  async insumos(
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: ItemBusca[] }> {
    const t = (termo ?? '').trim().slice(0, 60);
    if (t.length < 2) return { itens: [] };
    return { itens: await this.suprimentos.buscarItens(sessaoDe(req).porta, t) };
  }

  @Get('insumos/:item')
  @Permissao(P.ler)
  async insumo(
    @Param('item') item: string,
    @Query('local') local: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ saldo: SaldoItem | null }> {
    const s = sessaoDe(req);
    const l = Number(local);
    if (!Number.isInteger(l) || l < 1 || l > 99)
      throw new ErroProblema('entrada-invalida', 400, 'Local inválido', 'Escolha o local de estoque.');
    const hoje = (await this.suprimentos.relogio(s.porta)).hoje;
    return { saldo: await this.insumoNoLocal(s, idDaRota(item), l, hoje) };
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.abrir)
  @AuditadoNoHandler(
    'suprimentos.abrirOrdemManipulacao: SGH_SUP_MANIPULACAO com a SGH_TRILHA na mesma transação',
  )
  async abrir(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoManipulacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAbrirOrdemManipulacao, b);
    const chave = this.chave(s, e.chave);
    const agora = await this.agora(s);
    const [capelas, insumo] = await Promise.all([
      this.porta.capelas(s.porta),
      this.insumoNoLocal(s, e.insumo, e.local, agora.slice(0, 10)),
    ]);
    const capela = capelas.find((c) => c.id === e.capela) ?? null;
    if (insumo && e.quantidade > insumo.quantidade)
      throw recusaManipulacao(
        'acima-do-saldo',
        `O saldo do insumo no local é ${insumo.quantidade} ${insumo.unidade}.`,
        ['quantidade'],
      );
    const x = await this.apoio.sgh(
      s,
      E.manipulacaoAberta.codigo,
      P.abrir,
      (y: { id: number }) => ({
        tabela: 'SGH_SUP_MANIPULACAO',
        id: String(y.id),
        paciente: null,
        chave: `${e.itemPrescrito}`,
      }),
      async (g) => {
        const ja = await g.ordemPelaChave(chave);
        if (ja) {
          if (ja.itemPrescrito !== e.itemPrescrito)
            throw recusaManipulacao('chave-de-outra-ordem', 'A chave do pedido já foi usada em outra ordem.');
          return { id: ja.id, versao: ja.versao, repetida: true };
        }
        const av = await g.avaliacao(e.itemPrescrito);
        const r = conferirAberturaManipulacao({
          avaliacao: av ? { estado: av.estado, decisao: av.decisao } : null,
          ordemEmCurso: await g.ordemEmCurso(e.itemPrescrito),
          capela: capela ? { funcionando: capela.funcionando, grupos: capela.grupos.map((y) => y.id) } : null,
          grupo: e.grupo,
          insumoExiste: insumo !== null,
          loteNoLocal:
            insumo !== null &&
            (!insumo.rastreavel ||
              insumo.lotes.some((l) => l.lote === e.loteInsumo && l.validade === e.validadeInsumo)),
          quantidade: e.quantidade,
          validadeInsumo: e.validadeInsumo,
          validadeSobra: e.validadeSobra,
          agora,
        })[0];
        if (r) throw recusaManipulacao(r.codigo, r.mensagem, r.campos);
        return g.abrir({
          itemPrescrito: e.itemPrescrito,
          avaliacao: av!.id,
          reg: av!.reg,
          produto: av!.produto,
          capela: e.capela,
          grupo: e.grupo,
          insumo: e.insumo,
          local: e.local,
          loteInsumo: e.loteInsumo,
          validadeInsumo: e.validadeInsumo,
          quantidade: e.quantidade,
          dose: e.dose,
          validadeSobra: e.validadeSobra,
          em: agora,
          usuario: s.login,
          chave,
        });
      },
    );
    return {
      ok: true,
      id: x.id,
      versao: x.versao,
      mensagem: x.repetida
        ? 'Esta ordem já estava aberta.'
        : 'Ordem de manipulação aberta: falta a dupla conferência.',
    };
  }

  @Post(':id/conferencias')
  @HttpCode(201)
  @Permissao(P.conferir)
  @AuditadoNoHandler(
    'suprimentos.conferirManipulacao: SGH_SUP_MANIPULACAO com a SGH_TRILHA na mesma transação',
  )
  async conferir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoManipulacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaConferirManipulacao, b);
    this.chave(s, e.chave);
    if (e.ordem !== idDaRota(id))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inconsistente',
        'A ordem do corpo difere da rota.',
      );
    if (!(await this.farmaceutico(s)))
      throw new ErroProblema('sem-permissao', 403, 'Categoria profissional', MOTIVO_SO_FARMACEUTICO, {
        codigo: 'categoria-nao-autorizada',
      });
    const agora = await this.agora(s);
    const x = await this.apoio.sgh(
      s,
      E.manipulacaoConferida.codigo,
      P.conferir,
      { tabela: 'SGH_SUP_MANIPULACAO', id: String(e.ordem), paciente: null, chave: e.resultado },
      async (g) => {
        const o = await g.ordem(e.ordem);
        if (!o)
          throw new ErroProblema(
            'nao-encontrado',
            404,
            'Ordem não encontrada',
            'A ordem de manipulação não existe.',
          );
        // O reenvio da mesma conferência (a ordem já conferida por esta pessoa com o mesmo resultado) não grava de novo.
        if (
          o.versao === e.versaoVista + 1 &&
          o.conferidoPor === s.login &&
          o.situacao === situacaoDepoisDaConferencia(e.resultado)
        )
          return { versao: o.versao };
        if (o.versao !== e.versaoVista)
          throw recusaManipulacao(
            'manipulacao-mudou',
            'A ordem de manipulação mudou em outra tela: recarregue e confira.',
          );
        const r = conferirConferenciaManipulacao({
          situacao: o.situacao,
          preparadoPor: o.preparadoPor,
          conferente: s.login,
          resultado: e.resultado,
          observacao: e.observacao,
        })[0];
        if (r) throw recusaManipulacao(r.codigo, r.mensagem, r.campos);
        return g.conferir({
          ordem: e.ordem,
          versaoVista: e.versaoVista,
          situacao: situacaoDepoisDaConferencia(e.resultado),
          observacao: e.observacao,
          em: agora,
          usuario: s.login,
        });
      },
    );
    return {
      ok: true,
      id: e.ordem,
      versao: x.versao,
      mensagem:
        e.resultado === 'aprovada'
          ? 'Dupla conferência aprovada: o insumo pode ser baixado.'
          : 'Ordem reprovada na conferência.',
    };
  }

  @Post(':id/baixa')
  @HttpCode(201)
  @Permissao(P.abrir)
  @AuditadoNoHandler(
    'suprimentos.registrarSaida (baixa do insumo): pelo executor, com a ordem na mesma transação',
  )
  async baixar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaBaixarManipulacao, b);
    this.chave(s, e.chave);
    if (e.ordem !== idDaRota(id))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Pedido inconsistente',
        'A ordem do corpo difere da rota.',
      );
    const [o, centros, hoje] = await Promise.all([
      this.porta.ordem(s.porta, e.ordem),
      this.suprimentos.centrosCusto(s.porta),
      this.suprimentos.relogio(s.porta).then((r) => r.hoje),
    ]);
    if (!o)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Ordem não encontrada',
        'A ordem de manipulação não existe.',
      );
    const centro = centros.find((c) => c.codigo === e.centroCusto && !c.tecnico);
    if (!centro)
      throw recusaManipulacao('centro-custo-invalido', 'Escolha o centro de custo da unidade do paciente.', [
        'centroCusto',
      ]);
    const r = conferirBaixaManipulacao({
      situacao: o.situacao,
      insumo: o.insumo,
      quantidade: o.quantidade,
      itemSaida: o.insumo,
      quantidadeSaida: o.quantidade,
    })[0];
    if (r) throw recusaManipulacao(r.codigo, r.mensagem, r.campos);
    const insumo = await this.insumoNoLocal(s, o.insumo, o.local, hoje);
    return this.apoio.executar(
      s,
      'suprimentos.registrarSaida',
      {
        destino: 1,
        origem: 'E',
        local: o.local,
        centroCusto: centro.codigo,
        localConsumo: centro.localConsumo,
        atendimento: o.atendimento,
        itens: [
          {
            item: o.insumo,
            quantidade: o.quantidade,
            lotes: insumo?.rastreavel
              ? [{ lote: o.loteInsumo, validade: o.validadeInsumo, quantidade: o.quantidade }]
              : [],
          },
        ],
        manipulacao: { ordem: o.id, versaoVista: e.versaoVista },
      },
      'Insumo baixado do estoque e ligado à ordem de manipulação.',
      { idempotencyKey: e.chave },
    );
  }
}
