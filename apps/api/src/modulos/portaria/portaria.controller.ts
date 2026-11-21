// Portaria e visitantes (M50, etapa 5; ficha, seções 4, 5 e 7; regras 9, 10 e 13):
//   GET  /api/portaria                                     o painel: domínios, visitas em curso, a liberação
//   GET  /api/portaria/pacientes?busca=                    a busca do paciente (sem o sigilo; o leito só se a visita é
//                                                          permitida; nunca o motivo do bloqueio)
//   GET  /api/portaria/pacientes/:internacao/avaliacao?visitante=&identificacao=   a visita deste visitante, agora
//   GET  /api/portaria/visitantes?busca= | ?tipo=&documento=                        a busca do visitante
//   GET  /api/portaria/visitantes/:id/foto                 a foto (base64)
//   GET  /api/portaria/visitantes/:id/acompanhamento       a internação de que o visitante é o acompanhante vigente
//                                                          (com direito legal: entra mesmo com o sigilo de presença)
//   POST /api/portaria/visitantes                          internacao.registrarVisitante (cadastro mínimo com a foto)
//   POST /api/portaria/visitas                             internacao.registrarVisita (o crachá com a validade e o ZPL)
//   GET  /api/portaria/visitas/:id/cracha                  o crachá de novo (reimpressão)
//   POST /api/portaria/visitas/:id/saida                   internacao.encerrarVisita
//   GET  /api/portaria/regras                              regras por unidade, bloqueios, vencidos (supervisão)
//   POST /api/portaria/regras                              internacao.definirRegraVisita (pela versão)
//   GET  /api/portaria/regras/internados?unidade=          os internados da unidade (para o bloqueio)
//   POST /api/portaria/bloqueios                           internacao.bloquearVisita (pedido, judicial, sigilo)
//   POST /api/portaria/bloqueios/:id/revogacao             a revogação com o motivo
//   GET  /api/portaria/bloqueios-clinicos                  o bloqueio clínico (enfermagem): internados e bloqueios
//   POST /api/portaria/bloqueios-clinicos                  internacao.bloquearVisita (motivo clínico)
//   POST /api/portaria/bloqueios-clinicos/:id/revogacao    a revogação do bloqueio clínico
//   POST /api/portaria/visitantes/expurgo                  anonimiza os cadastros vencidos (prazo do encarregado)
//   GET  /api/portaria/contatos?internacao=|unidade=&de=&ate=   o relatório de contatos (investigação de surto)
//   GET  /api/portaria/contatos/unidades | /contatos/internados?unidade=   o que a tela do relatório escolhe
//   GET  /api/portaria/acompanhantes?unidade=              os acompanhantes vigentes (e os internados da unidade; o
//                                                          paciente com sigilo só para a supervisão e a enfermagem)
//   GET  /api/portaria/acompanhantes/visitantes?busca=     a busca da pessoa (a mesma da portaria, pela permissão do
//   POST /api/portaria/acompanhantes/visitantes            acompanhante) e o cadastro mínimo dela
//   POST /api/portaria/acompanhantes                       internacao.registrarAcompanhante (com a troca)
//   POST /api/portaria/acompanhantes/:id/fim               o fim do acompanhamento
//   GET  /api/portaria/terminais                           terminais, tipos e os eventos recentes da catraca
//   POST /api/portaria/terminais (e /:id)                  internacao.configurarTerminal
//   POST /api/portaria/catraca/eventos                     internacao.registrarEventoCatraca (integrador local)
//   POST /api/portaria/catraca/simular                     o simulador da catraca (fora de produção)
// Gravações numa operação do Executor, com a trilha na mesma transação e o ator real; o estabelecimento vem da sessão. A
// portaria nasce desligada (chave `portaria`, POL-3); a catraca (`portaria.catraca`) e a biometria (`portaria.biometria`,
// DP-45) têm chaves próprias.
import { createHash, randomBytes } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Optional, Param, Post, Query, Req } from '@nestjs/common';
import {
  type AcompanhanteLido,
  type BloqueioVisitaLido,
  CHAVE_LIBERACAO_BIOMETRIA,
  CHAVE_LIBERACAO_CATRACA,
  CHAVE_LIBERACAO_PORTARIA,
  type ContatoVisita,
  type CrachaVisita,
  esquemaAcompanhante,
  esquemaBloqueioVisita,
  esquemaConsultaContatos,
  esquemaEventoCatraca,
  esquemaMotivo,
  esquemaRegistrarVisita,
  esquemaRegraVisita,
  esquemaTerminal,
  esquemaVisitante,
  EVENTOS_AUDITAVEIS,
  type PacientePortaria,
  type PainelAcompanhantes,
  type PainelPortaria,
  type PainelRegrasPortaria,
  type PainelTerminais,
  PARAMETRO_PORTARIA_RETENCAO,
  PERMISSOES_PORTARIA as P,
  type RespostaCatraca,
  type ResultadoPortaria,
  RETENCAO_PADRAO_DIAS,
  UNIDADE_TODAS,
  type VisitanteLido,
} from '@sgh/contratos';
import {
  avaliarCatraca,
  bloqueiosVigentes,
  codigoDoCracha,
  conferirFundamento,
  conferirNascimento,
  conferirRegra,
  idadeNaData,
  nomeDeBusca,
  type RegraVisita,
  reterAte,
  temSigilo,
  validadeDoCracha,
  zplDoCracha,
} from '@sgh/dominio-internacao';
import { AuditadoNoHandler, Auditar, Permissao } from '../../autorizacao/decoradores.js';
import type { RequisicaoAutorizada } from '../../autorizacao/guarda.js';
import { REGISTRADOR_TRILHA } from '../../autorizacao/simbolos.js';
import type { RegistradorTrilha } from '../../autorizacao/trilha.js';
import { ErroProblema } from '../../problema.filter.js';
import { idDaRota, type SessaoCadastro, sessaoDe as sessaoCadastro } from '../cadastro/comum.js';
import {
  CACHE_CONFIG,
  type CacheConfig,
  FONTE_CONFIGURACAO,
  type FonteConfiguracao,
} from '../config/public-api.js';
import { ApoioGravacao, corpo } from '../exames/public-api.js';
import { ARMAZEM_FOTOS_PORTARIA, type ArmazemFotosPortaria, imagemConfere } from './fotos.js';
import { type GravadorPortaria, PORTA_PORTARIA, type PortaPortaria } from './porta.js';
import type { FotoGuardada, InternadoPortaria } from './tipos.js';
import {
  type ContextoDoPaciente,
  dominiosParaTela,
  ServicoPortaria,
  visitaEmCurso,
  visitanteParaTela,
} from './servico.js';

const E = EVENTOS_AUDITAVEIS;
const UNIDADE = /^[A-Za-z0-9 ._-]{1,5}$/;
const CHAVE = /^[A-Za-z0-9._:-]{8,80}$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;
/** O relógio do terminal pode diferir do banco em até 10 minutos. */
const TOLERANCIA_RELOGIO_MIN = 10;
const MAX_FOTO = 300 * 1024;

export const OPCOES_PORTARIA = Symbol('OPCOES_PORTARIA');
export interface OpcoesPortaria {
  /** Fora de produção, o simulador da catraca responde (nada sai para fora). */
  readonly simulador: boolean;
}

const EXTRAS = {
  registrar: P.registrar,
  regrar: P.regrar,
  bloquearClinico: P.bloquearClinico,
  contatos: P.contatos,
  acompanhante: P.acompanhante,
  terminal: P.terminalEditar,
} as const;

function chaveDoPedido(s: SessaoCadastro): string | null {
  const bruto = s.req.headers['idempotency-key'];
  const k = Array.isArray(bruto) ? bruto[0] : bruto;
  return typeof k === 'string' && CHAVE.test(k) ? k : null;
}

/** A sessão com a Idempotency-Key do pedido no contexto da porta (as gravações a usam como chave). */
function sessaoDe(req: RequisicaoAutorizada): SessaoCadastro {
  const s = sessaoCadastro(req);
  return { ...s, porta: Object.assign({}, s.porta, { chavePedido: chaveDoPedido(s) }) };
}

const invalida = (mensagem: string, campos: string[] = []) =>
  new ErroProblema('entrada-invalida', 400, 'Dados inválidos', mensagem, { campos });
const naoEncontrado = (o: string) => new ErroProblema('nao-encontrado', 404, `${o} não encontrado`);
const minutos = (t: string) => Date.parse(`${t.slice(0, 16)}:00Z`) / 60_000;

@Controller('portaria')
export class PortariaController {
  private readonly apoio: ApoioGravacao<GravadorPortaria>;
  private readonly catraca: ApoioGravacao<GravadorPortaria>;
  private readonly biometria: ApoioGravacao<GravadorPortaria>;
  private readonly servico: ServicoPortaria;
  private readonly simulador: boolean;

  constructor(
    @Inject(PORTA_PORTARIA) private readonly porta: PortaPortaria,
    @Inject(REGISTRADOR_TRILHA) trilha: RegistradorTrilha,
    @Optional() @Inject(FONTE_CONFIGURACAO) configuracao: FonteConfiguracao | null = null,
    @Optional() @Inject(CACHE_CONFIG) cache: CacheConfig | null = null,
    @Optional() @Inject(ARMAZEM_FOTOS_PORTARIA) private readonly fotos: ArmazemFotosPortaria | null = null,
    @Optional() @Inject(OPCOES_PORTARIA) opcoes: OpcoesPortaria | null = null,
  ) {
    const apoio = (chave: string, nome: string) =>
      new ApoioGravacao<GravadorPortaria>({ chave, nome, operacoes: {} }, porta, trilha, configuracao, cache);
    this.apoio = apoio(CHAVE_LIBERACAO_PORTARIA, 'a portaria');
    this.catraca = apoio(CHAVE_LIBERACAO_CATRACA, 'a integração com as catracas');
    this.biometria = apoio(CHAVE_LIBERACAO_BIOMETRIA, 'a identificação biométrica');
    this.servico = new ServicoPortaria(porta);
    this.simulador = opcoes?.simulador ?? false;
  }

  private async agora(s: SessaoCadastro): Promise<string> {
    return (await this.porta.relogio(s.porta)).slice(0, 16);
  }

  private async retencaoDias(s: SessaoCadastro): Promise<number> {
    const d = await this.apoio.parametro(s, PARAMETRO_PORTARIA_RETENCAO);
    return d >= 30 && d <= 1825 ? d : RETENCAO_PADRAO_DIAS;
  }

  private async internadoDe(s: SessaoCadastro, internacao: number): Promise<InternadoPortaria> {
    const i = await this.porta.internado(s.porta, internacao);
    if (!i) throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado entre os internados');
    return i;
  }

  private async mapaInternados(s: SessaoCadastro): Promise<Map<number, InternadoPortaria>> {
    return new Map((await this.porta.internados(s.porta)).map((i) => [i.internacao, i]));
  }

  /** Quem vê o paciente com sigilo de presença: a supervisão da portaria e a enfermagem (o bloqueio clínico). */
  private veSigilo(s: SessaoCadastro): boolean {
    return s.pode(P.regrar) || s.pode(P.bloquearClinico);
  }

  /** As internações com sigilo de presença vigente agora. */
  private async comSigilo(s: SessaoCadastro, agora: string): Promise<Set<number>> {
    const porReg = new Map<number, Awaited<ReturnType<PortaPortaria['bloqueios']>>>();
    for (const b of await this.porta.bloqueios(s.porta, null))
      (porReg.get(b.internacao) ?? porReg.set(b.internacao, []).get(b.internacao)!).push(b);
    const r = new Set<number>();
    for (const [reg, bs] of porReg) if (temSigilo(bloqueiosVigentes(bs, agora))) r.add(reg);
    return r;
  }

  /** O visitante é o acompanhante vigente com direito legal (o sigilo de presença não o barra)? */
  private static acompanhanteLegal(ctx: ContextoDoPaciente, visitante: number | null): boolean {
    return (
      visitante !== null &&
      ctx.acompanhante !== null &&
      ctx.acompanhante.visitante === visitante &&
      ctx.acompanhante.fundamento !== 'autorizado'
    );
  }

  private async biometriaLigada(s: SessaoCadastro): Promise<boolean> {
    return (await this.biometria.liberacao(s)).ligada;
  }

  // ── Portaria ──────────────────────────────────────────────────────────────────────────────────────

  @Get()
  @Permissao(P.ler)
  @Auditar(E.portariaLida.codigo)
  async painel(@Req() req: RequisicaoAutorizada): Promise<PainelPortaria> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'visita' };
    const [agora, dominios, abertas, internados, biometria, gravacao, retencaoDias] = await Promise.all([
      this.agora(s),
      this.porta.dominios(s.porta),
      this.porta.abertas(s.porta),
      this.mapaInternados(s),
      this.biometriaLigada(s),
      this.apoio.gravacao(s, EXTRAS),
      this.retencaoDias(s),
    ]);
    return {
      agora,
      dominios: dominiosParaTela(dominios, biometria),
      abertas: abertas.map((v) => this.servico.visitaParaTela(v, internados, agora)),
      biometriaLigada: biometria,
      retencaoDias,
      gravacao,
    };
  }

  @Get('pacientes')
  @Permissao(P.ler)
  @Auditar(E.portariaLida.codigo)
  async pacientes(
    @Query('busca') busca: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PacientePortaria[]> {
    const s = sessaoDe(req);
    const b = (busca ?? '').trim();
    if (nomeDeBusca(b).replace(/ /g, '').length < 3)
      throw invalida('Digite 3 letras ou mais do nome do paciente.', ['busca']);
    req.sghAlvo = { tabelaAlvo: 'internacao' };
    return this.servico.buscarPacientes(s.porta, b.slice(0, 70), await this.agora(s));
  }

  @Get('pacientes/:internacao/avaliacao')
  @Permissao(P.ler)
  @Auditar(E.portariaLida.codigo)
  async avaliacao(
    @Param('internacao') internacao: string,
    @Query('visitante') visitante: string | undefined,
    @Query('identificacao') identificacao: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<PacientePortaria & { excepcionavel: boolean; papel: string | null }> {
    const s = sessaoDe(req);
    const i = await this.internadoDe(s, idDaRota(internacao));
    req.sghAlvo = { paciente: i.paciente, tabelaAlvo: 'visita' };
    const agora = await this.agora(s);
    const ctx = await this.servico.contexto(s.porta, i, agora);
    const idVisitante = visitante ? idDaRota(visitante) : null;
    // O sigilo de presença: a portaria não confirma a internação, salvo ao acompanhante com direito legal.
    if (temSigilo(ctx.bloqueios) && !PortariaController.acompanhanteLegal(ctx, idVisitante))
      throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado entre os internados');
    let v: Parameters<ServicoPortaria['avaliar']>[3] = null;
    if (idVisitante !== null) {
      const pessoa = await this.porta.visitante(s.porta, idVisitante);
      if (!pessoa) throw naoEncontrado('Visitante');
      const abertas = await this.porta.abertas(s.porta);
      v = {
        id: pessoa.id,
        nascimento: pessoa.nascimento,
        emVisita: abertas.some((x) => x.visitante === pessoa.id && visitaEmCurso(x, agora)),
        biometrica: (await this.porta.dominios(s.porta)).identificacoes.some(
          (d) => d.codigo === Number(identificacao) && d.biometrica,
        ),
        biometriaLigada: await this.biometriaLigada(s),
        excecao: false,
      };
    }
    const a = this.servico.avaliar(ctx, i, agora, v);
    return {
      ...this.servico.pacienteParaTela(i, ctx, a),
      excepcionavel: !a.permitida && a.excepcionavel,
      papel: a.permitida ? a.papel : null,
    };
  }

  @Get('visitantes')
  @Permissao(P.ler)
  @Auditar(E.portariaLida.codigo)
  visitantes(
    @Query('busca') busca: string | undefined,
    @Query('tipo') tipo: string | undefined,
    @Query('documento') documento: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<VisitanteLido[]> {
    return this.buscarVisitantes(req, busca, tipo, documento);
  }

  private async buscarVisitantes(
    req: RequisicaoAutorizada,
    busca: string | undefined,
    tipo: string | undefined,
    documento: string | undefined,
  ): Promise<VisitanteLido[]> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'pessoa_portaria' };
    if (documento) {
      const d = documento.replace(/[\s.\-/]/g, '').toUpperCase();
      if (!/^[A-Z0-9]{3,20}$/.test(d) || !/^(cpf|rg|cnh|passaporte|outro)$/.test(tipo ?? ''))
        throw invalida('Informe o tipo e o número do documento.', ['documento']);
      return (
        await this.porta.buscarVisitantes(s.porta, { documento: { tipo: tipo!, numero: d }, nomeBusca: null })
      ).map(visitanteParaTela);
    }
    const n = nomeDeBusca(busca ?? '');
    if (n.length < 3) throw invalida('Digite 3 letras ou mais do nome do visitante.', ['busca']);
    return (await this.porta.buscarVisitantes(s.porta, { documento: null, nomeBusca: n })).map(
      visitanteParaTela,
    );
  }

  @Get('visitantes/:id/foto')
  @Permissao(P.ler)
  @Auditar(E.portariaLida.codigo)
  async foto(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ tipo: string; conteudo: string }> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'pessoa_portaria' };
    const chave = await this.porta.foto(s.porta, idDaRota(id));
    const f = chave && this.fotos ? await this.fotos.ler(s.hospital, chave) : null;
    if (!f) throw naoEncontrado('Foto');
    return { tipo: f.tipo, conteudo: Buffer.from(f.bytes).toString('base64') };
  }

  @Get('visitantes/:id/acompanhamento')
  @Permissao(P.ler)
  @Auditar(E.portariaLida.codigo)
  async acompanhamento(
    @Param('id') id: string,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{ paciente: PacientePortaria | null }> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'acompanhante_internacao' };
    const pessoa = await this.porta.visitante(s.porta, idDaRota(id));
    if (!pessoa) throw naoEncontrado('Visitante');
    const a = (await this.porta.acompanhantes(s.porta, null)).find((x) => x.visitante === pessoa.id);
    // Só o acompanhante com direito legal: o "autorizado pela equipe" entra pela busca do paciente, como o visitante.
    if (!a || a.fundamento === 'autorizado') return { paciente: null };
    const i = await this.porta.internado(s.porta, a.internacao);
    if (!i) return { paciente: null };
    req.sghAlvo = { paciente: i.paciente, tabelaAlvo: 'acompanhante_internacao' };
    const agora = await this.agora(s);
    const ctx = await this.servico.contexto(s.porta, i, agora);
    return { paciente: this.servico.pacienteParaTela(i, ctx, this.servico.avaliar(ctx, i, agora, null)) };
  }

  @Post('visitantes')
  @HttpCode(201)
  @Permissao(P.registrar)
  @AuditadoNoHandler('internacao.registrarVisitante: pessoa_portaria com a trilha na mesma transação')
  registrarVisitante(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPortaria> {
    return this.cadastrarVisitante(sessaoDe(req), b, P.registrar);
  }

  private async cadastrarVisitante(
    s: SessaoCadastro,
    b: unknown,
    recurso: string,
  ): Promise<ResultadoPortaria> {
    const e = corpo(esquemaVisitante, b);
    const [agora, dominios, dias] = await Promise.all([
      this.agora(s),
      this.porta.dominios(s.porta),
      this.retencaoDias(s),
    ]);
    const nasc = conferirNascimento(e.nascimento, agora.slice(0, 10));
    if (!nasc.ok) throw invalida(nasc.mensagem, ['nascimento']);
    if (!dominios.tiposVisitante.some((t) => t.codigo === e.tipoVisitante && t.ativo))
      throw invalida('Escolha um tipo de visitante ativo.', ['tipoVisitante']);
    await this.apoio.exigirLiberacao(s);
    let foto: FotoGuardada | null = null;
    if (e.foto) {
      const bytes = Buffer.from(e.foto.base64, 'base64');
      if (bytes.length === 0 || bytes.length > MAX_FOTO || !imagemConfere(e.foto.tipo, bytes))
        throw invalida('A foto está vazia, passa de 300 KB ou não é a imagem declarada.', ['foto']);
      if (!this.fotos)
        throw new ErroProblema(
          'indisponivel',
          503,
          'Fotos indisponíveis',
          'O armazenamento de fotos não está configurado.',
        );
      foto = {
        chave: await this.fotos.guardar(s.hospital, e.foto.tipo, bytes),
        tipoMime: e.foto.tipo,
        tamanho: bytes.length,
        hash: createHash('sha256').update(bytes).digest('hex'),
      };
    }
    const r = await this.apoio
      .sgh(
        s,
        E.visitanteRegistrado.codigo,
        recurso,
        (x: { id: number }) => ({ tabela: 'pessoa_portaria', id: String(x.id), chave: e.tipoDocumento }),
        (g) =>
          g.registrarVisitante({
            nome: e.nome,
            nomeBusca: nomeDeBusca(e.nome),
            tipoDocumento: e.tipoDocumento,
            documento: e.documento,
            nascimento: e.nascimento,
            telefone: e.telefone,
            tipoVisitante: e.tipoVisitante,
            foto,
            reterAte: reterAte(agora, dias),
            usuario: s.login,
          }),
      )
      .catch(async (x: unknown) => {
        if (foto && this.fotos) await this.fotos.remover(s.hospital, foto.chave).catch(() => undefined);
        throw x;
      });
    if (r.fotoAnterior && this.fotos)
      await this.fotos.remover(s.hospital, r.fotoAnterior).catch(() => undefined);
    return {
      ok: true,
      id: r.id,
      mensagem: r.novo ? 'Visitante cadastrado.' : 'Cadastro do visitante atualizado (o mesmo documento).',
    };
  }

  @Post('visitas')
  @HttpCode(201)
  @Permissao(P.registrar)
  @AuditadoNoHandler(
    'internacao.registrarVisita: visita e a trava do paciente com a trilha na mesma transação',
  )
  async registrarVisita(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPortaria> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegistrarVisita, b);
    if (e.excecao && !s.pode(P.regrar))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Sem permissão',
        'A exceção na portaria é autorizada pelo supervisor (regras de visita).',
        { codigo: 'sem-permissao' },
      );
    const [agora, dominios, pessoa, dias] = await Promise.all([
      this.agora(s),
      this.porta.dominios(s.porta),
      this.porta.visitante(s.porta, e.visitante),
      this.retencaoDias(s),
    ]);
    if (!pessoa) throw naoEncontrado('Visitante');
    if (!dominios.identificacoes.some((i) => i.codigo === e.identificacao))
      throw invalida('Escolha a forma de identificação no acesso.', ['identificacao']);
    const biometrica = dominios.identificacoes.some((d) => d.codigo === e.identificacao && d.biometrica);
    const tipoPaciente = dominios.tiposVisitado.find((t) => t.paciente)?.codigo ?? null;
    const biometriaLigada = biometrica ? await this.biometriaLigada(s) : false;
    if (biometrica && !biometriaLigada)
      throw new ErroProblema(
        'recurso-desligado',
        403,
        'Biometria não liberada',
        'A identificação por biometria ou reconhecimento facial não está liberada: use o crachá ou a etiqueta.',
        { codigo: 'identificacao-biometrica' },
      );
    const cracha = codigoDoCracha(randomBytes(12));
    let internado: InternadoPortaria | null = null;
    let destinoTexto: string;
    let excecaoUsada: string | null = null;
    let papelPrevisto: 'visitante' | 'acompanhante' = 'visitante';
    let regraDaVisita: RegraVisita | null = null;
    if (e.destino.tipo === 'paciente') {
      internado = await this.internadoDe(s, e.destino.internacao);
      const [ctx, abertas] = await Promise.all([
        this.servico.contexto(s.porta, internado, agora),
        this.porta.abertas(s.porta),
      ]);
      // O sigilo de presença: a portaria não confirma que o paciente está internado (salvo ao acompanhante com
      // direito legal, que o sigilo não barra: só a ordem judicial ou a decisão clínica).
      if (temSigilo(ctx.bloqueios) && !PortariaController.acompanhanteLegal(ctx, pessoa.id))
        throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado entre os internados');
      regraDaVisita = ctx.regra;
      const a = this.servico.avaliar(ctx, internado, agora, {
        id: pessoa.id,
        nascimento: pessoa.nascimento,
        emVisita: abertas.some((x) => x.visitante === pessoa.id && visitaEmCurso(x, agora)),
        biometrica,
        biometriaLigada,
        excecao: e.excecao !== null,
      });
      if (!a.permitida)
        throw new ErroProblema('recusa-de-negocio', 409, 'Visita não liberada', a.mensagem, {
          codigo: a.recusa,
        });
      excecaoUsada = a.excecaoUsada;
      // O "autorizado pela equipe" segue a regra da unidade também na validade do crachá.
      papelPrevisto =
        a.papel === 'acompanhante' && ctx.acompanhante?.fundamento === 'autorizado' ? 'visitante' : a.papel;
      destinoTexto = `${internado.unidadeNome} · ${internado.leito}`;
    } else {
      if (e.destino.tipoVisitado === tipoPaciente)
        throw invalida('A visita a paciente é registrada pelo paciente internado.', ['destino']);
      if (
        !dominios.tiposVisitado.some((t) => t.codigo === (e.destino as { tipoVisitado: number }).tipoVisitado)
      )
        throw invalida('Escolha o tipo de destino.', ['destino']);
      destinoTexto = e.destino.local;
    }
    const validoAte = validadeDoCracha(
      agora,
      regraDaVisita ?? { horaFim: '23:59', duracaoMaxMin: 120 },
      papelPrevisto,
      excecaoUsada !== null,
    );
    const regra = regraDaVisita;
    const i = internado;
    const r = await this.apoio.sgh(
      s,
      E.visitaRegistrada.codigo,
      P.registrar,
      (x: { id: number }) => ({
        tabela: 'visita',
        id: String(x.id),
        paciente: i?.paciente ?? null,
        chave: i ? String(i.internacao) : 'outro',
      }),
      (g) =>
        g.registrarVisita(
          {
            visitante: pessoa.id,
            destino: i
              ? {
                  tipo: 'paciente',
                  internacao: i.internacao,
                  paciente: i.paciente,
                  bloco: i.unidade,
                  acomod: i.acomod,
                  leito: i.leitoCodigo,
                }
              : { tipo: 'outro', local: (e.destino as { local: string }).local },
            tipoVisitado: e.destino.tipo === 'paciente' ? (tipoPaciente ?? 0) : e.destino.tipoVisitado,
            identificacao: e.identificacao,
            cracha,
            entrada: agora,
            validoAte,
            excecao: excecaoUsada && e.excecao ? `${excecaoUsada}: ${e.excecao}`.slice(0, 200) : null,
            reterAte: reterAte(agora, dias),
            usuario: s.login,
            chave: chaveDoPedido(s),
          },
          // A avaliação refeita na transação, com o que foi relido depois da trava do paciente.
          (relido) => {
            if (!i || !regra) return { permitida: true, papel: 'visitante' };
            const a = this.servico.avaliar(
              {
                regra,
                padrao: false,
                bloqueios: bloqueiosVigentes(relido.bloqueios, agora),
                abertas: relido.abertas,
                acompanhante:
                  relido.acompanhante !== null
                    ? {
                        visitante: relido.acompanhante,
                        nome: '',
                        ...(relido.acompanhanteFundamento
                          ? { fundamento: relido.acompanhanteFundamento }
                          : {}),
                      }
                    : null,
              },
              i,
              agora,
              {
                id: pessoa.id,
                nascimento: pessoa.nascimento,
                emVisita: relido.visitanteEmVisita,
                biometrica,
                biometriaLigada,
                excecao: e.excecao !== null,
              },
            );
            return a.permitida
              ? { permitida: true, papel: a.papel }
              : { permitida: false, recusa: a.recusa, mensagem: a.mensagem };
          },
        ),
    );
    const v = await this.porta.visita(s.porta, r.id);
    const crachaFinal: CrachaVisita = {
      visita: r.id,
      codigo: v?.cracha ?? cracha,
      visitante: pessoa.nome,
      destino: destinoTexto,
      validoAte: v?.validoAte ?? validoAte,
      zpl: zplDoCracha({
        codigo: v?.cracha ?? cracha,
        visitante: pessoa.nome,
        destino: destinoTexto,
        validoAte: v?.validoAte ?? validoAte,
        papel: r.papel,
      }),
    };
    return {
      ok: true,
      id: r.id,
      mensagem: r.repetida
        ? 'Esta entrada já estava registrada.'
        : r.papel === 'acompanhante'
          ? 'Entrada do acompanhante registrada.'
          : 'Entrada registrada. Entregue o crachá.',
      cracha: crachaFinal,
    };
  }

  @Get('visitas/:id/cracha')
  @Permissao(P.registrar)
  @Auditar(E.portariaLida.codigo)
  async cracha(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<CrachaVisita> {
    const s = sessaoDe(req);
    const v = await this.porta.visita(s.porta, idDaRota(id));
    if (!v) throw naoEncontrado('Visita');
    req.sghAlvo =
      v.paciente !== null
        ? { paciente: v.paciente, tabelaAlvo: 'visita' }
        : { tabelaAlvo: 'visita' };
    const internados = await this.mapaInternados(s);
    const i = v.internacao !== null ? internados.get(v.internacao) : undefined;
    const destino = i ? `${i.unidadeNome} · ${i.leito}` : (v.local ?? '');
    return {
      visita: v.id,
      codigo: v.cracha,
      visitante: v.visitanteNome,
      destino,
      validoAte: v.validoAte,
      zpl: zplDoCracha({
        codigo: v.cracha,
        visitante: v.visitanteNome,
        destino,
        validoAte: v.validoAte,
        papel: v.papel,
      }),
    };
  }

  @Post('visitas/:id/saida')
  @HttpCode(201)
  @Permissao(P.registrar)
  @AuditadoNoHandler('internacao.encerrarVisita: visita com a trilha na mesma transação')
  async saida(@Param('id') id: string, @Req() req: RequisicaoAutorizada): Promise<ResultadoPortaria> {
    const s = sessaoDe(req);
    const v = await this.porta.visita(s.porta, idDaRota(id));
    if (!v) throw naoEncontrado('Visita');
    const agora = await this.agora(s);
    const r = await this.apoio.sgh(
      s,
      E.visitaEncerrada.codigo,
      P.registrar,
      { tabela: 'visita', id: String(v.id), paciente: v.paciente, chave: 'portaria' },
      (g) => g.encerrarVisita({ id: v.id, saida: agora, origem: 'portaria', usuario: s.login }),
    );
    return { ok: true, id: r, mensagem: 'Saída registrada. Recolha o crachá.' };
  }

  // ── Regras, bloqueios, contatos ───────────────────────────────────────────────────────────────────

  private bloqueioParaTela(
    b: Awaited<ReturnType<PortaPortaria['bloqueios']>>[number],
    internados: ReadonlyMap<number, InternadoPortaria>,
  ): BloqueioVisitaLido {
    const i = internados.get(b.internacao);
    return {
      id: b.id,
      internacao: b.internacao,
      paciente: i?.nome ?? '',
      unidade: i?.unidadeNome ?? '',
      motivo: b.motivo,
      abrangencia: b.abrangencia,
      visitante: b.visitante !== null ? { id: b.visitante, nome: b.visitanteNome ?? '' } : null,
      limite: b.limite,
      incluiAcompanhante: b.incluiAcompanhante,
      justificativa: b.justificativa,
      documento: b.documento,
      inicio: b.inicio,
      fim: b.fim,
      criadoPor: b.criadoPor,
    };
  }

  @Get('regras')
  @Permissao(P.regrar)
  @Auditar(E.portariaLida.codigo)
  async regras(@Req() req: RequisicaoAutorizada): Promise<PainelRegrasPortaria> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'regra_visita_unidade' };
    const [agora, unidades, regras, bloqueios, internados, gravacao] = await Promise.all([
      this.agora(s),
      this.porta.unidades(s.porta),
      this.porta.regras(s.porta),
      this.porta.bloqueios(s.porta, null),
      this.mapaInternados(s),
      this.apoio.gravacao(s, EXTRAS),
    ]);
    return {
      unidades,
      regras: this.servico.regrasParaTela(regras),
      bloqueios: bloqueios
        .filter((b) => internados.has(b.internacao))
        .map((b) => this.bloqueioParaTela(b, internados)),
      vencidos: await this.porta.vencidos(s.porta, agora.slice(0, 10), await this.retencaoDias(s)),
      gravacao,
    };
  }

  /** Os internados da unidade; sem `veSigilo` (o porteiro), sem o paciente com sigilo de presença. */
  private async internadosDaUnidade(s: SessaoCadastro, unidade: string | undefined, veSigilo = true) {
    const u = (unidade ?? '').trim();
    if (!UNIDADE.test(u)) throw invalida('Escolha a unidade.', ['unidade']);
    const sigilo = veSigilo ? new Set<number>() : await this.comSigilo(s, await this.agora(s));
    return (await this.porta.internados(s.porta))
      .filter((i) => i.unidade === u && !sigilo.has(i.internacao))
      .map((i) => ({ internacao: i.internacao, nome: i.nome, leito: i.leito, unidade: i.unidade }));
  }

  @Get('regras/internados')
  @Permissao(P.regrar)
  @Auditar(E.portariaLida.codigo)
  internadosRegras(@Query('unidade') unidade: string | undefined, @Req() req: RequisicaoAutorizada) {
    req.sghAlvo = { tabelaAlvo: 'internacao' };
    return this.internadosDaUnidade(sessaoDe(req), unidade);
  }

  @Post('regras')
  @HttpCode(201)
  @Permissao(P.regrar)
  @AuditadoNoHandler(
    'internacao.definirRegraVisita: regra_visita_unidade com a trilha na mesma transação',
  )
  async definirRegra(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<ResultadoPortaria> {
    const s = sessaoDe(req);
    const e = corpo(esquemaRegraVisita, b);
    const k = conferirRegra(e);
    if (!k.ok) throw invalida(k.mensagem, ['duracaoMaxMin']);
    if (
      e.unidade !== UNIDADE_TODAS &&
      !(await this.porta.unidades(s.porta)).some((u) => u.unidade === e.unidade)
    )
      throw invalida('Unidade não encontrada.', ['unidade']);
    const r = await this.apoio.sgh(
      s,
      E.visitaRegraDefinida.codigo,
      P.regrar,
      (x: { id: number }) => ({ tabela: 'regra_visita_unidade', id: String(x.id), chave: e.unidade }),
      (g) => g.definirRegra({ ...e, usuario: s.login }),
    );
    return { ok: true, id: r.id, mensagem: 'Regra de visita gravada.' };
  }

  private async bloquear(s: SessaoCadastro, b: unknown, clinico: boolean): Promise<ResultadoPortaria> {
    const e = corpo(esquemaBloqueioVisita, b);
    if (clinico ? e.motivo !== 'clinico' : e.motivo === 'clinico')
      throw invalida(
        clinico
          ? 'Aqui só o bloqueio por decisão clínica.'
          : 'O bloqueio por decisão clínica é da enfermagem ou do médico.',
        ['motivo'],
      );
    if (e.motivo === 'judicial' && !e.documento)
      throw invalida('Informe o número do processo ou do documento da ordem judicial.', ['documento']);
    if (e.abrangencia === 'visitante' && e.visitante === null)
      throw invalida('Escolha o visitante.', ['visitante']);
    if (e.abrangencia === 'limite' && e.limite === null) throw invalida('Informe o limite.', ['limite']);
    if (e.incluiAcompanhante && e.motivo !== 'judicial' && e.motivo !== 'clinico')
      throw invalida(
        'O acompanhante com direito legal só é bloqueado por ordem judicial ou decisão clínica.',
        ['incluiAcompanhante'],
      );
    const i = await this.internadoDe(s, e.internacao);
    const agora = await this.agora(s);
    if (e.fim && e.fim < agora.slice(0, 10)) throw invalida('O fim do bloqueio é hoje ou depois.', ['fim']);
    const recurso = clinico ? P.bloquearClinico : P.regrar;
    const id = await this.apoio.sgh(
      s,
      E.visitaBloqueada.codigo,
      recurso,
      (x: number) => ({
        tabela: 'bloqueio_visitante',
        id: String(x),
        paciente: i.paciente,
        chave: e.motivo,
      }),
      (g) =>
        g.bloquear({
          internacao: i.internacao,
          paciente: i.paciente,
          motivo: e.motivo,
          abrangencia: e.abrangencia,
          visitante: e.abrangencia === 'visitante' ? e.visitante : null,
          limite: e.abrangencia === 'limite' ? e.limite : null,
          incluiAcompanhante: e.incluiAcompanhante,
          justificativa: e.justificativa,
          documento: e.documento,
          inicio: agora,
          fim: e.fim,
          usuario: s.login,
        }),
    );
    return { ok: true, id, mensagem: 'Bloqueio de visita registrado.' };
  }

  private async revogar(
    s: SessaoCadastro,
    id: string,
    b: unknown,
    clinico: boolean,
  ): Promise<ResultadoPortaria> {
    const e = corpo(esquemaMotivo, b);
    const recurso = clinico ? P.bloquearClinico : P.regrar;
    const r = await this.apoio.sgh(
      s,
      E.visitaBloqueioRevogado.codigo,
      recurso,
      (x: { id: number }) => ({ tabela: 'bloqueio_visitante', id: String(x.id), chave: 'revogacao' }),
      async (g) => {
        // A rota clínica revoga só o bloqueio clínico (o sigilo, a ordem judicial e o pedido são da supervisão): a
        // conferência é do gravador, depois do SELECT ... WITH LOCK, na mesma transação.
        const x = await g.revogarBloqueio({
          id: idDaRota(id),
          motivo: e.motivo,
          usuario: s.login,
          podeClinico: s.pode(P.bloquearClinico),
          exigeMotivo: clinico ? 'clinico' : null,
        });
        if (!clinico && x.motivo === 'clinico' && !s.pode(P.bloquearClinico))
          throw new ErroProblema(
            'sem-permissao',
            403,
            'Sem permissão',
            'O bloqueio clínico é revogado pela enfermagem.',
          );
        return x;
      },
    );
    return { ok: true, id: r.id, mensagem: 'Bloqueio revogado. O registro fica guardado.' };
  }

  @Post('bloqueios')
  @HttpCode(201)
  @Permissao(P.regrar)
  @AuditadoNoHandler('internacao.bloquearVisita: bloqueio_visitante com a trilha na mesma transação')
  bloquearVisita(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.bloquear(sessaoDe(req), b, false);
  }

  @Post('bloqueios/:id/revogacao')
  @HttpCode(201)
  @Permissao(P.regrar)
  @AuditadoNoHandler('internacao.bloquearVisita (revogação): bloqueio_visitante com a trilha junto')
  revogarBloqueio(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.revogar(sessaoDe(req), id, b, false);
  }

  @Get('bloqueios-clinicos')
  @Permissao(P.bloquearClinico)
  @Auditar(E.portariaLida.codigo)
  async bloqueiosClinicos(
    @Query('unidade') unidade: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<{
    unidades: { unidade: string; nome: string }[];
    internados: { internacao: number; nome: string; leito: string; unidade: string }[];
    bloqueios: BloqueioVisitaLido[];
    gravacao: PainelPortaria['gravacao'];
  }> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'bloqueio_visitante' };
    const [unidades, bloqueios, internados, gravacao] = await Promise.all([
      this.porta.unidades(s.porta),
      this.porta.bloqueios(s.porta, null),
      this.mapaInternados(s),
      this.apoio.gravacao(s, EXTRAS),
    ]);
    return {
      unidades,
      internados: unidade ? await this.internadosDaUnidade(s, unidade) : [],
      bloqueios: bloqueios
        .filter((b) => b.motivo === 'clinico' && internados.has(b.internacao))
        .map((b) => this.bloqueioParaTela(b, internados)),
      gravacao,
    };
  }

  @Post('bloqueios-clinicos')
  @HttpCode(201)
  @Permissao(P.bloquearClinico)
  @AuditadoNoHandler('internacao.bloquearVisita (clínico): bloqueio_visitante com a trilha junto')
  bloquearClinico(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.bloquear(sessaoDe(req), b, true);
  }

  @Post('bloqueios-clinicos/:id/revogacao')
  @HttpCode(201)
  @Permissao(P.bloquearClinico)
  @AuditadoNoHandler(
    'internacao.bloquearVisita (revogação clínica): bloqueio_visitante com a trilha junto',
  )
  revogarClinico(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.revogar(sessaoDe(req), id, b, true);
  }

  @Post('visitantes/expurgo')
  @HttpCode(201)
  @Permissao(P.regrar)
  @AuditadoNoHandler('internacao.registrarVisitante (expurgo): pessoa_portaria com a trilha junto')
  async expurgo(@Req() req: RequisicaoAutorizada): Promise<ResultadoPortaria> {
    const s = sessaoDe(req);
    const agora = await this.agora(s);
    const r = await this.apoio.sgh(
      s,
      E.visitantesExpurgados.codigo,
      P.regrar,
      (x: { ids: number[] }) => ({
        tabela: 'pessoa_portaria',
        id: String(x.ids[0] ?? ''),
        chave: `${x.ids.length}`,
      }),
      (g) => g.expurgarVisitantes({ hoje: agora.slice(0, 10), usuario: s.login, teto: 200 }),
    );
    if (this.fotos) for (const f of r.fotos) await this.fotos.remover(s.hospital, f).catch(() => undefined);
    return {
      ok: true,
      id: r.ids.length,
      mensagem:
        r.ids.length === 0
          ? 'Nenhum cadastro com o prazo de retenção vencido.'
          : `${r.ids.length} cadastro(s) de visitante anonimizado(s) (nome, documento, telefone e foto apagados).`,
    };
  }

  @Get('contatos')
  @Permissao(P.contatos)
  @Auditar(E.contatosEmitidos.codigo)
  async contatos(
    @Query('internacao') internacao: string | undefined,
    @Query('unidade') unidade: string | undefined,
    @Query('de') de: string | undefined,
    @Query('ate') ate: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ContatoVisita[]> {
    const s = sessaoDe(req);
    const r = esquemaConsultaContatos.safeParse({
      internacao: internacao ? Number(internacao) : null,
      unidade: unidade || null,
      de,
      ate,
    });
    if (!r.success)
      throw invalida('Escolha o paciente ou a unidade e o período.', [
        ...new Set(r.error.issues.map((i) => i.path.join('.'))),
      ]);
    const f = r.data;
    if (!DATA.test(f.de) || minutos(`${f.ate}T00:00`) - minutos(`${f.de}T00:00`) > 90 * 24 * 60)
      throw invalida('O período vai até 90 dias.', ['ate']);
    req.sghAlvo = { tabelaAlvo: 'visita' };
    const [vs, internados] = await Promise.all([
      this.porta.visitasDoPeriodo(s.porta, f),
      this.mapaInternados(s),
    ]);
    return vs.map((v) => this.servico.contatoParaTela(v, internados));
  }

  @Get('contatos/unidades')
  @Permissao(P.contatos)
  @Auditar(E.portariaLida.codigo)
  async unidadesContatos(@Req() req: RequisicaoAutorizada): Promise<{ unidade: string; nome: string }[]> {
    req.sghAlvo = { tabelaAlvo: 'internacao' };
    return this.porta.unidades(sessaoDe(req).porta);
  }

  @Get('contatos/internados')
  @Permissao(P.contatos)
  @Auditar(E.portariaLida.codigo)
  internadosContatos(@Query('unidade') unidade: string | undefined, @Req() req: RequisicaoAutorizada) {
    // A investigação de surto (controle de infecção) vê todos os internados da unidade, com o sigilo.
    req.sghAlvo = { tabelaAlvo: 'internacao' };
    return this.internadosDaUnidade(sessaoDe(req), unidade);
  }

  // ── Acompanhantes ─────────────────────────────────────────────────────────────────────────────────

  @Get('acompanhantes')
  @Permissao(P.acompanhante)
  @Auditar(E.portariaLida.codigo)
  async acompanhantes(
    @Query('unidade') unidade: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<
    PainelAcompanhantes & {
      internados: { internacao: number; nome: string; leito: string; unidade: string }[];
    }
  > {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'acompanhante_internacao' };
    const u = unidade?.trim() || null;
    if (u !== null && !UNIDADE.test(u)) throw invalida('Unidade inválida.', ['unidade']);
    const veSigilo = this.veSigilo(s);
    const [unidades, lista, internados, gravacao, dominios, sigilo] = await Promise.all([
      this.porta.unidades(s.porta),
      this.porta.acompanhantes(s.porta, u),
      this.mapaInternados(s),
      this.apoio.gravacao(s, EXTRAS),
      this.porta.dominios(s.porta),
      veSigilo ? Promise.resolve(new Set<number>()) : this.agora(s).then((a) => this.comSigilo(s, a)),
    ]);
    return {
      unidades,
      // O porteiro não vê o paciente com sigilo de presença (nem pelo acompanhante dele).
      acompanhantes: lista
        .filter((a) => !sigilo.has(a.internacao))
        .map((a) => this.acompanhanteParaTela(a, internados)),
      internados: u ? await this.internadosDaUnidade(s, u, veSigilo) : [],
      tiposVisitante: dominios.tiposVisitante.filter((t) => t.ativo),
      gravacao,
    };
  }

  @Get('acompanhantes/visitantes')
  @Permissao(P.acompanhante)
  @Auditar(E.portariaLida.codigo)
  visitantesAcompanhante(
    @Query('busca') busca: string | undefined,
    @Query('tipo') tipo: string | undefined,
    @Query('documento') documento: string | undefined,
    @Req() req: RequisicaoAutorizada,
  ): Promise<VisitanteLido[]> {
    return this.buscarVisitantes(req, busca, tipo, documento);
  }

  @Post('acompanhantes/visitantes')
  @HttpCode(201)
  @Permissao(P.acompanhante)
  @AuditadoNoHandler(
    'internacao.registrarVisitante (do acompanhante): pessoa_portaria com a trilha na mesma transação',
  )
  registrarVisitanteAcompanhante(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPortaria> {
    return this.cadastrarVisitante(sessaoDe(req), b, P.acompanhante);
  }

  private acompanhanteParaTela(
    a: Awaited<ReturnType<PortaPortaria['acompanhantes']>>[number],
    internados: ReadonlyMap<number, InternadoPortaria>,
  ): AcompanhanteLido {
    const i = internados.get(a.internacao);
    return {
      id: a.id,
      internacao: a.internacao,
      paciente: i?.nome ?? '',
      unidade: a.bloco,
      unidadeNome: i?.unidadeNome ?? a.bloco,
      leito: i?.leito ?? '',
      visitante: { id: a.visitante, nome: a.visitanteNome },
      fundamento: a.fundamento,
      refeicao: a.refeicao,
      pernoite: a.pernoite,
      observacao: a.observacao,
      inicio: a.inicio,
      fim: a.fim,
      substitui: a.substitui,
      criadoPor: a.criadoPor,
    };
  }

  @Post('acompanhantes')
  @HttpCode(201)
  @Permissao(P.acompanhante)
  @AuditadoNoHandler(
    'internacao.registrarAcompanhante: acompanhante_internacao com a trilha na mesma transação',
  )
  async registrarAcompanhante(
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPortaria & { aviso: string | null }> {
    const s = sessaoDe(req);
    const e = corpo(esquemaAcompanhante, b);
    const [i, pessoa, agora] = await Promise.all([
      this.internadoDe(s, e.internacao),
      this.porta.visitante(s.porta, e.visitante),
      this.agora(s),
    ]);
    if (!pessoa) throw naoEncontrado('Visitante');
    if (!this.veSigilo(s) && (await this.comSigilo(s, agora)).has(i.internacao))
      throw new ErroProblema('nao-encontrado', 404, 'Paciente não encontrado entre os internados');
    if (e.fundamento === 'autorizado' && e.refeicao)
      throw invalida(
        'A refeição do acompanhante é do direito legal: o autorizado pela equipe não entra no mapa de dietas.',
        ['refeicao'],
      );
    const f = conferirFundamento(
      e.fundamento,
      i.nascimento ? idadeNaData(i.nascimento, agora.slice(0, 10)) : null,
    );
    if (!f.ok)
      throw new ErroProblema('recusa-de-negocio', 409, 'Acompanhante', f.mensagem, { codigo: 'fundamento' });
    const r = await this.apoio.sgh(
      s,
      E.acompanhanteRegistrado.codigo,
      P.acompanhante,
      (x: { id: number }) => ({
        tabela: 'acompanhante_internacao',
        id: String(x.id),
        paciente: i.paciente,
        chave: e.fundamento,
      }),
      (g) =>
        g.registrarAcompanhante({
          internacao: i.internacao,
          paciente: i.paciente,
          bloco: i.unidade,
          visitante: pessoa.id,
          fundamento: e.fundamento,
          refeicao: e.refeicao,
          pernoite: e.pernoite,
          observacao: e.observacao,
          inicio: agora,
          usuario: s.login,
        }),
    );
    return {
      ok: true,
      id: r.id,
      mensagem: r.substituido
        ? 'Acompanhante trocado: o anterior foi encerrado.'
        : 'Acompanhante registrado.',
      aviso: f.aviso,
    };
  }

  @Post('acompanhantes/:id/fim')
  @HttpCode(201)
  @Permissao(P.acompanhante)
  @AuditadoNoHandler('internacao.registrarAcompanhante (fim): acompanhante_internacao com a trilha junto')
  async fimAcompanhante(
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() req: RequisicaoAutorizada,
  ): Promise<ResultadoPortaria> {
    const s = sessaoDe(req);
    const e = corpo(esquemaMotivo, b);
    const agora = await this.agora(s);
    const r = await this.apoio.sgh(
      s,
      E.acompanhanteEncerrado.codigo,
      P.acompanhante,
      (x: { id: number }) => ({ tabela: 'acompanhante_internacao', id: String(x.id), chave: 'fim' }),
      (g) => g.encerrarAcompanhante({ id: idDaRota(id), motivo: e.motivo, fim: agora, usuario: s.login }),
    );
    return { ok: true, id: r.id, mensagem: 'Acompanhamento encerrado.' };
  }

  // ── Terminais e catraca ───────────────────────────────────────────────────────────────────────────

  @Get('terminais')
  @Permissao(P.terminalLer)
  @Auditar(E.portariaLida.codigo)
  async terminais(@Req() req: RequisicaoAutorizada): Promise<PainelTerminais> {
    const s = sessaoDe(req);
    req.sghAlvo = { tabelaAlvo: 'terminal_acesso' };
    const [dominios, terminais, eventos, catraca, biometria, gravacao] = await Promise.all([
      this.porta.dominios(s.porta),
      this.porta.terminais(s.porta),
      this.porta.eventos(s.porta, 50),
      this.catraca.liberacao(s),
      this.biometriaLigada(s),
      this.apoio.gravacao(s, EXTRAS),
    ]);
    const tipos = new Map(dominios.tiposTerminal.map((t) => [t.codigo, t]));
    const nomes = new Map(terminais.map((t) => [t.id, t.nome]));
    return {
      dominios: dominiosParaTela(dominios, biometria),
      terminais: terminais.map((t) => ({
        ...t,
        tipoNome: tipos.get(t.tipoTerminal)?.nome ?? '',
        fabricanteNome: tipos.get(t.tipoTerminal)?.fabricanteNome ?? '',
      })),
      eventos: eventos.map((x) => ({ ...x, terminalNome: nomes.get(x.terminal) ?? '' })),
      catracaLigada: catraca.ligada,
      simulador: this.simulador,
      gravacao,
    };
  }

  private async configurar(s: SessaoCadastro, id: number | null, b: unknown): Promise<ResultadoPortaria> {
    const e = corpo(esquemaTerminal, b);
    const tipo = (await this.porta.dominios(s.porta)).tiposTerminal.find((t) => t.codigo === e.tipoTerminal);
    if (!tipo || !tipo.ativo) throw invalida('Escolha um tipo de terminal ativo.', ['tipoTerminal']);
    if (id !== null && e.versao === null) throw invalida('Falta a versão lida do terminal.', ['versao']);
    const r = await this.apoio.sgh(
      s,
      E.terminalConfigurado.codigo,
      P.terminalEditar,
      (x: { id: number }) => ({ tabela: 'terminal_acesso', id: String(x.id), chave: e.local }),
      (g) =>
        g.configurarTerminal({
          id,
          versao: id === null ? null : e.versao,
          nome: e.nome,
          tipoTerminal: tipo.codigo,
          fabricante: tipo.fabricante,
          local: e.local,
          sentido: e.sentido,
          ativo: e.ativo,
          usuario: s.login,
        }),
    );
    return { ok: true, id: r.id, mensagem: 'Terminal gravado.' };
  }

  @Post('terminais')
  @HttpCode(201)
  @Permissao(P.terminalEditar)
  @AuditadoNoHandler('internacao.configurarTerminal: terminal_acesso com a trilha na mesma transação')
  incluirTerminal(@Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.configurar(sessaoDe(req), null, b);
  }

  @Post('terminais/:id')
  @HttpCode(201)
  @Permissao(P.terminalEditar)
  @AuditadoNoHandler('internacao.configurarTerminal: terminal_acesso com a trilha na mesma transação')
  alterarTerminal(@Param('id') id: string, @Body() b: unknown, @Req() req: RequisicaoAutorizada) {
    return this.configurar(sessaoDe(req), idDaRota(id), b);
  }

  private async evento(
    s: SessaoCadastro,
    ev: { terminal: number; cracha: string; sentido: 'entrada' | 'saida'; ocorridoEm: string; chave: string },
  ): Promise<RespostaCatraca> {
    const agora = await this.agora(s);
    if (Math.abs(minutos(ev.ocorridoEm) - minutos(agora)) > TOLERANCIA_RELOGIO_MIN)
      throw invalida('O relógio do terminal difere do servidor em mais de 10 minutos: acerte o relógio.', [
        'ocorridoEm',
      ]);
    const r = await this.catraca.sgh(
      s,
      E.catracaEvento.codigo,
      P.catraca,
      (x: { id: number; resultado: string }) => ({
        tabela: 'evento_acesso_portaria',
        id: String(x.id),
        chave: `${ev.sentido}:${x.resultado}`,
      }),
      (g) =>
        g.registrarEventoCatraca({ ...ev, usuario: s.login }, (x) =>
          avaliarCatraca({
            visita: x.visita,
            agora: ev.ocorridoEm,
            sentido: ev.sentido,
            terminal: x.terminal,
          }),
        ),
    );
    return { resultado: r.resultado, motivo: r.motivo, evento: r.id, repetido: r.repetido };
  }

  @Post('catraca/eventos')
  @HttpCode(201)
  @Permissao(P.catraca)
  @AuditadoNoHandler(
    'internacao.registrarEventoCatraca: evento_acesso_portaria com a trilha na mesma transação',
  )
  eventoCatraca(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<RespostaCatraca> {
    return this.evento(sessaoDe(req), corpo(esquemaEventoCatraca, b));
  }

  @Post('catraca/simular')
  @HttpCode(201)
  @Permissao(P.terminalEditar)
  @AuditadoNoHandler(
    'internacao.registrarEventoCatraca (simulador): evento_acesso_portaria com a trilha junto',
  )
  async simular(@Body() b: unknown, @Req() req: RequisicaoAutorizada): Promise<RespostaCatraca> {
    if (!this.simulador)
      throw new ErroProblema(
        'nao-encontrado',
        404,
        'Simulador indisponível',
        'O simulador da catraca só existe fora de produção.',
      );
    const s = sessaoDe(req);
    const e = corpo(esquemaEventoCatraca.omit({ ocorridoEm: true, chave: true }), b);
    return this.evento(s, {
      ...e,
      ocorridoEm: await this.agora(s),
      chave: `simulador-${randomBytes(8).toString('hex')}`,
    });
  }
}
