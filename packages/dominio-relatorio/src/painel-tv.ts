// Painéis de TV operacionais (01-REL L116; F3): regras puras do cadastro do painel, dos blocos e do pareamento do
// televisor, e as regras de exibição (LGPD: a TV fica em área comum, então nenhum nome de paciente aparece; só as
// iniciais, o número do pedido ou a senha). Cada bloco lê uma FONTE operacional: ocupação da terapia intensiva,
// fila da farmácia, mapa cirúrgico do dia ou laboratório (a chamada por senha segue no painel da recepção).

export const FONTES_BLOCO_TV = ['uti', 'farmacia', 'mapa_cirurgico', 'laboratorio'] as const;
export type FonteBlocoTv = (typeof FONTES_BLOCO_TV)[number];
export const FORMAS_BLOCO_TV = ['tabela', 'lista', 'mapa'] as const;
export type FormaBlocoTv = (typeof FORMAS_BLOCO_TV)[number];
export const SITUACOES_PAINEL_TV = ['rascunho', 'ativo', 'suspenso', 'inativo'] as const;
export type SituacaoPainelTv = (typeof SITUACOES_PAINEL_TV)[number];

export const MAXIMO_BLOCOS_TV = 12;
export const LIMITE_LINHAS_TV = 40;
export const TEMPO_MINIMO_TV = 5;
export const TEMPO_MAXIMO_TV = 3600;

export interface ErroRegraTv {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}

export interface BlocoTvEntrada {
  readonly fonte: FonteBlocoTv;
  readonly titulo: string;
  readonly forma: FormaBlocoTv;
  /** Sobrepõe o tempo de rotação do painel (nulo: o do painel). */
  readonly tempoEmTelaSegundos: number | null;
  /** Só na fonte uti: a unidade de terapia intensiva (nulo: todas as intensivas). */
  readonly unidadeInternacaoId: number | null;
  /** Só no mapa cirúrgico: a sala (nulo: todas). */
  readonly salaCirurgicaId: number | null;
  /** Linhas mostradas (1 a LIMITE_LINHAS_TV). */
  readonly limite: number;
}

/** Tempos do painel: rotação e atualização entre 5 s e 1 h. */
export function conferirTemposTv(rotacao: number, atualizacao: number): ErroRegraTv[] {
  const erros: ErroRegraTv[] = [];
  const fora = (v: number) => !Number.isInteger(v) || v < TEMPO_MINIMO_TV || v > TEMPO_MAXIMO_TV;
  if (fora(rotacao))
    erros.push({
      campo: 'tempoRotacaoSegundos',
      codigo: 'tempo-invalido',
      mensagem: `O tempo de cada bloco em tela vai de ${TEMPO_MINIMO_TV} a ${TEMPO_MAXIMO_TV} segundos.`,
    });
  if (fora(atualizacao))
    erros.push({
      campo: 'atualizacaoSegundos',
      codigo: 'tempo-invalido',
      mensagem: `A atualização dos dados vai de ${TEMPO_MINIMO_TV} a ${TEMPO_MAXIMO_TV} segundos.`,
    });
  return erros;
}

/** Os blocos em ordem: todas as regras violadas de uma vez (a tela marca cada campo). */
export function conferirBlocosTv(blocos: readonly BlocoTvEntrada[]): ErroRegraTv[] {
  const erros: ErroRegraTv[] = [];
  if (blocos.length > MAXIMO_BLOCOS_TV)
    erros.push({
      campo: 'blocos',
      codigo: 'blocos-demais',
      mensagem: `O painel aceita até ${MAXIMO_BLOCOS_TV} blocos.`,
    });
  const vistos = new Set<string>();
  blocos.forEach((b, i) => {
    const campo = (c: string) => `blocos.${i}.${c}`;
    if (!FONTES_BLOCO_TV.includes(b.fonte))
      erros.push({
        campo: campo('fonte'),
        codigo: 'fonte-invalida',
        mensagem: `Bloco ${i + 1}: fonte desconhecida.`,
      });
    if (b.titulo.trim().length < 3)
      erros.push({
        campo: campo('titulo'),
        codigo: 'titulo-curto',
        mensagem: `Bloco ${i + 1}: o título tem ao menos 3 letras.`,
      });
    if (
      b.tempoEmTelaSegundos !== null &&
      (!Number.isInteger(b.tempoEmTelaSegundos) ||
        b.tempoEmTelaSegundos < TEMPO_MINIMO_TV ||
        b.tempoEmTelaSegundos > TEMPO_MAXIMO_TV)
    )
      erros.push({
        campo: campo('tempoEmTelaSegundos'),
        codigo: 'tempo-invalido',
        mensagem: `Bloco ${i + 1}: o tempo em tela vai de ${TEMPO_MINIMO_TV} a ${TEMPO_MAXIMO_TV} segundos.`,
      });
    if (!Number.isInteger(b.limite) || b.limite < 1 || b.limite > LIMITE_LINHAS_TV)
      erros.push({
        campo: campo('limite'),
        codigo: 'limite-invalido',
        mensagem: `Bloco ${i + 1}: mostre de 1 a ${LIMITE_LINHAS_TV} linhas.`,
      });
    if (b.unidadeInternacaoId !== null && b.fonte !== 'uti')
      erros.push({
        campo: campo('unidadeInternacaoId'),
        codigo: 'filtro-fora-da-fonte',
        mensagem: `Bloco ${i + 1}: a unidade só filtra a ocupação da terapia intensiva.`,
      });
    if (b.salaCirurgicaId !== null && b.fonte !== 'mapa_cirurgico')
      erros.push({
        campo: campo('salaCirurgicaId'),
        codigo: 'filtro-fora-da-fonte',
        mensagem: `Bloco ${i + 1}: a sala só filtra o mapa cirúrgico.`,
      });
    if (b.forma === 'mapa' && b.fonte !== 'uti' && b.fonte !== 'mapa_cirurgico')
      erros.push({
        campo: campo('forma'),
        codigo: 'forma-fora-da-fonte',
        mensagem: `Bloco ${i + 1}: o mapa serve à ocupação de leitos e ao mapa cirúrgico.`,
      });
    const chave = `${b.fonte}:${b.unidadeInternacaoId ?? ''}:${b.salaCirurgicaId ?? ''}:${b.forma}`;
    if (vistos.has(chave))
      erros.push({
        campo: campo('fonte'),
        codigo: 'bloco-repetido',
        mensagem: `Bloco ${i + 1}: repete a mesma fonte, filtro e forma de outro bloco.`,
      });
    vistos.add(chave);
  });
  return erros;
}

/** Ativar exige ao menos um bloco: TV ligada sem conteúdo não serve ao setor. */
export function conferirAtivacaoTv(blocosAtivos: number): ErroRegraTv[] {
  return blocosAtivos > 0
    ? []
    : [
        {
          campo: 'blocos',
          codigo: 'painel-sem-bloco',
          mensagem: 'Inclua ao menos um bloco antes de ativar o painel.',
        },
      ];
}

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'van', 'von', 'del', 'la']);

/** LGPD: as iniciais do nome (partículas fora), no máximo 4 letras; sem nome, travessão. */
export function iniciaisDoNome(nome: string | null | undefined): string {
  const partes = (nome ?? '')
    .normalize('NFC')
    .split(/\s+/)
    .map((p) => p.replace(/[^\p{L}]/gu, ''))
    .filter((p) => p.length > 0 && !PARTICULAS.has(p.toLowerCase()));
  if (partes.length === 0) return '—';
  const escolhidas = partes.length > 4 ? [...partes.slice(0, 3), partes[partes.length - 1]!] : partes;
  return escolhidas.map((p) => `${p[0]!.toUpperCase()}.`).join(' ');
}

/** Minutos inteiros de `desde` até `agora` (nunca negativo). */
export function minutosDesde(desde: Date, agora: Date): number {
  return Math.max(0, Math.floor((agora.getTime() - desde.getTime()) / 60_000));
}

/** Dias de permanência contados como diárias (o dia da entrada conta 1). */
export function diasDePermanencia(entrada: Date, agora: Date): number {
  return Math.max(1, Math.floor((agora.getTime() - entrada.getTime()) / 86_400_000) + 1);
}

/** Atraso em minutos frente ao previsto (0 quando no prazo ou sem previsão). */
export function atrasoMinutos(previsto: Date | null, agora: Date): number {
  if (!previsto) return 0;
  return Math.max(0, Math.floor((agora.getTime() - previsto.getTime()) / 60_000));
}

export interface ResumoOcupacaoTv {
  readonly leitos: number;
  readonly ocupados: number;
  readonly livres: number;
  /** Taxa de ocupação em % com 1 casa (ocupados ÷ leitos × 100); nula sem leito. */
  readonly taxa: number | null;
}

/** Ocupação: a taxa sai com as parcelas (ocupados e leitos) junto. */
export function resumoOcupacaoTv(leitos: number, ocupados: number): ResumoOcupacaoTv {
  const o = Math.min(Math.max(0, ocupados), Math.max(0, leitos));
  return {
    leitos,
    ocupados: o,
    livres: Math.max(0, leitos - o),
    taxa: leitos > 0 ? Math.round((o / leitos) * 1000) / 10 : null,
  };
}

/** Alfabeto do código de pareamento: sem 0/O, 1/I/L, para ler de longe na TV. */
export const ALFABETO_PAREAMENTO = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const TAMANHO_PAREAMENTO = 6;

/** Código de pareamento de 6 caracteres; `aleatorio` devolve inteiros em [0, n). */
export function gerarCodigoPareamento(aleatorio: (n: number) => number): string {
  let s = '';
  for (let i = 0; i < TAMANHO_PAREAMENTO; i++)
    s += ALFABETO_PAREAMENTO[aleatorio(ALFABETO_PAREAMENTO.length)];
  return s;
}

/** Normaliza o código digitado (maiúsculas, sem espaço nem hífen) e confere o formato; nulo se inválido. */
export function normalizarCodigoPareamento(digitado: string): string | null {
  const c = digitado.toUpperCase().replace(/[\s-]/g, '');
  if (c.length !== TAMANHO_PAREAMENTO) return null;
  for (const ch of c) if (!ALFABETO_PAREAMENTO.includes(ch)) return null;
  return c;
}

/** O televisor está no ar quando fez contato nos últimos `toleranciaSegundos` (padrão: 3 atualizações). */
export function dispositivoNoAr(
  ultimoContato: Date | null,
  agora: Date,
  atualizacaoSegundos: number,
): boolean {
  if (!ultimoContato) return false;
  return agora.getTime() - ultimoContato.getTime() <= atualizacaoSegundos * 3 * 1000;
}

/** Validade do código de pareamento: a TV tem este prazo para digitá-lo; depois, religar gera outro. */
export const VALIDADE_PAREAMENTO_MINUTOS = 30;

/** Até quando vale o código gerado agora. */
export function expiracaoPareamento(agora: Date): Date {
  return new Date(agora.getTime() + VALIDADE_PAREAMENTO_MINUTOS * 60_000);
}

/** O código ainda vale: tem validade gravada e ela não passou. */
export function pareamentoVigente(expiraEm: Date | null, agora: Date): boolean {
  return expiraEm !== null && agora.getTime() < expiraEm.getTime();
}

/**
 * Estado de cada linha para o desenho em mapa e a cor na TV: leito livre ou ocupado; cirurgia prevista, atrasada, em
 * sala ou realizada; pedido de laboratório ou dispensação no prazo ou atrasado.
 */
export type EstadoLinhaTv =
  'livre' | 'ocupado' | 'prevista' | 'atrasada' | 'em_sala' | 'realizada' | 'no_prazo' | 'atrasado';

export function estadoCirurgiaTv(situacao: string, atrasoInicioMinutos: number): EstadoLinhaTv {
  if (situacao === 'realizado') return 'realizada';
  if (situacao === 'em_andamento' || situacao === 'no_bloco') return 'em_sala';
  return atrasoInicioMinutos > 0 ? 'atrasada' : 'prevista';
}

export function estadoPrazoTv(atrasoMinutos: number): EstadoLinhaTv {
  return atrasoMinutos > 0 ? 'atrasado' : 'no_prazo';
}
