// Vínculo da conta ao estabelecimento (01-ADM L59), sob /api/administracao/acesso:
//   POST /api/administracao/acesso/usuarios/:login/vinculo            acesso.vincularEstabelecimentoUsuario
//   POST /api/administracao/acesso/usuarios/:login/vinculo/encerrar   acesso.encerrarVinculoUsuario
// Dar acesso a este estabelecimento a uma conta que já existe no cliente (a pessoa tem uma conta só) e encerrar esse
// acesso. Toda gravação passa pelo Executor (trilha na mesma transação), exige a senha de novo (SBIS-07) e respeita
// a segregação: ninguém muda o próprio vínculo, e o Auditor só consulta. Encerrar derruba as sessões da conta neste
// estabelecimento, e o último gestor de acessos não perde o vínculo.
import { Body, Controller, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { esquemaLogin, PERMISSOES_M10_CODIGOS, type ResultadoUsuario } from '@sgh/contratos';
import { type AcaoGestao, conferirGestao, mensagemRecusaGestao } from '@sgh/dominio-acesso';
import { z } from 'zod';
import { AuditadoNoHandler, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { FONTE_GESTAO } from '../acesso/gestao-fonte.js';
import { SERVICO_SANEAMENTO } from '../acesso/saneamento/saneamento.controller.js';
import { ErroSaneamento, type ServicoSaneamento } from '../acesso/saneamento/servico.js';
import { exigirGestorRestante, type LeitorGestores } from '../acesso/ultimo-gestor.js';
import { analisar, contextoOperacao, problema, reautenticado, sessaoDe } from './comum.js';
import { FONTE_ADMINISTRACAO, type FonteAdministracao } from './fonte.js';

const C = PERMISSOES_M10_CODIGOS;

// Sem a senha: 401 na reautenticação (regra 8), não 400.
const esquemaVincular = z
  .object({ grupo: z.string().trim().min(1).max(60), senha: z.string().max(200).optional() })
  .strict();
const esquemaEncerrar = z.object({ senha: z.string().max(200).optional() }).strict();

@Controller('administracao/acesso')
export class UsuariosVinculoController {
  constructor(
    @Inject(FONTE_ADMINISTRACAO) private readonly fonte: FonteAdministracao,
    @Inject(SERVICO_SESSAO) private readonly servico: ServicoSessao | null,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    /** O limite de administradores do estabelecimento também vale para quem chega pelo vínculo. */
    @Optional() @Inject(SERVICO_SANEAMENTO) private readonly saneamento: ServicoSaneamento | null = null,
    /** Os gestores de acessos ativos, para a regra do último gestor. */
    @Optional() @Inject(FONTE_GESTAO) private readonly gestores: LeitorGestores | null = null,
  ) {}

  private login(bruto: string): string {
    const r = esquemaLogin.safeParse(bruto);
    if (!r.success) throw new ErroProblema('entrada-invalida', 400, 'Login inválido');
    return r.data;
  }

  /** Segregação antes de abrir transação: a si mesmo e o Auditor que só consulta. */
  private segregacao(req: RequisicaoAutorizada, acao: AcaoGestao, alvo: string): void {
    const s = sessaoDe(req);
    const r = conferirGestao({ login: s.login, perfis: s.perfis }, acao, alvo);
    if (r)
      throw new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagemRecusaGestao(r, acao), {
        codigo: r,
      });
  }

  private async gravar(
    req: RequisicaoAutorizada,
    operacao: string,
    entrada: unknown,
    senha: string | undefined,
  ): Promise<Record<string, unknown>> {
    const reaut = await reautenticado(this.servico, this.resolvedor, req, senha);
    return this.fonte
      .executar(operacao, entrada, contextoOperacao(req, 'acesso-usuarios', reaut))
      .catch((e: unknown) => problema(e));
  }

  @Post('usuarios/:login/vinculo')
  @HttpCode(200)
  @Permissao(C.usuarioCriar)
  @AuditadoNoHandler('executor: trilha de auditoria (alteração de acesso) na mesma transação da receita')
  async vincular(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoUsuario> {
    const login = this.login(bruto);
    const p = analisar(esquemaVincular, corpo);
    this.segregacao(req, 'alterar-escopo', login);
    const s = sessaoDe(req);
    if (this.saneamento)
      await this.saneamento
        .conferirEntradaNoMaster({ rede: s.rede, hospital: s.hospital }, login, p.grupo)
        .catch((e: unknown) => {
          if (e instanceof ErroSaneamento)
            throw new ErroProblema('recusa-de-negocio', e.status, 'Não foi possível concluir', e.detalhe, {
              codigo: e.codigo,
            });
          throw new ErroProblema(
            'indisponivel',
            503,
            'Não foi possível conferir o limite de administradores; tente de novo.',
          );
        });
    const operacao = 'acesso.vincularEstabelecimentoUsuario';
    await this.gravar(req, operacao, { login, grupo: p.grupo }, p.senha);
    await this.servico?.servicoAutorizacao?.invalidar(s.rede, s.hospital, login);
    return { operacao, destino: this.fonte.destino };
  }

  @Post('usuarios/:login/vinculo/encerrar')
  @HttpCode(200)
  @Permissao(C.usuarioEditar)
  @AuditadoNoHandler('executor: trilha de auditoria (alteração de acesso) na mesma transação da receita')
  async encerrar(
    @Param('login') bruto: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoUsuario> {
    const login = this.login(bruto);
    const p = analisar(esquemaEncerrar, corpo);
    this.segregacao(req, 'alterar-escopo', login);
    const s = sessaoDe(req);
    await exigirGestorRestante(this.gestores, s.rede, s.hospital, { tipo: 'bloquear', login });
    const operacao = 'acesso.encerrarVinculoUsuario';
    await this.gravar(req, operacao, { login }, p.senha);
    // Depois do commit: as sessões da conta neste estabelecimento caem e a autorização em cache é descartada.
    await this.servico?.revogarSessoesDoUsuario(s.rede, s.hospital, login);
    await this.servico?.servicoAutorizacao?.invalidar(s.rede, s.hospital, login);
    return { operacao, destino: this.fonte.destino, sessoesEncerradas: 1 };
  }
}
