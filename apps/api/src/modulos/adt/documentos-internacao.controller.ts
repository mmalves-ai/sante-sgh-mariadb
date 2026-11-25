// F3.4 (04-INT linha 69): configuração e escolha dos documentos da internação pela regra de convênio, especialidade e
// modalidade.
//   GET  /api/documentos-internacao                         modelos e regras do estabelecimento
//   GET  /api/documentos-internacao/internacao/:reg?momento  os documentos que saem para a internação
//   POST /api/documentos-internacao/modelos                  inclui ou altera o modelo (versão conferida)
//   POST /api/documentos-internacao/regras                   inclui ou altera a regra (versão conferida)
// Ler e emitir: quem emite os impressos; configurar: quem edita os parâmetros do estabelecimento.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { MOMENTOS_DOCUMENTO_INTERNACAO, type MomentoDocumentoInternacao } from '@sgh/dominio-internacao';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe } from '../cadastro/comum.js';
import { corpo } from '../exames/public-api.js';
import { ctxAdt } from './apoios.js';
import {
  esquemaModeloDocumento,
  esquemaRegraDocumento,
  PortaDocumentosInternacao,
} from './documentos-internacao.js';

export const DOCUMENTOS_INTERNACAO = Symbol('DOCUMENTOS_INTERNACAO');

/** Só a sessão da administração da plataforma mexe no modelo comum a todos os estabelecimentos. */
const modeloComum = (req: RequisicaoAutorizada) => req.sgh?.sessao.usuario.ator === 'plataforma';

@Controller('documentos-internacao')
export class DocumentosInternacaoController {
  constructor(
    @Optional()
    @Inject(DOCUMENTOS_INTERNACAO)
    private readonly porta: PortaDocumentosInternacao | null = null,
  ) {}

  private p(): PortaDocumentosInternacao {
    if (!this.porta)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Documentos indisponíveis',
        'A configuração dos documentos da internação precisa do banco do cliente.',
      );
    return this.porta;
  }

  @Get()
  @Permissao('internacao.impresso.emitir')
  async listar(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    // A tela esconde a edição de quem não configura e o "todos os estabelecimentos" de quem não é da plataforma.
    return {
      ...(await this.p().listar(ctxAdt(s))),
      podeEditar: s.pode('config.parametro.editar'),
      podeModeloComum: modeloComum(req),
    };
  }

  @Get('internacao/:reg')
  @Permissao('internacao.impresso.emitir')
  async daInternacao(
    @Param('reg') reg: string,
    @Query('momento') momento: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const m = (momento || 'admissao') as MomentoDocumentoInternacao;
    if (!MOMENTOS_DOCUMENTO_INTERNACAO.includes(m))
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Momento inválido',
        'Escolha admissão, prorrogação, transferência ou alta.',
        {
          campos: ['momento'],
        },
      );
    const docs = await this.p().documentos(ctxAdt(sessaoDe(req)), idDaRota(reg), m);
    if (!docs)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Internação não encontrada',
        'A internação não existe mais.',
      );
    return { momento: m, documentos: docs };
  }

  @Post('modelos')
  @HttpCode(201)
  @Permissao('config.parametro.editar')
  @AuditadoNoHandler('internacao.documento.salvar_modelo pelo executor (trilha na mesma transação)')
  salvarModelo(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.p().salvarModelo(ctxAdt(sessaoDe(req)), corpo(esquemaModeloDocumento, b), modeloComum(req));
  }

  @Post('regras')
  @HttpCode(201)
  @Permissao('config.parametro.editar')
  @AuditadoNoHandler('internacao.documento.salvar_regra pelo executor (trilha na mesma transação)')
  salvarRegra(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.p().salvarRegra(ctxAdt(sessaoDe(req)), corpo(esquemaRegraDocumento, b));
  }
}
