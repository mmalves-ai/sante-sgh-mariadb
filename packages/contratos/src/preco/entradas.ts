// Entradas das operações de gravação compatível do M12 (ficha, seção 5) e os campos editáveis do contrato do
// convênio (parte pública: nomes no vocabulário do novo; as colunas de TBCONVEN ficam em @sgh/legado).
import { z } from 'zod';
import { textoCp1252 } from '../texto-cp1252.js';
import { ABAS_EDITAVEIS, ITENS_POR_TRANSACAO } from './constantes.js';

const smallint = z.number().int().min(0).max(32767);
export const esquemaDataIso = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD.')
  .refine((d) => {
    const [a, m, dia] = d.split('-').map(Number) as [number, number, number];
    const x = new Date(Date.UTC(a, m - 1, dia));
    return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === dia;
  }, 'Data inexistente.');

/** Justificativa de toda mudança feita pelo novo (vai à SGH_PRECO_AUTORIA e à trilha). */
export const esquemaJustificativa = textoCp1252(200)
  .overwrite((t) => t.trim())
  .pipe(z.string().min(5, 'Escreva a justificativa (ao menos 5 caracteres).'));

export const OPERACOES_SITUACAO_CONVENIO = ['suspender', 'reativar'] as const;
export type OperacaoSituacaoConvenio = (typeof OPERACOES_SITUACAO_CONVENIO)[number];

/** `convenio.alterarSituacao` (suspender A → I; reativar I → A). */
export const esquemaAlterarSituacaoConvenio = z
  .object({
    convenio: smallint,
    operacao: z.enum(OPERACOES_SITUACAO_CONVENIO),
    justificativa: esquemaJustificativa,
  })
  .strict();
export type AlterarSituacaoConvenioEntrada = z.infer<typeof esquemaAlterarSituacaoConvenio>;

// ── Campos editáveis do contrato (temas 1, 2, 13 e 17; ficha, seção 5 `convenio.alterarContrato`) ─────────

export type TipoCampoContrato = 'texto' | 'inteiro' | 'opcao';

export interface CampoContratoEditavel {
  readonly campo: string;
  readonly rotulo: string;
  readonly aba: (typeof ABAS_EDITAVEIS)[number];
  readonly tema: number;
  readonly tipo: TipoCampoContrato;
  /** Texto: bytes CP1252. */
  readonly maxBytes?: number;
  readonly minimo?: number;
  readonly maximo?: number;
  /** Opção: valores aceitos (os vistos no legado; a tela mostra o rótulo). */
  readonly opcoes?: readonly { readonly valor: string; readonly rotulo: string }[];
  /** Opções de uma tabela de referência do legado (a API as lê). */
  readonly opcoesDe?: 'classificacao';
  readonly obrigatorio?: boolean;
}

const t = (
  campo: string,
  rotulo: string,
  maxBytes: number,
  tema = 2,
  aba: CampoContratoEditavel['aba'] = 'cadastro',
): CampoContratoEditavel => ({ campo, rotulo, aba, tema, tipo: 'texto', maxBytes });
const n = (
  campo: string,
  rotulo: string,
  maximo: number,
  tema = 2,
  aba: CampoContratoEditavel['aba'] = 'cadastro',
): CampoContratoEditavel => ({ campo, rotulo, aba, tema, tipo: 'inteiro', minimo: 0, maximo });

export const UFS = [
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
] as const;
const ufs = UFS.map((u) => ({ valor: u, rotulo: u }));

/**
 * Os campos que o novo altera (só colunas que VARIAM entre os convênios ativos: as constantes nunca; regra 6).
 * Ficaram de fora, medidos como constantes nos 44 ativos (2026-10-20): DIA_PAGAMENTO, as colunas de fax, o
 * e-mail de autorização e de nota fiscal, a inscrição estadual da nota e os dados bancários.
 */
export const CAMPOS_CONTRATO: readonly CampoContratoEditavel[] = [
  { campo: 'nome', rotulo: 'Nome', aba: 'cadastro', tema: 1, tipo: 'texto', maxBytes: 75, obrigatorio: true },
  n('cnpj', 'CNPJ', 99999999999999, 1),
  t('inscricaoEstadual', 'Inscrição estadual', 15, 1),
  n('registroAns', 'Registro na ANS', 999999, 1),
  {
    campo: 'classificacao',
    rotulo: 'Classificação',
    aba: 'cadastro',
    tema: 1,
    tipo: 'opcao',
    opcoesDe: 'classificacao',
  },
  t('endereco', 'Endereço', 40),
  n('numero', 'Número', 2147483647),
  t('complemento', 'Complemento', 5),
  t('bairro', 'Bairro', 30),
  t('cidade', 'Cidade', 40),
  { campo: 'uf', rotulo: 'UF', aba: 'cadastro', tema: 2, tipo: 'opcao', opcoes: ufs },
  n('cep', 'CEP', 99999999),
  n('ibge', 'Município (IBGE)', 9999999),
  t('telefone', 'Telefone', 15),
  t('contato', 'Contato', 40),
  t('convenioTelefone', 'Convênio: telefone', 15),
  t('convenioEmail', 'Convênio: e-mail', 100),
  t('convenioContato', 'Convênio: contato', 25),
  t('credenciamentoTelefone', 'Credenciamento: telefone', 15),
  t('credenciamentoEmail', 'Credenciamento: e-mail', 100),
  t('credenciamentoContato', 'Credenciamento: contato', 25),
  t('contasMedicasTelefone', 'Contas médicas: telefone', 15),
  t('contasMedicasEmail', 'Contas médicas: e-mail', 100),
  t('contasMedicasContato', 'Contas médicas: contato', 25),
  t('recursoGlosaTelefone', 'Recurso de glosa: telefone', 15),
  t('recursoGlosaEmail', 'Recurso de glosa: e-mail', 100),
  t('recursoGlosaContato', 'Recurso de glosa: contato', 25),
  t('autorizacaoTelefone', 'Autorização: telefone', 15),
  t('autorizacaoContato', 'Autorização: contato', 25),
  t('nfRazaoSocial', 'Nota fiscal: razão social', 75),
  n('nfCnpj', 'Nota fiscal: CNPJ', 99999999999999),
  t('nfEndereco', 'Nota fiscal: endereço', 40),
  n('nfNumero', 'Nota fiscal: número', 2147483647),
  t('nfBairro', 'Nota fiscal: bairro', 30),
  t('nfCidade', 'Nota fiscal: cidade', 40),
  { campo: 'nfUf', rotulo: 'Nota fiscal: UF', aba: 'cadastro', tema: 2, tipo: 'opcao', opcoes: ufs },
  n('nfCep', 'Nota fiscal: CEP', 99999999),
  t('nfTelefone', 'Nota fiscal: telefone', 15),
  t('nfInscricaoMunicipal', 'Nota fiscal: inscrição municipal', 15),
  n('nfIbge', 'Nota fiscal: município (IBGE)', 9999999),
  {
    campo: 'validaCarteira',
    rotulo: 'Valida a carteira',
    aba: 'faturabilidade',
    tema: 13,
    tipo: 'opcao',
    opcoes: [
      { valor: 'T', rotulo: 'Sim' },
      { valor: 'F', rotulo: 'Não' },
    ],
  },
  {
    campo: 'senhaObrigatoria',
    rotulo: 'Senha de autorização',
    aba: 'faturabilidade',
    tema: 13,
    tipo: 'opcao',
    // Valores vistos no legado (1: 32 convênios; 4: 44); significado a confirmar com o faturamento (DP-33).
    opcoes: [
      { valor: '1', rotulo: '1 (a confirmar)' },
      { valor: '4', rotulo: '4 (a confirmar)' },
    ],
  },
  {
    campo: 'retornoDias',
    rotulo: 'Retorno sem cobrança (dias)',
    aba: 'faturabilidade',
    tema: 13,
    tipo: 'opcao',
    opcoes: ['0', '15', '30', '45'].map((v) => ({ valor: v, rotulo: v })),
  },
  {
    campo: 'prazoPagamentoDias',
    rotulo: 'Prazo de pagamento (dias)',
    aba: 'financeiro',
    tema: 17,
    tipo: 'inteiro',
    minimo: 0,
    maximo: 365,
  },
];

export function campoContrato(campo: string): CampoContratoEditavel | undefined {
  return CAMPOS_CONTRATO.find((c) => c.campo === campo);
}

const valorCampo = z.union([z.string(), z.number(), z.null()]);

/**
 * `convenio.alterarContrato`: os campos alterados (só de uma aba), os valores que a tela leu desses campos
 * (controle otimista: mudou por fora, 409 com os campos) e a justificativa.
 */
export const esquemaAlterarContratoConvenio = z
  .object({
    convenio: smallint,
    aba: z.enum(ABAS_EDITAVEIS),
    valores: z.record(z.string(), valorCampo),
    lidos: z.record(z.string(), valorCampo),
    justificativa: esquemaJustificativa,
  })
  .strict()
  .superRefine((e, ctx) => {
    const nomes = Object.keys(e.valores);
    if (nomes.length === 0) ctx.addIssue({ code: 'custom', path: ['valores'], message: 'Nada a alterar.' });
    for (const nome of nomes) {
      const c = campoContrato(nome);
      const v = e.valores[nome];
      if (!c || c.aba !== e.aba) {
        ctx.addIssue({ code: 'custom', path: ['valores', nome], message: 'Campo não editável nesta aba.' });
        continue;
      }
      if (!(nome in e.lidos))
        ctx.addIssue({ code: 'custom', path: ['lidos', nome], message: 'Falta o valor lido pela tela.' });
      if (v === null || v === '') {
        // Campo de domínio (opção): o vazio gravaria 0 ou '' fora do domínio do legado (CLASSIF_C 1 a 4,
        // VAL_CART F/T, SENHA_OBRIGATORIA_CONV 1/4, UF sem vazio no perfil): só uma das opções.
        if (c.obrigatorio || c.tipo === 'opcao')
          ctx.addIssue({
            code: 'custom',
            path: ['valores', nome],
            message: c.tipo === 'opcao' ? 'Escolha uma das opções.' : 'Campo obrigatório.',
          });
        continue;
      }
      if (c.tipo === 'texto') {
        const r = textoCp1252(c.maxBytes ?? 1).safeParse(String(v));
        if (!r.success)
          ctx.addIssue({
            code: 'custom',
            path: ['valores', nome],
            message: 'Texto inválido ou longo demais.',
          });
      } else if (c.tipo === 'inteiro') {
        const x = typeof v === 'number' ? v : Number(v);
        if (!Number.isSafeInteger(x) || x < (c.minimo ?? 0) || x > (c.maximo ?? 0))
          ctx.addIssue({ code: 'custom', path: ['valores', nome], message: 'Número fora da faixa.' });
      } else if (c.opcoes && !c.opcoes.some((o) => o.valor === String(v))) {
        ctx.addIssue({ code: 'custom', path: ['valores', nome], message: 'Valor fora das opções.' });
      }
    }
  });
export type AlterarContratoConvenioEntrada = z.infer<typeof esquemaAlterarContratoConvenio>;

// ── Reajuste e desfazer (TBVLRTHM) ─────────────────────────────────────────────────────────────────────

const valor = z.number().finite().min(0);
export const esquemaComponentes = z
  .object({ ch: valor, co: valor, filme: valor, anes: valor, outros: valor })
  .strict();
export type ComponentesPreco = z.infer<typeof esquemaComponentes>;

export const esquemaItemReajuste = z
  .object({
    codigo: z.number().int().min(1).max(2147483647),
    /** A vigência em que o cálculo se apoiou (null: primeiro preço); reconferida sob a trava. */
    base: z.object({ vigencia: esquemaDataIso, valores: esquemaComponentes }).strict().nullable(),
    novos: esquemaComponentes,
  })
  .strict();

export const MODOS_REAJUSTE = ['percentual', 'valor', 'arquivo'] as const;

export const esquemaReajustar = z
  .object({
    tabela: smallint,
    data: esquemaDataIso,
    lote: z.string().regex(/^[A-Za-z0-9-]{8,40}$/),
    parte: z.number().int().min(1),
    partes: z.number().int().min(1),
    modo: z.enum(MODOS_REAJUSTE),
    percentual: z.number().finite().nullable(),
    origem: z.enum(['reajuste', 'importacao']),
    carga: z.number().int().min(1).nullable(),
    justificativa: esquemaJustificativa,
    confirmacoes: z.object({ tabelaCompartilhada: z.boolean(), percentualTabela: z.boolean() }).strict(),
    itens: z.array(esquemaItemReajuste).min(1).max(ITENS_POR_TRANSACAO),
  })
  .strict()
  .superRefine((e, ctx) => {
    if (e.parte > e.partes) ctx.addIssue({ code: 'custom', path: ['parte'], message: 'Parte fora do lote.' });
    const cods = new Set(e.itens.map((i) => i.codigo));
    if (cods.size !== e.itens.length)
      ctx.addIssue({ code: 'custom', path: ['itens'], message: 'Itens repetidos.' });
    if ((e.modo === 'percentual') !== (e.percentual !== null))
      ctx.addIssue({ code: 'custom', path: ['percentual'], message: 'Percentual só no modo percentual.' });
  });
export type ReajustarEntrada = z.infer<typeof esquemaReajustar>;

export const esquemaDesfazerReajuste = z
  .object({
    tabela: smallint,
    data: esquemaDataIso,
    lote: z.string().regex(/^[A-Za-z0-9-]{8,40}$/),
    parte: z.number().int().min(1),
    partes: z.number().int().min(1),
    justificativa: esquemaJustificativa,
    itens: z
      .array(z.object({ codigo: z.number().int().min(1), valores: esquemaComponentes }).strict())
      .min(1)
      .max(ITENS_POR_TRANSACAO),
  })
  .strict();
export type DesfazerReajusteEntrada = z.infer<typeof esquemaDesfazerReajuste>;
