// Descrição cirúrgica assinada e intercorrências do ato (04-CC linha 96; F3.4, fatia F3.4-4):
//   GET  /api/cirurgia/realizadas/:ato/descricao              o ato, a equipe, as descrições (achados e adendos), as
//                                                             intercorrências e os catálogos (leitura de prontuário)
//   POST /api/cirurgia/realizadas/:ato/descricao              cirurgia.salvarDescricao (salvar ou salvar e assinar;
//                                                             assinar exige { senha })
//   POST /api/cirurgia/descricoes/:id/adendos                 cirurgia.adendoDescricao (só na assinada, pelo autor;
//                                                             exige { senha })
//   POST /api/cirurgia/realizadas/:ato/intercorrencias        cirurgia.registrarIntercorrencia
//   GET  /api/cirurgia/pacientes/:paciente/descricoes         as descrições do paciente (visão por paciente)
// Ligado para todos: o que controla é o nível de acesso do cargo (cirurgia.registro.ler e cirurgia.registro.criar);
// a autoria (só o cirurgião ou o auxiliar médico da equipe viva do ato descreve; só o autor assina e inclui adendo) é
// regra do domínio. Assinar e incluir adendo são gestos sobre documento do prontuário: pedem a senha de novo
// (reautenticação com CSRF, como a assinatura da ficha anestésica); sem senha ou com a senha errada, nada é gravado.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import { contextoOperacao, idDaRota, sessaoDe } from '../cadastro/comum.js';
import {
  type DescricaoDoPaciente,
  PORTA_DESCRICAO_CIRURGICA,
  type PortaDescricaoCirurgica,
  type TelaDescricaoCirurgica,
} from './descricao-cirurgica-porta.js';

interface Resultado {
  readonly ok: true;
  readonly resultado: Record<string, unknown>;
  readonly repetida: boolean;
  readonly mensagem: string;
}

@Controller('cirurgia')
export class DescricaoCirurgicaController {
  constructor(
    @Inject(PORTA_DESCRICAO_CIRURGICA) private readonly porta: PortaDescricaoCirurgica,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
  ) {}

  /** A senha conferida de novo antes de assinar ou incluir adendo; sem resolvedor de sessão, recusa (falha fechada). */
  private async confirmarSenha(req: RequisicaoAutorizada, b: unknown): Promise<void> {
    const senha = (b as { senha?: unknown } | null)?.senha;
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário e confirme a senha.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, typeof senha === 'string' ? senha : undefined);
  }

  /** O corpo sem a senha (ela nunca segue para a operação, a trilha nem o registro de idempotência). */
  private static semSenha(b: unknown): Record<string, unknown> {
    const resto = { ...((b ?? {}) as Record<string, unknown>) };
    delete resto['senha'];
    return resto;
  }

  private async gravar(
    req: RequisicaoAutorizada,
    op: string,
    entrada: unknown,
    mensagem: string,
  ): Promise<Resultado> {
    const s = sessaoDe(req);
    const r = await this.porta.executar(s.porta, op, entrada, contextoOperacao(s, op));
    return { ok: true, resultado: r.resultado as Record<string, unknown>, repetida: r.repetida, mensagem };
  }

  @Get('realizadas/:ato/descricao')
  @Permissao('cirurgia.registro.ler')
  @Auditar('cirurgia.agenda.lida')
  async tela(@Param('ato') ato: string, @Req() req: RequisicaoAutorizada): Promise<TelaDescricaoCirurgica> {
    const t = await this.porta.tela(sessaoDe(req).porta, idDaRota(ato));
    if (!t)
      throw new ErroProblema('nao-encontrado', 404, 'Cirurgia não encontrada', 'O ato cirúrgico não existe.');
    return t;
  }

  @Post('realizadas/:ato/descricao')
  @HttpCode(200)
  @Permissao('cirurgia.registro.criar')
  @AuditadoNoHandler('cirurgia.salvarDescricao pelo executor (trilha na mesma transação)')
  async salvar(
    @Param('ato') ato: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Resultado> {
    const e = { ...DescricaoCirurgicaController.semSenha(b), ato: idDaRota(ato) };
    const assinar = (b as { assinar?: unknown } | null)?.assinar === true;
    if (assinar) await this.confirmarSenha(req, b);
    return this.gravar(
      req,
      'cirurgia.salvarDescricao',
      e,
      assinar ? 'Descrição assinada.' : 'Rascunho salvo.',
    );
  }

  @Post('descricoes/:id/adendos')
  @HttpCode(201)
  @Permissao('cirurgia.registro.criar')
  @AuditadoNoHandler('cirurgia.adendoDescricao pelo executor (trilha na mesma transação)')
  async adendo(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Resultado> {
    await this.confirmarSenha(req, b);
    return this.gravar(
      req,
      'cirurgia.adendoDescricao',
      { ...DescricaoCirurgicaController.semSenha(b), descricao: idDaRota(id) },
      'Adendo registrado.',
    );
  }

  @Post('realizadas/:ato/intercorrencias')
  @HttpCode(201)
  @Permissao('cirurgia.registro.criar')
  @AuditadoNoHandler('cirurgia.registrarIntercorrencia pelo executor (trilha na mesma transação)')
  intercorrencia(
    @Param('ato') ato: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Resultado> {
    return this.gravar(
      req,
      'cirurgia.registrarIntercorrencia',
      { ...(b as object), ato: idDaRota(ato) },
      'Intercorrência registrada.',
    );
  }

  @Get('pacientes/:paciente/descricoes')
  @Permissao('cirurgia.registro.ler')
  @Auditar('cirurgia.agenda.lida')
  doPaciente(
    @Param('paciente') paciente: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<DescricaoDoPaciente[]> {
    return this.porta.doPaciente(sessaoDe(req).porta, idDaRota(paciente));
  }
}
