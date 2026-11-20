// Avaliação de desempenho e de competências, alerta de experiência e PDI (W0-06, parte 5; M2 de mercado; matriz,
// linhas "Tabelas de domínio" e "Avaliação de desempenho"):
//   - competência: a alteração leva motivo e o valor anterior (SGH_PES_CORRECAO); a usada se inativa; a exclusão física
//     só da nunca usada (409 com a contagem e a oferta da inativação);
//   - ciclo: alteração do aberto com motivo e o valor anterior; encerrar, cancelar e reabrir com motivo; exclusão só
//     sem avaliação (409 com a contagem e a oferta do cancelamento);
//   - avaliação: abre em rascunho com as competências ATIVAS do cargo do colaborador; nota de 1 até a escala do
//     ciclo; finalizada é imutável (a correção é versão nova com justificativa e a anterior continua visível); a
//     ciência é do próprio colaborador (o vínculo sai do login) ou registrada pelo RH (colhida em papel);
//   - alerta de experiência: CLT admitido há até 90 dias, marcos de 45 e 90 dias sem a avaliação daquele marco;
//   - PDI: ação ligada à competência e ao curso do treinamento; alteração da aberta com motivo; conclusão e
//     cancelamento com motivo (não se exclui).
// A chave de liberação é a do cadastro de colaboradores (`pessoas.colaborador`; proibido criar chave nova). O modelo
// (competências e escala) é dado do dono: a tela nasce vazia (D-W006-AVAL-MODELO).
import {
  type AbrirAvaliacaoEntrada,
  type AlertaExperienciaResposta,
  type AlterarCicloEntrada,
  type AlterarCompetenciaEntrada,
  type AlterarPdiEntrada,
  type ApoioAvaliacao,
  type AvaliacaoResposta,
  type AvaliacoesDoColaborador,
  type CicloAvaliacaoResposta,
  type CienciaPropriaEntrada,
  type CienciaRegistradaEntrada,
  type CompetenciaDoCargoResposta,
  type CorrecaoResposta,
  type CorrigirAvaliacaoEntrada,
  type DesligarCompetenciaCargoEntrada,
  EVENTOS_AUDITAVEIS,
  type ExcluirAvaliacaoEntrada,
  type ExcluirCicloEntrada,
  type ExcluirCompetenciaEntrada,
  type FichaAvaliacao,
  type FichaCicloAvaliacao,
  type FinalizarAvaliacaoEntrada,
  type IncluirCicloEntrada,
  type IncluirCompetenciaEntrada,
  type IncluirPdiEntrada,
  type LigarCompetenciaCargoEntrada,
  type ListaCompetencias,
  type NotasAvaliacaoEntrada,
  type PdiResposta,
  type ResultadoAvaliacaoDesempenho,
  type SituacaoCicloEntrada,
  type SituacaoCompetenciaEntrada,
  type SituacaoPdiEntrada,
} from '@sgh/contratos';
import { alertasExperiencia, type MarcoExperiencia } from '@sgh/dominio-pessoas';
import type {
  AvaliacaoLida,
  CicloAvaliacaoLido,
  CorrecaoPesLida,
  PdiLido,
  VinculoPessoasContado,
} from '@sgh/legado';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import { vinculosDoLogin } from '../autoatendimento/servico-meu-espaco.js';
import type { PortaCargos } from '../cargos/porta-cargos.js';
import type { PortaPessoas } from '../porta.js';
import type { PortaPonto } from '../ponto/porta-ponto.js';
import { CHAVE_PESSOAS_COLABORADOR } from '../servico.js';
import type { PortaTreinamento } from '../treinamento/porta-treinamento.js';
import type { AlvoDependenciaAvaliacao, GravadorAvaliacao, PortaAvaliacao } from './porta-avaliacao.js';

const E = EVENTOS_AUDITAVEIS;
const CHAVE = CHAVE_PESSOAS_COLABORADOR;

export const PERMISSOES_AVALIACAO = {
  ler: 'pessoas.avaliacao.ler',
  gerir: 'pessoas.avaliacao.gerir',
  ciencia: 'pessoas.avaliacao.ciencia',
} as const;

/** Janela do alerta de experiência: CLT admitido há até 90 dias (e alguns dias de folga para o vencido). */
const JANELA_EXPERIENCIA_DIAS = 100;

const recusaRegra = (codigo: string, mensagem: string, campos?: readonly string[]) =>
  new ErroProblema('recusa-de-negocio', 409, 'Operação recusada', mensagem, {
    codigo,
    ...(campos ? { campos: [...campos] } : {}),
  });

const naoEncontrado = (o: string) =>
  new ErroProblema('nao-encontrado', 404, `${o} não encontrado(a)`, `${o} não existe neste estabelecimento.`);

const conflitoVersao = () =>
  new ErroProblema(
    'conflito-de-versao',
    409,
    'Registro alterado',
    'Outra pessoa alterou este registro depois que você abriu. Abra de novo para ver a versão atual.',
    { codigo: 'desatualizado' },
  );

/** 409 da exclusão com vínculo: a contagem por grupo e o caminho (inativar ou cancelar). */
function recusaComVinculos(
  alvo: AlvoDependenciaAvaliacao,
  nome: string,
  caminho: string,
  v: readonly VinculoPessoasContado[],
): ErroProblema {
  const porGrupo = new Map<string, number>();
  for (const x of v) porGrupo.set(x.grupo, (porGrupo.get(x.grupo) ?? 0) + x.quantidade);
  const linhas = [...porGrupo].map(([g, q]) => `${g}: ${q}`);
  const total = [...porGrupo.values()].reduce((a, b) => a + b, 0);
  return new ErroProblema(
    'recusa-de-negocio',
    409,
    'Operação recusada',
    `${nome} tem ${total} registro(s) ligado(s) e não pode ser excluído(a) (${linhas.join('; ')}). ${caminho}`,
    { codigo: `${alvo}-com-vinculos`, bloqueios: linhas },
  );
}

const correcaoResposta = (c: CorrecaoPesLida): CorrecaoResposta => ({
  id: c.id,
  operacao: c.operacao,
  registro: c.registro,
  antes: c.antes,
  depois: c.depois,
  motivo: c.motivo,
  por: c.por,
  em: c.em,
});

const avaliacaoResposta = (a: AvaliacaoLida): AvaliacaoResposta => ({ ...a });
const pdiResposta = (p: PdiLido): PdiResposta => ({ ...p });

/** Só os campos que mudaram, antes e depois (o histórico guarda o valor anterior). */
function diferenca<T extends Record<string, unknown>>(
  antes: T,
  depois: T,
): { antes: Partial<T>; depois: Partial<T> } {
  const campos = (Object.keys(antes) as (keyof T)[]).filter((k) => antes[k] !== depois[k]);
  return {
    antes: Object.fromEntries(campos.map((k) => [k, antes[k]])) as Partial<T>,
    depois: Object.fromEntries(campos.map((k) => [k, depois[k]])) as Partial<T>,
  };
}

export class ServicoAvaliacao {
  readonly apoio: ApoioGravacao<GravadorAvaliacao>;

  constructor(
    readonly porta: PortaAvaliacao,
    readonly pessoas: PortaPessoas,
    readonly cargos: PortaCargos,
    readonly treinamento: PortaTreinamento,
    readonly ponto: PortaPonto,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    this.apoio = new ApoioGravacao<GravadorAvaliacao>(
      { chave: CHAVE, nome: 'a avaliação de desempenho', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  // ── Apoio e leituras ─────────────────────────────────────────────────────────────────────────────────────────

  async apoioTela(s: SessaoCadastro): Promise<ApoioAvaliacao> {
    const [hoje, cargos, cursos, l] = await Promise.all([
      this.porta.hoje(s.porta),
      this.cargos.cargos(s.porta),
      this.treinamento.cursos(s.porta),
      this.apoio.liberacao(s),
    ]);
    const pode = s.pode(PERMISSOES_AVALIACAO.gerir);
    return {
      hoje,
      cargos: cargos.filter((c) => c.ativo).map((c) => ({ codigo: c.id, rotulo: c.nome })),
      cursos: cursos.filter((c) => c.ativo).map((c) => ({ codigo: c.id, rotulo: c.titulo })),
      gravacao: { ligada: l.ligada, motivo: l.motivo },
      acoes: {
        gerir: pode && l.ligada,
        motivo: !pode
          ? 'Seu perfil não permite manter a avaliação de desempenho.'
          : l.ligada
            ? null
            : l.motivo,
      },
    };
  }

  async competencias(s: SessaoCadastro): Promise<ListaCompetencias> {
    const [ks, ligacoes] = await Promise.all([
      this.porta.competencias(s.porta),
      this.porta.competenciasDoCargo(s.porta, null),
    ]);
    const correcoes = await this.porta.correcoes(
      s.porta,
      'SGH_PES_COMPETENCIA',
      ks.map((k) => k.id),
    );
    return {
      competencias: ks.map((k) => ({
        ...k,
        cargos: ligacoes.filter((l) => l.competencia === k.id).map((l) => l.cargo),
      })),
      correcoes: correcoes.sort((a, b) => b.id - a.id).map(correcaoResposta),
    };
  }

  async competenciasDoCargo(s: SessaoCadastro, cargo: number): Promise<CompetenciaDoCargoResposta[]> {
    await this.cargoOu404(s, cargo);
    return (await this.porta.competenciasDoCargo(s.porta, cargo)).map((x) => ({
      cargo: x.cargo,
      competencia: x.competencia,
      nome: x.nome,
      ativa: x.ativa,
    }));
  }

  private cicloResposta(c: CicloAvaliacaoLido, avs: readonly AvaliacaoLida[]): CicloAvaliacaoResposta {
    const vigor = avs.filter((a) => a.ciclo === c.id && !a.substituida);
    const n = (st: AvaliacaoLida['situacao']) => vigor.filter((a) => a.situacao === st).length;
    return {
      ...c,
      avaliacoes: { rascunho: n('rascunho'), finalizada: n('finalizada'), ciente: n('ciente') },
    };
  }

  async ciclos(s: SessaoCadastro): Promise<CicloAvaliacaoResposta[]> {
    const cs = await this.porta.ciclos(s.porta);
    const avs = await Promise.all(cs.map((c) => this.porta.avaliacoes(s.porta, { ciclo: c.id })));
    return cs.map((c, i) => this.cicloResposta(c, avs[i] ?? []));
  }

  async fichaCiclo(s: SessaoCadastro, id: number): Promise<FichaCicloAvaliacao> {
    const c = await this.cicloOu404(s, id);
    const [avs, corr] = await Promise.all([
      this.porta.avaliacoes(s.porta, { ciclo: c.id }),
      this.porta.correcoes(s.porta, 'SGH_PES_AVAL_CICLO', [c.id]),
    ]);
    return {
      ciclo: this.cicloResposta(c, avs),
      avaliacoes: avs.map(avaliacaoResposta),
      correcoes: corr.sort((a, b) => b.id - a.id).map(correcaoResposta),
    };
  }

  /** A ficha da avaliação: as notas, a cadeia de versões e o que a sessão pode fazer. */
  async ficha(s: SessaoCadastro, id: number, proprio = false): Promise<FichaAvaliacao> {
    const a = await this.avaliacaoOu404(s, id);
    const meus = await this.vinculosProprios(s);
    if (proprio && !meus.has(a.vinculo)) throw naoEncontrado('A avaliação');
    const [ciclo, todas] = await Promise.all([
      this.cicloOu404(s, a.ciclo),
      this.porta.avaliacoes(s.porta, { vinculo: a.vinculo }),
    ]);
    // A cadeia: da versão pedida até a original e até a mais nova.
    const porId = new Map(todas.map((x) => [x.id, x]));
    const cadeia = new Set<number>([a.id]);
    for (let x = a.anterior; x !== null && porId.has(x); x = porId.get(x)?.anterior ?? null) cadeia.add(x);
    for (let mudou = true; mudou;) {
      mudou = false;
      for (const x of todas)
        if (x.anterior !== null && cadeia.has(x.anterior) && !cadeia.has(x.id)) {
          cadeia.add(x.id);
          mudou = true;
        }
    }
    const versoes = todas.filter((x) => cadeia.has(x.id)).sort((x, y) => y.numero - x.numero);
    const notas = await Promise.all(versoes.map((x) => this.porta.notas(s.porta, x.id)));
    const gerir = !proprio && s.pode(PERMISSOES_AVALIACAO.gerir);
    const emVigor = !a.substituida;
    return {
      avaliacao: avaliacaoResposta(a),
      ciclo: this.cicloResposta(ciclo, todas),
      notas: notas[versoes.findIndex((x) => x.id === a.id)] ?? [],
      versoes: versoes.map((x, i) => ({ avaliacao: avaliacaoResposta(x), notas: notas[i] ?? [] })),
      acoes: {
        lancar: gerir && a.situacao === 'rascunho',
        finalizar: gerir && a.situacao === 'rascunho',
        excluir: gerir && a.situacao === 'rascunho',
        corrigir: gerir && emVigor && a.situacao !== 'rascunho',
        cienciaPropria: emVigor && a.situacao === 'finalizada' && meus.has(a.vinculo),
        cienciaRegistrada: gerir && emVigor && a.situacao === 'finalizada',
      },
    };
  }

  async doColaborador(s: SessaoCadastro, vinculo: number): Promise<AvaliacoesDoColaborador> {
    await this.vinculoOu404(s, vinculo);
    const [avs, pdi] = await Promise.all([
      this.porta.avaliacoes(s.porta, { vinculo }),
      this.porta.pdiDoColaborador(s.porta, vinculo),
    ]);
    const corr = await this.porta.correcoes(
      s.porta,
      'SGH_PES_PDI',
      pdi.map((p) => p.id),
    );
    return {
      avaliacoes: avs.map(avaliacaoResposta),
      pdi: pdi.map(pdiResposta),
      correcoes: corr.sort((a, b) => b.id - a.id).map(correcaoResposta),
    };
  }

  /** As avaliações (finalizadas ou com ciência) dos vínculos do próprio login. */
  async minhas(s: SessaoCadastro): Promise<AvaliacaoResposta[]> {
    const meus = [...(await this.vinculosProprios(s))];
    const avs = (await Promise.all(meus.map((v) => this.porta.avaliacoes(s.porta, { vinculo: v })))).flat();
    return avs.filter((a) => a.situacao !== 'rascunho').map(avaliacaoResposta);
  }

  /** CLT admitido há até 90 dias: os marcos de 45 e 90 dias sem a avaliação daquele marco (num ciclo de experiência). */
  async alertasExperiencia(s: SessaoCadastro): Promise<AlertaExperienciaResposta[]> {
    const hoje = await this.porta.hoje(s.porta);
    const d = new Date(`${hoje}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - JANELA_EXPERIENCIA_DIAS);
    const [vinculos, ciclos] = await Promise.all([
      this.porta.vinculosEmExperiencia(s.porta, d.toISOString().slice(0, 10)),
      this.porta.ciclos(s.porta),
    ]);
    const avs = (
      await Promise.all(
        ciclos
          .filter((c) => c.tipo === 'experiencia' && c.situacao !== 'cancelado')
          .map((c) => this.porta.avaliacoes(s.porta, { ciclo: c.id })),
      )
    ).flat();
    const r: AlertaExperienciaResposta[] = [];
    for (const v of vinculos) {
      const avaliados = avs
        .filter((a) => a.vinculo === v.vinculo && a.marco !== null)
        .map((a) => a.marco as MarcoExperiencia);
      for (const x of alertasExperiencia(v.admissao, hoje, avaliados))
        r.push({
          vinculo: v.vinculo,
          nome: v.nome,
          matricula: v.matricula,
          setor: v.setor,
          admissao: v.admissao,
          ...x,
        });
    }
    return r.sort((a, b) => a.dias - b.dias || a.nome.localeCompare(b.nome));
  }

  // ── Conferências ─────────────────────────────────────────────────────────────────────────────────────────────

  private async vinculosProprios(s: SessaoCadastro): Promise<Set<number>> {
    return new Set((await vinculosDoLogin(this.pessoas, this.ponto, s)).map((v) => v.id));
  }
  private async cargoOu404(s: SessaoCadastro, id: number) {
    const c = await this.cargos.cargo(s.porta, id);
    if (!c) throw naoEncontrado('O cargo');
    return c;
  }
  private async competenciaOu404(s: SessaoCadastro, id: number) {
    const c = await this.porta.competencia(s.porta, id);
    if (!c) throw naoEncontrado('A competência');
    return c;
  }
  private async cicloOu404(s: SessaoCadastro, id: number) {
    const c = await this.porta.ciclo(s.porta, id);
    if (!c) throw naoEncontrado('O ciclo');
    return c;
  }
  private async avaliacaoOu404(s: SessaoCadastro, id: number) {
    const a = await this.porta.avaliacao(s.porta, id);
    if (!a) throw naoEncontrado('A avaliação');
    return a;
  }
  private async pdiOu404(s: SessaoCadastro, id: number) {
    const p = await this.porta.pdi(s.porta, id);
    if (!p) throw naoEncontrado('A ação do PDI');
    return p;
  }
  private async vinculoOu404(s: SessaoCadastro, id: number) {
    const v = await this.pessoas.vinculo(s.porta, id);
    if (!v || v.hospital !== s.hospital) throw naoEncontrado('O colaborador');
    return v;
  }
  private correcao(
    g: GravadorAvaliacao,
    s: SessaoCadastro,
    tabela: string,
    registro: number,
    operacao: string,
    d: { antes: Record<string, unknown>; depois: Record<string, unknown> },
    motivo: string,
  ) {
    return g.registrarCorrecao({ tabela, registro, operacao, ...d, motivo, por: s.login });
  }

  // ── Competência ──────────────────────────────────────────────────────────────────────────────────────────────

  async incluirCompetencia(
    s: SessaoCadastro,
    e: IncluirCompetenciaEntrada,
  ): Promise<ResultadoAvaliacaoDesempenho> {
    const id = await this.apoio.sgh(
      s,
      E.pessoasCompetenciaGravada.codigo,
      CHAVE,
      (r: number) => ({ tabela: 'SGH_PES_COMPETENCIA', id: String(r) }),
      (g) => g.incluirCompetencia({ ...e, por: s.login }),
    );
    return { id, mensagem: 'Competência incluída.' };
  }

  async alterarCompetencia(
    s: SessaoCadastro,
    e: AlterarCompetenciaEntrada,
  ): Promise<ResultadoAvaliacaoDesempenho> {
    const k = await this.competenciaOu404(s, e.competencia);
    if (k.versao !== e.versao) throw conflitoVersao();
    const d = diferenca({ nome: k.nome, descricao: k.descricao }, { nome: e.nome, descricao: e.descricao });
    if (Object.keys(d.antes).length === 0)
      throw recusaRegra('nada-a-alterar', 'Os dados informados são iguais aos do cadastro.', ['nome']);
    await this.apoio.sgh(
      s,
      E.pessoasCompetenciaGravada.codigo,
      CHAVE,
      { tabela: 'SGH_PES_COMPETENCIA', id: String(k.id), chave: 'alteracao' },
      async (g) => {
        await g.alterarCompetencia({
          id: k.id,
          versao: e.versao,
          nome: e.nome,
          descricao: e.descricao,
          por: s.login,
        });
        await this.correcao(g, s, 'SGH_PES_COMPETENCIA', k.id, 'competencia.alterada', d, e.motivo);
      },
    );
    return { id: k.id, mensagem: 'Competência alterada. O valor anterior ficou no histórico.' };
  }

  async situacaoCompetencia(
    s: SessaoCadastro,
    e: SituacaoCompetenciaEntrada,
  ): Promise<ResultadoAvaliacaoDesempenho> {
    const k = await this.competenciaOu404(s, e.competencia);
    if (k.versao !== e.versao) throw conflitoVersao();
    if (k.ativo === e.ativo)
      throw recusaRegra(
        e.ativo ? 'ja-ativo' : 'ja-inativo',
        `A competência já está ${e.ativo ? 'ativa' : 'inativa'}.`,
      );
    await this.apoio.sgh(
      s,
      E.pessoasCompetenciaGravada.codigo,
      CHAVE,
      { tabela: 'SGH_PES_COMPETENCIA', id: String(k.id), chave: e.ativo ? 'reativacao' : 'inativacao' },
      async (g) => {
        await g.situacaoCompetencia({
          id: k.id,
          versao: e.versao,
          ativo: e.ativo,
          motivo: e.motivo,
          por: s.login,
        });
        await this.correcao(
          g,
          s,
          'SGH_PES_COMPETENCIA',
          k.id,
          e.ativo ? 'competencia.reativada' : 'competencia.inativada',
          { antes: { ativo: k.ativo }, depois: { ativo: e.ativo } },
          e.motivo,
        );
      },
    );
    return { id: k.id, mensagem: `A competência ficou ${e.ativo ? 'ativa' : 'inativa'}.` };
  }

  async excluirCompetencia(
    s: SessaoCadastro,
    e: ExcluirCompetenciaEntrada,
  ): Promise<ResultadoAvaliacaoDesempenho> {
    await this.apoio.exigirLiberacao(s);
    const k = await this.competenciaOu404(s, e.competencia);
    if (k.versao !== e.versao) throw conflitoVersao();
    const v = await this.porta.dependencias(s.porta, 'competencia', k.id);
    if (v.length > 0)
      throw recusaComVinculos(
        'competencia',
        'A competência',
        'Uma competência em uso não se exclui: inative-a com o motivo (o histórico das avaliações fica).',
        v,
      );
    await this.apoio.sgh(
      s,
      E.pessoasCompetenciaGravada.codigo,
      CHAVE,
      { tabela: 'SGH_PES_COMPETENCIA', id: String(k.id), chave: 'exclusao' },
      (g) => g.excluirCompetencia({ id: k.id, versao: e.versao, motivo: e.motivo, por: s.login }),
    );
    return { id: k.id, mensagem: 'Competência excluída. O retrato ficou guardado.' };
  }

  async ligarCompetenciaCargo(
    s: SessaoCadastro,
    e: LigarCompetenciaCargoEntrada,
  ): Promise<ResultadoAvaliacaoDesempenho> {
    const c = await this.cargoOu404(s, e.cargo);
    if (!c.ativo)
      throw recusaRegra('cargo-inativo', 'O cargo está inativo: reative o cargo antes.', ['cargo']);
    const k = await this.competenciaOu404(s, e.competencia);
    if (!k.ativo)
      throw recusaRegra(
        'competencia-inativa',
        'A competência está inativa. Reative antes de ligar ao cargo.',
        ['competencia'],
      );
    const id = await this.apoio.sgh(
      s,
      E.pessoasCompetenciaGravada.codigo,
      CHAVE,
      (r: number) => ({ tabela: 'SGH_PES_CARGO_COMPETENCIA', id: String(r) }),
      (g) => g.ligarCompetenciaCargo({ cargo: c.id, competencia: k.id, por: s.login }),
    );
    return { id, mensagem: 'Competência ligada ao cargo.' };
  }

  async desligarCompetenciaCargo(
    s: SessaoCadastro,
    e: DesligarCompetenciaCargoEntrada,
  ): Promise<ResultadoAvaliacaoDesempenho> {
    await this.cargoOu404(s, e.cargo);
    const ligadas = await this.porta.competenciasDoCargo(s.porta, e.cargo);
    const l = ligadas.find((x) => x.competencia === e.competencia);
    if (!l) throw naoEncontrado('A competência do cargo');
    await this.apoio.sgh(
      s,
      E.pessoasCompetenciaGravada.codigo,
      CHAVE,
      { tabela: 'SGH_PES_CARGO_COMPETENCIA', id: String(l.id), chave: 'exclusao' },
      (g) => g.desligarCompetenciaCargo({ ...e, por: s.login }),
    );
    return {
      id: l.id,
      mensagem: 'Competência retirada do cargo. As avaliações já abertas guardam as notas dela.',
    };
  }

  // ── Ciclo ────────────────────────────────────────────────────────────────────────────────────────────────────

  async incluirCiclo(s: SessaoCadastro, e: IncluirCicloEntrada): Promise<ResultadoAvaliacaoDesempenho> {
    const id = await this.apoio.sgh(
      s,
      E.pessoasCicloAvaliacaoGravado.codigo,
      CHAVE,
      (r: number) => ({ tabela: 'SGH_PES_AVAL_CICLO', id: String(r) }),
      (g) => g.incluirCiclo({ ...e, por: s.login }),
    );
    return { id, mensagem: 'Ciclo de avaliação incluído.' };
  }

  async alterarCiclo(s: SessaoCadastro, e: AlterarCicloEntrada): Promise<ResultadoAvaliacaoDesempenho> {
    const c = await this.cicloOu404(s, e.ciclo);
    if (c.versao !== e.versao) throw conflitoVersao();
    if (c.situacao !== 'aberto')
      throw recusaRegra('ciclo-fechado', 'Só o ciclo aberto se altera. Reabra o ciclo com o motivo antes.');
    const dados = {
      nome: e.nome,
      tipo: e.tipo,
      inicio: e.inicio,
      fim: e.fim,
      prazo: e.prazo,
      notaMax: e.notaMax,
    };
    const d = diferenca(
      { nome: c.nome, tipo: c.tipo, inicio: c.inicio, fim: c.fim, prazo: c.prazo, notaMax: c.notaMax },
      dados,
    );
    if (Object.keys(d.antes).length === 0)
      throw recusaRegra('nada-a-alterar', 'Os dados informados são iguais aos do ciclo.', ['nome']);
    if ('tipo' in d.antes) {
      const avs = await this.porta.avaliacoes(s.porta, { ciclo: c.id });
      if (avs.length > 0)
        throw recusaRegra(
          'tipo-com-avaliacoes',
          `O ciclo já tem ${avs.length} avaliação(ões): o tipo não muda. Abra outro ciclo.`,
          ['tipo'],
        );
    }
    await this.apoio.sgh(
      s,
      E.pessoasCicloAvaliacaoGravado.codigo,
      CHAVE,
      { tabela: 'SGH_PES_AVAL_CICLO', id: String(c.id), chave: 'alteracao' },
      async (g) => {
        await g.alterarCiclo({ ...dados, id: c.id, versao: e.versao, por: s.login });
        await this.correcao(g, s, 'SGH_PES_AVAL_CICLO', c.id, 'ciclo.alterado', d, e.motivo);
      },
    );
    return { id: c.id, mensagem: 'Ciclo alterado. O valor anterior ficou no histórico.' };
  }

  async situacaoCiclo(s: SessaoCadastro, e: SituacaoCicloEntrada): Promise<ResultadoAvaliacaoDesempenho> {
    const c = await this.cicloOu404(s, e.ciclo);
    if (c.versao !== e.versao) throw conflitoVersao();
    if (c.situacao === e.situacao)
      throw recusaRegra('mesma-situacao', `O ciclo já está ${e.situacao}.`, ['situacao']);
    await this.apoio.sgh(
      s,
      E.pessoasCicloAvaliacaoGravado.codigo,
      CHAVE,
      { tabela: 'SGH_PES_AVAL_CICLO', id: String(c.id), chave: e.situacao },
      async (g) => {
        await g.situacaoCiclo({
          id: c.id,
          versao: e.versao,
          situacao: e.situacao,
          motivo: e.motivo,
          por: s.login,
        });
        await this.correcao(
          g,
          s,
          'SGH_PES_AVAL_CICLO',
          c.id,
          `ciclo.${e.situacao}`,
          { antes: { situacao: c.situacao }, depois: { situacao: e.situacao } },
          e.motivo,
        );
      },
    );
    const frase = { aberto: 'reaberto', encerrado: 'encerrado', cancelado: 'cancelado' }[e.situacao];
    return { id: c.id, mensagem: `Ciclo ${frase}.` };
  }

  async excluirCiclo(s: SessaoCadastro, e: ExcluirCicloEntrada): Promise<ResultadoAvaliacaoDesempenho> {
    await this.apoio.exigirLiberacao(s);
    const c = await this.cicloOu404(s, e.ciclo);
    if (c.versao !== e.versao) throw conflitoVersao();
    const v = await this.porta.dependencias(s.porta, 'ciclo-avaliacao', c.id);
    if (v.length > 0)
      throw recusaComVinculos(
        'ciclo-avaliacao',
        'O ciclo',
        'Um ciclo com avaliações não se exclui: encerre ou cancele o ciclo com o motivo.',
        v,
      );
    await this.apoio.sgh(
      s,
      E.pessoasCicloAvaliacaoGravado.codigo,
      CHAVE,
      { tabela: 'SGH_PES_AVAL_CICLO', id: String(c.id), chave: 'exclusao' },
      (g) => g.excluirCiclo({ id: c.id, versao: e.versao, motivo: e.motivo, por: s.login }),
    );
    return { id: c.id, mensagem: 'Ciclo excluído. O retrato ficou guardado.' };
  }

  // ── Avaliação ────────────────────────────────────────────────────────────────────────────────────────────────

  async abrir(s: SessaoCadastro, e: AbrirAvaliacaoEntrada): Promise<ResultadoAvaliacaoDesempenho> {
    const c = await this.cicloOu404(s, e.ciclo);
    if (c.situacao !== 'aberto')
      throw recusaRegra('ciclo-fechado', 'O ciclo não está aberto: não recebe avaliação nova.', ['ciclo']);
    if (c.tipo === 'experiencia' && e.marco === null)
      throw recusaRegra('marco-obrigatorio', 'No ciclo de experiência, informe o marco (45 ou 90 dias).', [
        'marco',
      ]);
    if (c.tipo === 'periodico' && e.marco !== null)
      throw recusaRegra('marco-so-experiencia', 'O marco de 45 ou 90 dias é só do ciclo de experiência.', [
        'marco',
      ]);
    const v = await this.vinculoOu404(s, e.vinculo);
    if (v.desligamento !== null)
      throw recusaRegra('colaborador-desligado', 'O colaborador está desligado: não recebe avaliação nova.', [
        'vinculo',
      ]);
    const doCiclo = await this.porta.avaliacoes(s.porta, { ciclo: c.id });
    if (doCiclo.some((a) => a.vinculo === v.id && a.marco === e.marco && !a.substituida))
      throw recusaRegra(
        'avaliacao-em-vigor',
        'O colaborador já tem avaliação em vigor neste ciclo (e marco). Abra a existente ou corrija-a.',
        ['vinculo'],
      );
    const cargo = await this.porta.cargoDoVinculo(s.porta, v.id);
    if (cargo === null)
      throw recusaRegra(
        'colaborador-sem-cargo',
        'O colaborador não está ligado a um cargo do cadastro de cargos. Ligue o cargo antes de avaliar.',
        ['vinculo'],
      );
    const competencias = (await this.porta.competenciasDoCargo(s.porta, cargo))
      .filter((x) => x.ativa)
      .map((x) => x.competencia);
    if (competencias.length === 0)
      throw recusaRegra(
        'avaliacao-sem-competencias',
        'O cargo do colaborador não tem competências ativas. Ligue as competências ao cargo antes de avaliar.',
        ['vinculo'],
      );
    const id = await this.apoio.sgh(
      s,
      E.pessoasAvaliacaoGravada.codigo,
      CHAVE,
      (r: number) => ({ tabela: 'SGH_PES_AVALIACAO', id: String(r) }),
      (g) =>
        g.incluirAvaliacao({
          ciclo: c.id,
          vinculo: v.id,
          cargo,
          marco: e.marco,
          avaliador: (e.avaliador ?? s.login).toUpperCase(),
          competencias,
          por: s.login,
        }),
    );
    return { id, mensagem: 'Avaliação aberta em rascunho.' };
  }

  private async rascunho(s: SessaoCadastro, id: number, versao: number) {
    const a = await this.avaliacaoOu404(s, id);
    if (a.versao !== versao) throw conflitoVersao();
    if (a.situacao !== 'rascunho')
      throw recusaRegra(
        'avaliacao-finalizada',
        'A avaliação finalizada não se altera: corrija-a por uma versão nova com a justificativa.',
      );
    return a;
  }

  async lancarNotas(s: SessaoCadastro, e: NotasAvaliacaoEntrada): Promise<ResultadoAvaliacaoDesempenho> {
    const a = await this.rascunho(s, e.avaliacao, e.versao);
    const c = await this.cicloOu404(s, a.ciclo);
    const fora = e.notas.filter((n) => n.nota !== null && n.nota > c.notaMax);
    if (fora.length > 0)
      throw recusaRegra(
        'nota-fora-da-escala',
        `A escala do ciclo vai de 1 a ${c.notaMax}: ${fora.length} nota(s) acima disso.`,
        ['notas'],
      );
    await this.apoio.sgh(
      s,
      E.pessoasAvaliacaoGravada.codigo,
      CHAVE,
      { tabela: 'SGH_PES_AVALIACAO', id: String(a.id), chave: 'notas' },
      (g) => g.lancarNotas({ id: a.id, versao: e.versao, parecer: e.parecer, notas: e.notas, por: s.login }),
    );
    return { id: a.id, mensagem: 'Notas gravadas.' };
  }

  async finalizar(s: SessaoCadastro, e: FinalizarAvaliacaoEntrada): Promise<ResultadoAvaliacaoDesempenho> {
    const a = await this.rascunho(s, e.avaliacao, e.versao);
    await this.apoio.sgh(
      s,
      E.pessoasAvaliacaoGravada.codigo,
      CHAVE,
      { tabela: 'SGH_PES_AVALIACAO', id: String(a.id), chave: 'finalizacao' },
      (g) => g.finalizarAvaliacao({ id: a.id, versao: e.versao, por: s.login }),
    );
    return { id: a.id, mensagem: 'Avaliação finalizada. Falta a ciência do colaborador.' };
  }

  private async finalizadaEmVigor(s: SessaoCadastro, id: number, versao: number) {
    const a = await this.avaliacaoOu404(s, id);
    if (a.versao !== versao) throw conflitoVersao();
    if (a.substituida)
      throw recusaRegra('avaliacao-substituida', 'Esta versão foi corrigida: abra a versão em vigor.');
    if (a.situacao !== 'finalizada')
      throw recusaRegra(
        a.situacao === 'ciente' ? 'ciencia-ja-dada' : 'avaliacao-em-rascunho',
        a.situacao === 'ciente'
          ? 'A ciência desta avaliação já foi dada.'
          : 'A avaliação ainda está em rascunho: finalize antes da ciência.',
      );
    return a;
  }

  /** A ciência do próprio colaborador: só a avaliação de um vínculo do login (a de outro é 404). */
  async cienciaPropria(s: SessaoCadastro, e: CienciaPropriaEntrada): Promise<ResultadoAvaliacaoDesempenho> {
    const a = await this.avaliacaoOu404(s, e.avaliacao);
    if (!(await this.vinculosProprios(s)).has(a.vinculo)) throw naoEncontrado('A avaliação');
    await this.finalizadaEmVigor(s, e.avaliacao, e.versao);
    await this.apoio.sgh(
      s,
      E.pessoasAvaliacaoCiencia.codigo,
      CHAVE,
      { tabela: 'SGH_PES_AVALIACAO', id: String(a.id), chave: 'ciencia' },
      (g) =>
        g.ciencia({ id: a.id, versao: e.versao, modo: 'proprio', observacao: e.observacao, por: s.login }),
    );
    return { id: a.id, mensagem: 'Ciência registrada.' };
  }

  /** A ciência colhida em papel e registrada pelo RH, com a observação de como e quando. */
  async cienciaRegistrada(
    s: SessaoCadastro,
    e: CienciaRegistradaEntrada,
  ): Promise<ResultadoAvaliacaoDesempenho> {
    const a = await this.finalizadaEmVigor(s, e.avaliacao, e.versao);
    await this.apoio.sgh(
      s,
      E.pessoasAvaliacaoCiencia.codigo,
      CHAVE,
      { tabela: 'SGH_PES_AVALIACAO', id: String(a.id), chave: 'ciencia-registrada' },
      (g) =>
        g.ciencia({ id: a.id, versao: e.versao, modo: 'registrada', observacao: e.observacao, por: s.login }),
    );
    return { id: a.id, mensagem: 'Ciência registrada pelo RH.' };
  }

  /** Correção da finalizada (ou ciente) em vigor: versão nova em rascunho; a anterior fica guardada e visível. */
  async corrigir(s: SessaoCadastro, e: CorrigirAvaliacaoEntrada): Promise<ResultadoAvaliacaoDesempenho> {
    const a = await this.avaliacaoOu404(s, e.avaliacao);
    if (a.versao !== e.versao) throw conflitoVersao();
    if (a.situacao === 'rascunho')
      throw recusaRegra('avaliacao-em-rascunho', 'O rascunho se altera direto: lance as notas de novo.');
    if (a.substituida)
      throw recusaRegra('avaliacao-substituida', 'Esta versão já foi corrigida: corrija a versão em vigor.');
    const id = await this.apoio.sgh(
      s,
      E.pessoasAvaliacaoGravada.codigo,
      CHAVE,
      (r: number) => ({ tabela: 'SGH_PES_AVALIACAO', id: String(r), chave: 'correcao' }),
      (g) =>
        g.corrigirAvaliacao({
          anterior: a.id,
          versao: e.versao,
          motivo: e.motivo,
          avaliador: s.login,
          por: s.login,
        }),
    );
    return {
      id,
      mensagem: `Versão ${a.numero + 1} aberta em rascunho. A versão ${a.numero} ficou guardada.`,
    };
  }

  async excluir(s: SessaoCadastro, e: ExcluirAvaliacaoEntrada): Promise<ResultadoAvaliacaoDesempenho> {
    await this.apoio.exigirLiberacao(s);
    const a = await this.rascunho(s, e.avaliacao, e.versao);
    const v = await this.porta.dependencias(s.porta, 'avaliacao-rascunho', a.id);
    const fora = v.filter((x) => x.tabela !== 'SGH_PES_AVAL_ITEM');
    if (fora.length > 0)
      throw recusaComVinculos(
        'avaliacao-rascunho',
        'A avaliação',
        'Retire antes as ações do PDI ligadas a ela (cancele com o motivo).',
        fora,
      );
    await this.apoio.sgh(
      s,
      E.pessoasAvaliacaoGravada.codigo,
      CHAVE,
      { tabela: 'SGH_PES_AVALIACAO', id: String(a.id), chave: 'exclusao' },
      (g) => g.excluirAvaliacao({ id: a.id, versao: e.versao, motivo: e.motivo, por: s.login }),
    );
    return { id: a.id, mensagem: 'Rascunho excluído. O retrato ficou guardado.' };
  }

  // ── PDI ──────────────────────────────────────────────────────────────────────────────────────────────────────

  private async conferirPdi(
    s: SessaoCadastro,
    vinculo: number,
    x: { avaliacao: number | null; competencia: number | null; curso: number | null },
  ): Promise<void> {
    if (x.avaliacao !== null) {
      const a = await this.avaliacaoOu404(s, x.avaliacao);
      if (a.vinculo !== vinculo)
        throw recusaRegra('avaliacao-de-outro', 'A avaliação é de outro colaborador.', ['avaliacao']);
    }
    if (x.competencia !== null) {
      const k = await this.competenciaOu404(s, x.competencia);
      if (!k.ativo) throw recusaRegra('competencia-inativa', 'A competência está inativa.', ['competencia']);
    }
    if (x.curso !== null) {
      const c = await this.treinamento.curso(s.porta, x.curso);
      if (!c) throw naoEncontrado('O curso');
      if (!c.ativo) throw recusaRegra('curso-inativo', 'O curso está inativo.', ['curso']);
    }
  }

  async incluirPdi(s: SessaoCadastro, e: IncluirPdiEntrada): Promise<ResultadoAvaliacaoDesempenho> {
    const v = await this.vinculoOu404(s, e.vinculo);
    if (v.desligamento !== null)
      throw recusaRegra('colaborador-desligado', 'O colaborador está desligado.', ['vinculo']);
    await this.conferirPdi(s, v.id, e);
    const id = await this.apoio.sgh(
      s,
      E.pessoasPdiGravado.codigo,
      CHAVE,
      (r: number) => ({ tabela: 'SGH_PES_PDI', id: String(r) }),
      (g) => g.incluirPdi({ ...e, por: s.login }),
    );
    return { id, mensagem: 'Ação incluída no PDI.' };
  }

  async alterarPdi(s: SessaoCadastro, e: AlterarPdiEntrada): Promise<ResultadoAvaliacaoDesempenho> {
    const p = await this.pdiOu404(s, e.pdi);
    if (p.versao !== e.versao) throw conflitoVersao();
    if (p.situacao !== 'aberta') throw recusaRegra('pdi-fechado', 'Só a ação aberta se altera.', ['pdi']);
    const dados = {
      avaliacao: e.avaliacao,
      competencia: e.competencia,
      curso: e.curso,
      acao: e.acao,
      prazo: e.prazo,
    };
    const d = diferenca(
      { avaliacao: p.avaliacao, competencia: p.competencia, curso: p.curso, acao: p.acao, prazo: p.prazo },
      dados,
    );
    if (Object.keys(d.antes).length === 0)
      throw recusaRegra('nada-a-alterar', 'Os dados informados são iguais aos da ação.', ['acao']);
    await this.conferirPdi(s, p.vinculo, {
      avaliacao: 'avaliacao' in d.antes ? e.avaliacao : null,
      competencia: 'competencia' in d.antes ? e.competencia : null,
      curso: 'curso' in d.antes ? e.curso : null,
    });
    await this.apoio.sgh(
      s,
      E.pessoasPdiGravado.codigo,
      CHAVE,
      { tabela: 'SGH_PES_PDI', id: String(p.id), chave: 'alteracao' },
      async (g) => {
        await g.alterarPdi({ ...dados, id: p.id, versao: e.versao, por: s.login });
        await this.correcao(g, s, 'SGH_PES_PDI', p.id, 'pdi.alterado', d, e.motivo);
      },
    );
    return { id: p.id, mensagem: 'Ação do PDI alterada. O valor anterior ficou no histórico.' };
  }

  async situacaoPdi(s: SessaoCadastro, e: SituacaoPdiEntrada): Promise<ResultadoAvaliacaoDesempenho> {
    const p = await this.pdiOu404(s, e.pdi);
    if (p.versao !== e.versao) throw conflitoVersao();
    if (p.situacao !== 'aberta')
      throw recusaRegra('pdi-fechado', `A ação já está ${p.situacao}.`, ['situacao']);
    const hoje = await this.porta.hoje(s.porta);
    if (e.concluidaEm !== null && e.concluidaEm > hoje)
      throw recusaRegra('conclusao-futura', 'A conclusão não pode ser depois de hoje.', ['concluidaEm']);
    await this.apoio.sgh(
      s,
      E.pessoasPdiGravado.codigo,
      CHAVE,
      { tabela: 'SGH_PES_PDI', id: String(p.id), chave: e.situacao },
      async (g) => {
        await g.situacaoPdi({
          id: p.id,
          versao: e.versao,
          situacao: e.situacao,
          concluidaEm: e.situacao === 'concluida' ? e.concluidaEm : null,
          motivo: e.motivo,
          por: s.login,
        });
        await this.correcao(
          g,
          s,
          'SGH_PES_PDI',
          p.id,
          `pdi.${e.situacao}`,
          { antes: { situacao: p.situacao }, depois: { situacao: e.situacao } },
          e.motivo,
        );
      },
    );
    return { id: p.id, mensagem: e.situacao === 'concluida' ? 'Ação concluída.' : 'Ação cancelada.' };
  }
}
