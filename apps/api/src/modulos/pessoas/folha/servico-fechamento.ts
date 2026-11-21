// Serviço do fechamento do período da folha, fatia F6 (M53.7; ficha do M53, seções 6 a 8, regras 7 e 10): a lista dos
// fechamentos, a prévia e o fechamento do período (mensal ou anual) com os processamentos fixados, a data de pagamento
// da folha mensal e a prova da soma, e a reabertura com motivo. Fechado, o período não aceita cálculo, recálculo nem
// descarte (o gravador confere na mesma transação). A reabertura é recusada enquanto o eSocial do período estiver
// fechado (S-1299 em andamento ou aceito): primeiro a reabertura dos periódicos (S-1298). Grava pela porta da folha, com a trilha na
// mesma transação, atrás da chave `pessoas.folha` (POL-3). Nenhuma resposta traz CPF ou nome.
//
// D-PERM-FECH-537 (POL-5): o recibo de férias e a rescisão são de um colaborador só; sem `pessoas.salario.ler` o líquido
// deles sai nulo na lista e na prévia, e a prova da soma mostra só os totais do período (D-PERM-SAL-533).
import { createHash } from 'node:crypto';
import {
  CHAVE_PESSOAS_FOLHA,
  type ConferenciaFechamentoFolha,
  EVENTOS_AUDITAVEIS,
  type FecharFolhaEntrada,
  type FechamentoFolha,
  type FiltroFechamentosFolha,
  type ListaFechamentosFolha,
  type ProcessoNoFechamento,
  type ReabrirFolhaEntrada,
  type ResultadoFechamentoFolha,
  type TotaisFechamentoFolha,
} from '@sgh/contratos';
import {
  conferirFechamentoFolha,
  pendenciasFechamento,
  type ProcessoParaFechamento,
  processosDoPeriodo,
  processosNoFechamento,
  situacaoDoPeriodo,
  textoResumoFechamento,
  totaisFechamento,
} from '@sgh/dominio-pessoas';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { PortaEsocial } from '../esocial/porta-esocial.js';
import type { ContextoCalculoFolha, GravadorCalculoFolha, PortaCalculoFolha } from './porta-calculo.js';
import type { PortaFolha } from './porta-folha.js';
import { type FechamentoDaFolha, type ProcessoDaFolha } from './tipos-folha.js';
import { TETO_FECHAMENTOS_FOLHA } from './apoio-folha.js';

export const PERMISSOES_FECHAMENTO_FOLHA = {
  ler: 'pessoas.folha.ler',
  fechar: 'pessoas.folha.fechar',
  salarioLer: 'pessoas.salario.ler',
} as const;
const P = PERMISSOES_FECHAMENTO_FOLHA;
const E = EVENTOS_AUDITAVEIS;

const sha256 = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
const naoEncontrado = (o: string) =>
  new ErroProblema(
    'nao-encontrado',
    404,
    `${o} não encontrado`,
    'O registro não existe neste estabelecimento.',
  );
const recusa = (codigo: string, mensagem: string, extra: object = {}) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, { codigo, ...extra });

/** As competências que o período cobre (o anual, o ano inteiro: as duas parcelas do 13º). */
export const intervaloDoPeriodo = (apuracao: 'mensal' | 'anual', periodo: string) =>
  apuracao === 'anual' ? { de: `${periodo}-01`, ate: `${periodo}-12` } : { de: periodo, ate: periodo };

const paraFechamento = (p: ProcessoDaFolha): ProcessoParaFechamento => ({
  id: p.id,
  tipo: p.tipo,
  competencia: p.competencia,
  numero: p.numero,
  situacao: p.situacao,
  pagamento: p.pagamento,
  resumo: p.resumo,
  totais: p.totais,
});

const DE_UM_COLABORADOR = ['ferias', 'rescisao'];

/** O líquido do recibo de férias e da rescisão omitido sem `pessoas.salario.ler` (D-PERM-FECH-537). */
const mascararProcessos = (
  ps: readonly ProcessoNoFechamento[],
  verSalario: boolean,
): ProcessoNoFechamento[] =>
  ps.map((p) => (verSalario || !DE_UM_COLABORADOR.includes(p.tipo) ? p : { ...p, liquido: null }));

const mascararConferencia = (
  c: ConferenciaFechamentoFolha,
  verSalario: boolean,
  totais: TotaisFechamentoFolha,
): ConferenciaFechamentoFolha =>
  verSalario
    ? c
    : {
        ...c,
        parcelas: [
          { rotulo: 'Proventos', valor: totais.proventos },
          { rotulo: 'Descontos', valor: totais.descontos },
          { rotulo: 'Líquido (proventos − descontos)', valor: totais.liquido },
        ],
      };

export const paraFechamentoApi = (f: FechamentoDaFolha, verSalario: boolean): FechamentoFolha => ({
  ...f,
  processos: mascararProcessos(f.processos, verSalario),
});

export class ServicoFechamentoFolha {
  readonly apoio: ApoioGravacao<GravadorCalculoFolha>;

  constructor(
    readonly porta: PortaCalculoFolha,
    readonly folha: PortaFolha,
    /** O eSocial do período (a reabertura espera o S-1298); null nos testes que não o usam. */
    readonly esocial: PortaEsocial | null,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    this.apoio = new ApoioGravacao<GravadorCalculoFolha>(
      { chave: CHAVE_PESSOAS_FOLHA, nome: 'a folha de pagamento', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  private ctx(s: SessaoCadastro): ContextoCalculoFolha {
    return s.porta;
  }

  private async exigirEmpresa(s: SessaoCadastro, empresa: number): Promise<void> {
    const es = await this.folha.empresas(this.ctx(s));
    if (!es.some((e) => e.codigo === empresa)) throw naoEncontrado('Empresa');
  }

  async listar(s: SessaoCadastro, f: FiltroFechamentosFolha): Promise<ListaFechamentosFolha> {
    const xs = await this.porta.fechamentos(this.ctx(s), {
      ...(f.empresa !== undefined ? { empresa: f.empresa } : {}),
      ...(f.apuracao ? { apuracao: f.apuracao } : {}),
      ...(f.ano ? { ano: f.ano } : {}),
    });
    const ver = s.pode(P.salarioLer);
    return {
      itens: xs.slice(0, TETO_FECHAMENTOS_FOLHA).map((x) => paraFechamentoApi(x, ver)),
      limitado: xs.length > TETO_FECHAMENTOS_FOLHA,
    };
  }

  async detalhe(s: SessaoCadastro, id: number): Promise<FechamentoFolha> {
    const f = await this.porta.fechamento(this.ctx(s), id);
    if (!f) throw naoEncontrado('Fechamento da folha');
    return paraFechamentoApi(f, s.pode(P.salarioLer));
  }

  /** O fechamento em vigor do período (null: aberto). */
  async vigente(
    s: SessaoCadastro,
    empresa: number,
    apuracao: 'mensal' | 'anual',
    periodo: string,
  ): Promise<FechamentoDaFolha | null> {
    const xs = await this.porta.fechamentos(this.ctx(s), { empresa, apuracao, periodo, situacao: 'fechada' });
    return xs[0] ?? null;
  }

  private montar(x: FecharFolhaEntrada, hoje: string, jaFechado: boolean, lidos: readonly ProcessoDaFolha[]) {
    const processos = processosDoPeriodo(x.apuracao, x.periodo, lidos.map(paraFechamento));
    const pagamento = x.apuracao === 'mensal' ? x.pagamento : null;
    const pendencias = pendenciasFechamento({
      apuracao: x.apuracao,
      periodo: x.periodo,
      hoje,
      pagamento,
      jaFechado,
      processos,
    });
    const totais = totaisFechamento(processos);
    const conferencia = conferirFechamentoFolha(processos, totais);
    const fixados = processosNoFechamento(processos, pagamento);
    return { processos, pagamento, pendencias, totais, conferencia, fixados };
  }

  /** Prévia (`simular`) ou fechamento do período; pendência ou soma divergente barram. */
  async fechar(s: SessaoCadastro, x: FecharFolhaEntrada): Promise<ResultadoFechamentoFolha> {
    if (!x.simular) await this.apoio.exigirLiberacao(s);
    await this.exigirEmpresa(s, x.empresa);
    const c = this.ctx(s);
    const { de, ate } = intervaloDoPeriodo(x.apuracao, x.periodo);
    const [{ hoje }, lidos, vigente] = await Promise.all([
      this.folha.relogio(c),
      this.porta.processos(c, {
        empresa: x.empresa,
        competenciaDe: de,
        competenciaAte: ate,
        situacao: 'calculada',
      }),
      this.vigente(s, x.empresa, x.apuracao, x.periodo),
    ]);
    const ver = s.pode(P.salarioLer);
    const previa = this.montar(x, hoje, vigente !== null, lidos);
    const resposta = (m: typeof previa, fechamento: FechamentoFolha | null): ResultadoFechamentoFolha => ({
      fechado: fechamento !== null,
      simulado: x.simular,
      fechamento,
      processos: mascararProcessos(m.fixados, ver),
      totais: m.totais,
      pendencias: m.pendencias,
      conferencia: mascararConferencia(m.conferencia, ver, m.totais),
    });
    if (x.simular) return resposta(previa, null);
    if (previa.pendencias.length || !previa.conferencia.ok)
      throw recusa(
        'fechamento-com-pendencias',
        'O período tem pendências: confira a prévia antes de fechar.',
        {
          pendencias: previa.pendencias,
          divergencias: previa.conferencia.divergencias,
        },
      );
    const r = await this.apoio.sgh(
      s,
      E.pessoasFolhaFechada.codigo,
      CHAVE_PESSOAS_FOLHA,
      (y: { id: number }) => ({
        tabela: 'SGH_PES_FOLHA_FECHAMENTO',
        id: String(y.id),
        chave: `${x.empresa}:${x.apuracao}:${x.periodo}`,
      }),
      async (g) => {
        // A releitura com trava é a que vale: o que o fechamento fixa é o que está em vigor agora.
        const { vigente: v, proximoNumero } = await g.fechamentoEmVigorComTrava(
          x.empresa,
          x.apuracao,
          x.periodo,
        );
        const travados = await g.processosCalculadosComTrava(x.empresa, de, ate);
        const m = this.montar(x, hoje, v !== null, travados);
        if (v)
          throw recusa('periodo-ja-fechado', 'O período já está fechado: reabra antes de fechar de novo.');
        if (m.pendencias.length || !m.conferencia.ok)
          throw recusa(
            'fechamento-com-pendencias',
            'O período mudou e tem pendências: abra a prévia de novo.',
            {
              pendencias: m.pendencias,
            },
          );
        const resumo = sha256(textoResumoFechamento(m.fixados));
        const id = await g.incluirFechamento({
          empresa: x.empresa,
          apuracao: x.apuracao,
          periodo: x.periodo,
          numero: proximoNumero,
          pagamento: m.pagamento,
          processos: m.fixados,
          totais: m.totais,
          resumo,
          por: s.login,
        });
        return { id, m };
      },
    );
    const gravado = await this.porta.fechamento(c, r.id);
    return resposta(r.m, gravado ? paraFechamentoApi(gravado, ver) : null);
  }

  /** O eSocial do período está fechado (S-1299 em andamento ou aceito, sem S-1298 aceito depois). */
  private async esocialFechado(s: SessaoCadastro, f: FechamentoDaFolha): Promise<boolean> {
    if (!this.esocial) return false;
    const evs = await this.esocial.eventos(this.ctx(s), {
      empresa: f.empresa,
      eventos: ['S-1299', 'S-1298'],
      de: f.periodo,
      ate: f.periodo,
    });
    const sit = situacaoDoPeriodo(
      evs
        .filter((e) => e.dataReferencia === f.periodo)
        .map((e) => ({
          id: e.id,
          evento: e.evento,
          vinculo: e.vinculo,
          situacao: e.situacao,
          criadoEm: e.criadoEm,
        })),
    ).situacao;
    return sit !== 'aberto';
  }

  async reabrir(s: SessaoCadastro, id: number, x: ReabrirFolhaEntrada): Promise<FechamentoFolha> {
    await this.apoio.exigirLiberacao(s);
    const f = await this.porta.fechamento(this.ctx(s), id);
    if (!f) throw naoEncontrado('Fechamento da folha');
    if (f.situacao !== 'fechada') throw recusa('periodo-nao-fechado', 'Este fechamento já foi reaberto.');
    if (await this.esocialFechado(s, f))
      throw recusa(
        'esocial-fechado',
        'Os periódicos do eSocial deste período estão fechados: gere e envie a reabertura (S-1298) antes.',
      );
    await this.apoio.sgh(
      s,
      E.pessoasFolhaReaberta.codigo,
      CHAVE_PESSOAS_FOLHA,
      {
        tabela: 'SGH_PES_FOLHA_FECHAMENTO',
        id: String(id),
        chave: `${f.empresa}:${f.apuracao}:${f.periodo}`,
      },
      async (g) => {
        await g.reabrirFechamento({ id, versao: x.versao, motivo: x.motivo, por: s.login });
        return { id };
      },
    );
    const lido = await this.porta.fechamento(this.ctx(s), id);
    return paraFechamentoApi(lido ?? f, s.pode(P.salarioLer));
  }
}
