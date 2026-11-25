// 02-REC linha 33: regras puras do cadastro da estrutura da recepção (ponto de recepção, guichês e serviços de
// senha, que são os botões do totem). O hospital novo monta a recepção pela tela: aqui ficam as validações que valem
// antes de gravar (a porta as aplica na mesma transação, com o estado lido do banco) e as sugestões que poupam
// digitação (código, prefixo, próximo guichê, ordem do botão). Nada aqui apaga: desativar é o único caminho, e só
// sem atendimento em curso naquele item.

/** Recusa de uma proposta de cadastro: o campo, um código estável e o texto para a tela. */
export interface RecusaEstrutura {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}

const recusar = (campo: string, codigo: string, mensagem: string): RecusaEstrutura => ({
  campo,
  codigo,
  mensagem,
});

/** Texto sem acento, em maiúsculas, para comparar nomes e montar sugestões. */
export const semAcento = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();

const mesmoTexto = (a: string, b: string): boolean => semAcento(a) === semAcento(b);

export const TIPOS_SERVICO_SENHA = ['geral', 'diverso'] as const;
export type TipoServicoSenha = (typeof TIPOS_SERVICO_SENHA)[number];

export const LIMITE_GUICHE = 999;
export const LIMITE_SENHAS_DIA = 9999;
export const LIMITE_ORDEM_BOTAO = 999;

// ── ponto de recepção ────────────────────────────────────────────────────────────────────────────────────

export interface PontoProposto {
  readonly codigo: string;
  readonly descricao: string;
  /** Texto impresso no comprovante da senha; null: nenhum. */
  readonly textoSenha: string | null;
}

export interface PontoExistente {
  readonly id: number;
  readonly codigo: string;
  readonly descricao: string;
}

/** Recusas da inclusão ou da alteração de um ponto de recepção (`id` é o do ponto alterado; null na inclusão). */
export function recusasDoPonto(
  p: PontoProposto,
  existentes: readonly PontoExistente[],
  id: number | null = null,
): RecusaEstrutura[] {
  const r: RecusaEstrutura[] = [];
  const outros = existentes.filter((x) => x.id !== id);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/.test(p.codigo))
    r.push(
      recusar('codigo', 'codigo-invalido', 'O código tem de 1 a 30 letras, números, ponto, hífen ou traço.'),
    );
  else if (outros.some((x) => mesmoTexto(x.codigo, p.codigo)))
    r.push(recusar('codigo', 'codigo-repetido', 'Já existe uma recepção com este código.'));
  const d = p.descricao.trim();
  if (d.length < 3 || d.length > 150)
    r.push(recusar('descricao', 'descricao-invalida', 'O nome da recepção tem de 3 a 150 caracteres.'));
  else if (outros.some((x) => mesmoTexto(x.descricao, d)))
    r.push(recusar('descricao', 'descricao-repetida', 'Já existe uma recepção com este nome.'));
  if (p.textoSenha !== null && p.textoSenha.length > 500)
    r.push(recusar('textoSenha', 'texto-longo', 'O texto impresso na senha tem até 500 caracteres.'));
  return r;
}

/** Código sugerido para a recepção nova, pelo nome (único entre os usados). */
export function codigoSugerido(descricao: string, usados: readonly string[]): string {
  const base =
    semAcento(descricao)
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'RECEPCAO';
  const tem = (c: string) => usados.some((u) => mesmoTexto(u, c));
  if (!tem(base)) return base;
  for (let n = 2; n < 1000; n++) if (!tem(`${base}-${n}`)) return `${base}-${n}`;
  return base;
}

// ── guichê ───────────────────────────────────────────────────────────────────────────────────────────────

export interface GuicheProposto {
  readonly numero: number;
  readonly descricao: string | null;
}

/** Recusas do guichê: número de 1 a 999, único no ponto de recepção (os inativos também contam). */
export function recusasDoGuiche(
  g: GuicheProposto,
  existentes: readonly { readonly id: number; readonly numero: number }[],
  id: number | null = null,
): RecusaEstrutura[] {
  const r: RecusaEstrutura[] = [];
  if (!Number.isInteger(g.numero) || g.numero < 1 || g.numero > LIMITE_GUICHE)
    r.push(recusar('numero', 'numero-invalido', `O número do guichê vai de 1 a ${LIMITE_GUICHE}.`));
  else if (existentes.some((x) => x.id !== id && x.numero === g.numero))
    r.push(recusar('numero', 'numero-repetido', 'Este número de guichê já existe nesta recepção.'));
  if (g.descricao !== null && g.descricao.trim().length > 150)
    r.push(recusar('descricao', 'descricao-invalida', 'A descrição do guichê tem até 150 caracteres.'));
  return r;
}

/** O menor número de guichê livre no ponto (preenche o campo da inclusão). */
export function proximoGuiche(numeros: readonly number[]): number {
  const usados = new Set(numeros);
  for (let n = 1; n <= LIMITE_GUICHE; n++) if (!usados.has(n)) return n;
  return LIMITE_GUICHE;
}

// ── serviço de senha (botão do totem) ────────────────────────────────────────────────────────────────────

export interface ServicoProposto {
  /** Letras antes do número da senha (1 a 3). */
  readonly prefixo: string;
  readonly descricao: string;
  readonly tipo: string;
  /** O botão emite senha prioritária. */
  readonly prioritaria: boolean;
  /** Código do grupo de prioridade legal das senhas do botão; null: nenhum. */
  readonly grupoPrioridade: string | null;
  /** Máximo de senhas por dia; null: sem limite. */
  readonly limiteDia: number | null;
  /** Posição do botão no totem e no balcão (menor aparece antes); null: depois dos ordenados, pelo nome. */
  readonly ordemBotao: number | null;
}

export interface ServicoJaCadastrado {
  readonly id: number;
  readonly prefixo: string;
  readonly descricao: string;
}

/** Recusas do serviço de senha. `gruposAtivos`: códigos dos grupos de prioridade legal ativos. */
export function recusasDoServico(
  s: ServicoProposto,
  existentes: readonly ServicoJaCadastrado[],
  gruposAtivos: readonly string[],
  id: number | null = null,
): RecusaEstrutura[] {
  const r: RecusaEstrutura[] = [];
  const outros = existentes.filter((x) => x.id !== id);
  if (!/^[A-Z]{1,3}$/.test(s.prefixo))
    r.push(recusar('prefixo', 'prefixo-invalido', 'O prefixo da senha tem de 1 a 3 letras maiúsculas.'));
  else if (outros.some((x) => x.prefixo.toUpperCase() === s.prefixo))
    r.push(recusar('prefixo', 'prefixo-repetido', 'Outro serviço desta recepção já usa este prefixo.'));
  const d = s.descricao.trim();
  if (d.length < 3 || d.length > 150)
    r.push(recusar('descricao', 'descricao-invalida', 'O nome do serviço tem de 3 a 150 caracteres.'));
  else if (outros.some((x) => mesmoTexto(x.descricao, d)))
    r.push(recusar('descricao', 'descricao-repetida', 'Já existe um serviço com este nome nesta recepção.'));
  if (!(TIPOS_SERVICO_SENHA as readonly string[]).includes(s.tipo))
    r.push(recusar('tipo', 'tipo-invalido', 'Escolha se o serviço abre atendimento ou é serviço diverso.'));
  if (s.grupoPrioridade !== null && !gruposAtivos.includes(s.grupoPrioridade))
    r.push(
      recusar(
        'grupoPrioridade',
        'grupo-inexistente',
        'O grupo de prioridade legal não existe ou está inativo.',
      ),
    );
  if (s.grupoPrioridade !== null && !s.prioritaria)
    r.push(
      recusar(
        'prioritaria',
        'grupo-sem-prioridade',
        'Um botão com grupo de prioridade legal emite senha prioritária.',
      ),
    );
  if (
    s.limiteDia !== null &&
    (!Number.isInteger(s.limiteDia) || s.limiteDia < 1 || s.limiteDia > LIMITE_SENHAS_DIA)
  )
    r.push(
      recusar('limiteDia', 'limite-invalido', `O limite do dia vai de 1 a ${LIMITE_SENHAS_DIA} senhas.`),
    );
  if (
    s.ordemBotao !== null &&
    (!Number.isInteger(s.ordemBotao) || s.ordemBotao < 1 || s.ordemBotao > LIMITE_ORDEM_BOTAO)
  )
    r.push(recusar('ordemBotao', 'ordem-invalida', `A posição do botão vai de 1 a ${LIMITE_ORDEM_BOTAO}.`));
  return r;
}

/** Prefixo sugerido pelo nome do serviço: iniciais das duas primeiras palavras, único entre os usados. */
export function prefixoSugerido(descricao: string, usados: readonly string[]): string {
  const palavras = semAcento(descricao)
    .replace(/[^A-Z ]+/g, ' ')
    .split(/\s+/)
    .filter((p) => p.length > 2);
  const tem = (p: string) => usados.some((u) => u.toUpperCase() === p);
  const candidatos = [
    palavras
      .slice(0, 2)
      .map((p) => p[0])
      .join(''),
    (palavras[0] ?? '').slice(0, 2),
    (palavras[0] ?? '').slice(0, 1),
    (palavras[0] ?? '').slice(0, 3),
  ].filter((c) => c.length > 0);
  for (const c of candidatos) if (!tem(c)) return c;
  for (let a = 65; a <= 90; a++) {
    const c = String.fromCharCode(a);
    if (!tem(c)) return c;
  }
  return '';
}

/** A ordem dos botões no totem e no balcão: os posicionados primeiro (menor antes), depois os demais pelo nome. */
export function ordenarBotoes<
  T extends { readonly ordemBotao: number | null; readonly descricao: string; readonly id: number },
>(servicos: readonly T[]): T[] {
  return [...servicos].sort(
    (a, b) =>
      (a.ordemBotao ?? Number.MAX_SAFE_INTEGER) - (b.ordemBotao ?? Number.MAX_SAFE_INTEGER) ||
      semAcento(a.descricao).localeCompare(semAcento(b.descricao)) ||
      a.id - b.id,
  );
}

// ── desativar (nunca apagar) ─────────────────────────────────────────────────────────────────────────────

/** O que impede desativar um item da estrutura agora (null: pode). */
export function bloqueioDesativar(
  item: 'ponto' | 'guiche' | 'servico',
  uso: { readonly guichesAbertos: number; readonly senhasEmAberto: number },
): RecusaEstrutura | null {
  if (item !== 'servico' && uso.guichesAbertos > 0)
    return recusar(
      'ativo',
      'guiche-aberto',
      item === 'guiche'
        ? 'O guichê está aberto: feche-o antes de desativar.'
        : 'Há guichê aberto nesta recepção: feche os guichês antes de desativar.',
    );
  if (item !== 'guiche' && uso.senhasEmAberto > 0)
    return recusar(
      'ativo',
      'senha-em-aberto',
      `Há ${uso.senhasEmAberto} senha(s) de hoje ainda sem conclusão: conclua ou suspenda antes de desativar.`,
    );
  return null;
}
