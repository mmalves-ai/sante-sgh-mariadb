// SAME e arquivo (M21; ficha, seções 5 e 7; regra 10): a movimentação física de prontuários e contas pela leitura do
// código de barras da etiqueta (a conta), um lugar por vez, exclusão lógica com motivo, descarte com o aval:
//   GET  /api/same/contas/:codigo           a localização atual e a linha do tempo (auditado: nome do paciente)
//   POST /api/same/movimentos               same.movimentarProntuario (registro, saída, devolução, descarte…)
//   POST /api/same/movimentos/:id/excluir   same.excluirMovimento (só o último; exclusão lógica)
//   POST /api/same/registros                ocorrência, aceite da remessa e cobrança da devolução (modelo pendente)
//   GET  /api/same/devolucoes-atrasadas     os volumes fora do SAME além do prazo (a lista da cobrança)
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import {
  type ApoioInternacaoTela,
  type DevolucoesAtrasadas,
  esquemaExcluirMovimento,
  esquemaRegistroSame,
  esquemaMovimentarProntuario,
  EVENTOS_AUDITAVEIS,
  type LocalizacaoConta,
  type ResultadoInternacao,
} from '@sgh/contratos';
import { contaDoCodigoDeBarras } from '@sgh/dominio-hotelaria';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { corpo } from '../exames/public-api.js';
import { ApoiosAdt, ctxAdt, janelaOutroSistema } from './apoios.js';
import { PORTA_ADT, type PortaAdt } from './porta.js';
import { ServicoAdt } from './servico.js';

@Controller('same')
export class SameController {
  readonly apoios: ApoiosAdt;
  private readonly servico: ServicoAdt;
  constructor(
    @Inject(PORTA_ADT) private readonly porta: PortaAdt,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoios = new ApoiosAdt(porta, trilha, configuracao, cache);
    this.servico = new ServicoAdt(porta, janelaOutroSistema(configuracao));
  }

  private async opcoes(s: SessaoCadastro) {
    return {
      setorSame: (await this.apoios.same.parametro(s, 'same.setorRegistro')) || 1,
      prazoDias: (await this.apoios.same.parametro(s, 'same.prazoDevolucaoDias')) || 7,
    };
  }

  @Get('gravacao')
  @Permissao('same.movimento.ler')
  gravacao(@Req() req: RequisicaoAutorizada) {
    return this.apoios.gravacao(sessaoDe(req));
  }

  @Get('apoio')
  @Permissao('same.movimento.ler')
  apoio(@Req() req: RequisicaoAutorizada): Promise<ApoioInternacaoTela> {
    return this.porta.apoio(ctxAdt(sessaoDe(req)));
  }

  @Get('contas/:codigo')
  @Permissao('same.movimento.ler')
  @Auditar(EVENTOS_AUDITAVEIS.internacaoLida.codigo)
  async conta(@Param('codigo') codigo: string, @Req() req: RequisicaoAutorizada): Promise<LocalizacaoConta> {
    const s = sessaoDe(req);
    const n = contaDoCodigoDeBarras(codigo);
    if (n === null)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Código inválido',
        'Leia a etiqueta da conta ou digite o número.',
        {
          campos: ['codigo'],
        },
      );
    const l = await this.servico.localizacao(ctxAdt(s), n, await this.opcoes(s));
    req.sghAlvo = { tabelaAlvo: 'GDPRONTMOVIM', idAlvo: String(l.conta) };
    return l;
  }

  @Post('movimentos')
  @HttpCode(201)
  @Permissao('same.movimento.criar')
  @AuditadoNoHandler('same.movimentarProntuario pelo executor (trilha na mesma transação)')
  movimentar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoInternacao> {
    const e = corpo(esquemaMovimentarProntuario, b);
    return this.apoios.same.executar(
      sessaoDe(req),
      'same.movimentarProntuario',
      e,
      'Movimento registrado.',
    ) as Promise<ResultadoInternacao>;
  }

  @Get('devolucoes-atrasadas')
  @Permissao('same.movimento.ler')
  async atrasadas(@Req() req: RequisicaoAutorizada): Promise<DevolucoesAtrasadas> {
    const s = sessaoDe(req);
    const [r, { agora }] = await Promise.all([
      this.porta.devolucoesAtrasadas(ctxAdt(s), await this.opcoes(s)),
      this.porta.relogio(ctxAdt(s)),
    ]);
    return { ...r, lidoEm: agora };
  }

  /**
   * O que só o novo guarda do SAME (movimento_prontuario, com a trilha na mesma transação): a ocorrência (o recebimento
   * recusado porque o volume não foi enviado a este setor), o aceite da remessa por quem recebe e a cobrança da
   * devolução atrasada (modelo pendente: pedido do lote 03-01).
   */
  @Post('registros')
  @HttpCode(201)
  @Permissao('same.movimento.criar')
  @AuditadoNoHandler('registro do SAME (movimento_prontuario) com a trilha de auditoria na mesma transação')
  async registro(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoInternacao> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistroSame, b);
    const o = await this.opcoes(s);
    const l = await this.servico.localizacao(ctxAdt(s), e.conta, o);
    const m = e.movimento === undefined ? null : (l.linhaDoTempo.find((x) => x.id === e.movimento) ?? null);
    const recusar = (codigo: string, texto: string) =>
      new ErroProblema('recusa-de-negocio', 409, 'Registro recusado', texto, {
        codigo,
        campos: ['movimento'],
      });
    if (e.movimento !== undefined && (!m || m.excluido))
      throw recusar('movimento-inexistente', 'O movimento não é desta conta ou foi desfeito.');
    if (e.tipo === 'aceite') {
      if (!m || ![2, 3, 5, 6].includes(m.operacao.codigo))
        throw recusar(
          'sem-remessa',
          'Só a remessa (saída, devolução, transferência ou recebimento) tem aceite.',
        );
      if (m.aceito) throw recusar('ja-aceito', 'A remessa já foi aceita.');
    }
    if (e.tipo === 'cobranca') {
      const atual = l.linhaDoTempo.find((x) => !x.excluido) ?? null;
      if (!m || atual?.id !== m.id || !l.devolucaoAtrasada)
        throw recusar(
          'devolucao-no-prazo',
          'Só se cobra a devolução do volume que está fora do arquivo além do prazo (o último movimento).',
        );
    }
    const tipo = e.tipo;
    const id = await this.apoios.same.sgh(
      s,
      EVENTOS_AUDITAVEIS.sameProtocolo.codigo,
      'same.movimento.criar',
      (x: number) => ({ tabela: 'movimento_prontuario', id: String(x), chave: `${tipo}:${e.conta}` }),
      (g) =>
        g.gravarSameExt({
          movimento: e.movimento ?? null,
          conta: e.conta,
          tipo,
          motivo: e.motivo?.trim() || null,
          protocolo: e.protocolo?.trim() || (tipo === 'aceite' ? (m?.protocolo ?? null) : null),
          usuario: s.login,
        }),
    );
    const mensagem =
      tipo === 'ocorrencia'
        ? 'Ocorrência registrada.'
        : tipo === 'aceite'
          ? 'Remessa aceita.'
          : 'Cobrança da devolução registrada.';
    return { ok: true, resultado: { registro: id }, repetida: false, mensagem };
  }

  @Post('movimentos/:id/excluir')
  @HttpCode(200)
  @Permissao('same.movimento.excluir')
  @AuditadoNoHandler('same.excluirMovimento pelo executor (trilha na mesma transação)')
  excluir(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoInternacao> {
    const e = corpo(esquemaExcluirMovimento, { ...(b as object), movimento: idDaRota(id) });
    return this.apoios.same.executar(
      sessaoDe(req),
      'same.excluirMovimento',
      e,
      'Movimento desfeito (exclusão lógica).',
    ) as Promise<ResultadoInternacao>;
  }
}
