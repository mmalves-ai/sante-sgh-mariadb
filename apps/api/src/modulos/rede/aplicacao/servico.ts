// Serviço do MPI da Rede (M57, etapa 1; ficha, seções 4 a 8; cap-07 §7.7.3): a fila de prováveis duplicados entre os
// estabelecimentos da rede, a decisão humana (mesma pessoa / outra pessoa), o desfazer, os vínculos de um cadastro,
// o ciclo de pareamento (automático e pontuado) e o relatório de divergência entre os índices com o reparo.
// O cruzamento entre os estabelecimentos é feito em memória, com as regras e a orquestração de @sgh/dominio-rede: cada
// leitura é de um banco só, e cada gravação é uma transação SGH_ por banco, na ordem do plano (regra 4; nenhuma
// transação cruza os bancos). Se um banco falhar no meio, os outros ficam gravados, o resultado diz `pendente` e o
// reparo do relatório de divergência completa (idempotente). O cadastro de paciente nunca é alterado (regra 1).
// Isolamento (regra 12): só os estabelecimentos da rede da sessão, da lista configurada; o par com um lado fora
// dela é recusado antes de qualquer leitura. Liberação (POL-3; ficha, seção 12): a chave `rede.mpi` é POR
// estabelecimento; o que tem a chave desligada (ou um pré-requisito pendente) não entra: a fila não mostra os pares com
// ele, o par e os vínculos dele respondem 403 `recurso-desligado` antes de qualquer leitura, e o ciclo, o relatório e o
// reparo não o leem nem gravam. Sessão "como" (ADR 0021): as gravações do MPI tocam o banco de dois estabelecimentos e
// o Corrigir do suporte só alcança o do estabelecimento da sessão; por isso, como na escrita que não se sabe retratar
// (falha fechada do ADR 0021), o MPI não grava numa sessão "como" (403 `como-entre-bancos`, com o motivo).
import { randomUUID } from 'node:crypto';
import {
  type AvisoRedePaciente,
  type CandidatoRede,
  type CicloPareamentoRede,
  type ConsultaFilaRede,
  type CriterioPareamentoRede,
  type DecisaoCandidatoRede,
  type DesfazerVinculoRede,
  type DivergenciaPareamentoRede,
  type DivergenciasRede,
  EVENTOS_AUDITAVEIS,
  FAIXAS_PONTUACAO_REDE,
  type FilaRede,
  type LadoCandidatoRede,
  type ResultadoGravacaoRede,
  type VinculosCadastroRede,
} from '@sgh/contratos';
import { mascararCns, mascararCpf, mascararNome } from '@sgh/dominio-cadastro';
import {
  cicloPareamentoRede,
  comparavel,
  conferirParNaRede,
  decidirPar,
  divergenciasRede,
  ErroBancosIndisponiveis,
  ErroChaveRede,
  ErroIsolamentoRede,
  estabelecimentosDaRede,
  executarPlanoRede,
  type GravadorIndiceRede,
  ladoLocalERemoto,
  ladosDaChave,
  type PlanoIndice,
  type PortaIndiceRede,
  planejarDesfazer,
  planejarOutraPessoa,
  planejarVinculo,
  repararIndiceRede,
  type VinculoIndice,
} from '@sgh/dominio-rede';
import type { CadastroRedeLido, CandidatoRedeLido, LinhaTrilha } from '@sgh/legado';
import { ErroProblema } from '../../../problema.filter.js';
import type { ContextoRede, EstabelecimentoRede, PortaRede } from '../porta.js';

/** Usuário técnico do pareamento automático (a trilha mostra que não foi uma pessoa). */
export const USUARIO_PAREAMENTO_REDE = 'SGH.REDE';
/** Lote padrão de um ciclo pedido pela tela (o worker pede lotes maiores, até 2.000). */
export const LOTE_PADRAO_CICLO_REDE = 200;

/** A sessão vista pelo serviço (o controlador monta a partir da requisição). */
export interface SessaoRede {
  readonly rede: string;
  readonly hospital: string;
  readonly login: string;
  /**
   * Os estabelecimentos com a chave `rede.mpi` ligada (o da sessão incluso; o controlador confere cada um). Ausente: sem
   * filtro (só nos testes de unidade do serviço).
   */
  readonly liberados?: ReadonlySet<string>;
  /** Sessão "como" do suporte (ADR 0021): o MPI não grava entre bancos. */
  readonly como?: boolean;
  /** Linha da trilha de uma gravação (o serviço completa o evento, o alvo e o banco). */
  trilha(evento: string, operacao: string, alvo: { chave: string | null; id?: string | null }): LinhaTrilha;
}

export interface OpcoesServicoRede {
  readonly agora?: () => Date;
  readonly novaPessoa?: () => string;
  /** Aviso de falha de um banco (o resultado sai `pendente`; só o código do estabelecimento, nunca dado). */
  readonly aviso?: (mensagem: string) => void;
}

const FAIXAS_LIMITES = FAIXAS_PONTUACAO_REDE;

function erroDeIsolamento(e: unknown): never {
  if (e instanceof ErroIsolamentoRede)
    throw new ErroProblema(
      'sem-permissao',
      403,
      'Fora da rede',
      e.codigo === 'rede-ausente'
        ? 'A consulta da Rede precisa do código da rede da sessão.'
        : 'O cadastro pertence a um estabelecimento fora da rede desta sessão.',
      { codigo: e.codigo },
    );
  if (e instanceof ErroChaveRede) throw new ErroProblema('nao-encontrado', 404, 'Par não encontrado');
  throw e;
}

function recursoDesligadoEm(nome: string): ErroProblema {
  return new ErroProblema(
    'recurso-desligado',
    403,
    'Funcionalidade desligada',
    `O MPI da Rede ainda não foi liberado em ${nome}: os cadastros desse estabelecimento ficam fora da fila e dos vínculos até a liberação (fim da migração e amostra revisada pelo gestor de cadastro). A liberação é feita pelo administrador em Funcionalidades por estabelecimento.`,
    { codigo: 'recurso-desligado' },
  );
}

const disponivel = (c: CadastroRedeLido | undefined): boolean =>
  !!c && c.ativo && (c.idUnificado === null || c.idUnificado === c.id);

export class ServicoMpiRede {
  private readonly agora: () => Date;
  private readonly novaPessoa: () => string;
  private readonly aviso: (m: string) => void;

  constructor(
    private readonly porta: PortaRede,
    opcoes: OpcoesServicoRede = {},
  ) {
    this.agora = opcoes.agora ?? (() => new Date());
    this.novaPessoa = opcoes.novaPessoa ?? (() => randomUUID());
    this.aviso = opcoes.aviso ?? (() => undefined);
  }

  // ── Isolamento e contexto ──────────────────────────────────────────────────────────────────────────

  /** Os estabelecimentos da rede da sessão (regra 12); o da sessão tem de estar entre eles. */
  estabelecimentos(s: Pick<SessaoRede, 'rede' | 'hospital'>): EstabelecimentoRede[] {
    let codigos: readonly string[];
    try {
      codigos = estabelecimentosDaRede({
        redeSessao: s.rede,
        redeConfigurada: this.porta.redeConfigurada(),
        estabelecimentos: this.porta.estabelecimentos().map((e) => e.codigo),
      });
    } catch (e) {
      erroDeIsolamento(e);
    }
    if (!codigos.includes(s.hospital))
      throw new ErroProblema(
        'sem-permissao',
        403,
        'Fora da rede',
        'O estabelecimento da sessão não está entre os estabelecimentos da rede.',
        { codigo: 'fora-da-rede' },
      );
    const nomes = new Map(this.porta.estabelecimentos().map((e) => [e.codigo, e.nome]));
    return codigos.map((codigo) => ({ codigo, nome: nomes.get(codigo) ?? codigo }));
  }

  /** Os estabelecimentos da rede com a chave `rede.mpi` ligada (o da sessão sempre; o controlador já o exigiu). */
  liberados(s: Pick<SessaoRede, 'rede' | 'hospital' | 'liberados'>): EstabelecimentoRede[] {
    return this.estabelecimentos(s).filter(
      (e) => e.codigo === s.hospital || !s.liberados || s.liberados.has(e.codigo),
    );
  }

  private exigirLiberado(s: SessaoRede, codigo: string): void {
    if (codigo === s.hospital || !s.liberados || s.liberados.has(codigo)) return;
    const nome = this.porta.estabelecimentos().find((e) => e.codigo === codigo)?.nome ?? codigo;
    throw recursoDesligadoEm(nome);
  }

  /** Sessão "como": o MPI grava em dois bancos e o Corrigir só alcança o da sessão (falha fechada; ADR 0021). */
  private exigirForaDoComo(s: SessaoRede): void {
    if (!s.como) return;
    throw new ErroProblema(
      'sem-permissao',
      403,
      'Gravação entre estabelecimentos',
      'Numa sessão de suporte, o MPI da Rede só consulta: cada decisão grava nos bancos de dois estabelecimentos, e o Corrigir do suporte só alcança o deste. A decisão fica com o gestor de cadastro, na própria conta.',
      { codigo: 'como-entre-bancos' },
    );
  }

  private ctx(s: Pick<SessaoRede, 'rede'>, hospital: string): ContextoRede {
    return { rede: s.rede, hospital };
  }

  private conferirChave(s: SessaoRede, chave: string): EstabelecimentoRede[] {
    const ests = this.estabelecimentos(s);
    try {
      ladosDaChave(chave);
      conferirParNaRede(
        chave,
        ests.map((e) => e.codigo),
      );
      ladoLocalERemoto(chave, s.hospital);
    } catch (e) {
      erroDeIsolamento(e);
    }
    for (const l of ladosDaChave(chave)) this.exigirLiberado(s, l.estabelecimento);
    return this.liberados(s);
  }

  // ── Fila ───────────────────────────────────────────────────────────────────────────────────────────

  private lado(
    c: CadastroRedeLido | undefined,
    est: string,
    id: number,
    prontuario: number,
    nomes: ReadonlyMap<string, string>,
  ): LadoCandidatoRede {
    return {
      estabelecimento: est,
      estabelecimentoNome: nomes.get(est) ?? est,
      id,
      prontuario: c?.prontuario ?? prontuario,
      nome: c?.nome ?? 'Cadastro não encontrado',
      nascimento: c?.nascimento ?? null,
      sexo: c?.sexo ?? null,
      maeMascarada: mascararNome(c?.mae ?? null),
      cpfMascarado: mascararCpf(c?.cpf ?? null),
      cnsMascarado: c?.cns ? mascararCns(c.cns) : null,
      disponivel: disponivel(c),
    };
  }

  /** Monta os itens: os cadastros locais num SELECT no banco da sessão; os remotos, um SELECT por banco remoto. */
  private async montar(
    s: SessaoRede,
    itens: readonly CandidatoRedeLido[],
    ests: readonly EstabelecimentoRede[],
  ): Promise<CandidatoRede[]> {
    const nomes = new Map(ests.map((e) => [e.codigo, e.nome]));
    const locais = new Map(
      (
        await this.porta.cadastrosPorIds(
          this.ctx(s, s.hospital),
          itens.map((i) => i.idLocal),
        )
      ).map((c) => [c.id, c]),
    );
    const porBanco = new Map<string, number[]>();
    for (const i of itens)
      porBanco.set(i.estabelecimentoRemoto, [...(porBanco.get(i.estabelecimentoRemoto) ?? []), i.idRemoto]);
    const remotos = new Map<string, CadastroRedeLido>();
    for (const [est, ids] of porBanco) {
      const lidos = await this.porta.cadastrosPorIds(this.ctx(s, est), ids).catch((e: unknown) => {
        this.aviso(`[rede] leitura do banco ${est} falhou: ${(e as Error).message}`);
        return [] as CadastroRedeLido[];
      });
      for (const c of lidos) remotos.set(`${est}:${c.id}`, c);
    }
    return itens.map((i) => ({
      chave: i.chave,
      local: this.lado(locais.get(i.idLocal), s.hospital, i.idLocal, i.prontuarioLocal, nomes),
      remoto: this.lado(
        remotos.get(`${i.estabelecimentoRemoto}:${i.idRemoto}`),
        i.estabelecimentoRemoto,
        i.idRemoto,
        i.prontuarioRemoto,
        nomes,
      ),
      pontuacao: i.pontuacao,
      criterios: i.criterios as CriterioPareamentoRede[],
      divergencias: i.divergencias as DivergenciaPareamentoRede[],
      situacao: i.situacao,
      origem: i.origem,
      decididoPor: i.decididoPor,
      decididoEm: i.decididoEm,
    }));
  }

  async fila(s: SessaoRede, q: ConsultaFilaRede): Promise<FilaRede> {
    if (q.outroEstabelecimento && !this.estabelecimentos(s).some((e) => e.codigo === q.outroEstabelecimento))
      erroDeIsolamento(new ErroIsolamentoRede('fora-da-rede', 'fora da rede'));
    if (q.outroEstabelecimento) this.exigirLiberado(s, q.outroEstabelecimento);
    const ests = this.liberados(s);
    const faixa = q.faixa ? FAIXAS_LIMITES[q.faixa] : null;
    const c = this.ctx(s, s.hospital);
    const recorte = {
      ...(q.outroEstabelecimento ? { estabelecimentoRemoto: q.outroEstabelecimento } : {}),
      // Só os pares com o outro lado num estabelecimento liberado (a chave é por estabelecimento).
      ...(s.liberados
        ? { estabelecimentosRemotos: ests.map((e) => e.codigo).filter((x) => x !== s.hospital) }
        : {}),
      ...(q.prontuario !== undefined ? { prontuarioLocal: q.prontuario } : {}),
    };
    const { itens, total } = await this.porta.fila(c, {
      situacao: q.situacao,
      ...(faixa ? { pontuacaoMinima: faixa.minimo, pontuacaoMaxima: faixa.maximo } : {}),
      ...recorte,
      pagina: q.pagina,
      porPagina: q.porPagina,
    });
    const porFaixa = await this.porta.filaPorFaixa(c, q.situacao, recorte);
    return {
      itens: await this.montar(s, itens, ests),
      total,
      pagina: q.pagina,
      porPagina: q.porPagina,
      porFaixa,
      estabelecimentos: ests.map((e) => ({ codigo: e.codigo, nome: e.nome })),
    };
  }

  /** Um par, lido ao vivo nos dois bancos (null: o banco da sessão não tem o par). */
  async candidato(s: SessaoRede, chave: string): Promise<CandidatoRede | null> {
    const ests = this.conferirChave(s, chave);
    const x = await this.porta.candidato(this.ctx(s, s.hospital), chave);
    if (!x) return null;
    const [item] = await this.montar(s, [x], ests);
    return item ?? null;
  }

  // ── Execução de um plano, banco a banco ─────────────────────────────────────────────────────────────

  /** A porta do domínio sobre a porta da API, com a rede da sessão e a trilha de cada banco. */
  private indice(s: SessaoRede): PortaIndiceRede {
    const c = (est: string) => this.ctx(s, est);
    const p = this.porta;
    return {
      marca: (est) => p.marca(c(est)),
      loteCadastros: (est, depois, n) => p.loteCadastros(c(est), depois, n),
      cadastrosAlterados: (est, desde, depois, n) => p.cadastrosAlterados(c(est), desde, depois, n),
      procurarCandidatos: (est, chaves) => p.procurarCandidatos(c(est), chaves),
      cadastrosPorIds: (est, ids) => p.cadastrosPorIds(c(est), ids),
      situacoes: (est, chaves) => p.situacoes(c(est), chaves),
      pessoasDosCadastros: (est, ids) => p.pessoasDosCadastros(c(est), ids),
      loteVinculos: (est, depois, n) => p.loteVinculos(c(est), depois, n),
      gravar: (est, fn, rot) =>
        p.gravar(c(est), (g) => fn(g as unknown as GravadorIndiceRede), {
          ...s.trilha(rot.evento, rot.operacao, { chave: rot.chave, id: rot.pessoa }),
          hospital: est,
        }),
    };
  }

  private async executar(
    s: SessaoRede,
    plano: PlanoIndice,
    evento: string,
    operacao: string,
  ): Promise<ResultadoGravacaoRede> {
    try {
      const r = await executarPlanoRede(this.indice(s), plano, { evento, operacao }, this.aviso);
      return { chave: r.chave, pessoa: r.pessoa, bancos: [...r.bancos] };
    } catch (e) {
      if (e instanceof ErroBancosIndisponiveis)
        throw new ErroProblema(
          'indisponivel',
          503,
          'Bancos indisponíveis',
          'Nenhum banco dos estabelecimentos do par respondeu: nada foi gravado. Tente de novo.',
        );
      throw e;
    }
  }

  // ── Decisão humana ─────────────────────────────────────────────────────────────────────────────────

  async decidir(s: SessaoRede, chave: string, d: DecisaoCandidatoRede): Promise<ResultadoGravacaoRede> {
    this.conferirChave(s, chave);
    this.exigirForaDoComo(s);
    const atual = await this.porta.candidato(this.ctx(s, s.hospital), chave);
    if (!atual)
      throw new ErroProblema('nao-encontrado', 404, 'Par não encontrado', 'O par não está mais na fila.');
    if (atual.situacao !== 'aberto')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Par já decidido',
        'O par já foi decidido por outra pessoa. Releia a fila.',
        { codigo: 'par-decidido' },
      );
    const em = this.agora().toISOString();
    if (d.decisao === 'outra_pessoa')
      return this.executar(
        s,
        planejarOutraPessoa(chave, s.login, em, d.justificativa),
        EVENTOS_AUDITAVEIS.redeParOutraPessoa.codigo,
        'rede.decidirOutraPessoa',
      );
    // "Mesma pessoa": o estado relido nos dois bancos (o cadastro pode ter ficado inativo ou sido unificado).
    const [x, y] = ladosDaChave(chave);
    const lidos = await Promise.all(
      [x, y].map(async (l) => {
        const [c] = await this.porta.cadastrosPorIds(this.ctx(s, l.estabelecimento), [l.id]);
        const pessoas = await this.porta.pessoasDosCadastros(this.ctx(s, l.estabelecimento), [l.id]);
        return { lado: l, c, pessoa: pessoas.get(l.id) ?? null };
      }),
    );
    const [a, b] = lidos as [(typeof lidos)[number], (typeof lidos)[number]];
    if (!a.c || !b.c || decidirPar(comparavel(a.c), comparavel(b.c)).destino === 'inelegivel')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Cadastro indisponível',
        'Um dos cadastros do par ficou inativo ou foi unificado no estabelecimento: o par não pode ser vinculado.',
        { codigo: 'cadastro-indisponivel' },
      );
    const r = planejarVinculo({
      a: {
        estabelecimento: a.lado.estabelecimento,
        id: a.c.id,
        prontuario: a.c.prontuario,
        pessoaAtual: a.pessoa,
      },
      b: {
        estabelecimento: b.lado.estabelecimento,
        id: b.c.id,
        prontuario: b.c.prontuario,
        pessoaAtual: b.pessoa,
      },
      origem: 'humano',
      por: s.login,
      em,
      justificativa: d.justificativa ?? null,
      novaPessoa: this.novaPessoa,
    });
    if (r.resultado === 'conflito')
      throw new ErroProblema(
        'recusa-de-negocio',
        409,
        'Pessoas diferentes',
        'Os dois cadastros já estão ligados a pessoas diferentes da Rede: desfaça um dos vínculos antes.',
        { codigo: 'pessoas-diferentes' },
      );
    if (r.resultado === 'ja_vinculado')
      return {
        chave,
        pessoa: r.pessoa,
        bancos: [a, b].map((l) => ({
          estabelecimento: l.lado.estabelecimento,
          situacao: 'ja_estava' as const,
        })),
      };
    return this.executar(s, r.plano, EVENTOS_AUDITAVEIS.redeVinculoCriado.codigo, 'rede.vincularCadastros');
  }

  // ── Desfazer ───────────────────────────────────────────────────────────────────────────────────────

  async desfazer(s: SessaoRede, chave: string, d: DesfazerVinculoRede): Promise<ResultadoGravacaoRede> {
    this.conferirChave(s, chave);
    this.exigirForaDoComo(s);
    const linhas: VinculoIndice[] = [];
    for (const l of ladosDaChave(chave)) {
      const v = await this.porta.vinculo(this.ctx(s, l.estabelecimento), chave).catch((e: unknown) => {
        this.aviso(`[rede] leitura do banco ${l.estabelecimento} falhou: ${(e as Error).message}`);
        return null;
      });
      if (v) linhas.push(v);
    }
    const r = planejarDesfazer({
      chave,
      linhas,
      por: s.login,
      em: this.agora().toISOString(),
      justificativa: d.justificativa,
      reabrir: d.reabrir,
    });
    if (r.resultado === 'inexistente')
      throw new ErroProblema('nao-encontrado', 404, 'Vínculo não encontrado');
    if (r.resultado !== 'plano')
      throw new ErroProblema('recusa-de-negocio', 409, 'Vínculo já desfeito', 'O vínculo já foi desfeito.', {
        codigo: 'vinculo-desfeito',
      });
    return this.executar(s, r.plano, EVENTOS_AUDITAVEIS.redeVinculoDesfeito.codigo, 'rede.desfazerVinculo');
  }

  // ── Vínculos de um cadastro ────────────────────────────────────────────────────────────────────────

  async vinculosDoCadastro(
    s: SessaoRede,
    estabelecimento: string,
    id: number,
  ): Promise<VinculosCadastroRede> {
    const ests = this.estabelecimentos(s);
    if (!ests.some((e) => e.codigo === estabelecimento))
      erroDeIsolamento(new ErroIsolamentoRede('fora-da-rede', 'fora da rede'));
    this.exigirLiberado(s, estabelecimento);
    const vs = await this.porta.vinculosDoCadastro(this.ctx(s, estabelecimento), id);
    return {
      pessoa: vs.find((v) => v.situacao === 'ativo')?.pessoa ?? null,
      vinculos: vs.map((v) => ({
        chave: v.chave,
        estabelecimento: v.estabelecimentoRemoto,
        idRemoto: v.idRemoto,
        prontuarioRemoto: v.prontuarioRemoto,
        origem: v.origem,
        situacao: v.situacao,
        criadoPor: v.criadoPor,
        criadoEm: v.criadoEm,
        desfeitoPor: v.desfeitoPor,
        desfeitoEm: v.desfeitoEm,
      })),
    };
  }

  // ── Pareamento ─────────────────────────────────────────────────────────────────────────────────────

  /** Um ciclo de pareamento (a orquestração do domínio, a mesma do worker): só contagens e a marca de cada banco. */
  async ciclo(s: SessaoRede, lote: number = LOTE_PADRAO_CICLO_REDE): Promise<CicloPareamentoRede> {
    this.exigirForaDoComo(s);
    const ests = this.liberados(s).map((e) => e.codigo);
    // Com um só estabelecimento liberado não há par entre estabelecimentos: nada é lido nem gravado.
    if (ests.length < 2)
      return {
        lidos: 0,
        automaticos: 0,
        naFila: 0,
        descartados: 0,
        duplicadosLocais: 0,
        inelegiveis: 0,
        marcas: [],
      };
    return cicloPareamentoRede(this.indice(s), ests, {
      lote,
      por: s.login,
      em: this.agora().toISOString(),
      usuarioAutomatico: USUARIO_PAREAMENTO_REDE,
      novaPessoa: this.novaPessoa,
      eventoCiclo: EVENTOS_AUDITAVEIS.redeFilaAtualizada.codigo,
      aviso: this.aviso,
    });
  }

  // ── Divergência entre os índices ──────────────────────────────────────────────────────────────────

  private semBanco(): ErroProblema {
    return new ErroProblema(
      'indisponivel',
      503,
      'Banco indisponível',
      'O banco de um estabelecimento não respondeu: a comparação dos índices não pode ser feita agora.',
      { codigo: 'banco-indisponivel' },
    );
  }

  async divergencias(s: SessaoRede): Promise<DivergenciasRede> {
    const ests = this.liberados(s).map((e) => e.codigo);
    const itens = await divergenciasRede(this.indice(s), ests).catch(() => {
      throw this.semBanco();
    });
    return {
      geradoEm: this.agora().toISOString(),
      estabelecimentos: ests,
      total: itens.length,
      itens: itens.map((d) => ({
        chave: d.chave,
        tipo: d.tipo,
        porBanco: d.porBanco.map((b) => ({ ...b })),
      })),
    };
  }

  /** "Completar o que faltou": o reparo idempotente; pessoa diferente nos dois bancos fica para revisão humana. */
  async reparar(s: SessaoRede): Promise<{ reparados: number; pendentes: number; manuais: string[] }> {
    this.exigirForaDoComo(s);
    const ests = this.liberados(s).map((e) => e.codigo);
    return repararIndiceRede(
      this.indice(s),
      ests,
      EVENTOS_AUDITAVEIS.redeIndiceReparado.codigo,
      this.aviso,
    ).catch((e: unknown) => {
      if (e instanceof ErroProblema) throw e;
      throw this.semBanco();
    });
  }

  // ── Etapa 2: o aviso no cabeçalho do paciente (ficha, seção 4: "atendimentos no outro hospital") ───────────

  /**
   * "Este paciente tem atendimentos em outro estabelecimento da rede": os vínculos ATIVOS do cadastro no banco da sessão
   * (uma leitura) e, em cada outro estabelecimento liberado, só a contagem e as datas mais recentes de atendimentos e
   * internações do prontuário de lá (uma leitura por banco; nenhum conteúdo clínico). Um banco que não responde não
   * derruba o aviso: aquele estabelecimento sai com `disponivel: false`. O acesso cruzado (DP-42) é decidido por quem
   * chama (`acessoCruzado`).
   */
  async avisoDoPaciente(
    s: SessaoRede,
    id: number,
    acessoCruzado: (estabelecimento: string) => Promise<{ pode: boolean; motivo: string | null }>,
  ): Promise<AvisoRedePaciente> {
    const ests = new Map(this.liberados(s).map((e) => [e.codigo, e.nome]));
    const vs = await this.porta.vinculosDoCadastro(this.ctx(s, s.hospital), id).catch((e: unknown) => {
      if (e instanceof ErroProblema) throw e;
      throw this.semBanco();
    });
    const vistos = new Set<string>();
    const ativos = vs.filter((v) => {
      const k = `${v.estabelecimentoRemoto}:${v.idRemoto}`;
      if (v.situacao !== 'ativo' || v.estabelecimentoRemoto === s.hospital) return false;
      if (!ests.has(v.estabelecimentoRemoto) || vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
    if (ativos.length === 0)
      return { situacao: 'sem-vinculo', estabelecimentos: [], acessoCruzado: { pode: false, motivo: null } };
    const lidos = await Promise.all(
      ativos.map(async (v) => {
        const base = {
          estabelecimento: v.estabelecimentoRemoto,
          estabelecimentoNome: ests.get(v.estabelecimentoRemoto) ?? v.estabelecimentoRemoto,
          idRemoto: v.idRemoto,
        };
        const acesso = await acessoCruzado(v.estabelecimentoRemoto);
        try {
          const a = await this.porta.atendimentos(this.ctx(s, v.estabelecimentoRemoto), v.prontuarioRemoto);
          return { item: { ...base, disponivel: true, ...a, podeAbrir: acesso.pode }, motivo: acesso.motivo };
        } catch {
          this.aviso(`rede: aviso sem resposta do banco de ${v.estabelecimentoRemoto}`);
          return {
            item: {
              ...base,
              disponivel: false,
              atendimentos: 0,
              ultimoAtendimento: null,
              internacoes: 0,
              ultimaInternacao: null,
              podeAbrir: false,
            },
            motivo: acesso.motivo,
          };
        }
      }),
    );
    const estabelecimentos = lidos.map((x) => x.item);
    const algum = estabelecimentos.some((e) => !e.disponivel || e.atendimentos + e.internacoes > 0);
    const pode = estabelecimentos.some((e) => e.podeAbrir);
    return {
      situacao: algum ? 'com-atendimentos' : 'sem-atendimentos',
      estabelecimentos,
      acessoCruzado: { pode, motivo: pode ? null : (lidos.find((x) => x.motivo)?.motivo ?? null) },
    };
  }
}
