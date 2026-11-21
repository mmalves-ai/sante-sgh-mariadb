// Consignados (M46, etapa 4; ficha, seções 4, 5, 7 e 8; regras 10 e 13):
//   GET  /api/suprimentos/consignados?fornecedor=           o saldo por fornecedor e item (com as parcelas), os consumos em
//                                                           sala do consignado (a repor e a faturar), os movimentos e o
//                                                           indicador do consumo sem faturamento
//   GET  /api/suprimentos/consignados/fornecedores?termo=   os fornecedores (código e nome) para a busca da tela
//   GET  /api/suprimentos/consignados/itens?termo=          os itens do cadastro do estoque para a busca da tela
//   POST /api/suprimentos/consignados/remessas              suprimentos.registrarRemessaConsignado
//   POST /api/suprimentos/consignados/reposicoes            suprimentos.reporConsignado (reposição, faturamento pela nota
//                                                           da entrada do estoque ou devolução ao fornecedor)
// Tudo só do novo (SGH_), com a SGH_TRILHA na mesma transação; o controle de consignados do estoque não é ligado (a
// saída acima do saldo é a regra do gatilho da saída, D-CONSIG-463). Nasce desligado (chave `suprimentos.consignado`).
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Query, Req } from '@nestjs/common';
import {
  type ConsumoConsignado,
  DIAS_ALERTA_CONSIGNADO,
  esquemaRegistrarRemessaConsignado,
  esquemaReporConsignado,
  EVENTOS_AUDITAVEIS,
  type GravacaoAgenda,
  type IndicadorConsignado,
  type ItemBusca,
  type MovimentoConsignado,
  type NotaEntradaConsignado,
  PERMISSOES_CONSIGNADO_CODIGOS as P,
  type SaldoConsignado,
} from '@sgh/contratos';
import {
  avisoReferenciaConsignado,
  conferirRemessaConsignado,
  conferirReposicaoConsignado,
  indicadorConsignado,
  qtd3,
} from '@sgh/dominio-suprimentos';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { type GravadorConsignado, PORTA_CONSIGNADO, type PortaConsignado } from './consignado-porta.js';
import { PORTA_SUPRIMENTOS, type PortaSuprimentos } from './porta.js';

const E = EVENTOS_AUDITAVEIS;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
export const CHAVE_LIBERACAO_CONSIGNADO = 'suprimentos.consignado';
/** Os movimentos que a tela mostra (os mais novos). */
const MOVIMENTOS_NA_TELA = 200;

export interface ResultadoConsignado {
  readonly ok: true;
  readonly grupo: number;
  readonly movimentos: readonly number[];
  readonly repetido: boolean;
  readonly mensagem: string;
  readonly aviso: string | null;
}

function recusaConsignado(codigo: string, mensagem: string, campos?: readonly string[]): ErroProblema {
  return new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });
}

@Controller('suprimentos/consignados')
export class ConsignadoController {
  private readonly apoio: ApoioGravacao<GravadorConsignado>;

  constructor(
    @Inject(PORTA_CONSIGNADO) private readonly porta: PortaConsignado,
    @Inject(PORTA_SUPRIMENTOS) private readonly suprimentos: PortaSuprimentos,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_LIBERACAO_CONSIGNADO, nome: 'o controle de consignados', operacoes: {} },
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

  private async hoje(s: SessaoCadastro): Promise<string> {
    return (await this.suprimentos.relogio(s.porta)).hoje;
  }

  @Get()
  @Permissao(P.ler)
  async painel(
    @Query('fornecedor') fornecedor: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    hoje: string;
    saldos: SaldoConsignado[];
    consumos: ConsumoConsignado[];
    movimentos: MovimentoConsignado[];
    indicador: IndicadorConsignado;
    semFornecedor: number;
    cortada: boolean;
    gravacao: GravacaoAgenda;
  }> {
    const s = sessaoDe(req);
    const f = Number(fornecedor);
    const filtro = Number.isInteger(f) && f > 0 ? f : null;
    const [hoje, movs, cons, agregado, cadastro, gravacao] = await Promise.all([
      this.hoje(s),
      this.porta.movimentos(s.porta, filtro),
      this.porta.consumos(s.porta, filtro),
      this.porta.saldos(s.porta, filtro),
      this.porta.saldoCadastro(s.porta),
      this.apoio.gravacao(s, { registrar: P.registrar }),
    ]);
    // O saldo somado no banco (revisão do M46.4): as listas abaixo têm teto, o saldo não depende delas.
    const base = agregado.itens;
    // O saldo do cadastro de estoque (só consulta) entra na linha do mesmo fornecedor e item, e sozinho quando não há
    // movimento no novo.
    const linhas = [...base];
    for (const x of cadastro)
      if (
        (filtro === null || x.fornecedor === filtro) &&
        !linhas.some((y) => y.fornecedor === x.fornecedor && y.item === x.item)
      )
        linhas.push({
          fornecedor: x.fornecedor,
          item: x.item,
          remessas: 0,
          reposicoes: 0,
          consumidos: 0,
          devolvidos: 0,
          aRepor: 0,
          aFaturar: 0,
          saldo: 0,
        });
    const nomes = await this.porta.nomes(
      s.porta,
      linhas.map((x) => x.fornecedor),
      linhas.map((x) => x.item),
    );
    const saldos = linhas.map((x) => ({
      ...x,
      fornecedorNome: nomes.fornecedores.get(x.fornecedor) ?? null,
      itemNome: nomes.itens.get(x.item) ?? null,
      saldoCadastro:
        cadastro.find((y) => y.fornecedor === x.fornecedor && y.item === x.item)?.quantidade ?? null,
    }));
    return {
      hoje,
      saldos,
      consumos: cons.itens.filter((c) => c.fornecedor !== null),
      movimentos: movs.itens.slice(0, MOVIMENTOS_NA_TELA),
      indicador: indicadorConsignado(
        cons.itens.filter((c) => c.fornecedor !== null),
        hoje,
        DIAS_ALERTA_CONSIGNADO,
      ),
      semFornecedor: cons.itens.filter((c) => c.fornecedor === null).length,
      cortada: agregado.cortada || movs.cortada || cons.cortada || movs.itens.length > MOVIMENTOS_NA_TELA,
      gravacao,
    };
  }

  @Get('fornecedores')
  @Permissao(P.ler)
  async fornecedores(
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: { codigo: number; nome: string }[]; cortada: boolean }> {
    const r = await this.suprimentos.fornecedores(sessaoDe(req).porta, (termo ?? '').slice(0, 60));
    return { itens: r.itens.map((f) => ({ codigo: f.codigo, nome: f.nome })), cortada: r.cortada };
  }

  /** As notas da entrada do estoque do fornecedor com o item: a escolha da nota no faturamento (revisão do M46.4). */
  @Get('notas')
  @Permissao(P.ler)
  async notas(
    @Query('fornecedor') fornecedor: string | undefined,
    @Query('item') item: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: NotaEntradaConsignado[] }> {
    const f = Number(fornecedor);
    const i = Number(item);
    if (!Number.isSafeInteger(f) || f <= 0 || !Number.isSafeInteger(i) || i <= 0)
      throw new ErroProblema('entrada-invalida', 400, 'Pedido incompleto', 'Informe o fornecedor e o item.');
    return { itens: await this.porta.notasEntrada(sessaoDe(req).porta, f, i) };
  }

  @Get('itens')
  @Permissao(P.ler)
  async itens(
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: ItemBusca[] }> {
    const t = (termo ?? '').trim().slice(0, 60);
    if (t.length < 2) return { itens: [] };
    return { itens: await this.porta.buscarItens(sessaoDe(req).porta, t) };
  }

  @Post('remessas')
  @HttpCode(201)
  @Permissao(P.registrar)
  @AuditadoNoHandler(
    'suprimentos.registrarRemessaConsignado: remessa_consignada com a trilha na mesma transação',
  )
  async remessa(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoConsignado> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarRemessaConsignado, b);
    const chave = this.chave(s, e.chave);
    const [hoje, classe, consig, existe] = await Promise.all([
      this.hoje(s),
      this.porta.classeDoItem(s.porta, e.item),
      this.porta.referenciaConsignada(s.porta, e.item),
      this.porta.fornecedorExiste(s.porta, e.fornecedor),
    ]);
    const r = conferirRemessaConsignado({
      classeItem: classe,
      referenciaConsignada: consig,
      fornecedorExiste: existe,
      quantidade: e.quantidade,
      lote: e.lote,
      serie: e.serie,
      validade: e.validade,
      emissao: e.nfEmissao,
      hoje,
    })[0];
    if (r) throw recusaConsignado(r.codigo, r.mensagem, r.campos);
    const x = await this.apoio.sgh(
      s,
      E.consignadoRemessa.codigo,
      P.registrar,
      (y: { grupo: number }) => ({
        tabela: 'remessa_consignada',
        id: String(y.grupo),
        paciente: null,
        chave: `${e.fornecedor}:${e.item}`,
      }),
      (g) =>
        g.gravar({
          fornecedor: e.fornecedor,
          item: e.item,
          usuario: s.login,
          chave,
          pedido: e,
          linhas: [
            {
              tipo: 'remessa',
              quantidade: e.quantidade,
              consumo: null,
              nfNumero: e.nfNumero,
              nfSerie: e.nfSerie,
              nfEmissao: e.nfEmissao,
              nfEntrada: null,
              lote: e.lote,
              serie: e.serie,
              validade: e.validade,
              motivo: null,
            },
          ],
        }),
    );
    return {
      ok: true,
      ...x,
      mensagem: x.repetido ? 'Esta remessa já estava registrada.' : 'Remessa em consignação registrada.',
      aviso: avisoReferenciaConsignado(consig),
    };
  }

  @Post('reposicoes')
  @HttpCode(201)
  @Permissao(P.registrar)
  @AuditadoNoHandler('suprimentos.reporConsignado: reposicao_consignada com a trilha na mesma transação')
  async repor(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoConsignado> {
    const s = sessaoDe(req);
    const e = corpo(esquemaReporConsignado, b);
    const chave = this.chave(s, e.chave);
    const nf =
      e.tipo === 'faturamento' && e.nfEntrada
        ? await this.porta.notaEntrada(s.porta, e.nfEntrada, e.item)
        : null;
    const evento =
      e.tipo === 'reposicao'
        ? E.consignadoReposicao.codigo
        : e.tipo === 'faturamento'
          ? E.consignadoFaturamento.codigo
          : E.consignadoDevolucao.codigo;
    const x = await this.apoio.sgh(
      s,
      evento,
      P.registrar,
      (y: { grupo: number }) => ({
        tabela: 'reposicao_consignada',
        id: String(y.grupo),
        paciente: null,
        chave: `${e.fornecedor}:${e.item}:${e.tipo}`,
      }),
      async (g) => {
        // O reenvio relê o grupo gravado sem conferir de novo (os consumos já estão ligados a ele).
        const ja = await g.movimentosPelaChave(chave, e);
        if (ja && ja.length)
          return g.gravar({
            fornecedor: e.fornecedor,
            item: e.item,
            usuario: s.login,
            chave,
            pedido: e,
            linhas: [],
          });
        // Relidos e travados na transação: os consumos pedidos e, na devolução, o saldo do par (a linha-guarda travada
        // antes da soma; a devolução simultânea do mesmo par espera e recusa).
        const consumos = e.consumos.length ? await g.consumos(e.consumos) : [];
        const saldo = e.tipo === 'devolucao' ? await g.saldoTravado(e.fornecedor, e.item, s.login) : 0;
        const r = conferirReposicaoConsignado({
          tipo: e.tipo,
          fornecedor: e.fornecedor,
          item: e.item,
          consumos: e.consumos.map((id) => {
            const c = consumos.find((y) => y.consumo === id);
            return c
              ? {
                  consumo: c.consumo,
                  fornecedor: c.fornecedor,
                  item: c.item,
                  quantidade: c.quantidade,
                  reposto: c.reposicao !== null,
                  faturado: c.faturamento !== null,
                }
              : null;
          }),
          quantidade: e.quantidade,
          saldo,
          nf,
          motivo: e.motivo,
        })[0];
        if (r) throw recusaConsignado(r.codigo, r.mensagem, r.campos);
        const comum = {
          nfNumero: e.tipo === 'reposicao' ? e.nfNumero : null,
          nfSerie: e.tipo === 'reposicao' ? e.nfSerie : null,
          nfEmissao: e.tipo === 'reposicao' ? e.nfEmissao : null,
          nfEntrada: e.tipo === 'faturamento' ? e.nfEntrada : null,
          lote: e.lote,
          serie: e.serie,
          validade: null,
          motivo: e.motivo,
        };
        const linhas =
          e.tipo === 'devolucao'
            ? [{ ...comum, tipo: 'devolucao' as const, quantidade: qtd3(e.quantidade ?? 0), consumo: null }]
            : consumos
                .slice()
                .sort((a, z) => a.consumo - z.consumo)
                .map((c) => ({ ...comum, tipo: e.tipo, quantidade: c.quantidade, consumo: c.consumo }));
        return g.gravar({
          fornecedor: e.fornecedor,
          item: e.item,
          usuario: s.login,
          chave,
          pedido: e,
          linhas,
        });
      },
    );
    const msg =
      e.tipo === 'reposicao'
        ? 'Reposição do fornecedor registrada.'
        : e.tipo === 'faturamento'
          ? 'Faturamento ligado à nota fiscal da entrada.'
          : 'Devolução ao fornecedor registrada.';
    return {
      ok: true,
      ...x,
      mensagem: x.repetido ? 'Este movimento já estava registrado.' : msg,
      aviso: null,
    };
  }
}
