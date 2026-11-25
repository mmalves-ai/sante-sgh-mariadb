// Página inicial montada pelo hospital (01-ADM L114; F8): o modelo de página (blocos em ordem, com largura) vale para
// os perfis de acesso ligados a ele, com prioridade. As regras puras ficam aqui; a porta própria grava e lê:
//   - os blocos possíveis: lista de trabalho do catálogo (as filas que a página inicial já tem), indicador (com a série
//     das últimas competências, desenhada como gráfico), atalho (endereço interno da aplicação ou https) e texto;
//   - o modelo só é publicado com ao menos um bloco e um perfil; nada é apagado (o modelo sai de uso como inativo);
//   - quem tem vários perfis recebe o modelo publicado de menor prioridade; o do estabelecimento vence o da rede no
//     empate; sem modelo publicado, a página inicial fixa do perfil continua valendo;
//   - a lista de trabalho só aparece para quem pode vê-la (permissão do módulo de origem e funcionalidade ligada): o
//     modelo nunca abre uma fila que o perfil não abriria.

export const TIPOS_BLOCO_INICIO = ['lista_trabalho', 'indicador', 'link', 'texto'] as const;
export type TipoBlocoInicio = (typeof TIPOS_BLOCO_INICIO)[number];

export const SITUACOES_MODELO_INICIO = ['rascunho', 'publicado', 'inativo'] as const;
export type SituacaoModeloInicio = (typeof SITUACOES_MODELO_INICIO)[number];

/** Teto de blocos numa página (a página inicial é para abrir rápido). */
export const MAXIMO_BLOCOS_INICIO = 24;
/** Teto de perfis ligados a um modelo. */
export const MAXIMO_PERFIS_INICIO = 50;
/** Competências mostradas no gráfico do bloco de indicador. */
export const COMPETENCIAS_GRAFICO_INICIO = 6;

export interface BlocoInicioEntrada {
  readonly tipo: TipoBlocoInicio;
  /** Código do catálogo de blocos (lista de trabalho). */
  readonly catalogo: string | null;
  readonly indicadorId: number | null;
  readonly titulo: string | null;
  readonly endereco: string | null;
  readonly texto: string | null;
  /** Colunas da grade que o bloco ocupa (1 a 3). */
  readonly largura: number;
}

export interface PerfilModeloInicioEntrada {
  readonly perfilId: number;
  /** Menor vence quando o usuário tem vários perfis (1 a 99). */
  readonly prioridade: number;
}

export interface ErroRegraInicio {
  readonly campo: string;
  readonly codigo: string;
  readonly mensagem: string;
}

/** Endereço aceito no atalho: rota interna da aplicação ou página https. */
const ENDERECO_INTERNO = /^\/[A-Za-z0-9/_.?=&%-]*$/;
const ENDERECO_EXTERNO = /^https:\/\/[^\s<>"']+$/;

export function enderecoAtalhoValido(e: string): boolean {
  const v = e.trim();
  if (v.length === 0 || v.length > 1000) return false;
  if (v.startsWith('//')) return false;
  return ENDERECO_INTERNO.test(v) || ENDERECO_EXTERNO.test(v);
}

/** O que falta ou sobra nos blocos (a tela confere na hora; o servidor confere de novo). */
export function conferirBlocosInicio(
  blocos: readonly BlocoInicioEntrada[],
  catalogo: ReadonlySet<string>,
): ErroRegraInicio[] {
  const erros: ErroRegraInicio[] = [];
  if (blocos.length > MAXIMO_BLOCOS_INICIO)
    erros.push({
      campo: 'blocos',
      codigo: 'blocos-demais',
      mensagem: `A página aceita até ${MAXIMO_BLOCOS_INICIO} blocos.`,
    });
  const listas = new Set<string>();
  const indicadores = new Set<number>();
  blocos.forEach((b, i) => {
    const campo = `blocos[${i}]`;
    if (!Number.isInteger(b.largura) || b.largura < 1 || b.largura > 3)
      erros.push({ campo, codigo: 'largura-invalida', mensagem: 'A largura vai de 1 a 3 colunas.' });
    if (b.titulo !== null && b.titulo.trim().length > 150)
      erros.push({ campo, codigo: 'titulo-longo', mensagem: 'O título tem até 150 caracteres.' });
    switch (b.tipo) {
      case 'lista_trabalho':
        if (!b.catalogo || !catalogo.has(b.catalogo))
          erros.push({
            campo,
            codigo: 'lista-desconhecida',
            mensagem: 'Escolha a lista de trabalho do catálogo.',
          });
        else if (listas.has(b.catalogo))
          erros.push({
            campo,
            codigo: 'lista-repetida',
            mensagem: 'A mesma lista de trabalho já está na página.',
          });
        else listas.add(b.catalogo);
        break;
      case 'indicador':
        if (b.indicadorId === null || !Number.isInteger(b.indicadorId) || b.indicadorId <= 0)
          erros.push({ campo, codigo: 'indicador-ausente', mensagem: 'Escolha o indicador.' });
        else if (indicadores.has(b.indicadorId))
          erros.push({
            campo,
            codigo: 'indicador-repetido',
            mensagem: 'O mesmo indicador já está na página.',
          });
        else indicadores.add(b.indicadorId);
        break;
      case 'link':
        if (!b.endereco || !enderecoAtalhoValido(b.endereco))
          erros.push({
            campo,
            codigo: 'endereco-invalido',
            mensagem: 'O atalho leva a uma tela do sistema (começa com /) ou a uma página https.',
          });
        if (!b.titulo || b.titulo.trim().length === 0)
          erros.push({ campo, codigo: 'titulo-ausente', mensagem: 'O atalho precisa de um título.' });
        break;
      case 'texto':
        if (!b.texto || b.texto.trim().length === 0)
          erros.push({ campo, codigo: 'texto-ausente', mensagem: 'Escreva o texto do bloco.' });
        else if (b.texto.trim().length > 2000)
          erros.push({ campo, codigo: 'texto-longo', mensagem: 'O texto tem até 2000 caracteres.' });
        break;
    }
  });
  return erros;
}

export function conferirPerfisInicio(perfis: readonly PerfilModeloInicioEntrada[]): ErroRegraInicio[] {
  const erros: ErroRegraInicio[] = [];
  if (perfis.length > MAXIMO_PERFIS_INICIO)
    erros.push({
      campo: 'perfis',
      codigo: 'perfis-demais',
      mensagem: `Um modelo vale para até ${MAXIMO_PERFIS_INICIO} perfis.`,
    });
  const vistos = new Set<number>();
  perfis.forEach((p, i) => {
    const campo = `perfis[${i}]`;
    if (!Number.isInteger(p.prioridade) || p.prioridade < 1 || p.prioridade > 99)
      erros.push({ campo, codigo: 'prioridade-invalida', mensagem: 'A prioridade vai de 1 a 99.' });
    if (vistos.has(p.perfilId))
      erros.push({ campo, codigo: 'perfil-repetido', mensagem: 'O perfil já está ligado a este modelo.' });
    vistos.add(p.perfilId);
  });
  return erros;
}

const TRANSICOES: Readonly<Record<SituacaoModeloInicio, readonly SituacaoModeloInicio[]>> = {
  rascunho: ['publicado', 'inativo'],
  publicado: ['rascunho', 'inativo'],
  inativo: ['rascunho', 'publicado'],
};

export function podeTransitarModeloInicio(de: SituacaoModeloInicio, para: SituacaoModeloInicio): boolean {
  return TRANSICOES[de].includes(para);
}

/** O modelo só vai ao ar com o que mostrar e para quem mostrar. */
export function conferirPublicacaoInicio(blocos: number, perfis: number): ErroRegraInicio[] {
  const erros: ErroRegraInicio[] = [];
  if (blocos < 1)
    erros.push({
      campo: 'blocos',
      codigo: 'sem-blocos',
      mensagem: 'Inclua ao menos um bloco antes de publicar.',
    });
  if (perfis < 1)
    erros.push({
      campo: 'perfis',
      codigo: 'sem-perfis',
      mensagem: 'Ligue ao menos um perfil antes de publicar.',
    });
  return erros;
}

export interface CandidatoModeloInicio {
  readonly modeloId: number;
  readonly situacao: SituacaoModeloInicio;
  /** Nulo: modelo da rede inteira. */
  readonly estabelecimentoId: number | null;
  readonly prioridade: number;
}

/**
 * O modelo de quem tem estes perfis no estabelecimento: só os publicados do estabelecimento ou da rede; a menor
 * prioridade vence; no empate, o do estabelecimento vence o da rede, e depois o mais antigo. Nulo: a página fixa.
 */
export function escolherModeloInicio(
  candidatos: readonly CandidatoModeloInicio[],
  estabelecimento: number,
): number | null {
  const validos = candidatos.filter(
    (c) =>
      c.situacao === 'publicado' && (c.estabelecimentoId === null || c.estabelecimentoId === estabelecimento),
  );
  validos.sort(
    (a, b) =>
      a.prioridade - b.prioridade ||
      Number(a.estabelecimentoId === null) - Number(b.estabelecimentoId === null) ||
      a.modeloId - b.modeloId,
  );
  return validos[0]?.modeloId ?? null;
}

/** Os blocos que a pessoa vê: a lista de trabalho só quando a fila está liberada para ela (regra da página fixa). */
export function blocosVisiveisInicio<
  B extends { readonly tipo: TipoBlocoInicio; readonly catalogo: string | null },
>(blocos: readonly B[], listasLiberadas: ReadonlySet<string>): B[] {
  return blocos.filter(
    (b) => b.tipo !== 'lista_trabalho' || (b.catalogo !== null && listasLiberadas.has(b.catalogo)),
  );
}

export interface PontoSerieInicio {
  readonly competencia: string;
  readonly valor: number | null;
  readonly meta: number | null;
}

/** As barras do gráfico do indicador: altura em % do maior valor (ou da meta) da série; sem valor, 0. */
export function barrasDoIndicadorInicio(
  serie: readonly PontoSerieInicio[],
): { competencia: string; altura: number }[] {
  const maior = Math.max(0, ...serie.flatMap((p) => [p.valor ?? 0, p.meta ?? 0]).map((v) => Math.abs(v)));
  return serie.map((p) => ({
    competencia: p.competencia,
    altura: maior === 0 || p.valor === null ? 0 : Math.round((Math.abs(p.valor) / maior) * 100),
  }));
}
