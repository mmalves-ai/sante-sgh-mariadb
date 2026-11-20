// Serviço do M13 (catálogos oficiais): monta a preparação da carga (leitura, validação e comparação pelas regras
// puras de @sgh/dominio-catalogo sobre o que a fonte lê do banco), o painel de cargas e a decisão de publicar. A
// publicação no banco do estabelecimento é do worker (lotes curtos na janela); na memória, logo na aprovação.
import { createHash } from 'node:crypto';
import {
  CATALOGOS,
  type CodigoCatalogo,
  definicaoCatalogo,
  ITENS_POR_LOTE_CATALOGO,
  type NovaCargaCatalogo,
  type PainelCatalogos,
} from '@sgh/contratos';
import {
  competenciaValida,
  type DecisaoPublicacao,
  decidirPublicacao,
  dentroDaJanela,
  type JanelaPublicacao,
  lerJanela,
  ordemDePublicacao,
  prepararCarga,
} from '@sgh/dominio-catalogo';
import type { CargaCatalogoLida, LinhaCatalogoPreparada } from '@sgh/legado';
import type { CtxCatalogos, FonteCatalogos, Trilha } from './fonte.js';

export const SERVICO_CATALOGOS = Symbol('SERVICO_CATALOGOS');

export interface OpcoesServicoCatalogos {
  readonly ambiente: string;
  /** Janela fora do pico (texto HH:MM-HH:MM; padrão 22:00-06:00). */
  readonly janela?: string | null;
  /** Guarda o arquivo original (S3 com Object Lock); null = não guardado (sem armazenamento configurado). */
  readonly guardarArquivo?: (
    hospital: string,
    sha256: string,
    nome: string,
    conteudo: string,
  ) => Promise<string | null>;
  readonly agora?: () => Date;
  readonly tamanhoLote?: number;
  /** Validade do cache da edição no banco (agregados MAX e COUNT do painel). Padrão: 3 horas. */
  readonly cacheEdicaoMs?: number;
}

/** Validade padrão do cache dos agregados do painel (ficha, seção 4: "em cache por horas"). */
export const CACHE_EDICAO_MS = 3 * 3_600_000;

interface EdicaoEmCache {
  readonly valor: { ultima: string | null; descricao: string; linhas: number };
  readonly ate: number;
  /** Última carga publicada do catálogo quando o valor foi lido: outra publicada invalida o cache. */
  readonly marcador: string;
}

/** Minutos desde a meia-noite no fuso civil do Brasil (UTC−3, sem horário de verão desde 2019). */
function minutosAgora(d: Date): number {
  const m = d.getUTCHours() * 60 + d.getUTCMinutes() - 180;
  return (m + 1440) % 1440;
}

/** Competência corrente (AAAAMM) no fuso civil. */
function competenciaCorrente(d: Date): string {
  const x = new Date(d.getTime() - 3 * 3_600_000);
  return `${x.getUTCFullYear()}${String(x.getUTCMonth() + 1).padStart(2, '0')}`;
}

function mesesEntre(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(4, 6)) - Number(a.slice(4, 6));
}

export class ServicoCatalogos {
  readonly janela: JanelaPublicacao;
  private readonly edicoes = new Map<string, EdicaoEmCache>();
  constructor(
    readonly fonte: FonteCatalogos,
    private readonly opcoes: OpcoesServicoCatalogos,
  ) {
    this.janela = lerJanela(opcoes.janela ?? null);
  }

  private agora(): Date {
    return this.opcoes.agora?.() ?? new Date();
  }

  /** Publicar fora da janela só fora de produção (desenvolvimento, homologação e treino). */
  get ignoraJanela(): boolean {
    return this.opcoes.ambiente !== 'producao';
  }

  async preparar(
    ctx: CtxCatalogos,
    autor: string,
    entrada: NovaCargaCatalogo,
    trilha: Trilha,
  ): Promise<{
    id: number;
    situacao: string;
    totais: CargaCatalogoLida['totais'];
    motivo: string | null;
    lotes: number;
  }> {
    const def = definicaoCatalogo(entrada.catalogo);
    if (!def) throw new Error('Catálogo inexistente.');
    const ordenados = [...entrada.arquivos].sort((a, b) => a.nome.localeCompare(b.nome));
    const h = createHash('sha256');
    for (const a of ordenados) h.update(`${a.nome}\u0000${a.conteudo}\u0001`);
    const sha256 = h.digest('hex');
    const bytes = ordenados.reduce((s, a) => s + Buffer.byteLength(a.conteudo, 'utf8'), 0);
    const reimportada = await this.fonte.publicadaComHash(ctx, def.codigo, sha256);
    const leiauteCep = def.codigo === 'cep' ? await this.fonte.leiauteCep(ctx) : undefined;
    const tamanho = this.opcoes.tamanhoLote ?? ITENS_POR_LOTE_CATALOGO;
    const prep = await prepararCarga(
      def,
      ordenados,
      entrada.edicao ?? null,
      this.fonte.leituraDoBanco(ctx, def.codigo),
      {
        ...(leiauteCep ? { leiauteCep } : {}),
        tamanhoLote: tamanho,
      },
    );
    const errosArquivo = [...prep.errosArquivo];
    if (reimportada !== null)
      errosArquivo.unshift(
        `reimportação: o mesmo arquivo já foi publicado (carga ${reimportada}); nada a gravar`,
      );
    // Lotes na ordem de publicação (entidades na ordem da definição): o código novo nunca num lote depois do par.
    const publicaveis = errosArquivo.length === 0 && prep.totais.erros === 0;
    const loteDe = new Map<object, number>();
    if (publicaveis)
      ordemDePublicacao(
        def,
        prep.linhas.filter((l) => l.publicar),
      ).forEach((l, k) => loteDe.set(l, Math.floor(k / tamanho) + 1));
    const linhas: LinhaCatalogoPreparada[] = prep.linhas.map((l) => ({
      linha: l.linha,
      entidade: l.entidade,
      chave: l.chave,
      resultado: l.resultado,
      comparacao: l.comparacao,
      antes: l.antes,
      depois: l.depois,
      motivo: l.motivos.length > 0 ? l.motivos.join('; ').slice(0, 200) : null,
      lote: loteDe.get(l) ?? null,
    }));
    const situacao = errosArquivo.length > 0 ? 'rejeitada' : 'comparada';
    const motivo =
      errosArquivo.length > 0
        ? errosArquivo.join('; ').slice(0, 200)
        : prep.totais.erros > 0
          ? `${prep.totais.erros} linha(s) com erro: corrija o arquivo e envie de novo.`
          : prep.aPublicar.length === 0
            ? 'Nada a publicar: o arquivo é igual ao que o banco já tem.'
            : null;
    // A codificação lida pela tela fica registrada no nome da carga quando não é UTF-8 (arquivo oficial em
    // Windows-1252/Latin-1, decodificado sem perder os acentos).
    const nomeArquivo = ordenados
      .map((a) => (a.charset && a.charset !== 'utf-8' ? `${a.nome} (${a.charset})` : a.nome))
      .join(', ')
      .slice(0, 120);
    const arquivoS3 =
      situacao === 'comparada' && this.opcoes.guardarArquivo
        ? await this.opcoes
            .guardarArquivo(ctx.hospital, sha256, nomeArquivo, ordenados.map((a) => a.conteudo).join('\n'))
            .catch(() => null)
        : null;
    const lotes = situacao === 'comparada' ? prep.lotes : 0;
    const { id } = await this.fonte.gravarCarga(
      ctx,
      {
        hospital: ctx.hospital,
        catalogo: def.codigo,
        arquivo: nomeArquivo,
        sha256,
        bytes,
        arquivoS3,
        situacao,
        edicao: prep.edicao,
        responsavel: autor,
        motivo,
        totais: prep.totais,
        lotes: { total: lotes, tamanho },
        linhas,
      },
      trilha,
    );
    return { id, situacao, totais: prep.totais, motivo, lotes };
  }

  /** Pode aprovar e publicar? (a operação refaz a conferência na transação de cada lote). */
  async decisao(ctx: CtxCatalogos, c: CargaCatalogoLida): Promise<DecisaoPublicacao> {
    const cat = c.catalogo as CodigoCatalogo;
    const def = definicaoCatalogo(cat);
    if (!def) return { pode: false, codigo: 'catalogo-inexistente', motivo: 'Catálogo inexistente.' };
    const [responsavel, contrato] = await Promise.all([
      this.fonte.responsavel(ctx, cat),
      this.fonte.contrato(ctx, cat),
    ]);
    return decidirPublicacao({
      situacao: c.situacao,
      responsavel,
      exigeContrato: def.exigeContrato,
      contratoVigente: contrato,
      erros: c.totais.erros,
      itensAPublicar: c.lotes.total,
      janela: this.janela,
      agoraMinutos: minutosAgora(this.agora()),
      ignorarJanela: this.ignoraJanela,
    });
  }

  /**
   * Edição e contagens do catálogo no banco (MAX e COUNT, com COUNT(*) em tabelas de centenas de milhares de
   * linhas): em cache por estabelecimento e catálogo por horas, invalidado quando uma carga do catálogo é
   * publicada (ou muda de lote). Falha de leitura não entra no cache.
   */
  private async edicaoEmCache(
    ctx: CtxCatalogos,
    codigo: CodigoCatalogo,
    cargas: readonly CargaCatalogoLida[],
  ): Promise<{ ultima: string | null; descricao: string; linhas: number }> {
    const k = `${ctx.hospital}:${codigo}`;
    const marcador = cargas
      .filter((x) => ['publicada', 'publicando'].includes(x.situacao))
      .map((x) => `${x.id}:${x.lotes.publicados}`)
      .join(',');
    const agora = this.agora().getTime();
    const c = this.edicoes.get(k);
    if (c && c.ate > agora && c.marcador === marcador) return c.valor;
    try {
      const valor = await this.fonte.edicao(ctx, codigo);
      this.edicoes.set(k, { valor, ate: agora + (this.opcoes.cacheEdicaoMs ?? CACHE_EDICAO_MS), marcador });
      return valor;
    } catch {
      return { ultima: null, descricao: 'indisponível', linhas: 0 };
    }
  }

  async painel(ctx: CtxCatalogos): Promise<PainelCatalogos> {
    const todas = (await this.fonte.cargas(ctx, null)) ?? [];
    const agora = this.agora();
    const catalogos = await Promise.all(
      CATALOGOS.map(async (def) => {
        const [responsavel, contrato, edicao] = await Promise.all([
          this.fonte.responsavel(ctx, def.codigo),
          this.fonte.contrato(ctx, def.codigo),
          this.edicaoEmCache(
            ctx,
            def.codigo,
            todas.filter((x) => x.catalogo === def.codigo),
          ),
        ]);
        const doCatalogo = todas.filter((x) => x.catalogo === def.codigo);
        const ultima = doCatalogo[0] ?? null;
        let atraso: string | null = null;
        if (def.edicao === 'competencia' && edicao.ultima && competenciaValida(edicao.ultima)) {
          const n = mesesEntre(edicao.ultima, competenciaCorrente(agora));
          if (n > 1) atraso = `${n} competências atrás da corrente (${competenciaCorrente(agora)})`;
        }
        return {
          codigo: def.codigo,
          titulo: def.titulo,
          rota: def.rota,
          responsavel,
          ultimaCarga: ultima
            ? { id: ultima.id, situacao: ultima.situacao, quando: ultima.criadaEm, edicao: ultima.edicao }
            : null,
          edicaoNoBanco: { descricao: edicao.descricao, valor: edicao.ultima, linhas: edicao.linhas },
          atraso,
          erros: doCatalogo.filter(
            (x) => x.situacao === 'falhou' || (x.situacao === 'rejeitada' && x.totais.erros > 0),
          ).length,
          licenca: {
            exigida: def.exigeContrato,
            vigente: !def.exigeContrato || contrato,
            motivo:
              def.exigeContrato && !contrato
                ? 'Sem contrato de dados registrado (DP-36): a carga não é publicada.'
                : null,
          },
        };
      }),
    );
    return {
      catalogos,
      janela: {
        inicio: this.janela.inicio,
        fim: this.janela.fim,
        agoraDentro: dentroDaJanela(this.janela, minutosAgora(agora)),
      },
    };
  }
}
