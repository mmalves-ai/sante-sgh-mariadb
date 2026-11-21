// Cargos e salários (W0-06, parte 4; M1 de mercado; matriz, linha "Tabelas de domínio"): o cadastro de cargos (CBO,
// descrição, requisitos, conselho exigido), a tabela salarial por faixa e nível e o quadro de vagas aprovado por
// centro de custo, com inclusão, alteração, inativação e exclusão.
//   - cargo: a alteração leva motivo e o valor anterior (no histórico da trilha); o referenciado (colaborador, faixa ou vaga)
//     se inativa; a exclusão física só vale para o nunca usado (409 com a contagem e a oferta da inativação);
//   - faixa salarial e vaga: a alteração é versão nova a partir de uma data (a anterior acaba na véspera); a linha em
//     vigor se inativa com motivo; a exclusão física só da lançada por engano (sem versão), com o retrato.
// Melhoria: tipos de negócio próprios e nomes de tabela do modelo; a exclusão do cargo é lógica, com o retrato na trilha.
// A chave de liberação é a do cadastro de colaboradores (`pessoas.colaborador`; proibido criar chave nova). A tabela
// salarial e o quadro nascem vazios: os valores são dados do dono.
import {
  type AlterarCargoEntrada,
  type AlvoCargos,
  type ApoioCargos,
  type CargoResposta,
  type CorrecaoResposta,
  EVENTOS_AUDITAVEIS,
  type ExcluirCargosEntrada,
  type FaixaSalarialResposta,
  type FichaCargo,
  type IncluirCargoEntrada,
  type IncluirFaixaSalarialEntrada,
  type IncluirVagaEntrada,
  type ListaCargos,
  type ResultadoCargos,
  type SituacaoCargosEntrada,
  type VagaResposta,
  type VersaoFaixaSalarialEntrada,
  type VersaoVagaEntrada,
} from '@sgh/contratos';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import { ErroProblema } from '../../../problema.filter.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { CacheConfig, FonteConfiguracao } from '../../config/public-api.js';
import { ApoioGravacao } from '../../exames/public-api.js';
import type { PortaPessoas } from '../porta.js';
import { CHAVE_PESSOAS_COLABORADOR } from '../servico.js';
import type {
  AlvoDependenciaCargos,
  CargoRegistrado,
  CorrecaoRegistrada,
  DependenciaContada,
  FaixaSalarialRegistrada,
  GravadorCargos,
  OcupacaoCargo,
  PortaCargos,
  TabelaCargos,
  VagaQuadroRegistrada,
} from './porta-cargos.js';

const E = EVENTOS_AUDITAVEIS;

export const PERMISSOES_CARGOS = {
  ler: 'pessoas.cargos.ler',
  gerir: 'pessoas.cargos.gerir',
} as const;

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

const ALVOS: Readonly<
  Record<
    AlvoCargos,
    { tabela: TabelaCargos; dependencia: AlvoDependenciaCargos; nome: string; evento: string }
  >
> = {
  cargo: {
    tabela: 'cargo',
    dependencia: 'cargo',
    nome: 'O cargo',
    evento: E.pessoasCargoGravado.codigo,
  },
  faixa: {
    tabela: 'faixa_salarial',
    dependencia: 'salario-faixa',
    nome: 'A faixa salarial',
    evento: E.pessoasFaixaSalarialGravada.codigo,
  },
  vaga: {
    tabela: 'quadro_vaga',
    dependencia: 'vaga',
    nome: 'A vaga',
    evento: E.pessoasVagaGravada.codigo,
  },
};

/** 409 da exclusão com vínculo: a contagem por grupo e a oferta da inativação (a tela mostra os dois). */
function recusaComVinculos(alvo: AlvoCargos, v: readonly DependenciaContada[]): ErroProblema {
  const porGrupo = new Map<string, number>();
  for (const x of v) porGrupo.set(x.grupo, (porGrupo.get(x.grupo) ?? 0) + x.quantidade);
  const linhas = [...porGrupo].map(([g, q]) => `${g}: ${q}`);
  const total = [...porGrupo.values()].reduce((a, b) => a + b, 0);
  const caminho =
    alvo === 'cargo'
      ? 'Um cargo em uso não se exclui: inative-o com o motivo (o histórico fica e ele sai das novas admissões).'
      : 'Uma linha com versão não é lançamento por engano: inative a versão em vigor com o motivo.';
  return new ErroProblema(
    'recusa-de-negocio',
    409,
    'Operação recusada',
    `${ALVOS[alvo].nome} tem ${total} registro(s) ligado(s) e não pode ser excluído(a) (${linhas.join('; ')}). ${caminho}`,
    { codigo: `${ALVOS[alvo].dependencia}-com-vinculos`, bloqueios: linhas },
  );
}

const correcaoResposta = (c: CorrecaoRegistrada): CorrecaoResposta => ({
  id: c.id,
  operacao: c.operacao,
  registro: c.registro,
  antes: c.antes,
  depois: c.depois,
  motivo: c.motivo,
  por: c.por,
  em: c.em,
});

const vigente = (x: { ate: string | null; ativo: boolean }) => x.ate === null && x.ativo;

const faixaResposta = (f: FaixaSalarialRegistrada): FaixaSalarialResposta => ({ ...f, vigente: vigente(f) });

export class ServicoCargos {
  readonly apoio: ApoioGravacao<GravadorCargos>;

  constructor(
    readonly porta: PortaCargos,
    readonly pessoas: PortaPessoas,
    trilha: RegistradorTrilha,
    configuracao: FonteConfiguracao | null,
    cache: CacheConfig | null,
  ) {
    this.apoio = new ApoioGravacao<GravadorCargos>(
      { chave: CHAVE_PESSOAS_COLABORADOR, nome: 'o cadastro de cargos e salários', operacoes: {} },
      porta,
      trilha,
      configuracao,
      cache,
    );
  }

  // ── Leituras ─────────────────────────────────────────────────────────────────────────────────────────────────

  async apoioTela(s: SessaoCadastro): Promise<ApoioCargos> {
    const [hoje, centros, conselhos, l] = await Promise.all([
      this.porta.hoje(s.porta),
      this.pessoas.centrosDeCusto(s.porta),
      this.porta.conselhos(s.porta),
      this.apoio.liberacao(s),
    ]);
    const pode = s.pode(PERMISSOES_CARGOS.gerir);
    return {
      hoje,
      centrosCusto: centros.filter((c) => c.ativo).map((c) => ({ codigo: c.codigo, rotulo: c.nome })),
      conselhos,
      gravacao: { ligada: l.ligada, motivo: l.motivo },
      acoes: {
        gerir: pode && l.ligada,
        motivo: !pode ? 'Seu perfil não permite alterar cargos e salários.' : l.ligada ? null : l.motivo,
      },
    };
  }

  private cargoResposta(
    c: CargoRegistrado,
    cbo: Map<string, string>,
    faixas: readonly FaixaSalarialRegistrada[],
    vagas: readonly VagaQuadroRegistrada[],
    ocupacao: readonly OcupacaoCargo[],
  ): CargoResposta {
    return {
      ...c,
      cboDescricao: cbo.get(c.cbo) ?? null,
      vagasAprovadas: vagas
        .filter((v) => v.cargo === c.id && vigente(v))
        .reduce((a, v) => a + v.quantidade, 0),
      ocupadas: ocupacao.filter((o) => o.cargo === c.id).reduce((a, o) => a + o.ocupadas, 0),
      faixasVigentes: faixas.filter((f) => f.cargo === c.id && vigente(f)).length,
    };
  }

  async lista(s: SessaoCadastro): Promise<ListaCargos> {
    const [cargos, faixas, vagas, ocupacao] = await Promise.all([
      this.porta.cargos(s.porta),
      this.porta.faixas(s.porta, null),
      this.porta.vagas(s.porta, null),
      this.porta.ocupacao(s.porta),
    ]);
    const cbo = await this.porta.cboPorCodigo(
      s.porta,
      cargos.map((c) => c.cbo),
    );
    return { cargos: cargos.map((c) => this.cargoResposta(c, cbo, faixas, vagas, ocupacao)) };
  }

  async ficha(s: SessaoCadastro, id: number): Promise<FichaCargo> {
    const c = await this.cargoOu404(s, id);
    const [faixas, vagas, ocupacao, centros, cbo] = await Promise.all([
      this.porta.faixas(s.porta, c.id),
      this.porta.vagas(s.porta, c.id),
      this.porta.ocupacao(s.porta),
      this.pessoas.centrosDeCusto(s.porta),
      this.porta.cboPorCodigo(s.porta, [c.cbo]),
    ]);
    const [corrCargo, corrFaixa, corrVaga] = await Promise.all([
      this.porta.correcoes(s.porta, 'cargo', [c.id]),
      this.porta.correcoes(
        s.porta,
        'faixa_salarial',
        faixas.map((f) => f.id),
      ),
      this.porta.correcoes(
        s.porta,
        'quadro_vaga',
        vagas.map((v) => v.id),
      ),
    ]);
    const nomeCc = new Map(centros.map((x) => [x.codigo, x.nome]));
    return {
      cargo: this.cargoResposta(c, cbo, faixas, vagas, ocupacao),
      faixas: faixas.map(faixaResposta),
      vagas: vagas.map((v): VagaResposta => ({
        ...v,
        vigente: vigente(v),
        centroCustoNome: nomeCc.get(v.centroCusto) ?? `Centro de custo ${v.centroCusto}`,
        ocupadas: vigente(v)
          ? (ocupacao.find((o) => o.cargo === c.id && o.centroCusto === v.centroCusto)?.ocupadas ?? 0)
          : 0,
      })),
      correcoes: [...corrCargo, ...corrFaixa, ...corrVaga].sort((a, b) => b.id - a.id).map(correcaoResposta),
    };
  }

  async buscarCbo(s: SessaoCadastro, termo: string): Promise<{ codigo: string; rotulo: string }[]> {
    return this.porta.buscarCbo(s.porta, termo);
  }

  private async cargoOu404(s: SessaoCadastro, id: number): Promise<CargoRegistrado> {
    const c = await this.porta.cargo(s.porta, id);
    if (!c) throw naoEncontrado('O cargo');
    return c;
  }

  /** O CBO existe no cadastro oficial e o conselho é um dos cadastrados. */
  private async conferirCboConselho(s: SessaoCadastro, cbo: string, conselho: string | null): Promise<void> {
    const [m, cs] = await Promise.all([
      this.porta.cboPorCodigo(s.porta, [cbo]),
      conselho === null ? Promise.resolve([]) : this.porta.conselhos(s.porta),
    ]);
    if (!m.has(cbo))
      throw recusaRegra('cbo-inexistente', 'O CBO informado não está no cadastro oficial de ocupações.', [
        'cbo',
      ]);
    if (conselho !== null && !cs.some((c) => c.codigo === conselho))
      throw recusaRegra('conselho-inexistente', 'O conselho informado não está no cadastro de conselhos.', [
        'conselho',
      ]);
  }

  // ── Cargo ────────────────────────────────────────────────────────────────────────────────────────────────────

  async incluirCargo(s: SessaoCadastro, e: IncluirCargoEntrada): Promise<ResultadoCargos> {
    await this.apoio.exigirLiberacao(s);
    await this.conferirCboConselho(s, e.cbo, e.conselho);
    const id = await this.apoio.sgh(
      s,
      E.pessoasCargoGravado.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      (r: number) => ({ tabela: 'cargo', id: String(r) }),
      (g) => g.incluirCargo({ ...e, por: s.login }),
    );
    return { id, mensagem: 'Cargo incluído.' };
  }

  async alterarCargo(s: SessaoCadastro, e: AlterarCargoEntrada): Promise<ResultadoCargos> {
    await this.apoio.exigirLiberacao(s);
    const c = await this.cargoOu404(s, e.cargo);
    if (c.versao !== e.versao) throw conflitoVersao();
    const antes = {
      nome: c.nome,
      cbo: c.cbo,
      descricao: c.descricao,
      requisitos: c.requisitos,
      conselho: c.conselho,
    };
    const depois = {
      nome: e.nome,
      cbo: e.cbo,
      descricao: e.descricao,
      requisitos: e.requisitos,
      conselho: e.conselho,
    };
    const campos = (Object.keys(antes) as (keyof typeof antes)[]).filter((k) => antes[k] !== depois[k]);
    if (campos.length === 0)
      throw recusaRegra('nada-a-alterar', 'Os dados informados são iguais aos do cadastro.', ['nome']);
    if (campos.includes('cbo') || campos.includes('conselho'))
      await this.conferirCboConselho(s, e.cbo, campos.includes('conselho') ? e.conselho : null);
    await this.apoio.sgh(
      s,
      E.pessoasCargoGravado.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      { tabela: 'cargo', id: String(c.id), chave: 'alteracao' },
      async (g) => {
        await g.alterarCargo({ id: c.id, versao: e.versao, ...depois, por: s.login });
        await g.registrarCorrecao({
          tabela: 'cargo',
          registro: c.id,
          operacao: 'cargo.alterado',
          antes: Object.fromEntries(campos.map((k) => [k, antes[k]])),
          depois: Object.fromEntries(campos.map((k) => [k, depois[k]])),
          motivo: e.motivo,
          por: s.login,
        });
      },
    );
    return { id: c.id, mensagem: 'Cargo alterado. O valor anterior ficou no histórico.' };
  }

  // ── Situação e exclusão (cargo, faixa e vaga) ──────────────────────────────────────────────────────────────

  private async linha(
    s: SessaoCadastro,
    alvo: AlvoCargos,
    id: number,
  ): Promise<{ versao: number; ativo: boolean; ate: string | null; cargo: number }> {
    if (alvo === 'cargo') {
      const c = await this.cargoOu404(s, id);
      return { versao: c.versao, ativo: c.ativo, ate: null, cargo: c.id };
    }
    const x = alvo === 'faixa' ? await this.porta.faixa(s.porta, id) : await this.porta.vaga(s.porta, id);
    if (!x) throw naoEncontrado(ALVOS[alvo].nome);
    return { versao: x.versao, ativo: x.ativo, ate: x.ate, cargo: x.cargo };
  }

  async situacao(s: SessaoCadastro, e: SituacaoCargosEntrada): Promise<ResultadoCargos> {
    await this.apoio.exigirLiberacao(s);
    const a = ALVOS[e.alvo];
    const x = await this.linha(s, e.alvo, e.id);
    if (x.versao !== e.versao) throw conflitoVersao();
    if (x.ativo === e.ativo)
      throw recusaRegra(
        e.ativo ? 'ja-ativo' : 'ja-inativo',
        `${a.nome} já está ${e.ativo ? 'ativo(a)' : 'inativo(a)'}.`,
      );
    if (x.ate !== null)
      throw recusaRegra(
        'versao-encerrada',
        `${a.nome} tem versão posterior: inative ou reative a versão em vigor.`,
      );
    if (e.ativo && e.alvo !== 'cargo') {
      const c = await this.cargoOu404(s, x.cargo);
      if (!c.ativo) throw recusaRegra('cargo-inativo', 'O cargo está inativo: reative o cargo antes.');
    }
    await this.apoio.sgh(
      s,
      a.evento,
      CHAVE_PESSOAS_COLABORADOR,
      { tabela: a.tabela, id: String(e.id), chave: e.ativo ? 'reativacao' : 'inativacao' },
      async (g) => {
        await g.situacao({
          tabela: a.tabela,
          id: e.id,
          versao: e.versao,
          ativo: e.ativo,
          motivo: e.motivo,
          por: s.login,
        });
        await g.registrarCorrecao({
          tabela: a.tabela,
          registro: e.id,
          operacao: `${e.alvo}.${e.ativo ? 'reativado' : 'inativado'}`,
          antes: { ativo: x.ativo },
          depois: { ativo: e.ativo },
          motivo: e.motivo,
          por: s.login,
        });
      },
    );
    return { id: e.id, mensagem: `${a.nome} ficou ${e.ativo ? 'ativo(a)' : 'inativo(a)'}.` };
  }

  /** Exclusão física só do lançado por engano: com vínculo, 409 com a contagem e a oferta da inativação. */
  async excluir(s: SessaoCadastro, e: ExcluirCargosEntrada): Promise<ResultadoCargos> {
    await this.apoio.exigirLiberacao(s);
    const a = ALVOS[e.alvo];
    const x = await this.linha(s, e.alvo, e.id);
    if (x.versao !== e.versao) throw conflitoVersao();
    const v = await this.porta.dependencias(s.porta, a.dependencia, e.id);
    if (v.length > 0) throw recusaComVinculos(e.alvo, v);
    await this.apoio.sgh(
      s,
      a.evento,
      CHAVE_PESSOAS_COLABORADOR,
      { tabela: a.tabela, id: String(e.id), chave: 'exclusao' },
      (g) => g.excluir({ tabela: a.tabela, id: e.id, versao: e.versao, motivo: e.motivo, por: s.login }),
    );
    return { id: e.id, mensagem: `${a.nome} foi excluído(a). O retrato da linha ficou guardado.` };
  }

  // ── Faixa salarial ─────────────────────────────────────────────────────────────────────────────────────────

  private async cargoAtivo(s: SessaoCadastro, id: number): Promise<CargoRegistrado> {
    const c = await this.cargoOu404(s, id);
    if (!c.ativo)
      throw recusaRegra('cargo-inativo', 'O cargo está inativo: reative-o antes de incluir.', ['cargo']);
    return c;
  }

  async incluirFaixa(s: SessaoCadastro, e: IncluirFaixaSalarialEntrada): Promise<ResultadoCargos> {
    await this.apoio.exigirLiberacao(s);
    const c = await this.cargoAtivo(s, e.cargo);
    const existentes = await this.porta.faixas(s.porta, c.id);
    if (existentes.some((f) => vigente(f) && f.faixa === e.faixa && f.nivel === e.nivel))
      throw recusaRegra(
        'faixa-vigente',
        'Esta faixa e nível já estão em vigor no cargo: altere o valor (versão nova a partir de uma data).',
        ['faixa'],
      );
    const id = await this.apoio.sgh(
      s,
      E.pessoasFaixaSalarialGravada.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      (r: number) => ({ tabela: 'faixa_salarial', id: String(r) }),
      (g) => g.incluirFaixa({ ...e, cargo: c.id, por: s.login }),
    );
    return { id, mensagem: 'Faixa salarial incluída.' };
  }

  async versaoFaixa(s: SessaoCadastro, e: VersaoFaixaSalarialEntrada): Promise<ResultadoCargos> {
    await this.apoio.exigirLiberacao(s);
    const f = await this.porta.faixa(s.porta, e.faixa);
    if (!f) throw naoEncontrado('A faixa salarial');
    if (f.versao !== e.versao) throw conflitoVersao();
    if (!vigente(f))
      throw recusaRegra('versao-encerrada', 'Só a versão em vigor (ativa e sem fim) recebe versão nova.');
    if (e.desde <= f.desde)
      throw recusaRegra('desde-antes', `A versão nova vale a partir de uma data depois de ${f.desde}.`, [
        'desde',
      ]);
    if (e.valor === f.valor)
      throw recusaRegra('nada-a-alterar', 'O valor é o mesmo da versão em vigor.', ['valor']);
    await this.cargoAtivo(s, f.cargo);
    const id = await this.apoio.sgh(
      s,
      E.pessoasFaixaSalarialGravada.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      (r: number) => ({ tabela: 'faixa_salarial', id: String(r), chave: 'versao' }),
      async (g) => {
        const n = await g.versionarFaixa({
          anterior: f,
          valor: e.valor,
          desde: e.desde,
          motivo: e.motivo,
          por: s.login,
        });
        await g.registrarCorrecao({
          tabela: 'faixa_salarial',
          registro: n,
          operacao: 'faixa.versao',
          antes: { id: f.id, valor: f.valor, desde: f.desde },
          depois: { id: n, valor: e.valor, desde: e.desde },
          motivo: e.motivo,
          por: s.login,
        });
        return n;
      },
    );
    return { id, mensagem: `Valor alterado a partir de ${e.desde}. A versão anterior ficou no histórico.` };
  }

  // ── Quadro de vagas ────────────────────────────────────────────────────────────────────────────────────────

  async incluirVaga(s: SessaoCadastro, e: IncluirVagaEntrada): Promise<ResultadoCargos> {
    await this.apoio.exigirLiberacao(s);
    const c = await this.cargoAtivo(s, e.cargo);
    const [centros, existentes] = await Promise.all([
      this.pessoas.centrosDeCusto(s.porta),
      this.porta.vagas(s.porta, c.id),
    ]);
    if (!centros.some((x) => x.codigo === e.centroCusto && x.ativo))
      throw recusaRegra('centro-custo-inexistente', 'O centro de custo não existe ou está inativo.', [
        'centroCusto',
      ]);
    if (existentes.some((v) => vigente(v) && v.centroCusto === e.centroCusto))
      throw recusaRegra(
        'vaga-vigente',
        'Este cargo já tem quadro aprovado neste centro de custo: altere a quantidade (versão nova a partir de uma data).',
        ['centroCusto'],
      );
    const id = await this.apoio.sgh(
      s,
      E.pessoasVagaGravada.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      (r: number) => ({ tabela: 'quadro_vaga', id: String(r) }),
      (g) => g.incluirVaga({ ...e, cargo: c.id, por: s.login }),
    );
    return { id, mensagem: 'Vaga incluída no quadro aprovado.' };
  }

  async versaoVaga(s: SessaoCadastro, e: VersaoVagaEntrada): Promise<ResultadoCargos> {
    await this.apoio.exigirLiberacao(s);
    const v = await this.porta.vaga(s.porta, e.vaga);
    if (!v) throw naoEncontrado('A vaga');
    if (v.versao !== e.versao) throw conflitoVersao();
    if (!vigente(v))
      throw recusaRegra('versao-encerrada', 'Só a versão em vigor (ativa e sem fim) recebe versão nova.');
    if (e.desde <= v.desde)
      throw recusaRegra('desde-antes', `A versão nova vale a partir de uma data depois de ${v.desde}.`, [
        'desde',
      ]);
    if (e.quantidade === v.quantidade)
      throw recusaRegra('nada-a-alterar', 'A quantidade é a mesma da versão em vigor.', ['quantidade']);
    await this.cargoAtivo(s, v.cargo);
    const ocupadas =
      (await this.porta.ocupacao(s.porta)).find((o) => o.cargo === v.cargo && o.centroCusto === v.centroCusto)
        ?.ocupadas ?? 0;
    const id = await this.apoio.sgh(
      s,
      E.pessoasVagaGravada.codigo,
      CHAVE_PESSOAS_COLABORADOR,
      (r: number) => ({ tabela: 'quadro_vaga', id: String(r), chave: 'versao' }),
      async (g) => {
        const n = await g.versionarVaga({
          anterior: v,
          quantidade: e.quantidade,
          desde: e.desde,
          motivo: e.motivo,
          por: s.login,
        });
        await g.registrarCorrecao({
          tabela: 'quadro_vaga',
          registro: n,
          operacao: 'vaga.versao',
          antes: { id: v.id, quantidade: v.quantidade, desde: v.desde },
          depois: { id: n, quantidade: e.quantidade, desde: e.desde },
          motivo: e.motivo,
          por: s.login,
        });
        return n;
      },
    );
    const aviso =
      e.quantidade < ocupadas
        ? ` Atenção: há ${ocupadas} colaborador(es) no cargo neste centro de custo, acima do quadro novo.`
        : '';
    return { id, mensagem: `Quadro alterado a partir de ${e.desde}.${aviso}` };
  }
}
