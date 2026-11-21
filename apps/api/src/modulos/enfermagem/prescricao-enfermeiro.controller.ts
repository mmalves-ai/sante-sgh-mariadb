// Prescrição de medicamento pelo enfermeiro (M45, etapa 4; ficha, seções 5, 7 e regra 17; Res. COFEN 801/2026):
//   GET  /api/enfermagem/prescricao-medicamento/consultas            as consultas de enfermagem do dia do enfermeiro
//   GET  /api/enfermagem/prescricao-medicamento/:atendimento         a consulta, os protocolos, a lista e as receitas
//   POST /api/enfermagem/prescricao-medicamento/:atendimento/previa  o texto da receita e a impressão para assinar
//   POST /api/enfermagem/prescricao-medicamento/:atendimento         enfermagem.prescreverMedicamento (assinada com a
//                                                                    senha; a impressão vista tem de ser a recalculada;
//                                                                    W0-03: `anterior` reemite a suspensa ou cancelada)
//   POST /api/enfermagem/prescricao-medicamento/:atendimento/receitas/:id/inativar
//                                                                    W0-03: suspender ou cancelar com o motivo e a senha
//                                                                    (a original fica legível e inativa; nada é regerado)
// Só em consulta de enfermagem (atendimento externo com o profissional do atendimento enfermeiro), só pelo enfermeiro,
// só pelo protocolo publicado e com os medicamentos da lista do anexo II que ele permite (parâmetros versionados). Só
// do novo; desligada pela chave `enfermagem.prescricaoMedicamento` (POL-3).
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Req } from '@nestjs/common';
import {
  type CabecalhoReceitaEnfermeiro,
  CHAVE_LIBERACAO_PRESCRICAO_MEDICAMENTO,
  type ConsultaEnfermagemLida,
  esquemaInativarReceitaEnfermeiro,
  esquemaPrescreverMedicamentoEnfermeiro,
  esquemaPreviaReceitaEnfermeiro,
  EVENTOS_AUDITAVEIS,
  PARAMETRO_ANEXO_II_ENFERMEIRO,
  PARAMETRO_PROTOCOLOS_ENFERMEIRO,
  PERMISSOES_SAE as P,
  type PrescricaoEnfermeiroDoAtendimento,
  type PreviaReceitaEnfermeiro,
  type PreviaReceitaEnfermeiroEntrada,
  type ResultadoReceitaEnfermeiro,
} from '@sgh/contratos';
import {
  categoriaPorCbo,
  conferirReceitaEnfermeiro,
  cpfMascarado,
  impressaoDaReceita,
  lerAnexoII,
  lerProtocolosEnfermeiro,
  textoDaReceitaEnfermeiro,
} from '@sgh/dominio-enfermagem';
import type { AtendimentoDaConsulta } from './tipos.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
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
import { type GravadorSae, PORTA_SAE, type PortaSae } from './sae-porta.js';
import { dataBr, ServicoSae } from './sae-servico.js';

const E = EVENTOS_AUDITAVEIS;

/** É consulta de enfermagem: atendimento externo ativo com o profissional do atendimento enfermeiro (CBO 2235). */
export function ehConsultaDeEnfermagem(a: AtendimentoDaConsulta): { ok: boolean; motivo: string | null } {
  if (a.tipo !== 'E')
    return {
      ok: false,
      motivo:
        'O atendimento não é uma consulta externa: a prescrição de medicamento pelo enfermeiro é só na consulta de enfermagem.',
    };
  if (!a.ativo) return { ok: false, motivo: 'O atendimento está cancelado.' };
  if (categoriaPorCbo(a.cboDoAtendimento) !== 'enfermeiro')
    return {
      ok: false,
      motivo:
        'O profissional do atendimento não é enfermeiro: a prescrição pelo enfermeiro é só na consulta de enfermagem.',
    };
  return { ok: true, motivo: null };
}

@Controller('enfermagem/prescricao-medicamento')
export class PrescricaoEnfermeiroController {
  private readonly apoio: ApoioGravacao<GravadorSae>;
  private readonly servico: ServicoSae;

  constructor(
    @Inject(PORTA_SAE) private readonly porta: PortaSae,
    @Inject(PORTA_ENFERMAGEM) private readonly enfermagem: PortaEnfermagem,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao | null = null,
  ) {
    this.apoio = new ApoioGravacao(
      {
        chave: CHAVE_LIBERACAO_PRESCRICAO_MEDICAMENTO,
        nome: 'a prescrição de medicamento pelo enfermeiro',
        operacoes: {},
      },
      porta,
      trilha,
      configuracao,
      cache,
    );
    this.servico = new ServicoSae(porta, enfermagem);
  }

  private async parametros(s: SessaoCadastro) {
    const [p, l] = await Promise.all([
      this.apoio.parametroValor(s, PARAMETRO_PROTOCOLOS_ENFERMEIRO),
      this.apoio.parametroValor(s, PARAMETRO_ANEXO_II_ENFERMEIRO),
    ]);
    return { protocolos: lerProtocolosEnfermeiro(String(p ?? '')), lista: lerAnexoII(String(l ?? '')) };
  }

  private async consulta(s: SessaoCadastro, atendimento: number): Promise<AtendimentoDaConsulta> {
    const a = await this.porta.consulta(s.porta, atendimento);
    if (!a) throw new ErroProblema('nao-encontrado', 404, 'Atendimento não encontrado');
    return a;
  }

  private async cabecalho(
    s: SessaoCadastro,
    a: AtendimentoDaConsulta,
    vinculo: number,
    segundo: 'cpf' | 'nascimento',
    dia: string,
  ): Promise<CabecalhoReceitaEnfermeiro> {
    const c = await this.porta.cabecalhoReceita(s.porta, { paciente: a.paciente, vinculo });
    return {
      instituicao: c.instituicao,
      cnpj: c.cnpj,
      prescritor: c.prescritor,
      coren: c.conselho,
      categoria: c.categoria ?? 'Enfermeiro',
      paciente: c.paciente,
      segundoIdentificador: segundo === 'cpf' ? cpfMascarado(c.cpf) : dataBr(c.nascimento),
      data: dataBr(dia) ?? dia,
    };
  }

  /** A receita conferida e o texto com a impressão (a prévia e a assinatura usam o mesmo cálculo). */
  private async montar(s: SessaoCadastro, atendimento: number, e: PreviaReceitaEnfermeiroEntrada) {
    const a = await this.consulta(s, atendimento);
    if (e.anterior) await this.conferirAnterior(s, a.atendimento, e.anterior);
    const [v, par, agora] = await Promise.all([
      this.servico.vinculo(s.porta, s.login),
      this.parametros(s),
      this.enfermagem.relogio(s.porta),
    ]);
    const k = conferirReceitaEnfermeiro(e, {
      consultaDeEnfermagem: ehConsultaDeEnfermagem(a).ok,
      enfermeiro: v.categoria === 'enfermeiro' && v.vinculo !== null,
      protocolos: par.protocolos,
      lista: par.lista,
    });
    if (!k.ok) {
      if (k.codigo === 'so-enfermeiro')
        throw new ErroProblema('sem-permissao', 403, 'Prescrição de medicamento', k.mensagem, {
          codigo: k.codigo,
        });
      throw recusaHttp('Prescrição de medicamento', k);
    }
    const cabecalho = await this.cabecalho(s, a, v.vinculo!, e.segundoIdentificador, agora.slice(0, 10));
    if (!cabecalho.coren)
      throw new ErroProblema(
        'entrada-invalida',
        422,
        'Prescrição de medicamento',
        'O cadastro do prescritor não tem o número do COREN: a receita não sai sem ele.',
        { codigo: 'sem-conselho' },
      );
    const texto = textoDaReceitaEnfermeiro(cabecalho, {
      protocolo: k.protocolo,
      modelo: e.modelo,
      segundoIdentificador: e.segundoIdentificador,
      listaVersao: k.lista.versao,
      itens: k.itens,
      anterior: e.anterior ?? null,
    });
    return {
      a,
      v,
      k,
      cabecalho,
      texto,
      impressao: await impressaoDaReceita(texto),
      agora: agora.slice(0, 19),
    };
  }

  /** W0-03: a reemissão só sai da receita deste atendimento já suspensa ou cancelada, e uma vez só. */
  private async conferirAnterior(s: SessaoCadastro, atendimento: number, anterior: number): Promise<void> {
    const r = (await this.porta.receitas(s.porta, atendimento)).find((x) => x.id === anterior);
    const recusar = (codigo: string, texto: string) => {
      throw new ErroProblema('recusa-de-negocio', 409, 'Reemissão da receita', texto, { codigo });
    };
    if (!r) recusar('receita-inexistente', 'A receita anterior não é deste atendimento.');
    else if (!r.inativacao)
      recusar(
        'receita-ativa',
        'A receita anterior ainda está ativa: suspenda ou cancele, com o motivo, antes de reemitir.',
      );
    else if (r.reemitidaEm) recusar('receita-ja-reemitida', 'A receita anterior já foi reemitida.');
  }

  @Get('consultas')
  @Permissao(P.medicamentoLer)
  @Auditar(E.receitaEnfermeiroLida.codigo)
  async consultas(@Req() req: RequisicaoAutorizada): Promise<ConsultaEnfermagemLida[]> {
    const s = sessaoDe(req);
    const [vs, agora] = await Promise.all([
      this.enfermagem.vinculos(s.porta, s.login).catch(() => []),
      this.enfermagem.relogio(s.porta),
    ]);
    const enf = vs.filter((v) => categoriaPorCbo(v.codigo) === 'enfermeiro').map((v) => v.cbo);
    const dia = agora.slice(0, 10);
    const lista = await this.porta.consultasDoProfissional(s.porta, { vinculos: enf, dia });
    // A lista mostra nome e registro dos pacientes do dia: leitura de dado pessoal auditada (só a contagem no alvo).
    req.sghAlvo = { tabelaAlvo: 'atendimento', chaveNaturalAlvo: `dia:${dia};n:${String(lista.length)}` };
    return lista;
  }

  @Get(':atendimento')
  @Permissao(P.medicamentoLer)
  @Auditar(E.receitaEnfermeiroLida.codigo)
  async atendimento(
    @Param('atendimento') atendimento: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PrescricaoEnfermeiroDoAtendimento> {
    const s = sessaoDe(req);
    const a = await this.consulta(s, idDaRota(atendimento));
    req.sghAlvo = { paciente: a.paciente, tabelaAlvo: 'prescricao' };
    const [v, par, agora, l, receitas] = await Promise.all([
      this.servico.vinculo(s.porta, s.login),
      this.parametros(s),
      this.enfermagem.relogio(s.porta),
      this.apoio.liberacao(s),
      this.porta.receitas(s.porta, a.atendimento),
    ]);
    const consulta = ehConsultaDeEnfermagem(a);
    const enfermeiro = v.categoria === 'enfermeiro';
    const comTexto = await Promise.all(
      receitas.map(async (r) => {
        const cab = await this.cabecalho(s, a, r.vinculo, r.segundoIdentificador, r.assinadaEm.slice(0, 10));
        return {
          ...r,
          texto: textoDaReceitaEnfermeiro(
            { ...cab, coren: r.coren, categoria: r.categoria },
            {
              protocolo: { codigo: r.protocolo, ano: r.ano, tipo: r.tipoProtocolo },
              modelo: r.modelo,
              segundoIdentificador: r.segundoIdentificador,
              listaVersao: r.listaVersao,
              itens: r.itens,
              anterior: r.anterior,
            },
          ),
        };
      }),
    );
    return {
      atendimento: a.atendimento,
      paciente: a.paciente,
      numero: a.numero,
      nome: a.nome,
      agora: agora.slice(0, 16),
      consultaDeEnfermagem: consulta.ok,
      motivo: consulta.motivo,
      protocolos: par.protocolos,
      lista: par.lista,
      receitas: comTexto.map(({ vinculo: _v, ...r }) => {
        void _v;
        return r;
      }),
      gravacao: {
        ligada: l.ligada,
        motivo: l.motivo,
        enfermeiro,
        prescrever:
          l.ligada && enfermeiro && consulta.ok && s.pode(P.medicamentoPrescrever) && par.lista !== null,
      },
    };
  }

  @Post(':atendimento/previa')
  @HttpCode(200)
  @Permissao(P.medicamentoPrescrever)
  @Auditar(E.receitaEnfermeiroLida.codigo)
  async previa(
    @Param('atendimento') atendimento: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PreviaReceitaEnfermeiro> {
    const s = sessaoDe(req);
    const e = corpo(esquemaPreviaReceitaEnfermeiro, b);
    const m = await this.montar(s, idDaRota(atendimento), e);
    req.sghAlvo = { paciente: m.a.paciente, tabelaAlvo: 'prescricao' };
    return { texto: m.texto, impressao: m.impressao, cabecalho: m.cabecalho };
  }

  @Post(':atendimento')
  @HttpCode(201)
  @Permissao(P.medicamentoPrescrever)
  @AuditadoNoHandler('enfermagem.prescreverMedicamento: prescricao com a trilha_auditoria na mesma transação')
  async assinar(
    @Param('atendimento') atendimento: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoReceitaEnfermeiro> {
    const s = sessaoDe(req);
    const e = corpo(esquemaPrescreverMedicamentoEnfermeiro, b);
    const chave = chaveDoPedido(s);
    await this.apoio.exigirLiberacao(s);
    const m = await this.montar(s, idDaRota(atendimento), e);
    if (m.impressao !== e.impressaoVista)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Receita mudou',
        'O conteúdo da receita mudou depois da prévia (o cadastro, o protocolo ou o dia): gere a prévia de novo e assine.',
        { codigo: 'receita-mudou' },
      );
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, e.senha);
    const r = await this.apoio.sgh(
      s,
      E.receitaEnfermeiroAssinada.codigo,
      P.medicamentoPrescrever,
      (x: { id: number }) => ({
        tabela: 'prescricao',
        id: String(x.id),
        paciente: m.a.paciente,
        chave: `${m.k.protocolo.codigo}/${m.k.protocolo.ano}`,
      }),
      (g) =>
        g.prescreverMedicamento({
          paciente: m.a.paciente,
          atendimento: m.a.atendimento,
          protocolo: m.k.protocolo.codigo,
          ano: m.k.protocolo.ano,
          tipoProtocolo: m.k.protocolo.tipo,
          modelo: e.modelo,
          listaVersao: m.k.lista.versao,
          segundoIdentificador: e.segundoIdentificador,
          coren: m.cabecalho.coren!,
          categoria: m.cabecalho.categoria,
          itens: m.k.itens,
          impressao: m.impressao,
          assinadaEm: m.agora,
          vinculo: m.v.vinculo!,
          usuario: s.login,
          chave,
          anterior: e.anterior ?? null,
        }),
    );
    return {
      ok: true,
      id: r.id,
      impressao: m.impressao,
      mensagem:
        (e.anterior ? `Receita reemitida (substitui a nº ${String(e.anterior)}). ` : '') +
        (e.modelo === 'retencao'
          ? 'Receita de retenção assinada: imprima as duas vias.'
          : 'Receita assinada. Imprima e entregue ao paciente.'),
    };
  }

  /**
   * W0-03: suspender (interrompe o tratamento) ou cancelar (emitida errada) a receita, com o motivo e a senha de novo
   * (operação crítica). A receita original não se edita nem se regera: o texto e a impressão assinados continuam os
   * mesmos, legíveis e inativos. O cancelamento é só de quem assinou; a suspensão, de qualquer enfermeiro com a
   * permissão de prescrever.
   */
  @Post(':atendimento/receitas/:id/inativar')
  @HttpCode(200)
  @Permissao(P.medicamentoPrescrever)
  @AuditadoNoHandler(
    'enfermagem.prescricaoMedicamento.inativada: prescricao com a trilha_auditoria na mesma transação',
  )
  async inativar(
    @Param('atendimento') atendimento: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true; id: number; mensagem: string }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaInativarReceitaEnfermeiro, b);
    const a = await this.consulta(s, idDaRota(atendimento));
    const r = (await this.porta.receitas(s.porta, a.atendimento)).find((x) => x.id === idDaRota(id));
    if (!r) throw new ErroProblema('nao-encontrado', 404, 'Receita não encontrada');
    const v = await this.servico.vinculo(s.porta, s.login);
    if (v.categoria !== 'enfermeiro' || v.vinculo === null)
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Receita do enfermeiro',
        'Só o enfermeiro suspende ou cancela a receita.',
        { codigo: 'so-enfermeiro' },
      );
    if (e.tipo === 'cancelamento' && r.usuario.toUpperCase() !== s.login.toUpperCase())
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Receita do enfermeiro',
        'Só quem assinou cancela a receita; os demais podem suspender.',
        { codigo: 'receita-de-outro' },
      );
    if (r.inativacao)
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Receita do enfermeiro',
        'A receita já está inativa.',
        {
          codigo: 'receita-ja-inativa',
        },
      );
    if (!this.resolvedor)
      throw new ErroProblema(
        'reautenticacao-necessaria',
        401,
        'Confirme a senha',
        'Entre com o seu usuário.',
      );
    await reautenticar(this.sessoes, this.resolvedor, req, e.senha);
    await this.apoio.sgh(
      s,
      E.enfermagemReceitaInativada.codigo,
      P.medicamentoPrescrever,
      { tabela: 'prescricao', id: String(r.id), paciente: a.paciente, chave: e.tipo },
      (g) =>
        g.inativarReceita({
          id: r.id,
          atendimento: a.atendimento,
          tipo: e.tipo,
          motivo: e.motivo,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id: r.id,
      mensagem:
        (e.tipo === 'suspensao' ? 'Receita suspensa' : 'Receita cancelada') +
        ': a original fica legível e inativa. Para substituir, reemita a receita.',
    };
  }
}
