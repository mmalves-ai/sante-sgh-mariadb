// Fim da coexistência por hospital (ficha do M43, campos 4, 7 e 8): a aba "Fim da coexistência" da tela de migração
// gradual (regras 1, 2, 3 e 7) e a revisão dos ativos sem grupo e dos logins de painel (regras 4 e 5). Só leitura: as
// ações são as do M10 (troca de grupo e bloqueio, pela tela de usuários) e do M19 (conferir o aparelho no setor), que
// gravam pelas receitas e pelas funções SGH_ com a trilha na mesma transação. Registrar o fim é do dono no registro
// versionado (docs/coexistencia/fim/<cod>.yaml) e não desliga nada (regra 8). Falha fechada: o que não se mediu é "sem
// medida", nunca verde. Nenhum dado de paciente; a lista por pessoa (logins) só na revisão, com a leitura na trilha.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  caminhoRegistroFim,
  contagemFim,
  ENSAIOS_CONTINGENCIA,
  esquemaRegistroFimCoexistencia,
  esquemaRevisaoFimCoexistencia,
  esquemaTelaFimCoexistencia,
  estadoEm,
  EVENTOS_AUDITAVEIS,
  GRUPO_PAINEIS,
  GRUPO_SEM_GRUPO,
  type ItemFim,
  recursoDesligado,
  type RegistroFimCoexistencia,
  type RevisaoFimCoexistencia,
  type SituacaoSetorCoex,
  type TelaFimCoexistencia,
} from '@sgh/contratos';
import {
  avaliarDias,
  avaliarFimCoexistencia,
  avaliarLoginsDePainel,
  type DiaSessoes,
  diasDaJanelaFim,
  ehSemGrupo,
  inicioDaJanelaFim,
  maiorData,
  medirUsuariosFim,
  loginsDePainelResolvidos,
  montarSetores,
  type OperacaoUsoReal,
  revisarSemGrupo,
  type SetorGravado,
  setoresAtrasados,
  substituicoesDosDispositivos,
} from '@sgh/dominio-config';
import {
  type DispositivoLidoLegado,
  lerCatalogoOperacoes,
  pastaResultadosDoCatalogo,
  ultimaReproducao,
} from '@sgh/legado';
import { parse } from 'yaml';
import { correlacaoDaRequisicao, estacaoDaRequisicao } from '../../../autorizacao/estacao.js';
import type { RegistradorTrilha } from '../../../autorizacao/trilha.js';
import type { SessaoCadastro } from '../../cadastro/comum.js';
import type { ContextoCoex, PortaCoexistencia } from '../porta.js';
import { gravadoOuArquivo, type RegistroGravadoCoex } from './registro.js';

type CatalogoOperacoes = ReturnType<typeof lerCatalogoOperacoes>;
const up = (s: string | null | undefined) => (s ?? '').trim().toUpperCase();

export interface DependenciasFim {
  readonly porta: PortaCoexistencia;
  readonly trilha: RegistradorTrilha;
  readonly caminhoCatalogo: string;
  /** A pasta do registro versionado do fim por hospital (docs/coexistencia/fim). */
  readonly raizFim: string;
  /** Os aparelhos do M19 (porta da recepção); sem ela, nenhuma substituição registrada (falha fechada). */
  readonly dispositivos?: ((c: ContextoCoex) => Promise<DispositivoLidoLegado[]>) | undefined;
  /** W0-09: o registro gravado pela tela que vale sobre o arquivo (null: vale o arquivo). */
  readonly registroGravado?: RegistroGravadoCoex | undefined;
}

export interface RegistroLido {
  readonly registro: RegistroFimCoexistencia;
  readonly invalido: string | null;
}

/**
 * O registro do fim do hospital (o arquivo ausente vale como vazio, com o aviso; fora do esquema também). W0-09
 * (D-RETRO-REGISTRO-F6): `gravado` é o registro gravado pela tela (SGH_CFG_COEX_REGISTRO) e vale sobre o arquivo.
 */
export function lerRegistroFim(
  raiz: string,
  hospital: string,
  gravado: Record<string, unknown> | null = null,
): RegistroLido {
  const vazio = esquemaRegistroFimCoexistencia.parse({ formato: 1, estabelecimento: hospital });
  const p = join(raiz, `${hospital}.yaml`);
  if (!gravado && !existsSync(p)) return { registro: vazio, invalido: 'registro do fim ausente' };
  try {
    const r = esquemaRegistroFimCoexistencia.safeParse(gravado ?? parse(readFileSync(p, 'utf8')));
    if (!r.success)
      return {
        registro: vazio,
        invalido: `registro fora do esquema: ${r.error.issues[0]?.message ?? 'inválido'}`,
      };
    if (r.data.estabelecimento !== hospital)
      return { registro: vazio, invalido: 'registro de outro estabelecimento' };
    return { registro: r.data, invalido: null };
  } catch {
    return { registro: vazio, invalido: 'registro ilegível' };
  }
}

const maior = maiorData;

/** Contagem por valor, na ordem do valor. */
const contar = (xs: readonly string[]): [string, number][] => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
};

export class ServicoFimCoexistencia {
  constructor(private readonly d: DependenciasFim) {}

  private catalogo(): CatalogoOperacoes {
    return lerCatalogoOperacoes(this.d.caminhoCatalogo);
  }

  /** Operações de uso real do hospital (todas as do catálogo), com o estado e o último teste de assinatura. */
  private operacoes(hospital: string): {
    ops: OperacaoUsoReal[];
    autorizadasEm: Map<string, string | null>;
    testadasEm: Map<string, string | null>;
  } {
    const pasta = pastaResultadosDoCatalogo(this.d.caminhoCatalogo);
    const autorizadasEm = new Map<string, string | null>();
    const testadasEm = new Map<string, string | null>();
    const ops = this.catalogo().operacoes.map((o) => {
      const u = ultimaReproducao(pasta, o.nome, hospital);
      const resultados = u ? Object.values(u.cenarios) : [];
      const assinatura: OperacaoUsoReal['assinatura'] =
        resultados.length === 0 ? null : resultados.every((r) => r === 'verde') ? 'verde' : 'diferenca';
      autorizadasEm.set(
        o.nome,
        maior((o.autorizacoes ?? []).filter((a) => a.estabelecimento === hospital).map((a) => a.data)),
      );
      testadasEm.set(o.nome, u?.data || null);
      return { nome: o.nome, estado: estadoEm(o, hospital), assinatura };
    });
    return { ops, autorizadasEm, testadasEm };
  }

  private async setoresMontados(c: ContextoCoex) {
    const gravados = await this.d.porta.setores(c);
    return montarSetores(
      gravados.map((g): SetorGravado => ({
        ...g,
        situacao: g.situacao as SituacaoSetorCoex,
        composicao: g.composicao as SetorGravado['composicao'],
      })),
      (k) => !!recursoDesligado(k),
    );
  }

  /** Os setores na forma do lote (pessoa no setor) para a medida do acesso. */
  private doLote(setores: Awaited<ReturnType<ServicoFimCoexistencia['setoresMontados']>>) {
    return setores.map((st) => ({
      codigo: st.codigo,
      onda: st.onda,
      situacao: st.situacao,
      papeis: st.definicao?.papeis ?? [],
      composicao: st.composicao,
    }));
  }

  /** Os ativos (critério do M37), fora os logins de painel e as contas combinadas: trilha concluída e acesso. */
  private async usuarios(
    c: ContextoCoex,
    combinadas: ReadonlySet<string>,
    setores: Awaited<ReturnType<ServicoFimCoexistencia['setoresMontados']>>,
  ) {
    const [pessoas, conclusoes, chaves] = await Promise.all([
      this.d.porta.pessoas(c),
      this.d.porta.conclusoes(c),
      this.d.porta.chaves(c),
    ]);
    return medirUsuariosFim(pessoas, conclusoes, chaves, this.doLote(setores), combinadas);
  }

  /** Os dias da janela (regra 3): retrato do dia (logins com conexão nova) e a série das conexões ao banco. */
  private async dias(c: ContextoCoex, hoje: string): Promise<DiaSessoes[]> {
    const inicio = inicioDaJanelaFim(hoje);
    const [retratos, serie] = await Promise.all([
      this.d.porta.retratos(c, inicio),
      this.d.porta.serieOutroSistema(c, inicio),
    ]);
    return diasDaJanelaFim(hoje, retratos, serie);
  }

  async painel(s: SessaoCadastro): Promise<TelaFimCoexistencia> {
    const c = s.porta;
    const relogio = await this.d.porta.relogio(c);
    const gravado = await gravadoOuArquivo(this.d.registroGravado, c, 'fim');
    const { registro, invalido } = lerRegistroFim(this.d.raizFim, c.hospital, gravado);
    const combinadas = new Set(registro.contasCombinadas.map((x) => up(x.login)));
    const { ops, autorizadasEm, testadasEm } = this.operacoes(c.hospital);
    const setores = await this.setoresMontados(c).catch(() => null);
    const [usuarios, diasLidos, competencia, s1] = await Promise.all([
      setores ? this.usuarios(c, combinadas, setores).catch(() => null) : Promise.resolve(null),
      this.dias(c, relogio.hoje).catch(() => [] as DiaSessoes[]),
      this.d.porta.competenciaFim(c).catch(() => null),
      this.d.porta.chamados(c, { severidade: 'S1', limite: 5_000 }).catch(() => null),
    ]);
    const s1Abertos = s1 ? s1.filter((x) => !['resolvido', 'cancelado'].includes(x.situacao)).length : null;
    const excecoes = new Set(registro.excecoesOperacao.map((x) => x.operacao));
    const contadas = ops.filter((o) => !excecoes.has(o.nome));
    // "Verde desde" (D-VERDE-43): derivado das próprias fontes, sem gravar nada na leitura.
    const verdeDesde: Partial<Record<ItemFim, string>> = {};
    const put = (i: ItemFim, d: string | null) => {
      if (d) verdeDesde[i] = d;
    };
    put('operacoes-liberadas', maior(contadas.map((o) => autorizadasEm.get(o.nome) ?? null)));
    put('assinaturas-verdes', maior(ops.map((o) => testadasEm.get(o.nome) ?? null)));
    put('usuarios-com-trilha', usuarios?.verdeDesde ?? null);
    put('competencia-pelo-novo', competencia?.ultimaGravacaoNovo ?? null);
    put(
      'sem-s1-aberto',
      s1 ? maior(s1.map((x) => (x.resolvidoEm ? x.resolvidoEm.toISOString().slice(0, 10) : null))) : null,
    );
    const painel = avaliarFimCoexistencia({
      estabelecimento: c.hospital,
      hoje: relogio.hoje,
      medidoEm: relogio.agora.toISOString().slice(0, 19).replace('T', ' '),
      operacoes: ops,
      usuarios: usuarios?.u ?? null,
      dias: avaliarDias(diasLidos, combinadas),
      competencia: competencia
        ? {
            competencia: competencia.competencia,
            conveniosDoHospital: competencia.conveniosComConta,
            fechadosPeloNovo: competencia.fechadosPeloNovo,
            lotes: competencia.lotes,
            lotesPeloNovo: competencia.lotesPeloNovo,
          }
        : null,
      s1Abertos,
      registro,
      verdeDesdeAnterior: verdeDesde,
    });
    const ultimoEnsaio = (t: (typeof ENSAIOS_CONTINGENCIA)[number]) =>
      registro.ensaios
        .filter((e) => e.tipo === t)
        .sort((a, b) => a.data.localeCompare(b.data))
        .at(-1) ?? null;
    const dp6 = registro.dp6;
    const fora = contadas.filter((o) => o.estado !== 'liberada');
    return esquemaTelaFimCoexistencia.parse({
      painel,
      foraPorEstado: contar(fora.map((o) => o.estado)).map(([estado, n]) => ({ estado, n })),
      foraPorModulo: contar(fora.map((o) => o.nome.split('.')[0] ?? '')).map(([modulo, n]) => ({
        modulo,
        n,
      })),
      usuariosPorPapel: (usuarios?.porPapel ?? []).map((x) => ({
        papel: x.papel,
        ativos: contagemFim(x.ativos),
        semTrilha: contagemFim(x.semTrilha),
        semAcesso: contagemFim(x.semAcesso),
      })),
      excecoes: registro.excecoesOperacao.map((x) => ({ ...x })),
      ensaios: ENSAIOS_CONTINGENCIA.map((tipo) => {
        const u = ultimoEnsaio(tipo);
        return { tipo, data: u?.data ?? null, resultado: u?.resultado ?? null };
      }),
      contasCombinadas: registro.contasCombinadas.length,
      ata: registro.ata,
      aceiteDiretoria: registro.aceiteDiretoria?.data ?? null,
      dp6: {
        decididaEm: dp6 && 'decididaEm' in dp6 ? dp6.decididaEm : null,
        previstaPara: dp6 && 'previstaPara' in dp6 ? dp6.previstaPara : null,
        decisao: dp6 && 'decisao' in dp6 ? dp6.decisao : null,
      },
      setoresAtrasados: setoresAtrasados(setores ?? [], relogio.hoje),
      registro: caminhoRegistroFim(c.hospital),
      registroInvalido: invalido,
    });
  }

  async revisao(s: SessaoCadastro): Promise<RevisaoFimCoexistencia> {
    const c = s.porta;
    const [usuarios, contagem, grupos, dispositivos, relogio] = await Promise.all([
      this.d.porta.usuariosRevisao(c),
      this.d.porta.contagemUsuariosFim(c),
      this.d.porta.gruposAtivos(c),
      this.d.dispositivos ? this.d.dispositivos(c) : Promise.resolve([] as DispositivoLidoLegado[]),
      this.d.porta.relogio(c),
    ]);
    const agora = relogio.agora.toISOString().slice(0, 19);
    const gravado = await gravadoOuArquivo(this.d.registroGravado, c, 'fim');
    const { registro } = lerRegistroFim(this.d.raizFim, c.hospital, gravado);
    const r = revisarSemGrupo(usuarios, new Map(), grupos);
    const subs = substituicoesDosDispositivos(dispositivos, agora, registro.paineis);
    const avaliados = avaliarLoginsDePainel(
      usuarios,
      subs,
      dispositivos.map((d) => ({
        id: d.id,
        hospital: d.hospital,
        tipo: d.tipo as 'totem' | 'painel' | 'paineltv',
        validoAte: d.validoAte,
        revogadoEm: d.revogadoEm,
      })),
      c.hospital,
      agora,
    );
    const nomes = new Map(dispositivos.map((d) => [d.id, d.nome]));
    // O login vazio não tem operação no Sante (nenhuma rota o endereça): a decisão do gestor de acessos fica no registro
    // do fim e aparece como exceção; sem ela, segue pendente (falha fechada).
    const excecaoVazio = registro.loginVazio
      ? { decisao: registro.loginVazio.decisao, decididaEm: registro.loginVazio.decididaEm }
      : null;
    const semGrupo = usuarios
      .filter((u) => r.pendentes.includes(u.login) && ehSemGrupo(u.grupo))
      .map((u) => {
        const loginVazio = up(u.login) === '';
        return { login: u.login, grupo: u.grupo, loginVazio, excecao: loginVazio ? excecaoVazio : null };
      });
    // A leitura da lista por pessoa vai à trilha (ficha, campo 4: lista só para o comitê e o gestor de acessos).
    await this.d.trilha.registrar({
      evento: EVENTOS_AUDITAVEIS.coexistenciaPessoasConsultadas.codigo,
      rede: s.rede,
      hospital: s.hospital,
      usuario: s.login,
      estacao: estacaoDaRequisicao(s.req).slice(0, 80),
      correlacao: correlacaoDaRequisicao(s.req, 'coex-fim-revisao').slice(0, 64),
      recurso: 'config.coexistencia.fim',
      resultado: 'sucesso',
      chaveNaturalAlvo: `revisao:${semGrupo.length}:${avaliados.length}`,
    });
    return esquemaRevisaoFimCoexistencia.parse({
      estabelecimento: c.hospital,
      contagem,
      semGrupo,
      parcelas: r.parcelas,
      gruposDestino: grupos.filter((g) => up(g) !== GRUPO_SEM_GRUPO && up(g) !== GRUPO_PAINEIS),
      paineis: avaliados.map((a) => ({
        login: a.login,
        situacao: a.situacao,
        dispositivo: a.dispositivo,
        dispositivoNome: a.dispositivo === null ? null : (nomes.get(a.dispositivo) ?? null),
        conferidoEm: a.conferidoEm,
      })),
      listaVazia: semGrupo.every((u) => u.excecao !== null),
      paineisResolvidos: loginsDePainelResolvidos(avaliados),
    });
  }
}
