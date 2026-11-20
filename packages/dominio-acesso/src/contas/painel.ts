// M59-F1 (ficha do M59, seção 4 "Inventário de contas e privilégios"; regras 1, 4 e 5): monta as duas respostas do
// painel "Contas do banco de dados e privilégios" a partir do que o adaptador leu. Puro e só de consulta: nenhuma
// linha aqui revoga nada (a revogação é script da TI com autorização do dono por passo, ficha, seção 12).
import {
  SITUACOES_CONTA_BANCO,
  TETO_ITENS_DESVIO,
  type AlcanceModulo,
  type ContaBancoLida,
  type DesviosPrivilegiosResposta,
  type InventarioContasBancoResposta,
  type LinhaContaBanco,
  type PrivilegioReal,
  type SituacaoContaBanco,
  type UsoContaBanco,
} from '@sgh/contratos';
import { versaoDoAlcance } from './alcance.js';
import {
  decidirDestinoConta,
  faixaContagem,
  resumirInventario,
  type ContasSgh,
  type ContextoHospital,
} from './inventario.js';
import {
  compararPrivilegios,
  contaDoModulo,
  papelDoModulo,
  planejarPrivilegios,
  PREFIXO_PAPEL_MODULO,
} from './privilegio-minimo.js';

export interface EntradaInventario {
  readonly hospital: string;
  readonly em: string;
  readonly contas: readonly ContaBancoLida[];
  /** Logins do servidor sem privilégio e fora da lista legível (só a contagem). */
  readonly loginsNaoLegiveis: number;
  /** Uso medido por conta (vazio enquanto a medição na produção não existe). */
  readonly usos: readonly UsoContaBanco[];
  readonly sgh: ContasSgh;
  readonly contexto: ContextoHospital;
  readonly avisos: readonly string[];
}

const PESO_SITUACAO: Readonly<Record<SituacaoContaBanco, number>> = {
  identificar: 0,
  'aguardando-decisao': 1,
  'medir-uso': 2,
  'aguardando-contingencia': 3,
  'aguardando-desligamento': 4,
  pronta: 5,
};

/** Resposta do inventário: uma linha por conta (o agregado das não catalogadas sem nome), ordenada pelo que pede ação. */
export function montarInventarioContas(e: EntradaInventario): InventarioContasBancoResposta {
  const usoPorConta = new Map(e.usos.map((u) => [u.conta, u]));
  const janela = e.contexto.janelaMinimaDias ?? 90;
  const linhas: LinhaContaBanco[] = e.contas.map((c) => {
    const uso = c.nome ? (usoPorConta.get(c.nome) ?? null) : null;
    const d = decidirDestinoConta(c.nome, e.sgh, uso, e.contexto);
    return {
      nome: c.nome,
      tipo: c.tipo,
      quantidade: c.nome === null ? faixaContagem(c.quantidade) : c.quantidade,
      existeLogin: c.existeLogin,
      ativa: c.ativa,
      classe: d.classe,
      destino: d.destino,
      situacao: d.situacao,
      motivo: d.motivo,
      leitura: c.privilegios.S,
      escrita: c.objetosComEscrita,
      execucao: c.privilegios.X,
      papeis: [...c.papeis].sort(),
      uso,
    };
  });
  linhas.sort(
    (a, b) =>
      PESO_SITUACAO[a.situacao] - PESO_SITUACAO[b.situacao] ||
      b.escrita - a.escrita ||
      (a.nome ?? '~').localeCompare(b.nome ?? '~'),
  );
  const porSituacao = Object.fromEntries(SITUACOES_CONTA_BANCO.map((s) => [s, 0])) as Record<
    SituacaoContaBanco,
    number
  >;
  for (const l of linhas) porSituacao[l.situacao] += 1;
  const r = resumirInventario(e.contas);
  return {
    hospital: e.hospital,
    em: e.em,
    contexto: {
      desligado: e.contexto.desligado,
      contingenciaAtiva: e.contexto.contingenciaAtiva,
      janelaMinimaDias: janela,
      avisos: [...e.avisos],
    },
    resumo: {
      contasComPrivilegio: r.contasComPrivilegio,
      contasComEscrita: r.contasComEscrita,
      contasComEscritaAmpla: r.contasComEscritaAmpla,
      maiorAlcanceEscrita: r.maiorAlcanceEscrita,
      naoCatalogadas: r.naoCatalogadas,
      loginsSemPrivilegio: faixaContagem(e.loginsNaoLegiveis),
      papeisSemPrivilegio: [...r.papeisSemPrivilegio],
      porSituacao,
    },
    contas: linhas,
  };
}

export interface EntradaDesvios {
  readonly hospital: string;
  readonly em: string;
  readonly alcances: readonly AlcanceModulo[];
  /** Privilégios reais dos titulares SGH_ (papéis por módulo e contas por módulo). */
  readonly reais: readonly PrivilegioReal[];
  /** Módulos cuja conta está no arquivo de ambiente. */
  readonly contasConfiguradas: ReadonlySet<string>;
}

/** Resposta dos desvios: plano por módulo × catálogo de segurança, com as listas limitadas ao teto. */
export function montarDesvios(e: EntradaDesvios): DesviosPrivilegiosResposta {
  const plano = planejarPrivilegios(e.alcances);
  const d = compararPrivilegios(plano, e.reais);
  const itensPorPapel = new Map<string, number>();
  for (const i of plano) itensPorPapel.set(i.titular, (itensPorPapel.get(i.titular) ?? 0) + 1);
  return {
    hospital: e.hospital,
    em: e.em,
    versaoPlano: versaoDoAlcance(e.alcances),
    modulos: e.alcances.map((a) => ({
      modulo: a.modulo,
      papel: papelDoModulo(a.modulo),
      conta: contaDoModulo(a.modulo),
      objetos: Object.keys(a.objetos).length,
      itens: itensPorPapel.get(papelDoModulo(a.modulo)) ?? 0,
      contaConfigurada: e.contasConfiguradas.has(a.modulo),
    })),
    iguais: d.iguais,
    excessoTotal: d.excesso.length,
    faltaTotal: d.falta.length,
    excesso: d.excesso.slice(0, TETO_ITENS_DESVIO).map((i) => ({ ...i })),
    falta: d.falta.slice(0, TETO_ITENS_DESVIO).map((i) => ({ ...i })),
    planoAplicado: e.reais.some((r) => r.titular.startsWith(PREFIXO_PAPEL_MODULO)),
  };
}
