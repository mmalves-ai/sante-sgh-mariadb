// Regulação estadual no NIR (M44, etapa 3; ficha, seções 4, 5, 7 e 8, regra 14; cap-05a §5.4, Nota; cap-12 §12.4):
//   GET  /api/nir/regulacao                as solicitações de leito abertas com a regulação vigente e o histórico, as
//                                          contagens por situação, o conector e as ações (lista com nomes: auditada)
//   GET  /api/nir/regulacao/configuracao   a configuração de regulação do fornecedor anterior (consulta)
//   POST /api/nir/regulacao                internacao.registrarRegulacao (o número à mão; com o conector, o pedido à
//                                          central pela outbox na mesma transação)
// O número é sempre registrável à mão. O conector com a central só existe se a DP-29 confirmar a API: a chave
// `nir.regulacaoConector` fica desligada (POL-3); ligada fora de produção, quem responde é o simulador (a trava de
// saídas recusa endereço real). As tabelas de regulação do fornecedor anterior nunca são gravadas.
import { Body, Controller, Get, HttpCode, Inject, Optional, Post, Req } from '@nestjs/common';
import {
  CHAVE_CONECTOR_REGULACAO,
  CHAVE_LIBERACAO_NIR,
  type ConfiguracaoRegulacao,
  esquemaRegistrarRegulacao,
  EVENTO_OUTBOX_REGULACAO,
  EVENTOS_AUDITAVEIS,
  PERMISSOES_NIR_CODIGOS as P,
  type RegistroRegulacao,
  type ResultadoNir,
  type TelaRegulacao,
} from '@sgh/contratos';
import {
  contagemRegulacao,
  decidirRegulacao,
  deparaVigente,
  type LinhaDepara,
  resumoDeparaRegulacao,
  situacaoDoPedidoNaTela,
  situacaoDoPedidoPelaRegulacao,
} from '@sgh/dominio-internacao';
import { type RegistroRegulacaoNir } from './tipos.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { AvisosAtendimento } from '../atendimento/public-api.js';
import { type SessaoCadastro, sessaoDe } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { ApoioGravacaoIdempotente } from './apoio-idempotente.js';
import { ctxAdt } from './apoios.js';
import { type GravadorNir, PORTA_NIR, type PortaNir } from './nir-porta.js';
import { AVISOS_ADT } from './simbolos.js';

const TABELA = 'solicitacao_regulacao';

export function registroDe(r: RegistroRegulacaoNir): RegistroRegulacao {
  return {
    id: r.id,
    solicitacao: r.solicitacao,
    central: r.central as RegistroRegulacao['central'],
    sentido: r.sentido,
    numero: r.numero,
    situacao: r.situacao as RegistroRegulacao['situacao'],
    origem: r.origem,
    observacao: r.observacao,
    anterior: r.anterior,
    mensagemHash: r.mensagemHash,
    por: r.por,
    em: r.em,
  };
}

/** A vigente da solicitação: a última da sucessão (a de maior ID). */
const vigenteDe = (rs: readonly RegistroRegulacaoNir[]) => [...rs].sort((a, b) => a.id - b.id).at(-1) ?? null;

@Controller('nir/regulacao')
export class RegulacaoController {
  private readonly apoio: ApoioGravacao<GravadorNir>;
  private readonly conector: ApoioGravacao<GravadorNir>;

  constructor(
    @Inject(PORTA_NIR) private readonly porta: PortaNir,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(AVISOS_ADT) private readonly avisos: AvisosAtendimento | null = null,
  ) {
    this.apoio = new ApoioGravacaoIdempotente<GravadorNir>(
      { chave: CHAVE_LIBERACAO_NIR, nome: 'a regulação do NIR', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.conector = new ApoioGravacaoIdempotente<GravadorNir>(
      { chave: CHAVE_CONECTOR_REGULACAO, nome: 'o conector com a central de regulação', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  /** O conector vale só fora de produção (simulador) e com a chave ligada; em produção, só com a DP-29. */
  private async estadoConector(s: SessaoCadastro): Promise<TelaRegulacao['conector']> {
    if ((process.env['AMBIENTE']?.trim() || 'dev') === 'producao')
      return {
        ligado: false,
        modo: 'desligado',
        motivo:
          'O conector com a central de regulação depende da confirmação da API da central (DP-29): registre o número à mão.',
      };
    const l = await this.conector.liberacao(s);
    return l.ligada
      ? { ligado: true, modo: 'simulador', motivo: null }
      : {
          ligado: false,
          modo: 'desligado',
          motivo:
            'O conector com a central de regulação está desligado neste estabelecimento: registre o número à mão.',
        };
  }

  /** C3-013: o de-para das situações aprovado pelo NIR (a proposta com as linhas aprovadas por cima). */
  private async depara(c: ReturnType<typeof ctxAdt>): Promise<LinhaDepara[]> {
    const [aprovados, rotulos] = await Promise.all([
      this.porta.depara(c),
      this.porta.situacoes(c).catch(() => new Map<number, string>()),
    ]);
    return deparaVigente(aprovados, rotulos);
  }

  @Get()
  @Permissao(P.regulacaoLer)
  @Auditar(EVENTOS_AUDITAVEIS.nirFilaLida.codigo)
  async tela(@Req() req: RequisicaoAutorizada): Promise<TelaRegulacao> {
    const s = sessaoDe(req);
    const c = ctxAdt(s);
    const [{ agora }, { itens }, depara] = await Promise.all([
      this.porta.relogio(c),
      this.porta.abertas(c),
      this.depara(c),
    ]);
    const regs = await this.porta.regulacoes(
      c,
      itens.map((x) => x.id),
    );
    const solicitacoes = itens.map((x) => {
      const historico = regs.filter((r) => r.solicitacao === x.id).sort((a, b) => b.id - a.id);
      const v = historico[0] ?? null;
      return {
        solicitacao: x.id,
        paciente: { id: x.paciente, nome: x.nome },
        estadoSolicitacao: x.estado,
        situacaoPedido: situacaoDoPedidoNaTela(x.estado, depara),
        prioridade: x.prioridade,
        solicitadoEm: x.solicitadoEm,
        vigente: v ? registroDe(v) : null,
        historico: historico.map(registroDe),
      };
    });
    const l = await this.apoio.liberacao(s);
    const podeRegistrar = s.pode(P.regulacaoRegistrar);
    req.sghAlvo = { tabelaAlvo: TABELA, chaveNaturalAlvo: `parte:regulacao;n:${solicitacoes.length}` };
    return {
      solicitacoes,
      contagens: contagemRegulacao(solicitacoes.map((x) => x.vigente?.situacao ?? null)),
      conector: await this.estadoConector(s),
      acoes: {
        registrar: podeRegistrar && l.ligada,
        motivo: !podeRegistrar ? 'Seu perfil só consulta a regulação.' : l.ligada ? null : l.motivo,
      },
      depara: resumoDeparaRegulacao(depara),
      lidoEm: agora,
    };
  }

  @Get('configuracao')
  @Permissao(P.regulacaoLer)
  configuracao(@Req() req: RequisicaoAutorizada): Promise<ConfiguracaoRegulacao> {
    return this.porta.configuracaoRegulacao(ctxAdt(sessaoDe(req)));
  }

  @Post()
  @HttpCode(201)
  @Permissao(P.regulacaoRegistrar)
  @AuditadoNoHandler(
    'internacao.registrarRegulacao (solicitacao_regulacao; a outbox com o conector) com a trilha de auditoria na mesma transação',
  )
  async registrar(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoNir> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarRegulacao, b);
    const c = ctxAdt(s);
    const sol = await this.porta.solicitacao(c, e.solicitacao);
    if (!sol)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Solicitação não encontrada',
        'A solicitação de leito não existe.',
      );
    const historico = await this.porta.regulacoes(c, [sol.id]);
    const vigente = vigenteDe(historico);
    if ((vigente?.id ?? null) !== e.anterior)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Regulação mudou',
        'A regulação desta solicitação mudou depois que você abriu (outra pessoa registrou). Abra de novo.',
        { codigo: 'regulacao-desatualizada' },
      );
    const d = decidirRegulacao(
      vigente
        ? {
            id: vigente.id,
            numero: vigente.numero,
            central: vigente.central as Parameters<typeof decidirRegulacao>[1]['central'],
            situacao: vigente.situacao as Parameters<typeof decidirRegulacao>[1]['situacao'],
          }
        : null,
      { numero: e.numero, central: e.central, situacao: e.situacao },
      historico.map((x) => ({ numero: x.numero, central: x.central })),
    );
    if (!d.ok)
      throw new ErroProblema('recusa-de-negocio', 409, 'Regulação não registrada', d.motivo, {
        codigo: d.codigo,
      });
    const conector = await this.estadoConector(s);
    // C3-013: a situação do pedido acompanha a regulação pelo de-para aprovado, sem mudar o estado do NIR.
    const situacaoPedido = situacaoDoPedidoPelaRegulacao(e.situacao, sol.estado, await this.depara(c));
    // Com o conector, o pedido novo à central vai pela outbox na mesma transação (só IDs e códigos na carga).
    const outbox =
      conector.ligado && d.novoPedido && e.situacao === 'solicitada'
        ? { rede: s.rede, tipo: EVENTO_OUTBOX_REGULACAO }
        : null;
    const r = await this.apoio.sgh(
      s,
      EVENTOS_AUDITAVEIS.regulacaoRegistrada.codigo,
      P.regulacaoRegistrar,
      (x: { id: number }) => ({
        tabela: TABELA,
        id: String(x.id),
        paciente: sol.paciente,
        chave: `${sol.id}:${e.central}:${e.situacao}`,
      }),
      (g) =>
        g.registrarRegulacao({
          solicitacao: sol.id,
          central: e.central,
          sentido: e.sentido,
          numero: e.numero,
          situacao: e.situacao,
          origem: 'manual',
          observacao: e.observacao ?? null,
          anterior: e.anterior,
          mensagemHash: null,
          por: s.login,
          outbox,
          situacaoPedido: situacaoPedido ? { codigo: situacaoPedido.codigo, estado: sol.estado } : null,
        }),
    );
    this.avisos?.avisar(s.hospital);
    return {
      ok: true,
      id: r.id,
      mensagem:
        (outbox
          ? 'Regulação registrada e o pedido enviado à central pelo conector.'
          : 'Regulação registrada na solicitação de leito.') +
        (situacaoPedido ? ` Situação do pedido: ${situacaoPedido.rotulo}.` : ''),
    };
  }
}
