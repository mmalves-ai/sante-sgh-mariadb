// Catálogo das visões exportáveis e o arquivo de cada entrega aos parceiros (F3.9, linha 08-INTG L134):
//   GET  /api/integracoes/pacotes/visoes                 a lista branca (visões, campos, sensível, identificador)
//   POST /api/integracoes/pacotes/conferencia            confere o pacote na hora (regra e catálogo), sem gravar
//   GET  /api/integracoes/pacotes/entregas/:id/arquivo    baixa o arquivo guardado da entrega (porta de arquivos)
// O arquivo serve ao operador dos meios sem envio automático (SFTP, arquivo seguro, e-mail seguro): ele baixa,
// envia e marca a situação da entrega. O conteúdo vem conferido pelo hash; sem banco próprio, 503.
// O arquivo leva dados pessoais e sensíveis de muitos pacientes (LGPD art. 37 e 46; SBIS): a leitura vai com o
// usuário e o estabelecimento da sessão, e todo download vai à trilha (quem, qual entrega, arquivo, hash, quando).
// Sem trilha, sem dado: falha ao registrar devolve 503 e nada sai.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Optional,
  Param,
  ParseIntPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { EVENTOS_AUDITAVEIS, PERMISSOES_M34_CODIGOS as P } from '@sgh/contratos';
import { conferirPacoteNoCatalogo, validarPacote, VISOES_EXPORTAVEIS } from '@sgh/dominio-integracao';
import type { ArmazemArquivos, ContextoNucleo } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../autorizacao/estacao.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { problemaDoCadastro, sessaoDe } from '../cadastro/comum.js';
import type { ContextoComunicacao } from './comunicacao-base-propria.js';
import {
  esquemaPacote,
  PORTA_PACOTES_PARCEIRO,
  type PortaPacotesParceiroPropria,
} from './pacotes-parceiro-propria.js';

export const ARMAZEM_PACOTES_PARCEIRO = Symbol('ARMAZEM_PACOTES_PARCEIRO');

/** A porta de arquivos do cliente e o nome do banco dele (contexto da leitura). */
export interface ArmazemPacotesParceiro {
  readonly armazem: ArmazemArquivos;
  readonly cliente: string;
}

interface Resposta {
  setHeader(k: string, v: string): void;
}

/** Quem baixa: a sessão (usuário e estabelecimento) e o que vai à trilha. */
export interface QuemBaixa {
  readonly porta: ContextoComunicacao;
  readonly estabelecimento: number | null;
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  readonly estacao: string;
  readonly correlacao: string;
}

/**
 * O arquivo guardado de uma entrega, lido com o contexto da sessão e registrado na trilha antes de sair. A falha da
 * trilha recusa o download (503 trilha-indisponivel).
 */
export async function baixarArquivoDaEntrega(
  d: {
    readonly porta: PortaPacotesParceiroPropria;
    readonly arquivos: ArmazemPacotesParceiro;
    readonly trilha: RegistradorTrilha;
  },
  q: QuemBaixa,
  entrega: number,
): Promise<{
  readonly conteudo: Buffer;
  readonly nome: string;
  readonly tipoMime: string;
  readonly hash: string;
}> {
  const { arquivoId } = await d.porta.arquivoDaEntrega(q.porta, entrega);
  const ctx: ContextoNucleo = {
    cliente: q.porta.cliente || d.arquivos.cliente,
    estabelecimento: q.estabelecimento,
    usuario: q.porta.usuario,
    correlacao: q.correlacao,
  };
  const lido = await d.arquivos.armazem.ler(ctx, arquivoId);
  try {
    await d.trilha.registrar({
      evento: EVENTOS_AUDITAVEIS.integracaoPacoteEntregaExportado.codigo,
      rede: q.rede,
      hospital: q.hospital,
      usuario: q.login,
      estacao: q.estacao,
      correlacao: q.correlacao,
      recurso: 'integracoes.pacotes.entregas.arquivo',
      resultado: 'sucesso',
      tabelaAlvo: 'entrega_pacote_parceiro',
      idAlvo: String(entrega),
      chaveNaturalAlvo: `arquivo:${arquivoId};sha256:${lido.metadado.hash}`,
    });
  } catch {
    throw new ErroProblema(
      'trilha-indisponivel',
      503,
      'Trilha de auditoria indisponível',
      'O download não foi registrado; nada foi entregue. Tente de novo em instantes.',
    );
  }
  return {
    conteudo: lido.conteudo,
    nome: lido.metadado.nomeOriginal.replace(/[^A-Za-z0-9_.-]/g, '-'),
    tipoMime: lido.metadado.tipoMime,
    hash: lido.metadado.hash,
  };
}

@Controller('integracoes/pacotes')
export class PacotesVisoesController {
  constructor(
    @Optional()
    @Inject(PORTA_PACOTES_PARCEIRO)
    private readonly pacotes: PortaPacotesParceiroPropria | null = null,
    @Optional()
    @Inject(ARMAZEM_PACOTES_PARCEIRO)
    private readonly arquivos: ArmazemPacotesParceiro | null = null,
    @Optional()
    @Inject(REGISTRADOR_TRILHA)
    private readonly trilha: RegistradorTrilha | null = null,
  ) {}

  @Get('visoes')
  @Permissao(P.parceiroLer)
  visoes() {
    return { itens: VISOES_EXPORTAVEIS };
  }

  /** A conferência na hora, enquanto o pacote é montado na tela: as mesmas regras da gravação, nada gravado. */
  @Post('conferencia')
  @HttpCode(200)
  @Permissao(P.parceiroEditar)
  @AuditadoNoHandler('Não muda estado: confere o pacote contra a regra e o catálogo (nada grava)')
  conferir(@Body() corpo: unknown) {
    const x = esquemaPacote.safeParse(corpo);
    if (!x.success)
      return {
        erros: x.error.issues.map((i) => ({
          campo: i.path.join('.'),
          codigo: 'formato-invalido',
          mensagem: i.message,
        })),
      };
    return {
      erros: [...validarPacote(x.data, x.data.campos), ...conferirPacoteNoCatalogo(x.data, x.data.campos)],
    };
  }

  @Get('entregas/:id/arquivo')
  @Permissao(P.parceiroEditar)
  async arquivo(
    @Req() req: RequisicaoAutorizada,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Resposta,
  ): Promise<Buffer> {
    const porta = this.pacotes;
    const arquivos = this.arquivos;
    const trilha = this.trilha;
    if (!porta || !arquivos || !trilha)
      throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    try {
      const x = await baixarArquivoDaEntrega(
        { porta, arquivos, trilha },
        {
          porta: s.porta as ContextoComunicacao,
          estabelecimento: s.porta.estabelecimento,
          rede: s.rede,
          hospital: s.hospital,
          login: s.login,
          estacao: estacaoDaRequisicao(req).slice(0, 80),
          correlacao: correlacaoDaRequisicao(req, `pacote-entrega-${id}`).slice(0, 64),
        },
        id,
      );
      res.setHeader('Content-Type', x.tipoMime);
      res.setHeader('Content-Disposition', `attachment; filename="${x.nome}"`);
      res.setHeader('X-Conteudo-Sha256', x.hash);
      return x.conteudo;
    } catch (e: unknown) {
      throw problemaDoCadastro(e);
    }
  }
}
