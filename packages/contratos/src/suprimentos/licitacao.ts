// Licitação, pregão e compras públicas (ficha do M55, etapa 4, `M55-F4`; seções 4, 6, 7 e 8; regras 9, 10 e 12;
// cap-07 §7.3; DP-13): o processo formal de compra pela Lei 14.133/2021 ou pelo regulamento próprio de compras, do
// termo de referência à ata: itens, pesquisa de preços (o valor estimado com as parcelas), parecer jurídico, edital e
// publicação do aviso (o prazo mínimo em dias úteis), sessão com propostas e lances, julgamento e habilitação, recurso,
// homologação pela autoridade (outra pessoa), ata e o pedido de compra que nasce dela. Só do novo (SGH_SUP_LICITACAO*):
// o sistema anterior não tem dado de licitação (as 13 tabelas GC* estão vazias). Construído e DESLIGADO por
// estabelecimento (chave `licitacao`, POL-3), ligado pelo administrador quando houver unidade pública. Nenhuma
// publicação externa (portal de transparência, PNCP) é feita daqui: a publicação é registrada com o veículo e o número
// de controle informados (regra 12). Vocabulário do produto; o mesmo Zod na tela, na API e na gravação.
import { z } from 'zod';
import { esquemaChaveAto } from '../enfermagem/entradas.js';
import { textoCp1252 } from '../texto-cp1252.js';
import { idBanco } from '../validacao/id-banco.js';

/** A chave de liberação por estabelecimento (ficha, seções 8 e 12; DP-13). */
export const CHAVE_LIBERACAO_LICITACAO = 'licitacao';

export const REGIMES_LICITACAO = [
  { codigo: 'lei-14133', rotulo: 'Lei 14.133/2021 (administração pública)' },
  { codigo: 'regulamento', rotulo: 'Regulamento próprio de compras' },
] as const;
export type RegimeLicitacao = (typeof REGIMES_LICITACAO)[number]['codigo'];
const CODIGOS_REGIME = REGIMES_LICITACAO.map((t) => t.codigo) as [RegimeLicitacao, ...RegimeLicitacao[]];

/** As modalidades (Lei 14.133, art. 28) e a contratação direta (arts. 74 e 75); a cotação prévia é do regulamento. */
export const MODALIDADES_LICITACAO = [
  { codigo: 'pregao-eletronico', rotulo: 'Pregão eletrônico', direta: false },
  { codigo: 'pregao-presencial', rotulo: 'Pregão presencial', direta: false },
  { codigo: 'concorrencia', rotulo: 'Concorrência', direta: false },
  { codigo: 'concurso', rotulo: 'Concurso', direta: false },
  { codigo: 'leilao', rotulo: 'Leilão', direta: false },
  { codigo: 'dialogo', rotulo: 'Diálogo competitivo', direta: false },
  { codigo: 'cotacao-previa', rotulo: 'Cotação prévia de preços (regulamento próprio)', direta: false },
  { codigo: 'dispensa', rotulo: 'Dispensa de licitação', direta: true },
  { codigo: 'inexigibilidade', rotulo: 'Inexigibilidade de licitação', direta: true },
] as const;
export type ModalidadeLicitacao = (typeof MODALIDADES_LICITACAO)[number]['codigo'];
const CODIGOS_MODALIDADE = MODALIDADES_LICITACAO.map((t) => t.codigo) as [
  ModalidadeLicitacao,
  ...ModalidadeLicitacao[],
];

/** Os critérios de julgamento (Lei 14.133, art. 33). */
export const CRITERIOS_JULGAMENTO = [
  { codigo: 'menor-preco', rotulo: 'Menor preço' },
  { codigo: 'maior-desconto', rotulo: 'Maior desconto' },
  { codigo: 'tecnica-preco', rotulo: 'Técnica e preço' },
  { codigo: 'melhor-tecnica', rotulo: 'Melhor técnica' },
  { codigo: 'maior-lance', rotulo: 'Maior lance (leilão)' },
  { codigo: 'maior-retorno', rotulo: 'Maior retorno econômico' },
] as const;
export type CriterioJulgamento = (typeof CRITERIOS_JULGAMENTO)[number]['codigo'];
const CODIGOS_CRITERIO = CRITERIOS_JULGAMENTO.map((t) => t.codigo) as [
  CriterioJulgamento,
  ...CriterioJulgamento[],
];

/** A natureza do objeto (define o prazo mínimo do aviso, art. 55). */
export const NATUREZAS_OBJETO_LICITACAO = [
  { codigo: 'bens', rotulo: 'Aquisição de bens' },
  { codigo: 'servico-comum', rotulo: 'Serviço comum' },
  { codigo: 'servico-especial', rotulo: 'Serviço especial' },
  { codigo: 'obra-comum', rotulo: 'Obra ou serviço comum de engenharia' },
  { codigo: 'obra-especial', rotulo: 'Obra ou serviço especial de engenharia' },
] as const;
export type NaturezaObjetoLicitacao = (typeof NATUREZAS_OBJETO_LICITACAO)[number]['codigo'];
const CODIGOS_NATUREZA = NATUREZAS_OBJETO_LICITACAO.map((t) => t.codigo) as [
  NaturezaObjetoLicitacao,
  ...NaturezaObjetoLicitacao[],
];

/**
 * As etapas do processo (SGH_SUP_LICITACAO.ETAPA). A contratação direta pula o edital, a publicação e o recurso;
 * homologado, fracassado, deserto, revogado e anulado são finais.
 */
export const ETAPAS_LICITACAO = [
  { codigo: 'planejamento', rotulo: 'Termo de referência' },
  { codigo: 'pesquisa', rotulo: 'Pesquisa de preços' },
  { codigo: 'edital', rotulo: 'Edital e parecer jurídico' },
  { codigo: 'publicado', rotulo: 'Aviso publicado' },
  { codigo: 'sessao', rotulo: 'Sessão: propostas e lances' },
  { codigo: 'julgado', rotulo: 'Julgado: prazo de recurso' },
  { codigo: 'recurso', rotulo: 'Recurso em análise' },
  { codigo: 'homologado', rotulo: 'Homologado' },
  { codigo: 'fracassado', rotulo: 'Fracassado' },
  { codigo: 'deserto', rotulo: 'Deserto' },
  { codigo: 'revogado', rotulo: 'Revogado' },
  { codigo: 'anulado', rotulo: 'Anulado' },
] as const;
export type EtapaLicitacao = (typeof ETAPAS_LICITACAO)[number]['codigo'];
export const CODIGOS_ETAPA_LICITACAO = ETAPAS_LICITACAO.map((t) => t.codigo) as [
  EtapaLicitacao,
  ...EtapaLicitacao[],
];
export const ETAPAS_FINAIS_LICITACAO: readonly EtapaLicitacao[] = [
  'homologado',
  'fracassado',
  'deserto',
  'revogado',
  'anulado',
];

/** As fontes da pesquisa de preços (Lei 14.133, art. 23 §1, I a V). */
export const FONTES_PRECO = [
  { codigo: 'painel', rotulo: 'Painel de preços ou banco de preços oficial' },
  { codigo: 'similar', rotulo: 'Contratação similar de outro órgão ou entidade' },
  { codigo: 'midia', rotulo: 'Mídia especializada, tabela de referência ou sítio eletrônico' },
  { codigo: 'fornecedor', rotulo: 'Cotação direta com fornecedor' },
  { codigo: 'nota-fiscal', rotulo: 'Nota fiscal de compra anterior' },
] as const;
export type FontePreco = (typeof FONTES_PRECO)[number]['codigo'];
const CODIGOS_FONTE = FONTES_PRECO.map((t) => t.codigo) as [FontePreco, ...FontePreco[]];

/** Como o valor estimado do item sai dos preços pesquisados. */
export const METODOS_ESTIMATIVA = [
  { codigo: 'mediana', rotulo: 'Mediana dos preços' },
  { codigo: 'media', rotulo: 'Média dos preços' },
  { codigo: 'menor', rotulo: 'Menor preço pesquisado' },
] as const;
export type MetodoEstimativa = (typeof METODOS_ESTIMATIVA)[number]['codigo'];
export const CODIGOS_METODO_ESTIMATIVA = METODOS_ESTIMATIVA.map((t) => t.codigo) as [
  MetodoEstimativa,
  ...MetodoEstimativa[],
];

/** A situação da proposta no julgamento e na habilitação. */
export const SITUACOES_PROPOSTA = [
  { codigo: 'valida', rotulo: 'Válida' },
  { codigo: 'desclassificada', rotulo: 'Desclassificada' },
  { codigo: 'inabilitada', rotulo: 'Inabilitada' },
] as const;
export type SituacaoProposta = (typeof SITUACOES_PROPOSTA)[number]['codigo'];
const CODIGOS_SITUACAO_PROPOSTA = SITUACOES_PROPOSTA.map((t) => t.codigo) as [
  SituacaoProposta,
  ...SituacaoProposta[],
];

/** O resultado do item no julgamento. */
export const RESULTADOS_ITEM_LICITACAO = [
  { codigo: 'adjudicavel', rotulo: 'Vencedor definido' },
  { codigo: 'empate', rotulo: 'Empate: desempate necessário' },
  { codigo: 'fracassado', rotulo: 'Fracassado (nenhuma proposta válida)' },
  { codigo: 'deserto', rotulo: 'Deserto (nenhuma proposta)' },
] as const;
export type ResultadoItemLicitacao = (typeof RESULTADOS_ITEM_LICITACAO)[number]['codigo'];

/** Os veículos da publicação registrada (nenhum envio externo daqui: regra 12). */
export const VEICULOS_PUBLICACAO = [
  { codigo: 'pncp', rotulo: 'Portal Nacional de Contratações Públicas' },
  { codigo: 'diario-oficial', rotulo: 'Diário oficial' },
  { codigo: 'jornal', rotulo: 'Jornal de grande circulação' },
  { codigo: 'sitio', rotulo: 'Sítio eletrônico da instituição' },
] as const;
export type VeiculoPublicacao = (typeof VEICULOS_PUBLICACAO)[number]['codigo'];
const CODIGOS_VEICULO = VEICULOS_PUBLICACAO.map((t) => t.codigo) as [
  VeiculoPublicacao,
  ...VeiculoPublicacao[],
];

/** Os eventos do processo (SGH_SUP_LICITACAO_EVENTO.TIPO), só de inclusão. */
export const TIPOS_EVENTO_LICITACAO = [
  { codigo: 'etapa', rotulo: 'Mudança de etapa' },
  { codigo: 'parecer', rotulo: 'Parecer jurídico' },
  { codigo: 'publicacao', rotulo: 'Publicação do aviso' },
  { codigo: 'esclarecimento', rotulo: 'Pedido de esclarecimento ou impugnação respondido' },
  { codigo: 'recurso', rotulo: 'Recurso interposto' },
  { codigo: 'decisao-recurso', rotulo: 'Decisão do recurso' },
  { codigo: 'documento', rotulo: 'Documento do processo' },
  { codigo: 'ata', rotulo: 'Ata' },
  { codigo: 'pedido', rotulo: 'Pedido de compra gerado' },
] as const;
export type TipoEventoLicitacao = (typeof TIPOS_EVENTO_LICITACAO)[number]['codigo'];
export const CODIGOS_EVENTO_LICITACAO = TIPOS_EVENTO_LICITACAO.map((t) => t.codigo) as [
  TipoEventoLicitacao,
  ...TipoEventoLicitacao[],
];

/** O peso máximo da técnica no critério técnica e preço (Lei 14.133, art. 36 §2). */
export const PESO_TECNICA_MAXIMO = 70;
/** O teto da lista paginada e de itens por processo. */
export const TETO_LISTA_LICITACOES = 200;
export const TETO_ITENS_LICITACAO = 200;

const id = idBanco;
const idSgh = idBanco;
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.');
const livre = (max: number) => textoCp1252(max).overwrite((t) => t.replace(/\s+/g, ' ').trim());
const opcional = (max: number) =>
  livre(max)
    .nullable()
    .default(null)
    .transform((t) => (t ? t : null));
const minimo = (max: number, min: number, msg: string) => livre(max).refine((t) => t.length >= min, msg);
const casas = (n: number, k: number) => Math.abs(n * 10 ** k - Math.round(n * 10 ** k)) < 1e-6;
/** Valor unitário: até 4 casas (NUMERIC(15,4)). */
const unitario = z
  .number()
  .positive('Informe um valor maior que zero.')
  .max(99_999_999_999)
  .refine((n) => casas(n, 4), { message: 'No máximo 4 casas decimais.' });
const quantidade = z
  .number()
  .positive('Informe a quantidade.')
  .max(999_999_999_999)
  .refine((n) => casas(n, 3), { message: 'No máximo 3 casas decimais.' });
const login = z
  .string()
  .trim()
  .min(1, 'Escolha o usuário.')
  .max(31)
  .regex(/^[^\s'"]+$/, 'Usuário inválido.');
const versao = z.number().int().nonnegative();

// ── suprimentos.criarLicitacao / alterarLicitacao (termo de referência) ─────────────────────────────────────────

export const esquemaItemLicitacao = z
  .object({
    descricao: minimo(400, 3, 'Descreva o item.'),
    /** O item do cadastro de estoque (código), quando houver. */
    itemEstoque: id.nullable().default(null),
    unidade: livre(10).refine((t) => t.length >= 1, 'Informe a unidade.'),
    quantidade,
  })
  .strict();
export type ItemLicitacaoEntrada = z.infer<typeof esquemaItemLicitacao>;

const camposTermo = {
  regime: z.enum(CODIGOS_REGIME),
  modalidade: z.enum(CODIGOS_MODALIDADE),
  criterio: z.enum(CODIGOS_CRITERIO).default('menor-preco'),
  natureza: z.enum(CODIGOS_NATUREZA),
  objeto: minimo(400, 10, 'Descreva o objeto (10 letras ou mais).'),
  /** A justificativa da necessidade (estudo técnico preliminar resumido). */
  justificativa: minimo(2000, 20, 'Justifique a necessidade (20 letras ou mais).'),
  /** O fundamento legal da contratação direta (ex.: art. 75, II). */
  fundamento: opcional(200),
  /** O peso da técnica no critério técnica e preço, em % (até 70). */
  pesoTecnica: z.number().int().min(0).max(PESO_TECNICA_MAXIMO).nullable().default(null),
  /** Orçamento sigiloso até o julgamento (Lei 14.133, art. 24). */
  sigiloso: z.boolean().default(false),
  /** O agente de contratação ou pregoeiro (login). */
  agente: login,
  centroCusto: id.nullable().default(null),
  itens: z
    .array(esquemaItemLicitacao)
    .min(1, 'Inclua ao menos um item.')
    .max(TETO_ITENS_LICITACAO, `No máximo ${TETO_ITENS_LICITACAO} itens por processo.`),
};

interface TermoRefinado {
  modalidade: ModalidadeLicitacao;
  criterio: CriterioJulgamento;
  regime: RegimeLicitacao;
  fundamento: string | null;
  pesoTecnica: number | null;
}
const refinarTermo = <T extends z.ZodType<TermoRefinado>>(s: T) =>
  s
    .refine(
      (c) => !['dispensa', 'inexigibilidade'].includes(c.modalidade) || (c.fundamento ?? '').length >= 3,
      { message: 'Informe o fundamento legal da contratação direta.', path: ['fundamento'] },
    )
    .refine((c) => c.criterio !== 'tecnica-preco' || (c.pesoTecnica !== null && c.pesoTecnica > 0), {
      message: 'Informe o peso da técnica (até 70%).',
      path: ['pesoTecnica'],
    })
    .refine((c) => (c.modalidade === 'leilao') === (c.criterio === 'maior-lance'), {
      message: 'O leilão é julgado pelo maior lance, e só ele.',
      path: ['criterio'],
    })
    .refine(
      (c) => !c.modalidade.startsWith('pregao') || ['menor-preco', 'maior-desconto'].includes(c.criterio),
      {
        message: 'O pregão é julgado pelo menor preço ou pelo maior desconto.',
        path: ['criterio'],
      },
    )
    .refine((c) => c.modalidade !== 'cotacao-previa' || c.regime === 'regulamento', {
      message: 'A cotação prévia é do regulamento próprio de compras.',
      path: ['modalidade'],
    });

export const esquemaCriarLicitacao = refinarTermo(
  z
    .object({
      chave: esquemaChaveAto,
      /** O número do processo (único por estabelecimento; ex.: 12/2026). */
      numero: minimo(30, 1, 'Informe o número do processo.'),
      ...camposTermo,
    })
    .strict(),
);
export type CriarLicitacaoEntrada = z.infer<typeof esquemaCriarLicitacao>;

/** A alteração do termo pela versão; os itens só mudam no termo de referência (antes da pesquisa de preços). */
export const esquemaAlterarLicitacao = refinarTermo(z.object({ versao, ...camposTermo }).strict());
export type AlterarLicitacaoEntrada = z.infer<typeof esquemaAlterarLicitacao>;

// ── suprimentos.registrarPrecoLicitacao (pesquisa de preços) ─────────────────────────────────────────────────────

export const esquemaRegistrarPrecoLicitacao = z
  .object({
    chave: esquemaChaveAto,
    versao,
    /** O item (SGH_SUP_LICITACAO_ITEM.ID). */
    item: idSgh,
    fonte: z.enum(CODIGOS_FONTE),
    /** De onde veio: o órgão, o sítio, o fornecedor ou a nota (identificação do documento). */
    referencia: minimo(200, 3, 'Diga de onde veio o preço.'),
    valor: unitario,
    data: dataIso,
    /** O fornecedor consultado (cadastro de fornecedores), na cotação direta. */
    fornecedor: id.nullable().default(null),
  })
  .strict()
  .refine((p) => p.fonte !== 'fornecedor' || p.fornecedor !== null, {
    message: 'Escolha o fornecedor consultado.',
    path: ['fornecedor'],
  });
export type RegistrarPrecoLicitacaoEntrada = z.infer<typeof esquemaRegistrarPrecoLicitacao>;

// ── suprimentos.descartarPrecoLicitacao (pesquisa) ───────────────────────────────────────────────────────────────

/**
 * O descarte de um preço registrado (IN SEGES 65/2021, art. 6º §3º: o preço inexequível, excessivo ou digitado errado
 * sai da conta com a justificativa). Só na etapa da pesquisa; o preço continua gravado e visível, marcado.
 */
export const esquemaDescartarPrecoLicitacao = z
  .object({
    chave: esquemaChaveAto,
    versao,
    justificativa: minimo(1000, 20, 'Justifique o descarte (20 letras ou mais).'),
  })
  .strict();
export type DescartarPrecoLicitacaoEntrada = z.infer<typeof esquemaDescartarPrecoLicitacao>;

// ── suprimentos.registrarPropostaLicitacao (sessão) ──────────────────────────────────────────────────────────────

export const esquemaRegistrarPropostaLicitacao = z
  .object({
    chave: esquemaChaveAto,
    versao,
    item: idSgh,
    fornecedor: id,
    /** O valor unitário da proposta (ou o desconto em %, no maior desconto). */
    valor: unitario,
    /** O último lance (pregão e leilão). */
    lance: unitario.nullable().default(null),
    /** A nota técnica de 0 a 100 (técnica e preço, melhor técnica). */
    notaTecnica: z.number().min(0).max(100).nullable().default(null),
    marca: opcional(100),
  })
  .strict();
export type RegistrarPropostaLicitacaoEntrada = z.infer<typeof esquemaRegistrarPropostaLicitacao>;

/** Desclassificar, inabilitar ou revalidar uma proposta (o motivo é obrigatório para tirar do julgamento). */
export const esquemaSituacaoPropostaLicitacao = z
  .object({
    versao,
    situacao: z.enum(CODIGOS_SITUACAO_PROPOSTA),
    motivo: opcional(400),
  })
  .strict()
  .refine((p) => p.situacao === 'valida' || (p.motivo ?? '').length >= 10, {
    message: 'Diga o motivo (10 letras ou mais).',
    path: ['motivo'],
  });
export type SituacaoPropostaLicitacaoEntrada = z.infer<typeof esquemaSituacaoPropostaLicitacao>;

// ── suprimentos.avancarLicitacao (etapas) ────────────────────────────────────────────────────────────────────────

const baseEtapa = { chave: esquemaChaveAto, versao };

export const esquemaAvancarLicitacao = z.discriminatedUnion('para', [
  z
    .object({
      ...baseEtapa,
      para: z.literal('pesquisa'),
    })
    .strict(),
  z
    .object({
      ...baseEtapa,
      para: z.literal('edital'),
      /** Por que há item com menos preços que o mínimo (a pesquisa excepcional, justificada). */
      justificativaPesquisa: opcional(1000),
    })
    .strict(),
  z
    .object({
      ...baseEtapa,
      para: z.literal('publicado'),
      dataPublicacao: dataIso,
      dataAbertura: dataIso,
      veiculo: z.enum(CODIGOS_VEICULO),
      /** O número de controle ou a edição em que saiu (informado; nada é enviado daqui). */
      referencia: minimo(100, 3, 'Informe o número de controle ou a edição da publicação.'),
    })
    .strict()
    .refine((p) => p.dataAbertura > p.dataPublicacao, {
      message: 'A abertura é depois da publicação.',
      path: ['dataAbertura'],
    }),
  z
    .object({
      ...baseEtapa,
      para: z.literal('sessao'),
      /** Na contratação direta (que pula o edital): por que há item com menos preços que o mínimo. */
      justificativaPesquisa: opcional(1000),
    })
    .strict(),
  z
    .object({
      ...baseEtapa,
      para: z.literal('julgado'),
      /** O desempate escolhido por item empatado (art. 60), com a justificativa. */
      desempates: z
        .array(z.object({ item: idSgh, fornecedor: id }).strict())
        .max(TETO_ITENS_LICITACAO)
        .default([]),
      justificativaDesempate: opcional(1000),
    })
    .strict(),
  z
    .object({
      ...baseEtapa,
      para: z.enum(['fracassado', 'deserto']),
      justificativa: minimo(1000, 20, 'Justifique (20 letras ou mais).'),
    })
    .strict(),
]);
export type AvancarLicitacaoEntrada = z.infer<typeof esquemaAvancarLicitacao>;

/** A homologação pela autoridade competente (pessoa diferente do agente e de quem julgou). */
export const esquemaHomologarLicitacao = z
  .object({
    chave: esquemaChaveAto,
    versao,
    observacao: opcional(1000),
  })
  .strict();
export type HomologarLicitacaoEntrada = z.infer<typeof esquemaHomologarLicitacao>;

/** Revogação (interesse público, art. 71 II) ou anulação (ilegalidade, art. 71 III), pela autoridade. */
export const esquemaEncerrarLicitacao = z
  .object({
    chave: esquemaChaveAto,
    versao,
    para: z.enum(['revogado', 'anulado']),
    justificativa: minimo(1000, 20, 'Justifique (20 letras ou mais).'),
  })
  .strict();
export type EncerrarLicitacaoEntrada = z.infer<typeof esquemaEncerrarLicitacao>;

// ── suprimentos.registrarEventoLicitacao ─────────────────────────────────────────────────────────────────────────

const baseEvento = { chave: esquemaChaveAto, versao };
const documento = idSgh.nullable().default(null);

export const esquemaRegistrarEventoLicitacao = z.discriminatedUnion('tipo', [
  z
    .object({
      ...baseEvento,
      tipo: z.literal('parecer'),
      data: dataIso,
      /** Favorável ou com ressalvas; o desfavorável impede a publicação. */
      resultado: z.enum(['favoravel', 'ressalvas', 'desfavoravel']),
      descricao: minimo(1000, 10, 'Resuma o parecer (10 letras ou mais).'),
      documento,
    })
    .strict(),
  z
    .object({
      ...baseEvento,
      tipo: z.literal('esclarecimento'),
      data: dataIso,
      descricao: minimo(1000, 10, 'Resuma o pedido e a resposta (10 letras ou mais).'),
      documento,
    })
    .strict(),
  z
    .object({
      ...baseEvento,
      tipo: z.literal('recurso'),
      data: dataIso,
      /** O licitante que recorre (cadastro de fornecedores). */
      fornecedor: id,
      descricao: minimo(1000, 10, 'Resuma as razões do recurso (10 letras ou mais).'),
      documento,
    })
    .strict(),
  z
    .object({
      ...baseEvento,
      tipo: z.literal('decisao-recurso'),
      data: dataIso,
      /** Provido: o julgamento é refeito (volta à sessão); não provido: segue para a homologação. */
      resultado: z.enum(['provido', 'nao-provido']),
      descricao: minimo(1000, 10, 'Resuma a decisão (10 letras ou mais).'),
      documento,
    })
    .strict(),
  z
    .object({
      ...baseEvento,
      tipo: z.literal('documento'),
      data: dataIso,
      descricao: minimo(1000, 3, 'Diga que documento é.'),
      documento: idSgh,
    })
    .strict(),
  z
    .object({
      ...baseEvento,
      tipo: z.literal('ata'),
      data: dataIso,
      /** O número da ata (da sessão ou de registro de preços). */
      referencia: minimo(100, 1, 'Informe o número da ata.'),
      /** A validade da ata de registro de preços (até 1 ano, prorrogável: art. 84), quando houver. */
      validade: dataIso.nullable().default(null),
      descricao: livre(1000).default(''),
      documento,
    })
    .strict(),
  z
    .object({
      ...baseEvento,
      tipo: z.literal('pedido'),
      /** O pedido de compra gerado a partir do resultado (pelo ID do cabeçalho). */
      pedido: id,
      descricao: livre(1000).default(''),
    })
    .strict(),
]);
export type RegistrarEventoLicitacaoEntrada = z.infer<typeof esquemaRegistrarEventoLicitacao>;

export const esquemaFiltroLicitacoes = z
  .object({
    etapa: z.enum(CODIGOS_ETAPA_LICITACAO).optional(),
    modalidade: z.enum(CODIGOS_MODALIDADE).optional(),
    termo: livre(60).optional(),
    pagina: z.number().int().min(1).max(10_000).default(1),
  })
  .strict();
export type FiltroLicitacoes = z.infer<typeof esquemaFiltroLicitacoes>;

// ── Leituras ────────────────────────────────────────────────────────────────────────────────────────────────────

/** O processo como gravado (SGH_SUP_LICITACAO). */
export interface LicitacaoGravada {
  readonly id: number;
  readonly numero: string;
  readonly regime: RegimeLicitacao;
  readonly modalidade: ModalidadeLicitacao;
  readonly criterio: CriterioJulgamento;
  readonly natureza: NaturezaObjetoLicitacao;
  readonly objeto: string;
  readonly justificativa: string;
  readonly fundamento: string | null;
  readonly pesoTecnica: number | null;
  readonly sigiloso: boolean;
  readonly metodoEstimativa: MetodoEstimativa;
  readonly valorEstimado: number | null;
  readonly agente: string;
  readonly centroCusto: number | null;
  readonly etapa: EtapaLicitacao;
  readonly dataPublicacao: string | null;
  readonly dataAbertura: string | null;
  readonly dataJulgamento: string | null;
  readonly julgadoPor: string | null;
  readonly homologadoPor: string | null;
  readonly homologadoEm: string | null;
  readonly versao: number;
  readonly usuario: string;
  readonly criadoEm: string;
}

export interface PrecoPesquisado {
  readonly id: number;
  readonly item: number;
  readonly fonte: FontePreco;
  readonly referencia: string;
  readonly valor: number;
  readonly data: string;
  readonly fornecedor: number | null;
  readonly usuario: string;
  /** O descarte com a justificativa (fora da estimativa e do mínimo de preços), ou nulo. */
  readonly descarte: DescartePreco | null;
}

export interface DescartePreco {
  readonly justificativa: string;
  readonly usuario: string;
  readonly em: string;
}

export interface PropostaLicitacao {
  readonly id: number;
  readonly item: number;
  readonly fornecedor: number;
  readonly fornecedorNome: string;
  readonly valor: number;
  readonly lance: number | null;
  readonly notaTecnica: number | null;
  readonly marca: string | null;
  readonly situacao: SituacaoProposta;
  readonly motivo: string | null;
}

export interface ItemLicitacao {
  readonly id: number;
  readonly numero: number;
  readonly descricao: string;
  readonly itemEstoque: number | null;
  readonly unidade: string;
  readonly quantidade: number;
  /** O valor unitário estimado (da pesquisa); nulo antes dela. */
  readonly valorEstimado: number | null;
  readonly resultado: ResultadoItemLicitacao | null;
  readonly vencedor: number | null;
  readonly valorAdjudicado: number | null;
}

export interface EventoLicitacao {
  readonly id: number;
  readonly tipo: TipoEventoLicitacao;
  readonly de: EtapaLicitacao | null;
  readonly para: EtapaLicitacao | null;
  readonly data: string | null;
  readonly veiculo: VeiculoPublicacao | null;
  readonly referencia: string | null;
  readonly fornecedor: number | null;
  readonly resultado: string | null;
  readonly pedido: number | null;
  readonly documento: number | null;
  readonly descricao: string;
  readonly usuario: string;
  readonly criadoEm: string;
}

/** A estimativa de um item com as parcelas impressas (os preços usados e a conta). */
export interface EstimativaItem {
  readonly item: number;
  readonly metodo: MetodoEstimativa;
  readonly precos: readonly number[];
  readonly quantidadePrecos: number;
  readonly valorUnitario: number | null;
  readonly quantidade: number;
  readonly valorTotal: number | null;
  readonly conta: string;
  readonly abaixoDoMinimo: boolean;
}

export interface EstimativaLicitacao {
  readonly itens: readonly EstimativaItem[];
  readonly valorTotal: number | null;
  readonly conta: string;
  readonly minimoPrecos: number;
  readonly itensAbaixoDoMinimo: number;
}

export interface ClassificacaoProposta {
  readonly proposta: number;
  readonly fornecedor: number;
  readonly valorFinal: number;
  readonly pontuacao: number | null;
  readonly posicao: number | null;
  readonly situacao: SituacaoProposta | 'acima-estimado';
  readonly motivo: string | null;
  readonly avisoInexequivel: boolean;
}

export interface JulgamentoItem {
  readonly item: number;
  readonly resultado: ResultadoItemLicitacao;
  readonly vencedor: number | null;
  readonly valorUnitario: number | null;
  readonly valorTotal: number | null;
  readonly empatados: readonly number[];
  readonly classificacao: readonly ClassificacaoProposta[];
}

export interface JulgamentoLicitacao {
  readonly itens: readonly JulgamentoItem[];
  readonly valorTotal: number;
  readonly conta: string;
  readonly empates: number;
  readonly fracassados: number;
  readonly desertos: number;
}

export interface AvisoLicitacao {
  readonly codigo: string;
  readonly mensagem: string;
}

/** A próxima ação possível e por que não, se bloqueada (a tela mostra o motivo). */
export interface AcaoLicitacao {
  readonly acao: EtapaLicitacao | 'homologar' | 'revogar';
  readonly pode: boolean;
  readonly motivo: string | null;
}

export interface LicitacaoResumo {
  readonly id: number;
  readonly numero: string;
  readonly regime: RegimeLicitacao;
  readonly modalidade: ModalidadeLicitacao;
  readonly criterio: CriterioJulgamento;
  readonly objeto: string;
  readonly etapa: EtapaLicitacao;
  readonly agente: string;
  readonly valorEstimado: number | null;
  readonly dataAbertura: string | null;
  readonly itens: number;
  readonly versao: number;
}

export interface LicitacaoDetalhe extends LicitacaoResumo {
  readonly processo: LicitacaoGravada;
  readonly itensDetalhe: readonly ItemLicitacao[];
  readonly precos: readonly PrecoPesquisado[];
  readonly propostas: readonly PropostaLicitacao[];
  readonly eventos: readonly EventoLicitacao[];
  readonly estimativa: EstimativaLicitacao;
  /** A prévia do julgamento (na sessão) ou o resultado gravado (depois). */
  readonly julgamento: JulgamentoLicitacao | null;
  readonly acoes: readonly AcaoLicitacao[];
  readonly avisos: readonly AvisoLicitacao[];
  /** Os dias úteis restantes do prazo de recurso (julgado), ou nulo. */
  readonly prazoRecursoAte: string | null;
  readonly hoje: string;
  /** Os feriados do calendário do estabelecimento (AAAA-MM-DD; ano 9999 = todo ano), para a tela contar os prazos. */
  readonly feriados: readonly string[];
}

export interface PainelLicitacoes {
  readonly porEtapa: Readonly<Partial<Record<EtapaLicitacao, number>>>;
  readonly emAndamento: number;
  readonly sessoesProximas: number;
}

/** Um pedido de compra marcado como licitação no cadastro de pedidos (a consulta da ficha, seção 4). */
export interface PedidoMarcadoLicitacao {
  readonly pedido: number | null;
  readonly ano: number;
  readonly documento: number;
  readonly sequencia: number;
  readonly descricao: string;
  readonly fornecedor: number | null;
  readonly data: string | null;
}

/** As regras do estabelecimento (parâmetros `licitacao.*`, SGH_CFG_PARAMETRO), resolvidas para a regra pura. */
export interface ParametrosLicitacao {
  readonly minimoPrecos: number;
  readonly metodoEstimativa: MetodoEstimativa;
  readonly prazoRecursoDiasUteis: number;
  readonly prazoAvisoRegulamentoDiasUteis: number;
  readonly exigeParecer: boolean;
  /** Limite da dispensa por valor (art. 75, I e II), em reais. */
  readonly limiteDispensaObras: number;
  readonly limiteDispensaDemais: number;
}

export const PARAMETROS_LICITACAO_PADRAO: ParametrosLicitacao = {
  minimoPrecos: 3,
  metodoEstimativa: 'mediana',
  prazoRecursoDiasUteis: 3,
  prazoAvisoRegulamentoDiasUteis: 5,
  exigeParecer: true,
  limiteDispensaObras: 125_451.15,
  limiteDispensaDemais: 62_725.59,
};
