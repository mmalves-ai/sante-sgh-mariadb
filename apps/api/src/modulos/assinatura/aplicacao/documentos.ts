// Assinatura ICP-Brasil dos documentos emitidos pelo novo (M49, etapa 2; ficha, seções 4, 5, 7 e 8; regras 1 a 8, 10 e
// 12). Sobre o serviço isolado da etapa 1 (o hash, nunca o documento; a validação no servidor; o carimbo do tempo):
//   - a PRÉVIA EXATA (regra 4): o PDF/A do documento com o selo visível, o rodapé legal e o QR do verificador público,
//     gerado pelo serviço de emissão do M09 e guardado no S3 (Object Lock); o hash dele é o que a tela mostra e o que
//     o pedido devolve;
//   - o PEDIDO (um documento ou o lote, numa autorização só do provedor ou num desafio só do agente local): para cada
//     documento, a revisão incremental PAdES da prévia e o hash dos atributos assinados (D-RAW-49: o provedor assina
//     esse hash); o documento do outro sistema não tem prova e é recusado (regra 7);
//   - a CONCLUSÃO: cada assinatura validada no servidor; válida → "assinada", com o evento "assinado" (nível ICP-Brasil)
//     na cadeia do documento do prontuário e o PDF assinado (CMS destacado com o carimbo) no S3; LCR, OCSP ou ACT fora do ar →
//     PENDENTE, com o aviso ao autor e à direção técnica e a próxima tentativa (regra 5); o reprocessamento (sozinho,
//     pelo agendador, ou à mão) completa a mesma assinatura (nada é assinado de novo);
//   - o PDF assinado para validar fora do sistema (validação "ao exportar") e a numeração SNCR (desligada, POL-3).
// A trilha documental do outro sistema não muda (o novo continua gravando o tipo 1, "Somente lançamento", na emissão).
// Tudo com a trilha na mesma transação; nada de CPF, conteúdo nem segredo na trilha.
import { createHash } from 'node:crypto';
import {
  type ExigenciaAssinatura,
  EVENTOS_AUDITAVEIS,
  type FalhaTransitoriaAssinatura,
  type InicioAssinaturaIcp,
  type ItemPendenciaIcp,
  type LoteIcpPreparado,
  type MotivoRecusaAssinatura,
  type PedidoAssinaturaIcpResposta,
  type PedirAssinaturaIcp,
  type PendenciasIcpResposta,
  type PoliticaAssinaturaIcp,
  type PrepararLoteIcp,
  type PreviaIcp,
  type ResultadoFluxoAssinatura,
  ROTULOS_TIPO_DOCUMENTO_POLITICA,
  type SituacaoAssinaturaDocumento,
  type SolicitacaoSncrResumo,
  type TipoDocumentoPolitica,
} from '@sgh/contratos';
import {
  aplicarRespostaSncr,
  assinavelIcp,
  atributosAssinados,
  camposDoDocumentoIcp,
  type CampoDocumento,
  conferirAssinaturas,
  conferirTokenCarimbo,
  type ConfiguracaoPsc,
  conselhoPeloCertificado,
  type ConteudoPep,
  criarDesafio,
  destinoDoTipo,
  type DocumentoEmitido,
  enderecoAutorizacao,
  gerarEstado,
  gerarPkce,
  inserirCms,
  lerCertificado,
  lerRespostaCarimbo,
  type ModeloPep,
  montarCms,
  NOVA,
  novoIdentificadorQr,
  planejarAssinatura,
  type PoliticaAssinaturaIdentificada,
  prepararPades,
  prioridadeIcp,
  reabrir,
  registrarFalhaTransitoria,
  registrarSucesso,
  type RegraPoliticaAssinatura,
  resolverExigencia,
  type SituacaoReprocessamento,
  TIPOS_ASSINAVEIS_ICP,
  type TransicaoReprocessamento,
  urlVerificador,
} from '@sgh/dominio-documento';
import type {
  AssinaturaDoDocumento,
  CertificadoVinculado,
  DocumentoEmitidoIcp,
  PedidoAssinaturaAberto,
  PreviaDoDocumento,
  ProvedorNuvem,
} from '../tipos.js';
import { ErroProblema } from '../../../problema.filter.js';
import { linhaTrilha, type SessaoCadastro } from '../../cadastro/comum.js';
import { ErroIndisponivel } from '../infra/clientes.js';
import { resumo } from '../infra/simulador.js';
import type { ContextoAssinatura, PortaAssinaturaIcp } from '../porta.js';
import { cpfCruzadoDiverge, recusa, type ServicoAssinaturaIcp } from './servico.js';

const E = EVENTOS_AUDITAVEIS;
const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'));

/** O conteúdo do documento do prontuário, como a impressão do M23 o monta (identificação, corpo e extras). */
export interface ConteudoIcp {
  readonly modelo: ModeloPep;
  readonly titulo: string;
  readonly conteudo: ConteudoPep;
  readonly profissional: string;
}

/** O que o prontuário de uso diário (M23) entrega: o conteúdo do documento e os nomes da fila do autor. */
export interface FonteConteudoIcp {
  conteudo(c: ContextoAssinatura, d: DocumentoEmitidoIcp): Promise<ConteudoIcp>;
  nomes(c: ContextoAssinatura, pacientes: readonly number[]): Promise<Map<number, string>>;
}

/** O PDF/A pelo serviço de emissão do M09 (Gotenberg + S3 com Object Lock). */
export interface ArmazemPdfIcp {
  emitirPrevia(p: {
    readonly rede: string;
    readonly estabelecimento: string;
    readonly modelo: ModeloPep;
    readonly titulo: string;
    readonly campos: readonly CampoDocumento[];
    readonly autor: string;
    readonly documento: number;
    readonly qr: { readonly identificador: string; readonly url: string };
    readonly marcaSuporte: string | null;
  }): Promise<{ chave: string; versao: string; pdf: Uint8Array }>;
  ler(chave: string, versao: string): Promise<Uint8Array>;
  gravarAssinado(
    rede: string,
    estabelecimento: string,
    assinatura: number,
    pdf: Uint8Array,
  ): Promise<{ chave: string; versao: string }>;
}

export interface LiberacaoIcp {
  consultar(s: SessaoCadastro, chave: string): Promise<{ ligada: boolean; motivo: string | null }>;
}

/** A numeração SNCR (API pública da Anvisa pela outbox; o simulador só em dev/ci). */
export interface ClienteSncr {
  numerar(p: {
    tipo: 'controle-especial' | 'antimicrobiano';
    medicamentos: number;
  }): Promise<{ tipo: 'numero'; numero: string } | { tipo: 'recusa' } | { tipo: 'erro' }>;
}

export interface ConfigDocumentosIcp {
  /** Base do portal onde fica o verificador público (`/verificar/<código>`). */
  readonly urlVerificador: string;
  /** Política de assinatura ICP-Brasil (OID e hash da LPA do ITI), quando o deploy configura. */
  readonly politicas?: Partial<Record<PoliticaAssinaturaIcp, PoliticaAssinaturaIdentificada>>;
  readonly sncr?: ClienteSncr | null;
  readonly agora?: () => Date;
}

/** Login da trilha do reprocessamento automático (o agendador não é pessoa). */
export const USUARIO_REPROCESSAMENTO = 'SGH.ASSINATURA';

const fusoBr = (d: Date) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: 'America/Sao_Paulo',
  }).format(d);

interface ItemConcluido {
  readonly documento: number;
  readonly estado: 'assinada' | 'pendente' | 'falha' | 'recusada';
  readonly motivo: string | null;
  readonly falha: FalhaTransitoriaAssinatura | null;
}

export class ServicoAssinaturaDocumentos {
  private readonly agora: () => Date;

  constructor(
    private readonly icp: ServicoAssinaturaIcp,
    private readonly porta: PortaAssinaturaIcp,
    private readonly fonte: FonteConteudoIcp | null,
    private readonly armazem: ArmazemPdfIcp | null,
    private readonly liberacao: LiberacaoIcp | null,
    private readonly cfg: ConfigDocumentosIcp,
  ) {
    this.agora = cfg.agora ?? (() => new Date());
    icp.documentos = {
      concluirNuvem: (s, p, c, t, pr) => this.concluirNuvem(s, p, c, t, pr),
      concluirAgente: (s, p, h, c) => this.concluirAgente(s, p, h, c),
    };
  }

  // ── Apoio ─────────────────────────────────────────────────────────────────────────────────────────────────

  private exigirFonte(): { fonte: FonteConteudoIcp; armazem: ArmazemPdfIcp } {
    if (!this.fonte || !this.armazem) throw recusa('emissao-indisponivel', 503);
    return { fonte: this.fonte, armazem: this.armazem };
  }

  private naoComo(s: SessaoCadastro): void {
    if (s.req.sghComo) throw recusa('sessao-como', 403);
  }

  async liberada(s: SessaoCadastro): Promise<{ ligada: boolean; motivo: string | null }> {
    if (!this.liberacao)
      return { ligada: false, motivo: 'A configuração das funcionalidades não está disponível.' };
    return this.liberacao.consultar(s, 'assinatura.icp');
  }

  private async exigirLiberada(s: SessaoCadastro): Promise<void> {
    const l = await this.liberada(s);
    if (!l.ligada)
      throw new ErroProblema('recurso-desligado', 403, 'Funcionalidade desligada', l.motivo ?? '', {
        codigo: 'recurso-desligado',
      } as never);
  }

  private async regras(c: ContextoAssinatura): Promise<RegraPoliticaAssinatura[]> {
    return (await this.porta.politicas(c)).map((p) => ({
      id: p.id,
      tipoDocumento: p.tipoDocumento as TipoDocumentoPolitica,
      conselho: p.conselho,
      destino: p.destino,
      nivel: p.nivel,
      politicaIcp: p.politicaIcp,
      formato: p.formato,
    }));
  }

  /** D-CONSELHO-49: a sigla do conselho pelo OID de registro do certificado (null: vale "qualquer conselho"). */
  private async conselho(c: ContextoAssinatura, cert: CertificadoVinculado | null): Promise<string | null> {
    if (!cert?.certificadoDer) return null;
    try {
      const lido = lerCertificado(b64(cert.certificadoDer));
      return conselhoPeloCertificado(lido.outrosNomes, await this.porta.oidsDeConselho(c));
    } catch {
      return null;
    }
  }

  private exigencia(
    regras: readonly RegraPoliticaAssinatura[],
    tipo: string,
    conselho: string | null,
  ): ExigenciaAssinatura {
    return resolverExigencia(regras, {
      tipo: tipo as TipoDocumentoPolitica,
      conselho,
      destino: destinoDoTipo(tipo),
    });
  }

  private async certificadoDoUsuario(s: SessaoCadastro, id: number): Promise<CertificadoVinculado> {
    const c = await this.porta.certificado(s.porta, id);
    if (!c || c.usuario !== s.login || !c.ativo || !c.certificadoDer)
      throw recusa('certificado-divergente', 404);
    return c;
  }

  /** O documento do prontuário do autor, que recebe a ICP e não está suspenso (as recusas das regras 7 e 4). */
  private async documentoDoAutor(s: SessaoCadastro, id: number): Promise<DocumentoEmitidoIcp> {
    const d = await this.porta.documentoEmitido(s.porta, id);
    if (!d) throw recusa('documento-sem-prova', 404);
    if (d.usuario !== s.login) throw recusa('nao-e-o-autor', 403);
    if (!assinavelIcp(d.tipo)) throw recusa('tipo-sem-icp');
    if (d.suspenso) throw recusa('documento-suspenso', 409);
    return d;
  }

  /** A revisão incremental da prévia e o hash dos atributos assinados (determinístico: a volta remonta e confere). */
  private async prepararDaPrevia(
    pv: PreviaDoDocumento,
    certificadoDer: Uint8Array,
  ): Promise<{
    pdf: Uint8Array;
    preparado: ReturnType<typeof prepararPades>;
    atributos: { der: Uint8Array; hash: string };
  }> {
    const { armazem } = this.exigirFonte();
    const pdf = await armazem.ler(pv.chaveS3, pv.versaoS3);
    if (sha256Hex(pdf) !== pv.hashPdf) throw recusa('hash-divergente', 409);
    const preparado = prepararPades(pdf, { assinadoEm: new Date(pv.assinarEm) });
    const atributos = atributosAssinados({
      resumo: preparado.resumo,
      certificado: certificadoDer,
      politica: this.cfg.politicas?.[pv.politicaIcp] ?? null,
    });
    return { pdf, preparado, atributos };
  }

  private registroDoConselho(
    registros: readonly { sigla: string | null; uf: string | null; numero: string | null }[] | undefined,
  ): string | null {
    const r = registros?.find((x) => x.numero);
    if (!r?.numero) return null;
    return `${r.sigla ?? 'Conselho'}${r.uf ? `-${r.uf}` : ''} ${r.numero}`;
  }

  // ── Fila do autor (pendências de assinatura ICP) ──────────────────────────────────────────────────────────

  async fila(s: SessaoCadastro): Promise<PendenciasIcpResposta> {
    const [meu, regras] = await Promise.all([this.icp.meuCertificado(s), this.regras(s.porta)]);
    const ativo = meu.certificados.find((c) => c.ativo) ?? null;
    const conselho = ativo
      ? await this.conselho(s.porta, await this.porta.certificado(s.porta, ativo.id))
      : null;
    // A política vai ao SQL antes do teto (seção 4): só os tipos cuja exigência é icp-brasil (as regras cadastradas, o
    // piso legal e o conselho do certificado), e a pendente e a em falha de qualquer tipo.
    const tiposIcp = TIPOS_ASSINAVEIS_ICP.filter(
      (t) => this.exigencia(regras, t, conselho).nivel === 'icp-brasil',
    );
    const [fila, assinadosLidos, avisos, liberada] = await Promise.all([
      this.porta.filaIcp(s.porta, s.login, 200, tiposIcp),
      this.porta.assinadosRecentes(s.porta, s.login),
      this.porta.avisos(s.porta, { autor: s.login }),
      this.liberada(s),
    ]);
    const nomes = this.fonte
      ? await this.fonte
          .nomes(s.porta, [
            ...new Set([...fila.itens.map((x) => x.paciente), ...assinadosLidos.map((x) => x.paciente)]),
          ])
          .catch(() => new Map<number, string>())
      : new Map<number, string>();
    const rotulo = (t: string) => ROTULOS_TIPO_DOCUMENTO_POLITICA[t as TipoDocumentoPolitica] ?? 'Documento';
    const itens: ItemPendenciaIcp[] = fila.itens
      .map((x) => ({
        documento: x.documento,
        tipo: x.tipo,
        titulo: rotulo(x.tipo),
        paciente: x.paciente,
        nome: nomes.get(x.paciente) ?? 'Paciente',
        emitidoEm: x.criadoEm,
        exigencia: this.exigencia(regras, x.tipo, conselho),
        situacao: x.estado ?? ('a-assinar' as const),
        assinatura: x.assinatura,
        tentativas: x.tentativas,
        falha: (x.falha as FalhaTransitoriaAssinatura | null) ?? null,
        proximaTentativaEm: x.proximaEm,
      }))
      // A fila é a do que a política manda assinar com ICP (seção 4); a pendente e a em falha aparecem sempre.
      .filter((x) => x.exigencia.nivel === 'icp-brasil' || x.situacao !== 'a-assinar')
      .sort((a, b) => prioridadeIcp(a.tipo) - prioridadeIcp(b.tipo) || a.documento - b.documento);
    const podeReprocessar = s.pode('documento.assinatura.reprocessar');
    return {
      modo: this.icp.modo,
      liberada: liberada.ligada,
      motivoDesligada: liberada.ligada ? null : liberada.motivo,
      certificados: meu.certificados.filter((c) => c.ativo),
      agenteLocal: meu.agenteLocal,
      itens,
      limitado: fila.limitado,
      assinados: assinadosLidos.map((a) => ({
        assinatura: a.assinatura,
        documento: a.documento,
        titulo: rotulo(a.tipo),
        nome: nomes.get(a.paciente) ?? 'Paciente',
        politicaIcp: a.politicaIcp,
        assinadoEm: a.assinadoEm,
        carimboEm: a.carimboEm,
        codigo: a.codigo ?? '',
        resultado: a.resultado,
        pdf: true,
      })),
      avisos: avisos.map((v) => ({
        id: v.id,
        assinatura: v.assinatura,
        documento: v.documento,
        destinatario: v.destinatario,
        estado: v.estado,
        falha: (v.falha as FalhaTransitoriaAssinatura | null) ?? null,
        autor: null,
        criadoEm: v.criadoEm,
      })),
      estabelecimento: podeReprocessar
        ? {
            ...(await this.porta.contagemPendencias(s.porta)),
            avisos: (await this.porta.avisos(s.porta, 'diretor-tecnico')).map((v) => ({
              id: v.id,
              assinatura: v.assinatura,
              documento: v.documento,
              destinatario: v.destinatario,
              estado: v.estado,
              falha: (v.falha as FalhaTransitoriaAssinatura | null) ?? null,
              autor: v.autor,
              criadoEm: v.criadoEm,
            })),
          }
        : null,
      podeReprocessar,
    };
  }

  // ── Prévia exata (regra 4) ────────────────────────────────────────────────────────────────────────────────

  async previa(s: SessaoCadastro, documento: number, certificado: number): Promise<PreviaIcp> {
    this.icp.exigirLigado();
    this.naoComo(s);
    // A prévia grava um PDF/A com dado do paciente no S3 com Object Lock (não se apaga): com a chave desligada, nada
    // é gravado (como no lote e no pedido; D-LIBERACAO-49). A fila continua livre (motivo e "segue no papel").
    await this.exigirLiberada(s);
    const { fonte, armazem } = this.exigirFonte();
    const d = await this.documentoDoAutor(s, documento);
    const ja = (await this.porta.assinaturasDosDocumentos(s.porta, [documento])).get(documento);
    if (ja?.estado === 'assinada' || ja?.estado === 'pendente') throw recusa('ja-assinado', 409);
    const cert = await this.certificadoDoUsuario(s, certificado);
    const [regras, ident, conteudo] = await Promise.all([
      this.regras(s.porta),
      this.porta.identidade(s.porta, s.login),
      // O conteúdo emitido, sem substituto: se não se lê, não há prévia nem trilha (regras 4 e 8).
      fonte.conteudo(s.porta, d).catch(() => {
        throw recusa('conteudo-indisponivel', 503);
      }),
    ]);
    const exigencia = this.exigencia(regras, d.tipo, await this.conselho(s.porta, cert));
    const politica: PoliticaAssinaturaIcp = exigencia.politicaIcp ?? 'AD-RB';
    // O instante da assinatura (o /M do PDF), em segundos inteiros: a revisão incremental sai dele.
    const assinarEm = new Date(Math.floor(this.agora().getTime() / 1000) * 1000);
    const codigo = novoIdentificadorQr();
    const url = urlVerificador(this.cfg.urlVerificador, codigo);
    const registro = this.registroDoConselho(ident?.registros);
    const campos = camposDoDocumentoIcp(conteudo.conteudo, {
      profissional: conteudo.profissional,
      registro,
      politica,
      assinadoEm: fusoBr(assinarEm),
      codigo,
      urlVerificador: url,
    });
    let feito: { chave: string; versao: string; pdf: Uint8Array };
    try {
      feito = await armazem.emitirPrevia({
        rede: s.rede,
        estabelecimento: s.hospital,
        modelo: conteudo.modelo,
        titulo: conteudo.titulo,
        campos,
        autor: s.login,
        documento,
        qr: { identificador: codigo, url },
        marcaSuporte: null,
      });
      // O PDF tem de aceitar a revisão incremental antes de virar prévia (falha cedo, não na volta do provedor).
      prepararPades(feito.pdf, { assinadoEm: assinarEm });
    } catch (e) {
      if (e instanceof ErroProblema) throw e;
      throw recusa('emissao-indisponivel', 503);
    }
    const hash = sha256Hex(feito.pdf);
    await this.porta.gravar(
      s.porta,
      (g) =>
        g.gravarPrevia({
          hospital: s.hospital,
          documento,
          usuario: s.login,
          certificado: cert.id,
          politicaIcp: politica,
          hashPdf: hash,
          chaveS3: feito.chave,
          versaoS3: feito.versao,
          codigo,
          assinarEm: assinarEm.toISOString(),
          // Etapa 3: o que o selo mostra, para o verificador público.
          profissional: conteudo.profissional,
          registro,
        }),
      (x) =>
        linhaTrilha(s, E.previaAssinaturaGerada.codigo, 'documento.assinatura', 'documento.assinar', {
          tabela: 'previa_assinatura',
          id: String(x.id),
          paciente: d.paciente,
          chave: `previa:${d.tipo}:${politica}`,
        }),
    );
    return {
      documento,
      titulo: conteudo.titulo,
      hash,
      codigo,
      exigencia,
      geradaEm: assinarEm.toISOString(),
    };
  }

  /** O PDF da prévia mais recente do usuário (o mesmo arquivo cujo hash a tela mostra). */
  async pdfDaPrevia(s: SessaoCadastro, documento: number): Promise<{ pdf: Uint8Array; paciente: number }> {
    const { armazem } = this.exigirFonte();
    const d = await this.documentoDoAutor(s, documento);
    const pv = await this.porta.previaMaisRecente(s.porta, documento, s.login);
    if (!pv) throw recusa('sem-previa', 404);
    const pdf = await armazem.ler(pv.chaveS3, pv.versaoS3);
    if (sha256Hex(pdf) !== pv.hashPdf) throw recusa('hash-divergente', 409);
    return { pdf, paciente: d.paciente };
  }

  /** O lote: a prévia exata de cada documento escolhido (um a um no Gotenberg); as recusas item a item. */
  async prepararLote(s: SessaoCadastro, e: PrepararLoteIcp): Promise<LoteIcpPreparado> {
    this.icp.exigirLigado();
    await this.exigirLiberada(s);
    const itens: PreviaIcp[] = [];
    const recusados: { documento: number; motivo: MotivoRecusaAssinatura }[] = [];
    for (const documento of e.documentos) {
      try {
        itens.push(await this.previa(s, documento, e.certificado));
      } catch (x) {
        const motivo = x instanceof ErroProblema ? (x.extras as { motivo?: string }).motivo : undefined;
        if (
          !motivo ||
          motivo === 'emissao-indisponivel' ||
          motivo === 'sessao-como' ||
          motivo === 'servico-desligado'
        )
          throw x;
        recusados.push({ documento, motivo: motivo as MotivoRecusaAssinatura });
      }
    }
    return { itens, recusados };
  }

  // ── Pedido (um documento ou o lote) ───────────────────────────────────────────────────────────────────────

  /** `retorno`: o redirect_uri da volta do provedor (W0-10, M6: o portal do médico externo usa o da própria tela). */
  async pedir(
    s: SessaoCadastro,
    e: PedirAssinaturaIcp,
    retorno?: string,
  ): Promise<PedidoAssinaturaIcpResposta> {
    this.icp.exigirLigado();
    this.naoComo(s);
    await this.exigirLiberada(s);
    this.exigirFonte();
    const cert = await this.certificadoDoUsuario(s, e.certificado);
    const ident = await this.porta.identidade(s.porta, s.login);
    if (cpfCruzadoDiverge(ident)) {
      await this.icp.falhaNaTrilha(s, E.assinaturaFalhou.codigo, 'documento.assinatura', 'cpf-divergente');
      throw recusa('cpf-divergente');
    }
    const der = b64(cert.certificadoDer!);
    const [regras, conselho, ja] = await Promise.all([
      this.regras(s.porta),
      this.conselho(s.porta, cert),
      this.porta.assinaturasDosDocumentos(s.porta, e.documentos),
    ]);
    const recusados: { documento: number; motivo: MotivoRecusaAssinatura }[] = [];
    const documentos = new Map<number, DocumentoEmitido>();
    const previas = new Map<number, PreviaDoDocumento>();
    const pedido: { documentos: number[]; hashes: string[] } = { documentos: [], hashes: [] };
    for (const [i, id] of e.documentos.entries()) {
      const d = await this.porta.documentoEmitido(s.porta, id);
      const pv = d ? await this.porta.previaMaisRecente(s.porta, id, s.login) : null;
      const motivo: MotivoRecusaAssinatura | null = !d
        ? null // sem prova: o planejamento recusa (regra 7)
        : !assinavelIcp(d.tipo)
          ? 'tipo-sem-icp'
          : d.suspenso
            ? 'documento-suspenso'
            : !pv || pv.certificado !== cert.id
              ? 'sem-previa'
              : null;
      if (motivo) {
        recusados.push({ documento: id, motivo });
        continue;
      }
      pedido.documentos.push(id);
      pedido.hashes.push(e.hashes[i]!);
      if (d && pv) {
        previas.set(id, pv);
        const estado = ja.get(id)?.estado;
        documentos.set(id, {
          id,
          hash: pv.hashPdf,
          autor: d.usuario,
          jaAssinadoIcp: estado === 'assinada' || estado === 'pendente',
          tipo: d.tipo as TipoDocumentoPolitica,
          conselho,
          destino: destinoDoTipo(d.tipo),
        });
      }
    }
    const plano = planejarAssinatura({
      pedido,
      documentos,
      usuario: { login: s.login, cpf: ident?.cpf ?? null },
      certificado: { midia: cert.midia, lido: lerCertificado(der), ativo: cert.ativo },
      regras,
      agora: this.agora(),
    });
    recusados.push(...plano.recusados);
    if (!plano.aAssinar.length) {
      await this.icp.falhaNaTrilha(
        s,
        E.assinaturaFalhou.codigo,
        'documento.assinatura',
        `documento:recusados:${recusados.length}:${recusados[0]?.motivo ?? ''}`,
      );
      return { inicio: null, recusados };
    }
    const hashes: string[] = [];
    const ids: number[] = [];
    for (const it of plano.aAssinar) {
      try {
        const { atributos } = await this.prepararDaPrevia(previas.get(it.documento)!, der);
        hashes.push(atributos.hash);
        ids.push(it.documento);
      } catch (x) {
        if (!(x instanceof ErroProblema)) throw recusa('emissao-indisponivel', 503);
        recusados.push({ documento: it.documento, motivo: 'hash-divergente' });
      }
    }
    if (!ids.length) return { inicio: null, recusados };
    const validadeMin = (await this.icp.parametro(s, 'documento.autorizacaoPscMin')) || 10;
    let inicio: InicioAssinaturaIcp;
    if (cert.midia === 'nuvem') {
      const p = await this.icp.provedorUtilizavel(s, cert.provedor ?? '');
      const pkce = gerarPkce();
      const estado = gerarEstado();
      const cifrado = this.icp.cfg.cofre.cifrar(pkce.verificador);
      if (!cifrado) throw recusa('provedor-desligado', 503);
      const expira = new Date(this.agora().getTime() + validadeMin * 60_000);
      await this.porta.gravar(
        s.porta,
        (g) =>
          g.gravarPedido({
            hospital: s.hospital,
            usuario: s.login,
            finalidade: 'documento',
            midia: 'nuvem',
            provedor: p.codigo,
            certificado: cert.id,
            stateHash: resumo(estado),
            pkceCifrado: cifrado,
            hashes,
            documentos: ids,
            expiraEm: expira,
          }),
        (r) =>
          this.icp.trilhaDoPedido(
            s,
            E.pedidoAssinaturaGravado.codigo,
            'documento',
            r.id,
            `documento:nuvem:${ids.length}`,
          ),
      );
      const endereco = enderecoAutorizacao(this.icp.configPsc(p, retorno), {
        estado,
        pkce,
        documentos: ids.length,
        validadeSeg: validadeMin * 60,
      });
      inicio = {
        tipo: 'nuvem',
        endereco: this.icp.enderecoNavegador(p, endereco),
        expiraEm: expira.toISOString(),
      };
    } else {
      const d = criarDesafio(hashes, this.agora(), validadeMin * 60);
      await this.porta.gravar(
        s.porta,
        (g) =>
          g.gravarPedido({
            hospital: s.hospital,
            usuario: s.login,
            finalidade: 'documento',
            midia: cert.midia,
            provedor: null,
            certificado: cert.id,
            stateHash: resumo(d.desafio),
            pkceCifrado: null,
            hashes: d.hashes,
            documentos: ids,
            expiraEm: d.expiraEm,
          }),
        (x) =>
          this.icp.trilhaDoPedido(
            s,
            E.pedidoAssinaturaGravado.codigo,
            'documento',
            x.id,
            `documento:${cert.midia}:${ids.length}`,
          ),
      );
      inicio = {
        tipo: 'agente-local',
        desafio: d.desafio,
        hashes: d.hashes,
        algoritmo: 'sha256',
        expiraEm: d.expiraEm.toISOString(),
      };
    }
    return { inicio, recusados };
  }

  // ── Conclusão (volta do provedor / resposta do agente local) ──────────────────────────────────────────────

  /** Cada documento do pedido: a prévia mais recente remonta o mesmo hash (senão, a prévia mudou: recusa). */
  private async itensDoPedido(
    s: SessaoCadastro,
    pedido: PedidoAssinaturaAberto,
    der: Uint8Array,
  ): Promise<{
    ok: { documento: number; hash: string; previa: PreviaDoDocumento }[];
    recusados: ItemConcluido[];
  }> {
    const ok: { documento: number; hash: string; previa: PreviaDoDocumento }[] = [];
    const recusados: ItemConcluido[] = [];
    for (const [i, documento] of pedido.documentos.entries()) {
      const pv = await this.porta.previaMaisRecente(s.porta, documento, s.login);
      let hash: string | null = null;
      if (pv && pv.certificado === pedido.certificado)
        hash = await this.prepararDaPrevia(pv, der)
          .then((x) => x.atributos.hash)
          .catch(() => null);
      if (!pv || hash !== pedido.hashes[i])
        recusados.push({ documento, estado: 'recusada', motivo: 'hash-divergente', falha: null });
      else ok.push({ documento, hash, previa: pv });
    }
    return { ok, recusados };
  }

  private resultadoDoLote(
    itens: readonly ItemConcluido[],
    certificado: number | null,
  ): ResultadoFluxoAssinatura {
    const assinados = itens.filter((x) => x.estado === 'assinada').length;
    const pendentes = itens.filter((x) => x.estado === 'pendente').length;
    const recusados = itens.length - assinados - pendentes;
    return {
      finalidade: 'documento',
      ok: assinados + pendentes > 0 && recusados === 0,
      certificado,
      assinatura: null,
      motivo: itens.find((x) => x.estado !== 'assinada')?.motivo ?? null,
      lote: { assinados, pendentes, recusados },
    };
  }

  async concluirNuvem(
    s: SessaoCadastro,
    pedido: PedidoAssinaturaAberto,
    cfg: ConfiguracaoPsc,
    token: string,
    provedor: ProvedorNuvem,
  ): Promise<ResultadoFluxoAssinatura> {
    const cert = pedido.certificado ? await this.porta.certificado(s.porta, pedido.certificado) : null;
    if (!cert?.certificadoDer || cert.usuario !== s.login)
      return this.resultadoDoLote(
        pedido.documentos.map((documento) => ({
          documento,
          estado: 'recusada',
          motivo: 'certificado-divergente',
          falha: null,
        })),
        null,
      );
    const der = b64(cert.certificadoDer);
    const { ok, recusados } = await this.itensDoPedido(s, pedido, der);
    const itens: ItemConcluido[] = [...recusados];
    if (ok.length) {
      let r: ReturnType<typeof conferirAssinaturas>;
      try {
        r = conferirAssinaturas(
          await this.icp.cfg.psc.assinar(
            cfg,
            token,
            ok.map((x, k) => ({ id: String(k + 1), alias: `documento-${x.documento}`, hashHex: x.hash })),
            'principal',
          ),
          ok.map((_, k) => String(k + 1)),
        );
      } catch (e) {
        if (!(e instanceof ErroIndisponivel)) throw e;
        for (const x of ok)
          itens.push({ documento: x.documento, estado: 'recusada', motivo: 'psc-indisponivel', falha: null });
        await this.icp.falhaNaTrilha(
          s,
          E.assinaturaFalhou.codigo,
          'documento.assinatura',
          'psc-indisponivel',
        );
        return this.resultadoDoLote(itens, cert.id);
      }
      if (!r.ok) {
        for (const x of ok)
          itens.push({
            documento: x.documento,
            estado: 'recusada',
            motivo: 'resposta-invalida',
            falha: null,
          });
        await this.icp.falhaNaTrilha(
          s,
          E.assinaturaFalhou.codigo,
          'documento.assinatura',
          'resposta-invalida',
        );
      } else
        for (const [k, x] of ok.entries())
          itens.push(
            await this.concluirItem(s, {
              ...x,
              certificado: cert,
              assinatura: r.assinaturas.get(String(k + 1))!,
              provedor: provedor.codigo,
            }),
          );
    }
    return this.resultadoDoLote(itens, cert.id);
  }

  async concluirAgente(
    s: SessaoCadastro,
    pedido: PedidoAssinaturaAberto,
    porHash: ReadonlyMap<string, string>,
    certificadoB64: string,
  ): Promise<ResultadoFluxoAssinatura> {
    const cert = pedido.certificado ? await this.porta.certificado(s.porta, pedido.certificado) : null;
    if (!cert?.certificadoDer || cert.usuario !== s.login || cert.certificadoDer !== certificadoB64)
      return this.resultadoDoLote(
        pedido.documentos.map((documento) => ({
          documento,
          estado: 'recusada',
          motivo: 'certificado-divergente',
          falha: null,
        })),
        null,
      );
    const { ok, recusados } = await this.itensDoPedido(s, pedido, b64(cert.certificadoDer));
    const itens: ItemConcluido[] = [...recusados];
    for (const x of ok) {
      const a = porHash.get(x.hash);
      itens.push(
        a
          ? await this.concluirItem(s, { ...x, certificado: cert, assinatura: b64(a), provedor: null })
          : { documento: x.documento, estado: 'recusada', motivo: 'resposta-invalida', falha: null },
      );
    }
    return this.resultadoDoLote(itens, cert.id);
  }

  /** Valida e grava a assinatura de UM documento, com a validação, o PDF, o evento, os avisos e a trilha juntos. */
  private async concluirItem(
    s: SessaoCadastro,
    x: {
      documento: number;
      hash: string;
      previa: PreviaDoDocumento;
      certificado: CertificadoVinculado;
      assinatura: Uint8Array;
      provedor: string | null;
    },
  ): Promise<ItemConcluido> {
    const ident = await this.porta.identidade(s.porta, s.login);
    if (cpfCruzadoDiverge(ident)) {
      await this.icp.falhaNaTrilha(s, E.assinaturaFalhou.codigo, 'documento.assinatura', 'cpf-divergente');
      return { documento: x.documento, estado: 'recusada', motivo: 'cpf-divergente', falha: null };
    }
    const d = await this.porta.documentoEmitido(s.porta, x.documento);
    const politica = x.previa.politicaIcp;
    const v = await this.icp.validar({
      certificadoDer: b64(x.certificado.certificadoDer!),
      hash: x.hash,
      assinatura: x.assinatura,
      politica,
      cpfDoUsuario: ident?.cpf ?? null,
    });
    const agora = this.agora();
    const transicao: TransicaoReprocessamento | null =
      v.resultado === 'indeterminada' && v.falha
        ? registrarFalhaTransitoria(NOVA, v.falha, agora, await this.cfgReprocessamento(s))
        : null;
    const estado = v.resultado === 'valida' ? 'assinada' : (transicao?.situacao.estado ?? 'falha');
    const comoSuporte = s.req.sghComo !== undefined;
    const r = await this.porta.gravar(
      s.porta,
      async (g) => {
        // Serializa com outra conclusão do mesmo documento (outra aba, o lote repetido): a que chega depois não grava
        // uma segunda assinatura nem um segundo evento "assinado" na cadeia.
        if (await g.travarDocumentoParaAssinar(s.hospital, x.documento, null)) return null;
        const a = await g.gravarAssinatura({
          hospital: s.hospital,
          origem: 'documento',
          documento: x.documento,
          hash: x.hash,
          formato: 'pades',
          politicaIcp: politica,
          midia: x.certificado.midia,
          provedor: x.provedor,
          certificado: x.certificado.id,
          usuario: s.login,
          estado,
          tentativas: transicao?.situacao.tentativas ?? 0,
          falha: transicao?.situacao.falha ?? null,
          proximaEm: transicao?.situacao.proximaEm ?? null,
          assinatura: Buffer.from(x.assinatura).toString('base64'),
          carimboToken: v.carimboToken,
          carimboEm: v.carimboEm,
          carimboSerie: v.carimboSerie,
        });
        await g.gravarValidacao({
          assinatura: a.id,
          momento: 'assinar',
          resultado: v.resultado,
          cadeia: v.cadeia,
          vigencia: v.vigencia,
          revogacao: v.revogacao,
          cpf: v.cpf,
          assinaturaConfere: v.assinaturaConfere,
          carimbo: v.carimbo,
          motivos: v.motivos,
          usuario: s.login,
          em: agora,
        });
        await g.gravarAssinaturaPdf({ assinatura: a.id, previa: x.previa.id });
        if (estado === 'assinada')
          await g.gravarEventoAssinadoIcp(
            { hospital: s.hospital, usuario: s.login },
            x.documento,
            comoSuporte,
          );
        for (const dest of transicao?.avisar ?? [])
          await g.gravarAviso({
            hospital: s.hospital,
            assinatura: a.id,
            destinatario: dest,
            usuario: dest === 'autor' ? s.login : null,
            estado: estado === 'falha' ? 'falha' : 'pendente',
            falha: transicao?.situacao.falha ?? null,
          });
        return a;
      },
      (a) =>
        a
          ? {
              ...linhaTrilha(
                s,
                estado === 'assinada' ? E.documentoAssinadoIcp.codigo : E.assinaturaFalhou.codigo,
                'documento.assinatura',
                'documento.assinar',
                {
                  tabela: 'assinatura_documento',
                  id: String(a.id),
                  paciente: d?.paciente ?? null,
                  chave: `documento:${politica}:${v.resultado}`,
                },
              ),
              resultado: estado === 'assinada' ? 'sucesso' : 'falha',
            }
          : null,
    );
    if (!r) {
      await this.icp.falhaNaTrilha(s, E.assinaturaFalhou.codigo, 'documento.assinatura', 'ja-assinado');
      return { documento: x.documento, estado: 'recusada', motivo: 'ja-assinado', falha: null };
    }
    if (estado === 'assinada') await this.gerarPdfAssinado(s.porta, r.id).catch(() => null);
    return {
      documento: x.documento,
      estado,
      motivo: v.resultado === 'valida' ? null : (v.motivos[0] ?? null),
      falha: transicao?.situacao.falha ?? null,
    };
  }

  private async cfgReprocessamento(s: SessaoCadastro) {
    return {
      maxTentativas: (await this.icp.parametro(s, 'documento.assinaturaTentativas')) || 12,
      esperaInicialMin: (await this.icp.parametro(s, 'documento.assinaturaEsperaInicialMin')) || 5,
    };
  }

  // ── PDF assinado (regra 8) ────────────────────────────────────────────────────────────────────────────────

  /** Remonta o PDF assinado (prévia + revisão incremental + CMS com o carimbo) e o guarda no S3. */
  async montarPdfAssinado(c: ContextoAssinatura, a: AssinaturaDoDocumento): Promise<Uint8Array> {
    if (a.estado !== 'assinada' || !a.assinatura || a.previa === null) throw recusa('nao-reprocessavel', 409);
    const [pv, cert] = await Promise.all([
      this.porta.previa(c, a.previa),
      this.porta.certificado(c, a.certificado),
    ]);
    if (!pv || !cert?.certificadoDer) throw recusa('sem-previa', 404);
    const der = b64(cert.certificadoDer);
    const { preparado, atributos } = await this.prepararDaPrevia(pv, der);
    if (atributos.hash !== a.hash) throw recusa('hash-divergente', 409);
    const cms = montarCms({
      atributos: atributos.der,
      assinatura: b64(a.assinatura),
      certificado: der,
      cadeia: this.icp.cfg.intermediarios(),
      carimbo: a.carimboToken ? b64(a.carimboToken) : null,
    });
    return inserirCms(preparado, cms);
  }

  async gerarPdfAssinado(c: ContextoAssinatura, assinatura: number): Promise<Uint8Array> {
    const { armazem } = this.exigirFonte();
    const a = await this.porta.assinaturaDocumento(c, assinatura);
    if (!a) throw recusa('documento-sem-prova', 404);
    if (a.pdf) return armazem.ler(a.pdf.chaveS3, a.pdf.versaoS3);
    const pdf = await this.montarPdfAssinado(c, a);
    const g = await armazem.gravarAssinado(c.rede, c.hospital, a.id, pdf);
    await this.porta.gravar(
      c,
      (x) =>
        x.registrarPdfAssinado(
          { assinatura: a.id, chaveS3: g.chave, versaoS3: g.versao, hashPdf: sha256Hex(pdf) },
          this.agora(),
        ),
      null,
    );
    return pdf;
  }

  /** O PDF assinado para validar fora do sistema; a validação "ao exportar" vai a validacao_assinatura. */
  async pdfAssinado(s: SessaoCadastro, assinatura: number): Promise<{ pdf: Uint8Array; documento: number }> {
    const a = await this.porta.assinaturaDocumento(s.porta, assinatura);
    if (!a || a.usuario !== s.login) throw recusa('documento-sem-prova', 404);
    if (a.estado !== 'assinada') throw recusa('nao-reprocessavel', 409);
    const pdf = await this.gerarPdfAssinado(s.porta, assinatura);
    const cert = await this.porta.certificado(s.porta, a.certificado);
    const v = await this.icp.validar({
      certificadoDer: b64(cert?.certificadoDer ?? ''),
      hash: a.hash,
      assinatura: b64(a.assinatura ?? ''),
      politica: 'AD-RB',
      // D-EXPORTAR-CPF-49: o CPF foi conferido na assinatura; ao exportar não há usuário a conferir (antes, o null
      // contava como "sem CPF" e a validação ao exportar saía sempre inválida).
    });
    let carimbo: boolean | null = null;
    if (a.politicaIcp === 'AD-RT') {
      carimbo = false;
      try {
        const resp = b64(a.carimboToken ?? '');
        const lido = lerRespostaCarimbo(resp);
        const imprint = createHash('sha256')
          .update(b64(a.assinatura ?? ''))
          .digest('hex');
        carimbo =
          'hash' in lido &&
          Buffer.from(lido.hash).toString('hex') === imprint &&
          conferirTokenCarimbo(resp, this.icp.cfg.raizes(), this.icp.cfg.intermediarios(), this.agora()).ok;
      } catch {
        carimbo = false;
      }
    }
    const resultado = carimbo === false ? 'invalida' : v.resultado;
    const agora = this.agora();
    await this.porta.gravar(
      s.porta,
      (g) =>
        g.gravarValidacao({
          assinatura: a.id,
          momento: 'exportar',
          resultado,
          cadeia: v.cadeia,
          vigencia: v.vigencia,
          revogacao: v.revogacao,
          cpf: null,
          assinaturaConfere: v.assinaturaConfere,
          carimbo,
          motivos: carimbo === false ? [...v.motivos, 'carimbo-invalido'] : v.motivos,
          usuario: s.login,
          em: agora,
        }),
      linhaTrilha(s, E.documentoAssinadoExportado.codigo, 'documento.assinatura', 'documento.validar', {
        tabela: 'assinatura_documento',
        id: String(a.id),
        chave: `exportar:${resultado}`,
      }),
    );
    return { pdf, documento: a.documento };
  }

  // ── Reprocessamento (regra 5; SBIS-37) ────────────────────────────────────────────────────────────────────

  /**
   * Reprocessa UMA assinatura pendente (ou em falha, à mão): valida de novo a MESMA assinatura (LCR, carimbo) e, se
   * passou, conclui; senão, a próxima tentativa (ou a falha, com o aviso). Controle otimista: outra instância que
   * pegou a mesma não repete.
   */
  async reprocessar(
    s: SessaoCadastro,
    assinatura: number,
    manual: boolean,
  ): Promise<SituacaoAssinaturaDocumento> {
    this.icp.exigirLigado();
    const a = await this.porta.assinaturaDocumento(s.porta, assinatura);
    if (!a) throw recusa('documento-sem-prova', 404);
    if (manual && a.usuario !== s.login && !s.pode('documento.assinatura.reprocessar'))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'Só o autor ou a direção técnica reprocessa.',
      );
    if (a.estado === 'assinada' || (!manual && a.estado !== 'pendente') || !a.assinatura)
      throw recusa('nao-reprocessavel', 409);
    const agora = this.agora();
    let situacao: SituacaoReprocessamento = {
      estado: a.estado,
      tentativas: a.tentativas,
      falha: (a.falha as FalhaTransitoriaAssinatura | null) ?? null,
      proximaEm: a.proximaEm ? new Date(a.proximaEm) : null,
    };
    if (manual && a.estado === 'falha') situacao = reabrir(situacao, agora);
    const cert = await this.porta.certificado(s.porta, a.certificado);
    const ident = await this.porta.identidade(s.porta, a.usuario);
    const v = await this.icp.validar({
      certificadoDer: b64(cert?.certificadoDer ?? ''),
      hash: a.hash,
      assinatura: b64(a.assinatura),
      politica: a.politicaIcp,
      cpfDoUsuario: cpfCruzadoDiverge(ident) ? null : (ident?.cpf ?? null),
    });
    const t: TransicaoReprocessamento =
      v.resultado === 'valida'
        ? registrarSucesso(situacao)
        : v.resultado === 'indeterminada' && v.falha
          ? registrarFalhaTransitoria(situacao, v.falha, agora, await this.cfgReprocessamento(s))
          : {
              situacao: {
                estado: 'falha',
                tentativas: situacao.tentativas + 1,
                falha: situacao.falha,
                proximaEm: null,
              },
              avisar: ['autor', 'diretor-tecnico'],
              evento: 'documento.assinatura.falhou',
            };
    const d = await this.porta.documentoEmitido(s.porta, a.documento);
    const feito = await this.porta.gravar(
      s.porta,
      async (g) => {
        // Outra assinatura do documento já assinada ou pendente (a falha antiga reaberta depois de assinar de novo):
        // esta não conclui, para não haver duas "assinada" nem dois eventos "assinado" na cadeia.
        if (await g.travarDocumentoParaAssinar(a.hospital, a.documento, a.id))
          throw recusa('ja-assinado', 409);
        const ok = await g.atualizarAssinatura(
          {
            id: a.id,
            hospital: a.hospital,
            estadoLido: a.estado as 'pendente' | 'falha',
            tentativasLidas: a.tentativas,
            estado: t.situacao.estado,
            tentativas: t.situacao.tentativas,
            falha: t.situacao.estado === 'assinada' ? null : t.situacao.falha,
            proximaEm: t.situacao.proximaEm,
            carimboToken: v.carimboToken,
            carimboEm: v.carimboEm,
            carimboSerie: v.carimboSerie,
          },
          agora,
        );
        if (!ok) return false;
        await g.gravarValidacao({
          assinatura: a.id,
          momento: 'assinar',
          resultado: v.resultado,
          cadeia: v.cadeia,
          vigencia: v.vigencia,
          revogacao: v.revogacao,
          cpf: v.cpf,
          assinaturaConfere: v.assinaturaConfere,
          carimbo: v.carimbo,
          motivos: v.motivos,
          usuario: s.login,
          em: agora,
        });
        if (t.situacao.estado === 'assinada')
          await g.gravarEventoAssinadoIcp({ hospital: a.hospital, usuario: a.usuario }, a.documento, false);
        for (const dest of t.avisar)
          await g.gravarAviso({
            hospital: a.hospital,
            assinatura: a.id,
            destinatario: dest,
            usuario: dest === 'autor' ? a.usuario : null,
            estado: t.situacao.estado === 'falha' ? 'falha' : 'pendente',
            falha: t.situacao.falha,
          });
        return true;
      },
      (ok) =>
        ok
          ? {
              ...linhaTrilha(
                s,
                t.situacao.estado === 'assinada' || t.evento === 'documento.assinatura.reprocessada'
                  ? E.assinaturaReprocessada.codigo
                  : E.assinaturaFalhou.codigo,
                'documento.assinatura',
                'documento.reprocessarPendente',
                {
                  tabela: 'assinatura_documento',
                  id: String(a.id),
                  paciente: d?.paciente ?? null,
                  chave: `${manual ? 'manual' : 'automatico'}:${t.situacao.estado}:${t.situacao.tentativas}`,
                },
              ),
              resultado: t.situacao.estado === 'falha' ? 'falha' : 'sucesso',
            }
          : null,
    );
    if (feito && t.situacao.estado === 'assinada')
      await this.gerarPdfAssinado(s.porta, a.id).catch(() => null);
    const atual = feito ? t.situacao : null;
    return {
      documento: a.documento,
      estado: atual?.estado ?? a.estado,
      nivel: (atual?.estado ?? a.estado) === 'assinada' ? 'icp-brasil' : null,
      politicaIcp: a.politicaIcp,
      assinadaEm: (atual?.estado ?? a.estado) === 'assinada' ? agora.toISOString() : null,
      carimboEm: v.carimboEm?.toISOString() ?? a.carimboEm,
      tentativas: atual?.tentativas ?? a.tentativas,
      falha: atual ? atual.falha : ((a.falha as FalhaTransitoriaAssinatura | null) ?? null),
      proximaTentativaEm: atual ? (atual.proximaEm?.toISOString() ?? null) : a.proximaEm,
    };
  }

  /** Uma rodada do agendador num estabelecimento: as pendentes vencidas, até o teto. */
  async cicloReprocessamento(
    sessaoDoAgendador: SessaoCadastro,
    teto = 20,
  ): Promise<{ vistas: number; assinadas: number; pendentes: number; falhas: number }> {
    const vencidas = await this.porta.pendentesVencidas(sessaoDoAgendador.porta, this.agora(), teto);
    const r = { vistas: vencidas.length, assinadas: 0, pendentes: 0, falhas: 0 };
    for (const v of vencidas) {
      try {
        const x = await this.reprocessar(sessaoDoAgendador, v.id, false);
        if (x.estado === 'assinada') r.assinadas++;
        else if (x.estado === 'pendente') r.pendentes++;
        else r.falhas++;
      } catch {
        r.falhas++;
      }
    }
    return r;
  }

  // ── Avisos ────────────────────────────────────────────────────────────────────────────────────────────────

  async marcarAvisos(s: SessaoCadastro, avisos: readonly number[]): Promise<{ lidos: number }> {
    const diretorTecnico = s.pode('documento.assinatura.reprocessar');
    const n = await this.porta.gravar(
      s.porta,
      (g) => g.marcarAvisosLidos(s.hospital, avisos, { login: s.login, diretorTecnico }, this.agora()),
      (n) =>
        n
          ? linhaTrilha(
              s,
              E.avisoAssinaturaLido.codigo,
              'documento.assinatura',
              'documento.reprocessarPendente',
              {
                tabela: 'aviso_assinatura',
                chave: `lidos:${n}`,
              },
            )
          : null,
    );
    return { lidos: n };
  }

  // ── Numeração SNCR (regra 10; chave `receita.sncr`, desligada) ────────────────────────────────────────────

  async solicitarSncr(s: SessaoCadastro, documento: number): Promise<SolicitacaoSncrResumo> {
    const lib = this.liberacao
      ? await this.liberacao.consultar(s, 'receita.sncr')
      : { ligada: false, motivo: null };
    if (!lib.ligada)
      throw new ErroProblema(
        'recurso-desligado',
        409,
        'Assinatura recusada',
        lib.motivo ?? 'SNCR desligado.',
        {
          motivo: 'sncr-desligada',
          codigo: 'recurso-desligado',
        } as never,
      );
    const d = await this.porta.documentoEmitido(s.porta, documento);
    if (!d) throw recusa('documento-sem-prova', 404);
    if (d.usuario !== s.login) throw recusa('nao-e-o-autor', 403);
    if (d.tipo !== 'receita-controlada' && d.tipo !== 'receita-antimicrobiano')
      throw recusa('sncr-nao-aplicavel');
    const tipo =
      d.tipo === 'receita-controlada' ? ('controle-especial' as const) : ('antimicrobiano' as const);
    // O número de medicamentos sai do conteúdo emitido: se ele não se lê, recusa (sem contar pela metade).
    const conteudo = this.fonte
      ? await this.fonte.conteudo(s.porta, d).catch(() => {
          throw recusa('conteudo-indisponivel', 503);
        })
      : null;
    // Vários medicamentos na mesma receita: uma linha do corpo por medicamento (DP-47.2).
    const medicamentos = Math.max(1, conteudo?.conteudo.corpo.filter((l) => l.trim()).length ?? 1);
    const g = await this.porta.gravar(
      s.porta,
      (x) =>
        x.gravarSolicitacaoSncr({
          hospital: s.hospital,
          documento,
          origemId: d.origemId,
          tipo,
          medicamentos,
          usuario: s.login,
        }),
      (x) =>
        linhaTrilha(s, E.sncrSolicitada.codigo, 'documento.assinatura', 'documento.obterNumeracaoSncr', {
          tabela: 'pedido_numeracao_receita',
          id: String(x.id),
          paciente: d.paciente,
          chave: `pendente:${tipo}:${medicamentos}`,
        }),
    );
    let estado = { situacao: 'pendente' as const, tentativas: 0, numero: null as string | null } as {
      situacao: SolicitacaoSncrResumo['situacao'];
      tentativas: number;
      numero: string | null;
    };
    if (this.cfg.sncr) {
      let resp: Awaited<ReturnType<ClienteSncr['numerar']>>;
      try {
        resp = await this.cfg.sncr.numerar({ tipo, medicamentos });
      } catch {
        resp = { tipo: 'erro' };
      }
      estado = aplicarRespostaSncr({ situacao: 'pendente', tentativas: 0, numero: null }, resp, 5);
      await this.porta.gravar(
        s.porta,
        async (x) => {
          await x.atualizarSolicitacaoSncr(
            {
              id: g.id,
              hospital: s.hospital,
              situacao: estado.situacao,
              tentativas: estado.tentativas,
              numero: estado.numero,
              retorno: resp.tipo,
            },
            this.agora(),
          );
          if (estado.numero) await x.gravarNumeroSncr(s.hospital, documento, estado.numero);
        },
        linhaTrilha(s, E.sncrSolicitada.codigo, 'documento.assinatura', 'documento.obterNumeracaoSncr', {
          tabela: 'pedido_numeracao_receita',
          id: String(g.id),
          paciente: d.paciente,
          chave: `${estado.situacao}:${tipo}`,
        }),
      );
    }
    return { id: g.id, documento, ...estado };
  }
}
