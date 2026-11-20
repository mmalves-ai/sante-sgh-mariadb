// Rotas da linha de base de carga do M09 (regra 15 da ficha; cap-14 §14.2.7), **só em AMBIENTE=dev**: as
// leituras das jornadas login, abrir ficha, listas, painéis automáticos e consulta pesada, pelo núcleo do
// legado (somente leitura), para o k6 medir p95 enquanto o login (M05) e a ficha (M15) não existem. A
// resposta só tem contagens (nenhum valor de linha sai da API). Trocadas pelas rotas reais quando existirem.
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common';
import { esquemaFiltrosRegistros, palavrasDoCadastro, type TipoBuscaPaciente } from '@sgh/contratos';
import {
  type AlvoMarcacaoCarga,
  type AncoraAgenda,
  ancoraAgenda,
  alvosMarcacao,
  type AncoraCarga,
  ancoraCarga,
  type AncoraRecepcao,
  ancoraRecepcao,
  cargaEstrutura,
  cargaFila,
  cargaSupervisor,
  cargaMarcacao,
  cargaPauta,
  cargaVagas,
  cargaHorariosPortal,
  cargaMeusAgendamentos,
  cargaAbrirFicha,
  cargaListas,
  cargaLogin,
  cargaPainel,
  cargaRelatorio,
  type ContextoLegado,
  ErroRelatorio,
  executarRelatorioCatalogo,
  faixaPacientes,
  itemHonorarioNaData,
  type Leitor,
  lerValoresContrato,
  listarConvenios,
  pacientesComRegistros,
  paresComPreco,
  prescricoesRecentes,
  examesDoSetor,
  filaDeLiberacao,
  guiasAguardandoAutorizacao,
  loginsComProfissional,
  liberadosComCriticoDesde,
  listaDeColeta,
  mapaDeTrabalho,
  ultimoDiaDoLaboratorio,
  ancoraDaPrescricaoCarga,
  historicoDoHorario,
  horariosDosAtendimentos,
  situacoesDosHorarios,
  internadoDoAtendimento,
  internadosDaUnidade,
  competenciaDoSaldo,
  documentosEstoque,
  lotesDoLocal,
  relogioEstoque,
  entregasPorSituacao,
  ultimoHorarioChecar,
  filaDaUnidade,
  itensControlados,
  movimentosControlados,
  unidadesFarmacia,
  requisicoesPendentes,
  saldosEstoque,
} from '@sgh/legado';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { Publica } from '../../autorizacao/decoradores.js';
import { PORTA_CADASTRO, type PortaCadastro } from '../cadastro/porta.js';
import { buscarPacientes } from '../cadastro/servico.js';
import { SERVICO_PRONTUARIO } from '../pep/prontuario.controller.js';
import type { ServicoProntuario } from '../pep/servico.js';
import { esquemaItemPrescricao } from '@sgh/contratos';
import { SERVICO_PRESCRICAO } from '../pep/prescricao.controller.js';
import type { ServicoPrescricao } from '../pep/prescricao-servico.js';
import { PARAMETROS_PADRAO } from '../internacao/configuracao.js';
import type { ServicoInternacao } from '../internacao/servico.js';
import { SERVICO_INTERNACAO } from '../internacao/simbolos.js';
import { MOTOR_VIGIA, type MotorVigia } from '../internacao/vigia.js';
import { internadosEmCache } from '../enfermagem/porta-legado.js';
import { SERVICO_DOCUMENTOS } from '../pep/documentos.controller.js';
import type { ServicoDocumentos } from '../pep/documentos-servico.js';
import { categoriaDoCbo } from '@sgh/dominio-pep';
import { ServicoWorklistMedico } from '../pep/aplicacao/worklist-medico.js';
import { PORTA_PRESCRICAO, type PortaPrescricao } from '../pep/prescricao-porta.js';
import { PORTA_WORKLIST, type PortaWorklist } from '../pep/worklist-porta.js';

/** M11: jornadas do cenário `cadastro-busca` (k6): o termo sai do paciente sorteado, dentro da API. */
const TIPOS_CARGA_BUSCA = ['nome', 'mae', 'telefone', 'cpf'] as const satisfies readonly TipoBuscaPaciente[];

export interface FonteCarga {
  readonly rede: string;
  readonly estabelecimentos: readonly { readonly codigo: string }[];
  lerSomente<T>(
    ctx: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'>,
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
}

export const FONTE_CARGA = Symbol('FONTE_CARGA');

// M06: exceção revisada (@Publica): rotas do k6 só em AMBIENTE=dev (404 nos demais), só contagens, sem
// sessão (o k6 mede a leitura do legado); trocadas pelas rotas reais com permissão quando existirem.
@Controller('carga')
@Publica('linha de base de carga do M09: só AMBIENTE=dev, só contagens; trocada pelas rotas reais')
export class CargaController {
  private faixa: Promise<{ min: number; max: number }> | null = null;
  private pares: Promise<{ tab: number; cod: number }[]> | null = null;
  private convenios: Promise<number[]> | null = null;
  private ancora: Promise<AncoraCarga> | null = null;
  private pacientesPep: Promise<number[]> | null = null;
  private ancoraAg: Promise<AncoraAgenda> | null = null;
  private alvosAg: Promise<AlvoMarcacaoCarga[]> | null = null;
  private ancoraRec: Promise<AncoraRecepcao> | null = null;

  constructor(
    @Inject(CONFIGURACAO) private readonly cfg: Configuracao,
    @Inject(FONTE_CARGA) private readonly fonte: FonteCarga | null,
    @Optional() @Inject(PORTA_CADASTRO) private readonly cadastro: PortaCadastro | null = null,
    @Optional() @Inject(SERVICO_PRONTUARIO) private readonly prontuario: ServicoProntuario | null = null,
    @Optional() @Inject(SERVICO_INTERNACAO) private readonly internacao: ServicoInternacao | null = null,
    @Optional() @Inject(MOTOR_VIGIA) private readonly vigia: MotorVigia | null = null,
    @Optional() @Inject(SERVICO_DOCUMENTOS) private readonly documentos: ServicoDocumentos | null = null,
    @Optional() @Inject(SERVICO_PRESCRICAO) private readonly prescricao: ServicoPrescricao | null = null,
    @Optional() @Inject(PORTA_WORKLIST) private readonly worklist: PortaWorklist | null = null,
    @Optional() @Inject(PORTA_PRESCRICAO) private readonly portaPrescricao: PortaPrescricao | null = null,
  ) {}

  private medicosComFila: Promise<string[]> | null = null;
  private servicoWorklist: ServicoWorklistMedico | null = null;

  /**
   * M27 (`pnpm k6 -- carga-nominal`, `troca-plantao`, `pico-recepcao`): as filas da página inicial REAIS (o mesmo
   * serviço da tela). `medico`: a fila de um médico sorteado entre os logins do cadastro de profissionais cuja fila
   * não está vazia na cópia (escolhidos uma vez, dentro da API); `recepcao`: a fila do guichê do último dia de senhas e
   * as guias aguardando autorização desse dia. Só `n` sai da API.
   */
  @Get('worklist/:jornada/:id')
  async worklistCarga(@Param('jornada') jornada: string, @Param('id') id: string) {
    const { f, ctx } = this.exigir();
    const c = { rede: ctx.rede, hospital: ctx.hospital };
    if (jornada === 'medico') {
      if (!this.documentos || !this.worklist || this.worklist.destino !== 'legado')
        throw new NotFoundException();
      const servico = (this.servicoWorklist ??= new ServicoWorklistMedico(
        this.documentos,
        this.portaPrescricao,
        this.worklist,
      ));
      const medicos = await this.memo(
        this.medicosComFila,
        async () => {
          const logins = await f.lerSomente(ctx, (l) => loginsComProfissional(l, 50));
          const com: string[] = [];
          for (const login of logins)
            if ((await servico.fila(c, login)).pacientes.length > 0) com.push(login);
          return com;
        },
        (p) => (this.medicosComFila = p),
      );
      const login = medicos[(Number(id) || 0) % Math.max(1, medicos.length)];
      if (!login) return { n: 0 };
      return { n: (await servico.fila(c, login)).pacientes.length };
    }
    if (jornada === 'recepcao') {
      const ancora = await this.memo(
        this.ancoraRec,
        () => f.lerSomente(ctx, (l) => ancoraRecepcao(l)),
        (p) => (this.ancoraRec = p),
      );
      return {
        n: await f.lerSomente(ctx, async (l) => {
          const fila = await cargaFila(l, ctx.hospital, ancora, Number(id) || 0);
          const guias = ancora.dia ? (await guiasAguardandoAutorizacao(l, ancora.dia)).guias.length : 0;
          return fila + guias;
        }),
      };
    }
    throw new NotFoundException();
  }

  private prescricoesCarga: Promise<{ prescricao: number; atendimento: number }[]> | null = null;

  /**
   * M24 (`pnpm k6 -- prescricao`, p95 < 2 s): a prescrição REAL (o mesmo serviço da tela) sorteada entre as mais
   * recentes: `lista` lê as prescrições do atendimento; `leitura` abre a prescrição com itens, horários e prova;
   * `verificar` refaz, para o período seguinte, as verificações de apoio à decisão e os horários previstos dos itens
   * dela (o que o "Assinar" faz antes de gravar); `busca` procura o item prescritível no índice sem acento (p95 <
   * 200 ms, ficha seção 4). Só `n` sai da API. A gravação não entra: na cópia compartilhada o
   * executor de dev é só de leitura.
   */
  @Get('prescricao/:parte/:id')
  async prescricaoCarga(@Param('parte') parte: string, @Param('id') id: string) {
    const { f, ctx } = this.exigir();
    if (
      !this.prescricao ||
      this.prescricao.destino !== 'legado' ||
      !['lista', 'leitura', 'verificar', 'busca'].includes(parte)
    )
      throw new NotFoundException();
    if (parte === 'busca') {
      // A busca do item prescritível como a tela faz a cada tecla: o termo são as 4 primeiras letras de um item
      // sorteado do índice (sem acento, do cache do processo); só `n` (as sugestões) sai.
      const c0 = { rede: ctx.rede, hospital: ctx.hospital };
      const indice = await this.prescricao.indiceBusca(c0);
      const x = indice.linhas[(Number(id) || 0) % Math.max(1, indice.linhas.length)];
      if (!x) return { n: 0 };
      return { n: this.prescricao.buscarProdutos(x.n.slice(0, 4), indice).length };
    }
    const ps = await this.memo(
      this.prescricoesCarga,
      () => f.lerSomente(ctx, (l) => prescricoesRecentes(l, 500)),
      (p) => (this.prescricoesCarga = p),
    );
    const alvo = ps[(Number(id) || 0) % Math.max(1, ps.length)];
    if (!alvo) return { n: 0 };
    const c = { rede: ctx.rede, hospital: ctx.hospital };
    const a = await this.prescricao.portaDados.atendimento(c, alvo.atendimento);
    if (!a) return { n: 0 };
    if (parte === 'lista') return { n: (await this.prescricao.prescricoes(c, a.paciente, a.id)).length };
    const p = await this.prescricao.lerPrescricao(c, a.paciente, alvo.prescricao);
    if (parte === 'leitura') return { n: p.itensLidos.reduce((t, i) => t + 1 + i.horarios.length, 0) };
    const itens = p.itensLidos.flatMap((i, k) =>
      i.detalhe ? [esquemaItemPrescricao.parse({ chave: `k${k}`, detalhe: i.detalhe })] : [],
    );
    if (itens.length === 0 || !a.aberto) return { n: 0 };
    try {
      const v = await this.prescricao.verificar(
        c,
        a.paciente,
        { atendimento: a.id, periodo: 'seguinte', itens },
        { cbo: 225125, ocupacao: null, nome: null, categoria: 'medico' },
        {
          baseInteracoes: false,
          altaVigilancia: new Set(),
          duplaChecagem: true,
          criterioDuplicidade: 'ambos',
        },
      );
      return { n: 1 + v.alertas.length + Object.values(v.horarios).reduce((t, h) => t + h.length, 0) };
    } catch {
      // Atendimento sem regra de horário ou fechado entre o sorteio e a verificação: a jornada conta 0 linha.
      return { n: 0 };
    }
  }

  /**
   * M25 (`pnpm k6 -- checagem`, ficha seção 4 e regra 16): as leituras da beira do leito sobre a prescrição REAL
   * sorteada entre as mais recentes, com a janela em torno do primeiro horário dela (a cópia não tem horários do dia):
   * `turno` é a linha do tempo da unidade do paciente (2.000 horários, p95 < 1 s); `paciente`, os horários do paciente
   * nas 12 h do tablet (300, p95 < 500 ms); `releitura`, a situação atual do horário antes de checar (p95 < 100 ms);
   * `historico`, o histórico do horário (50, p95 < 300 ms). Só `n` sai; a checagem (gravação) é medida no teste de
   * integração na cópia (transação desfeita), porque o executor de dev da cópia compartilhada é só de leitura.
   */
  @Get('enfermagem/:parte/:id')
  async enfermagemCarga(@Param('parte') parte: string, @Param('id') id: string) {
    const { f, ctx } = this.exigir();
    if (!['turno', 'paciente', 'releitura', 'historico'].includes(parte)) throw new NotFoundException();
    const ps = await this.memo(
      this.prescricoesCarga,
      () => f.lerSomente(ctx, (l) => prescricoesRecentes(l, 500)),
      (p) => (this.prescricoesCarga = p),
    );
    const alvo = ps[(Number(id) || 0) % Math.max(1, ps.length)];
    if (!alvo) return { n: 0 };
    return f.lerSomente(ctx, async (l) => {
      const ancora = await ancoraDaPrescricaoCarga(l, alvo.prescricao);
      if (!ancora) return { n: 0 };
      // A releitura antes de checar é a situação atual do horário pela chave (a trava sem espera é da receita).
      if (parte === 'releitura') return { n: (await situacoesDosHorarios(l, [ancora.horario])).size };
      if (parte === 'historico')
        return { n: 1 + (await historicoDoHorario(l, ancora.horario)).eventos.length };
      const t = ancora.previsto.getTime();
      const janela = { inicio: new Date(t - 6 * 3_600_000), fim: new Date(t + 6 * 3_600_000) };
      if (parte === 'paciente') {
        const r = await horariosDosAtendimentos(l, {
          atendimentos: [alvo.atendimento],
          ...janela,
          teto: 300,
          hospital: ctx.hospital,
        });
        return { n: r.itens.length };
      }
      const i = await internadoDoAtendimento(l, alvo.atendimento);
      // Como a porta da enfermagem: os internados da unidade guardados por 30 s.
      const daUnidade = i
        ? (
            await internadosEmCache(ctx.rede, ctx.hospital, i.unidade, () =>
              internadosDaUnidade(l, i.unidade),
            )
          ).map((x) => x.atendimento)
        : [];
      const r = await horariosDosAtendimentos(l, {
        atendimentos: [alvo.atendimento, ...daUnidade],
        ...janela,
        teto: 2_000,
        hospital: ctx.hospital,
      });
      return { n: r.itens.length };
    });
  }

  /**
   * M16 (`pnpm k6 -- painel-leitos`): o painel de leitos REAL (o mesmo serviço da tela, com o cache por versão do
   * vigia). Só `n` (os ocupados) sai.
   */
  @Get('leitos/painel/:id')
  async leitosPainel() {
    const { ctx } = this.exigir();
    if (!this.internacao || this.internacao.destino !== 'legado') throw new NotFoundException();
    const p = await this.internacao.painel(ctx, PARAMETROS_PADRAO);
    return { n: p.totais.ocupados };
  }

  /** M16: uma "tela" escutando o canal de leitos por 3 minutos (como o canal de eventos faria). */
  @Get('leitos/assinar/:id')
  leitosAssinar() {
    const { ctx } = this.exigir();
    if (!this.vigia) throw new NotFoundException();
    const sair = this.vigia.assinar(ctx.hospital, 'leitos', () => undefined);
    setTimeout(sair, 180_000).unref();
    return { n: 1 };
  }

  /** M16: as contagens do vigia do canal de leitos (ciclos, consultas, telas): a carga fixa por ciclo. */
  @Get('leitos/vigia')
  leitosVigia() {
    const { ctx } = this.exigir();
    const c = this.vigia
      ?.saude()
      .canais.find((x) => x.canal === 'leitos' && x.estabelecimento === ctx.hospital);
    return {
      n: c?.ciclos ?? 0,
      ciclos: c?.ciclos ?? 0,
      consultas: c?.consultasTotais ?? 0,
      telas: c?.assinantes ?? 0,
      consultasUltimoCiclo: c?.consultasUltimoCiclo ?? 0,
    };
  }

  private exigir(): { f: FonteCarga; ctx: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'> } {
    if (this.cfg.ambiente !== 'dev') throw new NotFoundException();
    if (!this.fonte) throw new ServiceUnavailableException('Núcleo do legado não configurado.');
    const hospital = this.fonte.estabelecimentos[0]?.codigo;
    if (!hospital) throw new ServiceUnavailableException('Nenhum estabelecimento configurado.');
    return { f: this.fonte, ctx: { rede: this.fonte.rede, hospital, traceId: 'carga' } };
  }

  /** Lê uma vez e guarda; uma falha não fica guardada (a próxima chamada lê de novo). */
  private memo<T>(atual: Promise<T> | null, ler: () => Promise<T>, guardar: (p: Promise<T> | null) => void) {
    if (atual) return atual;
    const p = ler();
    guardar(p);
    p.catch(() => guardar(null));
    return p;
  }

  private lerAncora(f: FonteCarga, ctx: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'>) {
    return this.memo(
      this.ancora,
      () => f.lerSomente(ctx, (l) => ancoraCarga(l)),
      (p) => (this.ancora = p),
    );
  }

  /** :id é só o sorteio do k6; o usuário é escolhido dentro do banco (o nome não sai do Firebird). */
  @Get('login/:id')
  async login(@Param('id') id: string) {
    const { f, ctx } = this.exigir();
    return { n: await f.lerSomente(ctx, (l) => cargaLogin(l, Number(id) || 0)) };
  }

  /** :id é só o sorteio do k6 (0 a 999999); o ID do paciente é escolhido aqui, na faixa agregada. */
  @Get('ficha/:id')
  async ficha(@Param('id') id: string) {
    const { f, ctx } = this.exigir();
    const { min, max } = await this.memo(
      this.faixa,
      () => f.lerSomente(ctx, (l) => faixaPacientes(l)),
      (p) => (this.faixa = p),
    );
    const sorteio = Number(id) || 0;
    const alvo = max > min ? min + (sorteio % (max - min + 1)) : min;
    const r = await f.lerSomente(ctx, (l) => cargaAbrirFicha(l, alvo));
    return { encontrado: r.encontrado, itens: r.itens, n: r.itens };
  }

  /**
   * M11 (`pnpm k6 -- cadastro-busca`): a busca de paciente REAL (o mesmo serviço da tela) por nome, nome da
   * mãe, telefone ou CPF. O termo é montado aqui do paciente sorteado na faixa agregada (duas palavras do nome
   * ou da mãe, os 8 últimos dígitos do telefone, o CPF): nada do termo nem do resultado sai da API, só `n`.
   */
  @Get('busca/:tipo/:id')
  async busca(@Param('tipo') tipo: string, @Param('id') id: string) {
    const { f, ctx } = this.exigir();
    if (!this.cadastro || !(TIPOS_CARGA_BUSCA as readonly string[]).includes(tipo))
      throw new NotFoundException();
    const { min, max } = await this.memo(
      this.faixa,
      () => f.lerSomente(ctx, (l) => faixaPacientes(l)),
      (p) => (this.faixa = p),
    );
    const sorteio = Number(id) || 0;
    const alvo = max > min ? min + (sorteio % (max - min + 1)) : min;
    const c = { rede: ctx.rede, hospital: ctx.hospital };
    const [p] = await this.cadastro.lerPacientes(c, [alvo]);
    const duas = (n: string | null) => {
      const w = palavrasDoCadastro(n);
      return w.length === 0 ? '' : w.length === 1 ? w[0]! : `${w[0]} ${w[w.length - 1]}`;
    };
    const termo = !p
      ? ''
      : tipo === 'nome'
        ? duas(p.nome)
        : tipo === 'mae'
          ? duas(p.mae)
          : tipo === 'telefone'
            ? (p.celular ?? p.telefone ?? '').replace(/\D+/g, '').slice(-8)
            : p.cpf
              ? String(p.cpf).padStart(11, '0')
              : '';
    if (termo.length < 3) return { n: 0, vazio: true };
    const r = await buscarPacientes(this.cadastro, c, { termo, tipo: tipo as TipoBuscaPaciente });
    return { n: r.itens.length, truncado: r.truncado, ms: r.duracaoMs };
  }

  /**
   * M15 (`pnpm k6 -- prontuario`, p95 < 1,5 s): o prontuário REAL (o mesmo serviço da tela) de um paciente com
   * registros recentes, escolhido aqui pelo sorteio do k6: `lista` abre a lista dos registros; `registro` abre o
   * registro mais novo e a aba "como emitido". Nada do conteúdo sai da API, só `n`.
   */
  @Get('prontuario/:parte/:id')
  async prontuarioCarga(@Param('parte') parte: string, @Param('id') id: string) {
    const { f, ctx } = this.exigir();
    if (
      !this.prontuario ||
      this.prontuario.destino !== 'legado' ||
      !['lista', 'registro', 'cabecalho'].includes(parte)
    )
      throw new NotFoundException();
    const pacientes = await this.memo(
      this.pacientesPep,
      () => f.lerSomente(ctx, (l) => pacientesComRegistros(l, 500)),
      (p) => (this.pacientesPep = p),
    );
    const paciente = pacientes[(Number(id) || 0) % Math.max(1, pacientes.length)];
    if (!paciente) return { n: 0 };
    const c = { rede: ctx.rede, hospital: ctx.hospital };
    // M23 (regra 19): abrir o prontuário de uso diário = o cabeçalho fixo com o resumo (identificação, alergias e os
    // alertas do atendimento), pelo mesmo serviço da tela.
    if (parte === 'cabecalho') {
      if (!this.documentos) throw new NotFoundException();
      const cab = await this.documentos.cabecalho(c, paciente, null, 'K6.CARGA');
      return { n: cab.alertas.length + cab.atendimentos.length };
    }
    const lista = await this.prontuario.lista(c, paciente, esquemaFiltrosRegistros.parse({}));
    if (parte === 'lista') return { n: lista.itens.length };
    const r = lista.itens[0];
    if (!r) return { n: 0 };
    // O leitor é da categoria do autor (o sigilo da psicologia, regra 15 do M23, não vale para quem registrou).
    const leitor = categoriaDoCbo(r.profissional.cbo);
    await this.prontuario.abrir(c, paciente, r.id, leitor);
    const aba = await this.prontuario.aba(c, paciente, r.id, 'como-emitido', {
      mostrarDocumentos: false,
      leitor,
    });
    return { n: aba.aba === 'como-emitido' ? aba.conteudo.campos.length + aba.conteudo.blocos.length : 0 };
  }

  @Get('listas')
  async listas() {
    const { f, ctx } = this.exigir();
    const ancora = await this.lerAncora(f, ctx);
    return { n: await f.lerSomente(ctx, (l) => cargaListas(l, ancora)) };
  }

  @Get('painel')
  async painel() {
    const { f, ctx } = this.exigir();
    const ancora = await this.lerAncora(f, ctx);
    return { n: await f.lerSomente(ctx, (l) => cargaPainel(l, ancora)) };
  }

  @Get('relatorio')
  async relatorio() {
    const { f, ctx } = this.exigir();
    const ancora = await this.lerAncora(f, ctx);
    return { n: await f.lerSomente(ctx, (l) => cargaRelatorio(l, ancora)) };
  }

  /**
   * M34 (`pnpm k6 -- consulta-pesada`; ficha, seção 11; cap-14 §14.2.7): o relatório GRANDE do catálogo (o faturamento
   * por convênio na data do item de 2020 a 2026, mês a mês) com o tempo máximo curto (3 s): o executor confere o tempo
   * entre as fatias e o cancela; a resposta diz só se foi cancelado e quanto durou (nenhuma linha sai).
   */
  @Get('relatorio-catalogo')
  async relatorioCatalogo() {
    const { f, ctx } = this.exigir();
    // `ms` é o tempo do executor (a partir da conexão em mãos); a espera pela conexão do pool sai à parte.
    const pedido = performance.now();
    let inicio = pedido;
    const tempos = () => ({
      ms: Math.round(performance.now() - inicio),
      esperaMs: Math.round(inicio - pedido),
    });
    try {
      const r = await f.lerSomente(ctx, (l) => {
        inicio = performance.now();
        return executarRelatorioCatalogo(
          l,
          'faturamentoPorConvenio',
          { mesInicio: '2020-01', mesFim: '2026-06', regua: 'data-do-item' },
          { teto: 2_000, tempoMaximoMs: 3_000 },
        );
      });
      return { n: r.linhas.length, cancelada: false, ...tempos() };
    } catch (e) {
      if (e instanceof ErroRelatorio && e.motivo === 'tempo') return { n: 1, cancelada: true, ...tempos() };
      throw e;
    }
  }

  // M17 (ficha, seção 11: `pnpm k6 -- agenda`): a busca de vaga (a consulta da tela, metade das chamadas em todas
  // as agendas ativas e metade numa só), as leituras da marcação (as da receita antes de gravar) e a pauta do dia,
  // na janela da última grade da cópia. Resposta só com contagem.
  private lerAncoraAgenda(f: FonteCarga, ctx: Pick<ContextoLegado, 'rede' | 'hospital' | 'traceId'>) {
    return this.memo(
      this.ancoraAg,
      () => f.lerSomente(ctx, (l) => ancoraAgenda(l)),
      (p) => (this.ancoraAg = p),
    );
  }

  @Get('agenda/:jornada/:id')
  async agenda(@Param('jornada') jornada: string, @Param('id') id: string) {
    const { f, ctx } = this.exigir();
    if (!['vagas', 'marcacao', 'pauta'].includes(jornada)) throw new NotFoundException();
    const ancora = await this.lerAncoraAgenda(f, ctx);
    const sorteio = Number(id) || 0;
    if (jornada === 'vagas') {
      const agenda =
        sorteio % 2 === 0 ? null : (ancora.agendas[sorteio % Math.max(1, ancora.agendas.length)] ?? null);
      return { n: await f.lerSomente(ctx, (l) => cargaVagas(l, ancora, agenda)) };
    }
    if (jornada === 'pauta') return { n: await f.lerSomente(ctx, (l) => cargaPauta(l, ancora, sorteio)) };
    const alvos = await this.memo(
      this.alvosAg,
      () => f.lerSomente(ctx, (l) => alvosMarcacao(l, ancora)),
      (p) => (this.alvosAg = p),
    );
    const alvo = alvos[sorteio % Math.max(1, alvos.length)];
    if (!alvo) return { n: 0 };
    return { n: await f.lerSomente(ctx, (l) => cargaMarcacao(l, alvo)) };
  }

  // M50 (etapa 2; ficha, seção 11: `pnpm k6 -- portal-agenda`): a busca de horários do portal, "meus agendamentos" e as
  // leituras da marcação pelo portal (as da receita do M17), em rajada, com a carga do legado. Resposta só com contagem.
  @Get('portal/:jornada/:id')
  async portal(@Param('jornada') jornada: string, @Param('id') id: string) {
    const { f, ctx } = this.exigir();
    if (!['horarios', 'agendamentos', 'marcacao'].includes(jornada)) throw new NotFoundException();
    const ancora = await this.lerAncoraAgenda(f, ctx);
    const sorteio = Number(id) || 0;
    if (jornada === 'horarios')
      return { n: await f.lerSomente(ctx, (l) => cargaHorariosPortal(l, ancora, sorteio)) };
    const alvos = await this.memo(
      this.alvosAg,
      () => f.lerSomente(ctx, (l) => alvosMarcacao(l, ancora)),
      (p) => (this.alvosAg = p),
    );
    const alvo = alvos[sorteio % Math.max(1, alvos.length)];
    if (!alvo) return { n: 0 };
    if (jornada === 'agendamentos')
      return { n: await f.lerSomente(ctx, (l) => cargaMeusAgendamentos(l, ctx.hospital, alvo)) };
    return { n: await f.lerSomente(ctx, (l) => cargaMarcacao(l, alvo)) };
  }

  // M19 (ficha, seção 11: `pnpm k6 -- senhas`): a fila do guichê (as senhas do dia da recepção e os guichês em uso),
  // o painel do supervisor (as senhas do dia e os indicadores) e a estrutura do guichê, no último dia com senhas da
  // cópia. Resposta só com contagem.
  @Get('senhas/:jornada/:id')
  async senhas(@Param('jornada') jornada: string, @Param('id') id: string) {
    const { f, ctx } = this.exigir();
    if (!['fila', 'supervisor', 'estrutura'].includes(jornada)) throw new NotFoundException();
    if (jornada === 'estrutura')
      return { n: await f.lerSomente(ctx, (l) => cargaEstrutura(l, ctx.hospital)) };
    const ancora = await this.memo(
      this.ancoraRec,
      () => f.lerSomente(ctx, (l) => ancoraRecepcao(l)),
      (p) => (this.ancoraRec = p),
    );
    if (jornada === 'supervisor')
      return { n: await f.lerSomente(ctx, (l) => cargaSupervisor(l, ctx.hospital, ancora)) };
    return { n: await f.lerSomente(ctx, (l) => cargaFila(l, ctx.hospital, ancora, Number(id) || 0)) };
  }

  // M12 (ficha, seção 11: `pnpm k6 -- precos-consulta`, p95 < 500 ms): a consulta de valor vigente (a mesma
  // leitura da tela, maior DATA ≤ data-base) e o contrato em abas, sobre pares e convênios da cópia
  // escolhidos aqui (o k6 só manda o sorteio). Resposta só com contagem.
  @Get('preco/:id')
  async preco(@Param('id') id: string) {
    const { f, ctx } = this.exigir();
    const pares = await this.memo(
      this.pares,
      () => f.lerSomente(ctx, (l) => paresComPreco(l, 2000)),
      (p) => (this.pares = p),
    );
    const par = pares[(Number(id) || 0) % Math.max(1, pares.length)];
    if (!par) return { n: 0 };
    const hoje = new Date().toISOString().slice(0, 10);
    const item = await f.lerSomente(ctx, (l) => itemHonorarioNaData(l, par.tab, par.cod, hoje));
    return { n: item?.valores ? 1 : 0 };
  }

  @Get('contrato/:id')
  async contrato(@Param('id') id: string) {
    const { f, ctx } = this.exigir();
    const convs = await this.memo(
      this.convenios,
      () => f.lerSomente(ctx, async (l) => (await listarConvenios(l)).map((c) => c.codigo)),
      (p) => (this.convenios = p),
    );
    const c = convs[(Number(id) || 0) % Math.max(1, convs.length)];
    if (c === undefined) return { n: 0 };
    const v = await f.lerSomente(ctx, (l) => lerValoresContrato(l, c));
    return { n: v ? 1 : 0 };
  }

  private diaSadt: Promise<string> | null = null;
  private diaColetaSadt: Promise<string> | null = null;

  /**
   * M26 (`pnpm k6 -- sadt`; ficha, seção 10: 2 mil exames por dia com picos de coleta e liberação): as leituras das
   * telas do laboratório no último dia de movimento da cópia (exames do setor, lista de coleta, mapa de trabalho e
   * fila de liberação) e o ciclo da vigia dos valores críticos (as liberações com faixa crítica desde o começo da
   * janela, a consulta que a vigia repete para o aviso < 1 min). Só `n` sai da API; a gravação não entra (na cópia
   * compartilhada o executor de dev é só de leitura, D-K6-26).
   */
  @Get('sadt/:parte/:id')
  async sadtCarga(@Param('parte') parte: string, @Param('id') id: string) {
    const { f, ctx } = this.exigir();
    if (!['setor', 'coleta', 'mapa', 'liberacao', 'vigia'].includes(parte)) throw new NotFoundException();
    const dia = await this.memo(
      this.diaSadt,
      () => f.lerSomente(ctx, (l) => ultimoDiaDoLaboratorio(l)),
      (p) => (this.diaSadt = p),
    );
    // A coleta lista os pedidos ainda não recebidos: o último dia com pedido pendente do laboratório.
    const diaColeta = await this.memo(
      this.diaColetaSadt,
      () => f.lerSomente(ctx, async (l) => (await ultimoDiaDoLaboratorio(l, { pendente: true })) || dia),
      (p) => (this.diaColetaSadt = p),
    );
    const cod = ctx.hospital;
    const janela = { inicio: dia, fim: dia };
    return f.lerSomente(ctx, async (l) => {
      if (parte === 'setor') {
        const situacoes = ['todos', 'aReceber', 'aLiberar', 'liberados'] as const;
        const situacao = situacoes[(Number(id) || 0) % situacoes.length] ?? 'todos';
        return {
          n: (await examesDoSetor(l, cod, { setor: 'laboratorio', ...janela, situacao })).itens.length,
        };
      }
      if (parte === 'coleta')
        return { n: (await listaDeColeta(l, cod, { inicio: diaColeta, fim: diaColeta })).grupos.length };
      if (parte === 'mapa')
        return { n: (await mapaDeTrabalho(l, cod, { setor: 'laboratorio', ...janela })).bancadas.length };
      if (parte === 'liberacao')
        return { n: (await filaDeLiberacao(l, cod, { setor: 'laboratorio', ...janela })).itens.length };
      const desde = new Date(Date.parse(`${dia}T00:00:00`));
      // A vigia devolve só as liberações com faixa crítica cadastrada (na cópia, as do teste): o ciclo lido conta 1.
      await liberadosComCriticoDesde(l, cod, { desde, hoje: dia });
      return { n: 1 };
    });
  }

  private compEstoque: Promise<{ ano: number; mes: number; hoje: string; itens: number[] }> | null = null;

  /**
   * M28 (`pnpm k6 -- estoque-saida`; ficha, seção 10): as leituras da tela de saída no almoxarifado central (10) — o
   * saldo do local, os lotes do item escolhido, as saídas da competência e a fila das requisições —, na competência
   * mais recente com saldo da cópia. Só `n` sai da API; a gravação não entra (na cópia compartilhada o executor de dev
   * é só de leitura; e os documentos de estoque seguem desligados, D-MOTOR-28).
   */
  @Get('estoque/:parte/:id')
  async estoqueCarga(@Param('parte') parte: string, @Param('id') id: string) {
    const { f, ctx } = this.exigir();
    if (!['saldos', 'lotes', 'saidas', 'requisicoes'].includes(parte)) throw new NotFoundException();
    const LOCAL = 10;
    // O dia de referência é o último movimento da cópia (a âncora da carga): o dump termina antes do relógio.
    const ancora = await this.lerAncora(f, ctx);
    const c = await this.memo(
      this.compEstoque,
      () =>
        f.lerSomente(ctx, async (l) => {
          const r = await relogioEstoque(l);
          const ref = ancora.entrada ? ancora.entrada.toISOString().slice(0, 10) : r.hoje;
          const k = await competenciaDoSaldo(l, {
            ano: Number(ref.slice(0, 4)),
            mes: Number(ref.slice(5, 7)),
          });
          const hoje = `${k.ano}-${String(k.mes).padStart(2, '0')}-28`;
          const s = await saldosEstoque(l, { local: LOCAL, hoje, alertaDias: 30 });
          return {
            ...k,
            hoje,
            itens: s.itens
              .filter((x) => x.rastreavel)
              .map((x) => x.item)
              .slice(0, 200),
          };
        }),
      (p) => (this.compEstoque = p),
    );
    return f.lerSomente(ctx, async (l) => {
      if (parte === 'saldos')
        return { n: (await saldosEstoque(l, { local: LOCAL, hoje: c.hoje, alertaDias: 30 })).itens.length };
      if (parte === 'lotes') {
        const item = c.itens[(Number(id) || 0) % Math.max(1, c.itens.length)] ?? 0;
        return { n: item ? (await lotesDoLocal(l, item, LOCAL, c.hoje, 30)).length : 0 };
      }
      const inicio = `${c.ano}-${String(c.mes).padStart(2, '0')}-01`;
      if (parte === 'saidas')
        return {
          n: (await documentosEstoque(l, { tipo: 'saida', local: LOCAL, inicio, fim: c.hoje })).itens.length,
        };
      return { n: (await requisicoesPendentes(l, { local: LOCAL, hoje: c.hoje })).itens.length };
    });
  }

  /**
   * M29 (`pnpm k6 -- dispensar`; ficha, seção 10): as leituras da tela de dispensação (a fila da unidade com mais
   * internados na janela de 12 h ancorada no último horário da cópia), da entrega ao setor e dos controlados (7 dias).
   * A gravação não vai ao k6 (o k6 não grava na cópia; a dispensação segue desligada, D-MOTOR-28): o tempo da
   * dispensação com a baixa de estoque é o da integração na cópia (D-K6-29).
   */
  private ancoraFarmacia: Promise<{ unidade: string; fim: Date; itens: number[] }> | null = null;
  @Get('farmacia/:parte/:id')
  async farmaciaCarga(@Param('parte') parte: string, @Param('id') id: string) {
    const { f, ctx } = this.exigir();
    if (!['fila', 'entregas', 'controlados'].includes(parte)) throw new NotFoundException();
    this.ancoraFarmacia ??= f.lerSomente(ctx, async (l) => {
      const us = await unidadesFarmacia(l);
      const u = [...us].sort((a, b) => b.internados - a.internados)[0];
      const fim = (await ultimoHorarioChecar(l)) ?? new Date();
      const itens = (await itensControlados(l)).map((x) => x.item);
      return { unidade: u?.unidade ?? '', fim, itens };
    });
    const a = await this.ancoraFarmacia;
    void id;
    return f.lerSomente(ctx, async (l) => {
      if (parte === 'fila') {
        const inicio = new Date(a.fim.getTime() - 12 * 3_600_000);
        const r = await filaDaUnidade(l, { unidade: a.unidade, inicio, fim: a.fim, hospital: ctx.hospital });
        return { n: r.doses.length };
      }
      if (parte === 'entregas') return { n: (await entregasPorSituacao(l, { situacao: 7 })).length };
      const inicio = new Date(a.fim.getTime() - 7 * 86_400_000);
      return { n: (await movimentosControlados(l, { itens: a.itens, inicio, fim: a.fim })).length };
    });
  }
}
