// Emissão de documento de prova (regra 9 da ficha do M09; roteiro 6.8): HTML do modelo → PDF/A-2b no
// Gotenberg → SHA-256 → reserva da linha (emissão do documento, com via, chave, QR e hash) → porta de arquivos do
// núcleo (ADR 0004: disco local, gravação uma vez e somente leitura, guarda legal no registro `arquivo`) →
// confirmação com o id do arquivo guardado. A reserva vem antes da gravação: nenhum PDF guardado fica sem registro,
// e a via disputada por duas reemissões é decidida antes de gravar (quem perde tenta a próxima). Reemissão é nova
// via marcada "2ª via", com motivo. A validação pública pelo QR mostra só existência, data, estabelecimento e hash.
// O campo `versaoS3` do registro da emissão guarda o id do arquivo (o nome sai no domínio por pedido deste lote).
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  type CampoDocumento,
  chaveObjeto,
  type EmissaoDocumento,
  ErroEmissao,
  ErroViaOcupada,
  exigirMotivo,
  fonteEmbutida,
  htmlDocumento,
  novoIdentificadorQr,
  type ObjetoOrigem,
  proximaVia,
  qrSvg,
  rotuloVia,
  sha256Hex,
  urlValidacao,
  validacaoPublica,
  type ValidacaoPublica,
} from '@sgh/dominio-documento';
import { type ArmazemArquivos, type ContextoNucleo, type ContextoOperacao, dataUtc } from '@sgh/nucleo';
import { idDoArquivo } from '../infra/arquivos.js';
import { converterHtmlEmPdfA } from '../infra/gotenberg.js';
import type { RegistroEmissoes } from '../infra/registro.js';

/** Guarda legal do arquivo: até quando a exclusão é recusada e se é imutável (homologação e produção). */
export interface PoliticaRetencao {
  readonly imutavel: boolean;
  readonly duracaoMs: number;
}

/** Imutável em homologação e produção (20 anos, Lei 13.787/2018); guarda curta no dev e no CI. */
export function politicaRetencao(ambiente: string, env: NodeJS.ProcessEnv = process.env): PoliticaRetencao {
  const dias = Number(env['DOCUMENTO_RETENCAO_DIAS'] ?? '');
  if (ambiente === 'producao' || ambiente === 'homolog') {
    return {
      imutavel: true,
      duracaoMs: (Number.isFinite(dias) && dias > 0 ? dias : 365 * 20) * 86_400_000,
    };
  }
  return {
    imutavel: false,
    duracaoMs: (Number.isFinite(dias) && dias > 0 ? Math.min(dias, 2) : 1) * 86_400_000,
  };
}

/** Data (AAAA-MM-DD) até a qual o arquivo fica sob guarda legal, contada do relógio da gravação. */
export function retencaoAte(politica: PoliticaRetencao, agoraMs: number = Date.now()): string {
  return dataUtc(new Date(agoraMs + politica.duracaoMs));
}

export interface DependenciasEmissao {
  /** Porta de arquivos do núcleo (ADR 0004). */
  readonly armazem: ArmazemArquivos;
  /** Cliente (banco) dono dos arquivos. */
  readonly cliente: string;
  readonly gotenbergUrl: string;
  readonly registro: RegistroEmissoes;
  readonly retencao: PoliticaRetencao;
  readonly produto: string;
  readonly baseUrlValidacao: string;
  readonly nomeEstabelecimento: (codigo: string) => string;
  /** Pasta de node_modules (fonte embutida); padrão: a do processo. */
  readonly raiz?: string;
  /** Data e hora impressas no documento (fixável em teste); padrão: o relógio real. */
  readonly agora?: () => Date;
  /**
   * Relógio da guarda legal, que conta do momento da gravação e não da data impressa: com `agora` fixo no passado
   * (teste visual), a guarda cairia no passado. Padrão: o relógio real.
   */
  readonly relogioRetencao?: () => number;
  readonly aoConverter?: (ms: number) => void;
  /**
   * SBIS-42: o número do certificado SBIS vigente do estabelecimento, para o rodapé (null sem certificado). Falha da
   * leitura vira rodapé sem a certificação: o documento nunca afirma um certificado que não se confirmou.
   */
  readonly certificadoSbis?: (estabelecimento: string) => Promise<string | null>;
  /**
   * Id do estabelecimento (estabelecimento.id) pelo código do pedido, para o contexto do arquivo guardado (chave, linha
   * em `arquivo` e trilha). Com o banco próprio é obrigatório e recusa o código fora do mapa; sem ele (porta em
   * memória da sessão sintética), o arquivo fica sem estabelecimento.
   */
  readonly idEstabelecimento?: (codigo: string) => Promise<number>;
}

/** Dono do arquivo guardado: estabelecimento (código), usuário e a linha da tabela dona, quando já tem id. */
interface VinculoArquivo {
  readonly estabelecimento: string;
  readonly usuario: number | null;
  readonly entidade: string;
  readonly entidadeId: number | null;
}

export interface PedidoEmissao {
  readonly rede: string;
  readonly estabelecimento: string;
  readonly modelo: string;
  readonly versaoModelo: string;
  readonly titulo: string;
  readonly origem: ObjetoOrigem;
  readonly campos: readonly CampoDocumento[];
  readonly autor: string;
  /** ADR 0021: marca do documento emitido numa sessão "como" (ponto único: marcaSuporteTecnico). */
  readonly marcaSuporte?: string | null;
  /** Usuário que emite (usuario.id), para o contexto do arquivo e a trilha; null em processo automático. */
  readonly usuario?: number | null;
  /**
   * M49, etapa 2: o QR do documento a assinar com ICP aponta o verificador público (`/verificar/<código>`), com o
   * código opaco da prévia; sem isto, o QR da validação do M09.
   */
  readonly qr?: { readonly identificador: string; readonly url: string };
  /**
   * 01-ADM L82: a justificativa da 1ª via de documento do prontuário (a nova via leva o motivo). Fica gravada na
   * própria emissão, ao lado do motivo da reemissão, para toda impressão dizer por quê.
   */
  readonly justificativa?: string | null;
}

/** Tentativas da reemissão quando outra pegou a mesma via ao mesmo tempo. */
const TENTATIVAS_VIA = 5;

export interface EmissaoFeita {
  readonly emissao: EmissaoDocumento;
  /** Id do arquivo guardado (texto), o mesmo do registro da emissão. */
  readonly versaoS3: string;
  readonly pdf: Uint8Array;
  readonly conversaoMs: number;
}

let fontes: string | null = null;
function fontesCss(raiz: string): string {
  if (fontes) return fontes;
  const pasta = resolve(raiz, 'node_modules/@fontsource/inter/files');
  fontes = [
    fonteEmbutida('SGH Documento', readFileSync(resolve(pasta, 'inter-latin-400-normal.woff2')), 400),
    fonteEmbutida('SGH Documento', readFileSync(resolve(pasta, 'inter-latin-700-normal.woff2')), 700),
    fonteEmbutida('SGH Documento', readFileSync(resolve(pasta, 'inter-latin-ext-400-normal.woff2')), 400),
  ].join('');
  return fontes;
}

export class EmissaoService {
  private readonly d: DependenciasEmissao;
  constructor(d: DependenciasEmissao) {
    this.d = d;
  }

  private contexto(correlacao: string): ContextoNucleo {
    return {
      cliente: this.d.cliente,
      estabelecimento: null,
      usuario: null,
      correlacao: correlacao.slice(0, 64),
    };
  }

  private async guardarPdf(
    pdf: Uint8Array,
    nome: string,
    finalidade: string,
    chaveIdempotencia: string,
    vinculo: VinculoArquivo,
  ): Promise<string> {
    const estabelecimento = this.d.idEstabelecimento
      ? await this.d.idEstabelecimento(vinculo.estabelecimento)
      : null;
    const ctx: ContextoOperacao = {
      ...this.contexto(chaveIdempotencia),
      estabelecimento,
      usuario: vinculo.usuario,
      chaveIdempotencia,
    };
    const g = await this.d.armazem.guardar(
      {
        conteudo: pdf,
        nomeOriginal: nome,
        tipoMime: 'application/pdf',
        finalidade,
        // Tabela dona sempre; o id da linha quando o registro já o tem (o registro em memória da sessão sintética não).
        entidade: vinculo.entidade,
        entidadeId: vinculo.entidadeId,
        retencaoAte: retencaoAte(this.d.retencao, (this.d.relogioRetencao ?? Date.now)()),
        imutavel: this.d.retencao.imutavel,
      },
      ctx,
    );
    return String(g.id);
  }

  private async lerArquivo(texto: string | null, hashEsperado?: string): Promise<Uint8Array> {
    const id = idDoArquivo(texto);
    if (id === null) throw new ErroEmissao('Emissão sem arquivo guardado.');
    const { metadado, conteudo } = await this.d.armazem.ler(this.contexto(`documento-leitura-${id}`), id);
    if (hashEsperado !== undefined && metadado.hash !== hashEsperado)
      throw new ErroEmissao('O arquivo guardado não confere com o hash da emissão.');
    return new Uint8Array(conteudo);
  }

  private async emitirVia(
    pedido: PedidoEmissao,
    via: number,
    original: EmissaoDocumento | null,
    motivo: string | null,
  ): Promise<EmissaoFeita> {
    const agora = (this.d.agora ?? (() => new Date()))();
    const id = randomUUID();
    const identificadorQr = pedido.qr?.identificador ?? novoIdentificadorQr();
    const chave = chaveObjeto({
      rede: pedido.rede,
      estabelecimento: pedido.estabelecimento,
      modelo: pedido.modelo,
      id,
      via,
    });
    const certificadoSbis = this.d.certificadoSbis
      ? await this.d.certificadoSbis(pedido.estabelecimento).catch(() => null)
      : null;
    const html = htmlDocumento({
      certificadoSbis,
      titulo: pedido.titulo,
      produto: this.d.produto,
      estabelecimento: this.d.nomeEstabelecimento(pedido.estabelecimento),
      emitidoEm: new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'America/Sao_Paulo',
      }).format(agora),
      via: rotuloVia(via),
      campos: pedido.campos,
      qrSvg: qrSvg(pedido.qr?.url ?? urlValidacao(this.d.baseUrlValidacao, identificadorQr)),
      identificadorQr,
      fontesCss: fontesCss(this.d.raiz ?? process.cwd()),
      marcaSuporte: pedido.marcaSuporte ?? null,
    });
    const rotulo = rotuloVia(via);
    const { pdf, ms } = await converterHtmlEmPdfA(this.d.gotenbergUrl, html, {
      metadados: {
        Title: rotulo ? `${pedido.titulo} - ${rotulo}` : pedido.titulo,
        Keywords: `sgh-documento;modelo=${pedido.modelo};versao=${pedido.versaoModelo};via=${via}`,
        Creator: this.d.produto,
      },
    });
    this.d.aoConverter?.(ms);
    const sha256 = await sha256Hex(pdf);
    const reserva: EmissaoDocumento = {
      id,
      rede: pedido.rede,
      estabelecimento: pedido.estabelecimento,
      modelo: pedido.modelo,
      versaoModelo: pedido.versaoModelo,
      origem: pedido.origem,
      via,
      idOriginal: original?.id ?? null,
      motivoReemissao: motivo,
      sha256,
      chaveObjeto: chave,
      identificadorQr,
      autor: pedido.autor,
      emitidoEm: agora.toISOString(),
      versaoS3: null,
    };
    // 1. Reserva (unicidade conferida aqui, antes de qualquer arquivo guardado).
    const linha = await this.d.registro.reservar(reserva);
    // 2. Gravação uma vez, com a guarda legal. Se falhar, a reserva fica sem arquivo e a validação pública não a mostra.
    const arquivo = await this.guardarPdf(
      pdf,
      `${pedido.modelo}-via-${via}.pdf`,
      'documento_emitido',
      `documento-${id}`,
      {
        estabelecimento: pedido.estabelecimento,
        usuario: pedido.usuario ?? null,
        entidade: 'emissao_documento',
        entidadeId: typeof linha === 'number' ? linha : null,
      },
    );
    // 3. Confirmação com o id do arquivo: a leitura do PDF é sempre por ele, conferida pelo hash.
    const emissao = await this.d.registro.confirmar(id, arquivo);
    return { emissao, versaoS3: arquivo, pdf, conversaoMs: ms };
  }

  /** PDF guardado da emissão, pelo arquivo do registro, conferido contra o hash da emissão. */
  async lerPdf(emissao: EmissaoDocumento): Promise<Uint8Array> {
    if (!emissao.versaoS3) throw new ErroEmissao('Emissão sem arquivo confirmado.');
    return this.lerArquivo(emissao.versaoS3, emissao.sha256);
  }

  /**
   * M49, etapa 2: confere que a porta de arquivos está disponível antes de emitir a prévia (sem configuração, a
   * operação recusa aqui). Mantido com o nome antigo até o módulo de assinatura migrar (pedido deste lote).
   */
  async garantirBucket(): Promise<void> {
    await this.d.armazem.existe(this.contexto('documento-conferencia'), 1);
  }

  /** M49, etapa 2: lê um PDF guardado (a prévia exata ou o PDF assinado) pelo id do arquivo; a chave é referência. */
  lerObjeto(_chave: string, arquivo: string): Promise<Uint8Array> {
    return this.lerArquivo(arquivo);
  }

  /**
   * M49, etapa 2: guarda o PDF assinado (a prévia + a revisão incremental com o CMS) como arquivo novo, com a mesma
   * guarda legal dos documentos; nunca sobrescreve. Devolve a chave do arquivo e o id dele (em `versao`).
   */
  async gravarAssinado(
    rede: string,
    estabelecimento: string,
    assinatura: number,
    pdf: Uint8Array,
    usuario: number | null = null,
  ): Promise<{ chave: string; versao: string }> {
    for (const [nome, v] of [
      ['rede', rede],
      ['estabelecimento', estabelecimento],
    ] as const)
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(v))
        throw new ErroEmissao(`${nome} inválido para a chave do documento.`);
    if (!Number.isSafeInteger(assinatura) || assinatura < 1) throw new ErroEmissao('Assinatura inválida.');
    const versao = await this.guardarPdf(
      pdf,
      `assinatura-${assinatura}.pdf`,
      'documento_assinado',
      `assinado-${assinatura}-${randomUUID()}`.slice(0, 64),
      { estabelecimento, usuario, entidade: 'assinatura_icp', entidadeId: assinatura },
    );
    const meta = await this.d.armazem.metadado(
      this.contexto(`documento-assinado-${assinatura}`),
      Number(versao),
    );
    if (!meta) throw new ErroEmissao('O PDF assinado não ficou registrado.');
    return { chave: meta.chave, versao };
  }

  emitir(pedido: PedidoEmissao): Promise<EmissaoFeita> {
    return this.emitirVia(pedido, 1, null, pedido.justificativa?.trim().slice(0, 200) || null);
  }

  /**
   * A 1ª via já emitida do objeto de origem neste estabelecimento e modelo (null se nunca foi impresso): a
   * reimpressão vira 2ª via pelo registro, não por estado do processo (vale depois de reiniciar e entre instâncias).
   */
  async originalDaOrigem(
    estabelecimento: string,
    modelo: string,
    origem: ObjetoOrigem,
  ): Promise<EmissaoDocumento | null> {
    const ls = await this.d.registro.daOrigem(origem.tipo, origem.idLegado);
    return (
      ls.find((x) => x.idOriginal === null && x.estabelecimento === estabelecimento && x.modelo === modelo) ??
      null
    );
  }

  /** 2ª via (ou seguinte): nova emissão marcada, ligada à 1ª via, com motivo; o original fica intacto. */
  async segundaVia(
    idOriginal: string,
    motivo: string,
    pedido: Omit<PedidoEmissao, 'rede' | 'estabelecimento' | 'modelo' | 'versaoModelo' | 'origem'>,
  ): Promise<EmissaoFeita> {
    const original = await this.d.registro.porId(idOriginal);
    if (!original) throw new ErroEmissao('Documento original não encontrado.');
    const m = exigirMotivo(motivo);
    for (let tentativa = 1; ; tentativa++) {
      const via = proximaVia(original, await this.d.registro.doOriginal(original.id));
      try {
        return await this.emitirVia(
          {
            ...pedido,
            rede: original.rede,
            estabelecimento: original.estabelecimento,
            modelo: original.modelo,
            versaoModelo: original.versaoModelo,
            origem: original.origem,
          },
          via,
          original,
          m,
        );
      } catch (e) {
        // Outra reemissão reservou esta via primeiro (nada foi guardado): recalcula e tenta de novo.
        if (e instanceof ErroViaOcupada && tentativa < TENTATIVAS_VIA) continue;
        throw e;
      }
    }
  }

  async validar(identificadorQr: string): Promise<ValidacaoPublica> {
    return validacaoPublica(await this.d.registro.porQr(identificadorQr), this.d.nomeEstabelecimento);
  }
}
