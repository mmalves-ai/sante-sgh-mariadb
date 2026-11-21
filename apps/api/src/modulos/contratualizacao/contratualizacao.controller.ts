// Contratualização SUS (M55, fatia F5; ficha, seções 4, 7 e 8; regra 11; manual m25 "Contratualização SUS"):
//   GET  /api/faturamento/sus/contratualizacao                  os contratos com o gestor, os 11 domínios (rótulos do
//                                                                produto), as faixas de cumprimento, a fonte da produção,
//                                                                a competência atual e o estado da gravação
//   GET  /api/faturamento/sus/contratualizacao/contratos/:id     o contrato, as metas, as apurações e os requisitos da
//                                                                regra 11 (contrato vigente, CNES, habilitação)
//   POST .../contratos, PUT .../contratos/:id                   faturamento.gravarContratoSus (inclusão; alteração pela
//                                                                versão vista)
//   POST .../contratos/:id/encerramento                         faturamento.encerrarContratoSus (com o motivo)
//   POST .../contratos/:id/metas, PUT .../metas/:id             faturamento.gravarMetaSus
//   POST .../metas/:id/apuracoes                                faturamento.registrarApuracaoSus (o fechamento do
//                                                                período; a correção pela versão vista)
//   GET  .../contratos/:id/painel?competencia=AAAAMM            produção × meta do período de cada meta, com as parcelas,
//                                                                e o repasse estimado do mês
//   GET  .../sigtap?termo=                                       a busca do código SIGTAP da meta
// Tudo no banco do cliente (contrato_gestor_sus, meta_contratual_sus, afericao_meta_sus), com a trilha na mesma
// transação. Nasce desligado (chave `contratualizacao`, POL-3).
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  AFERICOES_SUS,
  type ApuracaoSus,
  CHAVE_LIBERACAO_CONTRATUALIZACAO,
  COMPLEXIDADES_SUS,
  COMPETENCIAS_MAXIMAS_PAINEL,
  type ContratoSus,
  ESCORES_SUS,
  ESFERAS_CONTRATO_SUS,
  esquemaApuracaoSus,
  esquemaBuscaSigtapMeta,
  esquemaContratoSus,
  esquemaEncerrarContratoSus,
  esquemaFiltroPainelSus,
  esquemaMetaSus,
  EVENTOS_AUDITAVEIS,
  type FaixaCumprimentoSus,
  FAIXAS_CUMPRIMENTO_SUS_PADRAO,
  type FonteProducaoSus,
  FORMATOS_INDICADOR_SUS,
  type GravacaoAgenda,
  MENSAGENS_CONTRATUALIZACAO,
  type MetaSus,
  type PainelContratualizacaoSus,
  PERIODICIDADES_META_SUS,
  PERMISSOES_CONTRATUALIZACAO_CODIGOS as P,
  type ProducaoSigtapSus,
  REDES_ASSISTENCIA_SUS,
  TIPOS_INDICADOR_SUS,
  TIPOS_ORCAMENTO_SUS,
} from '@sgh/contratos';
import {
  conferirApuracaoSus,
  conferirContratoSus,
  conferirContratoSusAtivo,
  conferirMetaSus,
  cumprimentoPct,
  faixaDoCumprimento,
  fonteDaProducaoSus,
  lerFaixasCumprimento,
  metaDoPeriodo,
  metaValeNaCompetencia,
  periodoDaMeta,
  type RecusaContratualizacao,
  realizadoQuantitativo,
  repasseEstimadoSus,
  resultadoMetaSus,
  somarMeses,
} from '@sgh/dominio-faturamento';
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
import {
  type DominiosContratualizacao,
  type GravadorContratualizacao,
  type ListaDominioContratualizacao,
  PORTA_CONTRATUALIZACAO,
  type PortaContratualizacao,
} from './porta.js';

const E = EVENTOS_AUDITAVEIS;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
/** As chaves do faturamento SUS (M51): qualquer uma ligada faz do faturamento SUS a fonte da produção (regra 11). */
export const CHAVES_FATURAMENTO_SUS = [
  'faturamento.susBpa',
  'faturamento.susApac',
  'faturamento.susAih',
] as const;

function recusaContratualizacao(
  r: Pick<RecusaContratualizacao, 'codigo' | 'mensagem' | 'campos'>,
): ErroProblema {
  return new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', r.mensagem, {
    codigo: r.codigo,
    ...(r.campos ? { campos: [...r.campos] } : {}),
  });
}
const recusar = (codigo: keyof typeof MENSAGENS_CONTRATUALIZACAO & RecusaContratualizacao['codigo']) =>
  recusaContratualizacao({ codigo, mensagem: MENSAGENS_CONTRATUALIZACAO[codigo] });
const naoEncontrado = (titulo: string, codigo: 'contrato-inexistente' | 'meta-inexistente') =>
  new ErroProblema('nao-encontrado', 404, titulo, MENSAGENS_CONTRATUALIZACAO[codigo]);

/** Os domínios com o rótulo do produto (o código é o da tela; o nome gravado só onde não há rótulo). */
export interface ItemDominioSus {
  readonly codigo: number;
  readonly rotulo: string;
  readonly sigla: string | null;
}
const VOCABULARIO: Readonly<
  Partial<Record<ListaDominioContratualizacao, readonly { readonly codigo: number; readonly rotulo: string }[]>>
> = {
  periodicidade: PERIODICIDADES_META_SUS,
  tipo_indicador: TIPOS_INDICADOR_SUS,
  complexidade: COMPLEXIDADES_SUS,
  tipo_item_indicador: FORMATOS_INDICADOR_SUS,
  rede_assistencial: REDES_ASSISTENCIA_SUS,
  escore: ESCORES_SUS,
  tipo_afericao: AFERICOES_SUS,
  esfera: ESFERAS_CONTRATO_SUS,
  componente_orcamento: TIPOS_ORCAMENTO_SUS,
};
/**
 * A chave de cada lista na resposta, como a tela e o contrato a leem hoje (pedido de renomear no contrato e na tela,
 * docs/obra/fatias/f22/saida/02-03.json): só a tradução da resposta, nunca nome de tabela do banco.
 */
export const CHAVE_RESPOSTA_DOMINIO: Readonly<Record<ListaDominioContratualizacao, string>> = {
  periodicidade: 'CMPERIODO',
  tipo_indicador: 'CMTPINDICADOR',
  complexidade: 'CMTIPOCOMPLEXIDADESP',
  tipo_item_indicador: 'CMTPITEMINDIC',
  rede_assistencial: 'CMREDEASSIST',
  escore: 'CMESCORE',
  tipo_afericao: 'CMTPAFERICAO',
  esfera: 'CMTPCONTRATO',
  tipo_dado: 'CMTPDADOS',
  componente_orcamento: 'CMTPORCAMENTO',
  incentivo: 'CMINCENTIVO',
};

export function dominiosComRotulo(d: DominiosContratualizacao): Record<string, ItemDominioSus[]> {
  return Object.fromEntries(
    (Object.entries(d) as [ListaDominioContratualizacao, DominiosContratualizacao[ListaDominioContratualizacao]][]).map(
      ([lista, itens]) => [
        CHAVE_RESPOSTA_DOMINIO[lista] ?? lista,
        itens.map((x) => ({
          codigo: x.codigo,
          rotulo: VOCABULARIO[lista]?.find((y) => y.codigo === x.codigo)?.rotulo ?? x.nome,
          sigla: x.sigla,
        })),
      ],
    ),
  );
}

export interface ResultadoContratualizacao {
  readonly ok: true;
  readonly id: number;
  readonly versao: number;
  readonly repetida: boolean;
  readonly mensagem: string;
}

export interface ParametrosContratualizacao {
  readonly faixas: readonly FaixaCumprimentoSus[];
  readonly faixasValidas: boolean;
  readonly cnes: string | null;
  readonly conveniosSus: readonly number[];
}

@Controller('faturamento/sus/contratualizacao')
export class ContratualizacaoController {
  private readonly apoio: ApoioGravacao<GravadorContratualizacao>;
  private readonly apoiosFaturamentoSus: readonly ApoioGravacao<GravadorContratualizacao>[];

  constructor(
    @Inject(PORTA_CONTRATUALIZACAO) private readonly porta: PortaContratualizacao,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_LIBERACAO_CONTRATUALIZACAO, nome: 'a contratualização SUS', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.apoiosFaturamentoSus = CHAVES_FATURAMENTO_SUS.map(
      (chave) =>
        new ApoioGravacao(
          { chave, nome: 'o faturamento SUS', operacoes: {} },
          porta,
          trilha,
          configuracao,
          cache,
        ),
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

  private async parametros(s: SessaoCadastro): Promise<ParametrosContratualizacao> {
    const r = await this.apoio.resolvedorParametros(s);
    const texto = (chave: string) => {
      const v = r(chave);
      return typeof v === 'string' ? v.trim() : '';
    };
    const lidas = lerFaixasCumprimento(
      texto('contratualizacao.faixasCumprimento') || FAIXAS_CUMPRIMENTO_SUS_PADRAO,
    );
    const cnes = texto('faturamento.sus.cnes');
    const conveniosSus = (texto('faturamento.sus.conveniosSus') || '1')
      .split(',')
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isInteger(x) && x > 0);
    return {
      faixas: lidas ?? lerFaixasCumprimento(FAIXAS_CUMPRIMENTO_SUS_PADRAO) ?? [],
      faixasValidas: lidas !== null,
      cnes: /^\d{7}$/.test(cnes) ? cnes : null,
      conveniosSus,
    };
  }

  private async fonte(s: SessaoCadastro): Promise<FonteProducaoSus> {
    const l = await Promise.all(this.apoiosFaturamentoSus.map((a) => a.liberacao(s)));
    return fonteDaProducaoSus(l.some((x) => x.ligada));
  }

  /** A produção das competências (a do faturamento SUS de uma vez; a das contas SUS uma competência por vez). */
  private async producao(
    s: SessaoCadastro,
    fonte: FonteProducaoSus,
    competencias: readonly string[],
    atual: string,
    convenios: readonly number[],
  ): Promise<ProducaoSigtapSus[]> {
    const ate = competencias.filter((c) => c <= atual).sort();
    if (ate.length === 0) return [];
    if (fonte === 'faturamento-sus')
      return this.porta.producaoFaturamentoSus(s.porta, ate[0] as string, ate.at(-1) as string);
    const out: ProducaoSigtapSus[] = [];
    for (const c of ate) out.push(...(await this.porta.producaoContasSus(s.porta, c, convenios)));
    return out;
  }

  private exigirFaixas(p: ParametrosContratualizacao): void {
    if (!p.faixasValidas) throw recusar('faixas-invalidas');
  }

  @Get()
  @Permissao(P.ler)
  @Auditar(E.contratualizacaoLida.codigo)
  async painel(@Req() req: RequisicaoAutorizada): Promise<{
    hoje: string;
    competencia: string;
    contratos: ContratoSus[];
    cortada: boolean;
    dominios: Record<string, ItemDominioSus[]>;
    parametros: ParametrosContratualizacao;
    fonte: FonteProducaoSus;
    gravacao: GravacaoAgenda;
  }> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'contrato_gestor_sus' };
    const [relogio, contratos, dominios, parametros, fonte, gravacao] = await Promise.all([
      this.porta.relogio(s.porta),
      this.porta.contratos(s.porta),
      this.porta.dominios(s.porta),
      this.parametros(s),
      this.fonte(s),
      this.apoio.gravacao(s, { editar: P.editar }),
    ]);
    return {
      ...relogio,
      contratos: contratos.itens,
      cortada: contratos.cortada,
      dominios: dominiosComRotulo(dominios),
      parametros,
      fonte,
      gravacao,
    };
  }

  @Get('contratos/:id')
  @Permissao(P.ler)
  @Auditar(E.contratualizacaoLida.codigo)
  async contrato(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    contrato: ContratoSus;
    metas: MetaSus[];
    apuracoes: ApuracaoSus[];
    requisitos: RecusaContratualizacao[];
  }> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'contrato_gestor_sus', idAlvo: id };
    const c = await this.porta.contrato(s.porta, idDaRota(id));
    if (!c) throw naoEncontrado('Contrato não encontrado', 'contrato-inexistente');
    const [metas, relogio, parametros] = await Promise.all([
      this.porta.metas(s.porta, c.id),
      this.porta.relogio(s.porta),
      this.parametros(s),
    ]);
    const apuracoes = await this.porta.apuracoes(
      s.porta,
      metas.map((m) => m.id),
    );
    return {
      contrato: c,
      metas,
      apuracoes,
      requisitos: conferirContratoSusAtivo(c, relogio.hoje, parametros.cnes),
    };
  }

  @Post('contratos')
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler('faturamento.gravarContratoSus: contrato_gestor_sus com a trilha na mesma transação')
  async criarContrato(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoContratualizacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaContratoSus, b);
    const chave = this.chave(s, e.chave);
    if (e.versaoVista !== null) throw recusar('versao-desatualizada');
    const x = await this.apoio.sgh(
      s,
      E.contratoSusGravado.codigo,
      P.editar,
      (y: { id: number }) => ({
        tabela: 'contrato_gestor_sus',
        id: String(y.id),
        paciente: null,
        chave: e.numero,
      }),
      async (g) => {
        const ja = await g.contratoPelaChave(chave);
        if (ja) {
          if (ja.numero !== e.numero) throw recusar('chave-de-outro-registro');
          return { id: ja.id, versao: ja.versao, repetida: true };
        }
        const r = conferirContratoSus(e, { numeroDuplicado: await g.numeroEmUso(e.numero, null) })[0];
        if (r) throw recusaContratualizacao(r);
        const y = await g.incluirContrato({ entrada: e, usuario: s.login, chave });
        return { ...y, repetida: false };
      },
    );
    return {
      ok: true,
      ...x,
      mensagem: x.repetida ? 'Este contrato já estava cadastrado.' : 'Contrato SUS cadastrado.',
    };
  }

  @Put('contratos/:id')
  @Permissao(P.editar)
  @AuditadoNoHandler(
    'faturamento.gravarContratoSus: contrato_gestor_sus pela versão vista com a trilha na mesma transação',
  )
  async alterarContrato(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoContratualizacao> {
    const s = sessaoDe(req);
    const idContrato = idDaRota(id);
    const e = corpo(esquemaContratoSus, b);
    this.chave(s, e.chave);
    if (e.versaoVista === null) throw recusar('versao-desatualizada');
    const versaoVista = e.versaoVista;
    const x = await this.apoio.sgh(
      s,
      E.contratoSusGravado.codigo,
      P.editar,
      { tabela: 'contrato_gestor_sus', id: String(idContrato), paciente: null, chave: e.numero },
      async (g) => {
        const atual = await g.contrato(idContrato);
        if (!atual) throw naoEncontrado('Contrato não encontrado', 'contrato-inexistente');
        if (atual.situacao === 'encerrado') throw recusar('contrato-encerrado');
        if (atual.versao !== versaoVista) throw recusar('versao-desatualizada');
        const r = conferirContratoSus(e, { numeroDuplicado: await g.numeroEmUso(e.numero, idContrato) })[0];
        if (r) throw recusaContratualizacao(r);
        const ini = `${e.inicio.slice(0, 4)}${e.inicio.slice(5, 7)}`;
        const fim = `${e.fim.slice(0, 4)}${e.fim.slice(5, 7)}`;
        const fora = (await g.metas(idContrato)).some(
          (m) => m.ativa && (m.inicio < ini || m.inicio > fim || (m.fim !== null && m.fim > fim)),
        );
        if (fora) throw recusar('meta-fora-da-vigencia');
        return g.alterarContrato({ entrada: e, usuario: s.login, id: idContrato, versaoVista });
      },
    );
    return { ok: true, ...x, repetida: false, mensagem: 'Contrato SUS alterado.' };
  }

  @Post('contratos/:id/encerramento')
  @Permissao(P.editar)
  @AuditadoNoHandler(
    'faturamento.encerrarContratoSus: contrato_gestor_sus pela versão vista com a trilha na mesma transação',
  )
  async encerrarContrato(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoContratualizacao> {
    const s = sessaoDe(req);
    const idContrato = idDaRota(id);
    const e = corpo(esquemaEncerrarContratoSus, b);
    const x = await this.apoio.sgh(
      s,
      E.contratoSusGravado.codigo,
      P.editar,
      { tabela: 'contrato_gestor_sus', id: String(idContrato), paciente: null, chave: 'encerramento' },
      async (g) => {
        const atual = await g.contrato(idContrato);
        if (!atual) throw naoEncontrado('Contrato não encontrado', 'contrato-inexistente');
        if (atual.situacao === 'encerrado') throw recusar('contrato-encerrado');
        if (atual.versao !== e.versaoVista) throw recusar('versao-desatualizada');
        return g.encerrarContrato({
          id: idContrato,
          versaoVista: e.versaoVista,
          motivo: e.motivo,
          usuario: s.login,
        });
      },
    );
    return { ok: true, ...x, repetida: false, mensagem: 'Contrato SUS encerrado.' };
  }

  @Post('contratos/:id/metas')
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler('faturamento.gravarMetaSus: meta_contratual_sus com a trilha na mesma transação')
  async criarMeta(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoContratualizacao> {
    const s = sessaoDe(req);
    const idContrato = idDaRota(id);
    const e = corpo(esquemaMetaSus, b);
    const chave = this.chave(s, e.chave);
    if (e.versaoVista !== null) throw recusar('versao-desatualizada');
    const sigtapExiste =
      e.tipo === 'quantitativa' && e.codigoSigtap
        ? await this.porta.sigtapExiste(s.porta, e.codigoSigtap)
        : false;
    const x = await this.apoio.sgh(
      s,
      E.metaSusGravada.codigo,
      P.editar,
      (y: { id: number }) => ({ tabela: 'meta_contratual_sus', id: String(y.id), paciente: null, chave: e.tipo }),
      async (g) => {
        const ja = await g.metaPelaChave(chave);
        if (ja) {
          if (ja.contrato !== idContrato || ja.tipo !== e.tipo) throw recusar('chave-de-outro-registro');
          return { id: ja.id, versao: ja.versao, repetida: true };
        }
        const c = await g.contrato(idContrato);
        if (!c) throw naoEncontrado('Contrato não encontrado', 'contrato-inexistente');
        const r = conferirMetaSus(e, c, { sigtapExiste })[0];
        if (r) throw recusaContratualizacao(r);
        const y = await g.incluirMeta({ entrada: e, usuario: s.login, contrato: idContrato, chave });
        return { ...y, repetida: false };
      },
    );
    return { ok: true, ...x, mensagem: x.repetida ? 'Esta meta já estava cadastrada.' : 'Meta cadastrada.' };
  }

  @Put('metas/:id')
  @Permissao(P.editar)
  @AuditadoNoHandler(
    'faturamento.gravarMetaSus: meta_contratual_sus pela versão vista com a trilha na mesma transação',
  )
  async alterarMeta(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoContratualizacao> {
    const s = sessaoDe(req);
    const idMeta = idDaRota(id);
    const e = corpo(esquemaMetaSus, b);
    this.chave(s, e.chave);
    if (e.versaoVista === null) throw recusar('versao-desatualizada');
    const versaoVista = e.versaoVista;
    const sigtapExiste =
      e.tipo === 'quantitativa' && e.codigoSigtap
        ? await this.porta.sigtapExiste(s.porta, e.codigoSigtap)
        : false;
    const x = await this.apoio.sgh(
      s,
      E.metaSusGravada.codigo,
      P.editar,
      { tabela: 'meta_contratual_sus', id: String(idMeta), paciente: null, chave: e.tipo },
      async (g) => {
        const atual = await g.meta(idMeta);
        if (!atual) throw naoEncontrado('Meta não encontrada', 'meta-inexistente');
        if (atual.versao !== versaoVista) throw recusar('versao-desatualizada');
        if (atual.tipo !== e.tipo)
          throw recusaContratualizacao({
            codigo: 'campos-de-outro-tipo',
            mensagem: MENSAGENS_CONTRATUALIZACAO['campos-de-outro-tipo'],
            campos: ['tipo'],
          });
        const c = await g.contrato(atual.contrato);
        if (!c) throw naoEncontrado('Contrato não encontrado', 'contrato-inexistente');
        const r = conferirMetaSus(e, c, { sigtapExiste })[0];
        if (r) throw recusaContratualizacao(r);
        return g.alterarMeta({ entrada: e, usuario: s.login, id: idMeta, versaoVista });
      },
    );
    return { ok: true, ...x, repetida: false, mensagem: 'Meta alterada.' };
  }

  @Post('metas/:id/apuracoes')
  @HttpCode(201)
  @Permissao(P.editar)
  @AuditadoNoHandler(
    'faturamento.registrarApuracaoSus: afericao_meta_sus com a trilha na mesma transação',
  )
  async apurar(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoContratualizacao & { apuracao: Omit<ApuracaoSus, 'id' | 'por' | 'em' | 'versao'> }> {
    const s = sessaoDe(req);
    const idMeta = idDaRota(id);
    const e = corpo(esquemaApuracaoSus, b);
    const chave = this.chave(s, e.chave);
    const vista = await this.porta.meta(s.porta, idMeta);
    if (!vista) throw naoEncontrado('Meta não encontrada', 'meta-inexistente');
    const [parametros, fonte, relogio] = await Promise.all([
      this.parametros(s),
      this.fonte(s),
      this.porta.relogio(s.porta),
    ]);
    this.exigirFaixas(parametros);
    const periodo = periodoDaMeta(vista, e.competencia);
    const producao =
      vista.tipo === 'quantitativa'
        ? await this.producao(s, fonte, periodo.competencias, relogio.competencia, parametros.conveniosSus)
        : [];
    let apuracao: Omit<ApuracaoSus, 'id' | 'por' | 'em' | 'versao'> | null = null;
    let corrigida = false;
    const x = await this.apoio.sgh(
      s,
      E.apuracaoSusRegistrada.codigo,
      P.editar,
      (y: { id: number }) => ({
        tabela: 'afericao_meta_sus',
        id: String(y.id),
        paciente: null,
        chave: `${idMeta}:${e.competencia}`,
      }),
      async (g) => {
        const ja = await g.apuracaoPelaChave(chave);
        if (ja) {
          if (ja.meta !== idMeta || ja.competencia !== e.competencia)
            throw recusar('chave-de-outro-registro');
          apuracao = ja;
          return { id: ja.id, versao: ja.versao, repetida: true };
        }
        const m = await g.meta(idMeta);
        if (!m) throw naoEncontrado('Meta não encontrada', 'meta-inexistente');
        if (m.versao !== vista.versao) throw recusar('versao-desatualizada');
        const c = await g.contrato(m.contrato);
        if (!c) throw naoEncontrado('Contrato não encontrado', 'contrato-inexistente');
        const ativo = conferirContratoSusAtivo(c, relogio.hoje, parametros.cnes)[0];
        if (ativo) throw recusaContratualizacao(ativo);
        const existente = await g.apuracao(idMeta, e.competencia);
        const r = conferirApuracaoSus(e, m, relogio.competencia, {
          apuracaoExistente: existente !== null,
        })[0];
        if (r) throw recusaContratualizacao(r);
        if (existente && existente.versao !== e.versaoVista) throw recusar('versao-desatualizada');
        const metaPeriodo = metaDoPeriodo(m, periodo);
        const realizado =
          m.tipo === 'quantitativa' ? realizadoQuantitativo(m, producao, periodo).total : (e.realizado ?? 0);
        const cumprimento = cumprimentoPct(m, metaPeriodo, realizado);
        const a = {
          meta: idMeta,
          competencia: e.competencia,
          inicioPeriodo: periodo.inicio,
          metaPeriodo,
          realizado,
          cumprimentoPct: cumprimento,
          escore: faixaDoCumprimento(cumprimento, parametros.faixas).escore,
          origem: m.tipo === 'quantitativa' ? fonte : ('informado' as const),
          observacao: e.observacao,
        };
        apuracao = a;
        const y = existente
          ? await g.corrigirApuracao({
              ...a,
              usuario: s.login,
              id: existente.id,
              versaoVista: existente.versao,
            })
          : await g.registrarApuracao({ ...a, usuario: s.login, chave });
        corrigida = existente !== null;
        return { ...y, repetida: false };
      },
    );
    return {
      ok: true,
      ...x,
      mensagem: x.repetida
        ? 'Esta apuração já estava registrada.'
        : corrigida
          ? 'Apuração do período corrigida.'
          : 'Apuração do período registrada.',
      apuracao: apuracao as unknown as Omit<ApuracaoSus, 'id' | 'por' | 'em' | 'versao'>,
    };
  }

  @Get('contratos/:id/painel')
  @Permissao(P.ler)
  @Auditar(E.contratualizacaoLida.codigo)
  async painelContrato(
    @Param('id') id: string,
    @Query() q: Record<string, unknown>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PainelContratualizacaoSus> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'meta_contratual_sus', idAlvo: id };
    const f = esquemaFiltroPainelSus.safeParse({ competencia: q['competencia'] });
    if (!f.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Competência inválida',
        'Informe a competência (AAAAMM).',
      );
    const competencia = f.data.competencia;
    const c = await this.porta.contrato(s.porta, idDaRota(id));
    if (!c) throw naoEncontrado('Contrato não encontrado', 'contrato-inexistente');
    const [metas, parametros, fonte, relogio] = await Promise.all([
      this.porta.metas(s.porta, c.id),
      this.parametros(s),
      this.fonte(s),
      this.porta.relogio(s.porta),
    ]);
    const vigentes = metas.filter((m) => metaValeNaCompetencia(m, competencia));
    const periodos = vigentes.map((m) => periodoDaMeta(m, competencia));
    const todas = [...new Set(periodos.flatMap((p) => p.competencias))].sort();
    const avisos = conferirContratoSusAtivo(c, relogio.hoje, parametros.cnes).map((r) => r.mensagem);
    if (!parametros.faixasValidas) avisos.push(MENSAGENS_CONTRATUALIZACAO['faixas-invalidas']);
    const janela =
      todas.length > COMPETENCIAS_MAXIMAS_PAINEL
        ? todas.filter((x) => x >= somarMeses(competencia, -(COMPETENCIAS_MAXIMAS_PAINEL - 1)))
        : todas;
    const producao = vigentes.some((m) => m.tipo === 'quantitativa')
      ? await this.producao(s, fonte, janela, relogio.competencia, parametros.conveniosSus)
      : [];
    const apuracoes = await this.porta.apuracoes(
      s.porta,
      vigentes.map((m) => m.id),
    );
    const resultados = vigentes.map((m, i) =>
      resultadoMetaSus(m, competencia, {
        producao,
        fonte,
        apuracao: apuracoes.find((a) => a.meta === m.id && a.competencia === periodos[i]?.fim) ?? null,
        faixas: parametros.faixas,
      }),
    );
    return {
      contrato: c,
      competencia,
      fonte,
      resultados,
      repasse: vigentes.length ? repasseEstimadoSus(c, competencia, resultados, parametros.faixas) : null,
      faixas: parametros.faixas,
      avisos,
    };
  }

  @Get('sigtap')
  @Permissao(P.ler)
  @Auditar(E.contratualizacaoLida.codigo)
  async sigtap(
    @Query() q: Record<string, unknown>,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ itens: { codigo: string; nome: string }[] }> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'TBPROSUS' };
    const f = esquemaBuscaSigtapMeta.safeParse({ termo: q['termo'] });
    if (!f.success)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Busca inválida',
        f.error.issues[0]?.message ?? 'Digite ao menos 2 caracteres.',
      );
    return { itens: await this.porta.buscarSigtap(s.porta, f.data.termo) };
  }
}
