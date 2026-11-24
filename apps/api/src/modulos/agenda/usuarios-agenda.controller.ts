// Rotas da lista nominal de usuários por agenda (02-AGE linha 40). Ler a lista: quem lê a agenda (e a vê). Manter:
// a permissão de manutenção da agenda (agenda.cobertura.editar), no escopo (unidade e tipo) da sessão. Sem banco
// próprio (memória/indisponível), 503: a lista é do banco do cliente.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, sessaoDe, type SessaoCadastro } from '../cadastro/comum.js';
import { contextoGravacao, ctxAgenda } from './apoio.js';
import { corpo } from './agendas.controller.js';
import { PORTA_AGENDA, type PortaAgenda } from './porta.js';
import { ServicoAgenda } from './servico.js';
import {
  esquemaDefinirUsuarioAgenda,
  type ListaUsuariosAgenda,
  type UsuariosAgendaPropria,
} from './usuarios-agenda.js';

export const USUARIOS_AGENDA = Symbol('USUARIOS_AGENDA');

const MENSAGEM: Record<string, string> = {
  incluir: 'Usuário incluído na lista da agenda.',
  alterar: 'Acesso do usuário na agenda alterado.',
  remover: 'Usuário retirado da lista da agenda.',
  liberarTodos: 'Agenda liberada para todos do escopo.',
};

@Controller('agenda/consultas')
export class UsuariosAgendaController {
  private readonly servico: ServicoAgenda;
  constructor(
    @Inject(PORTA_AGENDA) porta: PortaAgenda,
    @Optional() @Inject(USUARIOS_AGENDA) private readonly usuarios: UsuariosAgendaPropria | null = null,
  ) {
    this.servico = new ServicoAgenda(porta);
  }

  private exigirBanco(): UsuariosAgendaPropria {
    if (!this.usuarios)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Banco do estabelecimento indisponível',
        'A lista de usuários da agenda fica no banco do estabelecimento, que não está configurado.',
      );
    return this.usuarios;
  }

  private ctx(s: SessaoCadastro) {
    return {
      hospital: s.hospital,
      login: s.login,
      gestor: s.pode('agenda.cobertura.editar'),
      administrador: s.req.sgh?.sessao.usuario.ator === 'plataforma',
    };
  }

  @Get('agendas/:id/usuarios')
  @Permissao('agenda.agenda.ler')
  async lista(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ListaUsuariosAgenda> {
    const s = sessaoDe(req);
    const agenda = idDaRota(id);
    await this.servico.exigirAgenda(ctxAgenda(s), agenda);
    const l = await this.exigirBanco().lista(this.ctx(s), agenda);
    if (!l) throw new ErroProblema('nao-encontrado', 404, 'Agenda não encontrada');
    return l;
  }

  @Get('usuarios-candidatos')
  @Permissao('agenda.cobertura.editar')
  candidatos(@Query('termo') termo: string | undefined) {
    const t = (termo ?? '').trim();
    if (t.length < 2) return Promise.resolve([]);
    return this.exigirBanco().candidatos(t);
  }

  @Post('agendas/:id/usuarios')
  @HttpCode(200)
  @Permissao('agenda.cobertura.editar')
  @AuditadoNoHandler('agenda.definir_usuarios pelo executor (trilha na mesma transação)')
  async definir(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = corpo(esquemaDefinirUsuarioAgenda, { ...(b as object), agenda: idDaRota(id) });
    await this.servico.exigirAgenda(ctxAgenda(s), e.agenda);
    const g = contextoGravacao(s, 'agenda.definirUsuarios', true);
    const r = await this.exigirBanco().definir(
      {
        ...this.ctx(s),
        correlacao: g.correlacao,
        chaveIdempotencia: g.chaveIdempotencia,
        ...(g.enderecoIp ? { enderecoIp: g.enderecoIp } : {}),
      },
      e,
    );
    return { ok: true, resultado: r.resultado, repetida: r.repetida, mensagem: MENSAGEM[e.acao] };
  }
}
