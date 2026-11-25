// Envio mensal dos indicadores de infecção e de resistência ao órgão sanitário (F7, 09-AREA linha 68). Rotas:
//   GET  /api/qualidade/ccih/notificacao                         as competências fechadas com os envios, o prazo e o atraso
//   GET  /api/qualidade/ccih/notificacao/:id/envios              os envios de uma competência
//   POST /api/qualidade/ccih/notificacao/:id/envios              registra o envio do formulário (inicial ou retificação)
//   POST /api/qualidade/ccih/notificacao/envios/:id/andamento    registra o andamento (transmitido, aceito, rejeitado)
// A gravação é do Executor (trilha, outbox e idempotência na mesma transação); a leitura é auditada
// (`qualidade.ccih.lida`). A permissão é a da ficha de IRAS (ler e registrar), do perfil da comissão.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import { FORMULARIOS_IRAS, SITUACOES_ENVIO_IRAS } from '@sgh/dominio-qualidade';
import { EVENTOS_AUDITAVEIS, PERMISSOES_CCIH as P } from '@sgh/contratos';
import { z } from 'zod';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import { sessaoComAto } from '../enfermagem/gravacao-direta.js';
import { corpo, type TrilhaDaGravacao } from '../exames/public-api.js';
import type { PortaNotificacaoIrasPropria } from './porta-notificacao-iras-propria.js';

export const PORTA_NOTIFICACAO_IRAS = Symbol('PORTA_NOTIFICACAO_IRAS');
const E = EVENTOS_AUDITAVEIS;
const DATA = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/;

const esquemaEnvio = z.object({
  formulario: z.enum(FORMULARIOS_IRAS),
  situacao: z.enum(['pendente', 'transcrita']),
  enviadoEm: z.string().regex(DATA).nullable().default(null),
  protocolo: z.string().trim().max(40).nullable().default(null),
  motivoRetificacao: z.string().trim().max(1000).nullable().default(null),
});
const esquemaAndamento = z.object({
  versao: z.number().int().positive(),
  situacao: z.enum(SITUACOES_ENVIO_IRAS),
  enviadoEm: z.string().regex(DATA).nullable().default(null),
  protocolo: z.string().trim().max(40).nullable().default(null),
  mensagemRetorno: z.string().trim().max(1000).nullable().default(null),
});

const indisponivel = () =>
  new ErroProblema(
    'indisponivel',
    503,
    'Notificação de IRAS',
    'O envio da notificação precisa do banco do cliente configurado.',
  );

@Controller('qualidade/ccih/notificacao')
export class NotificacaoIrasController {
  constructor(
    @Optional()
    @Inject(PORTA_NOTIFICACAO_IRAS)
    private readonly porta: PortaNotificacaoIrasPropria | null = null,
  ) {}

  private p(): PortaNotificacaoIrasPropria {
    if (!this.porta) throw indisponivel();
    return this.porta;
  }

  private trilha(s: SessaoCadastro, id: number, evento: string): TrilhaDaGravacao {
    return {
      estabelecimento: null,
      usuario: null,
      acao: 'operacao',
      entidade: 'notificacao_iras_envio',
      entidadeId: id,
      dadosDepois: { evento },
      correlacao: s.porta.correlacao,
    };
  }

  @Get()
  @Permissao(P.irasLer)
  @Auditar(E.qualidadeCcihLida.codigo)
  competencias(@Req() req: RequisicaoAutorizada) {
    return this.p().competencias(sessaoDe(req).porta);
  }

  @Get(':id/envios')
  @Permissao(P.irasLer)
  @Auditar(E.qualidadeCcihLida.codigo)
  envios(@Param('id') id: string, @Req() req: RequisicaoAutorizada) {
    return this.p().envios(sessaoDe(req).porta, idDaRota(id));
  }

  @Post(':id/envios')
  @HttpCode(201)
  @Permissao(P.irasRegistrar)
  @AuditadoNoHandler(
    'qualidade.ccih.notificacao-iras: notificacao_iras_envio (e a competência enviada) com a trilha_auditoria na mesma transação',
  )
  registrar(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const competencia = idDaRota(id);
    const e = corpo(esquemaEnvio, b);
    const s = sessaoComAto(sessaoDe(req), { competencia, ...e });
    return this.p().registrar(s.porta, s.login, competencia, e, (r) =>
      this.trilha(s, r.id, 'envio-registrado'),
    );
  }

  @Post('envios/:id/andamento')
  @Permissao(P.irasRegistrar)
  @AuditadoNoHandler(
    'qualidade.ccih.notificacao-iras (andamento): notificacao_iras_envio com a versão conferida e a anterior na trilha_auditoria',
  )
  andamento(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    const envio = idDaRota(id);
    const { versao, ...a } = corpo(esquemaAndamento, b);
    const s = sessaoComAto(sessaoDe(req), { envio, versao, ...a });
    return this.p().andamento(s.porta, s.login, envio, versao, a, (r) =>
      this.trilha(s, r.id, 'envio-andamento'),
    );
  }
}
