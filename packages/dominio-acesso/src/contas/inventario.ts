// M59-F1 (ficha do M59, regras 1, 4 e 5; cap-08 §8.10 e §8.16): classificação das contas do banco e o
// destino de cada uma. Puro: recebe o inventário lido (só nomes de conta técnica e contagens) e o uso medido,
// e devolve o que pode ser feito agora e por quê. Nada é revogado aqui: a revogação é um script aplicado pela
// TI com autorização do dono por passo (ficha, seção 12).
import {
  CONTAS_TECNICAS_LEGADO,
  PREFIXO_CONTA_MODULO_BANCO,
  PREFIXO_PAPEL_MODULO_BANCO,
  type ClasseContaBanco,
  type SituacaoContaBanco,
  type ContaBancoLida,
  type ContaTecnicaCatalogada,
  type DestinoContaBanco,
  type UsoContaBanco,
} from '@sgh/contratos';

/** Contas do próprio Sante SGH no hospital (do arquivo de ambiente; nunca fixas no código). */
export interface ContasSgh {
  /** Conta (ou contas, depois do F1: uma por módulo) da aplicação. */
  readonly aplicacao: readonly string[];
  /** Dona dos objetos SGH_ (pnpm sgh:aplicar). */
  readonly scripts: string | null;
  /** Leitura para relatórios e BI. */
  readonly leitura: string | null;
}

/** Prefixo das contas por módulo que o F1 cria (privilegio-minimo.ts). */
export const PREFIXO_CONTA_MODULO = PREFIXO_CONTA_MODULO_BANCO;
/** Prefixo dos papéis por módulo que o F1 cria. */
export const PREFIXO_PAPEL_SGH = PREFIXO_PAPEL_MODULO_BANCO;
/** Papel único da aplicação hoje (pnpm sgh:aplicar o concede à conta da aplicação). */
export const PAPEL_APLICACAO = 'SGH_APLICACAO';

const normal = (n: string) => n.trim().toUpperCase();

/** Nomes exatos e prefixos que a leitura pode trazer pelo nome (o resto só entra na contagem). */
export function nomesLegiveis(sgh: ContasSgh): { nomes: string[]; prefixos: string[] } {
  const nomes = new Set<string>();
  const prefixos = new Set<string>([PREFIXO_CONTA_MODULO]);
  for (const x of CONTAS_TECNICAS_LEGADO) {
    if (x.nome) nomes.add(x.nome);
    if (x.prefixo) prefixos.add(x.prefixo);
  }
  for (const n of [...sgh.aplicacao, sgh.scripts, sgh.leitura]) if (n) nomes.add(normal(n));
  return { nomes: [...nomes].sort(), prefixos: [...prefixos].sort() };
}

/** Catalogação de uma conta pelo nome. Conta que não está em lugar nenhum volta como `nao-catalogada`. */
export function catalogarConta(nome: string | null, sgh: ContasSgh): ContaTecnicaCatalogada {
  const n = nome === null ? '' : normal(nome);
  if (n) {
    if (
      sgh.aplicacao.some((a) => normal(a) === n) ||
      n.startsWith(PREFIXO_CONTA_MODULO) ||
      n.startsWith(PREFIXO_PAPEL_SGH) ||
      n === PAPEL_APLICACAO
    ) {
      return { nome: n, classe: 'aplicacao-sgh', destino: 'privilegio-minimo', exigeMedicao: true };
    }
    if (sgh.scripts && normal(sgh.scripts) === n) {
      return { nome: n, classe: 'scripts-sgh', destino: 'privilegio-minimo', exigeMedicao: true };
    }
    if (sgh.leitura && normal(sgh.leitura) === n) {
      return { nome: n, classe: 'leitura-sgh', destino: 'privilegio-minimo', exigeMedicao: true };
    }
    const exata = CONTAS_TECNICAS_LEGADO.find((x) => x.nome === n);
    if (exata) return exata;
    const prefixo = CONTAS_TECNICAS_LEGADO.find((x) => x.prefixo && n.startsWith(x.prefixo));
    if (prefixo) return { ...prefixo, nome: n };
  }
  return { classe: 'nao-catalogada', destino: 'manter-auditada', exigeMedicao: true };
}

/** Situação da conta no plano do F1. */
/** Situação da conta (contrato: SITUACOES_CONTA_BANCO). */
export type SituacaoConta = SituacaoContaBanco;

export interface ContextoHospital {
  /** O sistema anterior está desligado no hospital (M58). */
  readonly desligado: boolean;
  /** `legado.contingencia` ligada (DP-6): ainda pode ser religado. */
  readonly contingenciaAtiva: boolean;
  /** Decisões já registradas em ESTADO.md (ex.: 'DP-16', 'regra-12', 'area:EXCEL_FIN'). */
  readonly decisoes: ReadonlySet<string>;
  /** Janela mínima de medição, em dias (padrão 90). */
  readonly janelaMinimaDias?: number;
}

export interface DestinoDecidido {
  readonly classe: ClasseContaBanco;
  readonly destino: DestinoContaBanco;
  readonly situacao: SituacaoConta;
  readonly motivo: string;
}

/** Classes cujo destino mexe no que o sistema anterior usa (só depois do fim da contingência). */
const USADAS_PELO_ANTERIOR: ReadonlySet<ClasseContaBanco> = new Set(['servico-legado', 'backup', 'publico']);
/** Classes sem sessão própria (papel e PUBLIC): não há uso a medir; a prova é na cópia. */
const SEM_SESSAO: ReadonlySet<ClasseContaBanco> = new Set(['publico', 'papel-legado']);
/** Classes que nunca viram "revogar" por falta de uso (são do servidor ou do próprio Sante SGH). */
const NUNCA_REVOGA_POR_DESUSO: ReadonlySet<ClasseContaBanco> = new Set([
  'administrador-banco',
  'publico',
  'aplicacao-sgh',
  'scripts-sgh',
  'leitura-sgh',
  'backup',
  'sante-api',
]);

const DIA_MS = 86_400_000;
const diasDaJanela = (u: UsoContaBanco) =>
  Math.round((Date.parse(`${u.fim}T00:00:00Z`) - Date.parse(`${u.inicio}T00:00:00Z`)) / DIA_MS) + 1;

/**
 * Destino e situação de uma conta (regra 5). Ordem das condições: hospital desligado (regra 1); conta
 * conhecida; medição na janela mínima; desuso vira revogação; contingência para o que o anterior usa;
 * decisões pendentes.
 */
export function decidirDestinoConta(
  nome: string | null,
  sgh: ContasSgh,
  uso: UsoContaBanco | null,
  h: ContextoHospital,
): DestinoDecidido {
  const cat = catalogarConta(nome, sgh);
  const base = { classe: cat.classe, destino: cat.destino };
  if (!h.desligado) {
    return {
      ...base,
      situacao: 'aguardando-desligamento',
      motivo: 'o hospital ainda não concluiu a migração de todos os usuários',
    };
  }
  if (cat.classe === 'nao-catalogada') {
    return {
      ...base,
      situacao: 'identificar',
      motivo: 'conta fora do catálogo: a TI identifica o dono e o uso',
    };
  }
  if (cat.classe === 'administrador-banco') {
    return {
      ...base,
      situacao: 'pronta',
      motivo: 'fica só para a TI, com o acesso de administrador auditado',
    };
  }
  if (cat.classe === 'papel-legado') {
    return { ...base, situacao: 'pronta', motivo: 'papel sem privilégio: fica como está' };
  }
  if (cat.destino === 'privilegio-minimo') {
    return { ...base, situacao: 'pronta', motivo: 'conta do Sante SGH: privilégio mínimo por módulo' };
  }
  const janela = h.janelaMinimaDias ?? 90;
  if (!SEM_SESSAO.has(cat.classe) && (!uso || diasDaJanela(uso) < janela)) {
    return {
      ...base,
      situacao: 'medir-uso',
      motivo: `medir sessões e consultas por pelo menos ${janela} dias`,
    };
  }
  const semUso = uso !== null && !SEM_SESSAO.has(cat.classe) && uso.sessoes === 0;
  const destino: DestinoContaBanco =
    semUso && !NUNCA_REVOGA_POR_DESUSO.has(cat.classe) ? 'revogar' : cat.destino;
  if (USADAS_PELO_ANTERIOR.has(cat.classe) && h.contingenciaAtiva) {
    return {
      classe: cat.classe,
      destino,
      situacao: 'aguardando-contingencia',
      motivo: 'o período de contingência está aberto e esta conta atende um serviço que pode voltar',
    };
  }
  if (destino === 'revogar' && semUso) {
    return { classe: cat.classe, destino, situacao: 'pronta', motivo: 'sem sessão na janela medida' };
  }
  const pendentes = (cat.dependeDe ?? []).filter((d) => !h.decisoes.has(d));
  if (destino === 'revogar' && cat.classe === 'planilha' && !h.decisoes.has(`area:${cat.nome ?? ''}`)) {
    pendentes.push(`area:${cat.nome ?? ''}`);
  }
  if (pendentes.length > 0) {
    return {
      classe: cat.classe,
      destino,
      situacao: 'aguardando-decisao',
      motivo: `em uso; falta a decisão: ${pendentes.join(', ')}`,
    };
  }
  return { classe: cat.classe, destino, situacao: 'pronta', motivo: 'uso medido e decisões registradas' };
}

/** Contagem agregada para relatório: abaixo de 5 vira '<5' (convencoes.md §11). */
export function faixaContagem(n: number): number | '<5' {
  return n > 0 && n < 5 ? '<5' : n;
}

/** Limiar de "escrita ampla" (cap-08 §8.10: cerca de 2.648 tabelas; aqui, mil objetos ou mais). */
export const LIMIAR_ESCRITA_AMPLA = 1000;

export interface ResumoInventario {
  readonly contasComPrivilegio: number;
  readonly contasComEscrita: number;
  readonly contasComEscritaAmpla: number;
  readonly maiorAlcanceEscrita: number;
  readonly naoCatalogadas: number | '<5';
  readonly papeisSemPrivilegio: readonly string[];
}

const temPrivilegio = (c: ContaBancoLida) => Object.values(c.privilegios).some((n) => n > 0);

/** Resumo do inventário (números que o relatório da F1 compara com o cap-08 §8.10). */
export function resumirInventario(contas: readonly ContaBancoLida[]): ResumoInventario {
  const usuarios = contas.filter((c) => c.tipo === 'usuario');
  const soma = (xs: readonly ContaBancoLida[]) => xs.reduce((t, c) => t + c.quantidade, 0);
  const comEscrita = usuarios.filter((c) => c.objetosComEscrita > 0);
  return {
    contasComPrivilegio: soma(usuarios.filter(temPrivilegio)),
    contasComEscrita: soma(comEscrita),
    contasComEscritaAmpla: soma(comEscrita.filter((c) => c.objetosComEscrita >= LIMIAR_ESCRITA_AMPLA)),
    maiorAlcanceEscrita: Math.max(0, ...comEscrita.map((c) => c.objetosComEscrita)),
    naoCatalogadas: faixaContagem(soma(usuarios.filter((c) => c.nome === null))),
    papeisSemPrivilegio: contas
      .filter((c) => c.tipo === 'papel' && c.nome && !temPrivilegio(c))
      .map((c) => c.nome as string)
      .sort(),
  };
}

/** Regra 4: a conta da aplicação nunca é o administrador do servidor nem a dona dos objetos SGH_. */
export function conferirContaAplicacao(sgh: ContasSgh): readonly string[] {
  const erros: string[] = [];
  const scripts = sgh.scripts ? normal(sgh.scripts) : null;
  for (const a of sgh.aplicacao.map(normal)) {
    if (a === 'SYSDBA') erros.push('a aplicação não pode usar o administrador do servidor');
    if (scripts && a === scripts) erros.push('a aplicação não pode usar a conta dos scripts SGH_');
  }
  if (scripts === 'SYSDBA') erros.push('os scripts SGH_ têm conta própria, não a do administrador');
  return erros;
}
