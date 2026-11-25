// Rotas dos perfis de marcação (02-AGE linha 46). Ler: quem lê a agenda. Manter (perfil, recortes e usuários): a
// permissão de manutenção da agenda (agenda.cobertura.editar), como a lista nominal. Sem banco próprio, 503: os
// perfis são do banco do cliente.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { corpo } from './agendas.controller.js';
import { contextoGravacao } from './apoio.js';
import {
  esquemaSalvarPerfil,
  esquemaUsuarioPerfil,
  type OpcoesRecorte,
  type PerfilLido,
  type PerfisMarcacaoPropria,
} from './perfil-marcacao.js';

export const PERFIS_MARCACAO = Symbol('PERFIS_MARCACAO');

@Controller('agenda/perfis-marcacao')
export class PerfisMarcacaoController {
  constructor(
    @Optional() @Inject(PERFIS_MARCACAO) private readonly perfis: PerfisMarcacaoPropria | null = null,
  ) {}

  private exigirBanco(): PerfisMarcacaoPropria {
    if (!this.perfis)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'Os perfis de marcação ficam no banco do estabelecimento, que não está configurado.',
      );
    return this.perfis;
  }

  private gravacao(s: SessaoCadastro, rotulo: string) {
    const g = contextoGravacao(s, rotulo, true);
    return {
      hospital: s.hospital,
      login: s.login,
      correlacao: g.correlacao,
      chaveIdempotencia: g.chaveIdempotencia,
      ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
    };
  }

  @Get()
  @Permissao('agenda.agenda.ler')
  listar(@Req() req: RequisicaoAutorizada): Promise<PerfilLido[]> {
    const s = sessaoDe(req);
    return this.exigirBanco().listar({ hospital: s.hospital, login: s.login });
  }

  @Get('opcoes')
  @Permissao('agenda.cobertura.editar')
  opcoes(@Req() req: RequisicaoAutorizada): Promise<OpcoesRecorte> {
    const s = sessaoDe(req);
    return this.exigirBanco().opcoes({ hospital: s.hospital, login: s.login });
  }

  @Post()
  @HttpCode(200)
  @Permissao('agenda.cobertura.editar')
  @AuditadoNoHandler('agenda.perfil_marcacao_salvar pelo executor (trilha na mesma transação)')
  async incluir(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSalvarPerfil, { ...(b as object), id: undefined });
    const r = await this.exigirBanco().salvar(this.gravacao(sessaoDe(req), 'agenda.perfilMarcacao'), e);
    return { ok: true, ...r, mensagem: 'Perfil de marcação criado.' };
  }

  @Post(':id')
  @HttpCode(200)
  @Permissao('agenda.cobertura.editar')
  @AuditadoNoHandler('agenda.perfil_marcacao_salvar pelo executor (trilha na mesma transação)')
  async alterar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaSalvarPerfil, { ...(b as object), id: idDaRota(id) });
    const r = await this.exigirBanco().salvar(this.gravacao(sessaoDe(req), 'agenda.perfilMarcacao'), e);
    return { ok: true, ...r, mensagem: 'Perfil de marcação gravado.' };
  }

  @Post(':id/usuarios')
  @HttpCode(200)
  @Permissao('agenda.cobertura.editar')
  @AuditadoNoHandler('agenda.perfil_marcacao_usuario pelo executor (trilha na mesma transação)')
  async usuario(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const e = corpo(esquemaUsuarioPerfil, { ...(b as object), perfil: idDaRota(id) });
    const r = await this.exigirBanco().definirUsuario(
      this.gravacao(sessaoDe(req), 'agenda.perfilMarcacaoUsuario'),
      e,
    );
    return {
      ok: true,
      ...r,
      mensagem: e.acao === 'incluir' ? 'Usuário no perfil.' : 'Usuário retirado do perfil.',
    };
  }
}
