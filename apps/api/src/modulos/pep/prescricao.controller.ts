// Prescrição eletrônica (CPOE) (M24; ficha, seção 7) — `PEP > Prescrição médica (CPOE)`, `Farmácia clínica` e
// `Enfermagem > Horários-padrão de medicação por unidade`:
//   GET  /api/pep/prescricao/liberacao                                a CPOE vale para esta sessão?
//   GET  /api/pep/prescricao/dominios                                 cadastros do editor (vias, unidades, frequências…)
//   GET  /api/pep/prescricao/produtos?termo=                          busca de item (padronizado primeiro)
//   GET  /api/pep/prescricao/protocolos?paciente=&atendimento=         protocolos com a aplicabilidade; /:id/itens
//   GET  /api/pep/prescricao/cadastros/:secao?termo=                   kits, receitas padrão, não padronizados, parâmetros
//   GET  /api/pep/prescricao/:paciente/contexto                        prescritor, atendimentos abertos e períodos
//   GET  /api/pep/prescricao/:paciente/atendimentos/:atendimento       prescrições do atendimento (leitura auditada)
//   GET  /api/pep/prescricao/:paciente/prescricoes/:id                 a prescrição com os itens, horários e a prova
//   GET  /api/pep/prescricao/:paciente/prescricoes/:id/receita-alta    as receitas da alta no receituário certo (regra 15)
//   POST /api/pep/prescricao/:paciente/verificar                       alertas e horários previstos (sem gravar)
//   POST /api/pep/prescricao/:paciente/prescrever                      pep.prescrever / copiar / renovar (Idempotency-Key)
//   POST /api/pep/prescricao/:paciente/prescricoes/:id/itens           pep.incluirItem
//   POST /api/pep/prescricao/:paciente/prescricoes/:id/itens/:item/suspender   pep.suspenderItem (crítica)
//   POST /api/pep/prescricao/:paciente/prescricoes/:id/suspender       pep.suspenderPrescricao (crítica)
//   POST /api/pep/prescricao/:paciente/prescricoes/:id/coassinar       coassinatura do preceptor (só no novo)
//   GET|POST /api/pep/prescricao/:paciente/futuras[/:id/cancelar]      prescrição futura (só no novo)
//   GET|POST /api/pep/prescricao/:paciente/reconciliacao               reconciliação medicamentosa (só no novo)
//   GET  /api/pep/prescricao/a-renovar?horas=                          as que vencem no turno (worklist do M27)
//   GET|POST /api/farmacia-clinica/regras, POST …/simular              regras de alerta versionadas e o simulador
//   GET|POST /api/farmacia-clinica/antimicrobianos                     fichas de antimicrobiano
//   GET  /api/enfermagem/horarios-padrao, POST …/classe                regra de horário, grade e grade por classe
// Toda leitura de dado do paciente vai à trilha (@Auditar, nunca o conteúdo); leitura e gravação no paciente passam
// pelo mesmo controle do prontuário ao vivo (AcessoPacientePep). Tudo depende da chave pep.prescricao.cpoe (POL-3;
// ficha, seção 12); a reconciliação e a ficha de antimicrobiano têm chaves próprias (podem ser ligadas antes).
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Optional,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  type CabecalhoProntuario,
  type ConsultaCadastroPrescricao,
  CHAVE_LIBERACAO_ANTIMICROBIANO,
  CHAVE_LIBERACAO_PRESCRICAO,
  CHAVE_LIBERACAO_RECONCILIACAO,
  chaveLeitura,
  definicaoParametro,
  esquemaCoassinarPrescricao,
  esquemaIncluirItem,
  esquemaItemPrescricao,
  esquemaPrescrever,
  esquemaPrescricaoFutura,
  esquemaReconciliacao,
  esquemaImprimirDocumentoProntuario,
  esquemaSuspenderItem,
  esquemaSuspenderPrescricao,
  esquemaTermoCadastroPrescricao,
  type FichaAntimicrobiano,
  type FuturaLida,
  type ItemBuscado,
  type LiberacaoProntuario,
  MENSAGENS_PRESCRICAO,
  PARAMETRO_ALTA_VIGILANCIA,
  PARAMETRO_BASE_INTERACOES,
  PARAMETRO_DUPLA_CHECAGEM,
  PARAMETRO_DUPLICIDADE_CRITERIO,
  type PrescricaoGravada,
  type PrescricaoLida,
  type PrescricaoResumo,
  type ProtocoloResumo,
  type ReconciliacaoLida,
  marcaSuporteTecnico,
  recursoDesligado,
  SECOES_CADASTRO_PRESCRICAO,
  TIPOS_ALERTA,
  textoCp1252,
  type ValorParametro,
  type Verificacao,
} from '@sgh/contratos';
import { VinculoSintetico, type VinculoAssistencialPort } from '@sgh/dominio-acesso';
import { camposDoDocumentoPep, TITULOS_PEP } from '@sgh/dominio-documento';
import { recursoLigado, resolverParametro, type SujeitoParametro, valorTipado } from '@sgh/dominio-config';
import {
  aplicabilidade,
  FREQUENCIAS,
  avaliarAlertas,
  impede,
  itemAvaliado,
  linhasDaPrescricaoImpressa,
  receitasDaAlta,
  type ReceitaProposta,
  REGRAS_PADRAO,
  regraJustificativaImpressao,
  vencemNoTurno,
} from '@sgh/dominio-pep';
import { z } from 'zod';
import { TIPOS_FAVORITO_PRESCRICAO } from '@sgh/dominio-pep';
import type { FavoritoPrescritorLido } from './prescricao-propria-favoritos.js';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { reautenticar } from '../../autorizacao/reautenticacao.js';
import { RESOLVEDOR_SESSAO, type ResolvedorSessao } from '../../autorizacao/resolvedor-sessao.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { FONTE_DOCUMENTO, type FonteDocumento } from '../documento/fonte.js';
import type { ServicoSessao } from '../../sessao/servico-sessao.js';
import { ALERTA_AUDITOR, type AlertaAuditor } from '../acesso/alerta.js';
import {
  REGISTRO_EMERGENCIA,
  type RegistroEmergencia,
  VINCULO_ASSISTENCIAL,
} from '../acesso/emergencia.controller.js';
import { SERVICO_SESSAO } from '../acesso/acesso.controller.js';
import {
  contextoOperacao,
  idDaRota,
  problemaDoCadastro,
  sessaoDe,
  type SessaoCadastro,
} from '../cadastro/comum.js';
import { PORTA_CADASTRO, type PortaCadastro } from '../cadastro/porta.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
  TTL_BUSCA_PRESCRICAO_S,
  TTL_CONFIG_NOVO_S,
} from '../config/public-api.js';
import { AcessoPacientePep, chaveSessaoPep } from './acesso-paciente.js';
import { ESTADO_PRONTUARIO } from './prontuario.controller.js';
import type { EstadoProntuario } from './sessao-prontuario.js';
import {
  type PoliticasPrescricao,
  type PrescritorSessao,
  recusaPrescricao,
  detalheParaCopia,
  faixaDoCadastro,
  type ServicoPrescricao,
} from './prescricao-servico.js';

export const SERVICO_PRESCRICAO = Symbol('SERVICO_PRESCRICAO');

const MOTIVOS: Readonly<Record<string, string>> = {
  [CHAVE_LIBERACAO_PRESCRICAO]:
    'A prescrição eletrônica ainda não foi liberada para este estabelecimento ou setor. A liberação é feita pelo administrador em Funcionalidades por estabelecimento; até lá, a prescrição aparece só em consulta.',
  [CHAVE_LIBERACAO_RECONCILIACAO]:
    'A reconciliação medicamentosa ainda não foi liberada para este estabelecimento ou setor (Funcionalidades por estabelecimento).',
  [CHAVE_LIBERACAO_ANTIMICROBIANO]:
    'A ficha de antimicrobiano ainda não foi liberada para este estabelecimento ou setor (Funcionalidades por estabelecimento).',
};
const MOTIVO_SEM_CONFIGURACAO =
  'A configuração das funcionalidades do estabelecimento não está disponível: a funcionalidade fica desligada.';
const MOTIVO_PREREQUISITO =
  'A prescrição eletrônica tem pré-requisito pendente neste estabelecimento: a conferência pelos chave-usuários.';

const esquemaVerificar = z
  .object({
    atendimento: z.number().int().positive(),
    periodo: z.enum(['atual', 'seguinte']),
    itens: z.array(esquemaItemPrescricao).min(1).max(150),
  })
  .strict();

const esquemaRegra = z
  .object({
    senha: z.string().min(1).max(100),
    codigo: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
    tipo: z.enum(TIPOS_ALERTA),
    nivel: z.enum(['aviso', 'justificar', 'bloqueio']),
    vigenteDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ativa: z.boolean(),
    descricao: textoCp1252(500).pipe(z.string().trim().min(5)),
    justificativa: textoCp1252(500).pipe(z.string().trim().min(10)),
  })
  .strict();

const esquemaSimular = z
  .object({
    itens: z.array(esquemaItemPrescricao).min(1).max(30),
    alergiasPrincipios: z.array(z.number().int().positive()).max(30).default([]),
  })
  .strict();

const esquemaFicha = z
  .object({
    paciente: z.number().int().positive(),
    atendimento: z.number().int().positive(),
    produto: z.number().int().positive(),
    prescricao: z.number().int().positive().nullable().default(null),
    item: z.number().int().positive().nullable().default(null),
    indicacao: textoCp1252(500).pipe(z.string().trim().min(3)),
    sitio: textoCp1252(100).pipe(z.string().trim().min(2)),
    tipo: z.enum(['empirico', 'dirigido', 'profilatico']),
    culturaColhida: z.boolean(),
    diaTratamento: z.number().int().min(1).max(180),
    duracaoDias: z.number().int().min(1).max(180).nullable().default(null),
  })
  .strict();

const esquemaFavorito = z
  .object({
    tipo: z.enum(TIPOS_FAVORITO_PRESCRICAO),
    alvo: z.number().int().positive(),
    rotulo: z.string().trim().min(1).max(100).optional(),
    ordem: z.number().int().min(0).max(999).optional(),
  })
  .strict();

const esquemaGrade = z
  .object({
    unidade: z.number().int().positive(),
    classe: textoCp1252(40).pipe(z.string().trim().min(2)),
    numDoses: z.number().int().min(1).max(24),
    horarios: z
      .array(z.string().regex(/^([01]\d|2[0-3])[0-5]\d$/))
      .min(1)
      .max(24),
    vigenteDesde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    ativa: z.boolean(),
  })
  .strict();

const esquemaCancelarFutura = z.object({ motivo: textoCp1252(255).pipe(z.string().trim().min(5)) }).strict();

@Controller()
export class PrescricaoController {
  constructor(
    @Inject(SERVICO_PRESCRICAO) private readonly servico: ServicoPrescricao,
    @Inject(ESTADO_PRONTUARIO) private readonly estado: EstadoProntuario,
    @Inject(PORTA_CADASTRO) private readonly cadastro: PortaCadastro,
    @Inject(RESOLVEDOR_SESSAO) private readonly resolvedor: ResolvedorSessao,
    @Optional() @Inject(SERVICO_SESSAO) private readonly sessoes: ServicoSessao | null = null,
    @Optional() @Inject(FONTE_CONFIGURACAO) private readonly configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) private readonly cache: CacheConfig | null = null,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(ALERTA_AUDITOR) alerta: AlertaAuditor | null = null,
    @Optional()
    @Inject(VINCULO_ASSISTENCIAL)
    private readonly vinculo: VinculoAssistencialPort = new VinculoSintetico(),
    @Optional() @Inject(REGISTRO_EMERGENCIA) private readonly emergencia: RegistroEmergencia | null = null,
    @Optional() @Inject(FONTE_DOCUMENTO) private readonly documento: FonteDocumento | null = null,
  ) {
    this.acesso = new AcessoPacientePep({ estado, trilha, alerta, configuracao, vinculo, emergencia });
  }

  private readonly acesso: AcessoPacientePep;

  // ── Liberação, parâmetros, prescritor ─────────────────────────────────────────────────────────

  private async dadosLiberacao(s: SessaoCadastro) {
    const fonte = this.configuracao;
    if (!fonte) return null;
    const carregar = async () => ({
      chaves: await fonte.chaves(s.rede, s.hospital),
      prerequisitos: await fonte.prerequisitos(s.rede, s.hospital),
    });
    return this.cache
      ? this.cache.lerOuCarregar(
          this.cache.chave(s.rede, s.hospital, 'liberacao'),
          TTL_CONFIG_NOVO_S,
          carregar,
        )
      : carregar();
  }

  private indiceBusca(s: SessaoCadastro) {
    const carregar = () => this.servico.indiceBusca(s.porta);
    return this.cache
      ? this.cache.lerOuCarregar(
          this.cache.chave(s.rede, s.hospital, 'busca-prescricao'),
          TTL_BUSCA_PRESCRICAO_S,
          carregar,
        )
      : carregar();
  }

  private async liberacao(
    s: SessaoCadastro,
    chave = CHAVE_LIBERACAO_PRESCRICAO,
  ): Promise<LiberacaoProntuario> {
    let dados: Awaited<ReturnType<PrescricaoController['dadosLiberacao']>>;
    try {
      dados = await this.dadosLiberacao(s);
    } catch {
      throw new ErroProblema(
        'indisponivel',
        503,
        'Configuração indisponível',
        'Não foi possível conferir a liberação.',
      );
    }
    if (!dados) return { ligada: false, motivo: MOTIVO_SEM_CONFIGURACAO };
    const chaves = dados.chaves
      .filter((c) => c.chave === chave && c.tipo === 'recurso' && c.ligada !== null)
      .map((c) => ({ escopo: c.escopo, valor: c.valor, ligada: c.ligada === true }));
    const declarados = recursoDesligado(chave)?.prerequisitos ?? [];
    const registrados = dados.prerequisitos.filter((p) => p.recurso === chave);
    const setor = s.req.sgh?.sessao.unidadeAtiva;
    const sujeito = {
      pessoa: s.login,
      ...(setor !== null && setor !== undefined ? { setor: String(setor) } : {}),
    };
    if (recursoLigado(chaves, declarados, registrados, sujeito, new Date()))
      return { ligada: true, motivo: null };
    const soPrerequisito = recursoLigado(chaves, [], [], sujeito, new Date());
    return {
      ligada: false,
      motivo: soPrerequisito ? MOTIVO_PREREQUISITO : (MOTIVOS[chave] ?? MOTIVO_SEM_CONFIGURACAO),
    };
  }

  private async exigirLiberacao(s: SessaoCadastro, chave = CHAVE_LIBERACAO_PRESCRICAO): Promise<void> {
    const l = await this.liberacao(s, chave);
    if (!l.ligada)
      throw new ErroProblema('recurso-desligado', 403, 'Funcionalidade desligada', l.motivo ?? '', {
        codigo: 'recurso-desligado',
      });
  }

  private async politicas(s: SessaoCadastro): Promise<PoliticasPrescricao> {
    let valores: ValorParametro[] = [];
    try {
      valores = this.configuracao ? await this.configuracao.valoresParametro(s.rede, s.hospital) : [];
    } catch {
      valores = [];
    }
    const setor = s.req.sgh?.sessao.unidadeAtiva;
    const sujeito: SujeitoParametro = {
      rede: s.rede,
      empresa: null,
      estabelecimento: s.hospital,
      unidade: setor === null || setor === undefined ? null : String(setor),
      perfis: [],
      usuario: s.login,
    };
    const ler = (chave: string) => {
      const def = definicaoParametro(chave);
      return def ? valorTipado(def, resolverParametro(def, valores, sujeito, new Date()).valor) : null;
    };
    const lista = String(ler(PARAMETRO_ALTA_VIGILANCIA) ?? '');
    const crit = String(ler(PARAMETRO_DUPLICIDADE_CRITERIO) ?? 'ambos');
    return {
      baseInteracoes: ler(PARAMETRO_BASE_INTERACOES) === true,
      altaVigilancia: new Set(
        lista
          .split(',')
          .map((x) => Number(x.trim()))
          .filter((x) => Number.isInteger(x) && x > 0),
      ),
      duplaChecagem: ler(PARAMETRO_DUPLA_CHECAGEM) !== false,
      criterioDuplicidade: crit === 'medicamento' || crit === 'principio-ativo' ? crit : 'ambos',
    };
  }

  private async prescritor(s: SessaoCadastro): Promise<PrescritorSessao> {
    const p = await this.servico.prescritor(s.porta, s.login);
    if (!p)
      throw recusaPrescricao(
        'sem-ocupacao',
        403,
        'Sem ocupação no cadastro de profissionais',
        'O seu usuário não tem CBO ativo no cadastro de profissionais: não é possível prescrever.',
      );
    return p;
  }

  /** Paciente deste estabelecimento (404 igual para inexistente e de outro banco). */
  private async paciente(s: SessaoCadastro, paciente: number): Promise<CabecalhoProntuario> {
    const [p] = await this.cadastro.lerPacientes(s.porta, [paciente]);
    if (!p) throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado');
    return {
      paciente: p.id,
      prontuario: p.prontuario,
      nome: p.nome,
      nomeSocial: p.nomeSocial,
      nascimento: p.nascimento,
      sexo: p.sexo,
      obito: p.obito !== null,
      estabelecimento: s.hospital,
    };
  }

  private async exigirAcesso(
    s: SessaoCadastro,
    paciente: number,
    permissao: string,
    leitura: boolean,
  ): Promise<void> {
    await this.acesso.exigirVinculo(s, paciente, permissao, 'pep.prescricao');
    if (leitura) {
      const chave = chaveSessaoPep(s);
      if (!this.estado.motivo(chave, paciente)) this.estado.registrarMotivo(chave, paciente, 'assistencia');
      await this.acesso.registrarLeitura(
        s,
        paciente,
        'registro',
        this.estado.motivo(chave, paciente) ?? 'assistencia',
        'pep.prescricao',
      );
    }
  }

  private async reautenticado(req: RequisicaoAutorizada, senha: string): Promise<number> {
    return this.servico.destino === 'memoria' && !req.sgh?.real
      ? Date.now()
      : reautenticar(this.sessoes, this.resolvedor, req, senha);
  }

  // ── Leituras do editor ────────────────────────────────────────────────────────────────────────

  @Get('pep/prescricao/liberacao')
  @Permissao('pep.prescricao.ler')
  async liberacaoDaSessao(@Req() req: RequisicaoAutorizada): Promise<
    LiberacaoProntuario & {
      reconciliacao: LiberacaoProntuario;
      antimicrobiano: LiberacaoProntuario;
      gravacao: { pode: boolean; motivo: string | null };
    }
  > {
    const s = sessaoDe(req);
    const l = await this.liberacao(s);
    const g = await this.servico
      .podeGravar(s.porta, 'pep.prescrever', s.login)
      .catch(() => ({ pode: false, motivo: null }));
    return {
      ...l,
      reconciliacao: await this.liberacao(s, CHAVE_LIBERACAO_RECONCILIACAO),
      antimicrobiano: await this.liberacao(s, CHAVE_LIBERACAO_ANTIMICROBIANO),
      gravacao: { pode: g.pode, motivo: g.motivo ?? null },
    };
  }

  @Get('pep/prescricao/dominios')
  @Permissao('pep.cadastroPrescricao.ler')
  async dominios(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    exigirAlguma(s, ['pep.prescricao.ler', 'pep.frequenciaDose.ler']);
    const d = await this.servico.portaDados.dominios(s.porta);
    const relativos = await this.servico.portaDados.relativos(s.porta);
    return {
      ...d,
      frequencias: FREQUENCIAS.map((f) => ({ id: String(f.id), nome: f.nome, grupo: f.natureza })),
      relativos: relativos.map((r) => ({
        id: String(r.id),
        nome: r.nome,
        grupo: `${r.horario.slice(0, 2)}:${r.horario.slice(2)}`,
      })),
    };
  }

  @Get('pep/prescricao/produtos')
  @Permissao('pep.prescricao.criar')
  async produtos(
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ItemBuscado[]> {
    const s = sessaoDe(req);
    // Ficha, seção 4: a busca no índice sem acento do cache (Valkey, 5 minutos; recarregado do banco), nunca no
    // banco a cada tecla; os 30 primeiros (padronizado primeiro) e os dados do cadastro deles.
    const ps = this.servico.buscarProdutos(String(termo ?? '').slice(0, 60), await this.indiceBusca(s));
    const pol = await this.politicas(s);
    return ps.map((p) => ({
      produto: p.produto,
      nome: p.nome,
      unidade: p.unidade,
      padronizado: p.padronizado,
      principiosAtivos: p.principios.map((x) => ({ ...x })),
      altoAlerta: p.potencialmentePerigoso || pol.altaVigilancia.has(p.produto),
      controlado: p.psicotropico || p.portaria !== null,
      antimicrobiano: p.antimicrobiano,
      doseMinima: faixaDoCadastro(p).doseMinima,
      doseMaxima: faixaDoCadastro(p).doseMaxima,
    }));
  }

  /**
   * Protocolos com a aplicabilidade (ficha, seção 4: especialidade, faixa de idade e de peso, sexo, vigência). Com
   * `?paciente=`, a idade, o peso e o sexo do paciente (o dado mais recente do cadastro) e a especialidade do
   * prescritor; sem o paciente (a consulta do cadastro), só a situação e a vigência.
   */
  @Get('pep/prescricao/protocolos')
  @Permissao('pep.cadastroPrescricao.ler')
  async protocolos(
    @Query('paciente') pq: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ProtocoloResumo[]> {
    const s = sessaoDe(req);
    // O editor (com o paciente) é de quem prescreve; a consulta do cadastro, de quem tem o cadastro de protocolos.
    exigirAlguma(s, pq ? ['pep.prescricao.criar'] : ['pep.prescricao.criar', 'pep.protocoloPrescricao.ler']);
    const agora = await this.servico.agora(s.porta);
    const hoje = agora.slice(0, 10);
    let pac: { idade: number | null; peso: number | null; sexo: 'F' | 'M' | null } = {
      idade: null,
      peso: null,
      sexo: null,
    };
    let especialidades: number[] | null = null;
    if (pq !== undefined && pq !== '') {
      const paciente = idDaRota(pq);
      await this.paciente(s, paciente);
      await this.exigirAcesso(s, paciente, 'pep.prescricao.criar', false);
      const d = await this.servico.dadosClinicos(s.porta, paciente, agora);
      pac = { idade: d.idadeAnos, peso: d.pesoKg, sexo: d.sexo };
      especialidades = await this.servico.portaDados.especialidadesDoPrescritor(s.porta, s.login);
    }
    const ps = await this.servico.portaDados.protocolos(s.porta);
    return ps.map((p) => {
      const a = aplicabilidade(p, pac, hoje, especialidades);
      return {
        id: p.id,
        nome: p.nome,
        tipo: 'protocolo' as const,
        itens: p.itens,
        aplicavel: a.aplicavel,
        motivo: a.motivo,
      };
    });
  }

  /**
   * Cadastros de prescrição em consulta (kits de medicamento e de solução, receitas padrão, itens não padronizados e
   * os parâmetros clínicos e fiscais do item, este pela busca do item): dado de cadastro, sem paciente.
   */
  @Get('pep/prescricao/cadastros/:secao')
  @Permissao('pep.cadastroPrescricao.ler')
  async cadastroPrescricao(
    @Param('secao') secao: string,
    @Query('termo') termo: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ConsultaCadastroPrescricao> {
    const s = sessaoDe(req);
    const sec = z.enum(SECOES_CADASTRO_PRESCRICAO).safeParse(secao);
    if (!sec.success) throw new ErroProblema('nao-encontrado', 404, 'Cadastro não encontrado');
    // Cada cadastro pela permissão dele (quem tem a opção do cadastro no legado tem a consulta no novo).
    exigirAlguma(s, [PERMISSAO_DA_SECAO[sec.data]]);
    const e = esquemaTermoCadastroPrescricao.safeParse(termo === undefined ? {} : { termo });
    if (!e.success) throw entradaInvalida(e.error.issues);
    const r = await this.servico.portaDados.cadastro(s.porta, sec.data, e.data.termo);
    return { secao: sec.data, linhas: r.linhas, truncada: r.truncada };
  }

  @Get('pep/prescricao/protocolos/:id/itens')
  @Permissao('pep.cadastroPrescricao.ler')
  async itensProtocolo(@Param('id') i: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    exigirAlguma(s, ['pep.prescricao.criar', 'pep.protocoloPrescricao.ler']);
    const itens = await this.servico.portaDados.itensDoProtocolo(s.porta, idDaRota(i));
    return itens.map((x) => ({
      id: x.id,
      plano: x.plano,
      planoNome: x.planoNome,
      frequencia: x.frequencia,
      frequenciaNome: x.frequenciaNome,
      via: x.via,
      detalhe: x.detalhe,
      sugestao: detalheParaCopia(x),
    }));
  }

  @Get('pep/prescricao/:paciente/contexto')
  @Permissao('pep.prescricao.ler')
  @Auditar('pep.prescricao.lida')
  async contexto(@Param('paciente') p: string, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    const cabecalho = await this.paciente(s, paciente);
    // Leitura clínica (peso, creatinina com a data, clearance, unidade e leito): a mesma trilha das outras leituras
    // do paciente (a Consulta do RES na primeira, falha fechada sem a trilha, conta para os alertas de leitura).
    await this.exigirAcesso(s, paciente, 'pep.prescricao.ler', true);
    const agora = await this.servico.agora(s.porta);
    const r = await this.servico.contexto(s.porta, paciente, s.login, agora);
    const pol = await this.politicas(s);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'atendimento',
      chaveNaturalAlvo: chaveLeitura('registro', 'assistencia', `contexto;n:${r.atendimentos.length}`),
    };
    return {
      ...r,
      cabecalho,
      liberacao: await this.liberacao(s),
      baseInteracoes: pol.baseInteracoes ? 'contratada' : 'nao-contratada',
      podeCriar: s.pode('pep.prescricao.criar'),
      podeSuspender: s.pode('pep.prescricao.suspender'),
      podeRenovar: s.pode('pep.prescricao.renovar'),
      podeCoassinar: s.pode('pep.prescricao.coassinar'),
    };
  }

  @Get('pep/prescricao/:paciente/atendimentos/:atendimento')
  @Permissao('pep.prescricao.ler')
  @Auditar('pep.prescricao.lida')
  async prescricoes(
    @Param('paciente') p: string,
    @Param('atendimento') a: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PrescricaoResumo[]> {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.prescricao.ler', true);
    const r = await this.servico.prescricoes(s.porta, paciente, idDaRota(a));
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'prescricao',
      chaveNaturalAlvo: chaveLeitura('registro', 'assistencia', `n:${r.length}`),
    };
    return r;
  }

  @Get('pep/prescricao/:paciente/prescricoes/:id')
  @Permissao('pep.prescricao.ler')
  @Auditar('pep.prescricao.lida')
  async lerPrescricao(
    @Param('paciente') p: string,
    @Param('id') i: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PrescricaoLida> {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    const id = idDaRota(i);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.prescricao.ler', true);
    const r = await this.servico.lerPrescricao(s.porta, paciente, id);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'prescricao',
      idAlvo: String(id),
      chaveNaturalAlvo: chaveLeitura('registro', 'assistencia'),
    };
    return r;
  }

  /**
   * Regra 15 (ficha do M24): na alta e no ambulatório, os medicamentos ativos da prescrição viram as receitas do
   * receituário do prontuário (M23) no receituário certo de cada um — simples, antimicrobiano e controle especial por
   * lista da Portaria 344/98 (a notificação das listas A e B é avisada: talão, à mão). Aqui só a proposta; a emissão
   * é a do receituário (`POST /api/pep/paciente/:p/receitas`, com a permissão e a trilha dele). Leitura auditada.
   */
  @Get('pep/prescricao/:paciente/prescricoes/:id/receita-alta')
  @Permissao('pep.prescricao.ler')
  @Auditar('pep.prescricao.lida')
  async receitaDaAlta(
    @Param('paciente') p: string,
    @Param('id') i: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ atendimento: number; receitas: ReceitaProposta[] }> {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    const id = idDaRota(i);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.prescricao.ler', true);
    const r = await this.servico.lerPrescricao(s.porta, paciente, id);
    const meds = r.itensLidos.filter((x) => x.tipo === 'medicamento');
    const produtos = new Map(
      (
        await this.servico.portaDados.produtos(
          s.porta,
          meds.map((x) => x.produto ?? 0).filter((x) => x > 0),
        )
      ).map((x) => [x.produto, x]),
    );
    const receitas = receitasDaAlta(
      r.itensLidos.map((x) => {
        const pr = x.produto !== null ? produtos.get(x.produto) : undefined;
        return {
          id: x.id,
          medicamento: x.tipo === 'medicamento',
          ativo: x.situacao === 'ativo',
          descricao: pr?.nome ?? x.descricao,
          dose: x.dose,
          via: x.via,
          frequencia: x.frequencia,
          controlado: pr && (pr.psicotropico || pr.portaria !== null) ? (pr.portaria ?? '') : null,
          antimicrobiano: pr?.antimicrobiano ?? false,
        };
      }),
    );
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'prescricao',
      idAlvo: String(id),
      chaveNaturalAlvo: chaveLeitura('registro', 'assistencia', `receita-alta;n:${receitas.length}`),
    };
    return { atendimento: r.atendimento, receitas };
  }

  /**
   * Prescrição impressa (ficha, seção 10 "Documento"): PDF/A pelo serviço de emissão (M09), com os itens, os horários
   * previstos e a situação de cada um; a reimpressão sai como 2ª via com o motivo. Leitura auditada.
   */
  @Post('pep/prescricao/:paciente/prescricoes/:id/imprimir')
  @HttpCode(200)
  @Permissao('pep.prescricao.ler')
  @Auditar('pep.prescricao.lida')
  @Header('content-type', 'application/pdf')
  async imprimirPrescricao(
    @Param('paciente') p: string,
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
    @Res({ passthrough: true }) res: { header(n: string, v: string): unknown },
  ): Promise<Buffer> {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    const id = idDaRota(i);
    const pac = await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.prescricao.ler', true);
    const r = await this.servico.lerPrescricao(s.porta, paciente, id);
    const fonte = this.documento;
    if (!fonte)
      throw new ErroProblema(
        'indisponivel',
        503,
        'Emissão indisponível',
        'O serviço de emissão de documentos não está configurado: use a impressão da tela.',
      );
    const br = (x: string) => x.slice(0, 16).replace('T', ' ');
    const campos = camposDoDocumentoPep({
      modelo: 'prescricao',
      identificacao: {
        paciente: pac.nomeSocial ?? pac.nome,
        prontuario: String(pac.prontuario),
        nascimento: pac.nascimento ? pac.nascimento.slice(0, 10) : null,
        atendimento: String(r.atendimento),
        profissional: r.prescritor,
        conselho: null,
        dataHora: br(r.dataHora),
      },
      corpo: linhasDaPrescricaoImpressa(
        r.itensLidos.map((x) => ({ ...x, horarios: x.horarios.map((h) => ({ ...h })) })),
        r.observacaoGeral,
      ),
      extras: [
        { rotulo: 'Vigência', valor: `${br(r.vigencia.inicio)} a ${br(r.vigencia.fim)}` },
        { rotulo: 'Situação', valor: SITUACAO_IMPRESSA[r.situacao] },
      ],
    });
    const marca = req.sghComo ? marcaSuporteTecnico(req.sghComo.alvoNome) : null;
    try {
      // A reimpressão é 2ª via pelo registro das emissões (a 1ª via da mesma prescrição neste estabelecimento).
      const original = await fonte.emissao.originalDaOrigem(s.hospital, 'prescricao', {
        tipo: 'prescricao',
        idLegado: id,
      });
      const anterior = original?.id ?? null;
      // 01-ADM L82: a impressão da prescrição também diz por quê (1ª via: justificativa; nova via: motivo), e o
      // texto fica gravado na própria emissão.
      const porque = justificativaDaImpressao(corpo, anterior !== null);
      const e = anterior
        ? await fonte.emissao.segundaVia(anterior, porque, {
            titulo: TITULOS_PEP.prescricao,
            campos,
            autor: s.login,
            marcaSuporte: marca,
          })
        : await fonte.emissao.emitir({
            rede: s.rede,
            estabelecimento: s.hospital,
            modelo: 'prescricao',
            versaoModelo: '1',
            titulo: TITULOS_PEP.prescricao,
            origem: { tipo: 'prescricao', idLegado: id },
            campos,
            autor: s.login,
            marcaSuporte: marca,
            justificativa: porque,
          });
      req.sghAlvo = {
        paciente,
        tabelaAlvo: 'prescricao',
        idAlvo: String(id),
        chaveNaturalAlvo: `impresso:prescricao;via:${e.emissao.via}`,
      };
      res.header('content-disposition', `inline; filename="prescricao-${id}-via${e.emissao.via}.pdf"`);
      return Buffer.from(e.pdf);
    } catch (x) {
      if (x instanceof ErroProblema) throw x;
      throw new ErroProblema(
        'indisponivel',
        503,
        'Emissão indisponível',
        'Não foi possível gerar o PDF agora: use a impressão da tela. A prescrição continua gravada.',
      );
    }
  }

  // ── Verificar e gravar ────────────────────────────────────────────────────────────────────────

  @Post('pep/prescricao/:paciente/verificar')
  @HttpCode(200)
  @Permissao('pep.prescricao.criar')
  @Auditar('pep.prescricao.verificada')
  async verificar(
    @Param('paciente') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<Verificacao> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    const e = esquemaVerificar.safeParse(corpo);
    if (!e.success) throw entradaInvalida(e.error.issues);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.prescricao.criar', false);
    const r = await this.servico.verificar(
      s.porta,
      paciente,
      e.data,
      await this.prescritor(s),
      await this.politicas(s),
    );
    const v: Verificacao = {
      alertas: r.alertas,
      impede: r.impede,
      horarios: r.horarios,
      vigencia: r.vigencia,
      baseInteracoes: r.baseInteracoes,
    };
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'prescricao',
      chaveNaturalAlvo: `parte:verificacao;alertas:${v.alertas.length}`,
    };
    return v;
  }

  @Post('pep/prescricao/:paciente/prescrever')
  @HttpCode(201)
  @Permissao('pep.prescricao.assinar')
  @AuditadoNoHandler(
    'pep.prescrever: trilha dupla, SGH_ da prova e SGH_IDEMPOTENCIA na mesma transação (executor)',
  )
  async prescrever(
    @Param('paciente') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PrescricaoGravada> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    const e = esquemaPrescrever.safeParse({ ...(corpo as object), paciente });
    if (!e.success) throw entradaInvalida(e.error.issues);
    if (!s.pode('pep.prescricao.criar'))
      throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite prescrever.');
    if (e.data.origem && !s.pode('pep.prescricao.renovar'))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'Seu perfil não permite copiar ou renovar a prescrição.',
      );
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.prescricao.criar', false);
    const prescritor = await this.prescritor(s);
    const m = await this.servico.montarPrescricao(s.porta, e.data, prescritor, await this.politicas(s), {
      comoSuporte: req.sghComo !== undefined,
    });
    try {
      const r = await this.servico.prescrever(
        s.porta,
        m.operacao,
        m.gravacao,
        contextoOperacao(s, 'prescricao'),
      );
      return {
        prescricao: r.prescricao,
        vigencia: m.gravacao.vigencia,
        itens: m.gravacao.itens.length,
        horarios: r.horarios,
      };
    } catch (x) {
      throw problemaDaPrescricao(x);
    }
  }

  @Post('pep/prescricao/:paciente/prescricoes/:id/itens')
  @HttpCode(201)
  @Permissao('pep.prescricao.criar')
  @AuditadoNoHandler('pep.incluirItem: trilha dupla e SGH_IDEMPOTENCIA na mesma transação (executor)')
  async incluirItem(
    @Param('paciente') p: string,
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ item: number }> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    const e = esquemaIncluirItem.safeParse({ ...(corpo as object), prescricao: idDaRota(i) });
    if (!e.success) throw entradaInvalida(e.error.issues);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.prescricao.criar', false);
    const g = await this.servico.montarInclusao(
      s.porta,
      paciente,
      e.data,
      await this.prescritor(s),
      await this.politicas(s),
      req.sghComo !== undefined,
    );
    try {
      return await this.servico.incluirItem(s.porta, g, contextoOperacao(s, 'inclusao'));
    } catch (x) {
      throw problemaDaPrescricao(x);
    }
  }

  @Post('pep/prescricao/:paciente/prescricoes/:id/itens/:item/suspender')
  @HttpCode(200)
  @Permissao('pep.prescricao.suspender')
  @AuditadoNoHandler('pep.suspenderItem: trilha dupla e SGH_IDEMPOTENCIA na mesma transação (executor)')
  async suspenderItem(
    @Param('paciente') p: string,
    @Param('id') i: string,
    @Param('item') it: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ horarios: number }> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    const e = esquemaSuspenderItem.safeParse({
      ...(corpo as object),
      prescricao: idDaRota(i),
      item: idDaRota(it),
    });
    if (!e.success) throw entradaInvalida(e.error.issues);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.prescricao.suspender', false);
    const reautenticadoEm = await this.reautenticado(req, e.data.senha);
    const g = await this.servico.montarSuspensaoItem(
      s.porta,
      paciente,
      e.data.prescricao,
      e.data.item,
      e.data.justificativa,
      e.data.correcao,
      await this.prescritor(s),
      await this.politicas(s),
      req.sghComo !== undefined,
    );
    try {
      return await this.servico.suspenderItem(s.porta, g, {
        ...contextoOperacao(s, 'suspensao-item'),
        reautenticadoEm,
      });
    } catch (x) {
      throw problemaDaPrescricao(x);
    }
  }

  @Post('pep/prescricao/:paciente/prescricoes/:id/suspender')
  @HttpCode(200)
  @Permissao('pep.prescricao.suspender')
  @AuditadoNoHandler('pep.suspenderPrescricao: trilha dupla e SGH_IDEMPOTENCIA na mesma transação (executor)')
  async suspenderPrescricao(
    @Param('paciente') p: string,
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ horarios: number }> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    const e = esquemaSuspenderPrescricao.safeParse({ ...(corpo as object), prescricao: idDaRota(i) });
    if (!e.success) throw entradaInvalida(e.error.issues);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.prescricao.suspender', false);
    const reautenticadoEm = await this.reautenticado(req, e.data.senha);
    const g = await this.servico.montarSuspensaoPrescricao(
      s.porta,
      paciente,
      e.data.prescricao,
      e.data.justificativa,
      await this.prescritor(s),
      req.sghComo !== undefined,
    );
    try {
      return await this.servico.suspenderPrescricao(s.porta, g, {
        ...contextoOperacao(s, 'suspensao'),
        reautenticadoEm,
      });
    } catch (x) {
      throw problemaDaPrescricao(x);
    }
  }

  @Post('pep/prescricao/:paciente/prescricoes/:id/coassinar')
  @HttpCode(200)
  @Permissao('pep.prescricao.coassinar')
  @Auditar('pep.prescricao.coassinada')
  async coassinar(
    @Param('paciente') p: string,
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    const e = esquemaCoassinarPrescricao.safeParse({ ...(corpo as object), prescricao: idDaRota(i) });
    if (!e.success) throw entradaInvalida(e.error.issues);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.prescricao.coassinar', false);
    await this.reautenticado(req, e.data.senha);
    const quem = await this.prescritor(s);
    if (quem.categoria !== 'medico')
      throw recusaPrescricao(
        'categoria-nao-coassina',
        403,
        'Só o médico preceptor coassina',
        'A coassinatura é do médico preceptor.',
      );
    await this.servico.coassinar(s.porta, paciente, e.data.prescricao, s.login);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'prescricao',
      idAlvo: String(e.data.prescricao),
      chaveNaturalAlvo: 'coassinatura',
    };
    return { ok: true };
  }

  // ── Prescrição futura e reconciliação (só no novo) ───────────────────────────────────────────

  @Get('pep/prescricao/:paciente/futuras')
  @Permissao('pep.prescricao.ler')
  @Auditar('pep.prescricao.lida')
  async futuras(
    @Param('paciente') p: string,
    @Query('atendimento') a: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    futuras: FuturaLida[];
    planejamentosAntigos: { id: number; inicio: string | null; fim: string | null }[];
  }> {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.prescricao.ler', true);
    const atendimento = idDaRota(a);
    await this.servico.atendimento(s.porta, paciente, atendimento);
    const fs = await this.servico.portaDados.futuras(s.porta, atendimento);
    const antigos = await this.servico.portaDados.planejamentosAntigos(s.porta, paciente);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'SGH_PEP_PRESC_FUTURA',
      chaveNaturalAlvo: `parte:futuras;n:${fs.length}`,
    };
    return {
      futuras: fs.map((f) => ({
        id: f.id,
        aPartirDe: f.aPartirDe,
        descricao: f.descricao,
        situacao: f.situacao,
        prescricao: f.prescricao,
        item: esquemaItemPrescricao.parse(JSON.parse(f.itemJson ?? '{}')),
      })),
      planejamentosAntigos: antigos,
    };
  }

  @Post('pep/prescricao/:paciente/futuras')
  @HttpCode(201)
  @Permissao('pep.prescricao.criar')
  @Auditar('pep.prescricaoFutura.gravada')
  async programarFutura(
    @Param('paciente') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number }> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    const e = esquemaPrescricaoFutura.safeParse({ ...(corpo as object), paciente });
    if (!e.success) throw entradaInvalida(e.error.issues);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.prescricao.criar', false);
    await this.servico.atendimento(s.porta, paciente, e.data.atendimento);
    const id = await this.servico.portaDados.programarFutura(s.porta, s.login, {
      atendimento: e.data.atendimento,
      paciente,
      aPartirDe: e.data.aPartirDe,
      descricao: descricaoCurta(e.data.item),
      itemJson: JSON.stringify(e.data.item),
      motivo: e.data.motivo ?? null,
    });
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'SGH_PEP_PRESC_FUTURA',
      idAlvo: String(id),
      chaveNaturalAlvo: 'programada',
    };
    return { id };
  }

  @Post('pep/prescricao/:paciente/futuras/:id/cancelar')
  @HttpCode(200)
  @Permissao('pep.prescricao.criar')
  @Auditar('pep.prescricaoFutura.gravada')
  async cancelarFutura(
    @Param('paciente') p: string,
    @Param('id') i: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ ok: true }> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s);
    const paciente = idDaRota(p);
    const e = esquemaCancelarFutura.safeParse(corpo);
    if (!e.success) throw entradaInvalida(e.error.issues);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.prescricao.criar', false);
    try {
      await this.servico.portaDados.cancelarFutura(s.porta, s.login, paciente, idDaRota(i), e.data.motivo);
    } catch (x) {
      throw problemaDaPrescricao(x);
    }
    req.sghAlvo = { paciente, tabelaAlvo: 'SGH_PEP_PRESC_FUTURA', idAlvo: i, chaveNaturalAlvo: 'cancelada' };
    return { ok: true };
  }

  @Get('pep/prescricao/:paciente/reconciliacao')
  @Permissao('pep.reconciliacao.ler')
  @Auditar('pep.prescricao.lida')
  async reconciliacao(
    @Param('paciente') p: string,
    @Query('atendimento') a: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ReconciliacaoLida[]> {
    const s = sessaoDe(req);
    const paciente = idDaRota(p);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.reconciliacao.ler', true);
    const atendimento = idDaRota(a);
    await this.servico.atendimento(s.porta, paciente, atendimento);
    const rs = await this.servico.portaDados.reconciliacoes(s.porta, atendimento);
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'SGH_PEP_RECONCILIACAO',
      chaveNaturalAlvo: `parte:reconciliacao;n:${rs.length}`,
    };
    return rs.map((r) => ({
      id: r.lote,
      momento: r.momento,
      registradoEm: r.em ?? '',
      registradoPor: r.usuario,
      medicamentos: r.linhas.map((x) => ({
        descricao: x.descricao,
        ...(x.produto ? { produto: x.produto } : {}),
        ...(x.dose ? { dose: x.dose } : {}),
        ...(x.frequencia ? { frequencia: x.frequencia } : {}),
        fonte: x.fonte as 'paciente',
        conduta: x.conduta as 'manter',
        ...(x.justificativa ? { justificativa: x.justificativa } : {}),
        ...(x.item ? { itemPrescricao: x.item } : {}),
      })),
    }));
  }

  @Post('pep/prescricao/:paciente/reconciliacao')
  @HttpCode(201)
  @Permissao('pep.reconciliacao.registrar')
  @Auditar('pep.reconciliacao.registrada')
  async registrarReconciliacao(
    @Param('paciente') p: string,
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ lote: number }> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s, CHAVE_LIBERACAO_RECONCILIACAO);
    const paciente = idDaRota(p);
    const e = esquemaReconciliacao.safeParse({ ...(corpo as object), paciente });
    if (!e.success) throw entradaInvalida(e.error.issues);
    await this.paciente(s, paciente);
    await this.exigirAcesso(s, paciente, 'pep.reconciliacao.registrar', false);
    await this.servico.atendimento(s.porta, paciente, e.data.atendimento);
    for (const m of e.data.medicamentos)
      if (
        (m.conduta === 'suspender' || m.conduta === 'substituir') &&
        (m.justificativa ?? '').trim().length < 5
      )
        throw new ErroProblema(
          'entrada-invalida',
          400,
          'Justificativa necessária',
          'Suspender ou substituir pede a justificativa.',
        );
    for (const it of new Set(e.data.medicamentos.map((m) => m.itemPrescricao ?? null)))
      await this.servico.conferirLigacao(s.porta, e.data.atendimento, null, it);
    const lote = await this.servico.portaDados.registrarReconciliacao(s.porta, s.login, {
      atendimento: e.data.atendimento,
      paciente,
      momento: e.data.momento,
      linhas: e.data.medicamentos.map((m) => ({
        descricao: m.descricao,
        produto: m.produto ?? null,
        dose: m.dose ?? null,
        frequencia: m.frequencia ?? null,
        fonte: m.fonte,
        conduta: m.conduta,
        justificativa: m.justificativa ?? null,
        item: m.itemPrescricao ?? null,
      })),
    });
    req.sghAlvo = {
      paciente,
      tabelaAlvo: 'SGH_PEP_RECONCILIACAO',
      idAlvo: String(lote),
      chaveNaturalAlvo: `n:${e.data.medicamentos.length}`,
    };
    return { lote };
  }

  /**
   * As que vencem no turno (ficha, seção 4: unidade + fim de vigência; worklist do M27), com o paciente, a unidade, o
   * leito e o link para renovar. Com a restrição por vínculo ligada no estabelecimento, só os pacientes com vínculo
   * (ou quebra de vidro vigente) do login: a lista não fura o controle de acesso.
   */
  @Get('pep/prescricao/a-renovar')
  @Permissao('pep.prescricao.ler')
  @Auditar('pep.prescricao.lida')
  async aRenovar(
    @Query('horas') h: string | undefined,
    @Query('unidade') u: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ) {
    const s = sessaoDe(req);
    const agora = await this.servico.agora(s.porta);
    const horas = Math.min(Math.max(Number(h ?? 6) || 6, 1), 24);
    const unidade = u === undefined || u === '' ? null : idDaRota(u);
    const ate = new Date(new Date(`${agora.slice(0, 19)}Z`).getTime() + horas * 3_600_000)
      .toISOString()
      .slice(0, 19);
    const r = await this.servico.portaDados.vencemAte(s.porta, agora, ate, unidade);
    const porId = new Map(r.map((x) => [x.prescricao, x]));
    const lista = vencemNoTurno(
      r.map((x) => ({
        id: x.prescricao,
        atendimento: x.atendimento,
        vigencia: { inicio: '0000-01-01T00:00', fim: x.fim ?? '' },
        suspensa: false,
      })),
      agora.slice(0, 16),
      ate.slice(0, 16),
    );
    const permitidos = await this.pacientesComVinculo(
      s,
      lista.map((x) => porId.get(x.id)?.paciente ?? 0),
    );
    const visiveis = lista.filter((x) => permitidos.has(porId.get(x.id)?.paciente ?? 0));
    req.sghAlvo = {
      tabelaAlvo: 'prescricao',
      chaveNaturalAlvo: `parte:a-renovar;n:${visiveis.length};pacientes:${permitidos.size}`,
    };
    return visiveis.map((x) => {
      const v = porId.get(x.id)!;
      return {
        prescricao: x.id,
        atendimento: x.atendimento,
        fim: x.vigencia.fim,
        paciente: v.paciente,
        nome: v.nomeSocial ?? v.nome ?? '',
        unidade: v.unidade,
        unidadeNome: v.unidadeNome,
        leito: v.leito,
      };
    });
  }

  /**
   * Os pacientes da lista que o login pode ver: todos, sem a restrição por vínculo no estabelecimento; com ela, só os
   * com vínculo assistencial ou quebra de vidro vigente (a mesma regra do prontuário ao vivo, M06).
   */
  private async pacientesComVinculo(s: SessaoCadastro, pacientes: readonly number[]): Promise<Set<number>> {
    const unicos = [...new Set(pacientes.filter((p) => p > 0))];
    if (s.req.sgh?.sessao.restricaoVinculo !== true) return new Set(unicos);
    const ok = new Set<number>();
    for (const p of unicos) {
      const [forma, vigente] = await Promise.all([
        this.vinculo.vinculo(s.login, { idPaciente: p }),
        this.emergencia ? this.emergencia.vigente(s.hospital, s.login, p) : Promise.resolve(null),
      ]);
      if (forma !== null || vigente !== null) ok.add(p);
    }
    return ok;
  }

  // ── Farmácia clínica ──────────────────────────────────────────────────────────────────────────

  @Get('farmacia-clinica/regras')
  @Permissao('pep.regraAlerta.ler')
  async regras(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const sgh = await this.servico.portaDados.regrasAlerta(s.porta);
    const pol = await this.politicas(s);
    return {
      padrao: REGRAS_PADRAO,
      versoes: sgh,
      baseInteracoes: pol.baseInteracoes ? 'contratada' : 'nao-contratada',
    };
  }

  @Post('farmacia-clinica/regras')
  @HttpCode(201)
  @Permissao('pep.regraAlerta.editar')
  @Auditar('pep.regraAlerta.alterada')
  async gravarRegra(
    @Body() corpo: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ id: number; versao: number }> {
    const s = sessaoDe(req);
    const e = esquemaRegra.safeParse(corpo);
    if (!e.success) throw entradaInvalida(e.error.issues);
    await this.reautenticado(req, e.data.senha);
    const r = await this.servico.portaDados.gravarRegra(s.porta, s.login, {
      codigo: e.data.codigo,
      tipo: e.data.tipo,
      nivel: e.data.nivel,
      vigenteDesde: e.data.vigenteDesde,
      ativa: e.data.ativa,
      descricao: e.data.descricao,
      justificativa: e.data.justificativa,
    });
    req.sghAlvo = {
      tabelaAlvo: 'SGH_PEP_REGRA_ALERTA',
      idAlvo: String(r.id),
      chaveNaturalAlvo: `${e.data.codigo}:v${r.versao}`,
    };
    return r;
  }

  @Post('farmacia-clinica/simular')
  @HttpCode(200)
  @Permissao('pep.regraAlerta.ler')
  @Auditar('pep.prescricao.verificada')
  async simular(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    const e = esquemaSimular.safeParse(corpo);
    if (!e.success) throw entradaInvalida(e.error.issues);
    const pol = await this.politicas(s);
    const ids = e.data.itens.flatMap((i) =>
      i.detalhe.tipo === 'medicamento' ? [i.detalhe.item.produto] : [],
    );
    const lidos = await this.servico.portaDados.produtos(s.porta, ids);
    const produtos = new Map(
      lidos.map((p) => [
        p.produto,
        {
          produto: p.produto,
          nome: p.nome,
          principiosAtivos: p.principios.map((x) => x.id),
          padronizado: p.padronizado,
          altoAlerta: p.potencialmentePerigoso || pol.altaVigilancia.has(p.produto),
          controlado: p.psicotropico || p.portaria ? (p.portaria ?? '') : null,
          antimicrobiano: p.antimicrobiano,
          ...faixaDoCadastro(p),
          periodoMinimoHoras: p.periodoMinimoHoras,
          viasPermitidas: p.vias,
        },
      ]),
    );
    const sgh = await this.servico.portaDados.regrasAlerta(s.porta);
    const hoje = (await this.servico.agora(s.porta)).slice(0, 10);
    const interacoes = pol.baseInteracoes
      ? await this.servico.portaDados.interacoes(
          s.porta,
          [...produtos.values()].flatMap((p) => p.principiosAtivos),
        )
      : null;
    const alertas = avaliarAlertas({
      itens: e.data.itens.map((i) => itemAvaliado(i, produtos)),
      ctx: {
        alergias: e.data.alergiasPrincipios.length
          ? [{ alergia: 0, nome: 'Alergia simulada', principios: e.data.alergiasPrincipios }]
          : [],
        ativos: [],
        paciente: { clearance: null, pesoKg: null },
        tipoAtendimento: 'I',
        alta: false,
        regras: [
          ...REGRAS_PADRAO,
          ...sgh.map((r) => ({ ...r, tipo: r.tipo as (typeof TIPOS_ALERTA)[number] })),
        ],
        interacoes,
        duplicidade: { porMedicamento: true, porPrincipio: true, consistir: true },
        altaVigilancia: pol.altaVigilancia,
        dietaDeOutro: null,
        hoje,
      },
      foraDaCategoria: [],
      dietas: [],
      decisoes: new Map(),
    });
    req.sghAlvo = {
      tabelaAlvo: 'SGH_PEP_REGRA_ALERTA',
      chaveNaturalAlvo: `simulacao;itens:${e.data.itens.length}`,
    };
    return { alertas, impede: impede(alertas).impede };
  }

  @Get('farmacia-clinica/antimicrobianos')
  @Permissao('pep.antimicrobiano.ler')
  @Auditar('pep.prescricao.lida')
  async antimicrobianos(
    @Query('paciente') p: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<FichaAntimicrobiano[]> {
    const s = sessaoDe(req);
    const paciente = p ? idDaRota(p) : null;
    if (paciente) {
      await this.paciente(s, paciente);
      await this.exigirAcesso(s, paciente, 'pep.antimicrobiano.ler', true);
    }
    const todas = await this.servico.portaDados.fichas(s.porta, paciente);
    // A fila geral da farmácia clínica (sem paciente): com a restrição por vínculo ligada, só as fichas dos
    // pacientes com vínculo ou quebra de vidro vigente do login (a mesma decisão do prontuário, M06).
    const permitidos = paciente
      ? new Set([paciente])
      : await this.pacientesComVinculo(
          s,
          todas.map((f) => f.paciente),
        );
    const novas = todas.filter((f) => permitidos.has(f.paciente));
    const antigas = paciente ? await this.servico.portaDados.fichasAntigas(s.porta, paciente) : [];
    req.sghAlvo = {
      ...(paciente ? { paciente } : {}),
      tabelaAlvo: 'SGH_PEP_FICHA_ANTIMICRO',
      chaveNaturalAlvo: `parte:fichas;n:${novas.length + antigas.length};pacientes:${permitidos.size}`,
    };
    return [
      ...novas.map((f) => ({
        id: f.id,
        paciente: f.paciente,
        item: f.item,
        produto: f.produtoNome ?? `Produto ${f.produto}`,
        indicacao: f.indicacao,
        sitio: f.sitio,
        tipo: f.tipo,
        culturaColhida: f.culturaColhida,
        diaTratamento: f.diaTratamento,
        registradaEm: f.em ?? '',
        origem: 'novo' as const,
      })),
      ...antigas.map((f) => ({
        id: f.id,
        paciente: paciente ?? 0,
        item: null,
        produto: f.produto ?? '',
        indicacao: '',
        sitio: '',
        tipo: f.situacao,
        culturaColhida: false,
        diaTratamento: f.dias,
        registradaEm: f.inicio ?? '',
        origem: 'anterior' as const,
      })),
    ];
  }

  @Post('farmacia-clinica/antimicrobianos')
  @HttpCode(201)
  @Permissao('pep.antimicrobiano.registrar')
  @Auditar('pep.antimicrobiano.registrado')
  async registrarFicha(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<{ id: number }> {
    const s = sessaoDe(req);
    await this.exigirLiberacao(s, CHAVE_LIBERACAO_ANTIMICROBIANO);
    const e = esquemaFicha.safeParse(corpo);
    if (!e.success) throw entradaInvalida(e.error.issues);
    await this.paciente(s, e.data.paciente);
    await this.exigirAcesso(s, e.data.paciente, 'pep.antimicrobiano.registrar', false);
    await this.servico.atendimento(s.porta, e.data.paciente, e.data.atendimento);
    if (e.data.item !== null && e.data.prescricao === null)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Dados inválidos',
        'Informe a prescrição do item ligado à ficha.',
      );
    await this.servico.conferirLigacao(s.porta, e.data.atendimento, e.data.prescricao, e.data.item);
    const id = await this.servico.portaDados.registrarFicha(s.porta, s.login, e.data);
    req.sghAlvo = {
      paciente: e.data.paciente,
      tabelaAlvo: 'SGH_PEP_FICHA_ANTIMICRO',
      idAlvo: String(id),
      chaveNaturalAlvo: 'ficha',
    };
    return { id };
  }

  // ── Enfermagem: horários-padrão ────────────────────────────────────────────────────────────────

  @Get('enfermagem/horarios-padrao')
  @Permissao('pep.cadastroPrescricao.ler')
  async horariosPadrao(@Req() req: RequisicaoAutorizada) {
    const s = sessaoDe(req);
    // A grade da unidade; também na simulação dos horários do cadastro de frequências.
    exigirAlguma(s, ['pep.gradeHorario.ler', 'pep.frequenciaDose.ler']);
    const r = await this.servico.portaDados.regras(s.porta);
    return {
      regras: r.regras.map((x) => ({
        id: x.id,
        tipoAtendimento: x.tipoAtendimento,
        horarioInicial: x.horarioInicial,
        considerar: x.considerar,
        padrao: x.padrao,
        grade: [...x.grade.entries()].map(([doses, horas]) => ({ doses, horas: [...new Set(horas)] })),
      })),
      blocos: [...r.porBloco.entries()].map(([bloco, regra]) => ({ bloco, regra })),
      unidades: [...r.porUnidade.entries()].map(([unidade, regra]) => ({ unidade, regra })),
      porClasse: await this.servico.portaDados.grades(s.porta),
    };
  }

  @Post('enfermagem/horarios-padrao/classe')
  @HttpCode(201)
  @Permissao('pep.gradeHorario.editar')
  @Auditar('pep.gradeClasse.alterada')
  async gravarGrade(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const e = esquemaGrade.safeParse(corpo);
    if (!e.success) throw entradaInvalida(e.error.issues);
    if (new Set(e.data.horarios).size !== e.data.numDoses)
      throw new ErroProblema(
        'entrada-invalida',
        400,
        'Grade inválida',
        'Informe um horário diferente para cada dose.',
      );
    const id = await this.servico.portaDados.gravarGrade(s.porta, s.login, e.data);
    req.sghAlvo = {
      tabelaAlvo: 'SGH_PEP_GRADE_CLASSE',
      idAlvo: String(id),
      chaveNaturalAlvo: `${e.data.classe}:${e.data.numDoses}`,
    };
    return { id };
  }

  /** Favoritos do prescritor da sessão (03-PEP L107): atalhos para item, protocolo e kit, em um clique. */
  @Get('pep/prescricao/favoritos')
  @Permissao('pep.prescricao.criar')
  async favoritos(@Req() req: RequisicaoAutorizada): Promise<{ favoritos: FavoritoPrescritorLido[] }> {
    const s = sessaoDe(req);
    return { favoritos: await this.servico.portaDados.favoritos(s.porta, s.login) };
  }

  @Post('pep/prescricao/favoritos')
  @HttpCode(201)
  @Permissao('pep.prescricao.criar')
  @Auditar('pep.favoritoPrescritor.alterado')
  async marcarFavorito(@Body() corpo: unknown, @Req() req: RequisicaoAutorizada): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const e = esquemaFavorito.safeParse(corpo);
    if (!e.success) throw entradaInvalida(e.error.issues);
    const id = await this.servico.portaDados
      .marcarFavorito(s.porta, s.login, {
        tipo: e.data.tipo,
        alvo: e.data.alvo,
        rotulo: e.data.rotulo ?? null,
        ordem: e.data.ordem ?? null,
      })
      .catch((x: unknown) => {
        throw problemaDaPrescricao(x);
      });
    req.sghAlvo = { tabelaAlvo: 'favorito_prescritor', idAlvo: String(id), chaveNaturalAlvo: e.data.tipo };
    return { id };
  }

  @Post('pep/prescricao/favoritos/:id/desmarcar')
  @HttpCode(200)
  @Permissao('pep.prescricao.criar')
  @Auditar('pep.favoritoPrescritor.alterado')
  async desmarcarFavorito(@Param('id') i: string, @Req() req: RequisicaoAutorizada): Promise<{ id: number }> {
    const s = sessaoDe(req);
    const id = await this.servico.portaDados
      .desmarcarFavorito(s.porta, s.login, idDaRota(i))
      .catch((x: unknown) => {
        throw problemaDaPrescricao(x);
      });
    req.sghAlvo = { tabelaAlvo: 'favorito_prescritor', idAlvo: String(id), chaveNaturalAlvo: 'desmarcado' };
    return { id };
  }
}

/** A consulta de cada cadastro de prescrição pela permissão do cadastro (M06: opções do legado de cada um). */
const PERMISSAO_DA_SECAO: Readonly<Record<(typeof SECOES_CADASTRO_PRESCRICAO)[number], string>> = {
  kitsMedicamento: 'pep.kitPrescricao.ler',
  kitsSolucao: 'pep.kitPrescricao.ler',
  receitasPadrao: 'pep.receitaPadrao.ler',
  naoPadronizados: 'pep.itemNaoPadronizado.ler',
  parametrosItem: 'pep.parametroClinicoItem.ler',
};

/** A rota de leitura compartilhada (guarda: `pep.cadastroPrescricao.ler`) confere a permissão própria de quem lê. */
function exigirAlguma(s: SessaoCadastro, permissoes: readonly string[]): void {
  if (!permissoes.some((p) => s.pode(p)))
    throw new ErroProblema('sem-permissao', 403, 'Sem permissão', 'Seu perfil não permite esta ação.');
}

function descricaoCurta(i: { detalhe: { tipo: string } }): string {
  return `Item programado (${i.detalhe.tipo})`;
}

/** Recusas do executor em Problem Details, com as mensagens da prescrição em português. */
function problemaDaPrescricao(x: unknown): ErroProblema {
  const p = problemaDoCadastro(x);
  const codigo = p.extras.codigo;
  const m = codigo ? MENSAGENS_PRESCRICAO[codigo] : undefined;
  return codigo && m ? new ErroProblema(p.tipo, p.getStatus(), p.titulo, m, { ...p.extras, codigo }) : p;
}

function entradaInvalida(issues: readonly { path: readonly PropertyKey[]; message: string }[]): ErroProblema {
  const campos = [...new Set(issues.map((i) => i.path.map(String).join('.') || '(entrada)'))].slice(0, 20);
  return new ErroProblema(
    'entrada-invalida',
    400,
    'Dados inválidos',
    issues
      .slice(0, 3)
      .map((i) => i.message)
      .join(' '),
    { codigo: 'entrada-invalida', campos },
  );
}

/** Motivo da 2ª via (o mesmo contrato da reimpressão dos documentos do prontuário). */
/** 01-ADM L82: o porquê da impressão pela regra do domínio (a mesma dos documentos do prontuário). */
function justificativaDaImpressao(corpo: unknown, viaAnterior: boolean): string {
  const e = esquemaImprimirDocumentoProntuario.safeParse(corpo ?? {});
  if (!e.success) throw entradaInvalida(e.error.issues);
  const r = regraJustificativaImpressao({
    viaAnterior,
    justificativa: e.data.justificativa ?? null,
    motivo: e.data.motivo ?? null,
  });
  if (!r.ok)
    throw new ErroProblema('entrada-invalida', 400, 'Justificativa obrigatória', r.mensagem, {
      campos: [viaAnterior ? 'motivo' : 'justificativa'],
      codigo: r.codigo,
    });
  return r.justificativa;
}

const SITUACAO_IMPRESSA: Readonly<Record<PrescricaoLida['situacao'], string>> = {
  vigente: 'Vigente',
  futura: 'Futura',
  vencida: 'Vencida',
  suspensa: 'Suspensa',
};
