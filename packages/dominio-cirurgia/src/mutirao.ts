// Projetos e mutirões cirúrgicos do SUS (F8, 04-CC linha 108). Padrão de mercado adotado: a portaria de habilitação
// com vigência, metas por procedimento SIGTAP (Tabela de Procedimentos do SUS), insumos e fornecedores previstos, e a
// AIH (autorização de internação hospitalar) ou a APAC (autorização de procedimento de alta complexidade) marcada com
// o projeto, como no Programa Nacional de Redução das Filas; sem faturamento à parte (a produção sai das próprias
// contas SUS). Regras puras, sem banco: o servidor e a tela usam as mesmas.

export type SituacaoMutirao = 'planejado' | 'em_andamento' | 'encerrado' | 'cancelado';
export type TipoDocumentoMutirao = 'aih' | 'apac';

export interface ProblemaMutirao {
  readonly campo: string;
  readonly mensagem: string;
}

export interface ProjetoMutiraoEntrada {
  readonly codigo: string;
  readonly descricao: string;
  /** Número da portaria (ou convênio, emenda) que habilita e financia o projeto. */
  readonly portaria: string;
  readonly periodoInicio: string;
  readonly periodoFim: string | null;
  readonly valorFinanciamento: number | null;
}

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const CODIGO = /^[A-Z0-9][A-Z0-9._-]{0,29}$/;

/** Valida o cabeçalho do projeto: código, descrição, portaria, vigência e valor. */
export function validarProjetoMutirao(e: ProjetoMutiraoEntrada): ProblemaMutirao[] {
  const p: ProblemaMutirao[] = [];
  if (!CODIGO.test(e.codigo.trim().toUpperCase()))
    p.push({
      campo: 'codigo',
      mensagem: 'Informe o código do projeto (letras, números, ponto ou traço; até 30).',
    });
  if (e.descricao.trim().length < 3)
    p.push({ campo: 'descricao', mensagem: 'Informe a descrição do projeto.' });
  if (e.portaria.trim().length < 3)
    p.push({
      campo: 'portaria',
      mensagem: 'Informe a portaria, o convênio ou a emenda que habilita o projeto.',
    });
  if (!DATA.test(e.periodoInicio))
    p.push({ campo: 'periodoInicio', mensagem: 'Informe o início da vigência.' });
  if (e.periodoFim !== null) {
    if (!DATA.test(e.periodoFim)) p.push({ campo: 'periodoFim', mensagem: 'O fim da vigência é inválido.' });
    else if (DATA.test(e.periodoInicio) && e.periodoFim < e.periodoInicio)
      p.push({ campo: 'periodoFim', mensagem: 'O fim da vigência é antes do início.' });
  }
  if (e.valorFinanciamento !== null && !(e.valorFinanciamento >= 0))
    p.push({ campo: 'valorFinanciamento', mensagem: 'O valor do financiamento não pode ser negativo.' });
  return p;
}

const TRANSICOES: Record<SituacaoMutirao, readonly SituacaoMutirao[]> = {
  planejado: ['em_andamento', 'cancelado'],
  em_andamento: ['encerrado', 'cancelado'],
  encerrado: [],
  cancelado: [],
};

/** A mudança de situação permitida; encerrar exige o fim da vigência (a data de hoje quando vazio). */
export function conferirMudancaSituacao(
  atual: SituacaoMutirao,
  nova: SituacaoMutirao,
  motivo: string | null,
): ProblemaMutirao[] {
  if (!TRANSICOES[atual].includes(nova))
    return [
      {
        campo: 'situacao',
        mensagem: `O projeto ${rotuloSituacaoMutirao(atual)} não pode passar a ${rotuloSituacaoMutirao(nova)}.`,
      },
    ];
  if (nova === 'cancelado' && (motivo ?? '').trim().length < 5)
    return [{ campo: 'motivo', mensagem: 'Informe o motivo do cancelamento.' }];
  return [];
}

export function rotuloSituacaoMutirao(s: SituacaoMutirao): string {
  return {
    planejado: 'planejado',
    em_andamento: 'em andamento',
    encerrado: 'encerrado',
    cancelado: 'cancelado',
  }[s];
}

/** O projeto aceita mudança de metas, insumos e fornecedores só antes de encerrar ou cancelar. */
export const projetoEditavel = (s: SituacaoMutirao): boolean => s === 'planejado' || s === 'em_andamento';

export interface MetaEntrada {
  /** O procedimento SIGTAP do procedimento cirúrgico (nulo: o procedimento não tem o SUS correspondente). */
  readonly sigtap: number | null;
  readonly quantidadePrevista: number;
  readonly valorUnitario: number | null;
}

/** Valida a meta: o procedimento precisa do SIGTAP (é por ele que a produção é contada), sem repetir no projeto. */
export function validarMeta(e: MetaEntrada, sigtapsJaNoProjeto: readonly number[]): ProblemaMutirao[] {
  const p: ProblemaMutirao[] = [];
  if (e.sigtap === null)
    p.push({
      campo: 'procedimento',
      mensagem:
        'O procedimento não tem o procedimento SIGTAP correspondente: a meta não teria produção a contar.',
    });
  else if (sigtapsJaNoProjeto.includes(e.sigtap))
    p.push({ campo: 'procedimento', mensagem: 'O projeto já tem meta para este procedimento SIGTAP.' });
  if (!Number.isInteger(e.quantidadePrevista) || e.quantidadePrevista <= 0)
    p.push({
      campo: 'quantidadePrevista',
      mensagem: 'A quantidade prevista é um número inteiro maior que zero.',
    });
  if (e.valorUnitario !== null && !(e.valorUnitario >= 0))
    p.push({ campo: 'valorUnitario', mensagem: 'O valor por procedimento não pode ser negativo.' });
  return p;
}

export interface JustificativaMutirao {
  readonly ativo: boolean;
  readonly aplicaInclusao: boolean;
  readonly aplicaAlteracao: boolean;
  readonly exigeComplemento: boolean;
}

export interface DocumentoSus {
  readonly tipo: TipoDocumentoMutirao;
  /** Situação da AIH ou da APAC. */
  readonly situacao: string;
  /** Data da internação (AIH) ou início da validade (APAC). */
  readonly data: string;
  /** Os procedimentos SIGTAP da conta (principal e demais). */
  readonly sigtaps: readonly number[];
  /** O projeto em que o documento já está marcado (nulo: em nenhum). */
  readonly projetoAtual: number | null;
}

export interface ProjetoParaVinculo {
  readonly id: number;
  readonly situacao: SituacaoMutirao;
  readonly periodoInicio: string;
  readonly periodoFim: string | null;
  readonly sigtapsDasMetas: readonly number[];
}

const DOCUMENTO_SEM_PRODUCAO: Record<TipoDocumentoMutirao, readonly string[]> = {
  aih: ['negada', 'cancelada', 'rejeitada'],
  apac: ['cancelada', 'rejeitada'],
};

/** Situações em que a AIH ou a APAC não conta como produção do projeto. */
export const documentoSemProducao = (tipo: TipoDocumentoMutirao, situacao: string): boolean =>
  DOCUMENTO_SEM_PRODUCAO[tipo].includes(situacao);

const nomeDocumento = (t: TipoDocumentoMutirao) => (t === 'aih' ? 'AIH' : 'APAC');

/**
 * Marca a AIH ou a APAC com o projeto: o projeto em andamento, a data do documento dentro da vigência, ao menos um
 * procedimento do documento entre as metas, o documento valendo como produção e ainda sem outro projeto, e a
 * justificativa ativa de inclusão (com o complemento quando ela exige).
 */
export function conferirVinculo(
  projeto: ProjetoParaVinculo,
  doc: DocumentoSus,
  justificativa: JustificativaMutirao | null,
  complemento: string | null,
): ProblemaMutirao[] {
  const p: ProblemaMutirao[] = [];
  const nome = nomeDocumento(doc.tipo);
  if (projeto.situacao !== 'em_andamento')
    p.push({
      campo: 'projeto',
      mensagem: `Só o projeto em andamento recebe ${nome}; este está ${rotuloSituacaoMutirao(projeto.situacao)}.`,
    });
  if (doc.data < projeto.periodoInicio || (projeto.periodoFim !== null && doc.data > projeto.periodoFim))
    p.push({ campo: 'documento', mensagem: `A data da ${nome} está fora da vigência do projeto.` });
  if (!doc.sigtaps.some((s) => projeto.sigtapsDasMetas.includes(s)))
    p.push({
      campo: 'documento',
      mensagem: `Nenhum procedimento da ${nome} está entre as metas do projeto.`,
    });
  if (documentoSemProducao(doc.tipo, doc.situacao))
    p.push({
      campo: 'documento',
      mensagem: `A ${nome} está ${doc.situacao.replace('_', ' ')}: não conta como produção.`,
    });
  if (doc.projetoAtual !== null)
    p.push({
      campo: 'documento',
      mensagem:
        doc.projetoAtual === projeto.id
          ? `A ${nome} já está marcada neste projeto.`
          : `A ${nome} já está marcada em outro projeto: retire-a de lá antes.`,
    });
  p.push(...conferirJustificativa(justificativa, complemento, 'inclusao'));
  return p;
}

/** A justificativa da inclusão ou da retirada: ativa, aplicável ao uso e com o complemento quando exige. */
export function conferirJustificativa(
  j: JustificativaMutirao | null,
  complemento: string | null,
  uso: 'inclusao' | 'alteracao',
): ProblemaMutirao[] {
  if (!j || !j.ativo) return [{ campo: 'justificativa', mensagem: 'Escolha uma justificativa ativa.' }];
  if (uso === 'inclusao' ? !j.aplicaInclusao : !j.aplicaAlteracao)
    return [
      {
        campo: 'justificativa',
        mensagem:
          uso === 'inclusao'
            ? 'Esta justificativa não serve para incluir no mutirão.'
            : 'Esta justificativa não serve para retirar do mutirão.',
      },
    ];
  if (j.exigeComplemento && (complemento ?? '').trim().length < 5)
    return [{ campo: 'complemento', mensagem: 'Esta justificativa exige o complemento por escrito.' }];
  return [];
}

export interface MetaParaAcompanhar {
  readonly sigtap: number;
  readonly quantidadePrevista: number;
  readonly valorUnitario: number | null;
}

export interface LinhaProducao {
  readonly sigtap: number;
  readonly quantidade: number;
}

export type RitmoMeta = 'atingida' | 'no_ritmo' | 'abaixo_do_ritmo' | 'sem_vigencia';

export interface AcompanhamentoMeta {
  readonly sigtap: number;
  readonly prevista: number;
  readonly realizada: number;
  readonly saldo: number;
  readonly percentual: number;
  /** O esperado até a data, proporcional ao tempo decorrido da vigência. */
  readonly esperadoAteHoje: number | null;
  readonly ritmo: RitmoMeta;
  readonly valorPrevisto: number | null;
  readonly valorRealizado: number | null;
}

export interface AcompanhamentoProjeto {
  readonly metas: readonly AcompanhamentoMeta[];
  readonly prevista: number;
  readonly realizada: number;
  readonly percentual: number;
  readonly valorPrevisto: number;
  readonly valorRealizado: number;
  /** Fração decorrida da vigência (0 a 1), nula sem fim de vigência. */
  readonly decorrido: number | null;
}

const DIA = 86_400_000;
const diaUtc = (s: string) =>
  Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
const centavos = (v: number) => Math.round(v * 100) / 100;

/**
 * A meta contra a produção: por procedimento SIGTAP, a quantidade realizada nas AIH e APAC marcadas com o projeto,
 * o saldo, o percentual e o ritmo (o esperado até hoje é a meta proporcional ao tempo decorrido da vigência).
 */
export function acompanharMetas(
  metas: readonly MetaParaAcompanhar[],
  producao: readonly LinhaProducao[],
  vigencia: { readonly inicio: string; readonly fim: string | null },
  hoje: string,
): AcompanhamentoProjeto {
  const porSigtap = new Map<number, number>();
  for (const l of producao) porSigtap.set(l.sigtap, (porSigtap.get(l.sigtap) ?? 0) + l.quantidade);
  let decorrido: number | null = null;
  if (vigencia.fim !== null) {
    const total = (diaUtc(vigencia.fim) - diaUtc(vigencia.inicio)) / DIA + 1;
    const passados = (diaUtc(hoje) - diaUtc(vigencia.inicio)) / DIA + 1;
    decorrido = Math.min(1, Math.max(0, passados / total));
  }
  const linhas = metas.map((m): AcompanhamentoMeta => {
    const realizada = porSigtap.get(m.sigtap) ?? 0;
    const esperado = decorrido === null ? null : Math.ceil(m.quantidadePrevista * decorrido);
    const ritmo: RitmoMeta =
      realizada >= m.quantidadePrevista
        ? 'atingida'
        : esperado === null
          ? 'sem_vigencia'
          : realizada >= esperado
            ? 'no_ritmo'
            : 'abaixo_do_ritmo';
    return {
      sigtap: m.sigtap,
      prevista: m.quantidadePrevista,
      realizada,
      saldo: Math.max(0, m.quantidadePrevista - realizada),
      percentual: Math.round((realizada / m.quantidadePrevista) * 1000) / 10,
      esperadoAteHoje: esperado,
      ritmo,
      valorPrevisto: m.valorUnitario === null ? null : centavos(m.valorUnitario * m.quantidadePrevista),
      valorRealizado: m.valorUnitario === null ? null : centavos(m.valorUnitario * realizada),
    };
  });
  const prevista = linhas.reduce((s, l) => s + l.prevista, 0);
  const realizada = linhas.reduce((s, l) => s + Math.min(l.realizada, l.prevista), 0);
  return {
    metas: linhas,
    prevista,
    realizada,
    percentual: prevista ? Math.round((realizada / prevista) * 1000) / 10 : 0,
    valorPrevisto: centavos(linhas.reduce((s, l) => s + (l.valorPrevisto ?? 0), 0)),
    valorRealizado: centavos(linhas.reduce((s, l) => s + (l.valorRealizado ?? 0), 0)),
    decorrido,
  };
}
