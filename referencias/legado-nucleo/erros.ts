// Erros do legado em Problem Details (RFC 9457; cap-09 §9.6; ref 01 §4.5). Mensagem crua do Firebird
// nunca chega à tela: validação, CHECK e exceção de trigger viram 409 em português; o resto, 500
// genérico. O log leva o código e a mensagem sanitizada (sem valor de coluna, sem literal).
//
// O driver nativo não expõe o gdscode (só a mensagem formatada pelo fbclient; spike do M02). O código é
// lido de `gdscode`/`gdsCode` quando o driver o traz (plano B, node-firebird) ou deduzido do texto fixo
// da mensagem do fbclient 3.0 para os três códigos tratados.

export const GDS_VALIDACAO = 335544347; // isc_not_valid
export const GDS_CHECK = 335544558; // isc_check_constraint
export const GDS_EXCECAO = 335544517; // isc_except
export const GDS_CANCELADO = 335544794; // isc_cancelled
export const GDS_LOCK_CONFLITO = 335544345; // isc_lock_conflict
export const GDS_DEADLOCK = 335544336; // isc_deadlock
export const GDS_SEM_PERMISSAO = 335544352; // isc_no_priv

const POR_MENSAGEM: readonly (readonly [RegExp, number])[] = [
  [/^\s*validation error for /im, GDS_VALIDACAO],
  [/^\s*Operation violates CHECK constraint /im, GDS_CHECK],
  [/^\s*exception \d+/im, GDS_EXCECAO],
  [/^\s*operation was cancelled/im, GDS_CANCELADO],
  [/^\s*lock conflict on no wait transaction/im, GDS_LOCK_CONFLITO],
  [/^\s*deadlock/im, GDS_DEADLOCK],
  [/^\s*no permission for /im, GDS_SEM_PERMISSAO],
];

// Falhas da conexão (rede, servidor, anexo encerrado): a conexão não volta ao pool.
const CONEXAO_PERDIDA =
  /connection shutdown|Error (?:writing data to|reading data from) the connection|connection (?:lost|rejected|reset)|network error|Unable to complete network request|lost connection|connection is not valid/i;

/** O erro indica conexão perdida (o pool descarta a conexão em vez de reaproveitá-la)? */
export function erroDeConexao(erro: unknown): boolean {
  const msg = erro instanceof Error ? erro.message : typeof erro === 'string' ? erro : '';
  return CONEXAO_PERDIDA.test(msg);
}

/** gdscode do erro do driver (propriedade, ou deduzido da mensagem); null se desconhecido. */
export function gdscodeDe(erro: unknown): number | null {
  if (erro && typeof erro === 'object') {
    const o = erro as Record<string, unknown>;
    for (const k of ['gdscode', 'gdsCode']) {
      if (typeof o[k] === 'number') return o[k];
    }
    const msg = typeof o['message'] === 'string' ? o['message'] : '';
    for (const [re, codigo] of POR_MENSAGEM) if (re.test(msg)) return codigo;
  }
  return null;
}

/**
 * Mensagem do Firebird sem dado: corta valores ("value ..."), literais entre aspas simples e a linha de
 * texto livre da exceção (que pode trazer dado); ficam os nomes de objeto entre aspas duplas.
 */
export function sanitizarMensagemFirebird(mensagem: string): string {
  const linhas = mensagem
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '');
  const saida: string[] = [];
  for (const [i, l] of linhas.entries()) {
    // Na exceção (exception N / -NOME / -texto livre), o texto livre pode citar dado: fica de fora.
    if (i >= 2 && /^-?exception \d+/i.test(linhas[0] ?? '')) break;
    saida.push(
      l
        .replace(/(\bvalue\b\s*)(?:"[^"]*"|\S.*)$/i, '$1<omitido>')
        .replace(/(from string)\s+.*$/i, '$1 <omitido>')
        .replace(/'(?:[^']|'')*'/g, "'<omitido>'")
        .slice(0, 200),
    );
  }
  return saida.slice(0, 4).join(' | ');
}

/** RFC 9457. */
export interface ProblemDetails {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly codigo?: string;
}

export interface ErroTraduzido {
  readonly problema: ProblemDetails;
  /** Para o log (pino): sem dado pessoal. */
  readonly log: { readonly gdscode: number | null; readonly mensagem: string };
}

const BASE = 'https://sgh.invalid/problemas/';

/** M32 (ficha, seção 5): exceções dos gatilhos do financeiro → recusa em português (o novo confere antes). */
export const EXCECOES_FINANCEIRO: readonly (readonly [RegExp, string, string, string])[] = [
  [
    /\bE_EXC_MFCONPAG_PAGO\b/i,
    'titulo-pago',
    'Título pago',
    'Título pago não se apaga: registre o estorno com o motivo. Nada foi gravado.',
  ],
  [
    /\bE_FIN_SALDO_FECHADO\b/i,
    'saldo-fechado',
    'Saldo bancário fechado',
    'O período tem o saldo bancário fechado para esta conta: escolha outra data. Nada foi gravado.',
  ],
  [
    /\bE_MFCONPAG\b/i,
    'titulo-pago',
    'Título já pago',
    'O título já foi pago ou o pagamento está sem a conta bancária. Nada foi gravado.',
  ],
  [
    /\bE_FIN_TP_LANCAMENTO\b/i,
    'tipo-lancamento',
    'Tipo de lançamento incoerente',
    'O tipo de lançamento não confere com o tipo de credor. Nada foi gravado.',
  ],
  [
    /\bE_GERAL_TBCBOPRO_INEXISTENTE\b|\bE_GERAL_ID_PROFIS_INVALIDO\b|\bE_GERAL_FIN_TIPO_DIFERENTE\b/i,
    'profissional-invalido',
    'Profissional incoerente',
    'O profissional não confere com o credor do título de médico. Nada foi gravado.',
  ],
  [
    /\bE_MFCTAREC1\b/i,
    'titulo-ligado-a-conta',
    'Título ligado a conta',
    'O título a receber está ligado a uma conta do faturamento e não se apaga. Nada foi gravado.',
  ],
  [
    /\bE_MFCTAREC\b|\bE_MFLANCTO_MFCTAREC_COENCER\b/i,
    'periodo-contabil-bloqueado',
    'Período bloqueado na contabilidade',
    'O período do documento está bloqueado na contabilidade. Nada foi gravado.',
  ],
  [
    /\bE_FIN_PGTO_NAO_AUTORIZADO\b/i,
    'pagamento-nao-autorizado',
    'Pagamento não autorizado',
    'O parâmetro de autorização eletrônica está ligado nesta empresa e o pagamento não tem a autorização. Nada foi gravado.',
  ],
];

/** M28 (ficha, seção 5, "Exceções de trigger traduzidas"): exceção do gatilho do estoque → recusa em português. */
export const EXCECOES_ESTOQUE: readonly (readonly [RegExp, string, string, string])[] = [
  [
    /\bE_GERAL_EST_DOC_CONSOL\b/i,
    'documento-consolidado',
    'Documento já consolidado',
    'O documento já foi consolidado: não aceita item novo nem volta atrás. Use a devolução ou o estorno. Nada foi gravado.',
  ],
  [
    /\bE_GERAL_EST_SEM_LANC_CONSOL\b/i,
    'itens-nao-consolidados',
    'Documento sem itens consolidados',
    'O documento só fecha com todos os itens consolidados. Nada foi gravado.',
  ],
  [
    /\bE_GEITENS_SEM_ESTOQUE\b/i,
    'saldo-insuficiente',
    'Saldo insuficiente',
    'O item não tem saldo suficiente: outro usuário pode ter consumido o saldo agora. Releia o saldo. Nada foi gravado.',
  ],
  [
    /\bE_GEITENS_SEM_TOTAL\b/i,
    'sem-valor-estoque',
    'Item sem valor em estoque',
    'O item está sem valor em estoque e a saída não pode ser valorizada. Nada foi gravado.',
  ],
  [
    /\bE_VLRMED_LANSAI\b/i,
    'valor-invalido',
    'Valor do item fora do aceito',
    'O valor do item ficaria negativo ou com unitário acima do limite. Nada foi gravado.',
  ],
  [
    /\bE_SEM_CONTA_CONVENIO\b/i,
    'sem-conta-convenio',
    'Paciente sem conta aberta',
    'O paciente não tem conta aberta para receber o material: abra ou reabra a conta antes. Nada foi gravado.',
  ],
  [
    /\bE_GERAL_EST_QTDE_LOTE\b|\bE_GERASVALSAIDLOTE1\b/i,
    'soma-dos-lotes',
    'Lotes não conferem',
    'A soma das quantidades por lote tem de ser igual à quantidade do item. Nada foi gravado.',
  ],
  [
    /\bE_GERAL_NUMERO_DOC\b/i,
    'numero-informado',
    'Número de documento',
    'O número do documento é dado pelo sistema na gravação. Nada foi gravado.',
  ],
  [
    /\bE_GECADSAI1\b/i,
    'sem-centro-custo',
    'Sem centro de custo',
    'Informe o centro de custo da saída. Nada foi gravado.',
  ],
  [/\bE_GECADSAI2\b/i, 'sem-local', 'Sem local de estoque', 'Informe o local de estoque. Nada foi gravado.'],
  [
    /\bE_GECADSAI5\b/i,
    'troca-de-prontuario',
    'Troca de paciente',
    'A saída já gravada não pode passar para outro paciente. Nada foi gravado.',
  ],
  [
    /\bE_GERAL_ID_PROFIS_INVALIDO\b/i,
    'profissional-invalido',
    'Profissional inválido',
    'O profissional informado não confere com o conselho. Nada foi gravado.',
  ],
  [
    /\bE_GERAL_EST_LANC_CONSOL\b|\bE_GELANSAI1\b/i,
    'item-consolidado',
    'Item já consolidado',
    'O item já foi consolidado e não pode ser alterado nem excluído. Nada foi gravado.',
  ],
];

export function problemaDoLegado(erro: unknown): ErroTraduzido {
  const gdscode = gdscodeDe(erro);
  const bruta = erro instanceof Error ? erro.message : String(erro);
  const log = { gdscode, mensagem: sanitizarMensagemFirebird(bruta) };
  const conflito = (codigo: string, title: string, detail: string): ErroTraduzido => ({
    problema: { type: BASE + codigo, title, status: 409, detail, codigo },
    log,
  });
  switch (gdscode) {
    case GDS_VALIDACAO:
      return conflito(
        'legado-validacao',
        'Dado recusado pelo sistema legado',
        'Um dos campos tem valor que o sistema legado não aceita. Confira os campos e tente de novo.',
      );
    case GDS_CHECK:
      return conflito(
        'legado-regra',
        'Regra do sistema legado não atendida',
        'A gravação não atende a uma regra do sistema legado. Confira os dados e tente de novo.',
      );
    case GDS_EXCECAO:
      // M10 (regras 1 e 16): as duas exceções do banco que a tela explica com a saída certa.
      if (/\bE_GERAL_VALOR_CHAVE\b/i.test(bruta))
        return conflito(
          'chave-imutavel',
          'Código em uso não muda',
          'O código de um item já gravado não muda: inative este item e crie outro com o código novo. Nada foi gravado.',
        );
      if (/\bE_EXC_NAO_PERMITIDA\b/i.test(bruta))
        return conflito(
          'exclusao-nao-permitida',
          'Exclusão não permitida',
          'Este registro não pode ser excluído: bloqueie ou inative. Nada foi gravado.',
        );
      // M22: a suspensão do registro clínico pela metade (TRG_PRCABEVOL_BIU, exceção E_PRCABEVOL1).
      if (/\bE_PRCABEVOL1\b/i.test(bruta))
        return conflito(
          'suspensao-incompleta',
          'Suspensão incompleta',
          'A suspensão do registro exige quem suspende, quando e a justificativa, juntos. Nada foi gravado.',
        );
      // M24: a suspensão da prescrição pela metade (TRG_PRPRESC_BIU, exceção E_PRPRESC1).
      if (/\bE_PRPRESC1\b/i.test(bruta))
        return conflito(
          'suspensao-incompleta',
          'Suspensão incompleta',
          'A suspensão da prescrição exige quem suspende, quando e a justificativa, juntos. Nada foi gravado.',
        );
      // M30: as exceções de TRG_FCCTAEXT_BIU (o novo faz o pré-voo antes; o gatilho recusa de novo quando a conta mudou
      // por fora entre a leitura e o salvar). O texto cru do banco nunca chega à tela.
      if (/\bE_FCCTAEXT1\b/i.test(bruta))
        return conflito(
          'procedimento-fora-da-tabela',
          'Procedimento fora da tabela do convênio',
          'O procedimento solicitado não está na tabela de honorários do convênio da conta: corrija antes de fechar. Nada foi gravado.',
        );
      if (/\bE_FCCTAEXT2\b/i.test(bruta))
        return conflito(
          'titulo-inexistente',
          'Título a receber inexistente',
          'O título a receber ligado à conta não existe: corrija antes de fechar. Nada foi gravado.',
        );
      // M21: as exceções dos gatilhos da internação que a tela explica (o novo confere antes; o gatilho, de novo).
      if (/\bEX_CHECA_LEITO\b/i.test(bruta))
        return conflito(
          'leito-ocupado',
          'Leito ocupado',
          'Leito ocupado em outro terminal: escolha outro leito no mapa. Nada foi gravado.',
        );
      if (/\bE_LOC_EXISTENTE_SEM_SAIDA\b/i.test(bruta))
        return conflito(
          'periodo-aberto',
          'Período de leito aberto',
          'O paciente já tem um período de leito aberto nesta internação: feche o atual antes. Nada foi gravado.',
        );
      if (/\bE_RICADINT3\b/i.test(bruta))
        return conflito(
          'isolamento-incompativel',
          'Acomodação com isolamento',
          'A acomodação tem paciente em isolamento: escolha outra acomodação. Nada foi gravado.',
        );
      if (/\bE_RICADINT4\b/i.test(bruta))
        return conflito(
          'sexo-incompativel',
          'Acomodação de outro sexo',
          'A acomodação recebe pacientes de outro sexo: escolha outra acomodação. Nada foi gravado.',
        );
      // M28: as exceções dos gatilhos do estoque (o novo confere antes; o gatilho recusa de novo quando outro usuário
      // consumiu o saldo no meio). Texto em português, sem o nome da exceção.
      for (const [re, codigo, titulo, detalhe] of EXCECOES_ESTOQUE)
        if (re.test(bruta)) return conflito(codigo, titulo, detalhe);
      // M32: as exceções dos gatilhos do financeiro (a mais específica antes: E_MFCONPAG1 e E_MFCONPAG2 ficam no genérico).
      for (const [re, codigo, titulo, detalhe] of EXCECOES_FINANCEIRO)
        if (re.test(bruta)) return conflito(codigo, titulo, detalhe);
      return conflito(
        'legado-recusa',
        'Operação recusada pelo sistema legado',
        'O sistema legado recusou a operação por uma regra de negócio. Nada foi gravado.',
      );
    default:
      return {
        problema: {
          type: BASE + 'erro-interno',
          title: 'Erro interno',
          status: 500,
          detail: 'Não foi possível concluir a operação. Nada foi gravado. Tente de novo ou avise o suporte.',
          codigo: 'erro-interno',
        },
        log,
      };
  }
}
