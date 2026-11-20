// Serviço da contabilidade, etapa 1 (M54-F1; ficha, seções 2, 4 e 7; regras 1, 2, 5 e 6): monta as respostas das
// telas e confere as gravações com o motor puro (@sgh/dominio-contabil) ANTES de ir ao banco. A porta faz o resto.
//   - plano: a árvore (pai antes dos filhos) e os problemas; a inclusão e a alteração recusam o que deixaria a conta
//     com erro do plano (máscara, pai ausente ou analítico, grupo diferente do pai);
//   - regras: as versões (a última de cada chave é a publicada, as anteriores substituídas); a publicação confere
//     `problemasDaPublicacao` e grava a forma canônica com o SHA-256 dela;
//   - simulação: a regra aplicada aos fatos da competência, sem gravar (contagens, amostra e totais com as parcelas);
//   - reprocessamento: as regras publicadas aplicadas DUAS vezes aos mesmos fatos dão o mesmo resultado (regra 2); sem
//     `somenteConferir`, a situação de cada fato é atualizada (o lançamento em si chega na F2).
import { createHash } from 'node:crypto';
import {
  CODIGOS_GRUPO_CONTA,
  type ContaDoPlano,
  type ContaPlano,
  type FatoContabil,
  type FatoListado,
  type FatosContabeis,
  FONTES_FATO,
  GRUPOS_CONTA,
  MASCARA_PLANO_PADRAO,
  ORIGENS_LANCAMENTO,
  type PlanoContabil,
  type RegraContabil,
  type RegrasContabeis,
  type ResultadoReprocessamento,
  type ResumoFatosContabeis,
  rotuloDaFonte,
  type SimulacaoRegra,
  type SituacaoFato,
  SITUACOES_FATO,
  TIPOS_FATO,
  type TipoFato,
  type ApoioContabil,
  type VersaoRegra,
} from '@sgh/contratos';
import {
  arvoreDoPlano,
  compararComGravado,
  compararReprocessamento,
  conteudoCanonicoRegra,
  contextoDeAplicacao,
  type NoPlano,
  nivelDoCodigo,
  paiDoCodigo,
  problemasDaPublicacao,
  problemasDoPlano,
  simularRegra,
} from '@sgh/dominio-contabil';
import type { ContaPlanoLida, FatoRegistradoLido, FiltroFatosSgh, RegraPublicadaLida } from '@sgh/legado';
import { ErroProblema } from '../../problema.filter.js';
import type { ContextoContabil, PortaContabil } from './porta.js';

/** Teto de fatos lidos para a simulação e o reprocessamento de uma competência (acima: resultado parcial, avisado). */
export const TETO_FATOS_COMPETENCIA = 20_000;

const recusa = (codigo: string, detalhe: string, campos: readonly string[] = []) =>
  new ErroProblema('recusa-de-negocio', 409, 'Não foi possível gravar', detalhe, {
    codigo,
    ...(campos.length ? { campos: [...campos] } : {}),
  });

const semCampos = (c: ContaPlanoLida): ContaPlano => ({
  empresa: c.empresa,
  codigo: c.codigo,
  nome: c.nome,
  grupo: c.grupo,
  tipo: c.tipo,
  natureza: c.natureza,
  referencialTipo: c.referencialTipo,
  referencialConta: c.referencialConta,
  contaExportacao: c.contaExportacao,
  exigeCentroCusto: c.exigeCentroCusto,
  ativa: c.ativa,
});

const chaveRegra = (r: Pick<RegraContabil, 'empresa' | 'origem' | 'tipoFato' | 'nome'>) =>
  `${r.empresa}|${r.origem}|${r.tipoFato}|${r.nome}`;

export const impressaoDaRegra = (conteudo: string) =>
  createHash('sha256').update(conteudo, 'utf8').digest('hex');

/** Campos alterados (só os nomes; vão à trilha em `diferenca`). */
export function camposAlterados(antes: ContaPlano, depois: ContaPlano): string[] {
  const k: (keyof ContaPlano)[] = [
    'nome',
    'referencialTipo',
    'referencialConta',
    'contaExportacao',
    'exigeCentroCusto',
    'ativa',
  ];
  return k.filter((c) => antes[c] !== depois[c]);
}

function fatoListado(f: FatoRegistradoLido): FatoListado {
  return {
    id: f.idFato,
    fonte: rotuloDaFonte(f.tabela),
    tipo: f.tipo,
    tipoRotulo: TIPOS_FATO[f.tipo]?.rotulo ?? f.tipo,
    origem: f.origem,
    empresa: f.empresa,
    data: f.data,
    competencia: f.competencia,
    valorCentavos: f.valorCentavos,
    centroCusto: f.centroCusto,
    documento: f.documento,
    estorno: f.estorno,
    situacao: f.situacao,
    situacaoRotulo: SITUACOES_FATO[f.situacao] ?? f.situacao,
    motivo: f.motivo,
    lidoEm: f.lidoEm,
  };
}

export class ServicoContabil {
  constructor(
    private readonly porta: PortaContabil,
    private readonly mascara: string = MASCARA_PLANO_PADRAO,
  ) {}

  async apoio(
    c: ContextoContabil,
    s: Pick<
      ApoioContabil,
      'ligada' | 'motivo' | 'podeEditar' | 'podePublicar' | 'podeVerFatos' | 'cadastros'
    >,
  ): Promise<ApoioContabil> {
    const [refs, empresas] = await Promise.all([this.porta.referencias(c), this.porta.empresas(c)]);
    return {
      ...s,
      empresas: empresas.length ? empresas : [1],
      mascara: this.mascara,
      // O rótulo é o do produto (ORIGENS_LANCAMENTO); a origem que o banco tem e o vocabulário não conhece fica fora.
      origens: refs.origens
        .filter((o) => o.id in ORIGENS_LANCAMENTO)
        .map((o) => ({ id: o.id, rotulo: ORIGENS_LANCAMENTO[o.id as keyof typeof ORIGENS_LANCAMENTO] })),
      tiposFato: (Object.keys(TIPOS_FATO) as TipoFato[]).map((codigo) => ({
        codigo,
        origem: TIPOS_FATO[codigo].origem,
        rotulo: TIPOS_FATO[codigo].rotulo,
      })),
      grupos: CODIGOS_GRUPO_CONTA.map((g) => ({
        codigo: g,
        rotulo: GRUPOS_CONTA[g].rotulo,
        natureza: GRUPOS_CONTA[g].natureza,
      })),
      tiposPlanoReferencial: refs.tiposPlanoReferencial,
    };
  }

  // ── Plano ──────────────────────────────────────────────────────────────────────────────────────

  async plano(c: ContextoContabil, empresa: number): Promise<PlanoContabil> {
    const lidas = await this.porta.plano(c, empresa);
    const porCodigo = new Map(lidas.map((x) => [x.codigo, x]));
    const contas: ContaDoPlano[] = [];
    const visitar = (nos: readonly NoPlano[]) => {
      for (const no of nos) {
        const l = porCodigo.get(no.conta.codigo)!;
        contas.push({ ...l, nivel: nivelDoCodigo(l.codigo), pai: paiDoCodigo(l.codigo) });
        visitar(no.filhas);
      }
    };
    visitar(arvoreDoPlano(lidas.map(semCampos)));
    return {
      empresa,
      contas,
      problemas: problemasDoPlano(lidas.map(semCampos), { mascara: this.mascara }),
    };
  }

  /** Erros do plano que a conta `codigo` teria no plano `contas` (os avisos não impedem gravar). */
  private errosDaConta(contas: readonly ContaPlano[], codigo: string): string[] {
    return problemasDoPlano(contas, { mascara: this.mascara })
      .filter((p) => p.gravidade === 'erro' && p.codigo === codigo)
      .map((p) => p.detalhe);
  }

  async conferirInclusao(c: ContextoContabil, conta: ContaPlano): Promise<void> {
    const plano = (await this.porta.plano(c, conta.empresa)).map(semCampos);
    if (plano.some((x) => x.codigo === conta.codigo))
      throw recusa('conta-ja-existe', 'Já existe uma conta com este código no plano da empresa.', ['codigo']);
    const erros = this.errosDaConta([...plano, conta], conta.codigo);
    if (erros.length) throw recusa('conta-incoerente', erros.join(' '), ['codigo']);
  }

  /** A conta depois da alteração (código, grupo, tipo e natureza vêm da conta gravada) e os campos mudados. */
  async montarAlteracao(
    c: ContextoContabil,
    e: {
      empresa: number;
      codigo: string;
      versao: number;
      nome?: string | undefined;
      referencialTipo?: number | null | undefined;
      referencialConta?: string | null | undefined;
      contaExportacao?: number | null | undefined;
      exigeCentroCusto?: boolean | undefined;
      ativa?: boolean | undefined;
    },
  ): Promise<{ depois: ContaPlano; campos: string[] }> {
    const plano = await this.porta.plano(c, e.empresa);
    const atual = plano.find((x) => x.codigo === e.codigo);
    if (!atual) throw new ErroProblema('nao-encontrado', 404, 'Conta não encontrada');
    if (atual.versao !== e.versao)
      throw new ErroProblema(
        'conflito-de-versao',
        409,
        'A conta mudou',
        'A conta mudou depois que você abriu (outra pessoa gravou). Abra de novo e confira antes de gravar.',
        { codigo: 'conta-desatualizada' },
      );
    const antes = semCampos(atual);
    const depois: ContaPlano = {
      ...antes,
      ...(e.nome !== undefined ? { nome: e.nome } : {}),
      ...(e.referencialTipo !== undefined ? { referencialTipo: e.referencialTipo } : {}),
      ...(e.referencialConta !== undefined ? { referencialConta: e.referencialConta } : {}),
      ...(e.contaExportacao !== undefined ? { contaExportacao: e.contaExportacao } : {}),
      ...(e.exigeCentroCusto !== undefined ? { exigeCentroCusto: e.exigeCentroCusto } : {}),
      ...(e.ativa !== undefined ? { ativa: e.ativa } : {}),
    };
    if ((depois.referencialTipo === null) !== (depois.referencialConta === null))
      throw recusa(
        'referencial-incompleto',
        'Informe o plano referencial e a conta referencial juntos (ou nenhum dos dois).',
        ['referencialConta'],
      );
    const campos = camposAlterados(antes, depois);
    if (!campos.length) throw recusa('nada-mudou', 'Nada mudou na conta.');
    if (!depois.ativa && antes.ativa && antes.tipo === 'sintetica') {
      const filhaAtiva = plano.some((x) => x.ativa && paiDoCodigo(x.codigo) === antes.codigo);
      if (filhaAtiva)
        throw recusa(
          'sintetica-com-filhas-ativas',
          'Desative antes as contas abaixo desta: uma conta de agrupamento não fica inativa com contas ativas embaixo.',
          ['ativa'],
        );
    }
    return { depois, campos };
  }

  // ── Regras ─────────────────────────────────────────────────────────────────────────────────────

  async regras(
    c: ContextoContabil,
    empresa: number,
    f: { origem?: number; tipoFato?: string },
  ): Promise<RegrasContabeis> {
    const lidas = await this.porta.regras(c, empresa, {
      ...(f.origem !== undefined ? { origem: f.origem as keyof typeof ORIGENS_LANCAMENTO } : {}),
      ...(f.tipoFato !== undefined && f.tipoFato in TIPOS_FATO ? { tipoFato: f.tipoFato as TipoFato } : {}),
    });
    const ultima = new Map<string, number>();
    for (const r of lidas)
      ultima.set(chaveRegra(r.regra), Math.max(ultima.get(chaveRegra(r.regra)) ?? 0, r.regra.versao));
    const itens: VersaoRegra[] = lidas.map((r: RegraPublicadaLida) => ({
      ...r,
      situacao: ultima.get(chaveRegra(r.regra)) === r.regra.versao ? 'publicada' : 'substituida',
    }));
    return { empresa, itens };
  }

  /** Confere a publicação e devolve o que a gravação leva (a forma canônica e a impressão). */
  async prepararPublicacao(
    c: ContextoContabil,
    regra: RegraContabil,
  ): Promise<{ conteudo: string; impressao: string }> {
    if (TIPOS_FATO[regra.tipoFato].origem !== regra.origem)
      throw recusa('origem-do-fato', 'A origem não é a do tipo de fato escolhido.', ['origem']);
    const [publicadas, plano] = await Promise.all([
      this.porta.regras(c, regra.empresa, {}),
      this.porta.plano(c, regra.empresa),
    ]);
    const problemas = problemasDaPublicacao(
      regra,
      publicadas.map((p) => p.regra),
      plano.map(semCampos),
    );
    if (problemas.length) throw recusa('regra-com-problemas', problemas.join(' '));
    const conteudo = conteudoCanonicoRegra(regra);
    return { conteudo, impressao: impressaoDaRegra(conteudo) };
  }

  async simular(c: ContextoContabil, regra: RegraContabil, competencia: string): Promise<SimulacaoRegra> {
    const [fatos, plano, dePara, publicadas] = await Promise.all([
      this.porta.fatosDaCompetencia(c, regra.empresa, competencia, TETO_FATOS_COMPETENCIA + 1),
      this.porta.plano(c, regra.empresa),
      this.porta.dePara(c, regra.empresa),
      this.porta.regras(c, regra.empresa, {}),
    ]);
    const parcial = fatos.length > TETO_FATOS_COMPETENCIA;
    const doTipo = fatos
      .slice(0, TETO_FATOS_COMPETENCIA)
      .filter((f) => f.tipo === regra.tipoFato && f.situacao !== 'substituido');
    const ctx = contextoDeAplicacao(plano.map(semCampos), dePara);
    const { todos: _todos, ...r } = simularRegra(doTipo, [regra], ctx);
    void _todos;
    return {
      competencia,
      parcial,
      ...r,
      problemasDaPublicacao: problemasDaPublicacao(
        regra,
        publicadas.map((p) => p.regra),
        plano.map(semCampos),
      ),
    };
  }

  // ── Fatos ──────────────────────────────────────────────────────────────────────────────────────

  async fatos(
    c: ContextoContabil,
    f: FiltroFatosSgh,
    pagina: number,
    tamanho: number,
  ): Promise<FatosContabeis> {
    const r = await this.porta.fatos(c, f, pagina, tamanho);
    return { itens: r.itens.map(fatoListado), total: r.total, pagina, tamanho };
  }

  async resumoFatos(c: ContextoContabil): Promise<ResumoFatosContabeis> {
    const [fontes, resumo] = await Promise.all([this.porta.fontes(c), this.porta.resumoFatos(c)]);
    const estado = new Map(fontes.map((f) => [f.tabela, f]));
    const contagem = new Map(resumo.map((r) => [r.tabela, r.porSituacao]));
    const totais: Partial<Record<SituacaoFato, number>> = {};
    const linhas = FONTES_FATO.map((f) => {
      const e = estado.get(f.tabela);
      const porSituacao = contagem.get(f.tabela) ?? {};
      for (const [s, n] of Object.entries(porSituacao) as [SituacaoFato, number][])
        totais[s] = (totais[s] ?? 0) + n;
      return {
        fonte: rotuloDaFonte(f.tabela),
        tipos: f.tipos.map((t) => TIPOS_FATO[t].rotulo),
        marca: e?.marca ?? 0,
        ultimaLeitura: e?.ultimaLeitura ?? null,
        lidosNovos: e?.lidosNovos ?? 0,
        lidosAlterados: e?.lidosAlterados ?? 0,
        porSituacao,
      };
    });
    return { fontes: linhas, totais };
  }

  // ── Reprocessamento (regra 2) ──────────────────────────────────────────────────────────────────

  /**
   * Aplica as regras publicadas duas vezes aos fatos da competência e compara; devolve também as situações que a
   * gravação mudaria (e, para a gravação, a lista: fato, situação, motivo e a regra).
   */
  async reprocessar(
    c: ContextoContabil,
    empresa: number,
    competencia: string,
    somenteConferir: boolean,
  ): Promise<{
    resultado: ResultadoReprocessamento;
    mudancas: {
      idFato: number;
      situacaoLida: SituacaoFato;
      situacao: SituacaoFato;
      motivo: string | null;
      regraId: number | null;
    }[];
  }> {
    const [lidos, plano, dePara, publicadas] = await Promise.all([
      this.porta.fatosDaCompetencia(c, empresa, competencia, TETO_FATOS_COMPETENCIA + 1),
      this.porta.plano(c, empresa),
      this.porta.dePara(c, empresa),
      this.porta.regras(c, empresa, {}),
    ]);
    const parcial = lidos.length > TETO_FATOS_COMPETENCIA;
    const fatos = lidos.slice(0, TETO_FATOS_COMPETENCIA).filter((f) => f.situacao !== 'substituido');
    const regras = publicadas.map((p) => p.regra);
    const idDaRegra = new Map(publicadas.map((p) => [`${chaveRegra(p.regra)}|${p.regra.versao}`, p.id]));
    const ctx = contextoDeAplicacao(plano.map(semCampos), dePara);
    const primeira = simularRegra(fatos, regras, ctx);
    const segunda = simularRegra(fatos, regras, ctx);
    const cmp = compararReprocessamento(primeira.todos, segunda.todos);
    // Correção da revisão (M54.2): desde a F2 a primeira execução está gravada; a derivação de hoje é comparada também
    // com as partidas dos lançamentos gravados dos fatos contabilizados (chave fato:<id>).
    const gravados = await this.porta.lancamentosDosFatos(
      c,
      fatos.filter((f) => f.situacao === 'contabilizado' && !f.estorno).map((f) => f.idFato),
    );
    const gravado = compararComGravado(fatos, regras, ctx, gravados);
    const mudancas: {
      idFato: number;
      situacaoLida: SituacaoFato;
      situacao: SituacaoFato;
      motivo: string | null;
      regraId: number | null;
    }[] = [];
    for (const f of fatos) {
      const um = simularRegra([f as FatoContabil], regras, ctx, 1);
      const situacao = (Object.keys(um.porSituacao) as SituacaoFato[]).find((s) => um.porSituacao[s] > 0)!;
      const l = um.todos[0];
      const regraId = l
        ? (idDaRegra.get(`${f.empresa}|${f.origem}|${f.tipo}|${l.regra.nome}|${l.regra.versao}`) ?? null)
        : null;
      const motivo = um.recusas[0]?.motivo ?? null;
      // Etapa 2 (D-REPROC-542): o fato contabilizado tem lançamento gravado e não muda aqui (a correção é o estorno);
      // o que a regra contabilizaria volta a pendente, para a contabilização gravar o lançamento (nunca "contabilizado"
      // sem lançamento). Só pendente, sem regra e sem conta trocam entre si.
      if (f.situacao === 'contabilizado') continue;
      const nova =
        situacao === 'contabilizado'
          ? { situacao: 'pendente' as SituacaoFato, motivo: null, regraId: null }
          : { situacao, motivo, regraId };
      if (
        nova.situacao !== f.situacao ||
        nova.regraId !== f.regraId ||
        (nova.motivo ?? null) !== (f.motivo ?? null)
      )
        mudancas.push({ idFato: f.idFato, situacaoLida: f.situacao, ...nova });
    }
    const resultado: ResultadoReprocessamento = {
      empresa,
      competencia,
      somenteConferir,
      fatos: fatos.length,
      parcial,
      identico: cmp.identico,
      iguais: cmp.iguais,
      diferentes: cmp.diferentes.length + cmp.soNaPrimeira.length + cmp.soNaSegunda.length,
      situacoesAlteradas: mudancas.length,
      mudaramDurante: 0,
      gravado,
      porSituacao: primeira.porSituacao,
      totais: { debitos: primeira.totais.debitos, creditos: primeira.totais.creditos },
      mensagem: cmp.identico
        ? (somenteConferir
            ? `Conferido: as regras aplicadas de novo aos ${fatos.length} fatos dão o mesmo resultado. ${mudancas.length} fato(s) mudariam de situação.`
            : `Reprocessado: ${mudancas.length} fato(s) mudaram de situação; o resultado é o mesmo nas duas aplicações.`) +
          textoDoGravado(gravado)
        : 'As duas aplicações das regras deram resultados diferentes: nada foi gravado. Avise o suporte.',
    };
    return { resultado, mudancas };
  }
}

/** A comparação com os lançamentos gravados, para a mensagem (só contagens). */
function textoDoGravado(g: {
  comparados: number;
  iguais: number;
  diferentes: number;
  semLancamento: number;
}): string {
  if (g.comparados === 0) return '';
  const base = ` Dos ${g.comparados} fato(s) contabilizado(s), ${g.iguais} têm o lançamento gravado igual ao que as regras dão hoje`;
  const dif = g.diferentes
    ? `; ${g.diferentes} diferente(s) (regra publicada depois da contabilização: a correção é o estorno)`
    : '';
  const sem = g.semLancamento ? `; ${g.semLancamento} sem lançamento gravado (avise o suporte)` : '';
  return `${base}${dif}${sem}.`;
}
