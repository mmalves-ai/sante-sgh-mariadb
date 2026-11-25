// Serviço do M12 (as duas fontes): monta o contrato em abas, as grades de preço com a vigência na data, a
// proposta de reajuste (@sgh/dominio-preco) e a gravação em partes de até 200 itens pelo executor, o desfazer
// do lote, a consulta de valor vigente com a explicação do modelo, a importação versionada (preparar, validar,
// comparar, aprovar como reajuste por arquivo, rejeitar) e o saneamento. Nenhum nome de tabela ou coluna sai na
// resposta (as abas levam a chave de negócio do campo).
import { createHash } from 'node:crypto';
import {
  type AbaContratoDescrita,
  ABAS_CONTRATO,
  ABAS_EDITAVEIS,
  CAMPOS_CONTRATO,
  type CampoContratoDescrito,
  type ContratoConvenio,
  type ConvenioResumo,
  type EstadoOperacao,
  ITENS_POR_TRANSACAO,
  type ItemHonorario,
  type PropostaReajusteResposta,
  type TabelaPreco,
  TABELAS_COM_PERCENTUAL,
  type ValorVigente,
  type VigenciasValor,
} from '@sgh/contratos';
import {
  buscarPorPalavra,
  compararComVigente,
  type Componentes,
  type Confirmacao,
  convenioAceitaAtendimento,
  conveniosDaTabela,
  fatiar,
  lerArquivoPreco,
  modeloDaTabela,
  modeloDoItem,
  motivoDataSuspeita,
  type PedidoReajuste,
  proporReajuste,
  tabelaCompartilhada,
  totalComponentes,
  vigenteEm,
  resolverIndices,
  totalDoHonorario,
} from '@sgh/dominio-preco';
import {
  campoDeConsulta,
  COLUNA_DO_CAMPO,
  COLUNAS_CONSTANTES,
  COLUNAS_VISIVEIS,
  ROTULOS_CONSULTA,
} from './campos-contrato.js';
import type { ConvenioPreco, ItemParaReajuste, LinhaPreparada } from './tipos.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoPreco } from './base.js';
import { type CacheConfig, TTL_CONVENIOS_S } from '../config/public-api.js';
import type { ContextoGravacaoPreco, CtxPrecos, FontePrecos } from './fonte.js';

const TITULOS: Readonly<Record<(typeof ABAS_CONTRATO)[number], string>> = {
  cadastro: 'Cadastro',
  tabelas: 'Tabelas e índices',
  modificadores: 'Modificadores',
  faturabilidade: 'Faturabilidade e elegibilidade',
  pacotes: 'Pacotes',
  tiss: 'TISS, guias e glosa',
  financeiro: 'Financeiro',
};

const ROTULO_INDICE: Readonly<Record<string, string>> = {
  '1': 'CH padrão',
  '2': 'CH padrão (2)',
  '4': 'Filme (m²)',
  '5': 'UCO',
};

export function resumoDoConvenio(c: ConvenioPreco): ConvenioResumo {
  return {
    codigo: c.codigo,
    nome: c.nome,
    situacao: c.situacao,
    aceitaAtendimento: convenioAceitaAtendimento({ codigo: c.codigo, situacao: c.situacao }),
    classificacao: c.classificacaoNome,
    registroAns: c.registroAns,
    tabelas: {
      honorariosInternacao: c.honorariosInternacao,
      honorariosExterna: c.honorariosExterna,
      diarias: c.diarias,
      matmed: c.matmed,
    },
  };
}

const COLUNA_PARA_CAMPO = new Map(Object.entries(COLUNA_DO_CAMPO).map(([campo, col]) => [col, campo]));

/** O lote de uma gravação vem da Idempotency-Key: repetir o pedido dá o mesmo lote (e a mesma entrada). */
export function loteDaChave(chave: string): string {
  return `L${createHash('sha256').update(chave).digest('hex').slice(0, 24)}`;
}

export interface PedidoProposta {
  readonly data: string | null;
  readonly codigos: readonly number[] | null;
  readonly percentual: number | null;
  readonly valores: readonly { readonly codigo: number; readonly ch: number }[] | null;
  readonly arquivo?: ReadonlyMap<number, Partial<Componentes> & { readonly ch: number }>;
}

export class ServicoPrecos {
  private readonly cacheTabelas = new Map<string, { quando: number; valor: TabelaPreco[] }>();
  /**
   * `cache`: o armazém compartilhado (Valkey) da lista de convênios da busca por palavra (ficha, seção 4),
   * só com a fonte do banco; invalidado depois do commit da situação e do contrato. O cache nunca decide
   * gravação: a proposta de reajuste e as operações releem o banco.
   */
  constructor(
    private readonly fonte: FontePrecos,
    private readonly cache: CacheConfig | null = null,
  ) {}

  private conveniosDaBusca(c: CtxPrecos): Promise<ConvenioPreco[]> {
    if (!this.cache || this.fonte.destino !== 'banco') return this.fonte.convenios(c);
    return this.cache.lerOuCarregar(this.cache.chave(c.rede, c.hospital, 'convenios'), TTL_CONVENIOS_S, () =>
      this.fonte.convenios(c),
    );
  }

  get destino() {
    return this.fonte.destino;
  }

  estado(op: string, hospital: string): EstadoOperacao | null {
    return this.fonte.estado(op, hospital);
  }

  async listarConvenios(
    c: CtxPrecos,
    f: { busca: string; situacao: 'todos' | 'ativos' | 'suspensos' },
    escopo: readonly string[] | null,
  ): Promise<ConvenioResumo[]> {
    let lista = await this.conveniosDaBusca(c);
    if (escopo) lista = lista.filter((x) => escopo.includes(String(x.codigo)));
    if (f.situacao === 'ativos') lista = lista.filter((x) => x.situacao === 'A');
    if (f.situacao === 'suspensos') lista = lista.filter((x) => x.situacao !== 'A');
    return buscarPorPalavra(
      lista,
      f.busca,
      (x) => x.nome,
      (x) => x.codigo,
    ).map(resumoDoConvenio);
  }

  async contrato(
    c: CtxPrecos,
    cod: number,
    pode: { alterarSituacao: boolean; editarContrato: boolean },
  ): Promise<ContratoConvenio | null> {
    const conv = await this.fonte.convenio(c, cod);
    const valores = await this.fonte.valoresContrato(c, cod);
    if (!conv || !valores) return null;
    const [opcoesClassificacao, vigencias, indices, tiss, historico, planos, hoje] = await Promise.all([
      this.fonte.opcoesClassificacao(c),
      this.fonte.vigenciasTabelas(c, cod),
      this.fonte.indicesConvenio(c, cod),
      this.fonte.tiss(c, cod),
      this.fonte.historico(c, cod),
      this.fonte.planos(c, cod),
      this.fonte.hoje(c),
    ]);
    const editavel = this.fonte.gravacao.permitida && pode.editarContrato;
    const campo = (
      col: string,
      tema: number,
      aConfirmar: boolean,
      decimal: boolean,
    ): CampoContratoDescrito => {
      const publico = COLUNA_PARA_CAMPO.get(col);
      const def = publico ? CAMPOS_CONTRATO.find((x) => x.campo === publico) : undefined;
      const v = valores[col] ?? null;
      if (def)
        return {
          campo: def.campo,
          rotulo: def.rotulo,
          codigoLegado: null,
          tema,
          valor: v,
          editavel: editavel && !aConfirmar,
          aConfirmar,
          tipo: def.tipo,
          ...(def.maxBytes !== undefined ? { maxBytes: def.maxBytes } : {}),
          ...(def.minimo !== undefined ? { minimo: def.minimo } : {}),
          ...(def.maximo !== undefined ? { maximo: def.maximo } : {}),
          ...(def.opcoes ? { opcoes: [...def.opcoes] } : def.opcoesDe ? { opcoes: opcoesClassificacao } : {}),
          ...(def.obrigatorio ? { obrigatorio: true } : {}),
        };
      return {
        campo: campoDeConsulta(col),
        rotulo: ROTULOS_CONSULTA[col] ?? col,
        codigoLegado: col,
        tema,
        valor: v,
        editavel: false,
        aConfirmar,
        tipo: typeof v === 'number' ? (decimal ? 'decimal' : 'inteiro') : 'texto',
      };
    };
    const abas: AbaContratoDescrita[] = ABAS_CONTRATO.map((id) => ({
      id,
      titulo: TITULOS[id],
      editavel: editavel && ABAS_EDITAVEIS.includes(id),
      campos: COLUNAS_VISIVEIS.filter((x) => x.aba === id)
        .sort(
          (a, b) =>
            a.tema - b.tema || (a.campo ? 0 : 1) - (b.campo ? 0 : 1) || a.coluna.localeCompare(b.coluna),
        )
        .map((x) => campo(x.coluna, x.tema, x.aConfirmar, x.decimal)),
    }));
    const porChave = new Map<string, { data: string }[]>();
    for (const i of indices)
      porChave.set(`${i.tipo}|${i.chave}`, [...(porChave.get(`${i.tipo}|${i.chave}`) ?? []), i]);
    return {
      codigo: conv.codigo,
      nome: conv.nome,
      situacao: conv.situacao,
      aceitaAtendimento: convenioAceitaAtendimento({ codigo: conv.codigo, situacao: conv.situacao }),
      abas,
      constantesOcultas: COLUNAS_CONSTANTES.length,
      planos: planos ?? [],
      // O contrato da tela ainda pede o fim em texto (pedido de contrato: fim nulo enquanto vigente).
      vigencias: vigencias.map((v) => ({
        ...v,
        fim: v.fim ?? '',
        vigente: v.inicio <= hoje && (v.fim === null || hoje <= v.fim),
      })),
      indices: indices.map((i) => ({
        tipo: i.tipo,
        chave: i.chave,
        rotulo:
          i.tipo === 'indice'
            ? (ROTULO_INDICE[i.chave] ?? `CH do setor (ato ${i.chave})`)
            : i.tipo === 'porte'
              ? `Porte ${i.chave}`
              : `Procedimento ${i.chave}`,
        data: i.data,
        valor: i.valor,
        vigente: vigenteEm(porChave.get(`${i.tipo}|${i.chave}`) ?? [], hoje) === (i as { data: string }),
        dataInvalida: motivoDataSuspeita(i.data) !== null,
      })),
      tiss: {
        configurado: tiss.configurado,
        campos: Object.entries(tiss.valores).map(([col, v]) => ({
          campo: campoDeConsulta(col),
          rotulo:
            col === 'COD_CON_TISS'
              ? 'Código do prestador na operadora'
              : col === 'VERSAO_TISS'
                ? 'Versão TISS'
                : col,
          codigoLegado: col,
          tema: 15,
          valor: v,
          editavel: false,
          aConfirmar: false,
          tipo: typeof v === 'number' ? 'inteiro' : 'texto',
        })),
        parametros: tiss.parametros.map((x) => ({ ...x })),
      },
      historicoNome: historico,
      gravacao: {
        situacao: this.fonte.estado('convenio.alterarSituacao', c.hospital),
        contrato: this.fonte.estado('convenio.alterarContrato', c.hospital),
        permitida: this.fonte.gravacao.permitida,
        motivo: this.fonte.gravacao.motivo,
      },
      permissoes: {
        alterarSituacao: pode.alterarSituacao && this.fonte.gravacao.permitida,
        editarContrato: editavel,
      },
      opcoesClassificacao,
    };
  }

  /** Impacto e alertas de suspender ou reativar . */
  async impactoSituacao(c: CtxPrecos, cod: number, operacaoPedida: 'suspender' | 'reativar') {
    const conv = await this.fonte.convenio(c, cod);
    if (!conv) return null;
    const i = await this.fonte.impactoSituacao(c, cod);
    const alvo = operacaoPedida === 'suspender' ? 'I' : 'A';
    const alertas: string[] = [];
    if (operacaoPedida === 'suspender')
      alertas.push(
        `Convênio suspenso não aceita novo atendimento nem agendamento; ele segue em ${i.agendasConsulta} agenda(s) de consulta e ${i.agendasExame} de exame.`,
      );
    if (i.agendamentosFuturos > 0)
      alertas.push(`${i.agendamentosFuturos} agendamento(s) futuro(s) com este convênio continuam marcados.`);
    if (i.contasAbertas > 0)
      alertas.push(`${i.contasAbertas} conta(s) aberta(s) com este convênio: a mudança não as fecha.`);
    if (operacaoPedida === 'reativar')
      alertas.push(`Reativar não refaz os vínculos de profissionais (hoje: ${i.profissionais}).`);
    alertas.push('Quem mudou a situação fica registrado na trilha e no histórico do convênio.');
    const dthOk =
      i.diariaAcompanhante === null ||
      !(
        (i.diariaAcompanhante.tipo !== null && i.diariaAcompanhante.tipo !== 1) ||
        (i.diariaAcompanhante.subtipo !== null && i.diariaAcompanhante.subtipo !== 5)
      );
    return {
      convenio: conv.codigo,
      nome: conv.nome,
      operacao: operacaoPedida,
      situacaoAtual: conv.situacao,
      situacaoDepois: alvo,
      impacto: {
        agendasConsulta: i.agendasConsulta,
        agendasExame: i.agendasExame,
        agendamentosFuturos: i.agendamentosFuturos,
        contasAbertas: i.contasAbertas,
        profissionais: i.profissionais,
      },
      alertas,
      recusa: dthOk
        ? conv.situacao === alvo
          ? 'O convênio já está nessa situação.'
          : null
        : 'O convênio aponta uma diária de acompanhante que não é diária/acompanhante (tipo 1, subtipo 5): o banco recusa qualquer alteração dele. Corrija a diária de acompanhante antes.',
    };
  }

  /**
   * Tabelas com os convênios que as usam. `escopo` (da sessão): a lista `convenios` de cada tabela
   * sai filtrada pelo escopo da sessão depois do cache (o cache é do estabelecimento, não da sessão).
   */
  async tabelas(
    c: CtxPrecos,
    tipo: 'honorarios' | 'diarias' | 'matmed',
    escopo: readonly string[] | null = null,
  ): Promise<TabelaPreco[]> {
    const todas = await this.tabelasDoEstabelecimento(c, tipo);
    if (!escopo) return todas;
    return todas.map((t) => ({
      ...t,
      convenios: t.convenios.filter((u) => escopo.includes(String(u.codigo))),
    }));
  }

  private async tabelasDoEstabelecimento(
    c: CtxPrecos,
    tipo: 'honorarios' | 'diarias' | 'matmed',
  ): Promise<TabelaPreco[]> {
    const k = `${c.hospital}|${tipo}`;
    const cache = this.cacheTabelas.get(k);
    if (cache && Date.now() - cache.quando < 300_000) return cache.valor;
    const [cab, convs, perfis] = await Promise.all([
      this.fonte.cabecalhos(c, tipo),
      this.fonte.convenios(c),
      tipo === 'honorarios' ? this.fonte.perfisHonorario(c) : Promise.resolve(new Map()),
    ]);
    const base = convs.map((x) => ({
      codigo: x.codigo,
      nome: x.nome,
      ativo: x.situacao === 'A',
      honorariosInternacao: x.honorariosInternacao,
      honorariosExterna: x.honorariosExterna,
      diarias: x.diarias,
      matmed: x.matmed,
    }));
    const valor = cab.map((t) => {
      const usos = conveniosDaTabela(t.codigo, base, tipo);
      const perfil = perfis.get(t.codigo);
      return {
        tipo,
        codigo: t.codigo,
        nome: t.nome,
        situacao: t.situacao,
        modelo: tipo === 'honorarios' ? modeloDaTabela(perfil ?? { itens: 0, comCh: 0, comPorte: 0 }) : null,
        compartilhada:
          tipo === 'honorarios'
            ? tabelaCompartilhada(t.codigo, usos)
            : usos.filter((u) => u.ativo).length > 1,
        comPercentual: tipo === 'honorarios' && TABELAS_COM_PERCENTUAL.includes(t.codigo),
        convenios: usos.map((u) => ({ ...u, usos: [...u.usos] })),
      };
    });
    this.cacheTabelas.set(k, { quando: Date.now(), valor });
    return valor;
  }

  invalidarTabelas(): void {
    this.cacheTabelas.clear();
  }

  /** Depois do commit da situação ou do contrato: o cache das tabelas e o da lista de convênios (Valkey). */
  async invalidarConvenios(c: CtxPrecos, commitEm: number): Promise<void> {
    this.cacheTabelas.clear();
    if (this.cache) await this.cache.invalidar(c.rede, c.hospital, ['convenios'], commitEm);
  }

  async honorarios(
    c: CtxPrecos,
    tab: number,
    f: { busca: string; pagina: number; porPagina: number; data: string | null },
  ) {
    const data = f.data ?? (await this.fonte.hoje(c));
    const r = await this.fonte.itensHonorario(c, tab, {
      busca: f.busca,
      pagina: f.pagina,
      porPagina: f.porPagina,
      data,
    });
    const itens: ItemHonorario[] = r.itens.map((i) => ({
      codigo: i.codigo,
      nome: i.nome,
      situacao: i.situacao,
      ch: i.ch,
      porte: i.porte,
      modelo: modeloDoItem(i),
      vigencia: i.vigencia,
      valores: i.valores,
      total: i.valores ? totalComponentes(i.valores) : null,
      vigencias: i.vigencias,
      futura: i.ultimaData && i.ultimaData > data ? i.ultimaData : null,
    }));
    return {
      itens,
      total: r.total,
      pagina: f.pagina,
      porPagina: f.porPagina,
      dataBase: data,
      truncada: false,
    };
  }

  async vigencias(c: CtxPrecos, tab: number, cod: number) {
    const hoje = await this.fonte.hoje(c);
    const item = await this.fonte.itemHonorario(c, tab, cod, hoje);
    if (!item) return null;
    const [vig, aut] = await Promise.all([
      this.fonte.vigenciasDoItem(c, tab, cod),
      this.fonte.autoriaDoItem(c, tab, cod),
    ]);
    const atual = vigenteEm(vig, hoje);
    return {
      tabela: tab,
      codigo: cod,
      nome: item.nome,
      vigencias: vig.map((v) => {
        const a = (aut ?? []).find((x) => x.data === v.data) ?? null;
        return {
          data: v.data,
          valores: v.valores,
          total: totalComponentes(v.valores),
          vigente: v === atual,
          futura: v.data > hoje,
          autoria: a ? { autor: a.autor, quando: a.quando, origem: a.origem, lote: a.lote } : null,
        };
      }),
    };
  }

  /** Vigências da diária/taxa  ou do mat/med: a linha do tempo do item. */
  async vigenciasValor(
    c: CtxPrecos,
    tipo: 'diaria' | 'matmed',
    tab: number,
    cod: number,
  ): Promise<VigenciasValor | null> {
    const hoje = await this.fonte.hoje(c);
    const item =
      tipo === 'diaria'
        ? await this.fonte.itemDiaria(c, tab, cod, hoje)
        : await this.fonte.itemMatmed(c, tab, cod, hoje);
    if (!item) return null;
    const vig =
      tipo === 'diaria'
        ? await this.fonte.vigenciasDiaria(c, tab, cod)
        : await this.fonte.vigenciasMatmed(c, tab, cod);
    const atual = vig.filter((v) => v.data <= hoje).sort((a, b) => (a.data < b.data ? 1 : -1))[0] ?? null;
    return {
      tipo,
      tabela: tab,
      codigo: cod,
      nome: item.nome,
      vigencias: vig.map((v) => ({
        data: v.data,
        valor: v.valor,
        pmc: v.pmc ?? null,
        pf: v.pf ?? null,
        edicao: v.edicao ?? null,
        vigente: v === atual,
        futura: v.data > hoje,
      })),
    };
  }

  /** Proposta de reajuste (nada é gravado). */
  async proposta(c: CtxPrecos, tab: number, p: PedidoProposta): Promise<PropostaReajusteResposta> {
    const hoje = await this.fonte.hoje(c);
    const data = p.data ?? hoje;
    const codigos = p.valores
      ? p.valores.map((v) => v.codigo)
      : p.arquivo
        ? [...p.arquivo.keys()]
        : p.codigos;
    const itens: ItemParaReajuste[] = await this.fonte.itensParaReajuste(c, tab, codigos, data, 6000);
    const pedido: PedidoReajuste = p.arquivo
      ? { modo: 'arquivo', valores: p.arquivo }
      : p.valores
        ? { modo: 'valor', valores: new Map(p.valores.map((v) => [v.codigo, v.ch])) }
        : { modo: 'percentual', percentual: p.percentual ?? NaN };
    const convs = await this.fonte.convenios(c);
    const usos = conveniosDaTabela(
      tab,
      convs.map((x) => ({
        codigo: x.codigo,
        nome: x.nome,
        ativo: x.situacao === 'A',
        honorariosInternacao: x.honorariosInternacao,
        honorariosExterna: x.honorariosExterna,
      })),
    );
    const prop = proporReajuste(
      itens.map((i) => ({
        codigo: i.codigo,
        nome: i.nome,
        situacao: i.situacao,
        ch: i.ch,
        vigencia: i.vigencia,
        valores: i.valores,
        ultimaData: i.ultimaData,
        temNaData: i.temNaData,
      })),
      pedido,
      { tabela: tab, data, hoje, convenios: usos },
    );
    const resposta: PropostaReajusteResposta = {
      tabela: prop.tabela,
      data: prop.data,
      hoje,
      linhas: prop.linhas.map((l) => ({ ...l })),
      vetos: prop.vetos.map((v) => ({ ...v, itens: [...v.itens] })),
      alertas: prop.alertas.map((a) => ({ ...a })),
      confirmacoes: [...prop.confirmacoes],
      resumo: { ...prop.resumo },
    };
    if (codigos) {
      const achados = new Set(itens.map((i) => i.codigo));
      const faltam = codigos.filter((x) => !achados.has(x));
      if (faltam.length)
        resposta.vetos.push({
          codigo: 'item-inexistente',
          mensagem: `${faltam.length} item(ns) não existem na tabela (${faltam.slice(0, 5).join(', ')}): item novo de tabela não é publicado: a inclusão de item ainda não está disponível no sistema novo.`,
          itens: [...faltam],
        });
    }
    return resposta;
  }

  /** Grava a proposta (recalculada no servidor) em partes de até 200 itens pelo executor. */
  async aplicarReajuste(
    c: CtxPrecos,
    ctxOp: ContextoGravacaoPreco,
    tab: number,
    p: PedidoProposta,
    confirmacoes: Readonly<Partial<Record<Confirmacao, boolean | undefined>>>,
    justificativa: string,
    origem: 'reajuste' | 'importacao',
    carga: number | null,
  ): Promise<{ lote: string; linhas: number; partes: number; proposta: PropostaReajusteResposta }> {
    const prop = await this.proposta(c, tab, p);
    if (prop.vetos.length > 0)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Reajuste recusado',
        prop.vetos.map((v) => v.mensagem).join(' '),
        {
          codigo: prop.vetos[0]?.codigo ?? 'veto',
        },
      );
    const faltam = prop.confirmacoes.filter((x) => confirmacoes[x] !== true);
    if (faltam.length)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Confirmação pendente',
        prop.alertas
          .filter((a) => a.confirmacao && faltam.includes(a.confirmacao))
          .map((a) => a.mensagem)
          .join(' '),
        { codigo: 'confirmacao-pendente' },
      );
    const lote = loteDaChave(ctxOp.chaveIdempotencia);
    const mudam = prop.linhas.filter((l) => l.muda);
    const partes = fatiar(mudam, ITENS_POR_TRANSACAO);
    let linhas = 0;
    for (const [n, parte] of partes.entries()) {
      const r = await this.fonte.executar(
        'preco.reajustar',
        c,
        {
          tabela: tab,
          data: prop.data,
          lote,
          parte: n + 1,
          partes: partes.length,
          modo: p.arquivo ? 'arquivo' : p.valores ? 'valor' : 'percentual',
          percentual: p.arquivo || p.valores ? null : p.percentual,
          origem,
          carga,
          justificativa,
          confirmacoes: {
            tabelaCompartilhada: confirmacoes.tabelaCompartilhada === true,
            percentualTabela: confirmacoes.percentualTabela === true,
          },
          itens: parte.map((l) => ({
            codigo: l.codigo,
            base: l.vigenciaAtual && l.atuais ? { vigencia: l.vigenciaAtual, valores: l.atuais } : null,
            novos: l.novos,
          })),
        },
        { ...ctxOp, chaveIdempotencia: `${ctxOp.chaveIdempotencia}:p${n + 1}`.slice(0, 80) },
      );
      linhas += Number(r.resultado['linhas'] ?? 0);
    }
    return { lote, linhas, partes: partes.length, proposta: prop };
  }

  /** Desfaz o lote inteiro (todas as partes), pelo executor. */
  async desfazerLote(
    c: CtxPrecos,
    ctxOp: ContextoGravacaoPreco,
    lote: string,
    justificativa: string,
  ): Promise<{ linhas: number; partes: number }> {
    // Só as linhas do lote ainda não desfeitas: um desfazer interrompido entre partes retoma o que falta.
    const linhas = await this.fonte.linhasDoLote(c, lote);
    if (linhas.length === 0) {
      const lotes = await this.fonte.lotes(c, null);
      if ((lotes ?? []).some((l) => l.lote === lote))
        throw new ErroProblema(
          'recusa-de-negocio',
          409,
          'Lote já desfeito',
          'Todos os itens deste lote já foram desfeitos.',
          {
            codigo: 'sem-efeito',
          },
        );
      throw new ErroProblema('nao-encontrado', 404, 'Lote não encontrado');
    }
    const grupos = new Map<string, typeof linhas>();
    for (const l of linhas)
      grupos.set(`${l.tabela}|${l.data}`, [...(grupos.get(`${l.tabela}|${l.data}`) ?? []), l]);
    const fatias = [...grupos.values()].flatMap((g) => fatiar(g, ITENS_POR_TRANSACAO));
    const partes = fatias.map((parte, i) => ({
      tabela: parte[0]?.tabela ?? 0,
      data: parte[0]?.data ?? '',
      lote,
      parte: i + 1,
      partes: fatias.length,
      justificativa,
      itens: parte.map((l) => ({ codigo: l.codigo, valores: l.valores })),
    }));
    // Pré-conferência de TODAS as partes (só leitura) antes da primeira exclusão: um item usado em conta, ou
    // mexido por fora, na parte 3 recusa o lote inteiro, sem deixar o preço metade antigo e metade novo.
    try {
      await this.fonte.preConferirDesfazer(c, partes);
    } catch (e) {
      throw problemaDoPreco(e);
    }
    let total = 0;
    for (const p of partes) {
      const r = await this.fonte.executar('preco.desfazerReajuste', c, p, {
        ...ctxOp,
        chaveIdempotencia: `${ctxOp.chaveIdempotencia}:p${p.parte}`.slice(0, 80),
      });
      total += Number(r.resultado['linhas'] ?? 0);
    }
    return { linhas: total, partes: partes.length };
  }

  /** "Quanto vale este item neste contrato nesta data" (cap-11 §11.3). */
  async valorVigente(
    c: CtxPrecos,
    q: {
      convenio: number;
      tipo: 'honorario' | 'diaria' | 'matmed';
      conta: 'externa' | 'internacao';
      item: number;
      data: string | null;
      /** Setor executante (índice do setor no acordo). */
      setor?: number | null;
      /** Regime de atendimento (padrão TISS) para o índice do setor. */
      regimeAtendimento?: number | null;
      /** Horário especial: o porte anestésico pelo valor do horário especial. */
      horarioEspecial?: boolean;
    },
  ): Promise<ValorVigente | null> {
    const conv = await this.fonte.convenio(c, q.convenio);
    if (!conv) return null;
    // O setor e o regime do lançamento só valem no escopo do estabelecimento da sessão (nunca em silêncio).
    const alvo = { setor: q.setor ?? null, regime: q.regimeAtendimento ?? null };
    if (alvo.setor !== null || alvo.regime !== null) {
      const fora = this.fonte.alvoNoEscopo ? await this.fonte.alvoNoEscopo(c, alvo) : ['setor', 'regime'];
      if (fora.length)
        throw new ErroProblema(
          'entrada-invalida',
          400,
          'Dados inválidos',
          `Fora do estabelecimento ou inexistente: ${fora.join(', ')}.`,
        );
    }
    const data = q.data ?? (await this.fonte.hoje(c));
    const base = {
      convenio: { codigo: conv.codigo, nome: conv.nome, situacao: conv.situacao },
      tipo: q.tipo,
      conta: q.conta,
      dataBase: data,
    };
    if (q.tipo === 'honorario') {
      const tab = q.conta === 'externa' ? conv.honorariosExterna : conv.honorariosInternacao;
      if (tab === null)
        return {
          ...base,
          tabela: null,
          item: null,
          vigencia: null,
          valores: null,
          total: null,
          modelo: null,
          estimativaPeloModelo: null,
          passos: ['Convênio sem tabela de honorários para esta conta.'],
          falta: ['tabela'],
        };
      const i = await this.fonte.itemHonorario(c, tab, q.item, data);
      if (!i)
        return {
          ...base,
          tabela: tab,
          item: null,
          vigencia: null,
          valores: null,
          total: null,
          modelo: null,
          estimativaPeloModelo: null,
          passos: [`Item ${q.item} não existe na tabela ${tab}.`],
          falta: ['item'],
        };
      // O total do item sai do modelo dele (06-FAT linha 5): VALOR pela vigência; CH e PORTE pelo índice do acordo na
      // data × a quantidade do item (o do procedimento vence o do setor, que vence o do acordo), mais o porte
      // anestésico do acordo no regime da conta. Faltando índice, o total é nulo e a falta é dita.
      const acordo = await this.fonte.indicesNaData(c, conv.codigo, data);
      const dif = this.fonte.indicesDiferenciadosNaData
        ? await this.fonte.indicesDiferenciadosNaData(c, conv.codigo, data, {
            itemFaturavel: i.itemFaturavel ?? null,
            setor: q.setor ?? null,
            regimeAtendimento: q.regimeAtendimento ?? null,
          })
        : null;
      const indices = resolverIndices({ acordo, setor: dif?.setor ?? null, item: dif?.item ?? null });
      const porte = i.porte ? await this.fonte.porteNaData(c, conv.codigo, i.porte, data) : null;
      const porteAnestesico =
        i.porteAnestesico && this.fonte.porteAnestesicoNaData
          ? await this.fonte.porteAnestesicoNaData(
              c,
              conv.codigo,
              q.conta === 'internacao' ? 'internacao' : 'ambulatorial',
              i.porteAnestesico,
              data,
            )
          : null;
      const t = totalDoHonorario({
        item: {
          ch: i.ch,
          porte: i.porte,
          fracaoPorte: i.fracaoPorte,
          cope: i.cope,
          filmeM2: i.filmeM2,
          porteAnestesico: i.porteAnestesico ?? null,
        },
        vigente: i.valores,
        indices,
        porte,
        porteAnestesico,
        horarioEspecial: q.horarioEspecial === true,
      });
      return {
        ...base,
        tabela: tab,
        item: { codigo: i.codigo, nome: i.nome },
        vigencia: i.vigencia,
        valores: i.valores,
        total: t.total,
        origemTotal: t.origem,
        modelo: t.modelo,
        estimativaPeloModelo: t.modelo === 'VALOR' ? null : t.total,
        passos: [
          `Tabela ${tab} (${q.conta === 'externa' ? 'conta externa' : 'conta de internação'}); vigência ${i.vigencia ?? 'nenhuma'} (maior data ≤ ${data}).`,
          ...t.passos,
        ],
        falta: [...t.falta],
      };
    }
    if (q.tipo === 'diaria') {
      const tab = conv.diarias;
      const d = tab === null ? null : await this.fonte.itemDiaria(c, tab, q.item, data);
      return {
        ...base,
        tabela: tab,
        item: d ? { codigo: d.operacao, nome: d.nome } : null,
        vigencia: d?.vigencia ?? null,
        valores: null,
        total: d?.valor ?? null,
        modelo: null,
        estimativaPeloModelo: null,
        passos: d
          ? [`Tabela de diárias e taxas ${tab}; vigência ${d.vigencia ?? 'nenhuma'} (maior data ≤ ${data}).`]
          : ['Item de diária ou taxa não encontrado.'],
        falta: d?.valor == null ? ['vigência na data'] : [],
      };
    }
    const tab = conv.matmed;
    const m = tab === null ? null : await this.fonte.itemMatmed(c, tab, q.item, data);
    return {
      ...base,
      tabela: tab,
      item: m ? { codigo: m.codigo, nome: m.nome } : null,
      vigencia: m?.vigencia ?? null,
      valores: null,
      total: m?.valor ?? null,
      modelo: null,
      estimativaPeloModelo: null,
      passos: m
        ? [
            `Tabela de mat/med ${tab}; vigência ${m.vigencia ?? 'nenhuma'}. O valor final passa pela referência (PF/PMC) e pelos percentuais do convênio, calculados no faturamento.`,
          ]
        : ['Item de mat/med não encontrado na tabela do convênio.'],
      falta: m?.valor == null ? ['vigência na data'] : [],
    };
  }

  /** Prepara, valida e compara a importação (nada muda nos preços). */
  async prepararImportacao(
    c: CtxPrecos,
    tab: number,
    nomeArquivo: string,
    conteudo: string,
  ): Promise<{
    situacao: 'preparada' | 'comparada';
    linhas: LinhaPreparada[];
    totais: {
      linhas: number;
      validas: number;
      erros: number;
      novos: number;
      removidos: number;
      alterados: number;
      iguais: number;
    };
    sha256: string;
    bytes: number;
    motivo: string | null;
    nomeArquivo: string;
  }> {
    const bytes = Buffer.byteLength(conteudo, 'utf8');
    const sha256 = createHash('sha256').update(conteudo, 'utf8').digest('hex');
    const lido = lerArquivoPreco(conteudo);
    const linhas: LinhaPreparada[] = lido.erros.map((e) => ({
      linha: e.linha,
      codigo: null,
      valores: null,
      resultado: 'erro' as const,
      comparacao: null,
      motivo: e.motivo,
    }));
    let cmp = { novos: 0, removidos: 0, alterados: 0, iguais: 0 };
    if (lido.erros.length === 0 && lido.linhas.length > 0) {
      const hoje = await this.fonte.hoje(c);
      const doArquivo = await this.fonte.itensParaReajuste(
        c,
        tab,
        lido.linhas.map((l) => l.codigo),
        hoje,
        20000,
      );
      const ativos = await this.fonte.itensParaReajuste(c, tab, null, hoje, 20000);
      const vigentes = new Map([...ativos, ...doArquivo].map((i) => [i.codigo, i]));
      const comparacao = compararComVigente(
        lido.linhas,
        [...vigentes.values()].map((i) => ({
          codigo: i.codigo,
          nome: i.nome,
          situacao: i.situacao,
          valores: i.valores,
        })),
      );
      cmp = comparacao;
      let extra = 1_000_000;
      for (const i of comparacao.itens)
        linhas.push({
          linha: i.linha ?? extra++,
          codigo: i.codigo,
          valores: i.depois ? { ...i.depois } : i.antes ? { ...i.antes } : null,
          // O vigente antes da importação: o aprovador vê de quanto para quanto cada item muda.
          anteriores: i.antes ? { ...i.antes } : null,
          nome: i.nome,
          resultado: 'valida',
          comparacao: i.resultado,
          motivo:
            i.resultado === 'novo'
              ? 'Item fora da tabela: não é publicado (a inclusão de item ainda não está disponível no sistema novo).'
              : i.resultado === 'removido'
                ? 'Item ativo ausente do arquivo: nada muda no sistema novo.'
                : null,
        });
    }
    linhas.sort((a, b) => a.linha - b.linha);
    return {
      situacao: lido.erros.length === 0 && lido.linhas.length > 0 ? 'comparada' : 'preparada',
      linhas,
      totais: {
        linhas: lido.total,
        validas: lido.linhas.length,
        erros: lido.erros.length,
        ...cmp,
      },
      sha256,
      bytes,
      motivo:
        lido.erros.length > 0
          ? `${lido.erros.length} linha(s) com erro: corrija o arquivo e envie de novo.`
          : lido.linhas.length === 0
            ? 'Arquivo sem itens.'
            : null,
      nomeArquivo,
    };
  }
}
