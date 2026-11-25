// Catálogo das visões exportáveis e o arquivo de cada entrega aos parceiros (F3.9, linha 08-INTG L134):
//   GET  /api/integracoes/pacotes/visoes                 a lista branca (visões, campos, sensível, identificador)
//   POST /api/integracoes/pacotes/conferencia            confere o pacote na hora (regra e catálogo), sem gravar
//   GET  /api/integracoes/pacotes/entregas/:id/arquivo    baixa o arquivo guardado da entrega (porta de arquivos)
// O arquivo serve ao operador dos meios sem envio automático (SFTP, arquivo seguro, e-mail seguro): ele baixa,
// envia e marca a situação da entrega. O conteúdo vem conferido pelo hash; sem banco próprio, 503.
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
import { PERMISSOES_M34_CODIGOS as P } from '@sgh/contratos';
import { conferirPacoteNoCatalogo, validarPacote, VISOES_EXPORTAVEIS } from '@sgh/dominio-integracao';
import type { ArmazemArquivos } from '@sgh/nucleo';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
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

@Controller('integracoes/pacotes')
export class PacotesVisoesController {
  constructor(
    @Optional()
    @Inject(PORTA_PACOTES_PARCEIRO)
    private readonly pacotes: PortaPacotesParceiroPropria | null = null,
    @Optional()
    @Inject(ARMAZEM_PACOTES_PARCEIRO)
    private readonly arquivos: ArmazemPacotesParceiro | null = null,
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
    if (!porta || !arquivos)
      throw new ErroProblema('indisponivel', 503, 'Recurso sem banco próprio neste ambiente');
    const s = sessaoDe(req);
    const c = s.porta as ContextoComunicacao;
    try {
      const { arquivoId } = await porta.arquivoDaEntrega(c, id);
      const lido = await arquivos.armazem.ler(
        { cliente: arquivos.cliente, estabelecimento: null, correlacao: `pacote-entrega-${id}` } as never,
        arquivoId,
      );
      const nome = lido.metadado.nomeOriginal.replace(/[^A-Za-z0-9_.-]/g, '-');
      res.setHeader('Content-Type', lido.metadado.tipoMime);
      res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
      res.setHeader('X-Conteudo-Sha256', lido.metadado.hash);
      return lido.conteudo;
    } catch (e: unknown) {
      throw problemaDoCadastro(e);
    }
  }
}
