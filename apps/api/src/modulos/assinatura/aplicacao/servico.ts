// Serviço de assinatura ICP-Brasil isolado (M49, etapa 1; ficha, seções 5, 7 e 8; regras 1, 2, 3, 5, 6 e 12). O
// documento não sai do servidor: só o HASH vai ao provedor em nuvem (OAuth 2.0 com PKCE, DOC-ICP-17.01 v3.0 item 6.4)
// ou ao agente local (A1/A3, desafio com nonce e prazo). A chave privada nunca passa por aqui; o segredo do provedor
// sai do cofre só para a troca do código. Cada assinatura volta e é VALIDADA no servidor antes de ser gravada: a
// assinatura crua confere com o hash pela chave do certificado, a cadeia chega a uma raiz confiável, a LCR do emissor
// diz que não está revogado, o CPF do certificado é o do usuário (a cada uso) e, em AD-RT, o carimbo do tempo da ACT
// confere (hash, nonce, assinatura e cadeia da ACT). Fonte fora do ar não é recusa: fica pendente (regra 5).
// Etapa 1: o certificado (vincular, desvincular), a assinatura de conferência do próprio certificado, a política por
// tipo de documento e os provedores com o segredo no cofre. A assinatura dos documentos emitidos é a etapa 2, sobre o
// mesmo `concluirAssinatura`. Tudo com a trilha na mesma transação e sem dado pessoal no payload.
import { createHash, randomBytes } from 'node:crypto';
import {
  type AssinaturaTesteResumo,
  type AutorizacaoPsc,
  type CertificadoVinculadoResumo,
  definicaoParametro,
  type DefinirPoliticaAssinatura,
  DESTINOS_DOCUMENTO,
  type DesafioAgenteLocal,
  EVENTOS_AUDITAVEIS,
  type MeuCertificadoResposta,
  type ModoAssinaturaIcp,
  MOTIVOS_RECUSA_ASSINATURA,
  type MotivoRecusaAssinatura,
  type PoliticaAssinaturaResumo,
  type PoliticasAssinaturaResposta,
  type ProvedorPscResumo,
  type ProvedoresPscResposta,
  ROTULOS_NIVEL_ASSINATURA,
  ROTULOS_POLITICA_ICP,
  type RemoverPoliticaAssinatura,
  type RespostaAgenteLocal,
  type ResultadoFluxoAssinatura,
  type SalvarProvedorPsc,
  type SegredoProvedor,
  type TesteConexaoProvedor,
  TIPOS_DOCUMENTO_POLITICA,
  type TipoDocumentoPolitica,
  type VincularCertificado,
} from '@sgh/contratos';
import { resolverParametro, valorTipado } from '@sgh/dominio-config';
import {
  camposComSegredoEmClaro,
  type ConfiguracaoPsc,
  conferirAssinaturaHash,
  conferirAssinaturas,
  conferirCarimbo,
  conferirCpf,
  conferirLcr,
  conferirRegraPolitica,
  conferirRespostaAgente,
  conferirToken,
  conferirTokenCarimbo,
  criarDesafio,
  decidirValidacao,
  enderecoAutorizacao,
  enderecosLcr,
  ErroDer,
  lerReferenciaCofre,
  escopoDoLote,
  gerarEstado,
  gerarPkce,
  lerCertificado,
  lerRespostaCarimbo,
  mascararCpf,
  midiasSemAutoridadesSuficientes,
  NOVA,
  pedidoCarimbo,
  referenciaCofre,
  registrarFalhaTransitoria,
  type RegraPoliticaAssinatura,
  resolverExigencia,
  type SituacaoRevogacao,
  situacaoSegredo,
  tipoPelaPolitica,
  verificarCadeia,
} from '@sgh/dominio-documento';
import {
  type CertificadoVinculado,
  ErroAssinatura,
  type PedidoAssinaturaAberto,
  type PoliticaVigente,
  type IdentidadeParaCertificado,
  type ProvedorNuvem,
  type TipoCertificado,
} from '../tipos.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../../autorizacao/estacao.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import { linhaTrilha, type SessaoCadastro } from '../../cadastro/comum.js';
import type { FonteConfiguracao } from '../../config/public-api.js';
import { type BuscadorLcr, type ClienteAct, type ClientePsc, ErroIndisponivel } from '../infra/clientes.js';
import type { Cofre } from '../infra/cofre.js';
import {
  CLIENT_ID_SIMULADOR,
  CODIGO_PROVEDOR_SIMULADO,
  ROTA_NAVEGADOR_SIMULADOR,
  resumo,
  type SimuladorIcp,
  URI_SIMULADOR,
} from '../infra/simulador.js';
import type { PortaAssinaturaIcp } from '../porta.js';

export interface ConfigServicoAssinatura {
  readonly modo: ModoAssinaturaIcp;
  readonly cofre: Cofre;
  readonly psc: ClientePsc;
  /** null: sem ACT configurada (o carimbo fica indisponível e a AD-RT, pendente). */
  readonly act: ClienteAct | null;
  readonly lcr: BuscadorLcr;
  /** Repositório de raízes confiáveis (ICP-Brasil em produção; a sintética no simulador). */
  readonly raizes: () => readonly Uint8Array[];
  readonly intermediarios: () => readonly Uint8Array[];
  /** redirect_uri cadastrado no provedor. */
  readonly retorno: string;
  readonly simulador: SimuladorIcp | null;
  readonly agenteLocal: string | null;
  readonly agora?: () => Date;
}

const E = EVENTOS_AUDITAVEIS;
const hexDe = (b: Uint8Array) => Buffer.from(b).toString('hex');
const sha256 = (b: Uint8Array | string) => createHash('sha256').update(b).digest();

type Recusa = MotivoRecusaAssinatura;

/** D-CPF-49: o CPF da conta diferente do CPF do profissional ligado a ela: cadastro inconsistente, nada se vincula nem se assina. */
export const cpfCruzadoDiverge = (ident: IdentidadeParaCertificado | null): boolean =>
  !!(ident?.cpf && ident.cpfProfissional && ident.cpf !== ident.cpfProfissional);

const normal = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();

/**
 * D-TIPOCERT-49: o tipo de certificado (tipo_certificado) do certificado vinculado. O cadastro do pc tem os provedores em nuvem
 * (SafeWeb, Vidaas) e um terceiro (Black Box); o certificado em nuvem casa pelo código ou pelo nome do provedor; o A1/A3
 * do agente local e o provedor sem correspondência ficam sem tipo (null), sem chute.
 */
export function tipoCertificadoDoProvedor(
  tipos: readonly TipoCertificado[],
  provedor: { codigo: string; nome: string } | null,
): number | null {
  if (!provedor) return null;
  const codigo = normal(provedor.codigo);
  const nome = normal(provedor.nome);
  const achados = tipos.filter((t) => {
    const n = normal(t.nome);
    return t.ativo && n.length >= 3 && (n === codigo || nome.split(/\s+/).includes(n) || nome.startsWith(n));
  });
  return achados.length === 1 ? achados[0]!.id : null;
}

export function recusa(motivo: Recusa, status = 422): ErroProblema {
  return new ErroProblema(
    'recusa-de-negocio',
    status,
    'Assinatura recusada',
    MOTIVOS_RECUSA_ASSINATURA[motivo],
    {
      motivo,
    } as never,
  );
}

export interface ResultadoValidacaoServico {
  readonly resultado: 'valida' | 'invalida' | 'indeterminada';
  readonly motivos: readonly string[];
  readonly falha: 'lcr-indisponivel' | 'ocsp-indisponivel' | 'act-indisponivel' | 'psc-indisponivel' | null;
  readonly cadeia: boolean | null;
  readonly vigencia: boolean;
  readonly revogacao: boolean | null;
  readonly cpf: boolean | null;
  readonly assinaturaConfere: boolean;
  readonly carimbo: boolean | null;
  readonly carimboToken: string | null;
  readonly carimboEm: Date | null;
  readonly carimboSerie: string | null;
}

/** A conclusão da assinatura dos documentos emitidos (etapa 2), chamada pela volta do provedor e do agente local. */
export interface ConclusaoDocumentos {
  concluirNuvem(
    s: SessaoCadastro,
    pedido: PedidoAssinaturaAberto,
    cfg: ConfiguracaoPsc,
    token: string,
    provedor: ProvedorNuvem,
  ): Promise<ResultadoFluxoAssinatura>;
  concluirAgente(
    s: SessaoCadastro,
    pedido: PedidoAssinaturaAberto,
    porHash: ReadonlyMap<string, string>,
    certificadoB64: string,
  ): Promise<ResultadoFluxoAssinatura>;
}

export class ServicoAssinaturaIcp {
  private readonly agora: () => Date;
  /** Etapa 2: quem conclui o pedido de documentos (ligado pelo serviço dos documentos ao ser criado). */
  documentos: ConclusaoDocumentos | null = null;
  /** M50.6: quem conclui o pedido da digitalização certificada (ligado pelo serviço da digitalização ao ser criado). */
  digitalizacao: ConclusaoDocumentos | null = null;

  constructor(
    private readonly porta: PortaAssinaturaIcp,
    private readonly trilha: RegistradorTrilha,
    readonly cfg: ConfigServicoAssinatura,
    private readonly configuracao: FonteConfiguracao | null = null,
  ) {
    this.agora = cfg.agora ?? (() => new Date());
  }

  get modo(): ModoAssinaturaIcp {
    return this.cfg.modo;
  }

  // ── Apoio ─────────────────────────────────────────────────────────────────────────────────────────────────

  async parametro(s: SessaoCadastro, chave: string): Promise<number> {
    const def = definicaoParametro(chave);
    if (!def) return 0;
    let valores: Awaited<ReturnType<FonteConfiguracao['valoresParametro']>>;
    try {
      valores = this.configuracao ? await this.configuracao.valoresParametro(s.rede, s.hospital) : [];
    } catch {
      valores = [];
    }
    const v = valorTipado(
      def,
      resolverParametro(
        def,
        valores,
        {
          rede: s.rede,
          empresa: null,
          estabelecimento: s.hospital,
          unidade: null,
          perfis: [],
          usuario: s.login,
        },
        this.agora(),
      ).valor,
    );
    return typeof v === 'number' ? v : Number(v ?? 0) || 0;
  }

  exigirLigado(): void {
    if (this.cfg.modo === 'desligado') throw recusa('servico-desligado', 409);
  }

  async falhaNaTrilha(s: SessaoCadastro, evento: string, recurso: string, motivo: string): Promise<void> {
    await this.trilha
      .registrar({
        evento,
        rede: s.rede,
        hospital: s.hospital,
        usuario: s.login,
        estacao: estacaoDaRequisicao(s.req).slice(0, 80),
        correlacao: correlacaoDaRequisicao(s.req, 'assinatura-icp').slice(0, 64),
        recurso: recurso.slice(0, 80),
        resultado: 'falha',
        chaveNaturalAlvo: motivo.slice(0, 60),
      })
      .catch(() => undefined);
  }

  /** No modo simulador, o provedor simulado existe no estabelecimento (só dev/ci; uma vez por estabelecimento). */
  async garantirSimulador(s: SessaoCadastro): Promise<void> {
    if (this.cfg.modo !== 'simulador' || !this.cfg.simulador) return;
    const ref = referenciaCofre(s.hospital, CODIGO_PROVEDOR_SIMULADO, 'client-secret');
    // Cofre em memória da sessão de teste: o segredo da partida na referência deste estabelecimento.
    if (!(await this.cfg.cofre.existe(ref))) {
      const segredo = await this.cfg.simulador.segredoDaPartida();
      if (segredo) await this.cfg.cofre.gravar(ref, segredo);
    }
    if (await this.porta.provedor(s.porta, CODIGO_PROVEDOR_SIMULADO)) return;
    await this.porta
      .gravar(
        s.porta,
        (g) =>
          g.gravarProvedor(
            {
              hospital: s.hospital,
              codigo: CODIGO_PROVEDOR_SIMULADO,
              nome: 'Provedor simulado (somente teste)',
              uriBase: URI_SIMULADOR,
              clientId: CLIENT_ID_SIMULADOR,
              autoridades: ['AC SINTETICA SANTE 1', 'AC SINTETICA SANTE 2'],
              ativo: true,
              segredoRef: ref,
              por: s.login,
              em: this.agora(),
            },
            null,
          ),
        (r) =>
          linhaTrilha(
            s,
            E.provedorAssinaturaAlterado.codigo,
            'documento.provedor',
            'documento.definirProvedor',
            {
              tabela: 'provedor_assinatura_nuvem',
              id: String(r.id),
              chave: CODIGO_PROVEDOR_SIMULADO,
            },
          ),
      )
      .catch((e: unknown) => {
        if (!(e instanceof ErroAssinatura)) throw e;
      });
  }

  /** W0-10 (M6): `retorno` troca o redirect_uri (o portal do médico externo volta à própria tela). */
  configPsc(p: ProvedorNuvem, retorno: string = this.cfg.retorno): ConfiguracaoPsc {
    return { uriBase: p.uriBase, clientId: p.clientId, retorno };
  }

  /** O endereço que o navegador abre: o do provedor; no simulador, a página do simulador pela própria API. */
  enderecoNavegador(p: ProvedorNuvem, endereco: string): string {
    return p.codigo === CODIGO_PROVEDOR_SIMULADO && this.cfg.simulador && endereco.startsWith(URI_SIMULADOR)
      ? `${ROTA_NAVEGADOR_SIMULADOR}${endereco.slice(URI_SIMULADOR.length)}`
      : endereco;
  }

  /** A referência do segredo só vale se for do estabelecimento da sessão (cofre:psc/<estab>/<codigo>/...). */
  refDoEstabelecimento(s: SessaoCadastro, p: ProvedorNuvem): string | null {
    const r = lerReferenciaCofre(p.segredoRef);
    return r && r.hospital === s.hospital && r.provedor === p.codigo ? p.segredoRef : null;
  }

  private async segredoDefinido(s: SessaoCadastro, p: ProvedorNuvem): Promise<boolean> {
    const ref = this.refDoEstabelecimento(s, p);
    return ref !== null && (await this.cfg.cofre.existe(ref));
  }

  async provedorUtilizavel(s: SessaoCadastro, codigo: string): Promise<ProvedorNuvem> {
    const p = await this.porta.provedor(s.porta, codigo);
    if (!p || !p.ativo || !(await this.segredoDefinido(s, p))) throw recusa('provedor-desligado');
    if (p.codigo === CODIGO_PROVEDOR_SIMULADO && this.cfg.modo !== 'simulador')
      throw recusa('provedor-desligado');
    return p;
  }

  // ── Meu certificado ───────────────────────────────────────────────────────────────────────────────────────

  resumoCertificado(c: CertificadoVinculado): CertificadoVinculadoResumo {
    return {
      id: c.id,
      midia: c.midia,
      provedor: c.provedor,
      serie: c.serie,
      tipo: c.tipoIcp,
      validoDe: c.validoDe,
      validoAte: c.validoAte,
      cpfMascarado: c.cpfMascarado,
      ativo: c.ativo,
    };
  }

  async meuCertificado(s: SessaoCadastro): Promise<MeuCertificadoResposta> {
    await this.garantirSimulador(s);
    const [certs, provs, testes] = await Promise.all([
      this.porta.certificados(s.porta, s.login),
      this.porta.provedores(s.porta),
      this.porta.assinaturas(s.porta, s.login, 'teste'),
    ]);
    const utilizaveis: { codigo: string; nome: string }[] = [];
    for (const p of provs)
      if (
        p.ativo &&
        (p.codigo !== CODIGO_PROVEDOR_SIMULADO || this.cfg.modo === 'simulador') &&
        (await this.segredoDefinido(s, p))
      )
        utilizaveis.push({ codigo: p.codigo, nome: p.nome });
    return {
      modo: this.cfg.modo,
      certificados: certs.map((c) => this.resumoCertificado(c)),
      provedores: utilizaveis,
      testes: testes.map((t): AssinaturaTesteResumo => ({
        id: t.id,
        certificado: t.certificado,
        politicaIcp: t.politicaIcp,
        estado: t.estado,
        falha: (t.falha as AssinaturaTesteResumo['falha']) ?? null,
        carimboEm: t.carimboEm,
        criadoEm: t.criadoEm,
        validacao: t.validacao
          ? {
              resultado: t.validacao.resultado,
              em: t.validacao.em,
              cadeia: t.validacao.cadeia,
              vigencia: t.validacao.vigencia,
              revogacao: t.validacao.revogacao,
              cpf: t.validacao.cpf,
              motivos: t.validacao.motivos,
              assinaturaConfere: t.validacao.assinaturaConfere,
              carimbo: t.validacao.carimbo,
            }
          : null,
      })),
      agenteLocal: this.cfg.agenteLocal,
    };
  }

  /** Lê, confere (CPF a cada uso, vigência, ICP, uso da chave, cadeia) e grava o certificado (regra 2). */
  private async vincularDer(
    s: SessaoCadastro,
    der: Uint8Array,
    origem: { midia: 'nuvem' | 'a1' | 'a3'; provedor: string | null },
  ): Promise<CertificadoVinculadoResumo> {
    const agora = this.agora();
    let lido: ReturnType<typeof lerCertificado>;
    try {
      lido = lerCertificado(der);
    } catch (e) {
      if (e instanceof ErroDer || e instanceof Error) throw recusa('certificado-invalido', 400);
      throw e;
    }
    const ident = await this.porta.identidade(s.porta, s.login);
    const falhar = async (m: Recusa): Promise<never> => {
      await this.falhaNaTrilha(s, E.certificadoVinculado.codigo, 'documento.certificado', m);
      throw recusa(m);
    };
    // O cadastro do profissional diz outro CPF: não vincula com o cadastro inconsistente (D-CPF-49).
    if (cpfCruzadoDiverge(ident)) await falhar('cpf-divergente');
    const cpf = conferirCpf(lido, ident?.cpf ?? null);
    if (!cpf.ok) await falhar(cpf.motivo);
    if (agora < lido.validoDe || agora > lido.validoAte) await falhar('certificado-fora-da-vigencia');
    const tipo = tipoPelaPolitica(lido.politicas);
    if (tipo === null) await falhar('certificado-fora-da-icp');
    if (!lido.usoDaChave?.assinaturaDigital || !lido.usoDaChave.naoRepudio) await falhar('uso-da-chave');
    const cadeia = verificarCadeia(der, this.cfg.intermediarios(), this.cfg.raizes(), agora);
    if (cadeia.situacao !== 'ok') return falhar('cadeia-invalida');
    const idTipoCertificado = tipoCertificadoDoProvedor(
      await this.porta.tiposCertificado(s.porta),
      origem.provedor ? await this.porta.provedor(s.porta, origem.provedor) : null,
    );
    try {
      const r = await this.porta.gravar(
        s.porta,
        (g) =>
          g.gravarCertificado({
            hospital: s.hospital,
            usuario: s.login,
            midia: origem.midia,
            provedor: origem.provedor,
            idTipoCertificado,
            serie: lido.serie,
            emissorHash: hexDe(sha256(cadeia.emissor)),
            tipoIcp: tipo,
            validoDe: lido.validoDe,
            validoAte: lido.validoAte,
            cpfMascarado: mascararCpf(ident!.cpf!),
            certificadoDer: Buffer.from(der).toString('base64'),
          }),
        (x) =>
          linhaTrilha(
            s,
            E.certificadoVinculado.codigo,
            'documento.certificado',
            'documento.vincularCertificado',
            {
              tabela: 'certificado_usuario',
              id: String(x.id),
              chave: lido.serie.slice(0, 40),
            },
          ),
      );
      const c = await this.porta.certificado(s.porta, r.id);
      return this.resumoCertificado(c!);
    } catch (e) {
      if (e instanceof ErroAssinatura && e.codigo === 'certificado-ja-vinculado')
        throw new ErroProblema('recusa-de-negocio', 409, 'Certificado já vinculado', e.message);
      throw e;
    }
  }

  /** A1/A3: a parte pública do certificado (do agente local ou do arquivo .cer). */
  async vincularArquivo(s: SessaoCadastro, e: VincularCertificado): Promise<CertificadoVinculadoResumo> {
    this.exigirLigado();
    if (e.midia === 'nuvem')
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Use o provedor',
        'O certificado em nuvem é vinculado pela autorização no provedor.',
      );
    return this.vincularDer(s, Uint8Array.from(Buffer.from(e.certificado, 'base64')), {
      midia: e.midia,
      provedor: null,
    });
  }

  async desvincular(s: SessaoCadastro, id: number): Promise<CertificadoVinculadoResumo> {
    const c = await this.porta.certificado(s.porta, id);
    if (!c || c.usuario !== s.login)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Certificado não encontrado',
        'Este certificado não é da sua conta.',
      );
    const feito = await this.porta.gravar(
      s.porta,
      (g) =>
        g.inativarCertificado({ hospital: s.hospital, usuario: s.login, id, por: s.login, em: this.agora() }),
      (ok) =>
        ok
          ? linhaTrilha(
              s,
              E.certificadoVinculado.codigo,
              'documento.certificado',
              'documento.desvincularCertificado',
              {
                tabela: 'certificado_usuario',
                id: String(id),
                chave: 'desvinculado',
              },
            )
          : null,
    );
    if (!feito)
      throw new ErroProblema('recusa-de-negocio', 409, 'Certificado já desvinculado', 'Atualize a tela.');
    return this.resumoCertificado((await this.porta.certificado(s.porta, id))!);
  }

  /** A linha de trilha do pedido gravado (sem o state nem o PKCE: só o ID e a finalidade). */
  trilhaDoPedido(s: SessaoCadastro, evento: string, finalidade: string, id: number, chave: string) {
    return linhaTrilha(
      s,
      evento,
      'documento.assinatura',
      finalidade === 'vincular' ? 'documento.vincularCertificado' : 'documento.assinar',
      { tabela: 'pedido_assinatura', id: String(id), chave },
    );
  }

  /** Consome o pedido da sessão (uma vez só), com a trilha na mesma transação quando há o que consumir. */
  consumir(s: SessaoCadastro, estadoOuDesafio: string) {
    return this.porta.gravar(
      s.porta,
      (g) =>
        g.consumirPedido(resumo(estadoOuDesafio), { hospital: s.hospital, usuario: s.login }, this.agora()),
      (p) =>
        p
          ? this.trilhaDoPedido(
              s,
              E.pedidoAssinaturaConsumido.codigo,
              p.finalidade,
              p.id,
              `${p.finalidade}:${p.vencido ? 'vencido' : 'no-prazo'}`,
            )
          : null,
    );
  }

  private async gravarPedidoNuvem(
    s: SessaoCadastro,
    p: ProvedorNuvem,
    finalidade: 'vincular' | 'teste' | 'digitalizacao',
    hashes: readonly string[],
    certificado: number | null,
    documentos: readonly number[] = [],
  ): Promise<AutorizacaoPsc> {
    const validadeMin = (await this.parametro(s, 'documento.autorizacaoPscMin')) || 10;
    const pkce = gerarPkce();
    const estado = gerarEstado();
    const cifrado = this.cfg.cofre.cifrar(pkce.verificador);
    if (!cifrado) throw recusa('provedor-desligado', 503);
    const expira = new Date(this.agora().getTime() + validadeMin * 60_000);
    await this.porta.gravar(
      s.porta,
      (g) =>
        g.gravarPedido({
          hospital: s.hospital,
          usuario: s.login,
          finalidade,
          midia: 'nuvem',
          provedor: p.codigo,
          certificado,
          stateHash: resumo(estado),
          pkceCifrado: cifrado,
          hashes,
          documentos,
          expiraEm: expira,
        }),
      (r) =>
        this.trilhaDoPedido(s, E.pedidoAssinaturaGravado.codigo, finalidade, r.id, `${finalidade}:nuvem`),
    );
    const endereco = enderecoAutorizacao(this.configPsc(p), {
      estado,
      pkce,
      documentos: Math.max(1, hashes.length),
      validadeSeg: validadeMin * 60,
    });
    return { tipo: 'nuvem', endereco: this.enderecoNavegador(p, endereco), expiraEm: expira.toISOString() };
  }

  async iniciarVinculoNuvem(s: SessaoCadastro, codigo: string): Promise<AutorizacaoPsc> {
    this.exigirLigado();
    await this.garantirSimulador(s);
    return this.gravarPedidoNuvem(s, await this.provedorUtilizavel(s, codigo), 'vincular', [], null);
  }

  /** Assinatura de conferência do certificado: o hash de um texto de conferência (nenhum documento, nenhum paciente). */
  async iniciarTeste(s: SessaoCadastro, idCert: number): Promise<AutorizacaoPsc | DesafioAgenteLocal> {
    this.exigirLigado();
    const c = await this.porta.certificado(s.porta, idCert);
    if (!c || c.usuario !== s.login || !c.ativo) throw recusa('certificado-divergente', 404);
    const agora = this.agora();
    const hash = hexDe(
      sha256(
        `Sante SGH: assinatura de conferência do certificado ${c.serie} em ${agora.toISOString()} (${randomBytes(8).toString('hex')})`,
      ),
    );
    if (c.midia === 'nuvem')
      return this.gravarPedidoNuvem(
        s,
        await this.provedorUtilizavel(s, c.provedor ?? ''),
        'teste',
        [hash],
        c.id,
      );
    const validadeMin = (await this.parametro(s, 'documento.autorizacaoPscMin')) || 10;
    const d = criarDesafio([hash], agora, validadeMin * 60);
    await this.porta.gravar(
      s.porta,
      (g) =>
        g.gravarPedido({
          hospital: s.hospital,
          usuario: s.login,
          finalidade: 'teste',
          midia: c.midia,
          provedor: null,
          certificado: c.id,
          stateHash: resumo(d.desafio),
          pkceCifrado: null,
          hashes: d.hashes,
          documentos: [],
          expiraEm: d.expiraEm,
        }),
      (x) => this.trilhaDoPedido(s, E.pedidoAssinaturaGravado.codigo, 'teste', x.id, `teste:${c.midia}`),
    );
    return {
      tipo: 'agente-local',
      desafio: d.desafio,
      hashes: d.hashes,
      algoritmo: 'sha256',
      expiraEm: d.expiraEm.toISOString(),
    };
  }

  /**
   * M50.6: a assinatura ICP-Brasil dos documentos digitalizados (um ou o lote) por quem conferiu a fidelidade: só os
   * resumos SHA-256 dos arquivos vão ao provedor (ou ao agente local), com os IDs da digitalização no pedido; a volta é
   * concluída pelo serviço da digitalização (`digitalizacao`), com a validação no servidor e o carimbo do tempo.
   */
  async iniciarAssinaturaDigitalizacao(
    s: SessaoCadastro,
    idCert: number,
    hashes: readonly string[],
    ids: readonly number[],
  ): Promise<AutorizacaoPsc | DesafioAgenteLocal> {
    this.exigirLigado();
    // A assinatura ICP-Brasil é pessoal: nunca numa sessão "como" (a mesma regra dos documentos do M49).
    if (s.req.sghComo) throw recusa('sessao-como', 403);
    if (!this.digitalizacao) throw recusa('servico-desligado', 409);
    const c = await this.porta.certificado(s.porta, idCert);
    if (!c || c.usuario !== s.login || !c.ativo) throw recusa('certificado-divergente', 404);
    if (c.midia === 'nuvem') {
      await this.garantirSimulador(s);
      return this.gravarPedidoNuvem(
        s,
        await this.provedorUtilizavel(s, c.provedor ?? ''),
        'digitalizacao',
        hashes,
        c.id,
        ids,
      );
    }
    const validadeMin = (await this.parametro(s, 'documento.autorizacaoPscMin')) || 10;
    const d = criarDesafio(hashes, this.agora(), validadeMin * 60);
    await this.porta.gravar(
      s.porta,
      (g) =>
        g.gravarPedido({
          hospital: s.hospital,
          usuario: s.login,
          finalidade: 'digitalizacao',
          midia: c.midia,
          provedor: null,
          certificado: c.id,
          stateHash: resumo(d.desafio),
          pkceCifrado: null,
          hashes: d.hashes,
          documentos: ids,
          expiraEm: d.expiraEm,
        }),
      (x) =>
        this.trilhaDoPedido(
          s,
          E.pedidoAssinaturaGravado.codigo,
          'digitalizacao',
          x.id,
          `digitalizacao:${c.midia}`,
        ),
    );
    return {
      tipo: 'agente-local',
      desafio: d.desafio,
      hashes: d.hashes,
      algoritmo: 'sha256',
      expiraEm: d.expiraEm.toISOString(),
    };
  }

  /** A volta do provedor (redirecionamento do OAuth): troca o código, e vincula ou assina e valida. */
  async retornoPsc(
    s: SessaoCadastro,
    q: { state: string; code: string | null; erro: string | null },
    retorno: string = this.cfg.retorno,
  ): Promise<ResultadoFluxoAssinatura> {
    const pedido = await this.consumir(s, q.state);
    const finalidade = pedido?.finalidade ?? 'teste';
    const falha = async (motivo: Recusa): Promise<ResultadoFluxoAssinatura> => {
      await this.falhaNaTrilha(
        s,
        finalidade === 'vincular' ? E.certificadoVinculado.codigo : E.assinaturaFalhou.codigo,
        finalidade === 'vincular' ? 'documento.certificado' : 'documento.assinatura',
        motivo,
      );
      return { finalidade, ok: false, certificado: pedido?.certificado ?? null, assinatura: null, motivo };
    };
    if (!pedido || pedido.vencido || pedido.usuario !== s.login || pedido.hospital !== s.hospital)
      return falha('autorizacao-expirada');
    if (q.erro || !q.code) return falha('autorizacao-negada');
    const p = await this.porta.provedor(s.porta, pedido.provedor ?? '');
    const ref = p ? this.refDoEstabelecimento(s, p) : null;
    const segredo = ref ? await this.cfg.cofre.ler(ref) : null;
    if (!p || !p.ativo || !segredo) return falha('provedor-desligado');
    const verificador = pedido.pkceCifrado ? this.cfg.cofre.decifrar(pedido.pkceCifrado) : null;
    if (!verificador) return falha('autorizacao-expirada');
    const cfg = this.configPsc(p, retorno);
    const ident = await this.porta.identidade(s.porta, s.login);
    // D-CPF-49 a cada uso: o cadastro que ficou inconsistente depois do vínculo não troca o código.
    if (cpfCruzadoDiverge(ident)) return falha('cpf-divergente');
    try {
      const t = conferirToken(
        await this.cfg.psc.trocarCodigo(cfg, { codigo: q.code, verificador, segredo }),
        { escopo: escopoDoLote(Math.max(1, pedido.hashes.length)), cpf: ident?.cpf ?? null },
        this.agora(),
      );
      if (!t.ok) return falha(t.motivo === 'titular-divergente' ? 'cpf-divergente' : 'resposta-invalida');
      // Etapa 2: os documentos emitidos (um ou o lote) numa autorização só.
      if (pedido.finalidade === 'documento')
        return this.documentos
          ? await this.documentos.concluirNuvem(s, pedido, cfg, t.token, p)
          : falha('servico-desligado');
      // M50.6: os documentos digitalizados (um ou o lote) na mesma autorização.
      if (pedido.finalidade === 'digitalizacao')
        return this.digitalizacao
          ? await this.digitalizacao.concluirNuvem(s, pedido, cfg, t.token, p)
          : falha('servico-desligado');
      if (pedido.finalidade === 'vincular') {
        const d = (await this.cfg.psc.descobrirCertificados(cfg, t.token)) as {
          certificates?: { certificate?: unknown }[];
        };
        const b64 = d?.certificates?.[0]?.certificate;
        if (typeof b64 !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return falha('resposta-invalida');
        try {
          const c = await this.vincularDer(s, Uint8Array.from(Buffer.from(b64, 'base64')), {
            midia: 'nuvem',
            provedor: p.codigo,
          });
          return { finalidade: 'vincular', ok: true, certificado: c.id, assinatura: null, motivo: null };
        } catch (e) {
          if (e instanceof ErroProblema) {
            const m = (e.extras as { motivo?: string }).motivo;
            return {
              finalidade: 'vincular',
              ok: false,
              certificado: null,
              assinatura: null,
              motivo: m ?? (e.getStatus() === 409 ? 'ja-vinculado' : 'resposta-invalida'),
            };
          }
          throw e;
        }
      }
      const c = pedido.certificado ? await this.porta.certificado(s.porta, pedido.certificado) : null;
      if (!c || !c.certificadoDer || c.usuario !== s.login) return falha('certificado-divergente');
      const hash = pedido.hashes[0]!;
      const r = conferirAssinaturas(
        await this.cfg.psc.assinar(
          cfg,
          t.token,
          [{ id: '1', alias: 'conferencia', hashHex: hash }],
          'principal',
        ),
        ['1'],
      );
      if (!r.ok) return falha('resposta-invalida');
      return this.concluirAssinatura(s, {
        certificado: c,
        hash,
        assinatura: r.assinaturas.get('1')!,
        provedor: p.codigo,
      });
    } catch (e) {
      if (e instanceof ErroIndisponivel) return falha('psc-indisponivel');
      throw e;
    }
  }

  /** A resposta do agente local (A1/A3): o desafio certo, no prazo, os mesmos hashes e o certificado vinculado. */
  async respostaAgente(s: SessaoCadastro, r: RespostaAgenteLocal): Promise<ResultadoFluxoAssinatura> {
    this.exigirLigado();
    const pedido = await this.consumir(s, r.desafio);
    const falha = async (motivo: Recusa): Promise<ResultadoFluxoAssinatura> => {
      await this.falhaNaTrilha(s, E.assinaturaFalhou.codigo, 'documento.assinatura', motivo);
      return {
        finalidade:
          pedido?.finalidade === 'documento' || pedido?.finalidade === 'digitalizacao'
            ? pedido.finalidade
            : 'teste',
        ok: false,
        certificado: pedido?.certificado ?? null,
        assinatura: null,
        motivo,
      };
    };
    if (!pedido || pedido.usuario !== s.login || pedido.hospital !== s.hospital || pedido.midia === 'nuvem')
      return falha('autorizacao-expirada');
    const conf = conferirRespostaAgente(
      {
        desafio: r.desafio,
        hashes: pedido.hashes,
        criadoEm: this.agora(),
        expiraEm: new Date(pedido.expiraEm),
      },
      r,
      this.agora(),
    );
    if (!conf.ok)
      return falha(conf.motivo === 'desafio-expirado' ? 'autorizacao-expirada' : 'resposta-invalida');
    if (pedido.finalidade === 'documento')
      return this.documentos
        ? this.documentos.concluirAgente(s, pedido, conf.porHash, r.certificado)
        : falha('servico-desligado');
    if (pedido.finalidade === 'digitalizacao')
      return this.digitalizacao
        ? this.digitalizacao.concluirAgente(s, pedido, conf.porHash, r.certificado)
        : falha('servico-desligado');
    const c = pedido.certificado ? await this.porta.certificado(s.porta, pedido.certificado) : null;
    if (!c || !c.certificadoDer || c.certificadoDer !== r.certificado) return falha('certificado-divergente');
    const hash = pedido.hashes[0]!;
    return this.concluirAssinatura(s, {
      certificado: c,
      hash,
      assinatura: Uint8Array.from(Buffer.from(conf.porHash.get(hash)!, 'base64')),
      provedor: null,
    });
  }

  /**
   * Valida no servidor (regra 3): assinatura do hash, cadeia, LCR, CPF e, em AD-RT, o carimbo do tempo. Puro quanto
   * ao banco: as fontes externas são as do cfg (o simulador em dev/ci).
   */
  async validar(d: {
    certificadoDer: Uint8Array;
    hash: string;
    assinatura: Uint8Array;
    politica: 'AD-RB' | 'AD-RT';
    /**
     * O CPF do usuário a conferir com o do certificado (regra 2): null = o usuário não tem CPF (inválida). Ausente
     * (undefined): não se confere o CPF (M49.3, D-EXPORTAR-CPF-49: a validação "ao exportar" e a do verificador de um
     * documento já assinado, cujo CPF foi conferido na assinatura).
     */
    cpfDoUsuario?: string | null;
  }): Promise<ResultadoValidacaoServico> {
    const agora = this.agora();
    const lido = lerCertificado(d.certificadoDer);
    const hashB = Uint8Array.from(Buffer.from(d.hash, 'hex'));
    const assinaturaConfere = conferirAssinaturaHash(d.certificadoDer, hashB, d.assinatura);
    const raizes = this.cfg.raizes();
    const cad = raizes.length
      ? verificarCadeia(d.certificadoDer, this.cfg.intermediarios(), raizes, agora)
      : null;
    const cadeia = cad === null ? 'indisponivel' : cad.situacao === 'ok' ? 'ok' : 'invalida';
    let revogacao: SituacaoRevogacao = 'lcr-indisponivel';
    if (cad?.situacao === 'ok') {
      for (const url of enderecosLcr(d.certificadoDer).slice(0, 3)) {
        try {
          const l = conferirLcr(await this.cfg.lcr.buscar(url), cad.emissor, agora);
          if (l.ok) {
            revogacao = l.lcr.revogados.has(lido.serie) ? 'revogado' : 'boa';
            break;
          }
        } catch (e) {
          if (!(e instanceof ErroIndisponivel)) throw e;
        }
      }
    }
    let carimbo: boolean | null = null;
    let carimboToken: string | null = null;
    let carimboEm: Date | null = null;
    let carimboSerie: string | null = null;
    let actFora = false;
    if (d.politica === 'AD-RT' && assinaturaConfere) {
      const nonce = randomBytes(8);
      nonce[0] = (nonce[0]! & 0x7f) | 0x01;
      const imprint = Uint8Array.from(sha256(d.assinatura));
      try {
        if (!this.cfg.act) throw new ErroIndisponivel('act', 'sem ACT');
        const resp = await this.cfg.act.carimbar(pedidoCarimbo(imprint, nonce));
        const c = conferirCarimbo(lerRespostaCarimbo(resp), { hash: imprint, nonce }, agora);
        const tk = conferirTokenCarimbo(resp, raizes, this.cfg.intermediarios(), agora);
        carimbo = c.ok && tk.ok;
        if (c.ok && tk.ok) {
          carimboToken = Buffer.from(resp).toString('base64');
          carimboEm = c.em;
          carimboSerie = c.serie;
        }
      } catch (e) {
        if (e instanceof ErroIndisponivel) actFora = true;
        else if (e instanceof ErroDer) carimbo = false;
        else throw e;
      }
    }
    const dec = decidirValidacao({
      agora,
      certificado: lido,
      cadeia,
      revogacao,
      carimboEm,
      politicaAssinatura: d.politica,
      ...(d.cpfDoUsuario === undefined ? {} : { cpfDoUsuario: d.cpfDoUsuario }),
    });
    const motivos: string[] = [...dec.motivos];
    if (!assinaturaConfere) motivos.unshift('assinatura-nao-confere');
    if (carimbo === false) motivos.push('carimbo-invalido');
    if (actFora) motivos.push('carimbo-indisponivel');
    const resultado =
      !assinaturaConfere || carimbo === false || dec.resultado === 'invalida'
        ? 'invalida'
        : dec.resultado === 'indeterminada' || actFora
          ? 'indeterminada'
          : 'valida';
    return {
      resultado,
      motivos,
      falha:
        resultado === 'indeterminada'
          ? (dec.falhaTransitoria ?? (actFora ? 'act-indisponivel' : null))
          : null,
      cadeia: dec.cadeia,
      vigencia: dec.vigencia,
      revogacao: dec.revogacao,
      cpf: dec.cpf,
      assinaturaConfere,
      carimbo,
      carimboToken,
      carimboEm,
      carimboSerie,
    };
  }

  /** Valida e grava a assinatura e a validação na mesma transação, com a trilha (regras 3, 5 e 12). */
  async concluirAssinatura(
    s: SessaoCadastro,
    d: { certificado: CertificadoVinculado; hash: string; assinatura: Uint8Array; provedor: string | null },
  ): Promise<ResultadoFluxoAssinatura> {
    const ident = await this.porta.identidade(s.porta, s.login);
    // D-CPF-49 a cada uso (nuvem e agente local): nada se grava com o cadastro inconsistente.
    if (cpfCruzadoDiverge(ident)) {
      await this.falhaNaTrilha(s, E.assinaturaFalhou.codigo, 'documento.assinatura', 'cpf-divergente');
      return {
        finalidade: 'teste',
        ok: false,
        certificado: d.certificado.id,
        assinatura: null,
        motivo: 'cpf-divergente',
      };
    }
    const politica = 'AD-RT' as const;
    const v = await this.validar({
      certificadoDer: Uint8Array.from(Buffer.from(d.certificado.certificadoDer ?? '', 'base64')),
      hash: d.hash,
      assinatura: d.assinatura,
      politica,
      cpfDoUsuario: ident?.cpf ?? null,
    });
    const agora = this.agora();
    const pendencia =
      v.resultado === 'indeterminada' && v.falha
        ? registrarFalhaTransitoria(NOVA, v.falha, agora, {
            maxTentativas: (await this.parametro(s, 'documento.assinaturaTentativas')) || 12,
            esperaInicialMin: (await this.parametro(s, 'documento.assinaturaEsperaInicialMin')) || 5,
          }).situacao
        : null;
    const estado = v.resultado === 'valida' ? 'assinada' : pendencia ? pendencia.estado : 'falha';
    const evento = estado === 'assinada' ? E.documentoAssinadoIcp.codigo : E.assinaturaFalhou.codigo;
    const r = await this.porta.gravar(
      s.porta,
      async (g) => {
        const a = await g.gravarAssinatura({
          hospital: s.hospital,
          origem: 'teste',
          documento: null,
          hash: d.hash,
          formato: 'cades',
          politicaIcp: politica,
          midia: d.certificado.midia,
          provedor: d.provedor,
          certificado: d.certificado.id,
          usuario: s.login,
          estado,
          tentativas: pendencia?.tentativas ?? 0,
          falha: pendencia?.falha ?? null,
          proximaEm: pendencia?.proximaEm ?? null,
          assinatura: Buffer.from(d.assinatura).toString('base64'),
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
        return a;
      },
      (x) => ({
        ...linhaTrilha(s, evento, 'documento.assinatura', 'documento.assinar', {
          tabela: 'assinatura_documento',
          id: String(x.id),
          chave: `teste:${politica}:${v.resultado}`,
        }),
        resultado: estado === 'assinada' ? 'sucesso' : 'falha',
      }),
    );
    return {
      finalidade: 'teste',
      ok: v.resultado === 'valida',
      certificado: d.certificado.id,
      assinatura: r.id,
      motivo: v.resultado === 'valida' ? null : (v.motivos[0] ?? null),
    };
  }

  // ── Política por tipo de documento ────────────────────────────────────────────────────────────────────────

  private regra(p: PoliticaVigente): RegraPoliticaAssinatura {
    return {
      id: p.id,
      tipoDocumento: p.tipoDocumento as TipoDocumentoPolitica,
      conselho: p.conselho,
      destino: p.destino,
      nivel: p.nivel,
      politicaIcp: p.politicaIcp,
      formato: p.formato,
    };
  }

  async politicas(s: SessaoCadastro): Promise<PoliticasAssinaturaResposta> {
    const [ps, conselhos] = await Promise.all([this.porta.politicas(s.porta), this.porta.conselhos(s.porta)]);
    const regras = ps.map((p) => this.regra(p));
    return {
      regras: ps.map((p): PoliticaAssinaturaResumo => ({
        id: p.id,
        tipoDocumento: p.tipoDocumento as TipoDocumentoPolitica,
        conselho: p.conselho,
        destino: p.destino,
        nivel: p.nivel,
        politicaIcp: p.politicaIcp,
        formato: p.formato,
        alteradaEm: p.criadoEm,
        alteradaPor: p.usuario,
      })),
      vigente: TIPOS_DOCUMENTO_POLITICA.flatMap((tipo) =>
        DESTINOS_DOCUMENTO.map((destino) => ({
          tipoDocumento: tipo,
          destino,
          exigencia: resolverExigencia(regras, { tipo, conselho: null, destino }),
        })),
      ),
      conselhos,
      podeEditar: s.pode('documento.politica.editar'),
    };
  }

  async definirPolitica(
    s: SessaoCadastro,
    e: DefinirPoliticaAssinatura,
  ): Promise<PoliticasAssinaturaResposta> {
    const c = conferirRegraPolitica({
      tipoDocumento: e.tipoDocumento,
      conselho: e.conselho,
      destino: e.destino,
      nivel: e.nivel,
      politicaIcp: e.politicaIcp,
      formato: e.formato,
    });
    if (!c.ok) {
      const minimo =
        c.minimo.nivel === 'icp-brasil'
          ? `${ROTULOS_NIVEL_ASSINATURA['icp-brasil']} ${ROTULOS_POLITICA_ICP[c.minimo.politicaIcp ?? 'AD-RB']}`
          : ROTULOS_NIVEL_ASSINATURA[c.minimo.nivel];
      throw new ErroProblema(
        'recusa-de-negocio',
        422,
        'Abaixo do mínimo legal',
        `Para este documento o mínimo é: ${minimo}. A política nunca fica abaixo do piso legal.`,
        { minimo: c.minimo } as never,
      );
    }
    // O conselho da regra é uma sigla do cadastro de conselhos (conselho_classe), a mesma que a tela oferece.
    if (e.conselho && !(await this.porta.conselhos(s.porta)).includes(e.conselho))
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Conselho fora do cadastro',
        'Escolha um conselho do cadastro de conselhos profissionais.',
      );
    const forma = e.politicaIcp
      ? (await this.porta.formasIcp(s.porta)).find((f) => f.politica === e.politicaIcp)
      : null;
    await this.porta.gravar(
      s.porta,
      (g) =>
        g.gravarPolitica({
          hospital: s.hospital,
          tipoDocumento: e.tipoDocumento,
          conselho: e.conselho,
          destino: e.destino,
          nivel: e.nivel,
          politicaIcp: e.politicaIcp,
          idFormaIcp: forma?.id ?? null,
          formato: e.formato,
          ativa: true,
          justificativa: e.justificativa,
          usuario: s.login,
        }),
      (r) =>
        linhaTrilha(
          s,
          E.politicaAssinaturaAlterada.codigo,
          'documento.politica',
          'documento.definirPoliticaAssinatura',
          {
            tabela: 'politica_assinatura',
            id: String(r.id),
            chave: `${e.tipoDocumento}:${e.destino}:${e.conselho ?? '*'}:${e.nivel}`,
          },
        ),
    );
    return this.politicas(s);
  }

  async removerPolitica(
    s: SessaoCadastro,
    e: RemoverPoliticaAssinatura,
  ): Promise<PoliticasAssinaturaResposta> {
    const atual = (await this.porta.politicas(s.porta)).find(
      (p) => p.tipoDocumento === e.tipoDocumento && p.destino === e.destino && p.conselho === e.conselho,
    );
    if (!atual)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Regra não encontrada',
        'Não há regra cadastrada para esta combinação.',
      );
    await this.porta.gravar(
      s.porta,
      (g) =>
        g.gravarPolitica({
          hospital: s.hospital,
          tipoDocumento: atual.tipoDocumento,
          conselho: atual.conselho,
          destino: atual.destino,
          nivel: atual.nivel,
          politicaIcp: atual.politicaIcp,
          idFormaIcp: atual.idFormaIcp,
          formato: atual.formato,
          ativa: false,
          justificativa: e.justificativa,
          usuario: s.login,
        }),
      (r) =>
        linhaTrilha(
          s,
          E.politicaAssinaturaAlterada.codigo,
          'documento.politica',
          'documento.definirPoliticaAssinatura',
          {
            tabela: 'politica_assinatura',
            id: String(r.id),
            chave: `${e.tipoDocumento}:${e.destino}:${e.conselho ?? '*'}:removida`,
          },
        ),
    );
    return this.politicas(s);
  }

  // ── Provedores em nuvem e cofre ───────────────────────────────────────────────────────────────────────────

  private async resumoProvedor(
    s: SessaoCadastro,
    p: ProvedorNuvem,
  ): Promise<ProvedorPscResumo & { versao: number; simulado: boolean }> {
    return {
      codigo: p.codigo,
      nome: p.nome,
      uriBase: p.uriBase,
      clientId: p.clientId,
      autoridades: p.autoridades,
      ativo: p.ativo,
      segredo: situacaoSegredo(await this.segredoDefinido(s, p)),
      versao: p.versao,
      simulado: p.codigo === CODIGO_PROVEDOR_SIMULADO,
    };
  }

  async provedores(s: SessaoCadastro): Promise<ProvedoresPscResposta> {
    await this.garantirSimulador(s);
    const lista = (await this.porta.provedores(s.porta)).filter(
      (p) => p.codigo !== CODIGO_PROVEDOR_SIMULADO || this.cfg.modo === 'simulador',
    );
    const minimo = (await this.parametro(s, 'documento.assinaturaMinimoAutoridades')) || 2;
    return {
      modo: this.cfg.modo,
      cofre: this.cfg.cofre.disponivel ? 'disponivel' : 'indisponivel',
      provedores: await Promise.all(lista.map((p) => this.resumoProvedor(s, p))),
      alertaAutoridades: midiasSemAutoridadesSuficientes(
        [
          ...lista.map((p) => ({
            codigo: p.codigo,
            ativo: p.ativo,
            midias: ['nuvem' as const],
            autoridades: p.autoridades,
          })),
        ],
        minimo,
      ),
      minimoAutoridades: minimo,
      podeEditar: s.pode('documento.provedor.editar'),
    };
  }

  /**
   * Inclui ou altera o provedor. Trocar o endereço ou o client_id de um provedor com segredo definido manda esse
   * segredo a outro destino na próxima troca do código: vale como trocar o segredo e pede a senha de novo
   * (`confirmarSenha`, a mesma reautenticação de D-SEGREDO-49) antes de gravar.
   */
  async salvarProvedor(
    s: SessaoCadastro,
    e: SalvarProvedorPsc,
    confirmarSenha: () => Promise<void>,
  ): Promise<ProvedoresPscResposta> {
    if (camposComSegredoEmClaro(e.provedor).length)
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Segredo fora do cofre',
        'O segredo vai só pelo campo próprio.',
      );
    if (e.provedor.codigo === CODIGO_PROVEDOR_SIMULADO)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Provedor reservado',
        'O provedor simulado não é editável.',
      );
    const ref = referenciaCofre(s.hospital, e.provedor.codigo, 'client-secret');
    const atual = e.versao !== null ? await this.porta.provedor(s.porta, e.provedor.codigo) : null;
    if (
      atual &&
      (atual.uriBase !== e.provedor.uriBase || atual.clientId !== e.provedor.clientId) &&
      (await this.segredoDefinido(s, atual))
    )
      await confirmarSenha();
    const temSegredo = atual ? await this.segredoDefinido(s, atual) : await this.cfg.cofre.existe(ref);
    if (e.provedor.ativo && !temSegredo)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Segredo não definido',
        'Defina o segredo do provedor no cofre antes de ligá-lo.',
      );
    try {
      await this.porta.gravar(
        s.porta,
        (g) =>
          g.gravarProvedor(
            {
              hospital: s.hospital,
              codigo: e.provedor.codigo,
              nome: e.provedor.nome,
              uriBase: e.provedor.uriBase,
              clientId: e.provedor.clientId,
              autoridades: e.provedor.autoridades,
              ativo: e.provedor.ativo,
              segredoRef: ref,
              por: s.login,
              em: this.agora(),
            },
            e.versao,
          ),
        (r) =>
          linhaTrilha(
            s,
            E.provedorAssinaturaAlterado.codigo,
            'documento.provedor',
            'documento.definirProvedor',
            {
              tabela: 'provedor_assinatura_nuvem',
              id: String(r.id),
              chave: `${e.provedor.codigo}:v${r.versao}`,
            },
          ),
      );
    } catch (x) {
      if (x instanceof ErroAssinatura)
        throw new ErroProblema(
          x.codigo === 'versao-desatualizada' ? 'conflito-de-versao' : 'recusa-de-negocio',
          409,
          'Provedor não salvo',
          x.message,
        );
      throw x;
    }
    return this.provedores(s);
  }

  /**
   * Troca o segredo no cofre (a resposta diz só "definido"). A trilha vai PRIMEIRO, numa transação confirmada; só
   * depois o cofre é gravado (sem registro, nenhuma troca). A falha do cofre vai à trilha como falha. Na sessão "como"
   * (ADR 0021) a troca é recusada: o cofre não guarda a versão anterior, e o Corrigir não teria como desfazê-la.
   */
  async definirSegredo(
    s: SessaoCadastro,
    codigo: string,
    e: SegredoProvedor,
  ): Promise<ProvedoresPscResposta> {
    const p = await this.porta.provedor(s.porta, codigo);
    if (!p || p.codigo === CODIGO_PROVEDOR_SIMULADO)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Provedor não encontrado',
        'Cadastre o provedor antes do segredo.',
      );
    if (s.req.sghComo)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Troca do segredo só pela própria conta',
        'O segredo do provedor não é trocado em acesso de suporte: entre com a sua própria conta.',
      );
    if (!this.cfg.cofre.disponivel)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Cofre indisponível',
        'O cofre do servidor não está configurado.',
      );
    const ref = this.refDoEstabelecimento(s, p);
    if (!ref)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Provedor sem referência do cofre',
        'Cadastre o provedor de novo neste estabelecimento.',
      );
    await this.porta.gravar(
      s.porta,
      async () => ({ id: p.id }),
      linhaTrilha(
        s,
        E.provedorAssinaturaAlterado.codigo,
        'documento.provedor.segredo',
        'documento.definirProvedor',
        {
          tabela: 'provedor_assinatura_nuvem',
          id: String(p.id),
          chave: `${codigo}:troca-do-segredo`,
        },
      ),
    );
    try {
      await this.cfg.cofre.gravar(ref, e.segredo);
    } catch (x) {
      await this.falhaNaTrilha(
        s,
        E.provedorAssinaturaAlterado.codigo,
        'documento.provedor.segredo',
        'cofre-falhou',
      );
      throw x;
    }
    return this.provedores(s);
  }

  async testarConexao(s: SessaoCadastro, codigo: string): Promise<TesteConexaoProvedor> {
    const p = await this.porta.provedor(s.porta, codigo);
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Provedor não encontrado', 'Atualize a tela.');
    return { ok: await this.cfg.psc.testar(this.configPsc(p)), em: this.agora().toISOString() };
  }
}
