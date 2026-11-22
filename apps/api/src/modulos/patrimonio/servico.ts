// Serviço do patrimônio (M54, etapa 6): junta as leituras da porta com as regras puras de @sgh/dominio-patrimonio e
// monta as respostas dos contratos. As gravações passam as conferências do domínio para dentro da transação (o que a
// porta relê é o que vale). Nenhum dado de paciente; o responsável e o fornecedor aparecem só no detalhe do bem.
import { createHash } from 'node:crypto';
import {
  type AbrirInventarioBens,
  type AjusteBem,
  type AnexarLaudoBem,
  type LaudoBem,
  TAMANHO_MAXIMO_LAUDO_BEM,
  ORIGEM_ESTORNO_AJUSTE_BEM,
  type RegistrarAjusteBem,
  type EstornarAjusteBem,
  type AlterarBem,
  type ApoioPatrimonio,
  type BemPatrimonial,
  type CadastrarBem,
  type CalcularDepreciacao,
  type CancelarInventario,
  type CancelarMovimento,
  CADASTROS_PATRIMONIO_BENS,
  CADASTROS_PATRIMONIO_PARAMETROS,
  type ConsultaBens,
  type ConsultaDepreciacao,
  type ConsultaMovimentos,
  type ConsultaNotas,
  type CotaDepreciacao,
  type DecidirMovimento,
  type DepreciacaoCompetencia,
  type EstornarDepreciacao,
  type DetalheInventario,
  type AlterarGrupoBemEntrada,
  type ContaDoGrupoBem,
  type GrupoBemCadastro,
  type GrupoBemDetalhe,
  type IncluirGrupoBemEntrada,
  type MotivoGrupoBemEntrada,
  type Inventario,
  type ItemNotaParaBem,
  type LeituraInventario,
  type LeituraInventarioRegistrada,
  type ListaBens,
  type MovimentoBem,
  type NotaEntradaParaBem,
  type ParametrosDepreciacao,
  type RegistrarMovimento,
  RESULTADOS_LEITURA_INVENTARIO,
  type ResultadoLeituraInventario,
  type ResumoInventario,
  SITUACOES_MOVIMENTO_BEM,
  type SituacaoMovimentoBem,
  TIPOS_MOVIMENTO_BEM,
  type TipoMovimentoBem,
} from '@sgh/contratos';
import {
  disponiveisDoItem,
  efeitoDoMovimento,
  etiquetaZpl,
  formatarPlaqueta,
  impedimentosDoCalculo,
  impedimentoDoEstorno,
  impedimentoDoEstornoAjuste,
  planejarAjuste,
  ORIGEM_ESTORNO_DEPRECIACAO,
  lerCodigo,
  lerResumoGravado,
  mesesEntre,
  montarTotais,
  planoDaDepreciacao,
  problemasDaDecisao,
  problemasDoCadastro,
  problemasDoCancelamento,
  problemasDoMovimento,
  resultadoDaLeitura,
  resumoDoCalculo,
  resumoDoInventario,
  resumoParaGravar,
  unidadesDoItem,
  valoresDoCadastro,
  textoDoQr,
  type BemParaDepreciar,
} from '@sgh/dominio-patrimonio';
import type {
  AjusteDoBem,
  LaudoDoBem,
  BemRegistrado,
  BemDaCompetencia,
  BemNovo,
  CotaRegistrada,
  DominiosPatrimonio,
  InventarioRegistrado,
  MovimentoRegistrado,
} from './tipos.js';
import type { RegistroTrilhaTela } from '../cadastro/tipos.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPorta } from '../cadastro/porta.js';
import type { ArmazemLaudoPatrimonio } from './armazem-laudo.js';
import type { ContextoPatrimonio, PortaPatrimonio } from './porta.js';

export interface SessaoPatrimonio {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  /** O contexto do núcleo da sessão (cliente, estabelecimento e usuário por id). */
  readonly porta: ContextoPorta;
  /** A chave de idempotência da gravação (Idempotency-Key da requisição). */
  readonly chaveIdempotencia: string;
  /**
   * Regra 13 (D-ACEITE-546): os centros de custo (pelo id) por que a pessoa recebe a transferência, do escopo
   * `centroCusto` da permissão de aceite; `null`: sem centro cadastrado, sem restrição (M06, regra 6).
   */
  readonly centrosQueRecebe: ReadonlySet<number> | null;
  pode(codigo: string): boolean;
  trilha(
    evento: string,
    operacao: 'INSERT' | 'UPDATE' | 'DELETE',
    tabela: string,
    id: number | null,
  ): RegistroTrilhaTela;
}

const ctx = (s: SessaoPatrimonio): ContextoPatrimonio => ({
  ...s.porta,
  chaveIdempotencia: s.chaveIdempotencia,
});

/** O inventário que não está aberto: encerrado ou cancelado (W0-08), cada um com o seu código. */
const inventarioNaoAberto = (situacao: string) =>
  situacao === 'cancelado'
    ? { codigo: 'inventario-cancelado', mensagem: 'O inventário foi cancelado.' }
    : { codigo: 'inventario-encerrado', mensagem: 'O inventário já foi encerrado.' };

const naoEncontrado = (o: string) =>
  new ErroProblema('nao-encontrado', 404, `${o} não encontrado`, `${o} não existe neste estabelecimento.`);

const recusada = (
  titulo: string,
  ps: readonly { codigo: string; mensagem: string; campo?: string | null }[],
) =>
  new ErroProblema('recusa-de-negocio', 409, titulo, ps.map((p) => p.mensagem).join(' '), {
    codigo: ps[0]?.codigo ?? 'recusada',
    ...(ps.some((p) => p.campo)
      ? { campos: [...new Set(ps.flatMap((p) => (p.campo ? [p.campo] : [])))] }
      : {}),
  });

/** O laudo no contrato (sem a chave do armazenamento). */
const paraLaudoBem = (l: LaudoDoBem): LaudoBem => ({
  id: l.id,
  bem: l.bem,
  nome: l.nome,
  descricao: l.descricao,
  sha256: l.sha256,
  tamanho: l.tamanho,
  enviadoPor: l.enviadoPor,
  enviadoEm: l.enviadoEm,
});

const laudoInexistente = (laudo: number) =>
  recusada('Laudo não anexado', [
    {
      codigo: 'laudo-inexistente',
      mensagem: `O laudo ${laudo} não está anexado a este bem: anexe o PDF do laudo e escolha-o na lista.`,
      campo: 'laudo',
    },
  ]);

const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** O ajuste lido no contrato (sem o centro, o grupo e a plaqueta, que só a contabilidade usa). */
const paraAjusteBem = (a: AjusteDoBem): AjusteBem => ({
  id: a.id,
  bem: a.bem,
  tipo: a.tipo,
  competenciaMarco: a.competenciaMarco,
  data: a.data,
  valorContabilAntesCent: a.valorContabilAntesCent,
  valorContabilDepoisCent: a.valorContabilDepoisCent,
  acumuladaMarcoCent: a.acumuladaMarcoCent,
  perdaCent: a.perdaCent,
  residualCent: a.residualCent,
  vidaRestanteMeses: a.vidaRestanteMeses,
  valorJustoCent: a.valorJustoCent,
  laudo: a.laudo,
  motivo: a.motivo,
  origem: a.origem,
  registradoPor: a.registradoPor,
  registradoEm: a.registradoEm,
  estorno: a.estorno
    ? {
        motivo: a.estorno.motivo,
        origem: a.estorno.origem,
        estornadoPor: a.estorno.estornadoPor,
        estornadoEm: a.estorno.estornadoEm,
      }
    : null,
});
/** W0-08: o grupo do bem é cadastro (grupo_bem): o código gravado vale como está. */
const grupoValido = (g: string): string => g.trim();
const tipoMov = (t: string): TipoMovimentoBem =>
  (TIPOS_MOVIMENTO_BEM as readonly string[]).includes(t) ? (t as TipoMovimentoBem) : 'transferencia';
const situacaoMov = (t: string): SituacaoMovimentoBem =>
  (SITUACOES_MOVIMENTO_BEM as readonly string[]).includes(t) ? (t as SituacaoMovimentoBem) : 'concluido';
const resultadoLeitura = (r: string): ResultadoLeituraInventario =>
  (RESULTADOS_LEITURA_INVENTARIO as readonly string[]).includes(r)
    ? (r as ResultadoLeituraInventario)
    : 'nao-cadastrado';

/** Hoje no relógio do estabelecimento (as datas futuras são recusadas). */
export function hojeNoEstabelecimento(agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

export class ServicoPatrimonio {
  constructor(
    private readonly porta: PortaPatrimonio,
    private readonly hoje: () => string = () => hojeNoEstabelecimento(),
  ) {}

  private bem(s: SessaoPatrimonio, b: BemRegistrado): BemPatrimonial {
    return {
      ...b,
      grupo: grupoValido(b.grupo),
      qr: textoDoQr(s.hospital, b.plaqueta),
      contabilCent: b.valorCent - b.acumuladaCent,
      movimentoPendente: b.movimentoPendente
        ? { id: b.movimentoPendente.id, tipo: tipoMov(b.movimentoPendente.tipo) }
        : null,
    };
  }

  private movimento(m: MovimentoRegistrado): MovimentoBem {
    return { ...m, tipo: tipoMov(m.tipo), situacao: situacaoMov(m.situacao) };
  }

  private async bemOu404(s: SessaoPatrimonio, id: number): Promise<BemRegistrado> {
    const b = await this.porta.bem(ctx(s), id);
    if (!b) throw naoEncontrado('Bem');
    return b;
  }

  // ── Apoio, bens e notas ───────────────────────────────────────────────────────────────────────────────────────────

  async apoio(
    s: SessaoPatrimonio,
    ligada: boolean,
    P: Record<keyof ApoioPatrimonio['acoes'], string>,
  ): Promise<ApoioPatrimonio> {
    const d = await this.porta.dominios(ctx(s));
    // W0-08: os grupos do cadastro. Revisão: TODOS, com `ativo` (o nome do bem de grupo inativo sai do cadastro); a
    // tela põe no combo só os ativos, mais o inativo que o bem já tem.
    const grupos = await this.porta.grupos(ctx(s));
    return {
      grupos: grupos.map((g) => ({
        valor: g.codigo,
        rotulo: g.nome,
        vidaUtilMeses: g.vidaUtilMeses,
        ativo: g.ativo,
      })),
      origens: d.origens,
      tiposResponsavel: d.tiposResponsavel,
      coeficientes: d.coeficientes,
      centros: d.centros,
      empresas: d.empresas,
      parametros: d.parametros,
      acoes: {
        cadastrar: ligada && s.pode(P.cadastrar),
        calcular: ligada && s.pode(P.calcular),
        registrar: ligada && s.pode(P.registrar),
        aceitar: ligada && s.pode(P.aceitar),
        baixar: ligada && s.pode(P.baixar),
        contar: ligada && s.pode(P.contar),
      },
      liberacao: { ligada },
      // Os cadastros genéricos valem com a chave desligada (receita genérica do M08, como na contabilidade).
      cadastros: [...CADASTROS_PATRIMONIO_BENS, ...CADASTROS_PATRIMONIO_PARAMETROS].filter((c) =>
        s.pode(`${c}.ler`),
      ),
    };
  }

  async listar(s: SessaoPatrimonio, q: ConsultaBens): Promise<ListaBens> {
    const r = await this.porta.bens(ctx(s), q);
    const bens = r.bens.map((b) => this.bem(s, b));
    const valorCent = bens.reduce((t, b) => t + b.valorCent, 0);
    const acumuladaCent = bens.reduce((t, b) => t + b.acumuladaCent, 0);
    return {
      bens,
      total: r.total,
      pagina: q.pagina,
      tamanho: q.tamanho,
      totaisPagina: { valorCent, acumuladaCent, contabilCent: valorCent - acumuladaCent },
    };
  }

  async detalhe(s: SessaoPatrimonio, id: number): Promise<BemPatrimonial> {
    return this.bem(s, await this.bemOu404(s, id));
  }

  /** O bem pelo texto do QR ou pela plaqueta digitada. */
  async porCodigo(s: SessaoPatrimonio, codigo: string): Promise<BemPatrimonial> {
    const c = lerCodigo(codigo, s.hospital);
    if (!c.ok)
      throw new ErroProblema('entrada-invalida', 400, 'Código não reconhecido', c.mensagem, {
        campos: ['codigo'],
      });
    const b = await this.porta.bemPorPlaqueta(ctx(s), c.plaqueta);
    if (!b) throw naoEncontrado('Bem');
    return this.bem(s, b);
  }

  async etiqueta(s: SessaoPatrimonio, id: number): Promise<{ plaqueta: string; zpl: string }> {
    const b = await this.bemOu404(s, id);
    const d = await this.porta.dominios(ctx(s));
    const titular = d.empresas.find((e) => e.id === b.empresa)?.nome ?? '';
    return {
      plaqueta: b.plaqueta,
      zpl: etiquetaZpl({ hospital: s.hospital, plaqueta: b.plaqueta, descricao: b.descricao, titular }),
    };
  }

  /** O termo de baixa: o bem baixado e o movimento de baixa registrado, relidos (nunca o que a tela mostrou). */
  async termoBaixa(
    s: SessaoPatrimonio,
    id: number,
  ): Promise<{ bem: BemPatrimonial; baixa: MovimentoBem; titular: string }> {
    const bem = await this.detalhe(s, id);
    const baixa = (await this.movimentos(s, { bem: id })).find(
      (m) => m.tipo === 'baixa' && m.situacao === 'concluido',
    );
    if (bem.situacao !== 'baixado' || !baixa)
      throw recusada('Bem sem baixa', [
        { codigo: 'sem-baixa', mensagem: 'O termo de baixa só sai para o bem já baixado.' },
      ]);
    const d = await this.porta.dominios(ctx(s));
    return { bem, baixa, titular: d.empresas.find((e) => e.id === bem.empresa)?.nome ?? '' };
  }

  async notas(
    s: SessaoPatrimonio,
    q: ConsultaNotas,
  ): Promise<{ notas: NotaEntradaParaBem[]; truncado: boolean }> {
    const [ano, mes] = q.competencia.split('-').map(Number) as [number, number];
    return this.porta.notas(ctx(s), ano, mes, q.busca);
  }

  async itensDaNota(
    s: SessaoPatrimonio,
    id: number,
  ): Promise<{ nota: NotaEntradaParaBem; itens: ItemNotaParaBem[] }> {
    const nota = await this.porta.nota(ctx(s), id);
    if (!nota) throw naoEncontrado('Nota fiscal de entrada');
    const itens = await this.porta.itensDaNota(ctx(s), nota);
    return {
      nota,
      itens: itens.map((i) => {
        const n = unidadesDoItem(i.quantidade);
        return {
          id: i.id,
          seq: i.seq,
          item: i.item,
          nome: i.nome,
          quantidade: i.quantidade,
          valorTotalCent: i.valorTotalCent,
          valorUnitarioCent: Math.floor(i.valorTotalCent / n),
          jaCadastrados: i.jaCadastrados,
          disponiveis: disponiveisDoItem(i),
        };
      }),
    };
  }

  async cadastrar(s: SessaoPatrimonio, x: CadastrarBem, evento: string): Promise<{ bens: BemPatrimonial[] }> {
    const c = ctx(s);
    const d = await this.porta.dominios(c);
    const nota = x.documento === 'nota' ? await this.porta.nota(c, x.nota) : null;
    if (x.documento === 'nota' && !nota) throw naoEncontrado('Nota fiscal de entrada');
    const item = x.documento === 'nota' ? await this.porta.itemNota(c, x.itemNota) : null;
    const contexto = {
      origens: new Map(d.origens.map((o) => [o.id, { depreciar: o.depreciar }])),
      tiposResponsavel: new Set(d.tiposResponsavel.map((t) => t.id)),
      coeficientes: new Set(d.coeficientes.map((k) => k.id)),
      centrosAtivos: new Set(d.centros.filter((k) => k.ativo).map((k) => k.id)),
      empresas: new Set(d.empresas.map((e) => e.id)),
      // W0-08: só grupo ativo do cadastro; a vida útil padrão é a do grupo agora (o bem a guarda).
      grupos: new Map(
        (await this.porta.grupos(c)).map((g) => [
          g.codigo,
          { ativo: g.ativo, vidaUtilMeses: g.vidaUtilMeses },
        ]),
      ),
      item,
      dataNota: nota?.data ?? null,
      hoje: this.hoje(),
    };
    const ps = problemasDoCadastro(x, contexto);
    if (ps.length > 0) throw recusada('Cadastro do bem recusado', ps);
    const v = valoresDoCadastro(x, contexto, nota?.empresa ?? d.empresas[0]?.id ?? null);
    const empresa = v.empresa ?? d.empresas[0]?.id;
    if (empresa === undefined)
      throw recusada('Cadastro do bem recusado', [
        { codigo: 'empresa', mensagem: 'A nota não tem empresa.' },
      ]);
    const bens: BemNovo[] = v.valores.map((valorCent) => ({
      empresa,
      plaqueta: x.plaqueta,
      descricao: x.descricao,
      grupo: x.grupo,
      origem: x.origem,
      documento: x.documento,
      nota: x.documento === 'nota' ? x.nota : null,
      itemNota: x.documento === 'nota' ? x.itemNota : null,
      item: item?.item ?? null,
      termo: x.documento === 'termo' ? { numero: x.termoNumero, data: x.termoData, doador: x.doador } : null,
      dataAquisicao: v.dataAquisicao,
      valorCent,
      residualCent: x.residualCent,
      vidaUtilMeses: v.vidaUtilMeses,
      coeficiente: x.coeficiente,
      inicioDepreciacao: v.inicioDepreciacao,
      depreciavel: v.depreciavel,
      centro: x.centro,
      localDetalhe: x.localDetalhe,
      tipoResponsavel: x.tipoResponsavel,
      responsavel: x.responsavel,
      marca: x.marca,
      modelo: x.modelo,
      numeroSerie: x.numeroSerie,
    }));
    const r = await this.porta.cadastrar(
      c,
      {
        bens,
        item: item
          ? { id: item.id, unidades: unidadesDoItem(item.quantidade), jaCadastrados: item.jaCadastrados }
          : null,
      },
      s.login,
      (n) => formatarPlaqueta(s.hospital, n),
      s.trilha(evento, 'INSERT', 'bem_patrimonial', null),
    );
    return { bens: r.map((b) => this.bem(s, b)) };
  }

  async alterar(
    s: SessaoPatrimonio,
    id: number,
    x: AlterarBem,
    evento: string,
  ): Promise<{ bem: BemPatrimonial; mudou: boolean }> {
    const d = await this.porta.dominios(ctx(s));
    const ps: { codigo: string; mensagem: string; campo: string | null }[] = [];
    if (x.tipoResponsavel !== null && !d.tiposResponsavel.some((t) => t.id === x.tipoResponsavel))
      ps.push({
        codigo: 'tipo-responsavel',
        mensagem: 'Tipo de responsável desconhecido.',
        campo: 'tipoResponsavel',
      });
    if (x.coeficiente !== null && !d.coeficientes.some((k) => k.id === x.coeficiente))
      ps.push({
        codigo: 'coeficiente',
        mensagem: 'Coeficiente de turnos desconhecido.',
        campo: 'coeficiente',
      });
    if (x.responsavel !== null && x.tipoResponsavel === null)
      ps.push({
        codigo: 'tipo-responsavel',
        mensagem: 'Informe o tipo do responsável.',
        campo: 'tipoResponsavel',
      });
    // Revisão W0-08: o grupo vem do cadastro (grupo_bem); o grupo novo tem de existir e estar ativo (manter o
    // grupo inativo que o bem já tem é aceito). A gravação confere de novo na transação, com a linha do grupo travada.
    const grupo = (await this.porta.grupos(ctx(s))).find((g) => g.codigo === x.grupo);
    const antesDoBem = await this.porta.bem(ctx(s), id);
    if (antesDoBem && x.grupo !== antesDoBem.grupo) {
      if (!grupo) ps.push({ codigo: 'grupo', mensagem: 'Grupo do bem desconhecido.', campo: 'grupo' });
      else if (!grupo.ativo)
        ps.push({
          codigo: 'grupo-inativo',
          mensagem: 'O grupo do bem está inativo: escolha outro.',
          campo: 'grupo',
        });
    }
    if (ps.length > 0) throw recusada('Alteração do bem recusada', ps);
    const r = await this.porta.alterar(
      ctx(s),
      {
        id,
        versao: x.versao,
        descricao: x.descricao,
        grupo: x.grupo,
        localDetalhe: x.localDetalhe,
        tipoResponsavel: x.tipoResponsavel,
        responsavel: x.responsavel,
        marca: x.marca,
        modelo: x.modelo,
        numeroSerie: x.numeroSerie,
        vidaUtilMeses: x.vidaUtilMeses,
        residualCent: x.residualCent,
        coeficiente: x.coeficiente,
        inicioDepreciacao: x.inicioDepreciacao,
        depreciavel: x.depreciavel,
      },
      s.login,
      (antes) => {
        if (antes.situacao === 'baixado') return 'O bem baixado não se altera.';
        if (x.residualCent >= antes.valorCent) return 'O valor residual tem de ser menor que o valor do bem.';
        if (x.inicioDepreciacao < antes.dataAquisicao.slice(0, 7))
          return 'A depreciação não começa antes da aquisição.';
        const mudaDepreciacao =
          antes.vidaUtilMeses !== x.vidaUtilMeses ||
          antes.residualCent !== x.residualCent ||
          (antes.coeficiente?.id ?? null) !== x.coeficiente ||
          antes.inicioDepreciacao !== x.inicioDepreciacao ||
          antes.depreciavel !== x.depreciavel;
        return mudaDepreciacao && antes.cotas > 0
          ? 'O bem já tem depreciação gravada: vida útil, residual, turnos, início e a marca de depreciar não mudam mais.'
          : null;
      },
      s.trilha(evento, 'UPDATE', 'bem_patrimonial', id),
    );
    if (!r) throw naoEncontrado('Bem');
    return { bem: this.bem(s, r.depois), mudou: r.mudou };
  }

  // ── Grupo do bem (W0-08, parte 4: cadastro grupo_bem) ──────────────────────────────────────────────────────────

  /** O nome do grupo pelo cadastro (o código, quando não está mais lá). */
  private async nomeDoGrupo(c: ContextoPatrimonio): Promise<(codigo: string) => string> {
    const gs = await this.porta.grupos(c);
    return (codigo) => gs.find((g) => g.codigo === codigo)?.nome ?? codigo;
  }

  private grupoDe(g: GrupoBemCadastro & { id?: number | null }): GrupoBemCadastro {
    return {
      codigo: g.codigo,
      nome: g.nome,
      vidaUtilMeses: g.vidaUtilMeses,
      conta: g.conta,
      ativo: g.ativo,
      semente: g.semente,
      inativadoEm: g.inativadoEm,
      motivoInativacao: g.motivoInativacao,
      versao: g.versao,
      bens: g.bens,
    };
  }

  async grupos(s: SessaoPatrimonio): Promise<GrupoBemCadastro[]> {
    return (await this.porta.grupos(ctx(s))).map((g) => this.grupoDe(g));
  }

  /** Revisão W0-08: as contas analíticas e ativas do plano, para o combo da conta do grupo. */
  async contasDoGrupo(s: SessaoPatrimonio): Promise<ContaDoGrupoBem[]> {
    return this.porta.contasDoGrupo(ctx(s));
  }

  /**
   * Revisão W0-08: a conta do grupo tem de ser analítica e ativa no plano de contas. Na alteração, manter a conta que o
   * grupo já tem segue aceito (mesmo que a conta tenha sido inativada no plano depois).
   */
  private async conferirContaDoGrupo(s: SessaoPatrimonio, conta: string | null, atual: string | null) {
    if (conta === null || conta === atual) return;
    const contas = await this.porta.contasDoGrupo(ctx(s));
    if (!contas.some((x) => x.codigo === conta))
      throw recusada('Grupo do bem recusado', [
        {
          codigo: 'conta',
          mensagem: 'A conta não existe no plano de contas ou não é analítica e ativa.',
          campo: 'conta',
        },
      ]);
  }

  async grupo(s: SessaoPatrimonio, codigo: string): Promise<GrupoBemDetalhe> {
    const g = (await this.porta.grupos(ctx(s))).find((x) => x.codigo === codigo);
    if (!g) throw naoEncontrado('Grupo do bem');
    return { ...this.grupoDe(g), versoes: await this.porta.versoesGrupo(ctx(s), g.id) };
  }

  async incluirGrupo(
    s: SessaoPatrimonio,
    x: IncluirGrupoBemEntrada,
    evento: string,
  ): Promise<GrupoBemCadastro> {
    await this.conferirContaDoGrupo(s, x.conta, null);
    const g = await this.porta.incluirGrupo(
      ctx(s),
      { codigo: x.codigo, nome: x.nome, vidaUtilMeses: x.vidaUtilMeses, conta: x.conta },
      s.login,
      s.trilha(evento, 'INSERT', 'grupo_bem', null),
    );
    return this.grupoDe(g);
  }

  async alterarGrupo(
    s: SessaoPatrimonio,
    codigo: string,
    x: AlterarGrupoBemEntrada,
    evento: string,
  ): Promise<GrupoBemCadastro> {
    const antes = (await this.porta.grupos(ctx(s))).find((g) => g.codigo === codigo);
    await this.conferirContaDoGrupo(s, x.conta, antes?.conta ?? null);
    const r = await this.porta.alterarGrupo(
      ctx(s),
      {
        codigo,
        nome: x.nome,
        vidaUtilMeses: x.vidaUtilMeses,
        conta: x.conta,
        versaoVista: x.versao,
        motivo: x.motivo,
      },
      s.login,
      s.trilha(evento, 'UPDATE', 'grupo_bem', null),
    );
    return this.grupoDe(r.depois);
  }

  async situacaoGrupo(
    s: SessaoPatrimonio,
    codigo: string,
    x: MotivoGrupoBemEntrada,
    ativo: boolean,
    evento: string,
  ): Promise<GrupoBemCadastro> {
    const r = await this.porta.situacaoGrupo(
      ctx(s),
      { codigo, versaoVista: x.versao, motivo: x.motivo, ativo },
      s.login,
      s.trilha(evento, 'UPDATE', 'grupo_bem', null),
    );
    return this.grupoDe(r.depois);
  }

  async excluirGrupo(
    s: SessaoPatrimonio,
    codigo: string,
    x: MotivoGrupoBemEntrada,
    evento: string,
  ): Promise<{ codigo: string; excluido: true }> {
    await this.porta.excluirGrupo(
      ctx(s),
      { codigo, versaoVista: x.versao, motivo: x.motivo },
      s.login,
      s.trilha(evento, 'DELETE', 'grupo_bem', null),
    );
    return { codigo, excluido: true };
  }

  // ── Depreciação ───────────────────────────────────────────────────────────────────────────────────────────────────

  private paraDepreciar(b: BemDaCompetencia): BemParaDepreciar {
    return { ...b, grupo: grupoValido(b.grupo) };
  }

  private cotaDaLida(k: CotaRegistrada, competencia: string): CotaDepreciacao {
    const depreciavel = k.baseCent - k.residualCent;
    return {
      bem: k.bem,
      plaqueta: k.plaqueta,
      descricao: k.descricao,
      grupo: grupoValido(k.grupo),
      centro: k.centro,
      baseCent: k.baseCent,
      residualCent: k.residualCent,
      vidaUtilMeses: k.vidaUtilMeses,
      coeficiente: k.coeficiente,
      acumuladaAntesCent: k.acumuladaAntesCent,
      mesesDecorridos: mesesEntre(k.inicioDepreciacao, competencia),
      valorCent: k.valorCent,
      acumuladaDepoisCent: k.acumuladaAntesCent + k.valorCent,
      ultima: k.acumuladaAntesCent + k.valorCent === depreciavel,
      recuperaMeses:
        k.valorCent >
        Math.round((depreciavel * Math.round(k.coeficiente * 100)) / (k.vidaUtilMeses * 100)) + 1,
    };
  }

  private parametros(d: DominiosPatrimonio, empresa: number): ParametrosDepreciacao | null {
    return d.parametros.find((p) => p.empresa === empresa) ?? null;
  }

  async depreciacao(s: SessaoPatrimonio, q: ConsultaDepreciacao): Promise<DepreciacaoCompetencia> {
    const c = ctx(s);
    const d = await this.porta.dominios(c);
    const nome = (id: number) => d.centros.find((k) => k.id === id)?.nome ?? String(id);
    const nomeGrupo = await this.nomeDoGrupo(c);
    const par = this.parametros(d, q.empresa);
    const parametros = par ?? {
      empresa: q.empresa,
      depreciar: false,
      aplicarCoeficiente: false,
      considerarResidual: false,
    };
    const { daCompetencia, ultimo } = await this.porta.calculos(c, q.empresa, q.competencia);
    const estornos = await this.porta.estornos(c, q.empresa, q.competencia);
    if (daCompetencia) {
      const cotas = (await this.porta.cotas(c, daCompetencia.id)).map((k) =>
        this.cotaDaLida(k, q.competencia),
      );
      return {
        empresa: q.empresa,
        competencia: q.competencia,
        calculo: daCompetencia,
        cotas,
        semCota: [],
        ...montarTotais(cotas, nome, nomeGrupo),
        impedimentos: ['A depreciação desta competência já foi calculada.'],
        parametros,
        estornos,
        estornavel: ultimo?.id === daCompetencia.id,
      };
    }
    const lidos = await this.porta.bensParaDepreciar(c, q.empresa, q.competencia);
    const plano = planoDaDepreciacao(
      lidos.bens.map((b) => this.paraDepreciar(b)),
      q.competencia,
      parametros,
      nome,
      nomeGrupo,
    );
    const impedimentos = impedimentosDoCalculo(q.competencia, {
      parametros: par,
      ultimaCalculada: ultimo?.competencia ?? null,
      mesAtual: this.hoje().slice(0, 7),
    });
    if (lidos.truncado)
      impedimentos.push('A empresa tem bens demais para um cálculo só; fale com o suporte.');
    return {
      empresa: q.empresa,
      competencia: q.competencia,
      calculo: null,
      ...plano,
      impedimentos,
      parametros,
      estornos,
      estornavel: false,
    };
  }

  /**
   * W0-08, parte 5: estorna o último cálculo vigente da competência, com motivo (ITG 2000, item 32). A regra pura
   * (impedimentoDoEstorno) decide sobre o que a porta relê NA transação; a recusa sai 409 com o código (lote exportado:
   * "cancele a exportação primeiro"). Depois do estorno, a competência pode ser calculada de novo.
   */
  async estornar(
    s: SessaoPatrimonio,
    x: EstornarDepreciacao,
    evento: string,
  ): Promise<DepreciacaoCompetencia> {
    await this.porta.estornar(
      ctx(s),
      { ...x, origem: ORIGEM_ESTORNO_DEPRECIACAO },
      s.login,
      (sit) => impedimentoDoEstorno(x.competencia, sit),
      s.trilha(evento, 'INSERT', 'estorno_calculo_depreciacao', null),
    );
    return this.depreciacao(s, { empresa: x.empresa, competencia: x.competencia });
  }

  /** W0-08 (M1): os ajustes de valor do bem (revisão, impairment e reavaliação), com os estornos. */
  async ajustes(s: SessaoPatrimonio, bem: number): Promise<AjusteBem[]> {
    const c = ctx(s);
    if (!(await this.porta.bem(c, bem))) throw naoEncontrado('Bem');
    return (await this.porta.ajustes(c, bem)).map(paraAjusteBem);
  }

  /**
   * W0-08 (M1; CPC 27 e CPC 01): registra o ajuste do bem pela versão lida. A regra pura (planejarAjuste) decide sobre
   * o que a porta relê NA transação (marco, última competência, contas do impairment, lotes exportados); o cadastro e
   * as cotas já calculadas não mudam: a depreciação seguinte parte do marco (prospectiva).
   */
  async registrarAjuste(s: SessaoPatrimonio, x: RegistrarAjusteBem, evento: string): Promise<AjusteBem> {
    const hoje = this.hoje();
    // Achado 6: o laudo tem de estar anexado a este bem (a gravação confere de novo na transação; a FK do 1109 também).
    if (x.laudo !== null) {
      const l = await this.porta.laudo(ctx(s), x.laudo);
      if (!l || l.bem !== x.bem) throw laudoInexistente(x.laudo);
    }
    const r = await this.porta.registrarAjuste(
      ctx(s),
      { bem: x.bem, versao: x.versao, motivo: x.motivo, hoje },
      s.login,
      (sit) =>
        planejarAjuste(x, {
          bem: {
            valorCent: sit.bem.valorCent,
            residualCent: sit.bem.residualCent,
            vidaUtilMeses: sit.bem.vidaUtilMeses,
            coeficiente: sit.bem.coeficiente?.percentual ?? null,
            inicioDepreciacao: sit.bem.inicioDepreciacao,
            depreciavel: sit.bem.depreciavel,
            situacao: sit.bem.situacao,
            acumuladaCent: sit.bem.acumuladaCent,
            marco: sit.marco,
          },
          ultimaCalculada: sit.ultimaCalculada,
          hoje,
          contasConfiguradas: sit.contasConfiguradas,
          lotesExportados: sit.lotesExportados,
        }),
      s.trilha(evento, 'INSERT', 'ajuste_valor_bem', x.bem),
    );
    return paraAjusteBem(r);
  }

  /** Achado 6 da revisão: os laudos anexados ao bem (o PDF de cada um se baixa por `arquivoLaudo`). */
  async laudos(s: SessaoPatrimonio, bem: number): Promise<LaudoBem[]> {
    const c = ctx(s);
    if (!(await this.porta.bem(c, bem))) throw naoEncontrado('Bem');
    return (await this.porta.laudos(c, bem)).map(paraLaudoBem);
  }

  /**
   * Achado 6 da revisão (CPC 01 e CPC 27; RDC 509): anexa o PDF do laudo ao bem. O arquivo vai primeiro ao
   * disco local, somente leitura (chave do SHA-256; o mesmo PDF é reaproveitado), depois a linha imutável no banco.
   */
  async anexarLaudo(
    s: SessaoPatrimonio,
    bem: number,
    x: AnexarLaudoBem,
    armazem: ArmazemLaudoPatrimonio,
    evento: string,
  ): Promise<LaudoBem> {
    const bytes = Uint8Array.from(Buffer.from(x.conteudo, 'base64'));
    if (bytes.length === 0 || bytes.length > TAMANHO_MAXIMO_LAUDO_BEM)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Arquivo inválido',
        'O PDF do laudo tem de ter até 700 KB.',
        {
          campos: ['conteudo'],
        },
      );
    if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-')
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Arquivo inválido',
        'O laudo tem de ser um arquivo PDF.',
        {
          codigo: 'laudo-nao-pdf',
          campos: ['conteudo'],
        },
      );
    const c = ctx(s);
    if (!(await this.porta.bem(c, bem))) throw naoEncontrado('Bem');
    const sha256 = sha256Hex(bytes);
    const chave = await armazem.guardar(s.hospital, bytes, sha256);
    const l = await this.porta.anexarLaudo(
      c,
      { bem, nome: x.nome, descricao: x.descricao, chave, sha256, tamanho: bytes.length },
      s.login,
      s.trilha(evento, 'INSERT', 'laudo_bem', bem),
    );
    return paraLaudoBem(l);
  }

  /** Achado 6 da revisão: o PDF do laudo, conferido contra o SHA-256 registrado na anexação. */
  async arquivoLaudo(
    s: SessaoPatrimonio,
    id: number,
    armazem: ArmazemLaudoPatrimonio,
  ): Promise<{ laudo: LaudoBem; bytes: Uint8Array }> {
    const l = await this.porta.laudo(ctx(s), id);
    if (!l) throw naoEncontrado('Laudo');
    const bytes = await armazem.ler(s.hospital, l.chave);
    if (!bytes)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Arquivo indisponível',
        'O arquivo do laudo não está no armazenamento.',
      );
    if (sha256Hex(bytes) !== l.sha256)
      throw new ErroProblema(
        'erro-interno',
        500,
        'Arquivo divergente',
        'O arquivo guardado não confere com o resumo registrado na anexação do laudo.',
      );
    return { laudo: paraLaudoBem(l), bytes };
  }

  /** W0-08 (M1): estorna o ajuste com motivo (fato novo; só o último do bem, sem cota depois, sem lote exportado). */
  async estornarAjuste(
    s: SessaoPatrimonio,
    ajuste: number,
    x: EstornarAjusteBem,
    evento: string,
  ): Promise<AjusteBem> {
    const r = await this.porta.estornarAjuste(
      ctx(s),
      { ajuste, motivo: x.motivo, origem: ORIGEM_ESTORNO_AJUSTE_BEM, hoje: this.hoje() },
      s.login,
      (sit) =>
        impedimentoDoEstornoAjuste({
          ...sit,
          ajuste: { ...sit.ajuste, estornado: sit.ajuste.estorno !== null },
        }),
      s.trilha(evento, 'INSERT', 'ajuste_valor_bem', ajuste),
    );
    return paraAjusteBem(r);
  }

  async calcular(
    s: SessaoPatrimonio,
    x: CalcularDepreciacao,
    evento: string,
  ): Promise<DepreciacaoCompetencia> {
    const c = ctx(s);
    const d = await this.porta.dominios(c);
    const par = this.parametros(d, x.empresa);
    const mesAtual = this.hoje().slice(0, 7);
    const nome = (id: number) => d.centros.find((k) => k.id === id)?.nome ?? String(id);
    const nomeGrupo = await this.nomeDoGrupo(c);
    await this.porta.calcular(
      c,
      x,
      s.login,
      ({ bens, ultimo }) => {
        const impedimentos = impedimentosDoCalculo(x.competencia, {
          parametros: par,
          ultimaCalculada: ultimo?.competencia ?? null,
          mesAtual,
        });
        const plano = planoDaDepreciacao(
          bens.map((b) => this.paraDepreciar(b)),
          x.competencia,
          par ?? { aplicarCoeficiente: false, considerarResidual: false },
          nome,
          nomeGrupo,
        );
        return {
          impedimentos,
          cotas: plano.cotas,
          ignorados: plano.semCota.length,
          totalCent: plano.totalCent,
          resumo: resumoDoCalculo(plano),
        };
      },
      s.trilha(evento, 'INSERT', 'calculo_depreciacao', null),
    );
    return this.depreciacao(s, x);
  }

  // ── Movimentos ────────────────────────────────────────────────────────────────────────────────────────────────────

  async movimentos(s: SessaoPatrimonio, q: ConsultaMovimentos): Promise<MovimentoBem[]> {
    const ms = await this.porta.movimentos(ctx(s), q);
    // Os pendentes de quem tem escopo de centro: os que ele recebe e os que ele mesmo pediu (D-ACEITE-546).
    const cs = s.centrosQueRecebe;
    const visiveis =
      q.situacao === 'pendente' && cs !== null
        ? ms.filter(
            (m) =>
              (m.destino !== null && cs.has(m.destino.id)) ||
              m.solicitadoPor.toUpperCase() === s.login.toUpperCase(),
          )
        : ms;
    return visiveis.map((m) => this.movimento(m));
  }

  async registrar(
    s: SessaoPatrimonio,
    x: RegistrarMovimento,
    evento: string,
    /** Só na baixa: o motivo de baixa do cadastro (dominios.motivosBaixa), nunca texto livre. */
    motivoBaixa: number | null = null,
  ): Promise<{ movimento: MovimentoBem; bem: BemPatrimonial }> {
    const c = ctx(s);
    const b = await this.bemOu404(s, x.bem);
    const d = await this.porta.dominios(c);
    if (x.tipo === 'baixa' && (motivoBaixa === null || !d.motivosBaixa.some((m) => m.id === motivoBaixa)))
      throw recusada('Movimento recusado', [
        {
          codigo: 'motivo-baixa',
          mensagem:
            motivoBaixa === null
              ? 'Escolha o motivo da baixa no cadastro de motivos.'
              : 'O motivo de baixa não existe ou está inativo.',
        },
      ]);
    const vista = {
      id: b.id,
      situacao: b.situacao,
      centro: b.centro.id,
      dataAquisicao: b.dataAquisicao,
      versao: b.versao,
      ultimaCompetencia: b.ultimaCompetencia,
      movimentoPendente: b.movimentoPendente,
    };
    const ps = problemasDoMovimento(vista, x, {
      hoje: this.hoje(),
      centrosAtivos: new Set(d.centros.filter((k) => k.ativo).map((k) => k.id)),
    });
    if (ps.length > 0) throw recusada('Movimento recusado', ps);
    const ef = efeitoDoMovimento(vista, x);
    const referencia = x.tipo === 'devolucao' ? await this.porta.ultimaSaida(c, b.id) : null;
    const r = await this.porta.registrarMovimento(
      c,
      {
        bem: b.id,
        versaoBem: b.versao,
        tipo: x.tipo,
        situacao: ef.situacaoMovimento === 'pendente' ? 'pendente' : 'concluido',
        data: x.data,
        origem: b.centro.id,
        destino: x.tipo === 'transferencia' ? x.destino : null,
        destinoResponsavel: x.tipo === 'transferencia' ? x.destinoResponsavel : null,
        terceiro: x.tipo === 'emprestimo' || x.tipo === 'comodato' ? x.terceiro : null,
        retornoPrevisto: x.tipo === 'emprestimo' || x.tipo === 'comodato' ? x.retornoPrevisto : null,
        termoNumero:
          x.tipo === 'emprestimo' || x.tipo === 'comodato' || x.tipo === 'baixa' ? x.termoNumero : null,
        motivo: x.motivo,
        motivoBaixa: x.tipo === 'baixa' ? motivoBaixa : null,
        valorVendaCent: x.tipo === 'baixa' ? x.valorVendaCent : null,
        referencia,
        efeito: ef.bem ? { situacao: ef.bem.situacao, baixadoEm: ef.bem.baixadoEm } : null,
      },
      s.login,
      s.trilha(evento, 'INSERT', 'movimento_bem', null),
    );
    return { movimento: this.movimento(r.movimento), bem: this.bem(s, r.bem) };
  }

  async decidir(
    s: SessaoPatrimonio,
    id: number,
    x: DecidirMovimento,
    evento: string,
  ): Promise<{ movimento: MovimentoBem; bem: BemPatrimonial }> {
    const r = await this.porta.decidir(
      ctx(s),
      { id, versao: x.versao, aceitar: x.aceitar, motivo: x.motivo },
      s.login,
      (m, bem) => {
        const ps = problemasDaDecisao(
          {
            tipo: tipoMov(m.tipo),
            situacao: situacaoMov(m.situacao),
            versao: m.versao,
            solicitadoPor: m.solicitadoPor,
            origem: m.origem.id,
            destino: m.destino?.id ?? null,
          },
          { situacao: bem.situacao, centro: bem.centro.id },
          s.login,
          x.versao,
          s.centrosQueRecebe,
        ).filter((p) => x.aceitar || p.codigo !== 'bem-mudou');
        return ps.length > 0 ? ps.map((p) => p.mensagem).join(' ') : null;
      },
      s.trilha(evento, 'UPDATE', 'movimento_bem', id),
    );
    if (!r) throw naoEncontrado('Movimento');
    return { movimento: this.movimento(r.movimento), bem: this.bem(s, r.bem) };
  }

  async cancelar(
    s: SessaoPatrimonio,
    id: number,
    x: CancelarMovimento,
    evento: string,
  ): Promise<{ movimento: MovimentoBem }> {
    const r = await this.porta.cancelar(
      ctx(s),
      { id, versao: x.versao, motivo: x.motivo },
      s.login,
      (m) => {
        const ps = problemasDoCancelamento(
          {
            tipo: tipoMov(m.tipo),
            situacao: situacaoMov(m.situacao),
            versao: m.versao,
            solicitadoPor: m.solicitadoPor,
            origem: m.origem.id,
          },
          s.login,
          x.versao,
        );
        return ps.length > 0 ? ps.map((p) => p.mensagem).join(' ') : null;
      },
      s.trilha(evento, 'UPDATE', 'movimento_bem', id),
    );
    if (!r) throw naoEncontrado('Movimento');
    return { movimento: this.movimento(r.movimento) };
  }

  // ── Inventário ────────────────────────────────────────────────────────────────────────────────────────────────────

  private inventarioBase(i: InventarioRegistrado): Omit<Inventario, 'resumo'> {
    return {
      id: i.id,
      descricao: i.descricao,
      centro: i.centro,
      situacao: i.situacao,
      abertoPor: i.abertoPor,
      abertoEm: i.abertoEm,
      encerradoPor: i.encerradoPor,
      encerradoEm: i.encerradoEm,
      canceladoPor: i.canceladoPor,
      canceladoEm: i.canceladoEm,
      motivoCancelamento: i.motivoCancelamento,
    };
  }

  /** W0-08, parte 5: cancela o inventário aberto com motivo; as leituras feitas ficam e continuam visíveis. */
  async cancelarInventario(
    s: SessaoPatrimonio,
    id: number,
    x: CancelarInventario,
    evento: string,
  ): Promise<DetalheInventario> {
    const ok = await this.porta.cancelarInventario(
      ctx(s),
      { id, motivo: x.motivo },
      s.login,
      s.trilha(evento, 'UPDATE', 'inventario_bem', id),
    );
    if (!ok) throw naoEncontrado('Inventário');
    return this.inventario(s, id);
  }

  async inventarios(s: SessaoPatrimonio): Promise<Inventario[]> {
    return (await this.porta.inventarios(ctx(s))).map((i) => ({
      ...this.inventarioBase(i),
      resumo: i.situacao === 'encerrado' ? lerResumoGravado(i.resumo) : null,
    }));
  }

  private async resumoAoVivo(
    s: SessaoPatrimonio,
    i: InventarioRegistrado,
    leituras: readonly LeituraInventarioRegistrada[],
  ): Promise<ResumoInventario> {
    const esp = await this.porta.esperados(ctx(s), i.centro?.id ?? null);
    return resumoDoInventario(
      esp.bens,
      leituras.map((l) => ({ bem: l.bem?.id ?? null, resultado: l.resultado })),
    );
  }

  async inventario(s: SessaoPatrimonio, id: number): Promise<DetalheInventario> {
    const i = await this.porta.inventario(ctx(s), id);
    if (!i) throw naoEncontrado('Inventário');
    const { leituras: lidas } = await this.porta.leituras(ctx(s), id);
    const leituras: LeituraInventarioRegistrada[] = lidas.map((l) => ({
      ...l,
      resultado: resultadoLeitura(l.resultado),
    }));
    let resumo: ResumoInventario;
    if (i.situacao === 'encerrado') {
      const gravado = lerResumoGravado(i.resumo);
      if (gravado) {
        const porId = new Map<number, BemRegistrado | null>();
        for (const n of gravado.naoEncontrados) porId.set(n.bem, await this.porta.bem(ctx(s), n.bem));
        resumo = {
          ...gravado,
          naoEncontrados: gravado.naoEncontrados.map((n) => ({
            ...n,
            descricao: porId.get(n.bem)?.descricao ?? '',
            centro: porId.get(n.bem)?.centro.id ?? 0,
          })),
        };
      } else resumo = await this.resumoAoVivo(s, i, leituras);
    } else resumo = await this.resumoAoVivo(s, i, leituras);
    return { ...this.inventarioBase(i), leituras, resumo };
  }

  async abrirInventario(
    s: SessaoPatrimonio,
    x: AbrirInventarioBens,
    evento: string,
  ): Promise<DetalheInventario> {
    if (x.centro !== null) {
      const d = await this.porta.dominios(ctx(s));
      if (!d.centros.some((k) => k.id === x.centro && k.ativo))
        throw recusada('Inventário recusado', [
          { codigo: 'centro', mensagem: 'Setor desconhecido ou inativo.', campo: 'centro' },
        ]);
    }
    const id = await this.porta.abrirInventario(
      ctx(s),
      x,
      s.login,
      s.trilha(evento, 'INSERT', 'inventario_bem', null),
    );
    return this.inventario(s, id);
  }

  async ler(
    s: SessaoPatrimonio,
    id: number,
    x: LeituraInventario,
    evento: string,
  ): Promise<{ leitura: LeituraInventarioRegistrada; resumo: ResumoInventario }> {
    const c = ctx(s);
    const inv = await this.porta.inventario(c, id);
    if (!inv) throw naoEncontrado('Inventário');
    if (inv.situacao !== 'aberto') throw recusada('Leitura recusada', [inventarioNaoAberto(inv.situacao)]);
    const d = await this.porta.dominios(c);
    if (!d.centros.some((k) => k.id === x.centro))
      throw recusada('Leitura recusada', [
        { codigo: 'centro', mensagem: 'Setor desconhecido.', campo: 'centro' },
      ]);
    const cod = lerCodigo(x.codigo, s.hospital);
    if (!cod.ok)
      throw new ErroProblema('entrada-invalida', 400, 'Código não reconhecido', cod.mensagem, {
        campos: ['codigo'],
      });
    const bem = await this.porta.bemPorPlaqueta(c, cod.plaqueta);
    const { leituras } = await this.porta.leituras(c, id);
    const jaLidos = new Set(leituras.flatMap((l) => (l.bem && l.resultado !== 'repetida' ? [l.bem.id] : [])));
    const resultado = resultadoDaLeitura(
      bem
        ? {
            id: bem.id,
            plaqueta: bem.plaqueta,
            descricao: bem.descricao,
            centro: bem.centro.id,
            situacao: bem.situacao,
          }
        : null,
      x.centro,
      jaLidos,
    );
    const lid = await this.porta.registrarLeitura(
      c,
      {
        inventario: id,
        codigo: cod.plaqueta,
        bem: bem?.id ?? null,
        centroLido: x.centro,
        resultado,
        observacao: x.observacao,
      },
      s.login,
      s.trilha(evento, 'INSERT', 'inventario_bem_item', null),
    );
    const det = await this.inventario(s, id);
    const leitura = det.leituras.find((l) => l.id === lid);
    if (!leitura) throw new Error('A leitura gravada não foi relida.');
    return { leitura, resumo: det.resumo };
  }

  async encerrar(s: SessaoPatrimonio, id: number, evento: string): Promise<DetalheInventario> {
    const det = await this.inventario(s, id);
    if (det.situacao !== 'aberto')
      throw recusada('Encerramento recusado', [inventarioNaoAberto(det.situacao)]);
    const ok = await this.porta.encerrarInventario(
      ctx(s),
      { id, esperados: det.resumo.esperados, resumo: resumoParaGravar(det.resumo) },
      s.login,
      s.trilha(evento, 'UPDATE', 'inventario_bem', id),
    );
    if (!ok) throw naoEncontrado('Inventário');
    return this.inventario(s, id);
  }
}
