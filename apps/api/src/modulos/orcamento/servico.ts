// Orçamento empresarial (M54, etapa 7; ficha, seções 4, 6, 7 e 8, regra 14; manual m23): a tela `Financeiro >
// Orçamento empresarial` (`/financeiro/orcamento`). Os centros de custo e os itens gerenciais são os do banco (lidos
// onde estão); as versões e as linhas ficam em SGH_ORC_*; o realizado é lido do banco (MFLANGSI, GEKONCDC e o rateio do
// novo). As regras são de @sgh/dominio-financeiro; aqui só a orquestração (leituras, validação contra os cadastros do
// banco, gravação com a trilha na mesma transação).
import {
  type ApoioOrcamento,
  type AprovarOrcamento,
  CENTRO_SEM_CENTRO_ORCAMENTO,
  type CentroOrcamento,
  type ChaveLinhaOrcamento,
  type ComparativoOrcamento,
  type ConsultaComparativo,
  type CriarVersaoOrcamento,
  DESCRICOES_NATUREZA_ORCAMENTO,
  type DescartarOrcamento,
  type GravarLinhasOrcamento,
  type ItemGerencialOrcamento,
  type LinhaOrcamento,
  type LinhaOrcamentoEntrada,
  MESES_ORCAMENTO,
  NATUREZAS_ORCAMENTO,
  type OrcamentoDetalhe,
  type OrcamentoVersao,
  type RealizadoOrcamentoLido,
  ROTULO_CONSUMO_ITEM,
  ROTULO_SEM_CENTRO,
  ROTULOS_NATUREZA_ORCAMENTO,
  TETO_LINHAS_ORCAMENTO,
} from '@sgh/contratos';
import {
  chaveDoItem,
  comparar,
  converterRealizado,
  recortar,
  gerarDoRealizado,
  motivoSemAprovar,
  planejarGravacao,
  validarLinhas,
} from '@sgh/dominio-financeiro';
import type { LinhaTrilha, RealizadoAnoLido } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro } from '../cadastro/comum.js';
import type { ApoioOrcamentoLido, ContextoOrcamento, PortaOrcamento } from './porta.js';

export interface SessaoOrcamento {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  pode(codigo: string): boolean;
  /** A linha da trilha de uma gravação. */
  trilha(
    evento: string,
    operacao: string,
    tabela: string,
    id: number | null,
    chave?: string | null,
  ): LinhaTrilha;
}

export interface CodigosOrcamento {
  readonly editar: string;
  readonly aprovar: string;
}

export interface EventosOrcamento {
  readonly criado: string;
  readonly linhas: string;
  readonly aprovado: string;
  readonly descartado: string;
}

const ctx = (s: SessaoOrcamento): ContextoOrcamento => ({ rede: s.rede, hospital: s.hospital });

const naoEncontrado = () =>
  new ErroProblema(
    'nao-encontrado',
    404,
    'Orçamento não encontrado',
    'A versão não existe neste estabelecimento.',
  );

const recusa = (codigo: string, titulo: string, detalhe: string) =>
  new ErroProblema('recusa-de-negocio', 409, titulo, detalhe, { codigo });

/** Converte a recusa do legado (ErroOperacao) no problema HTTP. */
async function gravando<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw problemaDoCadastro(e);
  }
}

const formatoReais = (centavos: number): string =>
  (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function rotuloCentro(centros: ReadonlyMap<number, CentroOrcamento>, id: number): string {
  if (id === CENTRO_SEM_CENTRO_ORCAMENTO) return ROTULO_SEM_CENTRO;
  const c = centros.get(id);
  return c ? `${c.codigo} · ${c.nome}` : `Centro ${id} (fora do cadastro)`;
}

export function rotuloItem(
  itens: ReadonlyMap<string, ItemGerencialOrcamento>,
  k: ChaveLinhaOrcamento,
): string {
  if (k.natureza === 'consumo') return ROTULO_CONSUMO_ITEM;
  const ch = chaveDoItem(k.grupo, k.subgrupo, k.item);
  const i = itens.get(ch);
  return i ? `${ch} · ${i.nome}` : `${ch} (sem cadastro)`;
}

interface Cadastros {
  readonly apoio: ApoioOrcamentoLido;
  readonly centros: Map<number, CentroOrcamento>;
  readonly itens: Map<string, ItemGerencialOrcamento>;
}

export class ServicoOrcamento {
  constructor(private readonly porta: PortaOrcamento) {}

  private async cadastros(s: SessaoOrcamento): Promise<Cadastros> {
    const apoio = await this.porta.apoio(ctx(s));
    return {
      apoio,
      centros: new Map(apoio.centros.map((c) => [c.id, c])),
      itens: new Map(apoio.itens.map((i) => [chaveDoItem(i.grupo, i.subgrupo, i.item), i])),
    };
  }

  private async versaoOu404(s: SessaoOrcamento, id: number): Promise<OrcamentoVersao> {
    const v = await this.porta.versao(ctx(s), id);
    if (!v) throw naoEncontrado();
    return v;
  }

  async apoio(s: SessaoOrcamento, codigos: CodigosOrcamento, ligada: boolean): Promise<ApoioOrcamento> {
    const a = await this.porta.apoio(ctx(s));
    return {
      naturezas: NATUREZAS_ORCAMENTO.map((codigo) => ({
        codigo,
        rotulo: ROTULOS_NATUREZA_ORCAMENTO[codigo],
        descricao: DESCRICOES_NATUREZA_ORCAMENTO[codigo],
      })),
      centros: a.centros,
      itens: a.itens,
      parametros: a.parametros,
      chaveLigada: ligada,
      acoes: { editar: ligada && s.pode(codigos.editar), aprovar: ligada && s.pode(codigos.aprovar) },
    };
  }

  versoes(s: SessaoOrcamento, ano: number | null): Promise<OrcamentoVersao[]> {
    return this.porta.versoes(ctx(s), ano);
  }

  async detalhe(
    s: SessaoOrcamento,
    id: number,
    codigos: CodigosOrcamento,
    ligada: boolean,
  ): Promise<OrcamentoDetalhe> {
    const orcamento = await this.versaoOu404(s, id);
    const linhas = await this.porta.linhas(ctx(s), id);
    const rascunho = orcamento.situacao === 'rascunho';
    const motivo = motivoSemAprovar(orcamento, s.login);
    const podeAprovar = ligada && s.pode(codigos.aprovar);
    return {
      orcamento,
      linhas,
      acoes: {
        editar: ligada && rascunho && s.pode(codigos.editar),
        aprovar: podeAprovar && motivo === null,
        descartar: ligada && rascunho && s.pode(codigos.editar),
        motivoSemAprovar: !ligada
          ? 'O orçamento empresarial ainda não foi liberado neste estabelecimento.'
          : !s.pode(codigos.aprovar)
            ? 'Você não tem a permissão de aprovar o orçamento.'
            : motivo,
      },
    };
  }

  /** O realizado do ano na chave do orçamento (centro pelo ID; documento com rateio repartido). */
  private realizadoNaChave(r: RealizadoAnoLido, centros: ReadonlyMap<number, CentroOrcamento>) {
    const porCodigo = new Map([...centros.values()].map((c) => [c.codigo, c.id]));
    return converterRealizado(r.agregado, r.rateados, (cod) => porCodigo.get(cod) ?? null);
  }

  private validar(linhas: readonly ChaveLinhaOrcamento[], c: Cadastros): void {
    const problemas = validarLinhas(linhas, {
      centros: new Set(c.centros.keys()),
      itens: new Map([...c.itens].map(([k, i]) => [k, i.natureza])),
    });
    if (problemas.length)
      throw new ErroProblema('entrada-invalida', 400, 'Linhas inválidas', problemas[0]!.mensagem, {
        campos: problemas.slice(0, 20).map((p) => `linhas.${p.indice}`),
        bloqueios: problemas.slice(0, 20).map((p) => `Linha ${p.indice + 1}: ${p.mensagem}`),
      });
  }

  async criar(
    s: SessaoOrcamento,
    x: CriarVersaoOrcamento,
    eventos: EventosOrcamento,
  ): Promise<{ id: number; numero: number; linhas: number; descartadas: number }> {
    const c = await this.cadastros(s);
    if (!c.apoio.empresas.includes(x.empresa))
      throw recusa(
        'empresa-inexistente',
        'Empresa inexistente',
        `A empresa ${x.empresa} não está cadastrada neste estabelecimento.`,
      );
    let linhas: LinhaOrcamentoEntrada[] = [];
    let base = 'vazio';
    if (x.base.tipo === 'versao') {
      const origem = await this.versaoOu404(s, x.base.id);
      if (origem.empresa !== x.empresa)
        throw recusa('empresa-diferente', 'Versão de outra empresa', 'Copie uma versão da mesma empresa.');
      linhas = (await this.porta.linhas(ctx(s), origem.id)).map((l) => ({
        centro: l.centro,
        natureza: l.natureza,
        grupo: l.grupo,
        subgrupo: l.subgrupo,
        item: l.item,
        meses: [...l.meses],
        observacao: l.observacao,
      }));
      base = `cópia de ${origem.ano} v${origem.numero}`;
    } else if (x.base.tipo === 'realizado') {
      const r = this.realizadoNaChave(await this.porta.realizado(ctx(s), x.empresa, x.ano - 1), c.centros);
      linhas = gerarDoRealizado(r.realizado, x.base.ajusteCentesimos);
      const sinal = x.base.ajusteCentesimos >= 0 ? '+' : '-';
      base = `realizado de ${x.ano - 1} ${sinal}${(Math.abs(x.base.ajusteCentesimos) / 100).toFixed(2).replace('.', ',')}%`;
    }
    // A cópia e o realizado trazem só o que ainda está no cadastro (item ou centro que saiu fica de fora, contado).
    const validas = linhas.filter(
      (l) =>
        validarLinhas([l], {
          centros: new Set(c.centros.keys()),
          itens: new Map([...c.itens].map(([k, i]) => [k, i.natureza])),
        }).length === 0,
    );
    const descartadas = linhas.length - validas.length;
    if (validas.length > TETO_LINHAS_ORCAMENTO)
      throw recusa('limite', 'Versão grande demais', `A base tem mais de ${TETO_LINHAS_ORCAMENTO} linhas.`);
    const r = await gravando(() =>
      this.porta.criar(
        ctx(s),
        { empresa: x.empresa, ano: x.ano, descricao: x.descricao, base, linhas: validas },
        s.login,
        s.trilha(
          eventos.criado,
          'incluir',
          'SGH_ORC_ORCAMENTO',
          null,
          `${x.ano}:${base}:${validas.length} linhas`,
        ),
      ),
    );
    return { ...r, descartadas };
  }

  async gravarLinhas(
    s: SessaoOrcamento,
    id: number,
    x: GravarLinhasOrcamento,
    eventos: EventosOrcamento,
  ): Promise<{
    versao: number;
    mudou: boolean;
    incluidas: number;
    alteradas: number;
    removidas: number;
    totalAntes: number;
    totalDepois: number;
  }> {
    const v = await this.versaoOu404(s, id);
    if (v.situacao !== 'rascunho')
      throw recusa(
        'nao-editavel',
        'Versão fechada',
        'Só a versão em elaboração recebe valores; crie uma versão nova.',
      );
    if (v.versao !== x.versao)
      throw recusa(
        'desatualizado',
        'Operação recusada',
        'O orçamento mudou depois que você abriu (outra pessoa gravou). Abra de novo para ver a versão atual.',
      );
    this.validar(x.linhas, await this.cadastros(s));
    let plano;
    try {
      plano = planejarGravacao(await this.porta.linhas(ctx(s), id), x.linhas);
    } catch (e) {
      if (e instanceof RangeError)
        throw new ErroProblema('entrada-invalida', 400, 'Versão grande demais', e.message);
      throw e;
    }
    const resumo = {
      incluidas: plano.incluir.length,
      alteradas: plano.alterar.length,
      removidas: plano.remover.length,
      totalAntes: plano.totalAntes,
      totalDepois: plano.totalDepois,
    };
    if (!plano.incluir.length && !plano.alterar.length && !plano.remover.length)
      return { versao: v.versao, mudou: false, ...resumo };
    const r = await gravando(() =>
      this.porta.gravarLinhas(
        ctx(s),
        id,
        x.versao,
        { incluir: plano.incluir, alterar: plano.alterar, remover: plano.remover },
        s.login,
        s.trilha(
          eventos.linhas,
          'alterar',
          'SGH_ORC_LINHA',
          id,
          `+${resumo.incluidas} ~${resumo.alteradas} -${resumo.removidas}; total ${formatoReais(plano.totalAntes)} -> ${formatoReais(plano.totalDepois)}`,
        ),
      ),
    );
    return { versao: r.versao, mudou: true, ...resumo };
  }

  async aprovar(
    s: SessaoOrcamento,
    id: number,
    x: AprovarOrcamento,
    eventos: EventosOrcamento,
  ): Promise<{ substituida: number | null }> {
    const v = await this.versaoOu404(s, id);
    if (v.versao !== x.versao)
      throw recusa(
        'desatualizado',
        'Operação recusada',
        'O orçamento mudou depois que você abriu. Abra de novo para ver a versão atual.',
      );
    const motivo = motivoSemAprovar(v, s.login);
    if (motivo)
      throw recusa(
        v.situacao !== 'rascunho' ? 'nao-editavel' : v.linhas === 0 ? 'sem-linhas' : 'segregacao',
        'Aprovação recusada',
        motivo,
      );
    return gravando(() =>
      this.porta.aprovar(
        ctx(s),
        { id, versao: x.versao, empresa: v.empresa, ano: v.ano },
        x.observacao,
        s.login,
        s.trilha(eventos.aprovado, 'alterar', 'SGH_ORC_ORCAMENTO', id, `${v.ano} v${v.numero}`),
      ),
    );
  }

  async descartar(
    s: SessaoOrcamento,
    id: number,
    x: DescartarOrcamento,
    eventos: EventosOrcamento,
  ): Promise<void> {
    const v = await this.versaoOu404(s, id);
    if (v.situacao !== 'rascunho')
      throw recusa('nao-editavel', 'Versão fechada', 'Só a versão em elaboração pode ser descartada.');
    await gravando(() =>
      this.porta.descartar(
        ctx(s),
        id,
        x.versao,
        x.motivo,
        s.login,
        s.trilha(eventos.descartado, 'alterar', 'SGH_ORC_ORCAMENTO', id, `${v.ano} v${v.numero}`),
      ),
    );
  }

  async comparativo(
    s: SessaoOrcamento,
    id: number,
    q: ConsultaComparativo,
    agora: Date = new Date(),
  ): Promise<ComparativoOrcamento> {
    const orcamento = await this.versaoOu404(s, id);
    const [linhas, c, bruto] = await Promise.all([
      this.porta.linhas(ctx(s), id),
      this.cadastros(s),
      this.porta.realizado(ctx(s), orcamento.empresa, orcamento.ano),
    ]);
    const conv = this.realizadoNaChave(bruto, c.centros);
    const mesAte = q.mesAte ?? MESES_ORCAMENTO;
    const centro = q.centro ?? null;
    const item = q.item ?? null;
    const recorte = recortar(linhas as LinhaOrcamento[], conv.realizado as RealizadoOrcamentoLido[], {
      centro,
      item,
    });
    const r = comparar({
      linhas: recorte.linhas,
      realizado: recorte.realizado,
      mesAte,
      visao: q.visao,
      rotulos: { centro: (x) => rotuloCentro(c.centros, x), item: (k) => rotuloItem(c.itens, k) },
    });
    const avisos: string[] = [];
    const ano = agora.getUTCFullYear();
    if (orcamento.ano >= ano)
      avisos.push(
        bruto.ultimoMovimento
          ? `O realizado do ano ainda está aberto: o último movimento lido é de ${bruto.ultimoMovimento.split('-').reverse().join('/')}.`
          : 'Ainda não há realizado lançado para este ano.',
      );
    if (centro !== null || item !== null)
      avisos.push(
        `Recorte aplicado (${[
          centro !== null ? `centro ${rotuloCentro(c.centros, centro)}` : null,
          item !== null ? `item ${item}` : null,
        ]
          .filter(Boolean)
          .join(', ')}): os totais e as parcelas são só os do recorte.`,
      );
    // O consumo de estoque é do estabelecimento (GEKONCDC não tem empresa; D-CONSUMO-EMPRESA-547).
    if (c.apoio.empresas.length > 1 && r.linhas.some((l) => l.natureza === 'consumo'))
      avisos.push(
        'O consumo de estoque não se separa por empresa: o realizado do consumo é o do estabelecimento inteiro.',
      );
    // Sem recorte, o realizado sem rateio do ano; com recorte, só o do recorte que caiu no "sem centro".
    const semCentro =
      centro === null && item === null
        ? conv.semCentro
        : recorte.realizado.reduce(
            (a, x) =>
              x.centro === CENTRO_SEM_CENTRO_ORCAMENTO && x.natureza !== 'consumo'
                ? { ...a, [x.natureza]: a[x.natureza] + x.centavos }
                : a,
            { despesa: 0, receita: 0 },
          );
    if (semCentro.despesa || semCentro.receita)
      avisos.push(
        `Realizado sem rateio por centro de custo (despesa R$ ${formatoReais(semCentro.despesa)}, receita R$ ${formatoReais(semCentro.receita)}): aparece em "${ROTULO_SEM_CENTRO}".`,
      );
    if (conv.rateioIncompleto)
      avisos.push(
        `${conv.rateioIncompleto} documento(s) com rateio que não fecha 100%: a sobra ficou sem centro.`,
      );
    if (conv.centroSemCadastro)
      avisos.push(
        `${conv.centroSemCadastro} grupo(s) do realizado com centro de custo fora do cadastro: ficaram sem centro.`,
      );
    if (
      r.linhas.some(
        (l) =>
          l.natureza !== 'consumo' &&
          !c.itens.has(chaveDoItem(l.grupo, l.subgrupo, l.item)) &&
          q.visao !== 'centro',
      )
    )
      avisos.push('Há realizado em item gerencial sem cadastro (marcado "sem cadastro").');
    return {
      orcamento,
      mesAte,
      visao: q.visao,
      centro,
      item,
      linhas: r.linhas,
      totais: r.totais,
      realizadoSemCentroCentavos: semCentro,
      avisos,
      lidoEm: agora.toISOString(),
    };
  }
}
