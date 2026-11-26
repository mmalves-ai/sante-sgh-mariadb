// Foto do paciente para a identificação positiva (F3.1, 02-CAD linha 5; fase 1: só a foto facial).
//   GET  /api/cadastros/pacientes/:id/identificacao               foto ativa, histórico e últimas conferências
//   GET  /api/cadastros/pacientes/:id/identificacao/foto          a foto ativa (leitura auditada)
//   POST /api/cadastros/pacientes/:id/identificacao/foto          capta a foto (base64); substitui a anterior
//   POST /api/cadastros/pacientes/:id/identificacao/foto/revogar  revoga a foto ativa, com motivo (nada apagado)
//   POST /api/cadastros/pacientes/:id/identificacao/conferencias  conferência da identidade (recepção, guia...)
// Toda gravação passa pelo executor (trilha na mesma transação). Só no banco do cliente (sem ele, 503).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req, Res } from '@nestjs/common';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, linhaTrilha, problemaDoCadastro, type SessaoCadastro, sessaoDe } from './comum.js';
import {
  FOTO_IDENTIFICACAO,
  type FotoIdentificacaoPropria,
  type IdentificacaoPaciente,
} from './foto-identificacao-propria.js';

const EVENTO = 'cadastro.paciente.gravado';
/** Base64 de até 300 KB (a tela reduz a foto a 480 px em JPEG). */
const BASE64_MAXIMO = 420_000;

type Corpo = Record<string, unknown>;
const corpoDe = (c: unknown): Corpo => (c && typeof c === 'object' && !Array.isArray(c) ? (c as Corpo) : {});
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

@Controller('cadastros')
export class FotoIdentificacaoController {
  constructor(
    @Optional()
    @Inject(FOTO_IDENTIFICACAO)
    private readonly fotos: FotoIdentificacaoPropria | null = null,
  ) {}

  private servico(): FotoIdentificacaoPropria {
    if (!this.fotos)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Indisponível',
        'A foto do paciente precisa do banco do cliente (não há porta em memória).',
      );
    return this.fotos;
  }

  private async rodar<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw problemaDoCadastro(e);
    }
  }

  private trilha(s: SessaoCadastro, op: string, tabela: string, paciente: number) {
    return linhaTrilha(s, EVENTO, 'cadastro.foto-identificacao', op, { tabela, paciente });
  }

  @Get('pacientes/:id/identificacao')
  @Permissao('cadastro.paciente.ler')
  @Auditar('cadastro.paciente.lido')
  async identificacao(
    @Param('id') p: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<IdentificacaoPaciente> {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    req.sghAlvo = { paciente: n, tabelaAlvo: 'identificacao_biometrica', idAlvo: String(n) };
    return this.rodar(() => this.servico().identificacao(s.porta, n));
  }

  @Get('pacientes/:id/identificacao/foto')
  @Permissao('cadastro.paciente.ler')
  @Auditar('cadastro.paciente.lido')
  async foto(
    @Param('id') p: string,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: { header(n: string, v: string): unknown },
  ): Promise<Buffer> {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const f = await this.rodar(() => this.servico().lerFoto(s.porta, n));
    if (!f)
      throw new ErroProblema('nao-encontrado', 404, 'Foto não encontrada', 'O paciente não tem foto ativa.');
    req.sghAlvo = {
      paciente: n,
      tabelaAlvo: 'identificacao_biometrica',
      idAlvo: String(n),
      chaveNaturalAlvo: 'foto:identificacao',
    };
    res.header('content-type', f.tipoMime);
    res.header(
      'content-disposition',
      `inline; filename="foto-${n}.${f.tipoMime === 'image/png' ? 'png' : 'jpg'}"`,
    );
    res.header('x-content-type-options', 'nosniff');
    res.header('cache-control', 'private, no-store');
    return f.conteudo;
  }

  @Post('pacientes/:id/identificacao/foto')
  @HttpCode(201)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async captar(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const base64 = typeof b['conteudo'] === 'string' ? b['conteudo'].replace(/^data:[^,]*,/, '') : '';
    if (!base64 || base64.length > BASE64_MAXIMO || !/^[A-Za-z0-9+/=\s]+$/.test(base64))
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Foto inválida',
        'Envie a foto em JPEG ou PNG, com até 300 KB.',
        {
          codigo: 'foto-invalida',
          campos: ['foto'],
        },
      );
    const id = await this.rodar(() =>
      this.servico().cadastrarFoto(
        s.porta,
        { paciente: n, conteudo: new Uint8Array(Buffer.from(base64, 'base64')) },
        this.trilha(s, 'cadastro.cadastrarFotoIdentificacao', 'identificacao_biometrica', n),
      ),
    );
    return { id };
  }

  @Post('pacientes/:id/identificacao/foto/revogar')
  @HttpCode(200)
  @Permissao('cadastro.paciente.editar')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async revogar(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const id = await this.rodar(() =>
      this.servico().revogarFoto(
        s.porta,
        { paciente: n, motivo: txt(b['motivo']) ?? '' },
        this.trilha(s, 'cadastro.revogarFotoIdentificacao', 'identificacao_biometrica', n),
      ),
    );
    return { id };
  }

  @Post('pacientes/:id/identificacao/conferencias')
  @HttpCode(201)
  @Permissao('cadastro.paciente.ler')
  @AuditadoNoHandler('executor: trilha na mesma transação')
  async conferir(@Param('id') p: string, @Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const n = idDaRota(p);
    const b = corpoDe(corpo);
    const at = b['atendimento'];
    const id = await this.rodar(() =>
      this.servico().conferir(
        s.porta,
        {
          paciente: n,
          resultado: txt(b['resultado']) ?? '',
          contexto: txt(b['contexto']) ?? 'recepcao',
          motivoDispensa: txt(b['motivoDispensa']),
          atendimento: at === null || at === undefined || at === '' ? null : idDaRota(String(at)),
        },
        this.trilha(s, 'cadastro.conferirIdentidadePaciente', 'verificacao_biometrica', n),
      ),
    );
    return { id };
  }
}
