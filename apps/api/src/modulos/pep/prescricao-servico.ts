// Regras da prescrição na API (M24): o contexto do editor (quem prescreve, atendimentos abertos, períodos pela
// regra do horário de medicação da unidade), a verificação de apoio à decisão (alertas versionados com as decisões
// já tomadas e os horários previstos), a montagem da gravação pelo domínio (itens, kit, horários, documento com os
// marcadores, prova) e as leituras (prescrições do atendimento, prescrição com os itens, a prova e as decisões).
// Nada aqui conhece tabela do legado: os dados vêm da porta; as regras, do domínio.
import { createHash } from 'node:crypto';
import {
  esquemaDetalheItem,
  type DetalheItem,
  type AlertaPrescricao,
  categoriaPorOcupacao,
  type CategoriaPrescritor,
  exigeCoassinatura,
  GRUPO_DO_TIPO,
  type IncluirItemEntrada,
  type ItemLido,
  type ItemPrescricao,
  MENSAGENS_PRESCRICAO,
  type PeriodoPrescricao,
  type PrescreverEntrada,
  type PrescricaoLida,
  type PrescricaoResumo,
  SE_NECESSARIO_ADENDO,
  type SituacaoPrescricao,
  TIPOS_ADENDO,
  TIPOS_CORRECAO,
  tipoDoPlano,
  type Verificacao,
} from '@sgh/contratos';
import {
  mlPorHoraDaSigla,
  avaliarAlertas,
  type ContextoAlertas,
  documentoPrescricao,
  ehAltaVigilancia,
  type ItemDocumento,
  type ItemMontado,
  impede,
  itemAvaliado,
  kitQueCasa,
  montarItem,
  periodos,
  type ProdutoAlerta,
  REGRAS_PADRAO,
  type RegraAlerta,
  regraDaUnidade,
  rotuloChecagem,
  situacaoDoItem,
  situacaoVigencia,
  foraDaCategoria,
  ErroMontagem,
  frequencia as frequenciaDe,
  clearanceEstimado,
  renovacaoPendente,
  ANTECEDENCIA_AVISO_HORAS,
  buscarNoIndice,
  type LinhaIndiceBusca,
  montarIndiceBusca,
  TETO_SUGESTOES,
} from '@sgh/dominio-pep';
import { type ContextoOperacao, ErroOperacao } from '@sgh/nucleo';
import type {
  AtendimentoDaPrescricao,
  GravacaoPrescricao,
  InclusaoItem,
  ItemDoIndice,
  ItemPrescricaoLido,
  PrescritorLido,
  ProdutoLido,
  RetratosAtuais,
  SuspensaoItem,
  SuspensaoPrescricao,
} from './tipos-pep.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoPrescricao, PortaPrescricao } from './prescricao-porta.js';

export interface PoliticasPrescricao {
  readonly baseInteracoes: boolean;
  readonly altaVigilancia: ReadonlySet<number>;
  readonly duplaChecagem: boolean;
  readonly criterioDuplicidade: 'medicamento' | 'principio-ativo' | 'ambos';
}

/** O índice de busca no cache: as chaves sem acento e os dados de cada item (JSON). */
export interface IndiceBuscaPrescricao {
  readonly linhas: readonly LinhaIndiceBusca[];
  readonly itens: Readonly<Record<string, ItemDoIndice>>;
}

export interface PrescritorSessao {
  readonly cbo: number;
  readonly ocupacao: string | null;
  readonly nome: string | null;
  readonly categoria: CategoriaPrescritor;
}

const PERFIS_PRODUTO = (
  p: ProdutoLido,
  politicas: Pick<PoliticasPrescricao, 'altaVigilancia'>,
): ProdutoAlerta => ({
  produto: p.produto,
  nome: p.nome,
  principiosAtivos: p.principios.map((x) => x.id),
  padronizado: p.padronizado,
  altoAlerta: ehAltaVigilancia(p.produto, p.potencialmentePerigoso, politicas),
  controlado: p.psicotropico || p.portaria ? (p.portaria ?? '') : null,
  antimicrobiano: p.antimicrobiano,
  // Regra 7: a faixa de dose do cadastro do item (por unidade de prescrição; a única, quando só há uma). A base
  // terceira (dose do dia e ajuste renal) fica para a DP-24.
  ...faixaDoCadastro(p),
  periodoMinimoHoras: p.periodoMinimoHoras,
  viasPermitidas: p.vias,
});

/** A faixa de dose do cadastro do insumo (por unidade de prescrição) no formato do motor: por unidade e, com uma só unidade, a única. */
export function faixaDoCadastro(
  p: Pick<ProdutoLido, 'faixasDose'>,
): Pick<ProdutoAlerta, 'doseMinima' | 'doseMaxima' | 'faixasDose'> {
  const fs = p.faixasDose ?? [];
  const unica = fs.length === 1 ? fs[0]! : null;
  return {
    doseMinima: unica?.minima ?? null,
    doseMaxima: unica?.maxima ?? null,
    faixasDose: new Map(fs.map((f) => [f.unidade.toUpperCase(), { minima: f.minima, maxima: f.maxima }])),
  };
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** O índice de busca no processo vale 5 minutos (o mesmo prazo do cache compartilhado). */
const TTL_INDICE_MS = 300_000;
const hojeDe = (agora: string) => agora.slice(0, 10);

export class ServicoPrescricao {
  constructor(private readonly porta: PortaPrescricao) {}

  get destino(): 'proprio' | 'memoria' {
    return this.porta.destino;
  }

  agora(c: ContextoPrescricao): Promise<string> {
    return this.porta.agora(c);
  }

  /**
   * Cópia do índice de busca no processo (5 minutos, como o cache): vencida, a cópia velha continua servindo enquanto
   * a nova carrega (ninguém espera a recarga; a busca nunca volta ao banco a cada tecla, nem sem o Valkey).
   */
  private readonly indices = new Map<
    string,
    { em: number; indice: Promise<IndiceBuscaPrescricao>; recarga: Promise<unknown> | null }
  >();

  /** O índice de busca do item prescritível (sem acento) com os dados de cada item, do cadastro, para o cache. */
  indiceBusca(c: ContextoPrescricao): Promise<IndiceBuscaPrescricao> {
    const chave = `${c.rede}:${c.hospital}`;
    const carregar = () =>
      this.porta.itensParaIndice(c).then((itens) => ({
        linhas: montarIndiceBusca(itens.map((i) => ({ ...i, principios: i.principios.map((p) => p.nome) }))),
        itens: Object.fromEntries(itens.map((i) => [String(i.produto), i])),
      }));
    const x = this.indices.get(chave);
    if (x && Date.now() - x.em >= TTL_INDICE_MS && !x.recarga) {
      x.recarga = carregar()
        .then((indice) =>
          this.indices.set(chave, { em: Date.now(), indice: Promise.resolve(indice), recarga: null }),
        )
        .catch(() => (x.recarga = null));
    }
    if (x) return x.indice;
    const indice = carregar();
    indice.catch(() => this.indices.delete(chave));
    this.indices.set(chave, { em: Date.now(), indice, recarga: null });
    return indice;
  }

  /** Busca de item prescritível no índice (padronizado primeiro, 30 sugestões): nenhuma leitura do banco. */
  buscarProdutos(termo: string, indice: IndiceBuscaPrescricao): ItemDoIndice[] {
    return buscarNoIndice(indice.linhas, termo, TETO_SUGESTOES)
      .map((id) => indice.itens[String(id)])
      .filter((p): p is ItemDoIndice => p !== undefined);
  }

  podeGravar(c: ContextoPrescricao, op: string, login: string) {
    return this.porta.podeGravar(c, op, login);
  }

  /** O prescritor da sessão: o CBO ativo de categoria que prescreve (o médico primeiro); null sem ocupação. */
  async prescritor(c: ContextoPrescricao, login: string): Promise<PrescritorSessao | null> {
    const cs: PrescritorLido[] = await this.porta.prescritores(c, login);
    if (cs.length === 0) return null;
    const ordem: CategoriaPrescritor[] = [
      'medico',
      'residente',
      'dentista',
      'nutricionista',
      'enfermeiro',
      'outro',
    ];
    const com = cs
      .map((x) => ({ ...x, categoria: categoriaPorOcupacao(x.ocupacao) }))
      .sort((a, b) => ordem.indexOf(a.categoria) - ordem.indexOf(b.categoria));
    const p = com[0]!;
    return { cbo: p.cbo, ocupacao: p.ocupacao, nome: p.nome, categoria: p.categoria };
  }

  /** O atendimento do paciente (404 igual para inexistente e de outro paciente). */
  async atendimento(
    c: ContextoPrescricao,
    paciente: number,
    atendimento: number,
  ): Promise<AtendimentoDaPrescricao> {
    const a = await this.porta.atendimento(c, atendimento);
    if (!a || a.paciente !== paciente)
      throw new ErroProblema('nao-encontrado', 404, 'Atendimento não encontrado');
    return a;
  }

  /**
   * A prescrição e o item ligados a um registro só do novo (ficha de antimicrobiano, reconciliação) são deste
   * atendimento: a prescrição é do atendimento e o item é dela (sem a prescrição, o item é de uma prescrição do
   * atendimento). Senão, 404 igual para inexistente e de outro paciente (como a suspensão do item).
   */
  async conferirLigacao(
    c: ContextoPrescricao,
    atendimento: number,
    prescricao: number | null,
    item: number | null,
  ): Promise<void> {
    if (prescricao === null && item === null) return;
    const naoEncontrado = () => new ErroProblema('nao-encontrado', 404, 'Item da prescrição não encontrado');
    const candidatas =
      prescricao !== null ? [prescricao] : (await this.porta.prescricoes(c, atendimento)).map((p) => p.id);
    if (prescricao !== null) {
      const cab = await this.porta.cabecalho(c, prescricao);
      if (!cab || cab.atendimento !== atendimento) throw naoEncontrado();
    }
    if (item === null) return;
    for (const id of candidatas.slice(0, 200))
      if ((await this.porta.itens(c, id)).some((i) => i.id === item)) return;
    throw naoEncontrado();
  }

  /** A regra do horário de medicação da unidade e os períodos de agora. */
  async vigencias(c: ContextoPrescricao, a: AtendimentoDaPrescricao, agora: string) {
    const { regras, porBloco } = await this.porta.regras(c);
    const regra = regraDaUnidade(regras, porBloco, a.bloco, a.tipo === 'I' ? 'I' : 'E');
    if (!regra)
      throw recusaPrescricao(
        'sem-regra-horario',
        409,
        'Sem regra de horário de medicação',
        'A unidade do atendimento não tem regra de horário de medicação cadastrada (Enfermagem › Horários-padrão de medicação por unidade).',
      );
    const grade = regras.find((r) => r.id === regra.id)?.grade ?? new Map();
    return { regra, grade, ...periodos(regra, agora.slice(0, 16)) };
  }

  async contexto(c: ContextoPrescricao, paciente: number, login: string, agora: string) {
    const prescritor = await this.prescritor(c, login);
    const atendimentos = (await this.porta.atendimentos(c, paciente)).filter((a) => a.saida === null);
    const porAtendimento = [];
    for (const at of atendimentos.slice(0, 10)) {
      const a = await this.porta.atendimento(c, at.id);
      if (!a || !a.aberto) continue;
      const v = await this.vigencias(c, a, agora).catch(() => null);
      const ativas = (await this.porta.prescricoes(c, a.id)).filter((p) => p.suspensaoEm === null);
      const ocupado = (inicio: string, fim: string) =>
        ativas.some((p) => (p.inicio ?? '') <= fim && (p.fim ?? '') >= inicio);
      // Regra 14: a vigente vence em até ANTECEDENCIA_AVISO_HORAS sem prescrição para o período seguinte (paridade
      // com o aviso de planejamento pendente do legado).
      const pendente = renovacaoPendente(
        ativas
          .filter((p) => p.inicio && p.fim)
          .map((p) => ({
            id: p.id,
            atendimento: a.id,
            vigencia: { inicio: p.inicio ?? '', fim: p.fim ?? '' },
            suspensa: false,
          })),
        agora.slice(0, 16),
      );
      porAtendimento.push({
        id: a.id,
        numero: a.numero,
        tipo: a.tipo,
        unidade: at.unidade,
        leito: at.leito,
        renovacaoPendente: pendente
          ? {
              prescricao: pendente.id,
              fim: pendente.vigencia.fim,
              antecedenciaHoras: ANTECEDENCIA_AVISO_HORAS,
            }
          : null,
        periodos: v
          ? {
              atual: { ...v.atual, ocupado: ocupado(v.atual.inicio, v.atual.fim) },
              seguinte: { ...v.seguinte, ocupado: ocupado(v.seguinte.inicio, v.seguinte.fim) },
            }
          : null,
      });
    }
    return {
      dadosClinicos: await this.dadosClinicos(c, paciente, agora),
      prescritor: prescritor
        ? {
            categoria: prescritor.categoria,
            nome: prescritor.nome,
            coassinatura: exigeCoassinatura(prescritor.categoria),
          }
        : null,
      atendimentos: porAtendimento,
      agora,
    };
  }

  /**
   * Peso, altura, idade, sexo e a creatinina mais recente do paciente, com as datas, e o clearance estimado
   * (Cockcroft-Gault) para o cálculo de dose e o ajuste renal (ficha, seção 4; regra 12). Sem o dado, o cálculo pede.
   */
  async dadosClinicos(c: ContextoPrescricao, paciente: number, agora: string) {
    const d = await this.porta.dadosClinicos(c, paciente);
    const idade = d.nascimento ? idadeEmAnos(d.nascimento, agora.slice(0, 10)) : null;
    const clearance = clearanceEstimado({
      pesoKg: d.pesoKg,
      idadeAnos: idade,
      sexo: d.sexo,
      creatinina: d.creatinina,
    });
    return {
      pesoKg: d.pesoKg,
      alturaCm: d.alturaCm,
      dataPeso: d.dataPeso,
      idadeAnos: idade,
      sexo: d.sexo,
      creatinina: d.creatinina,
      dataCreatinina: d.dataCreatinina,
      clearance,
    };
  }

  private async dadosParaAlertas(c: ContextoPrescricao, paciente: number, agora: string) {
    const d = await this.dadosClinicos(c, paciente, agora);
    return { clearance: d.clearance, pesoKg: d.pesoKg };
  }

  /** O contexto dos alertas: alergias, ativos do período, produtos do cadastro, regras, interações, políticas. */
  private async contextoAlertas(
    c: ContextoPrescricao,
    a: AtendimentoDaPrescricao,
    vigencia: { inicio: string; fim: string },
    itens: readonly ItemPrescricao[],
    prescritor: PrescritorSessao,
    politicas: PoliticasPrescricao,
    agora: string,
    exceto: number | null,
  ): Promise<{ ctx: ContextoAlertas; produtos: Map<number, ProdutoAlerta> }> {
    const ativos = await this.porta.produtosAtivos(c, a.id, vigencia.inicio, vigencia.fim, exceto);
    const ids = [
      ...itens.flatMap((i) =>
        i.detalhe.tipo === 'medicamento'
          ? [i.detalhe.item.produto]
          : i.detalhe.tipo === 'solucao'
            ? i.detalhe.componentes.map((x) => x.produto)
            : i.detalhe.tipo === 'glicemia'
              ? i.detalhe.faixas.map((x) => x.produto)
              : [],
      ),
      ...ativos.map((x) => x.produto),
    ];
    const lidos = await this.porta.produtos(c, ids);
    const produtos = new Map(lidos.map((p) => [p.produto, PERFIS_PRODUTO(p, politicas)]));
    const legado = await this.porta.parametrosPrescricao(c);
    const sgh = await this.porta.regrasAlerta(c);
    const regras: RegraAlerta[] = [
      ...REGRAS_PADRAO,
      ...sgh.map((r) => ({
        codigo: r.codigo,
        tipo: r.tipo as RegraAlerta['tipo'],
        nivel: r.nivel,
        versao: r.versao,
        vigenteDesde: r.vigenteDesde,
        ativa: r.ativa,
        descricao: r.descricao,
      })),
    ];
    const principios = [...produtos.values()].flatMap((p) => p.principiosAtivos);
    const interacoes = politicas.baseInteracoes ? await this.porta.interacoes(c, principios) : null;
    const porMed =
      politicas.criterioDuplicidade !== 'principio-ativo' && (legado.porMedicamento || !legado.porPrincipio);
    const porPrinc =
      politicas.criterioDuplicidade !== 'medicamento' && (legado.porPrincipio || !legado.porMedicamento);
    const dietas = itens.filter((i) => GRUPO_DO_TIPO[i.detalhe.tipo] === 'dietas');
    const ctx: ContextoAlertas = {
      alergias: await this.porta.alergias(c, a.paciente),
      ativos: ativos
        .map((x) => produtos.get(x.produto))
        .filter((p): p is ProdutoAlerta => p !== undefined)
        .map((p, k) => ({
          chave: `ativo-${k}`,
          tipo: 'medicamento' as const,
          produtos: [{ produto: p, dose: null, unidade: null }],
          via: null,
          dosesNoPeriodo: 1,
          intervaloHoras: null,
          aCriterio: false,
          seNecessario: null,
          fichaAntimicrobiano: true,
          existente: true,
        })),
      // Regra 12: o dado mais recente do paciente (peso do cadastro e a última creatinina liberada).
      paciente: await this.dadosParaAlertas(c, a.paciente, agora),
      tipoAtendimento: a.tipo === 'I' ? 'I' : 'E',
      alta: false,
      regras,
      interacoes,
      duplicidade: { porMedicamento: porMed, porPrincipio: porPrinc, consistir: legado.consistirDuplicidade },
      altaVigilancia: politicas.altaVigilancia,
      dietaDeOutro:
        dietas.length > 0
          ? await this.porta.dietaDeOutro(c, a.id, vigencia.inicio, vigencia.fim, prescritor.cbo)
          : null,
      ...(this.porta.restricoesAlertas
        ? {
            restricoes: await this.porta.restricoesAlertas(
              c,
              a.paciente,
              a.unidade,
              [...produtos.values()].map((p) => ({ produto: p.produto, principios: p.principiosAtivos })),
            ),
          }
        : {}),
      hoje: hojeDe(agora),
    };
    return { ctx, produtos };
  }

  /** Montagem dos itens (horários, kit, estoque) pelo domínio, com os cadastros da porta. */
  private async montar(
    c: ContextoPrescricao,
    a: AtendimentoDaPrescricao,
    vigencia: { inicio: string; fim: string },
    grade: ReadonlyMap<number, readonly string[]>,
    itens: readonly ItemPrescricao[],
    agora: string,
  ): Promise<ItemMontado[]> {
    const rel = await this.porta.relativos(c);
    const dietas = await this.porta.horariosDieta(c);
    const kits = new Map<number, Awaited<ReturnType<PortaPrescricao['kits']>>>();
    for (const i of itens)
      if (i.detalhe.tipo === 'medicamento' && !kits.has(i.detalhe.item.produto))
        kits.set(i.detalhe.item.produto, await this.porta.kits(c, i.detalhe.item.produto));
    const dominios = await this.porta.dominios(c);
    const primeiro = (k: string) => dominios[k]?.[0]?.id ?? null;
    const ctxM = {
      vigencia,
      agora: agora.slice(0, 16),
      grade,
      relativos: new Map(rel.map((r) => [r.id, r.horario])),
      horariosDieta: (d: number) => dietas.get(d) ?? [],
      kit: (produto: number, via: string, unidade: string, dose: number) =>
        kitQueCasa(kits.get(produto) ?? [], { produto, via, unidade, dose, tipoAtendimento: a.tipo }),
      retratoCid: () => null,
      // Conversão da unidade de velocidade de infusão em mL/h (gotas/min, microgotas/min) pela sigla do cadastro.
      mlPorHora: (u: number) => {
        const x = (dominios['unidadesInfusao'] ?? []).find((o) => String(o.id) === String(u));
        return x ? mlPorHoraDaSigla(String(x.nome)) : null;
      },
    };
    const padroes = {
      unidadeVolume: 'ML',
      unidadePressao: Number(primeiro('unidadesResposta') ?? 0) || null,
      unidadeFio2: Number(primeiro('unidadesResposta') ?? 0) || null,
      tipoInfusaoHemoterapia: Number(primeiro('tiposInfusao') ?? 1) || 1,
      unidadeHemoterapia: 'UN',
    };
    try {
      return itens.map((i) => montarItem(i, ctxM, padroes));
    } catch (e) {
      if (e instanceof ErroMontagem && e.codigo)
        throw new ErroOperacao(422, e.codigo, 'Operação recusada', e.message);
      if (e instanceof ErroMontagem)
        throw new ErroProblema('entrada-invalida', 400, 'Item inválido', e.message);
      throw e;
    }
  }

  /** Verificação de apoio à decisão (sem gravar): alertas, impedimento, horários previstos e vigência. */
  async verificar(
    c: ContextoPrescricao,
    paciente: number,
    entrada: { atendimento: number; periodo: PeriodoPrescricao; itens: readonly ItemPrescricao[] },
    prescritor: PrescritorSessao,
    politicas: PoliticasPrescricao,
  ): Promise<Verificacao> {
    const agora = await this.porta.agora(c);
    const a = await this.atendimento(c, paciente, entrada.atendimento);
    const v = await this.vigencias(c, a, agora);
    const vigencia = entrada.periodo === 'seguinte' ? v.seguinte : v.atual;
    return this.verificarNaVigencia(
      c,
      a,
      vigencia,
      v.grade,
      entrada.itens,
      prescritor,
      politicas,
      agora,
      null,
    );
  }

  private async verificarNaVigencia(
    c: ContextoPrescricao,
    a: AtendimentoDaPrescricao,
    vigencia: { inicio: string; fim: string },
    grade: ReadonlyMap<number, readonly string[]>,
    itens: readonly ItemPrescricao[],
    prescritor: PrescritorSessao,
    politicas: PoliticasPrescricao,
    agora: string,
    exceto: number | null,
  ): Promise<
    Verificacao & {
      montados: ItemMontado[];
      alertasCompletos: AlertaPrescricao[];
      produtos: Map<number, ProdutoAlerta>;
    }
  > {
    const montados = await this.montar(c, a, vigencia, grade, itens, agora);
    const { ctx, produtos } = await this.contextoAlertas(
      c,
      a,
      vigencia,
      itens,
      prescritor,
      politicas,
      agora,
      exceto,
    );
    const alertas = avaliarAlertas({
      itens: itens.map((i) => itemAvaliado(i, produtos)),
      ctx,
      foraDaCategoria: foraDaCategoria(itens, prescritor.categoria),
      dietas: itens.filter((i) => GRUPO_DO_TIPO[i.detalhe.tipo] === 'dietas').map((i) => i.chave),
      decisoes: new Map(itens.map((i) => [i.chave, i.decisoes])),
    });
    const horarios: Record<string, string[]> = {};
    for (const m of montados)
      horarios[m.chave] =
        m.detalhe.tipo === 'solucao'
          ? m.detalhe.etapas.map((e) => e.inicio)
          : m.horarios.map((h) => h.dataHora);
    return {
      alertas,
      impede: impede(alertas).impede,
      horarios,
      vigencia,
      baseInteracoes: ctx.interacoes === null ? 'nao-contratada' : 'contratada',
      montados,
      alertasCompletos: alertas,
      produtos,
    };
  }

  /** Monta a gravação completa (recusa se algum alerta impede), pronta para o executor. */
  async montarPrescricao(
    c: ContextoPrescricao,
    e: PrescreverEntrada,
    prescritor: PrescritorSessao,
    politicas: PoliticasPrescricao,
    opcoes: { comoSuporte: boolean },
  ): Promise<{
    gravacao: GravacaoPrescricao;
    operacao: 'pep.prescrever' | 'pep.copiarPrescricao' | 'pep.renovarPrescricao';
  }> {
    const agora = await this.porta.agora(c);
    const a = await this.atendimento(c, e.paciente, e.atendimento);
    if (!a.aberto)
      throw recusaPrescricao(
        'atendimento-fechado',
        409,
        'Atendimento fechado',
        MENSAGENS_PRESCRICAO['atendimento-fechado'],
      );
    const v = await this.vigencias(c, a, agora);
    const vigencia = e.periodo === 'seguinte' ? v.seguinte : v.atual;
    const r = await this.verificarNaVigencia(
      c,
      a,
      vigencia,
      v.grade,
      e.itens,
      prescritor,
      politicas,
      agora,
      null,
    );
    const imp = impede(r.alertasCompletos);
    if (imp.impede)
      throw recusaPrescricao(
        imp.motivo ?? 'alerta-bloqueio',
        422,
        'Prescrição com alerta pendente',
        MENSAGENS_PRESCRICAO[imp.motivo ?? 'alerta-bloqueio'] ?? '',
        {},
      );
    const retratos = await this.retratos(c, a);
    const documento = await this.documento(c, retratos, prescritor.cbo, r.montados, r.produtos);
    let origem: GravacaoPrescricao['origem'] = null;
    if (e.origem) {
      const lidos = await this.porta.itens(c, e.origem.prescricao);
      const vistos = new Set(e.itens.map((i) => i.origem?.item).filter((x): x is number => x !== undefined));
      origem = {
        prescricao: e.origem.prescricao,
        modo: e.origem.modo,
        itens: lidos.filter((l) => vistos.has(l.id)).map((l) => ({ item: l.id, ativo: true })),
      };
    }
    const sghItens = itensSgh(e.itens, r.produtos, politicas);
    const decisoes = decisoesSgh(r.alertasCompletos);
    const fichas = e.itens.flatMap((i) =>
      i.antimicrobiano && i.detalhe.tipo === 'medicamento'
        ? [
            {
              chave: i.chave,
              produto: i.detalhe.item.produto,
              indicacao: i.antimicrobiano.indicacao,
              sitio: i.antimicrobiano.sitio,
              tipo: i.antimicrobiano.tipo,
              culturaColhida: i.antimicrobiano.culturaColhida,
              diaTratamento: i.antimicrobiano.diaTratamento,
              duracaoDias: i.antimicrobiano.duracaoPrevistaDias ?? null,
            },
          ]
        : [],
    );
    const gravacao: GravacaoPrescricao = {
      paciente: e.paciente,
      atendimento: a.id,
      cbo: prescritor.cbo,
      retratos,
      dataHora: agora,
      vigencia,
      justificativaRetroativo: e.justificativaRetroativo ?? null,
      observacaoGeral: e.observacaoGeral ?? null,
      protocolos: [...new Set(e.itens.map((i) => i.protocolo).filter((x): x is number => x !== undefined))],
      kits: Object.fromEntries(e.itens.flatMap((i) => (i.kit ? [[i.chave, i.kit] as const] : []))),
      itens: r.montados,
      origem,
      documento,
      hashConteudo: createHash('sha256')
        .update(JSON.stringify({ itens: r.montados, vigencia, atendimento: a.id }))
        .digest('hex'),
      sgh: {
        prioridade: e.prioridade,
        nota: e.observacaoGeral ?? null,
        coassinaturaExigida: exigeCoassinatura(prescritor.categoria),
        origemModo:
          e.origem?.modo ??
          (e.itens.some((i) => i.protocolo)
            ? 'protocolo'
            : e.itens.some((i) => i.kit)
              ? 'kit'
              : e.futuras.length
                ? 'futura'
                : null),
        origemId:
          e.origem?.prescricao ??
          e.itens.find((i) => i.protocolo)?.protocolo ??
          e.itens.find((i) => i.kit)?.kit ??
          null,
        itens: sghItens,
        decisoes,
        fichas,
        futuras: e.futuras,
        comoSuporte: opcoes.comoSuporte,
      },
    };
    const operacao = !e.origem
      ? 'pep.prescrever'
      : e.origem.modo === 'copia'
        ? 'pep.copiarPrescricao'
        : 'pep.renovarPrescricao';
    return { gravacao, operacao };
  }

  private async retratos(
    c: ContextoPrescricao,
    a: AtendimentoDaPrescricao,
  ): Promise<{ htAtendimento: number; htPaciente: number }> {
    const r: RetratosAtuais | null = await this.porta.retratos(c, a.id, a.paciente);
    if (!r?.doPaciente)
      throw recusaPrescricao(
        'retrato-mudou',
        409,
        'Cadastro do atendimento incompleto',
        'O atendimento não tem os retratos do paciente.',
      );
    return { htAtendimento: r.htAtendimento, htPaciente: r.htPaciente };
  }

  /** O documento da trilha (estrutura do executável), com os nomes do cadastro e os marcadores dos IDs. */
  private async documento(
    c: ContextoPrescricao,
    retratos: { htAtendimento: number; htPaciente: number },
    cbo: number,
    montados: readonly ItemMontado[],
    produtos: ReadonlyMap<number, ProdutoAlerta>,
  ): Promise<string> {
    const cab = await this.porta.cabecalhoDocumento(c, retratos, cbo);
    const dom = await this.porta.dominios(c);
    const rel = await this.porta.relativos(c);
    const nome = (k: string, id: string | number | null) => {
      if (id === null) return '';
      if (k === 'frequencias') return frequenciaDe(Number(id))?.nome ?? String(id);
      if (k === 'relativos') return rel.find((r) => r.id === Number(id))?.nome ?? String(id);
      return dom[k]?.find((o) => o.id === String(id))?.nome ?? String(id);
    };
    const prod = (id: number) => produtos.get(id)?.nome ?? `Produto ${id}`;
    const hs = (m: ItemMontado, chave = (i: number) => `${m.chave}:${i}`) =>
      m.horarios.map((h, i) => ({
        chave: chave(i),
        dataHora: h.dataHora,
        relativo: h.relativo === null ? null : { id: h.relativo, nome: nome('relativos', h.relativo) },
      }));
    const itens: ItemDocumento[] = montados.map((m) => {
      const d = m.detalhe;
      const tipo = tipoDoPlano(m.plano);
      const base = {
        chave: m.chave,
        plano: m.plano,
        planoNome: tipo ?? `Tipo ${m.plano}`,
        numDoses: m.numDose,
        frequencia:
          m.frequencia === null ? null : { id: m.frequencia, nome: nome('frequencias', m.frequencia) },
        via: m.via === null ? null : { id: m.via, nome: nome('vias', m.via) },
      };
      switch (d.tipo) {
        case 'medicamento':
          return {
            ...base,
            detalhe: {
              tipo: 'medicamento',
              produto: d.produto,
              nome: prod(d.produto),
              dose: d.dose,
              unidade: d.unidade,
              agora: d.agora,
              horarios: hs(m),
              kit: d.kit.map((k, j) => ({
                ...k,
                nome: `Material ${k.produto}`,
                horarios: hs(m, (i) => `${m.chave}:${i}:kit${j}`),
              })),
            },
          };
        case 'procedimento':
          return {
            ...base,
            detalhe: {
              tipo: 'procedimento',
              procedimento: d.procedimento,
              nome: nome('procedimentos', d.procedimento),
              agora: d.agora,
              horarios: hs(m),
            },
          };
        case 'dieta':
          return {
            ...base,
            detalhe: {
              tipo: 'dieta',
              dieta: d.dieta,
              nome: nome('dietas', d.dieta),
              quantidade: d.quantidade,
              unidade: d.unidade,
              horarios: hs(m),
            },
          };
        case 'solucao':
          return {
            ...base,
            detalhe: {
              tipo: 'solucao',
              unidade: d.unidade,
              tipoInfusao: { id: d.tipoInfusao, nome: nome('tiposInfusao', d.tipoInfusao) },
              agora: d.agora,
              componentes: d.componentes.map((cp, i) => ({
                ...cp,
                nome: prod(cp.produto),
                horario: {
                  chave: `${m.chave}:esq${i}`,
                  dataHora: d.etapas.find((e) => e.etapa === cp.etapa)?.inicio ?? '',
                  relativo: null,
                },
              })),
            },
          };
        case 'vmi':
        case 'vni':
          return {
            ...base,
            detalhe: {
              tipo: 'ventilacao',
              modo: { id: d.modo, nome: nome('modos', d.modo) },
              horarios: hs(m),
            },
          };
        case 'hemoterapia':
          return {
            ...base,
            detalhe: {
              tipo: 'hemoterapia',
              codigo: d.codigo,
              nome: nome('hemocomponentes', `${d.ato}:${d.codigo}`),
              dose: d.dose,
              unidade: d.unidade,
              horarios: hs(m),
            },
          };
      }
    });
    return documentoPrescricao(
      {
        hospital: cab.hospital,
        paciente: cab.paciente,
        atendimento: cab.atendimento,
        profissional: cab.profissional,
        tipoAssinatura: 'Prescrição Geral',
      },
      itens,
    );
  }

  prescrever(
    c: ContextoPrescricao,
    op: Parameters<PortaPrescricao['prescrever']>[1],
    g: GravacaoPrescricao,
    ctx: ContextoOperacao,
  ) {
    return this.porta.prescrever(c, op, g, ctx);
  }

  // ── Leituras ───────────────────────────────────────────────────────────────────────────────────────

  async prescricoes(
    c: ContextoPrescricao,
    paciente: number,
    atendimento: number,
  ): Promise<PrescricaoResumo[]> {
    await this.atendimento(c, paciente, atendimento);
    const agora = await this.porta.agora(c);
    const ls = await this.porta.prescricoes(c, atendimento);
    const marcas = await this.porta.marcas(
      c,
      ls.map((l) => l.id),
    );
    return ls.map((l) => ({
      id: l.id,
      atendimento,
      dataHora: l.dataHora ?? '',
      vigencia: { inicio: l.inicio ?? '', fim: l.fim ?? '' },
      situacao: situacaoDaPrescricao(l.suspensaoEm, { inicio: l.inicio ?? '', fim: l.fim ?? '' }, agora),
      prescritor: l.prescritor ?? '',
      itens: l.itens,
      feitaNoNovo: marcas.get(l.id)?.feitaNoNovo ?? false,
      coassinaturaPendente: marcas.get(l.id)?.coassinaturaPendente ?? false,
    }));
  }

  async lerPrescricao(c: ContextoPrescricao, paciente: number, id: number): Promise<PrescricaoLida> {
    const cab = await this.porta.cabecalho(c, id);
    if (!cab || cab.atendimento === null)
      throw new ErroProblema('nao-encontrado', 404, 'Prescrição não encontrada');
    await this.atendimento(c, paciente, cab.atendimento);
    const agora = await this.porta.agora(c);
    const itens = await this.porta.itens(c, id);
    const marcas = await this.porta.marcas(c, [id]);
    const prova = await this.porta.prova(c, id);
    const decisoes = await this.porta.decisoes(c, id);
    const vigencia = { inicio: cab.inicio ?? '', fim: cab.fim ?? '' };
    const vencida = situacaoVigencia(vigencia, agora.slice(0, 16)) === 'vencida';
    const ultimo = [...prova.eventos].reverse().find((e) => e.tipo !== 'coassinado');
    const estadoProva = !ultimo
      ? 'sem-prova'
      : (await this.porta.hashAtual(c, id)) === ultimo.hashAnterior
        ? 'confere'
        : 'alterado';
    return {
      id,
      atendimento: cab.atendimento,
      dataHora: cab.dataHora ?? '',
      vigencia,
      situacao: situacaoDaPrescricao(cab.suspensaoEm, vigencia, agora),
      prescritor: cab.prescritor ?? '',
      itens: itens.length,
      feitaNoNovo: marcas.get(id)?.feitaNoNovo ?? false,
      coassinaturaPendente: marcas.get(id)?.coassinaturaPendente ?? false,
      itensLidos: itens.map((i) => itemLido(i, vencida, itens)),
      observacaoGeral: null,
      suspensao: cab.suspensaoEm
        ? {
            por: cab.suspensaoPor ?? '',
            em: cab.suspensaoEm,
            justificativa: cab.suspensaoJustificativa ?? '',
          }
        : null,
      prova: estadoProva,
      alertasDecididos: decisoes.map((d) => ({
        item: d.item,
        tipo: d.tipo,
        decisao: d.decisao,
        justificativa: d.justificativa,
      })),
    };
  }

  // ── Adendo e suspensões ────────────────────────────────────────────────────────────────────────────

  async montarInclusao(
    c: ContextoPrescricao,
    paciente: number,
    e: IncluirItemEntrada,
    prescritor: PrescritorSessao,
    politicas: PoliticasPrescricao,
    comoSuporte: boolean,
  ): Promise<InclusaoItem> {
    const cab = await this.porta.cabecalho(c, e.prescricao);
    if (!cab || cab.atendimento === null)
      throw new ErroProblema('nao-encontrado', 404, 'Prescrição não encontrada');
    const a = await this.atendimento(c, paciente, cab.atendimento);
    exigirTipoLiberado(e.item, TIPOS_ADENDO, SE_NECESSARIO_ADENDO);
    const agora = await this.porta.agora(c);
    const vigencia = { inicio: cab.inicio ?? '', fim: cab.fim ?? '' };
    const v = await this.vigencias(c, a, agora);
    const r = await this.verificarNaVigencia(
      c,
      a,
      vigencia,
      v.grade,
      [e.item],
      prescritor,
      politicas,
      agora,
      null,
    );
    const imp = impede(r.alertasCompletos);
    if (imp.impede)
      throw recusaPrescricao(
        imp.motivo ?? 'alerta-bloqueio',
        422,
        'Item com alerta pendente',
        MENSAGENS_PRESCRICAO[imp.motivo ?? 'alerta-bloqueio'] ?? '',
      );
    const retratos = { htAtendimento: cab.htAtendimento, htPaciente: cab.htPaciente };
    const documento = await this.documento(c, retratos, prescritor.cbo, r.montados, r.produtos);
    const item = r.montados[0]!;
    return {
      prescricao: e.prescricao,
      paciente,
      atendimento: a.id,
      cbo: prescritor.cbo,
      item,
      documento,
      hashConteudo: createHash('sha256')
        .update(JSON.stringify({ item, prescricao: e.prescricao }))
        .digest('hex'),
      sgh: {
        prioridade: 'rotina',
        nota: null,
        coassinaturaExigida: false,
        origemModo: null,
        origemId: null,
        // O cálculo de dose do item do adendo (regra 12) e as decisões de alerta.
        itens: itensSgh([e.item], r.produtos, politicas),
        decisoes: decisoesSgh(r.alertasCompletos),
        fichas: [],
        futuras: [],
        comoSuporte,
      },
    };
  }

  incluirItem(c: ContextoPrescricao, e: InclusaoItem, ctx: ContextoOperacao) {
    return this.porta.incluirItem(c, e, ctx);
  }

  async montarSuspensaoPrescricao(
    c: ContextoPrescricao,
    paciente: number,
    prescricao: number,
    justificativa: string,
    prescritor: PrescritorSessao,
    comoSuporte: boolean,
  ): Promise<SuspensaoPrescricao> {
    const cab = await this.porta.cabecalho(c, prescricao);
    if (!cab || cab.atendimento === null)
      throw new ErroProblema('nao-encontrado', 404, 'Prescrição não encontrada');
    await this.atendimento(c, paciente, cab.atendimento);
    return {
      prescricao,
      paciente,
      atendimento: cab.atendimento,
      cbo: prescritor.cbo,
      justificativa,
      documento: await this.documentoSituacao(c, cab, prescritor.cbo),
      hashConteudo: createHash('sha256').update(`suspensa:${prescricao}:${justificativa}`).digest('hex'),
      comoSuporte,
    };
  }

  async montarSuspensaoItem(
    c: ContextoPrescricao,
    paciente: number,
    prescricao: number,
    item: number,
    justificativa: string,
    correcao: ItemPrescricao | undefined,
    prescritor: PrescritorSessao,
    politicas: PoliticasPrescricao,
    comoSuporte: boolean,
  ): Promise<SuspensaoItem> {
    const cab = await this.porta.cabecalho(c, prescricao);
    if (!cab || cab.atendimento === null)
      throw new ErroProblema('nao-encontrado', 404, 'Prescrição não encontrada');
    const a = await this.atendimento(c, paciente, cab.atendimento);
    let novo: SuspensaoItem['correcao'] = null;
    let sgh: SuspensaoItem['sgh'];
    let documento = await this.documentoSituacao(c, cab, prescritor.cbo);
    if (correcao) {
      exigirTipoLiberado(correcao, TIPOS_CORRECAO, []);
      const agora = await this.porta.agora(c);
      const v = await this.vigencias(c, a, agora);
      const vigencia = { inicio: cab.inicio ?? '', fim: cab.fim ?? '' };
      const r = await this.verificarNaVigencia(
        c,
        a,
        vigencia,
        v.grade,
        [correcao],
        prescritor,
        politicas,
        agora,
        prescricao,
      );
      if (impede(r.alertasCompletos).impede)
        throw recusaPrescricao(
          'alerta-bloqueio',
          422,
          'Item com alerta pendente',
          MENSAGENS_PRESCRICAO['alerta-sem-justificativa'] ?? '',
        );
      novo = r.montados[0] ?? null;
      sgh = {
        prioridade: 'rotina',
        nota: null,
        coassinaturaExigida: false,
        origemModo: null,
        origemId: null,
        itens: itensSgh([correcao], r.produtos, politicas),
        decisoes: decisoesSgh(r.alertasCompletos),
        fichas: [],
        futuras: [],
        comoSuporte,
      };
      documento = await this.documento(
        c,
        { htAtendimento: cab.htAtendimento, htPaciente: cab.htPaciente },
        prescritor.cbo,
        r.montados,
        r.produtos,
      );
    }
    return {
      prescricao,
      item,
      paciente,
      atendimento: a.id,
      cbo: prescritor.cbo,
      justificativa,
      correcao: novo,
      documento,
      hashConteudo: createHash('sha256').update(`item:${prescricao}:${item}:${justificativa}`).digest('hex'),
      comoSuporte,
      ...(sgh ? { sgh } : {}),
    };
  }

  /** O documento do evento sem item novo (o cabeçalho congelado e a prescrição como estava). */
  private async documentoSituacao(
    c: ContextoPrescricao,
    cab: { htAtendimento: number; htPaciente: number },
    cbo: number,
  ): Promise<string> {
    return this.documento(
      c,
      { htAtendimento: cab.htAtendimento, htPaciente: cab.htPaciente },
      cbo,
      [],
      new Map(),
    );
  }

  suspenderItem(c: ContextoPrescricao, e: SuspensaoItem, ctx: ContextoOperacao) {
    return this.porta.suspenderItem(c, e, ctx);
  }

  suspenderPrescricao(c: ContextoPrescricao, e: SuspensaoPrescricao, ctx: ContextoOperacao) {
    return this.porta.suspenderPrescricao(c, e, ctx);
  }

  async coassinar(
    c: ContextoPrescricao,
    paciente: number,
    prescricao: number,
    usuario: string,
  ): Promise<void> {
    const cab = await this.porta.cabecalho(c, prescricao);
    if (!cab || cab.atendimento === null)
      throw new ErroProblema('nao-encontrado', 404, 'Prescrição não encontrada');
    await this.atendimento(c, paciente, cab.atendimento);
    const marcas = await this.porta.marcas(c, [prescricao]);
    if (!marcas.get(prescricao)?.coassinaturaPendente)
      throw recusaPrescricao(
        'sem-coassinatura',
        409,
        'Sem coassinatura pendente',
        'A prescrição não espera coassinatura.',
      );
    await this.porta.coassinar(c, prescricao, usuario);
  }

  get portaDados(): PortaPrescricao {
    return this.porta;
  }
}

/**
 * POL-3: o adendo e a correção só gravam os tipos cuja receita é completa (o legado confere de novo, na transação);
 * o resto é recusado antes de qualquer gravação, com a mensagem de produto.
 */
function exigirTipoLiberado(
  i: ItemPrescricao,
  tipos: readonly string[],
  comSeNecessario: readonly string[],
): void {
  const d = i.detalhe as { tipo: string; seNecessario?: unknown };
  if (!tipos.includes(d.tipo) || (d.seNecessario !== undefined && !comSeNecessario.includes(d.tipo)))
    throw recusaPrescricao(
      'tipo-nao-liberado',
      409,
      'Tipo de item não liberado',
      'Este tipo de item (ou a opção "se necessário" dele) ainda não pode ser incluído ou corrigido numa prescrição já assinada: nada foi gravado. Prescreva-o na prescrição do próximo período.',
    );
}

/** O registro do cálculo de dose e da alta vigilância de cada item (SGH_PEP_PRESC_EXT; regra 12). */
function itensSgh(
  itens: readonly ItemPrescricao[],
  produtos: ReadonlyMap<number, ProdutoAlerta>,
  politicas: Pick<PoliticasPrescricao, 'duplaChecagem'>,
) {
  return itens.map((i) => {
    const p = i.detalhe.tipo === 'medicamento' ? produtos.get(i.detalhe.item.produto) : undefined;
    return {
      chave: i.chave,
      pesoKg: i.calculo?.peso ?? null,
      alturaCm: i.calculo?.altura ?? null,
      clearance: i.calculo?.clearance ?? null,
      dataDado: i.calculo?.dataDado ?? null,
      regraDose: i.calculo?.regra ?? null,
      dosePorUnidade: i.calculo?.dosePorUnidade ?? null,
      altaVigilancia: p?.altoAlerta ?? false,
      duplaChecagem: (p?.altoAlerta ?? false) && politicas.duplaChecagem,
    };
  });
}

/** Toda decisão diante de alerta (exibido, mantido com justificativa, retirado), com a regra e a versão. */
function decisoesSgh(alertas: readonly AlertaPrescricao[]) {
  return alertas
    .filter((x) => x.item !== '*')
    .map((x) => ({
      chave: x.item,
      alerta: x.id,
      tipo: x.tipo,
      nivel: x.nivel,
      regra: x.regra,
      versaoRegra: x.versaoRegra,
      decisao: x.decisao?.decisao ?? ('exibido' as const),
      justificativa: x.decisao?.justificativa ?? null,
    }));
}

export function situacaoDaPrescricao(
  suspensaoEm: string | null,
  vigencia: { inicio: string; fim: string },
  agora: string,
): SituacaoPrescricao {
  if (suspensaoEm) return 'suspensa';
  if (!vigencia.inicio || !vigencia.fim) return 'vencida';
  const s = situacaoVigencia(vigencia, agora.slice(0, 16));
  return s === 'vigente' ? 'vigente' : s === 'futura' ? 'futura' : 'vencida';
}

function descricaoDoItem(i: ItemPrescricaoLido): {
  descricao: string;
  dose: string | null;
  produto: number | null;
  principios: number[];
} {
  const d = i.detalhe;
  switch (d.tipo) {
    case 'medicamento':
      return {
        descricao: d.produtoNome ?? `Produto ${d.produto ?? ''}`,
        dose: d.dose === null ? null : `${d.dose.toLocaleString('pt-BR')} ${d.unidade ?? ''}`.trim(),
        produto: d.produto,
        principios: [...d.principios],
      };
    case 'dieta':
      return {
        descricao: d.dietaNome ?? `Dieta ${d.dieta}`,
        dose: d.quantidade === null ? null : String(d.quantidade),
        produto: null,
        principios: [],
      };
    case 'procedimento':
      return {
        descricao: d.procedimentoNome ?? `Cuidado ${d.procedimento}`,
        dose: d.faixas.length ? `escala com ${d.faixas.length} faixa(s)` : null,
        produto: null,
        principios: [],
      };
    case 'solucao':
      return {
        descricao: d.componentes.map((x) => x.nome ?? `Produto ${x.produto ?? ''}`).join(' + ') || 'Solução',
        dose: null,
        produto: null,
        principios: [],
      };
    case 'ventilacao':
      return { descricao: d.modoNome ?? `Modo ${d.modo}`, dose: null, produto: null, principios: [] };
    case 'hemoterapia':
      return {
        descricao: d.nome ?? d.codigo,
        dose: d.dose === null ? null : `${d.dose} ${d.unidade ?? ''}`.trim(),
        produto: null,
        principios: [],
      };
    default:
      return {
        descricao: (d.tipo === 'outro' ? d.resumo : undefined) ?? i.planoNome ?? `Tipo ${i.plano}`,
        dose: null,
        produto: null,
        principios: [],
      };
  }
}

/** Idade em anos completos na data (AAAA-MM-DD). */
function idadeEmAnos(nascimento: string, hoje: string): number | null {
  const [a, m, d] = nascimento.split('-').map(Number);
  const [ha, hm, hd] = hoje.split('-').map(Number);
  if (!a || !m || !d || !ha || !hm || !hd) return null;
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

function itemLido(i: ItemPrescricaoLido, vencida: boolean, todos: readonly ItemPrescricaoLido[]): ItemLido {
  const principais = i.horarios.filter((h) => !h.acessoria);
  const d = descricaoDoItem(i);
  const corrigidoPor = i.corrigidoEm
    ? (todos.find((x) => x.id !== i.id && x.incluidoEm !== null && x.incluidoEm >= (i.corrigidoEm ?? ''))
        ?.id ?? null)
    : null;
  return {
    id: i.id,
    tipo: tipoDoPlano(i.plano) ?? `tipo-${i.plano}`,
    tipoNome: i.planoNome ?? `Tipo ${i.plano}`,
    descricao: d.descricao,
    dose: d.dose,
    via: i.via,
    frequencia: i.frequenciaNome,
    observacaoEnfermagem: i.observacaoEnfermagem,
    situacao: situacaoDoItem(principais, i.corrigidoEm !== null, vencida, i.suspenso === true),
    incluidoDepois: i.incluidoEm !== null,
    produto: d.produto,
    principiosAtivos: d.principios,
    horarios: principais.map((h) => ({
      id: h.id,
      dataHora: h.dataHora,
      situacao: h.situacao,
      rotulo: rotuloChecagem(h.situacao),
    })),
    corrigidoPor,
    detalhe: detalheParaCopia(i),
  };
}

export { p2 };

/** Recusa de negócio da prescrição: o código vai em `extras.codigo` (Problem Details, M08). */
export function recusaPrescricao(
  codigo: string,
  status: number,
  titulo: string,
  detalhe?: string,
  extras: { readonly campos?: readonly string[] } = {},
): ErroProblema {
  return new ErroProblema('recusa-de-negocio', status, titulo, detalhe, { ...extras, codigo });
}

/** O detalhe do item como a tela de cópia pede de volta (os tipos que a leitura reconstrói sem perda). */
export function detalheParaCopia(i: ItemPrescricaoLido): DetalheItem | null {
  const d = i.detalhe;
  const tipo = tipoDoPlano(i.plano);
  let bruto: unknown = null;
  if (d.tipo === 'medicamento' && d.produto && d.dose && d.unidade && i.via)
    bruto = {
      tipo: 'medicamento',
      item: { produto: d.produto },
      dose: d.dose,
      unidade: d.unidade,
      via: i.via,
      frequencia: i.frequencia,
      iniciarAgora: d.agora,
      naoAjustar: d.naoAjustar,
      ...(d.motivosSeNecessario.length
        ? { seNecessario: { motivos: [...d.motivosSeNecessario], intervaloMinimoHoras: 6 } }
        : {}),
    };
  else if (d.tipo === 'procedimento' && tipo === 'procedimento')
    bruto = {
      tipo: 'procedimento',
      procedimento: d.procedimento,
      frequencia: i.frequencia,
      iniciarAgora: d.agora,
      ...(d.motivosSeNecessario.length
        ? { seNecessario: { motivos: [...d.motivosSeNecessario], intervaloMinimoHoras: 6 } }
        : {}),
    };
  else if (d.tipo === 'procedimento' && tipo === 'glicemia')
    bruto = {
      tipo: 'glicemia',
      procedimento: d.procedimento,
      frequencia: i.frequencia,
      faixas: d.faixas.map((f) => ({
        de: f.de,
        ate: f.ate,
        produto: f.produto,
        dose: f.dose,
        unidade: f.unidade,
        via: i.via ?? 'SC',
      })),
    };
  else if (d.tipo === 'dieta' && (tipo === 'jejum' || tipo === 'dieta-livre'))
    bruto = { tipo, dieta: d.dieta, frequencia: i.frequencia };
  else if (d.tipo === 'dieta' && tipo === 'dieta-oral')
    bruto = { tipo, dieta: d.dieta, frequencia: i.frequencia, quantidade: d.quantidade ?? 1 };
  if (bruto === null) return null;
  const r = esquemaDetalheItem.safeParse(bruto);
  return r.success ? r.data : null;
}
