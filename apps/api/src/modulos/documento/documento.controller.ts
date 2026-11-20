// Spike de documentos e etiquetas (M09, ficha campo 7). Rotas:
// - POST /api/documento/emissoes (documento.emissao.criar; recusado em produção): documento de prova;
// - POST /api/documento/emissoes/:id/segunda-via (documento.emissao.reemitir): nova via marcada, com motivo;
// - GET /api/publico/documentos/:qr/validacao (pública, revisada: só existência, data, estabelecimento e hash);
// - POST /api/documento/impressoes (documento.etiqueta.imprimir; Idempotency-Key): ZPL de prova na fila zpl;
// - POST /api/documento/impressoes/assinatura: assina a mensagem que o QZ Tray pede (SHA512withRSA);
// - GET /api/documento/impressoes/certificado: certificado público do QZ Tray (setCertificatePromise), lido de
//   QZ_CERTIFICADO_ARQUIVO; sem o arquivo, 503 (o certificado e a chave da Rede vêm no deploy, DP-15).
// Login (M05) e mapa de permissões (M06) ainda não existem: até lá, só em AMBIENTE=dev (a validação pública
// responde em qualquer ambiente). Massa sintética: nenhum dado do legado entra no documento de prova.
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { EVENTOS_AUDITAVEIS, marcaSuporteTecnico } from '@sgh/contratos';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import {
  assinarMensagemQz,
  enfileirarZpl,
  ErroEmissao,
  ErroZpl,
  zplEtiquetaAmostra,
  zplPulseira,
} from '@sgh/dominio-documento';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { Auditar, Permissao, Publica } from '../../autorizacao/decoradores.js';
import { FONTE_DOCUMENTO, type FonteDocumento } from './fonte.js';

const CAMPOS_PROVA = [
  { rotulo: 'Paciente', valor: 'Paciente Fictício de Teste' },
  { rotulo: 'Prontuário', valor: '000000' },
  { rotulo: 'Documento', valor: 'Prova de PDF/A-2b: ação, coração, Ü, € (CP1252)' },
];

@Controller()
export class DocumentoController {
  constructor(
    @Inject(CONFIGURACAO) private readonly cfg: Configuracao,
    @Inject(FONTE_DOCUMENTO) private readonly fonte: FonteDocumento,
  ) {}

  private exigirDev(): void {
    if (this.cfg.ambiente !== 'dev') throw new NotFoundException();
  }

  private rede(): string {
    return this.cfg.rede ?? 'rede-padrao';
  }

  /** ADR 0021 (R1): emitido numa sessão "como", o documento leva a marca do suporte técnico. */
  private marca(req: RequisicaoAutorizada | undefined): string | null {
    return req?.sghComo ? marcaSuporteTecnico(req.sghComo.alvoNome) : null;
  }

  /** documento.emissao.criar */
  @Auditar(EVENTOS_AUDITAVEIS.documentoEmitido.codigo)
  @Post('documento/emissoes')
  @Permissao('documento.emissao.criar')
  async emitir(@Body() corpo: { estabelecimento?: string } | undefined, @Req() req?: RequisicaoAutorizada) {
    this.exigirDev();
    try {
      const r = await this.fonte.emissao.emitir({
        rede: this.rede(),
        estabelecimento: corpo?.estabelecimento ?? 'pc',
        modelo: 'prova',
        versaoModelo: '1',
        titulo: 'Documento de prova',
        origem: { tipo: 'sintetico', idLegado: 1 },
        campos: CAMPOS_PROVA,
        autor: 'SESSAO_SINTETICA',
        marcaSuporte: this.marca(req),
      });
      return {
        id: r.emissao.id,
        via: r.emissao.via,
        sha256: r.emissao.sha256,
        qr: r.emissao.identificadorQr,
      };
    } catch (e) {
      if (e instanceof ErroEmissao) throw new BadRequestException(e.message);
      throw e;
    }
  }

  /** documento.emissao.reemitir */
  @Auditar(EVENTOS_AUDITAVEIS.documentoReemitido.codigo)
  @Post('documento/emissoes/:id/segunda-via')
  @Permissao('documento.emissao.reemitir')
  async segundaVia(
    @Param('id') id: string,
    @Body() corpo: { motivo?: string } | undefined,
    @Req() req?: RequisicaoAutorizada,
  ) {
    this.exigirDev();
    try {
      const r = await this.fonte.emissao.segundaVia(id, corpo?.motivo ?? '', {
        titulo: 'Documento de prova',
        campos: CAMPOS_PROVA,
        autor: 'SESSAO_SINTETICA',
        marcaSuporte: this.marca(req),
      });
      return {
        id: r.emissao.id,
        via: r.emissao.via,
        sha256: r.emissao.sha256,
        qr: r.emissao.identificadorQr,
      };
    } catch (e) {
      if (e instanceof ErroEmissao) throw new BadRequestException(e.message);
      throw e;
    }
  }

  /** Pública (revisada no M09): nada de conteúdo, origem nem autor. */
  @Get('publico/documentos/:qr/validacao')
  @Publica('validação pública do documento pelo QR (só existência, data, estabelecimento e hash; M09)')
  validar(@Param('qr') qr: string) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(qr)) throw new NotFoundException();
    return this.fonte.emissao.validar(qr);
  }

  /** documento.etiqueta.imprimir */
  @Auditar(EVENTOS_AUDITAVEIS.documentoImpresso.codigo)
  @Post('documento/impressoes')
  @Permissao('documento.etiqueta.imprimir')
  @HttpCode(202)
  async imprimir(
    @Headers('idempotency-key') chave: string | undefined,
    @Body() corpo: { modelo?: string; estabelecimento?: string; estacao?: string } | undefined,
  ) {
    this.exigirDev();
    if (!chave) throw new BadRequestException('Idempotency-Key obrigatório.');
    const p = {
      nomeCompleto: 'Paciente Ficticio de Teste',
      nascimento: '1980-05-17',
      idPaciente: 900001,
      prontuario: 123456,
      atendimento: 7654321,
    };
    try {
      const modelo = corpo?.modelo === 'etiqueta-amostra' ? 'etiqueta-amostra' : 'pulseira';
      const zpl =
        modelo === 'pulseira'
          ? zplPulseira(p)
          : zplEtiquetaAmostra({ ...p, amostra: 'AM-0000001', exame: 'Exame de teste' });
      const r = await enfileirarZpl(
        {
          chaveIdempotencia: chave,
          rede: this.rede(),
          estabelecimento: corpo?.estabelecimento ?? 'pc',
          estacao: corpo?.estacao ?? 'estacao-dev',
          modelo,
          zpl,
        },
        this.fonte.armazem,
        this.fonte.destino,
        this.fonte.novoId,
      );
      return { ...r, zpl };
    } catch (e) {
      if (e instanceof ErroZpl || (e instanceof Error && /Idempotency-Key/.test(e.message)))
        throw new BadRequestException(e.message);
      throw e;
    }
  }

  /** Certificado público do QZ Tray: a estação confere com ele a assinatura das mensagens. */
  @Get('documento/impressoes/certificado')
  @Permissao('documento.etiqueta.imprimir')
  certificado() {
    this.exigirDev();
    const pem = this.fonte.certificadoQz();
    if (!pem)
      throw new ServiceUnavailableException(
        'Certificado do QZ Tray não configurado (QZ_CERTIFICADO_ARQUIVO, com QZ_CHAVE_PRIVADA_ARQUIVO).',
      );
    return { certificado: pem };
  }

  /** Assinatura pedida pelo QZ Tray (setSignaturePromise): só o texto, nunca a chave. */
  @Auditar(EVENTOS_AUDITAVEIS.documentoAssinado.codigo)
  @Post('documento/impressoes/assinatura')
  @Permissao('documento.etiqueta.imprimir')
  @HttpCode(200)
  async assinar(@Body() corpo: { paraAssinar?: string } | undefined) {
    this.exigirDev();
    const texto = corpo?.paraAssinar ?? '';
    if (!texto || texto.length > 10_000)
      throw new BadRequestException('Mensagem do QZ Tray ausente ou grande demais.');
    return { assinatura: await assinarMensagemQz(texto, await this.fonte.chaveQz()), algoritmo: 'SHA512' };
  }
}
