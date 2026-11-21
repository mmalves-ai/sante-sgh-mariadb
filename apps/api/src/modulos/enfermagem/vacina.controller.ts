// Registro da vacina aplicada (M45, etapa 4; ficha, seções 5, 7 e regra 18; Portaria GM/MS 5.663/2024, RDC 197/2017):
//   GET  /api/enfermagem/vacinas/unidades | unidades/:unidade/pacientes   a escolha do paciente internado
//   GET  /api/enfermagem/vacinas/externos                                 a escolha do atendimento externo do dia (a sala
//                                                                         de vacina da consulta)
//   GET  /api/enfermagem/vacinas/:atendimento                             as vacinas do paciente e a situação do envio
//   POST /api/enfermagem/vacinas/:atendimento                             enfermagem.registrarVacina (com o evento do
//                                                                         envio RIA na fila de saída, na mesma transação)
//   POST /api/enfermagem/vacinas/:atendimento/:id/corrigir                W0-03: estornar ou retificar com o motivo (o
//                                                                         registro local fica; o evento RIA de
//                                                                         cancelamento ou substituição vai à fila de
//                                                                         saída na mesma transação)
//   GET  /api/enfermagem/vacinas/rnds/recusas                            W0-03 (M6): o monitor de recusas do RIA
//   GET  /api/enfermagem/vacinas/:atendimento/:id/ria                     a prévia do registro RIA (Immunization, BR Core
//                                                                         fixado) que o conector do M34 envia
// O registro clínico é deste marco; o envio RIA à RNDS em até 24 horas é o conector do M34 (regra 14), acionado pela
// outbox, com a chave dele (`integracao.rndsVacina`): fora de produção nada sai (regra 1.10). Só do novo; desligado por
// estabelecimento pela chave `enfermagem.vacina` (DP-47.5 b), com o pré-requisito do credenciamento.
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import {
  CHAVE_CONECTOR_VACINA,
  CHAVE_LIBERACAO_VACINA,
  esquemaCorrigirVacina,
  esquemaRegistrarVacina,
  type ExternosDoDiaVacina,
  EVENTOS_AUDITAVEIS,
  PARAMETRO_IMUNOBIOLOGICOS,
  PERMISSOES_SAE as P,
  type ResultadoVacina,
  type VacinasDoPaciente,
} from '@sgh/contratos';
import {
  chaveDaDose,
  conferirVacina,
  lerImunobiologicos,
  podeChecarCuidado,
  situacaoDoEnvio,
} from '@sgh/dominio-enfermagem';
import {
  ambienteRnds,
  imunizacaoDoRegistro,
  perfilBrCoreRecortado,
  validarRecurso,
} from '@sgh/dominio-integracao';
import { doseVigenteDaVacina } from '@sgh/dominio-enfermagem';
import type { VacinaAplicada } from './sae-tipos.js';
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
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { PORTA_ENFERMAGEM, type PortaEnfermagem } from './porta.js';
import { chaveDoPedido, recusaHttp } from './sae.controller.js';

/** A chave do pedido quando a tela a mandou (o reenvio é reconhecido); sem ela, a gravação segue sem chave. */
function chaveSeHouver(s: Parameters<typeof chaveDoPedido>[0]): string | null {
  try {
    return chaveDoPedido(s);
  } catch {
    return null;
  }
}
import { type GravadorSae, PORTA_SAE, type PortaSae } from './sae-porta.js';
import { ServicoSae } from './sae-servico.js';

const E = EVENTOS_AUDITAVEIS;
const UNIDADE = /^[A-Za-z0-9 ._-]{1,5}$/;

/**
 * W0-03: a vacina como vale hoje (a última retificação por cima do registro local, que nunca muda), a situação e o
 * original quando retificada.
 */
export function vacinaVigente(v: VacinaAplicada): VacinaAplicada & {
  situacao: 'ativa' | 'retificada' | 'estornada';
  original: Pick<
    VacinaAplicada,
    'lote' | 'fabricante' | 'validadeLote' | 'dose' | 'via' | 'local' | 'aplicadaEm'
  > | null;
} {
  const cs = v.correcoes ?? [];
  if (cs.some((c) => c.tipo === 'estorno')) {
    let base: VacinaAplicada = v;
    for (const c of cs) if (c.tipo === 'retificacao' && c.dados) base = { ...base, ...(c.dados as object) };
    return {
      ...base,
      situacao: 'estornada',
      original: cs.some((c) => c.tipo === 'retificacao') ? origem(v) : null,
    };
  }
  const rets = cs.filter((c) => c.tipo === 'retificacao' && c.dados);
  if (rets.length === 0) return { ...v, situacao: 'ativa', original: null };
  let x: VacinaAplicada = v;
  for (const c of rets) x = { ...x, ...(c.dados as object) };
  return { ...x, situacao: 'retificada', original: origem(v) };
}
const origem = (v: VacinaAplicada) => ({
  lote: v.lote,
  fabricante: v.fabricante,
  validadeLote: v.validadeLote,
  dose: v.dose,
  via: v.via,
  local: v.local,
  aplicadaEm: v.aplicadaEm,
});

/** O registro RIA (Immunization do BR Core fixado) da vacina aplicada, com os identificadores do conector. */
export function imunizacaoDaVacina(
  v: Pick<
    VacinaAplicada,
    'id' | 'imunobiologico' | 'nome' | 'lote' | 'fabricante' | 'dose' | 'via' | 'local' | 'aplicadaEm'
  >,
  o: { readonly hospital: string; readonly paciente: number; readonly vacinador: string },
): Record<string, unknown> {
  // W0-03 (M6): o mesmo mapeamento do conector (o worker monta o documento RIA com ele).
  return imunizacaoDoRegistro(v, o);
}

@Controller('enfermagem/vacinas')
export class VacinaController {
  private readonly apoio: ApoioGravacao<GravadorSae>;
  private readonly conector: ApoioGravacao<GravadorSae>;
  private readonly servico: ServicoSae;

  constructor(
    @Inject(PORTA_SAE) private readonly porta: PortaSae,
    @Inject(PORTA_ENFERMAGEM) private readonly enfermagem: PortaEnfermagem,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      { chave: CHAVE_LIBERACAO_VACINA, nome: 'o registro de vacinas', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.conector = new ApoioGravacao(
      { chave: CHAVE_CONECTOR_VACINA, nome: 'o envio de vacina aplicada à RNDS', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.servico = new ServicoSae(porta, enfermagem);
  }

  /** O paciente do atendimento: o internado; senão o atendimento externo (a sala de vacina da consulta). */
  private async paciente(s: SessaoCadastro, atendimento: number) {
    const i = await this.enfermagem.internado(s.porta, atendimento);
    if (i)
      return {
        atendimento: i.atendimento,
        paciente: i.paciente,
        numero: i.numero,
        nome: i.nome,
        leito: i.leito,
        unidade: i.unidade,
      };
    const a = await this.porta.consulta(s.porta, atendimento);
    if (!a || !a.ativo) throw new ErroProblema('nao-encontrado', 404, 'Atendimento não encontrado');
    return {
      atendimento: a.atendimento,
      paciente: a.paciente,
      numero: a.numero,
      nome: a.nome,
      leito: '',
      unidade: '',
    };
  }

  private async imunobiologicos(s: SessaoCadastro) {
    return lerImunobiologicos(String((await this.apoio.parametroValor(s, PARAMETRO_IMUNOBIOLOGICOS)) ?? ''));
  }

  /**
   * W0-03 (M6): o monitor de recusas do RIA do estabelecimento — os envios de aplicação, substituição e cancelamento
   * que a RNDS recusou (o motivo do OperationOutcome, sem dado do paciente) ou que não chegaram, com as tentativas; o
   * destino pelo ambiente e pelo parâmetro de credencial (dev e ci: sempre o simulador). O tratamento (reprocessar,
   * corrigir ou descartar) é o do monitor de integrações.
   */
  @Get('rnds/recusas')
  @Permissao(P.vacinaLer)
  @Auditar(E.vacinaLida.codigo)
  async recusas(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const [recusas, conector] = await Promise.all([
      this.porta.recusasRia(s.porta),
      this.conector.liberacao(s),
    ]);
    req.sghAlvo = { tabelaAlvo: 'SGH_INTG_ENVIO', chaveNaturalAlvo: `ria:${String(recusas.length)}` };
    return {
      recusas,
      conector: { ligado: conector.ligada, motivo: conector.motivo },
      destino: ambienteRnds(
        (process.env['AMBIENTE'] ?? 'dev').trim() || 'dev',
        process.env['RNDS_HOMOLOGACAO_AUTORIZADA'] === 'sim',
      ),
      credencial: !!process.env['RNDS_CERTIFICADO_PFX']?.trim(),
    };
  }

  @Get('unidades')
  @Permissao(P.vacinaLer)
  unidades(@Req() req: RequisicaoAutorizada) {
    return this.enfermagem.unidades(sessaoDe(req).porta);
  }

  @Get('unidades/:unidade/pacientes')
  @Permissao(P.vacinaLer)
  @Auditar(E.vacinaLida.codigo)
  async pacientes(@Param('unidade') unidade: string, @Req() req: RequisicaoAutorizada) {
    const u = unidade.trim();
    if (!UNIDADE.test(u))
      throw new ErroProblema('entrada-invalida', 400, 'Unidade inválida', 'Escolha a unidade.');
    req.sghAlvo = { tabelaAlvo: 'internacao' };
    return (await this.enfermagem.internados(sessaoDe(req).porta, u)).map((i) => ({
      paciente: i.paciente,
      atendimento: i.atendimento,
      numero: i.numero,
      nome: i.nome,
      leito: i.leito,
      unidade: i.unidade,
    }));
  }

  @Get('externos')
  @Permissao(P.vacinaLer)
  @Auditar(E.vacinaLida.codigo)
  async externos(@Req() req: RequisicaoAutorizada): Promise<ExternosDoDiaVacina> {
    const s = sessaoDe(req);
    const dia = (await this.enfermagem.relogio(s.porta)).slice(0, 10);
    const r = await this.porta.externosDoDia(s.porta, dia);
    // A lista mostra nome e registro dos pacientes do dia: leitura de dado pessoal auditada (só a contagem no alvo).
    req.sghAlvo = { tabelaAlvo: 'atendimento', chaveNaturalAlvo: `dia:${dia};n:${String(r.itens.length)}` };
    return r;
  }

  @Get(':atendimento')
  @Permissao(P.vacinaLer)
  @Auditar(E.vacinaLida.codigo)
  async vacinas(
    @Param('atendimento') atendimento: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<VacinasDoPaciente> {
    const s = sessaoDe(req);
    const p = await this.paciente(s, idDaRota(atendimento));
    req.sghAlvo = { paciente: p.paciente, tabelaAlvo: 'SGH_PEP_VACINA_APLICADA' };
    const [vs, imunos, l, cn, agora, v] = await Promise.all([
      this.porta.vacinas(s.porta, p.paciente),
      this.imunobiologicos(s),
      this.apoio.liberacao(s),
      this.conector.liberacao(s),
      this.enfermagem.relogio(s.porta),
      this.servico.vinculo(s.porta, s.login),
    ]);
    return {
      ...p,
      agora: agora.slice(0, 16),
      imunobiologicos: imunos,
      vacinas: vs.map(vacinaVigente).map((x) => ({
        id: x.id,
        imunobiologico: x.imunobiologico,
        nome: x.nome,
        lote: x.lote,
        fabricante: x.fabricante,
        validadeLote: x.validadeLote,
        dose: x.dose,
        via: x.via,
        local: x.local,
        aplicadaEm: x.aplicadaEm,
        prazoEnvio: x.prazoEnvio,
        envio: situacaoDoEnvio({
          conectorLigado: cn.ligada,
          evento: x.evento,
          entrega: x.entrega,
          prazo: x.prazoEnvio,
          agora: agora.slice(0, 16),
        }),
        usuario: x.usuario,
        em: x.em,
        situacao: x.situacao,
        original: x.original,
        correcoes: x.correcoes.map((c) => ({
          versao: c.versao,
          tipo: c.tipo,
          motivo: c.motivo,
          dados: c.dados,
          usuario: c.usuario,
          em: c.em,
          envio: {
            situacao: situacaoDoEnvio({
              conectorLigado: cn.ligada,
              evento: c.evento,
              entrega: c.entrega,
              prazo: x.prazoEnvio,
              agora: agora.slice(0, 16),
            }).situacao,
          },
        })),
      })),
      conector: { ligado: cn.ligada, motivo: cn.motivo },
      gravacao: {
        ligada: l.ligada,
        motivo: l.motivo,
        registrar:
          l.ligada && s.pode(P.vacinaRegistrar) && podeChecarCuidado(v.categoria) && imunos.length > 0,
      },
    };
  }

  @Post(':atendimento')
  @HttpCode(201)
  @Permissao(P.vacinaRegistrar)
  @AuditadoNoHandler(
    'enfermagem.registrarVacina: SGH_PEP_VACINA_APLICADA e SGH_OUTBOX com a SGH_TRILHA na mesma transação',
  )
  async registrar(
    @Param('atendimento') atendimento: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoVacina> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarVacina, b);
    const chave = chaveDoPedido(s);
    const p = await this.paciente(s, idDaRota(atendimento));
    const v = await this.servico.vinculo(s.porta, s.login);
    if (!podeChecarCuidado(v.categoria) || v.vinculo === null)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Registro da vacina',
        'A vacina é registrada pela enfermagem (enfermeiro ou técnico com o vínculo ativo), que é o vacinador.',
        { codigo: 'so-enfermagem' },
      );
    const [imunos, ja, agora] = await Promise.all([
      this.imunobiologicos(s),
      this.porta.vacinas(s.porta, p.paciente),
      this.enfermagem.relogio(s.porta),
    ]);
    // Revisão W0-03: só a dose VIGENTE conta (a estornada não; a retificada, pela dose corrigida, que a leitura já traz).
    const vigentes = ja.flatMap((x) => {
      const dose = doseVigenteDaVacina(x);
      return dose === null ? [] : [{ imunobiologico: x.imunobiologico, dose }];
    });
    const k = conferirVacina(e, {
      agora: agora.slice(0, 16),
      imunobiologicos: imunos,
      jaAplicadas: vigentes,
    });
    if (!k.ok) throw recusaHttp('Registro da vacina', k);
    const r = await this.apoio.sgh(
      s,
      E.vacinaRegistrada.codigo,
      P.vacinaRegistrar,
      (x: { id: number }) => ({
        tabela: 'SGH_PEP_VACINA_APLICADA',
        id: String(x.id),
        paciente: p.paciente,
        chave: `${e.imunobiologico}:${e.dose}`,
      }),
      (g) =>
        g.registrarVacina({
          paciente: p.paciente,
          atendimento: p.atendimento,
          imunobiologico: k.imunobiologico.codigo,
          nome: k.imunobiologico.nome,
          lote: e.lote,
          fabricante: e.fabricante,
          validadeLote: e.validadeLote,
          dose: e.dose,
          via: e.via,
          local: e.local,
          aplicadaEm: k.aplicadaEm,
          prazoEnvio: k.prazoEnvio,
          chaveDose: chaveDaDose(s.hospital, p.paciente, k.imunobiologico.codigo, e.dose),
          vinculo: v.vinculo!,
          usuario: s.login,
          chave,
        }),
    );
    return {
      ok: true,
      id: r.id,
      prazoEnvio: k.prazoEnvio,
      mensagem: `Vacina registrada. O envio à RNDS vence em ${k.prazoEnvio.slice(8, 10)}/${k.prazoEnvio.slice(5, 7)} às ${k.prazoEnvio.slice(11, 16)}.`,
    };
  }

  /**
   * W0-03: estornar (registrada por engano) ou retificar (lote, validade, fabricante, dose, via, local ou hora) a vacina,
   * com o motivo. O registro local não muda; a correção entra versionada e o evento RIA de cancelamento ou de
   * substituição vai à fila de saída na mesma transação (o conector da RNDS lê; fora de produção, só o simulador).
   */
  @Post(':atendimento/:id/corrigir')
  @HttpCode(200)
  @Permissao(P.vacinaRegistrar)
  @AuditadoNoHandler(
    'enfermagem.vacina.corrigida: SGH_PEP_VACINA_EVENTO e SGH_OUTBOX com a SGH_TRILHA na mesma transação',
  )
  async corrigir(
    @Param('atendimento') atendimento: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true; id: number; versao: number; mensagem: string }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaCorrigirVacina, b);
    const p = await this.paciente(s, idDaRota(atendimento));
    const v = await this.servico.vinculo(s.porta, s.login);
    if (!podeChecarCuidado(v.categoria) || v.vinculo === null)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Correção da vacina',
        'A vacina é corrigida pela enfermagem (enfermeiro ou técnico com o vínculo ativo).',
        { codigo: 'so-enfermagem' },
      );
    const atual = (await this.porta.vacinas(s.porta, p.paciente)).find((x) => x.id === idDaRota(id));
    if (!atual) throw new ErroProblema('nao-encontrado', 404, 'Vacina não encontrada');
    if (e.tipo === 'retificacao' && e.dados) {
      const vg = vacinaVigente(atual);
      const validade = e.dados.validadeLote ?? vg.validadeLote;
      const aplicada = e.dados.aplicadaEm ?? vg.aplicadaEm;
      if (validade < aplicada.slice(0, 10))
        throw new ErroProblema(
          'recusa-de-negocio',
          422,
          'Correção da vacina',
          'A validade do lote é anterior à aplicação.',
          { codigo: 'lote-vencido' },
        );
    }
    const r = await this.apoio.sgh(
      s,
      E.enfermagemVacinaCorrigida.codigo,
      P.vacinaRegistrar,
      (x: { id: number; versao: number }) => ({
        tabela: 'SGH_PEP_VACINA_EVENTO',
        id: `${String(x.id)}:${String(x.versao)}`,
        paciente: p.paciente,
        chave: e.tipo,
      }),
      (g) =>
        g.corrigirVacina({
          id: atual.id,
          paciente: p.paciente,
          tipo: e.tipo,
          motivo: e.motivo,
          dados: e.dados,
          usuario: s.login,
          chave: chaveSeHouver(s),
        }),
    );
    return {
      ok: true,
      id: r.id,
      versao: r.versao,
      mensagem:
        e.tipo === 'estorno'
          ? 'Vacina estornada: o registro fica inativo e visível; o cancelamento do registro na RNDS entrou na fila de envio.'
          : 'Vacina retificada: a versão anterior fica visível; a substituição do registro na RNDS entrou na fila de envio.',
    };
  }

  @Get(':atendimento/:id/ria')
  @Permissao(P.vacinaLer)
  @Auditar(E.vacinaLida.codigo)
  async ria(
    @Param('atendimento') atendimento: string,
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const p = await this.paciente(s, idDaRota(atendimento));
    const v = (await this.porta.vacinas(s.porta, p.paciente)).find((x) => x.id === idDaRota(id));
    if (!v) throw new ErroProblema('nao-encontrado', 404, 'Vacina não encontrada');
    req.sghAlvo = { paciente: p.paciente, tabelaAlvo: 'SGH_PEP_VACINA_APLICADA' };
    // W0-03: a prévia é a da versão vigente; a estornada vai como `entered-in-error` (o cancelamento do RIA).
    const vg = vacinaVigente(v);
    const base = imunizacaoDaVacina(vg, {
      hospital: s.hospital,
      paciente: p.paciente,
      vacinador: v.usuario,
    });
    const recurso = vg.situacao === 'estornada' ? { ...base, status: 'entered-in-error' } : base;
    const perfil = perfilBrCoreRecortado('Immunization');
    const problemas = perfil ? validarRecurso(recurso as never, perfil) : [];
    return { recurso, valido: !!perfil && problemas.length === 0, problemas };
  }
}
