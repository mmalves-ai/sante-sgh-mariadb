// 02-CAD linha 24: regra própria de cada plano (ou categoria) da fonte pagadora na recepção. A regra diz o que a
// recepção tem de conferir ao abrir o atendimento: carteira (com tamanho e prefixo), validade da carteira, titular,
// guia, senha de autorização, código de validação, documentos pedidos e a orientação ao atendente; o teto de
// atendimentos do beneficiário no período (alerta por padrão, bloqueio quando o contrato pede) e a pendência do plano
// (contrato suspenso, cobertura em revisão: alerta ou bloqueio, sempre com o motivo).
// Regras puras, sem banco: a porta lê as regras vigentes, escolhe a mais específica por aqui e aplica a crítica na
// mesma transação da abertura. Nada se apaga: a regra trocada encerra a vigência, e a trilha guarda o antes.

/** Pendência do plano na recepção. */
export const PENDENCIAS_PLANO = ['nenhuma', 'alerta', 'bloqueio'] as const;
export type PendenciaPlano = (typeof PENDENCIAS_PLANO)[number];

export const LIMITE_TAMANHO_CARTEIRA = 30;
export const LIMITE_PREFIXO_CARTEIRA = 10;
export const LIMITE_PERIODO_TETO_DIAS = 366;

/** A regra como a porta a entrega (vocabulário neutro: booleanos, datas AAAA-MM-DD, ids). */
export interface RegraPlano {
  readonly id: number;
  readonly fontePagadoraId: number;
  readonly planoId: number | null;
  readonly categoriaId: number | null;
  readonly estabelecimentoId: number | null;
  readonly exigeCarteira: boolean;
  readonly exigeValidadeCarteira: boolean;
  readonly exigeTitular: boolean;
  readonly exigeGuia: boolean;
  readonly exigeSenhaAutorizacao: boolean;
  readonly exigeCodigoValidacao: boolean;
  readonly tamanhoCarteira: number | null;
  readonly prefixoCarteira: string | null;
  readonly permiteDependentes: boolean;
  readonly prazoRetornoDias: number | null;
  readonly documentosExigidos: readonly string[];
  readonly orientacaoRecepcao: string | null;
  readonly tetoAtendimentos: number | null;
  readonly tetoPeriodoDias: number | null;
  readonly tetoBloqueia: boolean;
  readonly pendencia: PendenciaPlano;
  readonly pendenciaMotivo: string | null;
  readonly vigenciaInicio: string;
  readonly vigenciaFim: string | null;
}

/** A proposta de regra que a tela manda (sem id nem fonte, que vêm da rota). */
export type PropostaRegraPlano = Omit<RegraPlano, 'id' | 'fontePagadoraId'>;

/** Erros por campo, para a tela marcar na hora. */
export type ErrosRegraPlano = Record<string, string>;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Validação da proposta, antes de gravar (a porta repete na transação; a tela usa na hora). */
export function validarRegraPlano(p: PropostaRegraPlano): ErrosRegraPlano {
  const e: Record<string, string> = {};
  if (!DATA.test(p.vigenciaInicio)) e['vigenciaInicio'] = 'Informe o início da vigência.';
  if (p.vigenciaFim !== null && (!DATA.test(p.vigenciaFim) || p.vigenciaFim < p.vigenciaInicio))
    e['vigenciaFim'] = 'O fim da vigência não pode ser antes do início.';
  if (p.tamanhoCarteira !== null && (p.tamanhoCarteira < 1 || p.tamanhoCarteira > LIMITE_TAMANHO_CARTEIRA))
    e['tamanhoCarteira'] = `O tamanho da carteira vai de 1 a ${LIMITE_TAMANHO_CARTEIRA} caracteres.`;
  if (p.prefixoCarteira !== null) {
    const pre = p.prefixoCarteira.trim();
    if (pre === '' || pre.length > LIMITE_PREFIXO_CARTEIRA || !/^[0-9A-Za-z]+$/.test(pre))
      e['prefixoCarteira'] = `O prefixo tem de 1 a ${LIMITE_PREFIXO_CARTEIRA} letras ou números.`;
    else if (p.tamanhoCarteira !== null && pre.length > p.tamanhoCarteira)
      e['prefixoCarteira'] = 'O prefixo não pode ser maior que a carteira.';
  }
  if ((p.tamanhoCarteira !== null || p.prefixoCarteira !== null) && !p.exigeCarteira)
    e['exigeCarteira'] = 'Tamanho e prefixo só valem com a carteira exigida.';
  if (p.exigeValidadeCarteira && !p.exigeCarteira)
    e['exigeValidadeCarteira'] = 'A validade da carteira só vale com a carteira exigida.';
  if ((p.tetoAtendimentos === null) !== (p.tetoPeriodoDias === null))
    e['tetoAtendimentos'] = 'Informe o teto e o período juntos.';
  else if (p.tetoAtendimentos !== null && p.tetoAtendimentos < 1)
    e['tetoAtendimentos'] = 'O teto é de pelo menos 1 atendimento.';
  else if (
    p.tetoPeriodoDias !== null &&
    (p.tetoPeriodoDias < 1 || p.tetoPeriodoDias > LIMITE_PERIODO_TETO_DIAS)
  )
    e['tetoPeriodoDias'] = `O período do teto vai de 1 a ${LIMITE_PERIODO_TETO_DIAS} dias.`;
  if (p.tetoBloqueia && p.tetoAtendimentos === null)
    e['tetoBloqueia'] = 'O bloqueio pelo teto pede o teto informado.';
  if (!(PENDENCIAS_PLANO as readonly string[]).includes(p.pendencia))
    e['pendencia'] = 'Pendência desconhecida.';
  else if (p.pendencia !== 'nenhuma' && !(p.pendenciaMotivo ?? '').trim())
    e['pendenciaMotivo'] = 'Informe o motivo da pendência: a recepção o lê na abertura.';
  if (p.prazoRetornoDias !== null && (p.prazoRetornoDias < 1 || p.prazoRetornoDias > 365))
    e['prazoRetornoDias'] = 'O prazo de retorno vai de 1 a 365 dias.';
  const docs = p.documentosExigidos.map((d) => d.trim());
  if (docs.some((d) => d === '' || d.length > 80))
    e['documentosExigidos'] = 'Cada documento tem de 1 a 80 caracteres.';
  else if (new Set(docs.map((d) => d.toUpperCase())).size !== docs.length)
    e['documentosExigidos'] = 'Documento repetido na lista.';
  if ((p.orientacaoRecepcao ?? '').length > 2000)
    e['orientacaoRecepcao'] = 'A orientação tem até 2000 caracteres.';
  return e;
}

/** O que a abertura sabe para escolher a regra. */
export interface ChaveRegraPlano {
  readonly planoId: number | null;
  readonly planoSuperiorId: number | null;
  readonly categoriaId: number | null;
  readonly estabelecimentoId: number;
  /** AAAA-MM-DD. */
  readonly data: string;
}

const vigente = (r: RegraPlano, d: string) =>
  r.vigenciaInicio <= d && (r.vigenciaFim === null || r.vigenciaFim >= d);

/**
 * A regra mais específica vigente na data. Peso: plano exato > plano superior > regra de toda a fonte; depois a
 * categoria exata sobre a regra de todas as categorias; depois o estabelecimento da sessão sobre o de todos. Empate:
 * o início de vigência mais recente. Regra de outro plano, categoria ou estabelecimento não se aplica.
 */
export function escolherRegraPlano(regras: readonly RegraPlano[], c: ChaveRegraPlano): RegraPlano | null {
  let melhor: { r: RegraPlano; peso: number } | null = null;
  for (const r of regras) {
    if (!vigente(r, c.data)) continue;
    let peso = 0;
    if (r.planoId !== null) {
      if (c.planoId !== null && r.planoId === c.planoId) peso += 200;
      else if (c.planoSuperiorId !== null && r.planoId === c.planoSuperiorId) peso += 100;
      else continue;
    }
    if (r.categoriaId !== null) {
      if (r.categoriaId !== c.categoriaId) continue;
      peso += 20;
    }
    if (r.estabelecimentoId !== null) {
      if (r.estabelecimentoId !== c.estabelecimentoId) continue;
      peso += 2;
    }
    if (!melhor || peso > melhor.peso || (peso === melhor.peso && r.vigenciaInicio > melhor.r.vigenciaInicio))
      melhor = { r, peso };
  }
  return melhor?.r ?? null;
}

/** Os dados da abertura que a regra confere. Campo ausente no fluxo (undefined) vira pendência de conferência. */
export interface DadosAberturaPlano {
  /** AAAA-MM-DD da abertura. */
  readonly data: string;
  readonly carteira: string | null;
  readonly validadeCarteira: string | null;
  readonly guia: string | null;
  readonly senhaAutorizacao: string | null;
  readonly validadeSenha: string | null;
  /** Nome do titular; undefined quando o fluxo não o colhe. */
  readonly titular?: string | null;
  /** Código de validação do beneficiário (token); undefined quando o fluxo não o colhe. */
  readonly codigoValidacao?: string | null;
  /** O beneficiário é dependente; undefined quando não se sabe. */
  readonly dependente?: boolean;
  /** Atendimentos do paciente na mesma fonte (e plano) dentro do período do teto, sem contar este. */
  readonly atendimentosNoPeriodo: number;
}

export interface CriticaPlano {
  readonly codigo: string;
  /** Campo da abertura que recebe a crítica. */
  readonly campo: string;
  readonly mensagem: string;
}

export interface ResultadoCriticaPlano {
  readonly bloqueios: readonly CriticaPlano[];
  readonly alertas: readonly CriticaPlano[];
  readonly documentos: readonly string[];
  readonly orientacao: string | null;
}

const vazio = (v: string | null | undefined) => (v ?? '').trim() === '';

/** A crítica da regra do plano na abertura: bloqueios recusam a abertura; alertas voltam para a recepção. */
export function criticarAberturaPlano(r: RegraPlano | null, d: DadosAberturaPlano): ResultadoCriticaPlano {
  if (!r) return { bloqueios: [], alertas: [], documentos: [], orientacao: null };
  const b: CriticaPlano[] = [];
  const a: CriticaPlano[] = [];
  const c = (codigo: string, campo: string, mensagem: string) => ({ codigo, campo, mensagem });
  const carteira = (d.carteira ?? '').replace(/[\s.-]/g, '');
  if (r.exigeCarteira) {
    if (carteira === '')
      b.push(c('carteira-obrigatoria', 'matricula', 'O plano exige o número da carteira.'));
    else {
      if (r.tamanhoCarteira !== null && carteira.length !== r.tamanhoCarteira)
        b.push(
          c(
            'carteira-tamanho',
            'matricula',
            `A carteira deste plano tem ${r.tamanhoCarteira} caracteres (informados ${carteira.length}).`,
          ),
        );
      if (r.prefixoCarteira !== null && !carteira.toUpperCase().startsWith(r.prefixoCarteira.toUpperCase()))
        b.push(c('carteira-prefixo', 'matricula', `A carteira deste plano começa por ${r.prefixoCarteira}.`));
    }
  }
  if (r.exigeValidadeCarteira) {
    if (vazio(d.validadeCarteira))
      b.push(c('validade-carteira-obrigatoria', 'validadeCarteira', 'O plano exige a validade da carteira.'));
    else if ((d.validadeCarteira as string) < d.data)
      b.push(c('carteira-vencida', 'validadeCarteira', 'A carteira está vencida.'));
  }
  if (r.exigeGuia && vazio(d.guia)) b.push(c('guia-obrigatoria', 'guia', 'O plano exige o número da guia.'));
  if (r.exigeSenhaAutorizacao) {
    if (vazio(d.senhaAutorizacao))
      b.push(c('senha-obrigatoria', 'senhaConvenio', 'O plano exige a senha de autorização.'));
    else if (!vazio(d.validadeSenha) && (d.validadeSenha as string) < d.data)
      b.push(c('senha-vencida', 'validadeSenha', 'A senha de autorização está vencida.'));
  }
  if (r.exigeTitular && vazio(d.titular))
    a.push(c('titular-conferir', 'matricula', 'Confira o titular da carteira: o plano exige.'));
  if (r.exigeCodigoValidacao && vazio(d.codigoValidacao))
    a.push(
      c(
        'codigo-validacao-conferir',
        'matricula',
        'Confira o código de validação do beneficiário: o plano exige.',
      ),
    );
  if (!r.permiteDependentes && d.dependente === true)
    b.push(c('dependente-nao-aceito', 'matricula', 'O plano não aceita carteira de dependente.'));
  if (r.tetoAtendimentos !== null && d.atendimentosNoPeriodo >= r.tetoAtendimentos) {
    const m = `Teto do plano atingido: ${d.atendimentosNoPeriodo} atendimento(s) em ${r.tetoPeriodoDias} dia(s), teto ${r.tetoAtendimentos}.`;
    (r.tetoBloqueia ? b : a).push(c('teto-plano', 'convenio', m));
  }
  if (r.pendencia !== 'nenhuma') {
    const m = `Plano com pendência: ${r.pendenciaMotivo ?? ''}`.trim();
    (r.pendencia === 'bloqueio' ? b : a).push(c('plano-pendente', 'convenio', m));
  }
  return {
    bloqueios: b,
    alertas: a,
    documentos: [...r.documentosExigidos],
    orientacao: r.orientacaoRecepcao,
  };
}

/** Primeiro dia do período do teto (inclusive), contado para trás a partir da data da abertura. */
export function inicioPeriodoTeto(data: string, dias: number): string {
  const d = new Date(`${data}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (dias - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Encerramento da vigência: nunca antes do início, nunca antes da véspera de hoje (o passado não muda) e nunca numa
 * regra que já terminou antes de hoje.
 */
export function validarEncerramentoRegraPlano(
  inicio: string,
  fimAtual: string | null,
  fimNovo: string,
  hoje: string,
): ErrosRegraPlano {
  if (!DATA.test(fimNovo)) return { vigenciaFim: 'Informe a data do fim da vigência.' };
  if (fimAtual !== null && fimAtual < hoje)
    return { vigenciaFim: 'A regra já terminou: o histórico não muda.' };
  if (fimNovo < inicio) return { vigenciaFim: 'O fim da vigência não pode ser antes do início.' };
  if (fimNovo < inicioPeriodoTeto(hoje, 2))
    return { vigenciaFim: 'O fim da vigência vai no máximo até a véspera de hoje.' };
  return {};
}
