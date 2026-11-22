// Rotas da linha de base de carga (k6; regra 15 da ficha do M09; cap-14 §14.2.7), **só em AMBIENTE=dev**: as leituras
// das jornadas (login, ficha, busca, listas, painéis, consulta pesada, agenda, portal, senhas, preços, diagnóstico,
// estoque, farmácia, beira do leito, prescrição, prontuário e leitos) sobre o banco próprio do cliente, pelo núcleo
// (somente leitura). O alvo de cada chamada é sorteado aqui dentro, a partir do número que o k6 manda; a resposta só
// tem contagens (nenhum valor de linha sai da API).
// Melhoria: a carga lê o banco próprio do cliente da carga (o cliente padrão da API, nunca um fixo), no estabelecimento
// escolhido pela configuração, com âncoras tiradas do próprio banco (último dia com movimento de cada área) e as
// consultas das telas em `leituras.ts`; a busca de paciente usa o mesmo serviço da tela (porta do cadastro).
// Jornadas que dependem de serviço de outro módulo montado em memória (a fila do médico, a verificação e a busca da
// prescrição, a assinatura e as contagens do vigia de leitos) respondem 404 com o motivo, registrado como pendência do
// lote (a rota real do módulo, com sessão sintética, mede essas jornadas).
import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Optional,
  Param,
  ServiceUnavailableException,
} from '@nestjs/common';
import { palavrasDoCadastro, type TipoBuscaPaciente } from '@sgh/contratos';
import { ErroTempoEsgotado, type Leitor } from '@sgh/nucleo';
import { Publica } from '../../autorizacao/decoradores.js';
import { CONFIGURACAO, type Configuracao } from '../../configuracao.js';
import { PORTA_CADASTRO, type PortaCadastro } from '../cadastro/porta.js';
import { buscarPacientes } from '../cadastro/servico.js';
import * as L from './leituras.js';

/** M11: jornadas do cenário `cadastro-busca` (k6): o termo sai do paciente sorteado, dentro da API. */
const TIPOS_CARGA_BUSCA = ['nome', 'mae', 'telefone', 'cpf'] as const satisfies readonly TipoBuscaPaciente[];

/** O estabelecimento da carga (id no banco do cliente e código da sessão). */
export interface EstabelecimentoCarga {
  readonly id: number;
  readonly codigo: string;
}

/** Leitura somente do banco do cliente da carga (o núcleo próprio). */
export interface FonteCarga {
  readonly cliente: string;
  /** O estabelecimento da carga (o primeiro ativo do cliente); null sem estabelecimento. */
  estabelecimento(): Promise<EstabelecimentoCarga | null>;
  lerSomente<T>(
    contexto: { readonly cliente: string; readonly correlacao: string },
    fn: (l: Leitor) => Promise<T>,
  ): Promise<T>;
}

export const FONTE_CARGA = Symbol('FONTE_CARGA');

/** Motivo das jornadas que esta rota não mede (respondem 404 com ele). */
export const JORNADAS_FORA = Object.freeze({
  'worklist/medico': 'a fila do médico é medida pela rota do PEP com sessão sintética',
  'prescricao/verificar': 'a verificação da prescrição é medida pela rota do PEP com sessão sintética',
  'prescricao/busca': 'a busca de item prescritível é medida pela rota do PEP com sessão sintética',
  'leitos/assinar': 'a assinatura do canal de leitos é medida pelo módulo de internação',
  'leitos/vigia': 'as contagens do vigia de leitos são lidas na saúde do módulo de internação',
});

const fora = (jornada: keyof typeof JORNADAS_FORA): never => {
  throw new NotFoundException(`Jornada fora da linha de base: ${JORNADAS_FORA[jornada]}.`);
};

interface Ctx {
  readonly f: FonteCarga;
  readonly est: EstabelecimentoCarga;
  ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T>;
}

// M06: exceção revisada (@Publica): rotas do k6 só em AMBIENTE=dev (404 nos demais), só contagens, sem sessão.
@Controller('carga')
@Publica('linha de base de carga do M09: só AMBIENTE=dev, só contagens')
export class CargaController {
  private readonly memos = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(CONFIGURACAO) private readonly cfg: Configuracao,
    @Inject(FONTE_CARGA) private readonly fonte: FonteCarga | null,
    @Optional() @Inject(PORTA_CADASTRO) private readonly cadastro: PortaCadastro | null = null,
  ) {}

  /** Lê uma vez e guarda; uma falha não fica guardada (a próxima chamada lê de novo). */
  private memo<T>(chave: string, ler: () => Promise<T>): Promise<T> {
    const atual = this.memos.get(chave) as Promise<T> | undefined;
    if (atual) return atual;
    const p = ler();
    this.memos.set(chave, p);
    p.catch(() => this.memos.delete(chave));
    return p;
  }

  private async exigir(): Promise<Ctx> {
    if (this.cfg.ambiente !== 'dev') throw new NotFoundException();
    const f = this.fonte;
    if (!f) throw new ServiceUnavailableException('Banco do cliente da carga não configurado.');
    const est = await this.memo('estabelecimento', () => f.estabelecimento());
    if (!est) throw new ServiceUnavailableException('Nenhum estabelecimento no cliente da carga.');
    return {
      f,
      est,
      ler: (fn) => f.lerSomente({ cliente: f.cliente, correlacao: 'carga' }, fn),
    };
  }

  private faixa(c: Ctx) {
    return this.memo('faixa', () => c.ler((l) => L.faixaPacientes(l)));
  }
  private ancora(c: Ctx) {
    return this.memo('ancora', () => c.ler((l) => L.ancoraCarga(l, c.est.id)));
  }
  private ancoraAgenda(c: Ctx) {
    return this.memo('agenda', () => c.ler((l) => L.ancoraAgenda(l, c.est.id)));
  }
  private ancoraRecepcao(c: Ctx) {
    return this.memo('recepcao', () => c.ler((l) => L.ancoraRecepcao(l, c.est.id)));
  }
  private prescricoes(c: Ctx) {
    return this.memo('prescricoes', () => c.ler((l) => L.prescricoesRecentes(l, c.est.id, 500)));
  }
  private alvosMarcacao(c: Ctx, a: L.AncoraAgenda) {
    return this.memo('alvos', () => c.ler((l) => L.alvosMarcacao(l, c.est.id, a)));
  }

  /** :id é só o sorteio do k6; o usuário é escolhido dentro do banco (nada dele sai da API). */
  @Get('login/:id')
  async login(@Param('id') id: string) {
    const c = await this.exigir();
    return { n: await c.ler((l) => L.cargaLogin(l, c.est.id, Number(id) || 0)) };
  }

  /** :id é só o sorteio do k6 (0 a 999999); o id do paciente é escolhido aqui, na faixa agregada. */
  @Get('ficha/:id')
  async ficha(@Param('id') id: string) {
    const c = await this.exigir();
    const alvo = alvoNaFaixa(await this.faixa(c), Number(id) || 0);
    const r = await c.ler((l) => L.cargaAbrirFicha(l, c.est.id, alvo));
    return { encontrado: r.encontrado, itens: r.itens, n: r.itens };
  }

  /**
   * M11 (`pnpm k6 -- cadastro-busca`): a busca de paciente REAL (o mesmo serviço da tela) por nome, nome da mãe,
   * telefone ou CPF. O termo é montado aqui do paciente sorteado: nada do termo nem do resultado sai da API, só `n`.
   */
  @Get('busca/:tipo/:id')
  async busca(@Param('tipo') tipo: string, @Param('id') id: string) {
    const c = await this.exigir();
    if (!this.cadastro || !(TIPOS_CARGA_BUSCA as readonly string[]).includes(tipo))
      throw new NotFoundException();
    const alvo = alvoNaFaixa(await this.faixa(c), Number(id) || 0);
    const porta = {
      cliente: c.f.cliente,
      estabelecimento: c.est.id,
      usuario: null,
      correlacao: 'carga-busca',
      rede: '',
      hospital: c.est.codigo,
    };
    const [p] = await this.cadastro.lerPacientes(porta, [alvo]);
    const duas = (v: string | null | undefined) => {
      const w = palavrasDoCadastro(v ?? null);
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
    const r = await buscarPacientes(this.cadastro, porta, { termo, tipo: tipo as TipoBuscaPaciente });
    return { n: r.itens.length, truncado: r.truncado, ms: r.duracaoMs };
  }

  @Get('listas')
  async listas() {
    const c = await this.exigir();
    const a = await this.ancora(c);
    return { n: await c.ler((l) => L.cargaListas(l, c.est.id, a)) };
  }

  @Get('painel')
  async painel() {
    const c = await this.exigir();
    return { n: await c.ler((l) => L.cargaPainel(l, c.est.id)) };
  }

  @Get('relatorio')
  async relatorio() {
    const c = await this.exigir();
    const a = await this.ancora(c);
    return { n: await c.ler((l) => L.cargaRelatorio(l, c.est.id, a)) };
  }

  /**
   * M34 (`pnpm k6 -- consulta-pesada`): a consulta GRANDE (atendimentos por fonte pagadora, mês a mês, desde 2020) com o
   * tempo máximo curto (3 s): o núcleo a cancela; a resposta diz só se foi cancelada e quanto durou.
   */
  @Get('relatorio-catalogo')
  async relatorioCatalogo() {
    const c = await this.exigir();
    const pedido = performance.now();
    let inicio = pedido;
    const tempos = () => ({
      ms: Math.round(performance.now() - inicio),
      esperaMs: Math.round(inicio - pedido),
    });
    try {
      const n = await c.ler((l) => {
        inicio = performance.now();
        return L.relatorioPesado(l, c.est.id, 3_000);
      });
      return { n, cancelada: false, ...tempos() };
    } catch (e) {
      if (e instanceof ErroTempoEsgotado) return { n: 1, cancelada: true, ...tempos() };
      throw e;
    }
  }

  /** M17 (`pnpm k6 -- agenda`): a busca de vaga, as leituras da marcação e a pauta do dia. */
  @Get('agenda/:jornada/:id')
  async agenda(@Param('jornada') jornada: string, @Param('id') id: string) {
    if (!['vagas', 'marcacao', 'pauta'].includes(jornada)) throw new NotFoundException();
    const c = await this.exigir();
    const a = await this.ancoraAgenda(c);
    const sorteio = Number(id) || 0;
    if (jornada === 'vagas') {
      const agenda = sorteio % 2 === 0 ? null : L.sortear(a.agendas, sorteio);
      return { n: await c.ler((l) => L.cargaVagas(l, c.est.id, a, agenda)) };
    }
    if (jornada === 'pauta') return { n: await c.ler((l) => L.cargaPauta(l, c.est.id, a, sorteio)) };
    const alvo = L.sortear(await this.alvosMarcacao(c, a), sorteio);
    if (!alvo) return { n: 0 };
    return { n: await c.ler((l) => L.cargaMarcacao(l, c.est.id, alvo)) };
  }

  /** M50 (`pnpm k6 -- portal-agenda`): a busca de horários do portal, "meus agendamentos" e a marcação. */
  @Get('portal/:jornada/:id')
  async portal(@Param('jornada') jornada: string, @Param('id') id: string) {
    if (!['horarios', 'agendamentos', 'marcacao'].includes(jornada)) throw new NotFoundException();
    const c = await this.exigir();
    const a = await this.ancoraAgenda(c);
    const sorteio = Number(id) || 0;
    if (jornada === 'horarios')
      return { n: await c.ler((l) => L.cargaHorariosPortal(l, c.est.id, a, sorteio)) };
    const alvo = L.sortear(await this.alvosMarcacao(c, a), sorteio);
    if (!alvo) return { n: 0 };
    if (jornada === 'agendamentos')
      return { n: await c.ler((l) => L.cargaMeusAgendamentos(l, c.est.id, alvo)) };
    return { n: await c.ler((l) => L.cargaMarcacao(l, c.est.id, alvo)) };
  }

  /** M19 (`pnpm k6 -- senhas`): a fila do guichê, o painel do supervisor e a estrutura do guichê. */
  @Get('senhas/:jornada/:id')
  async senhas(@Param('jornada') jornada: string, @Param('id') id: string) {
    if (!['fila', 'supervisor', 'estrutura'].includes(jornada)) throw new NotFoundException();
    const c = await this.exigir();
    if (jornada === 'estrutura') return { n: await c.ler((l) => L.cargaEstrutura(l, c.est.id)) };
    const a = await this.ancoraRecepcao(c);
    if (jornada === 'supervisor') return { n: await c.ler((l) => L.cargaSupervisor(l, c.est.id, a)) };
    return { n: await c.ler((l) => L.cargaFila(l, c.est.id, a, Number(id) || 0)) };
  }

  /** M27 (`carga-nominal`, `pico-recepcao`): a fila da recepção (senhas e guias do dia). A do médico: ver JORNADAS_FORA. */
  @Get('worklist/:jornada/:id')
  async worklistCarga(@Param('jornada') jornada: string, @Param('id') id: string) {
    if (jornada === 'medico') return fora('worklist/medico');
    if (jornada !== 'recepcao') throw new NotFoundException();
    const c = await this.exigir();
    const a = await this.ancoraRecepcao(c);
    return {
      n: await c.ler(async (l) => {
        const fila = await L.cargaFila(l, c.est.id, a, Number(id) || 0);
        return fila + (a.dia ? await L.guiasAguardandoAutorizacao(l, c.est.id, a.dia) : 0);
      }),
    };
  }

  /** M12 (`pnpm k6 -- precos-consulta`): o valor vigente do procedimento sorteado na data de hoje. */
  @Get('preco/:id')
  async preco(@Param('id') id: string) {
    const c = await this.exigir();
    const procs = await this.memo('precos', () => c.ler((l) => L.procedimentosComPreco(l, c.est.id, 2_000)));
    const alvo = L.sortear(procs, Number(id) || 0);
    if (alvo === null) return { n: 0 };
    const hoje = new Date().toISOString().slice(0, 10);
    return { n: (await c.ler((l) => L.valorVigente(l, alvo, hoje))) ? 1 : 0 };
  }

  /** M12: o contrato em abas, do contrato sorteado. */
  @Get('contrato/:id')
  async contrato(@Param('id') id: string) {
    const c = await this.exigir();
    const contratos = await this.memo('contratos', () =>
      c.ler((l) => L.contratosDoEstabelecimento(l, c.est.id)),
    );
    const alvo = L.sortear(contratos, Number(id) || 0);
    if (alvo === null) return { n: 0 };
    return { n: await c.ler((l) => L.cargaContrato(l, c.est.id, alvo)) };
  }

  /**
   * M26 (`pnpm k6 -- sadt`): as leituras do laboratório no último dia com pedido (exames do setor, lista de coleta,
   * mapa de trabalho e fila de liberação) e o ciclo da vigia dos valores críticos.
   */
  @Get('sadt/:parte/:id')
  async sadtCarga(@Param('parte') parte: string, @Param('id') id: string) {
    if (!['setor', 'coleta', 'mapa', 'liberacao', 'vigia'].includes(parte)) throw new NotFoundException();
    const c = await this.exigir();
    const dia = await this.memo('dia-sadt', () => c.ler((l) => L.ultimoDiaDoLaboratorio(l, c.est.id)));
    if (!dia) return { n: 0 };
    const diaColeta =
      (await this.memo('dia-coleta', () => c.ler((l) => L.ultimoDiaDoLaboratorio(l, c.est.id, true)))) ?? dia;
    return c.ler(async (l) => {
      if (parte === 'setor') {
        const situacoes = Object.keys(L.SITUACOES_SETOR) as (keyof typeof L.SITUACOES_SETOR)[];
        const s = situacoes[(Number(id) || 0) % situacoes.length] ?? 'todos';
        return { n: await L.examesDoSetor(l, c.est.id, dia, s) };
      }
      if (parte === 'coleta') return { n: await L.listaDeColeta(l, c.est.id, diaColeta) };
      if (parte === 'mapa') return { n: await L.mapaDeTrabalho(l, c.est.id, dia) };
      if (parte === 'liberacao') return { n: await L.filaDeLiberacao(l, c.est.id, dia) };
      await L.liberadosComCriticoSemAviso(l, c.est.id, dia);
      return { n: 1 };
    });
  }

  /** M28 (`pnpm k6 -- estoque-saida`): saldo do local, lotes do item, saídas da competência e requisições. */
  @Get('estoque/:parte/:id')
  async estoqueCarga(@Param('parte') parte: string, @Param('id') id: string) {
    if (!['saldos', 'lotes', 'saidas', 'requisicoes'].includes(parte)) throw new NotFoundException();
    const c = await this.exigir();
    const a = await this.memo('estoque', () => c.ler((l) => L.ancoraEstoque(l, c.est.id)));
    const local = a.local;
    if (local === null) return { n: 0 };
    return c.ler(async (l) => {
      if (parte === 'saldos') return { n: await L.saldosDoLocal(l, c.est.id, local) };
      if (parte === 'lotes') {
        const insumo = L.sortear(a.insumos, Number(id) || 0);
        return { n: insumo === null ? 0 : await L.lotesDoLocal(l, local, insumo) };
      }
      if (parte === 'saidas')
        return { n: a.mes ? await L.saidasDaCompetencia(l, c.est.id, local, a.mes) : 0 };
      return { n: await L.requisicoesPendentes(l, c.est.id, local) };
    });
  }

  /** M29 (`pnpm k6 -- dispensar`): a fila da unidade com mais internados (12 h), as entregas e os controlados (7 dias). */
  @Get('farmacia/:parte/:id')
  async farmaciaCarga(@Param('parte') parte: string) {
    if (!['fila', 'entregas', 'controlados'].includes(parte)) throw new NotFoundException();
    const c = await this.exigir();
    const a = await this.memo('farmacia', () => c.ler((l) => L.ancoraFarmacia(l, c.est.id)));
    const fim = a.fim ?? new Date();
    return c.ler(async (l) => {
      if (parte === 'fila')
        return {
          n:
            a.unidade === null
              ? 0
              : await L.filaDaUnidade(l, c.est.id, a.unidade, new Date(fim.getTime() - 12 * 3_600_000), fim),
        };
      if (parte === 'entregas') return { n: await L.entregasPendentes(l, c.est.id) };
      return { n: await L.movimentosControlados(l, c.est.id, new Date(fim.getTime() - 7 * 86_400_000), fim) };
    });
  }

  /** M25 (`pnpm k6 -- checagem`): turno da unidade, horários do paciente (12 h), releitura e histórico do horário. */
  @Get('enfermagem/:parte/:id')
  async enfermagemCarga(@Param('parte') parte: string, @Param('id') id: string) {
    if (!['turno', 'paciente', 'releitura', 'historico'].includes(parte)) throw new NotFoundException();
    const c = await this.exigir();
    const alvo = L.sortear(await this.prescricoes(c), Number(id) || 0);
    if (!alvo) return { n: 0 };
    return c.ler(async (l) => {
      const ancora = await L.ancoraDaPrescricao(l, c.est.id, alvo.prescricao);
      if (!ancora) return { n: 0 };
      if (parte === 'releitura') return { n: await L.situacaoDoHorario(l, c.est.id, ancora.horario) };
      if (parte === 'historico') return { n: 1 + (await L.historicoDoHorario(l, ancora.horario)) };
      const t = ancora.previsto.getTime();
      const inicio = new Date(t - 6 * 3_600_000);
      const fim = new Date(t + 6 * 3_600_000);
      if (parte === 'paciente')
        return { n: await L.horariosDoAtendimento(l, c.est.id, ancora.atendimento, inicio, fim) };
      return { n: await L.horariosDaUnidadeDoAtendimento(l, c.est.id, ancora.atendimento, inicio, fim) };
    });
  }

  /** M24 (`pnpm k6 -- prescricao`): a lista do atendimento e a prescrição aberta. Verificar e busca: JORNADAS_FORA. */
  @Get('prescricao/:parte/:id')
  async prescricaoCarga(@Param('parte') parte: string, @Param('id') id: string) {
    if (parte === 'verificar') return fora('prescricao/verificar');
    if (parte === 'busca') return fora('prescricao/busca');
    if (!['lista', 'leitura'].includes(parte)) throw new NotFoundException();
    const c = await this.exigir();
    const alvo = L.sortear(await this.prescricoes(c), Number(id) || 0);
    if (!alvo) return { n: 0 };
    if (parte === 'lista')
      return { n: await c.ler((l) => L.prescricoesDoAtendimento(l, c.est.id, alvo.atendimento)) };
    return { n: await c.ler((l) => L.leituraDaPrescricao(l, c.est.id, alvo.prescricao)) };
  }

  /** M15 (`pnpm k6 -- prontuario`): a lista dos registros, o registro mais novo e o cabeçalho do paciente sorteado. */
  @Get('prontuario/:parte/:id')
  async prontuarioCarga(@Param('parte') parte: string, @Param('id') id: string) {
    if (!['lista', 'registro', 'cabecalho'].includes(parte)) throw new NotFoundException();
    const c = await this.exigir();
    const pacientes = await this.memo('pacientes-pep', () =>
      c.ler((l) => L.pacientesComRegistros(l, c.est.id, 500)),
    );
    const paciente = L.sortear(pacientes, Number(id) || 0);
    if (paciente === null) return { n: 0 };
    if (parte === 'cabecalho') return { n: await c.ler((l) => L.cabecalhoDoPaciente(l, c.est.id, paciente)) };
    if (parte === 'lista') return { n: await c.ler((l) => L.registrosDoPaciente(l, c.est.id, paciente)) };
    return { n: await c.ler((l) => L.registroMaisNovo(l, c.est.id, paciente)) };
  }

  /** M16 (`pnpm k6 -- painel-leitos`): os leitos ocupados do estabelecimento. Assinar e vigia: JORNADAS_FORA. */
  @Get('leitos/painel/:id')
  async leitosPainel() {
    const c = await this.exigir();
    return { n: await c.ler((l) => L.leitosOcupados(l, c.est.id)) };
  }

  @Get('leitos/assinar/:id')
  leitosAssinar() {
    return fora('leitos/assinar');
  }

  @Get('leitos/vigia')
  leitosVigia() {
    return fora('leitos/vigia');
  }
}

/** O id do paciente na faixa agregada, pelo sorteio do k6. */
export function alvoNaFaixa(f: { min: number; max: number }, sorteio: number): number {
  return f.max > f.min ? f.min + (Math.abs(sorteio) % (f.max - f.min + 1)) : f.min;
}
