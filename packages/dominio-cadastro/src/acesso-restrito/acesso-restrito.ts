// Paciente com acesso restrito ao prontuário (F8, 02-CAD linha 10): confidencial, VIP, proteção judicial, vítima de
// violência ou colaborador do próprio hospital. Regras puras da marca, da liberação nominal e da decisão de acesso.
// Desenho próprio (SBIS, LGPD art. 11 e prática de mercado):
// - restrito = só os liberados nominalmente (profissional ou equipe, com vigência e justificativa) e quem atende o
//   paciente num atendimento em curso; o resto passa pela quebra de vidro auditada (ou é negado, se a marca a dispensa);
// - a marca vale num estabelecimento ou em todos (estabelecimento nulo), com vigência; encerrar é registrar o fim,
//   nunca apagar (o histórico de quem marcou, por quê e de quem foi liberado fica);
// - o nome em tela segue a exibição da marca (normal, iniciais, pseudônimo ou oculto), para listas, painéis e etiquetas;
// - a vigência é instante (AAAA-MM-DDTHH:MM) ou data civil; fim nulo = em vigor.

export const TIPOS_MARCA_RESTRITA = [
  'confidencial',
  'vip',
  'destaque',
  'protecao_judicial',
  'vitima_violencia',
  'colaborador',
] as const;
export type TipoMarcaRestrita = (typeof TIPOS_MARCA_RESTRITA)[number];

export const EXIBICOES_NOME_RESTRITO = ['normal', 'iniciais', 'pseudonimo', 'oculto'] as const;
export type ExibicaoNomeRestrito = (typeof EXIBICOES_NOME_RESTRITO)[number];

export interface EntradaMarcaRestrita {
  readonly tipo: string;
  readonly motivo: string;
  readonly exibicao: string;
  readonly pseudonimo: string | null;
  readonly inicio: string;
  readonly fim: string | null;
}

export interface EntradaLiberacaoRestrita {
  readonly profissionalId: number | null;
  readonly equipeId: number | null;
  readonly justificativa: string;
  readonly inicio: string;
  readonly fim: string | null;
}

/** Marca como a decisão a enxerga (já lida do banco). */
export interface MarcaRestrita {
  readonly id: number;
  readonly estabelecimentoId: number | null;
  readonly situacao: string;
  readonly inicio: string;
  readonly fim: string | null;
  readonly exigeQuebraVidro: boolean;
}

export interface LiberacaoRestrita {
  readonly marcaId: number;
  readonly profissionalId: number | null;
  readonly equipeId: number | null;
  readonly inicio: string;
  readonly fim: string | null;
}

const INSTANTE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/;

/** Instante comparável (texto ISO sem fuso, de mesmo tamanho): a data civil vale desde a meia-noite. */
export function instante(v: string): string {
  const t = v.replace(' ', 'T');
  return t.length === 10 ? `${t}T00:00:00.000` : `${t}${':00.000'.slice(0, 23 - t.length)}`.padEnd(23, '0');
}

function errosVigencia(inicio: string, fim: string | null): string[] {
  if (!INSTANTE.test(inicio)) return ['inicio-invalido'];
  if (fim !== null && !INSTANTE.test(fim)) return ['fim-invalido'];
  if (fim !== null && instante(fim) < instante(inicio)) return ['fim-antes-do-inicio'];
  return [];
}

/** Erros da marca (vazio = válida). */
export function errosMarcaRestrita(e: EntradaMarcaRestrita): string[] {
  const erros: string[] = [];
  if (!(TIPOS_MARCA_RESTRITA as readonly string[]).includes(e.tipo)) erros.push('tipo-invalido');
  const motivo = e.motivo.trim();
  if (motivo.length < 10) erros.push('motivo-curto');
  if (motivo.length > 500) erros.push('motivo-longo');
  if (!(EXIBICOES_NOME_RESTRITO as readonly string[]).includes(e.exibicao)) erros.push('exibicao-invalida');
  const p = (e.pseudonimo ?? '').trim();
  if (e.exibicao === 'pseudonimo' && p.length < 3) erros.push('pseudonimo-ausente');
  if (p.length > 150) erros.push('pseudonimo-longo');
  erros.push(...errosVigencia(e.inicio, e.fim));
  return erros;
}

/** Erros da liberação nominal (vazio = válida): um só destino, justificativa e vigência dentro da marca. */
export function errosLiberacaoRestrita(
  e: EntradaLiberacaoRestrita,
  marca: { readonly situacao: string; readonly inicio: string; readonly fim: string | null },
): string[] {
  const erros: string[] = [];
  if ((e.profissionalId === null) === (e.equipeId === null)) erros.push('destino-unico');
  const j = e.justificativa.trim();
  if (j.length < 10) erros.push('justificativa-curta');
  if (j.length > 500) erros.push('justificativa-longa');
  erros.push(...errosVigencia(e.inicio, e.fim));
  if (marca.situacao !== 'ativa') erros.push('marca-encerrada');
  else if (marca.fim !== null && (e.fim === null || instante(e.fim) > instante(marca.fim)))
    erros.push('alem-da-marca');
  return erros;
}

const vigenteEm = (inicio: string, fim: string | null, agora: string): boolean =>
  instante(inicio) <= agora && (fim === null || instante(fim) > agora);

/** A marca está viva agora neste estabelecimento (marca sem estabelecimento vale em todos). */
export function marcaViva(m: MarcaRestrita, agora: string, estabelecimento: number): boolean {
  return (
    m.situacao === 'ativa' &&
    (m.estabelecimentoId === null || m.estabelecimentoId === estabelecimento) &&
    vigenteEm(m.inicio, m.fim, instante(agora))
  );
}

export type DesfechoAcessoRestrito =
  'livre' | 'liberado' | 'atende' | 'emergencia' | 'quebra-de-vidro' | 'negado';

export interface SujeitoAcessoRestrito {
  /** Profissional que a conta representa (nulo: conta sem profissional). */
  readonly profissionalId: number | null;
  /** Equipes em que o profissional está em vigor agora. */
  readonly equipes: readonly number[];
  /** O profissional atende o paciente num atendimento em curso neste estabelecimento. */
  readonly atendeAgora: boolean;
  /** Há quebra de vidro vigente deste usuário para o paciente. */
  readonly emergenciaVigente: boolean;
  /** Administrador da plataforma (pode tudo; a trilha registra). */
  readonly plataforma: boolean;
}

/**
 * Decisão de acesso ao prontuário do paciente com marca: sem marca viva, livre; com marca, só liberado nominal
 * (profissional ou equipe em vigor), quem atende agora ou a quebra de vidro vigente. Sem nada disso, a quebra de vidro
 * (se alguma marca viva a admite) ou a negação. Falha fechada: conta sem profissional só entra por quebra de vidro.
 */
export function decidirAcessoRestrito(
  marcas: readonly MarcaRestrita[],
  liberacoes: readonly LiberacaoRestrita[],
  sujeito: SujeitoAcessoRestrito,
  agora: string,
  estabelecimento: number,
): { desfecho: DesfechoAcessoRestrito; marcas: number[] } {
  const vivas = marcas.filter((m) => marcaViva(m, agora, estabelecimento));
  if (!vivas.length) return { desfecho: 'livre', marcas: [] };
  const ids = vivas.map((m) => m.id);
  if (sujeito.plataforma) return { desfecho: 'liberado', marcas: ids };
  const t = instante(agora);
  const liberadoEm = (m: MarcaRestrita) =>
    liberacoes.some(
      (l) =>
        l.marcaId === m.id &&
        vigenteEm(l.inicio, l.fim, t) &&
        ((l.profissionalId !== null && l.profissionalId === sujeito.profissionalId) ||
          (l.equipeId !== null && sujeito.equipes.includes(l.equipeId))),
    );
  if (sujeito.profissionalId !== null && vivas.every(liberadoEm))
    return { desfecho: 'liberado', marcas: ids };
  if (sujeito.profissionalId !== null && sujeito.atendeAgora) return { desfecho: 'atende', marcas: ids };
  if (sujeito.emergenciaVigente) return { desfecho: 'emergencia', marcas: ids };
  return {
    desfecho: vivas.every((m) => m.exigeQuebraVidro) ? 'quebra-de-vidro' : 'negado',
    marcas: ids,
  };
}

/** O desfecho permite ver o prontuário? */
export const acessoRestritoPermite = (d: DesfechoAcessoRestrito): boolean =>
  d === 'livre' || d === 'liberado' || d === 'atende' || d === 'emergencia';

/** Nome em tela conforme a exibição da marca viva (sem marca: o nome). */
export function nomeExibidoRestrito(
  nome: string,
  marca: { readonly exibicao: string; readonly pseudonimo: string | null } | null,
): string {
  if (!marca || marca.exibicao === 'normal') return nome;
  if (marca.exibicao === 'pseudonimo') return marca.pseudonimo?.trim() || 'Paciente reservado';
  if (marca.exibicao === 'oculto') return 'Paciente reservado';
  return nome
    .trim()
    .split(/\s+/)
    .filter((p) => p.length > 2)
    .map((p) => `${p[0]!.toUpperCase()}.`)
    .join(' ');
}

/** Exibição do nome de um paciente com marca viva (a mais restritiva, quando há várias). */
export interface ExibicaoRestrita {
  readonly exibicao: string;
  readonly pseudonimo: string | null;
}

const RIGOR_EXIBICAO: Readonly<Record<string, number>> = { normal: 0, iniciais: 1, pseudonimo: 2, oculto: 3 };
/** A exibição mais restritiva entre duas marcas vivas do mesmo paciente. */
export const exibicaoMaisRestrita = (
  a: ExibicaoRestrita | undefined,
  b: ExibicaoRestrita,
): ExibicaoRestrita => (!a || (RIGOR_EXIBICAO[b.exibicao] ?? 3) > (RIGOR_EXIBICAO[a.exibicao] ?? 3) ? b : a);

/** Chaves do nome do paciente ao lado do id dele nas listas e painéis clínicos. */
const CHAVES_NOME_PACIENTE = ['pacienteNome', 'nomePaciente', 'paciente_nome', 'nome_paciente'] as const;
const LIMITE_NOS = 50_000;

const objetoSimples = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const p = Object.getPrototypeOf(v) as unknown;
  return p === Object.prototype || p === null;
};
const idInteiro = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isSafeInteger(n) && n > 0 ? n : null;
};
/** O paciente de um item: `pacienteId`, `paciente_id` ou `paciente` numérico. */
const pacienteDoItem = (o: Record<string, unknown>): number | null =>
  idInteiro(o['pacienteId']) ?? idInteiro(o['paciente_id']) ?? idInteiro(o['paciente']);
/** `paciente` em texto que não é id: o nome. */
const nomeEmPaciente = (o: Record<string, unknown>): boolean =>
  typeof o['paciente'] === 'string' && idInteiro(o['paciente']) === null;
/** O objeto `paciente: { id, nome }` aninhado. */
const pacienteAninhado = (o: Record<string, unknown>): number | null => {
  const p = o['paciente'];
  return objetoSimples(p) && typeof p['nome'] === 'string' ? idInteiro(p['id']) : null;
};

/**
 * Os pacientes que uma resposta de lista ou painel clínico mostra pelo nome: itens com o id do paciente (`pacienteId`,
 * `paciente_id` ou `paciente` numérico) ao lado do nome (`pacienteNome`, `nomePaciente`...) ou com o nome em `paciente`
 * (texto), e o objeto `paciente: { id, nome }`. Varredura limitada (respostas enormes param no teto).
 */
export function pacientesNaResposta(r: unknown): number[] {
  const ids = new Set<number>();
  let nos = 0;
  const visitar = (v: unknown): void => {
    if (++nos > LIMITE_NOS) return;
    if (Array.isArray(v)) {
      for (const x of v) visitar(x);
      return;
    }
    if (!objetoSimples(v)) return;
    const id = pacienteDoItem(v);
    if (id !== null && (CHAVES_NOME_PACIENTE.some((k) => typeof v[k] === 'string') || nomeEmPaciente(v)))
      ids.add(id);
    const an = pacienteAninhado(v);
    if (an !== null) ids.add(an);
    for (const x of Object.values(v)) if (x !== null && typeof x === 'object') visitar(x);
  };
  visitar(r);
  return [...ids];
}

/**
 * Troca o nome dos pacientes marcados pela exibição da marca (iniciais, pseudônimo ou oculto, por nomeExibidoRestrito)
 * nas listas e painéis clínicos, sem mexer no original (cópia só do que muda). `exceto`: o paciente cujo prontuário a
 * própria rota abriu e a decisão liberou (o nome aparece por inteiro).
 */
export function mascararNomesRestritos<T>(
  r: T,
  exibicoes: ReadonlyMap<number, ExibicaoRestrita>,
  exceto: number | null = null,
): T {
  if (!exibicoes.size) return r;
  let nos = 0;
  const marca = (id: number | null): ExibicaoRestrita | null =>
    id === null || id === exceto ? null : (exibicoes.get(id) ?? null);
  const trocar = (v: unknown): unknown => {
    if (++nos > LIMITE_NOS) return v;
    if (Array.isArray(v)) {
      let mudou = false;
      const n = v.map((x) => {
        const y = trocar(x);
        if (y !== x) mudou = true;
        return y;
      });
      return mudou ? n : v;
    }
    if (!objetoSimples(v)) return v;
    let saida: Record<string, unknown> | null = null;
    const por = (k: string, valor: unknown) => {
      saida ??= { ...v };
      saida[k] = valor;
    };
    const m = marca(pacienteDoItem(v));
    if (m) {
      for (const k of CHAVES_NOME_PACIENTE)
        if (typeof v[k] === 'string') por(k, nomeExibidoRestrito(v[k], m));
      if (nomeEmPaciente(v)) por('paciente', nomeExibidoRestrito(String(v['paciente']), m));
    }
    for (const [k, x] of Object.entries(v)) {
      if (x === null || typeof x !== 'object') continue;
      let y = trocar(x);
      if (k === 'paciente' && objetoSimples(y)) {
        const mp = marca(typeof y['nome'] === 'string' ? idInteiro(y['id']) : null);
        if (mp) {
          const p: Record<string, unknown> = { ...y, nome: nomeExibidoRestrito(String(y['nome']), mp) };
          if (typeof p['nomeSocial'] === 'string') p['nomeSocial'] = p['nome'];
          y = p;
        }
      }
      if (y !== x) por(k, y);
    }
    return saida ?? v;
  };
  return trocar(r) as T;
}
