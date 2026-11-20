// Emissão de documento de prova (regra 9 da ficha do M09; roteiro 6.8): HTML do modelo → PDF/A-2b no
// Gotenberg → SHA-256 → reserva da linha (SGH_DOCUMENTO_EMISSAO, com via, chave, QR e hash) → S3 com Object
// Lock (chave única por emissão e via, nunca sobrescrita) → confirmação com a versão do S3. A reserva vem
// antes do PUT: nenhum PDF travado fica sem registro, e a via disputada por duas reemissões é decidida antes
// de gravar (quem perde tenta a próxima). Reemissão é nova via marcada "2ª via", com motivo. A validação
// pública pelo QR mostra só existência, data, estabelecimento e hash. Massa sintética no spike.
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
import { converterHtmlEmPdfA } from '../infra/gotenberg.js';
import type { RegistroEmissoes } from '../infra/registro.js';
import type { ClienteS3, ModoRetencao } from '../infra/s3.js';

export interface PoliticaRetencao {
  readonly modo: ModoRetencao;
  readonly duracaoMs: number;
}

/** Compliance em homologação e produção (20 anos, Lei 13.787/2018); governance curto no dev e no CI. */
export function politicaRetencao(ambiente: string, env: NodeJS.ProcessEnv = process.env): PoliticaRetencao {
  const dias = Number(env['DOCUMENTO_RETENCAO_DIAS'] ?? '');
  if (ambiente === 'producao' || ambiente === 'homolog') {
    return {
      modo: 'COMPLIANCE',
      duracaoMs: (Number.isFinite(dias) && dias > 0 ? dias : 365 * 20) * 86_400_000,
    };
  }
  return {
    modo: 'GOVERNANCE',
    duracaoMs: (Number.isFinite(dias) && dias > 0 ? Math.min(dias, 2) : 1) * 86_400_000,
  };
}

export interface DependenciasEmissao {
  readonly s3: ClienteS3;
  readonly bucket: string;
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
   * Relógio da retenção no S3, que conta do momento da gravação e não da data impressa: com `agora` fixo
   * no passado (teste visual), a retenção cairia no passado e o S3 recusaria. Padrão: o relógio real.
   */
  readonly relogioRetencao?: () => number;
  readonly aoConverter?: (ms: number) => void;
  /**
   * SBIS-42: o número do certificado SBIS vigente do estabelecimento, para o rodapé (null sem certificado). Falha da
   * leitura vira rodapé sem a certificação: o documento nunca afirma um certificado que não se confirmou.
   */
  readonly certificadoSbis?: (estabelecimento: string) => Promise<string | null>;
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
  /**
   * M49, etapa 2: o QR do documento a assinar com ICP aponta o verificador público (`/verificar/<código>`), com o
   * código opaco da prévia; sem isto, o QR da validação do M09.
   */
  readonly qr?: { readonly identificador: string; readonly url: string };
}

/** Tentativas da reemissão quando outra pegou a mesma via ao mesmo tempo. */
const TENTATIVAS_VIA = 5;

export interface EmissaoFeita {
  readonly emissao: EmissaoDocumento;
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
    // Nunca sobrescreve: a chave é nova por construção e, ainda assim, é conferida antes de gravar.
    if (await this.d.s3.existe(this.d.bucket, chave))
      throw new ErroEmissao('Já existe documento nesta chave.');
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
    // 1. Reserva (unicidade conferida aqui, antes de qualquer objeto travado no S3).
    await this.d.registro.reservar(reserva);
    // 2. PUT com retenção. Se falhar, a reserva fica sem objeto e a validação pública não a mostra.
    const { versao } = await this.d.s3.gravarComRetencao(
      this.d.bucket,
      chave,
      pdf,
      'application/pdf',
      this.d.retencao.modo,
      new Date((this.d.relogioRetencao ?? Date.now)() + this.d.retencao.duracaoMs),
    );
    if (!versao) throw new ErroEmissao('O S3 não devolveu a versão do objeto (versionamento desligado?).');
    // 3. Confirmação com a versão: a leitura do PDF é sempre por ela.
    const emissao = await this.d.registro.confirmar(id, versao);
    return { emissao, versaoS3: versao, pdf, conversaoMs: ms };
  }

  /** PDF guardado da emissão, pela versão do registro (nunca a "mais recente" da chave). */
  async lerPdf(emissao: EmissaoDocumento): Promise<Uint8Array> {
    if (!emissao.versaoS3) throw new ErroEmissao('Emissão sem versão confirmada.');
    return this.d.s3.ler(this.d.bucket, emissao.chaveObjeto, emissao.versaoS3);
  }

  private bucketPronto: Promise<void> | null = null;

  /**
   * M49, etapa 2: o bucket dos documentos com Object Lock (idempotente; uma vez por processo), como os armazéns do
   * financeiro, do TISS e das fotos: o serviço de assinatura grava a prévia e o PDF assinado nele.
   */
  garantirBucket(): Promise<void> {
    this.bucketPronto ??= this.d.s3.criarBucketComTrava(this.d.bucket).catch((e: unknown) => {
      this.bucketPronto = null;
      throw e;
    });
    return this.bucketPronto;
  }

  /** M49, etapa 2: lê um PDF guardado pela chave e pela versão do objeto (a prévia exata ou o PDF assinado). */
  lerObjeto(chave: string, versao: string): Promise<Uint8Array> {
    return this.d.s3.ler(this.d.bucket, chave, versao);
  }

  /**
   * M49, etapa 2: grava o PDF assinado (a prévia + a revisão incremental com o CMS) numa chave nova, com a mesma
   * retenção dos documentos (Object Lock); nunca sobrescreve.
   */
  async gravarAssinado(
    rede: string,
    estabelecimento: string,
    assinatura: number,
    pdf: Uint8Array,
  ): Promise<{ chave: string; versao: string }> {
    for (const [nome, v] of [
      ['rede', rede],
      ['estabelecimento', estabelecimento],
    ] as const)
      if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(v))
        throw new ErroEmissao(`${nome} inválido para a chave do documento.`);
    if (!Number.isSafeInteger(assinatura) || assinatura < 1) throw new ErroEmissao('Assinatura inválida.');
    const chave = `${rede}/${estabelecimento}/documentos/assinados/${assinatura}/${randomUUID()}.pdf`;
    if (await this.d.s3.existe(this.d.bucket, chave))
      throw new ErroEmissao('Já existe documento nesta chave.');
    const { versao } = await this.d.s3.gravarComRetencao(
      this.d.bucket,
      chave,
      pdf,
      'application/pdf',
      this.d.retencao.modo,
      new Date((this.d.relogioRetencao ?? Date.now)() + this.d.retencao.duracaoMs),
    );
    if (!versao) throw new ErroEmissao('O S3 não devolveu a versão do objeto (versionamento desligado?).');
    return { chave, versao };
  }

  emitir(pedido: PedidoEmissao): Promise<EmissaoFeita> {
    return this.emitirVia(pedido, 1, null, null);
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
        // Outra reemissão reservou esta via primeiro (nada foi gravado no S3): recalcula e tenta de novo.
        if (e instanceof ErroViaOcupada && tentativa < TENTATIVAS_VIA) continue;
        throw e;
      }
    }
  }

  async validar(identificadorQr: string): Promise<ValidacaoPublica> {
    return validacaoPublica(await this.d.registro.porQr(identificadorQr), this.d.nomeEstabelecimento);
  }
}
