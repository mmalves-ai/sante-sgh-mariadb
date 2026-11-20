// W0-07 (mercado M4): a ordem de serviço da manutenção aberta num leito. Atrás do parâmetro adt.osBloqueiaLeito
// (desligado por padrão): a abertura propõe o bloqueio do leito por manutenção (quem abre confirma no diálogo; o
// bloqueio leva "OS <número>" na observação, a ligação com a OS); o encerramento da OS encerra esse bloqueio e solicita
// a higienização do leito. Nada disso grava no legado além da solicitação de limpeza, que segue a receita do executor.
import type { ChaveLeito } from './adt.js';

/**
 * O texto da observação do bloqueio que liga o estado do leito à OS (a única ligação: sem coluna nova). A ligação é
 * protegida: a alteração do estado mantém o prefixo (preservarVinculoOs) e o cancelamento da OS encerra o bloqueio.
 */
export function observacaoBloqueioOs(numero: string): string {
  return `OS ${numero.trim()}`;
}

/** O bloqueio aberto pertence a esta OS? (a observação começa por "OS <número>", seguido de fim ou separador). */
export function bloqueioDaOs(observacao: string | null | undefined, numero: string): boolean {
  if (!observacao) return false;
  const marca = observacaoBloqueioOs(numero).toUpperCase();
  const o = observacao.trim().toUpperCase();
  return o === marca || (o.startsWith(marca) && !/[A-Z0-9]/.test(o.charAt(marca.length)));
}

/** O número da OS dona do bloqueio pela observação ("OS 2026-000123 - texto" → "2026-000123"), ou null. */
export function numeroOsDoBloqueio(observacao: string | null | undefined): string | null {
  const m = /^OS\s+([A-Z0-9]+(?:[-/.][A-Z0-9]+)*)(?![A-Z0-9])/i.exec((observacao ?? '').trim());
  return m ? (m[1] ?? null) : null;
}

/**
 * A alteração do bloqueio por manutenção aberto por uma OS (alterar o estado sem encerrar) preserva a ligação com a
 * OS: o motivo não sai de 'manutencao' (recusa; o bloqueio encerra com a OS) e a observação mantém o prefixo
 * "OS <número>" (o texto digitado vem depois dele). Fora desse caso, devolve a observação pedida como veio.
 */
export function preservarVinculoOs(
  antes: { estado: string; motivo: string | null; observacao: string | null },
  depois: { motivo: string | null; observacao: string | null },
  limite = 200,
): { ok: true; observacao: string | null } | { ok: false; numero: string; mensagem: string } {
  const numero =
    antes.estado === 'bloqueio' && antes.motivo === 'manutencao'
      ? numeroOsDoBloqueio(antes.observacao)
      : null;
  if (!numero) return { ok: true, observacao: depois.observacao };
  if (depois.motivo !== 'manutencao')
    return {
      ok: false,
      numero,
      mensagem: `O bloqueio é da ordem de serviço ${numero}: o motivo fica manutenção até a OS ser encerrada ou cancelada.`,
    };
  if (bloqueioDaOs(depois.observacao, numero)) return { ok: true, observacao: depois.observacao };
  const marca = observacaoBloqueioOs(numero);
  const resto = (depois.observacao ?? '').trim();
  return { ok: true, observacao: resto ? `${marca} - ${resto}`.slice(0, limite) : marca };
}

const PALAVRAS_DE_ROTULO = new Set([
  'LEITO',
  'BLOCO',
  'ACOMODACAO',
  'ACOMOD',
  'QUARTO',
  'APTO',
  'APARTAMENTO',
]);

/**
 * O leito que o local livre da OS nomeia, ou null. Aceita a chave do mapa (`bloco|acomodação|leito`) e as formas que
 * a manutenção digita com outro separador e rótulos ("Leito 2A 201 01", "bloco 2A / 201 - 01"): sobram exatamente
 * três partes, comparadas sem distinguir maiúsculas com os leitos existentes. Ambíguo ou desconhecido: null.
 */
export function leitoDoLocalDaOs(local: string | null, leitos: readonly ChaveLeito[]): ChaveLeito | null {
  if (!local) return null;
  const partes = local
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter((p) => p !== '' && !PALAVRAS_DE_ROTULO.has(p));
  if (partes.length !== 3) return null;
  const [b, a, l] = partes;
  const achados = leitos.filter(
    (x) => x.bloco.toUpperCase() === b && x.acomodacao.toUpperCase() === a && x.leito.toUpperCase() === l,
  );
  return achados.length === 1 ? (achados[0] ?? null) : null;
}

/**
 * Por que a integração não propôs, não encerrou ou não solicitou: só o código (a tela traduz em crudNir.osLeito.avisos).
 * Não há bloqueio adiado: com o leito ocupado, quem bloqueia é o mapa de leitos quando ele vagar, citando a OS.
 */
export const AVISOS_OS_NO_LEITO = [
  'leito-bloqueado',
  'leito-ocupado',
  'sem-permissao-bloqueio',
  'sem-bloqueio-da-os',
  'sem-tipo-limpeza',
  'higienizacao-nao-solicitada',
  'cancelada',
] as const;
export type AvisoOsNoLeito = (typeof AVISOS_OS_NO_LEITO)[number];

/** O desfecho da integração devolvido junto com a OS (abertura e encerramento). */
export interface OsNoLeito {
  readonly leito: ChaveLeito;
  readonly chave: string;
  /**
   * Abertura: o bloqueio por manutenção proposto (o leito está livre e sem bloqueio aberto, e quem abriu a OS pode
   * bloquear o leito: leitos.bloqueio.criar; sem a permissão, o aviso 'sem-permissao-bloqueio').
   */
  readonly propostaBloqueio: boolean;
  /** Abertura: a observação que o bloqueio confirmado leva ("OS <número>"). */
  readonly observacao: string;
  /** Encerramento: o bloqueio desta OS foi encerrado. */
  readonly bloqueioEncerrado: boolean;
  /** Encerramento: a solicitação de higienização criada (null se não criou). */
  readonly higienizacao: number | null;
  /** Por que não propôs, não encerrou ou não solicitou (código; a tela traduz); null quando tudo correu. */
  readonly aviso: AvisoOsNoLeito | null;
}
