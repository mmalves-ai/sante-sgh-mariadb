// "Meu espaço" (autosserviço do colaborador), fatia F6 (M52.6; ficha, seção 7, PWA leve; regra 21; cap-07 §7.1.1): o
// colaborador vê SÓ o próprio. O vínculo sai do login (os vínculos do usuário no estabelecimento); o pedido de outro
// vínculo é recusado (nunca cai no primeiro que existir). Reúne, sem gravar: o vínculo, os próximos plantões da escala
// publicada, o saldo do banco de horas, os treinamentos obrigatórios e os POPs pendentes (a ciência é do serviço dos
// treinamentos), e o próximo exame ocupacional e as vacinas pendentes (só datas e situações, nunca o conteúdo do ASO;
// regra 16). Holerite e férias só com a folha no Sante SGH (chave `pessoas.folha`, M53). A leitura é auditada.
import { Logger } from '@nestjs/common';
import {
  type BlocoMeuEspaco,
  CHAVE_PESSOAS_AUTOATENDIMENTO,
  type MeuEspaco,
  VACINAS_SESMT,
} from '@sgh/contratos';
import {
  type AsoLido,
  escopoProprio,
  holeriteDisponivel,
  type RegistroVacinaLido,
  situacaoAso,
  situacaoVacinas,
} from '@sgh/dominio-pessoas';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { PortaEscala } from '../escala/porta-escala.js';
import type { PortaPessoas } from '../porta.js';
import type { GravadorPonto, PortaPonto } from '../ponto/porta-ponto.js';
import type { PortaSesmt } from '../sesmt/porta-sesmt.js';
import type { ServicoTreinamento } from '../treinamento/servico-treinamento.js';

/** A frase do holerite e das férias enquanto a folha não está no sistema (sem link para fora; ADR 0023). */
export const MENSAGEM_FOLHA_FORA =
  'O holerite e as férias aparecem aqui quando a folha de pagamento estiver neste sistema. Até lá, consulte o RH.';
export const MENSAGEM_FOLHA_DISPONIVEL = 'O holerite e as férias estão na folha de pagamento.';

function somarDias(dia: string, n: number): string {
  const d = new Date(`${dia}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const asoLido = (x: ExameOcupacional): AsoLido => ({
  id: x.id,
  tipo: x.tipo ?? -1,
  data: x.data,
  conclusao: x.conclusao ?? 0,
  proximo: x.proximo,
  retifica: x.retifica,
});
const vacinaLida = (x: VacinaAplicada): RegistroVacinaLido => ({
  id: x.id,
  registro: x.registro,
  vacina: x.vacina,
  dose: x.dose as RegistroVacinaLido['dose'],
  data: x.data,
  antiHbs: x.antiHbs,
  retifica: x.retifica,
});

/** O vínculo de trabalho como a porta de pessoas devolve. */
export type VinculoColaborador = NonNullable<Awaited<ReturnType<PortaPessoas['vinculo']>>>;
type ExameOcupacional = Awaited<ReturnType<PortaSesmt['ocupacional']>>[number];
type VacinaAplicada = Awaited<ReturnType<PortaSesmt['vacinas']>>[number];

/** Os vínculos do login no estabelecimento (o escopo do autosserviço; também o do holerite, M53.3). */
export async function vinculosDoLogin(
  pessoas: PortaPessoas,
  ponto: PortaPonto,
  s: SessaoCadastro,
): Promise<VinculoColaborador[]> {
  const ids = await ponto.vinculosDoLogin(s.porta, s.login);
  const vs = await Promise.all(ids.map((id) => pessoas.vinculo(s.porta, id)));
  // A porta de pessoas já lê só o estabelecimento da sessão.
  return vs.filter((v): v is VinculoColaborador => v !== null);
}

export class ServicoMeuEspaco {
  readonly apoio: ApoioGravacao<GravadorPonto>;
  private readonly log = new Logger('MeuEspaco');
  private readonly folha: ApoioGravacao<GravadorPonto>;

  constructor(
    readonly pessoas: PortaPessoas,
    readonly ponto: PortaPonto,
    readonly escala: PortaEscala,
    readonly sesmt: PortaSesmt,
    readonly treinamento: ServicoTreinamento,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    this.apoio = new ApoioGravacao<GravadorPonto>(
      { chave: CHAVE_PESSOAS_AUTOATENDIMENTO, nome: 'o seu espaço', operacoes: {} },
      ponto,
      trilha,
      configuracao,
      cache,
    );
    this.folha = new ApoioGravacao<GravadorPonto>(
      { chave: 'pessoas.folha', nome: 'a folha de pagamento', operacoes: {} },
      ponto,
      trilha,
      configuracao,
      cache,
    );
  }

  /** Os vínculos do login no estabelecimento (o escopo do autosserviço), com a situação. */
  vinculosDoLogin(s: SessaoCadastro): Promise<VinculoColaborador[]> {
    return vinculosDoLogin(this.pessoas, this.ponto, s);
  }

  async meuEspaco(s: SessaoCadastro, pedido: number | null): Promise<MeuEspaco> {
    const [{ hoje, agora }, liberado, folhaLigada, vinculos] = await Promise.all([
      this.sesmt.relogio(s.porta),
      this.apoio.liberacao(s),
      this.folha.liberacao(s).then((l) => l.ligada),
      this.vinculosDoLogin(s),
    ]);
    const escopo = escopoProprio(
      vinculos.map((v) => ({ id: v.id, ativo: v.desligamento === null })),
      pedido,
    );
    if (escopo.recusa)
      throw new ErroProblema('sem-permissao', 403, 'Só o próprio', escopo.recusa.mensagem, {
        codigo: escopo.recusa.codigo,
      });
    const folha =
      holeriteDisponivel(folhaLigada) === 'disponivel'
        ? { disponivel: true, mensagem: MENSAGEM_FOLHA_DISPONIVEL }
        : { disponivel: false, mensagem: MENSAGEM_FOLHA_FORA };
    const v = vinculos.find((x) => x.id === escopo.vinculo) ?? null;
    const vazio: MeuEspaco = {
      hoje,
      liberado: { ligada: liberado.ligada, motivo: liberado.motivo },
      colaborador: null,
      outrosVinculos: [],
      indisponiveis: [],
      plantoes: [],
      ponto: { saldoBancoMin: null, competencia: hoje.slice(0, 7) },
      treinamentos: [],
      pops: [],
      saude: { proximoAso: null, asoVencido: false, vacinasPendentes: [] },
      folha,
    };
    // Desligada a chave, a tela mostra só o aviso: nada pessoal é lido (POL-3).
    if (!v || !liberado.ligada) return vazio;
    const unidades = new Map((await this.pessoas.unidades(s.porta)).map((u) => [u.codigo, u.nome]));
    const ate = `${somarDias(hoje, 31)}T00:00`;
    // A leitura que falha não vira "nenhum" na tela: o bloco sai marcado como indisponível (a pessoa vê "não foi
    // possível carregar agora", nunca "sem plantões" ou "sem ASO" quando não se sabe).
    const indisponiveis = new Set<BlocoMeuEspaco>();
    const ou = <T>(bloco: BlocoMeuEspaco, p: Promise<T>, vazio: T): Promise<T> =>
      p.catch((erro: unknown) => {
        indisponiveis.add(bloco);
        // Só o tipo do erro no log (nada da pessoa).
        this.log.warn(`Meu espaço: o bloco ${bloco} não pôde ser lido (${(erro as Error)?.name ?? 'erro'}).`);
        return vazio;
      });
    const [plantoes0, saldos, treino, ocupacional, vacinas] = await Promise.all([
      ou(
        'plantoes',
        this.escala.plantoesDaPessoa(s.porta, v.pessoa, {
          de: agora,
          ate,
          inicioDesde: `${somarDias(hoje, -2)}T00:00`,
        }),
        [],
      ),
      ou('ponto', this.ponto.saldosBanco(s.porta, [v.id]), new Map<number, number>()),
      this.treinamento.pendenciasDoVinculo(s, v),
      ou('saude', this.sesmt.ocupacional(s.porta, v.id), []),
      ou('saude', this.sesmt.vacinas(s.porta, v.id), []),
    ]);
    const escalas = new Map<number, string | null>();
    for (const p of plantoes0)
      if (!escalas.has(p.escala)) {
        const e = await ou('plantoes', this.escala.escala(s.porta, p.escala), null);
        escalas.set(
          p.escala,
          e && e.estado === 'publicada' ? (unidades.get(e.unidade) ?? null) : '__rascunho',
        );
      }
    const plantoes = indisponiveis.has('plantoes') ? [] : plantoes0;
    const saudeLida = !indisponiveis.has('saude');
    const aso = situacaoAso(ocupacional.filter((x) => x.registro === 'aso').map(asoLido), hoje);
    const pendVac = situacaoVacinas(vacinas.map(vacinaLida), hoje)
      .filter((x) => x.pendencias.length > 0)
      .map((x) => VACINAS_SESMT[x.vacina].rotulo);
    return {
      ...vazio,
      indisponiveis: [...indisponiveis],
      colaborador: {
        vinculo: v.id,
        nome: v.nome,
        matricula: v.matricula,
        tipo: v.tipo,
        cargo: v.cargo,
        funcao: v.funcao,
        unidadeNome: v.unidade !== null ? (unidades.get(v.unidade) ?? null) : null,
        admissao: v.admissao,
        desligamento: v.desligamento,
      },
      outrosVinculos: vinculos
        .filter((x) => x.id !== v.id)
        .map((x) => ({
          vinculo: x.id,
          rotulo: `${x.cargo}${x.desligamento ? ' (desligado)' : ''}`,
        })),
      // Só a escala publicada chega ao colaborador (o rascunho ainda pode mudar).
      plantoes: plantoes
        .filter((p) => escalas.get(p.escala) !== '__rascunho')
        .slice(0, 31)
        .map((p) => ({
          id: p.id,
          inicio: p.inicio,
          fim: p.fim,
          tipo: p.tipo,
          unidadeNome: escalas.get(p.escala) ?? null,
          chegadaMin: p.chegadaMin,
        })),
      ponto: { saldoBancoMin: saldos.get(v.id) ?? null, competencia: hoje.slice(0, 7) },
      treinamentos: treino.cursos,
      pops: treino.pops.map((p) => ({
        id: p.id,
        codigo: p.codigo,
        versao: p.versao,
        titulo: p.titulo,
        vigencia: p.vigencia,
        resumo: p.resumo,
        referencia: p.referencia,
        alteracoes: p.alteracoes,
      })),
      saude: {
        proximoAso: aso.ultimo?.proximo ?? null,
        asoVencido: saudeLida && (aso.situacao === 'vencido' || aso.situacao === 'sem-aso'),
        vacinasPendentes: pendVac,
      },
    };
  }
}
