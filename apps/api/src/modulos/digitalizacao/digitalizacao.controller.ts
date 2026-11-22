// Digitalização certificada do prontuário em papel (M50, etapa 6; ficha, seções 4 a 8; regras 12 e 13; Lei 13.787/2018;
// Decreto 10.278/2020):
//   GET  /api/digitalizacao/gravacao                    a funcionalidade e cada ação valem agora? (motivo; o login)
//   GET  /api/digitalizacao/fila?situacao               os documentos da situação, com as contagens (auditado)
//   GET  /api/digitalizacao/pacientes/:prontuario       o paciente e as internações para indexar (auditado)
//   GET  /api/digitalizacao/prontuarios/:prontuario     os documentos digitalizados do prontuário (auditado)
//   GET  /api/digitalizacao/:id/arquivo                 o PDF guardado, conferido pelo resumo (auditado)
//   POST /api/digitalizacao                             internacao.digitalizarDocumento (captura e índice)
//   POST /api/digitalizacao/:id/conferencia             internacao.conferirDigitalizacao (fiel ou recusado)
//   POST /api/digitalizacao/assinatura                  o pedido de assinatura ICP-Brasil (um ou o lote) pelo M49
// O resumo SHA-256 é SEMPRE recalculado aqui (o da estação só confere); o arquivo vai ao armazenamento com retenção e o
// banco guarda a chave e o resumo; a segregação (quem confere não é quem capturou; quem assina é quem conferiu) vale aqui
// e no próprio UPDATE. Gravações no banco do cliente com a trilha na mesma transação. Desligada até a comissão de revisão de
// prontuários aprovar o fluxo (chave `digitalizacao`, POL-3): as telas ficam em consulta.
import { createHash } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Logger,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type AutorizacaoPsc,
  CHAVE_LIBERACAO_DIGITALIZACAO,
  type CorDigitalizacao,
  type DesafioAgenteLocal,
  type DigitalizacaoLida,
  esquemaAssinarDigitalizacao,
  esquemaConferirDigitalizacao,
  esquemaDigitalizarDocumento,
  EVENTOS_AUDITAVEIS as E,
  type FilaDigitalizacao,
  type GravacaoDigitalizacao,
  type PacienteDigitalizacao,
  PERMISSOES_DIGITALIZACAO as P,
  type ResultadoDigitalizacao,
  SITUACOES_DIGITALIZACAO,
  type SituacaoDigitalizacao,
  TAMANHO_MAXIMO_DIGITALIZACAO,
  type TipoDocumentoDigitalizado,
} from '@sgh/contratos';
import {
  conferirCaptura,
  ErroDigitalizacao,
  guardaAte,
  transicaoDigitalizacao,
} from '@sgh/dominio-internacao';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, problemaDoCadastro, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { ARMAZEM_DIGITALIZACAO, type ArmazemDigitalizacao } from './armazem.js';
import { ServicoAssinaturaDigitalizacao } from './assinatura.js';
import {
  type DocumentoDigitalizado,
  type GravadorDigitalizacao,
  type PedidoGravacaoDigitalizacao,
  PORTA_DIGITALIZACAO,
  type PortaDigitalizacao,
} from './porta.js';

export const SERVICO_ASSINATURA_DIGITALIZACAO = Symbol('SERVICO_ASSINATURA_DIGITALIZACAO');

interface Resposta {
  status(c: number): Resposta;
  header(n: string, v: string): Resposta;
  send(b?: unknown): void;
}

const sha256Hex = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

const recusaDominio = (x: unknown): never => {
  if (x instanceof ErroDigitalizacao)
    throw new ErroProblema('recusa-de-negocio', 409, 'Digitalização recusada', x.message, {
      codigo: x.codigo,
    });
  throw x;
};

const publica = (d: DocumentoDigitalizado, nomes: Map<number, string>): DigitalizacaoLida => ({
  id: d.id,
  lote: d.lote,
  ordem: d.ordem,
  prontuario: d.prontuario,
  internacao: d.internacao,
  paciente: d.paciente,
  nome: nomes.get(d.paciente) ?? '',
  tipoDocumento: d.tipoDocumento as TipoDocumentoDigitalizado,
  descricao: d.descricao,
  dataDocumento: d.dataDocumento,
  paginas: d.paginas,
  resolucaoDpi: d.resolucaoDpi,
  cor: d.cor as CorDigitalizacao,
  hash: d.hash,
  tamanho: d.tamanho,
  situacao: d.situacao,
  capturadoPor: d.capturadoPor,
  capturadoEm: d.capturadoEm,
  conferidoPor: d.conferidoPor,
  conferidoEm: d.conferidoEm,
  motivo: d.motivo,
  assinatura: d.assinatura,
  assinadoPor: d.assinadoPor,
  assinadoEm: d.assinadoEm,
  carimboEm: d.carimboEm,
  destinacao: 'guardar',
  guardaAte: d.guardaAte,
  versao: d.versao,
});

/**
 * A conferência da fidelidade e a assinatura ICP-Brasil são pessoais (Lei 13.787: quem confere não é quem capturou; quem
 * assina é quem conferiu): numa sessão "como" o login é o do usuário-alvo, e a segregação seria contornada. Recusa com
 * 403 `sessao-como`, como as assinaturas dos documentos.
 */
const MOTIVO_SESSAO_COMO =
  'Na sessão de suporte não se confere nem se assina a digitalização: entre com a sua própria conta.';
/** Na sessão "como", a conferência e a assinatura aparecem desligadas com o motivo (a captura segue, auditada). */
export function semAcoesPessoais(operacoes: Record<string, { pode: boolean; motivo: string | null }>): void {
  for (const op of ['conferir', 'assinar'])
    if (operacoes[op]?.pode) operacoes[op] = { pode: false, motivo: MOTIVO_SESSAO_COMO };
}
export function naoComo(req: Pick<RequisicaoAutorizada, 'sghComo'>): void {
  if (req.sghComo)
    throw new ErroProblema('recusa-de-negocio', 403, 'Ação pessoal', MOTIVO_SESSAO_COMO, {
      codigo: 'sessao-como',
    });
}

const IDEMPOTENCIA = /^[A-Za-z0-9._:-]{8,80}$/;

/**
 * A sessão com o pedido repetível: a Idempotency-Key da requisição, a ação e os dados efetivos. Sem a chave válida, a
 * gravação segue sem repetição (uma chave própria por gravação).
 */
function comPedido(s: SessaoCadastro, pedido: Omit<PedidoGravacaoDigitalizacao, 'chave'>): SessaoCadastro {
  const bruto = s.req.headers['idempotency-key'];
  const chave = Array.isArray(bruto) ? bruto[0] : bruto;
  if (typeof chave !== 'string' || !IDEMPOTENCIA.test(chave)) return s;
  const porta = { ...s.porta, pedido: { ...pedido, chave } };
  return { ...s, porta };
}

@Controller()
export class DigitalizacaoController {
  private readonly log = new Logger('Digitalizacao');
  private readonly apoio: ApoioGravacao<GravadorDigitalizacao>;

  constructor(
    @Inject(PORTA_DIGITALIZACAO) private readonly porta: PortaDigitalizacao,
    @Inject(ARMAZEM_DIGITALIZACAO) private readonly armazem: ArmazemDigitalizacao,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional()
    @Inject(SERVICO_ASSINATURA_DIGITALIZACAO)
    private readonly assinatura: { readonly servico: ServicoAssinaturaDigitalizacao | null } | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao<GravadorDigitalizacao>(
      { chave: CHAVE_LIBERACAO_DIGITALIZACAO, nome: 'a digitalização certificada', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  @Get('digitalizacao/gravacao')
  @Permissao(P.ler)
  async gravacao(@Req() req: RequisicaoAutorizada): Promise<GravacaoDigitalizacao> {
    const s = sessaoDe(req);
    const g = await this.apoio.gravacao(s, {
      capturar: P.capturar,
      conferir: P.conferir,
      assinar: P.conferir,
    });
    const operacoes = { ...g.operacoes };
    if (req.sghComo) semAcoesPessoais(operacoes);
    if (operacoes['assinar']?.pode && !this.assinatura)
      operacoes['assinar'] = { pode: false, motivo: 'O serviço de assinatura digital não está disponível.' };
    return { ligada: g.ligada, motivo: g.motivo, operacoes, login: s.login };
  }

  @Get('digitalizacao/fila')
  @Permissao(P.ler)
  @Auditar(E.digitalizacaoLida.codigo)
  async fila(
    @Req() req: RequisicaoAutorizada,
    @Query('situacao') situacao?: string,
  ): Promise<FilaDigitalizacao> {
    const s = sessaoDe(req);
    const filtro = (SITUACOES_DIGITALIZACAO as readonly string[]).includes(situacao ?? '')
      ? (situacao as SituacaoDigitalizacao)
      : null;
    const [f, { agora }] = await Promise.all([this.porta.fila(s.porta, filtro), this.porta.relogio(s.porta)]);
    const nomes = await this.porta.nomes(
      s.porta,
      f.itens.map((d) => d.paciente),
    );
    return {
      itens: f.itens.map((d) => publica(d, nomes)),
      cortada: f.cortada,
      contagens: f.contagens,
      lidoEm: agora,
    };
  }

  @Get('digitalizacao/pacientes/:prontuario')
  @Permissao(P.capturar)
  @Auditar(E.digitalizacaoLida.codigo)
  async paciente(
    @Param('prontuario') pront: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PacienteDigitalizacao> {
    const s = sessaoDe(req);
    const p = await this.porta.paciente(s.porta, idDaRota(pront));
    if (!p)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Prontuário não encontrado',
        'Nenhum paciente com este prontuário.',
      );
    return { prontuario: p.prontuario, paciente: p.paciente, nome: p.nome, internacoes: [...p.internacoes] };
  }

  @Get('digitalizacao/prontuarios/:prontuario')
  @Permissao(P.ler)
  @Auditar(E.digitalizacaoLida.codigo)
  async doProntuario(@Param('prontuario') pront: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const docs = await this.porta.doProntuario(s.porta, idDaRota(pront));
    const nomes = await this.porta.nomes(
      s.porta,
      docs.map((d) => d.paciente),
    );
    return { itens: docs.map((d) => publica(d, nomes)) };
  }

  @Get('digitalizacao/:id/arquivo')
  @Permissao(P.ler)
  @Auditar(E.digitalizacaoLida.codigo)
  async arquivo(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
    @Res() res: Resposta,
  ): Promise<void> {
    const s = sessaoDe(req);
    const d = await this.porta.documento(s.porta, idDaRota(id));
    if (!d)
      throw new ErroProblema('nao-encontrado', 404, 'Documento não encontrado', 'O documento não existe.');
    const bytes = await this.armazem.ler(s.hospital, d.arquivoChave);
    if (!bytes)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Arquivo indisponível',
        'O arquivo não está no armazenamento.',
      );
    if (sha256Hex(bytes) !== d.hash)
      throw new ErroProblema(
        'erro-interno',
        500,
        'Arquivo divergente',
        'O arquivo guardado não confere com o resumo registrado na captura.',
      );
    res
      .status(200)
      .header('content-type', 'application/pdf')
      .header('content-disposition', `inline; filename="digitalizacao-${d.lote}-${d.ordem}.pdf"`)
      .header('cache-control', 'no-store')
      .header('x-sgh-sha256', d.hash)
      .send(Buffer.from(bytes));
  }

  @Post('digitalizacao')
  @HttpCode(201)
  @Permissao(P.capturar)
  @AuditadoNoHandler(
    'internacao.digitalizarDocumento (documento_digitalizado; o arquivo no armazenamento com retenção) com a trilha',
  )
  async capturar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoDigitalizacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaDigitalizarDocumento, b);
    await this.apoio.exigirLiberacao(s);
    const bytes = Uint8Array.from(Buffer.from(e.conteudo, 'base64'));
    if (bytes.length === 0 || bytes.length > TAMANHO_MAXIMO_DIGITALIZACAO)
      throw new ErroProblema('entrada-invalida', 400, 'Arquivo inválido', 'O PDF tem de ter até 12 MB.');
    const hash = sha256Hex(bytes);
    if (hash !== e.hashConteudo)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Arquivo corrompido',
        'O resumo calculado pela estação não confere com o arquivo recebido: digitalize de novo.',
        { codigo: 'hash-divergente' },
      );
    const sp = comPedido(s, {
      acao: 'capturar',
      entrada: {
        hash,
        prontuario: e.prontuario,
        internacao: e.internacao,
        lote: e.lote,
        tipoDocumento: e.tipoDocumento,
        descricao: e.descricao,
        dataDocumento: e.dataDocumento,
        paginas: e.paginas,
        resolucaoDpi: e.resolucaoDpi,
        cor: e.cor,
      },
    });
    const ja = await this.repeticao<{ id: number; lote: number; ordem: number }>(sp);
    if (ja) return respostaCaptura(ja.valor);
    const [p, { hoje }] = await Promise.all([
      this.porta.paciente(s.porta, e.prontuario),
      this.porta.relogio(s.porta),
    ]);
    if (!p)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Prontuário não encontrado',
        'Nenhum paciente com este prontuário.',
      );
    if (
      e.internacao !== null &&
      (await this.porta.prontuarioDaInternacao(s.porta, e.internacao)) !== e.prontuario
    )
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Digitalização recusada',
        'A internação informada não é deste prontuário.',
        { codigo: 'internacao-de-outro-prontuario' },
      );
    if (e.lote !== null && !(await this.porta.loteExiste(s.porta, e.lote)))
      throw new ErroProblema('nao-encontrado', 404, 'Lote não encontrado', 'O lote informado não existe.');
    try {
      conferirCaptura({
        bytes,
        resolucaoDpi: e.resolucaoDpi,
        paginas: e.paginas,
        dataDocumento: e.dataDocumento,
        hoje,
      });
    } catch (x) {
      return recusaDominio(x);
    }
    // Antes de guardar: o mesmo arquivo já digitalizado é recusado sem tocar no armazenamento.
    if (await this.porta.hashExiste(s.porta, hash))
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Digitalização recusada',
        'Este mesmo arquivo já foi digitalizado neste estabelecimento.',
        { codigo: 'ja-digitalizado' },
      );
    // A chave é o resumo e a retenção é curta até o COMMIT: uma recusa da transação não deixa cópia presa por 20 anos
    // (a nova tentativa reaproveita o mesmo objeto).
    const arquivoChave = await this.armazem.guardar(s.hospital, bytes, hash);
    const r = await this.apoio.sgh(
      sp,
      E.documentoDigitalizado.codigo,
      P.capturar,
      (x: { id: number; lote: number; ordem: number }) => ({
        tabela: 'documento_digitalizado',
        id: String(x.id),
        paciente: p.paciente,
        chave: `lote=${x.lote}:${e.tipoDocumento}:${e.paginas}p:${e.resolucaoDpi}dpi:${hash.slice(0, 16)}`,
      }),
      (g) =>
        g.capturar({
          lote: e.lote,
          prontuario: e.prontuario,
          internacao: e.internacao,
          paciente: p.paciente,
          tipoDocumento: e.tipoDocumento,
          descricao: e.descricao,
          dataDocumento: e.dataDocumento,
          paginas: e.paginas,
          resolucaoDpi: e.resolucaoDpi,
          cor: e.cor,
          arquivoChave,
          hash,
          tamanho: bytes.length,
          guardaAte: guardaAte(hoje),
          usuario: s.login,
        }),
    );
    await this.fixarGuarda(s.hospital, arquivoChave);
    return respostaCaptura(r);
  }

  /** O resultado já gravado para o mesmo pedido (Idempotency-Key), ou null; a chave com outros dados: 422. */
  private repeticao<T>(s: SessaoCadastro): Promise<{ readonly valor: T } | null> {
    return this.porta.repeticao<T>(s.porta).catch((x: unknown) => {
      throw problemaDoCadastro(x);
    });
  }

  /** A retenção da guarda legal depois do COMMIT; a falha não desfaz a captura (a conferência refaz e exige). */
  private async fixarGuarda(hospital: string, chave: string): Promise<void> {
    try {
      await this.armazem.fixar(hospital, chave);
    } catch {
      this.log.warn('a retenção da guarda legal não foi fixada após a captura; a conferência refaz');
    }
  }

  @Post('digitalizacao/:id/conferencia')
  @HttpCode(200)
  @Permissao(P.conferir)
  @AuditadoNoHandler('internacao.conferirDigitalizacao (documento_digitalizado, pela versão) com a trilha')
  async conferir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoDigitalizacao> {
    naoComo(req);
    const s = sessaoDe(req);
    const e = corpo(esquemaConferirDigitalizacao, b);
    if (e.id !== idDaRota(id))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Documento divergente',
        'O documento da rota e o do corpo diferem.',
      );
    await this.apoio.exigirLiberacao(s);
    const d = await this.porta.documento(s.porta, e.id);
    if (!d)
      throw new ErroProblema('nao-encontrado', 404, 'Documento não encontrado', 'O documento não existe.');
    const sp = comPedido(s, {
      acao: 'conferir',
      entrada: { id: e.id, resultado: e.resultado, motivo: e.motivo ?? null, versao: e.versao },
    });
    if (await this.repeticao<null>(sp))
      return respostaConferencia(d, e.resultado === 'fiel' ? 'conferido' : 'recusado');
    // A guarda legal antes de aceitar a fidelidade (se a fixação depois da captura falhou, refaz aqui; falhando, recusa).
    await this.armazem.fixar(s.hospital, d.arquivoChave);
    let nova: SituacaoDigitalizacao;
    try {
      nova = transicaoDigitalizacao(
        d.situacao,
        e.resultado === 'fiel' ? 'conferir-fiel' : 'conferir-recusar',
        {
          quem: s.login,
          capturadoPor: d.capturadoPor,
          conferidoPor: d.conferidoPor,
        },
      );
    } catch (x) {
      return recusaDominio(x);
    }
    await this.apoio.sgh(
      sp,
      E.digitalizacaoConferida.codigo,
      P.conferir,
      {
        tabela: 'documento_digitalizado',
        id: String(d.id),
        paciente: d.paciente,
        chave: `lote=${d.lote}:${e.resultado}`,
      },
      (g) =>
        g.conferir({
          id: d.id,
          situacao: nova as 'conferido' | 'recusado',
          motivo: e.resultado === 'recusar' ? (e.motivo ?? null) : null,
          versao: e.versao,
          usuario: s.login,
        }),
    );
    return respostaConferencia(d, nova);
  }

  @Post('digitalizacao/assinatura')
  @HttpCode(200)
  @Permissao(P.conferir)
  @AuditadoNoHandler(
    'o pedido de assinatura (M49, finalidade digitalizacao); a assinatura e o documento na volta, com a trilha',
  )
  async assinar(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<AutorizacaoPsc | DesafioAgenteLocal> {
    naoComo(req);
    const s = sessaoDe(req);
    const e = corpo(esquemaAssinarDigitalizacao, b);
    await this.apoio.exigirLiberacao(s);
    const servico = this.assinatura?.servico ?? null;
    if (!servico)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Assinatura indisponível',
        'O serviço de assinatura digital não está disponível.',
      );
    return servico.iniciar(s, e.ids, e.certificado);
  }
}

function respostaCaptura(r: { id: number; lote: number; ordem: number }): ResultadoDigitalizacao {
  return {
    ok: true,
    id: r.id,
    lote: r.lote,
    situacao: 'capturado',
    mensagem: `Documento ${r.lote}/${r.ordem} capturado: a conferência da fidelidade é de outra pessoa.`,
  };
}

function respostaConferencia(
  d: { id: number; lote: number },
  nova: SituacaoDigitalizacao,
): ResultadoDigitalizacao {
  return {
    ok: true,
    id: d.id,
    lote: d.lote,
    situacao: nova,
    mensagem:
      nova === 'conferido'
        ? 'Fidelidade conferida: o documento está pronto para a sua assinatura.'
        : 'Documento recusado: capture de novo a partir do papel.',
  };
}
