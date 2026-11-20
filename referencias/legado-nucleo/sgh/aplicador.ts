// Aplicação dos scripts SGH_ (`pnpm sgh:aplicar`; ficha do M04, seção 1; M60, etapa 1): lê SGH_VERSAO_SCRIPT,
// aplica em ordem os scripts que faltam (cada um numa transação confirmada, com a conta de scripts) e registra
// cada um com o hash do arquivo, o ambiente e a conta. M60 (regra 2, retomável): o registro vai NA MESMA
// transação do DDL do script (Firebird confirma o DDL e o INSERT juntos), então uma aplicação cortada no meio
// segue do script seguinte na reexecução. Exceção: o 0001, que cria a própria SGH_VERSAO_SCRIPT (o Firebird só
// deixa usar a tabela depois do COMMIT do DDL), registra em transação própria; se o corte caiu entre as duas,
// a reexecução encontra TODOS os objetos do 0001 e a tabela vazia e só registra ("retomado"). Idempotente: a
// segunda execução não aplica nada. Recusa: hash diferente do registrado, objeto já existente sem registro
// (fora do caso do 0001, exige conferência humana) e `producao` sem a autorização registrada no ESTADO.md.
// `simularScripts` (M60, `--simular`): o mesmo plano, só com leitura (conta de leitura), sem gravar nada.
import type { Escritor, Leitor } from '../transacao.js';
import {
  ErroScriptSgh,
  NUMERO_SCRIPT_VERSAO,
  objetosCriados,
  planejarScripts,
  type RegistroAplicado,
  type ScriptSgh,
  TABELA_VERSAO,
} from './scripts.js';

export const AMBIENTES_SCRIPT = ['dev', 'ci', 'homolog', 'treino', 'producao'] as const;
export type AmbienteScript = (typeof AMBIENTES_SCRIPT)[number];

export interface AcessoScripts {
  ler<T>(fn: (l: Leitor) => Promise<T>): Promise<T>;
  /** Transação de escrita CONFIRMADA no fim (só a conta de scripts). */
  escreverConfirmando<T>(fn: (e: Escritor) => Promise<T>): Promise<T>;
}

export interface OpcoesAplicacao {
  readonly ambiente: AmbienteScript;
  /** Referência da linha de ESTADO.md › Autorizações (obrigatória em producao). */
  readonly autorizacao?: string | null;
  /** Conta da aplicação que recebe o papel SGH_APLICACAO (nunca SYSDBA; ausente: ninguém recebe). */
  readonly contaAplicacao?: string | null;
  readonly aoAplicar?: (s: ScriptSgh) => void;
  /** M11: só em dev/ci, aceita registro de script de outro ramo na cópia compartilhada (listado). */
  readonly aceitarDeOutrosRamos?: boolean;
  /** M60: conta de leitura (simulação e fumaça) que recebe SELECT em SGH_VERSAO_SCRIPT (nunca SYSDBA). */
  readonly contaLeitura?: string | null;
  /** M60 (`--relatorio`): relógio em milissegundos (padrão: performance.now). */
  readonly relogio?: () => number;
  /** M60 (`--relatorio`): cada script confirmado, com o tempo, assim que confirma (o relatório de falha usa). */
  readonly aoTempo?: (t: TempoScript) => void;
  /** M60 (`--relatorio`): o script que falhou e o tempo até a falha (os anteriores já estão confirmados). */
  readonly aoFalhar?: (f: FalhaScript) => void;
}

/** M60 (`--relatorio`): script que falhou na aplicação (nada dele confirmado, salvo o 0001 sem registro). */
export interface FalhaScript {
  readonly numero: number;
  readonly arquivo: string;
  readonly hash: string;
  readonly ms: number;
  readonly erro: string;
}

export type SituacaoScript = 'aplicado' | 'retomado';

/** M60 (`--relatorio`): tempo de cada script aplicado (ms, do início do DDL ao COMMIT do registro). */
export interface TempoScript {
  readonly numero: number;
  readonly arquivo: string;
  readonly hash: string;
  readonly ms: number;
  readonly situacao: SituacaoScript;
}

export interface ResultadoAplicacao {
  readonly aplicados: readonly ScriptSgh[];
  readonly jaAplicados: number;
  readonly papelConcedidoA: string | null;
  readonly leituraConcedidaA: string | null;
  readonly tempos: readonly TempoScript[];
  readonly totalMs: number;
}

const NOME_CONTA = /^[A-Za-z][A-Za-z0-9_$]{0,30}$/;

export async function lerRegistrados(l: Leitor): Promise<RegistroAplicado[]> {
  const [t] = await l.consultar('SELECT COUNT(*) N FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = ?', [
    TABELA_VERSAO,
  ]);
  if (Number(t?.['N'] ?? 0) === 0) return [];
  const linhas = await l.consultar(`SELECT NUMERO, HASH_SHA256 FROM ${TABELA_VERSAO} ORDER BY NUMERO`, [], {
    teto: 10_000,
  });
  return linhas.map((x) => ({ numero: Number(x['NUMERO']), hash: String(x['HASH_SHA256'] ?? '').trim() }));
}

/** Objetos do script que já existem no banco (sem o registro: aplicação interrompida). */
export async function objetosExistentes(l: Leitor, nomes: readonly string[]): Promise<string[]> {
  const r: string[] = [];
  for (const n of nomes) {
    const [x] = await l.consultar(
      `SELECT (SELECT COUNT(*) FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = ?) +
              (SELECT COUNT(*) FROM RDB$GENERATORS WHERE RDB$GENERATOR_NAME = ?) +
              (SELECT COUNT(*) FROM RDB$INDICES WHERE RDB$INDEX_NAME = ?) +
              (SELECT COUNT(*) FROM RDB$ROLES WHERE RDB$ROLE_NAME = ?) N FROM RDB$DATABASE`,
      [n, n, n, n],
    );
    if (Number(x?.['N'] ?? 0) > 0) r.push(n);
  }
  return r;
}

/** O script cria ou altera a própria SGH_VERSAO_SCRIPT: registro em transação própria (depois do COMMIT). */
export function registraEmTransacaoPropria(s: Pick<ScriptSgh, 'numero' | 'comandos'>): boolean {
  return (
    s.numero === NUMERO_SCRIPT_VERSAO ||
    s.comandos.some((c) => new RegExp(`^(?:CREATE|ALTER)\\s+TABLE\\s+"?${TABELA_VERSAO}"?\\b`, 'i').test(c))
  );
}

function conferirAmbiente(opcoes: Pick<OpcoesAplicacao, 'ambiente' | 'autorizacao'>): void {
  if (!AMBIENTES_SCRIPT.includes(opcoes.ambiente)) throw new ErroScriptSgh('Ambiente inválido.');
  if (opcoes.ambiente === 'producao' && !opcoes.autorizacao?.trim()) {
    throw new ErroScriptSgh(
      'Produção recusada: falta a autorização do dono registrada em ESTADO.md › Autorizações (convencoes.md §8 e §14).',
    );
  }
}

function aceitaOutrosRamos(o: Pick<OpcoesAplicacao, 'ambiente' | 'aceitarDeOutrosRamos'>): boolean {
  return o.aceitarDeOutrosRamos === true && (o.ambiente === 'dev' || o.ambiente === 'ci');
}

export interface PendenteSimulado {
  readonly numero: number;
  readonly arquivo: string;
  readonly hash: string;
  readonly comandos: number;
  /** 'aplicar' (o normal), 'retomar' (o 0001 cortado entre o DDL e o registro: só registra). */
  readonly acao: 'aplicar' | 'retomar';
}

export interface ResultadoSimulacao {
  readonly pendentes: readonly PendenteSimulado[];
  readonly jaAplicados: number;
  /** Scripts pendentes com objetos já existentes sem registro: a aplicação real recusaria. */
  readonly bloqueios: readonly { readonly arquivo: string; readonly existentes: readonly string[] }[];
}

/** Ação de um script pendente diante dos objetos que já existem (null: recusa, com os existentes). */
function acaoDoPendente(
  s: ScriptSgh,
  existentes: readonly string[],
  registrados: number,
): 'aplicar' | 'retomar' | null {
  if (existentes.length === 0) return 'aplicar';
  const todos = objetosCriados(s);
  if (s.numero === NUMERO_SCRIPT_VERSAO && registrados === 0 && todos.every((o) => existentes.includes(o))) {
    return 'retomar';
  }
  return null;
}

/**
 * M60 (`sgh:aplicar --simular`): o que falta aplicar, na ordem, com o hash, e o que a aplicação real recusaria.
 * Só leitura (a conta de leitura basta: num banco sem SGH_VERSAO_SCRIPT só lê o catálogo do sistema).
 */
export async function simularScripts(
  ler: AcessoScripts['ler'],
  scripts: readonly ScriptSgh[],
  opcoes: Pick<OpcoesAplicacao, 'ambiente' | 'aceitarDeOutrosRamos'>,
): Promise<ResultadoSimulacao> {
  if (!AMBIENTES_SCRIPT.includes(opcoes.ambiente)) throw new ErroScriptSgh('Ambiente inválido.');
  const registrados = await ler(lerRegistrados);
  const plano = planejarScripts(scripts, registrados, aceitaOutrosRamos(opcoes));
  const pendentes: PendenteSimulado[] = [];
  const bloqueios: { arquivo: string; existentes: string[] }[] = [];
  for (const s of plano.pendentes) {
    const existentes = await ler((l) => objetosExistentes(l, objetosCriados(s)));
    const acao = acaoDoPendente(s, existentes, registrados.length);
    if (acao === null) bloqueios.push({ arquivo: s.arquivo, existentes });
    pendentes.push({
      numero: s.numero,
      arquivo: s.arquivo,
      hash: s.hash,
      comandos: s.comandos.length,
      acao: acao ?? 'aplicar',
    });
  }
  return { pendentes, jaAplicados: plano.jaAplicados.length, bloqueios };
}

const INSERIR_REGISTRO = `INSERT INTO ${TABELA_VERSAO} (NUMERO, ARQUIVO, DESCRICAO, HASH_SHA256, AMBIENTE, CONTA)
         VALUES (?, ?, ?, ?, ?, CURRENT_USER)`;

async function registrar(e: Escritor, s: ScriptSgh, ambiente: AmbienteScript): Promise<void> {
  const n = await e.executar(INSERIR_REGISTRO, [
    s.numero,
    s.arquivo,
    s.descricao.slice(0, 200),
    s.hash,
    ambiente,
  ]);
  if (n !== 1) throw new ErroScriptSgh(`${s.arquivo}: registro não gravado.`);
}

function contaValida(conta: string | null | undefined): string | null {
  const c = conta?.trim() ?? '';
  if (c === '' || c.toUpperCase() === 'SYSDBA') return null;
  if (!NOME_CONTA.test(c)) throw new ErroScriptSgh('Conta (aplicação ou leitura) com nome inválido.');
  return c.toUpperCase();
}

export async function aplicarScripts(
  acesso: AcessoScripts,
  scripts: readonly ScriptSgh[],
  opcoes: OpcoesAplicacao,
): Promise<ResultadoAplicacao> {
  conferirAmbiente(opcoes);
  const relogio = opcoes.relogio ?? (() => performance.now());
  const inicio = relogio();
  const conta = contaValida(opcoes.contaAplicacao);
  const leitura = contaValida(opcoes.contaLeitura);
  const registrados = await acesso.ler(lerRegistrados);
  const plano = planejarScripts(scripts, registrados, aceitaOutrosRamos(opcoes));
  const aplicados: ScriptSgh[] = [];
  const tempos: TempoScript[] = [];
  for (const s of plano.pendentes) {
    const t0 = relogio();
    let acao: 'aplicar' | 'retomar';
    try {
      acao = await aplicarUm(acesso, s, registrados.length, opcoes.ambiente);
    } catch (e) {
      opcoes.aoFalhar?.({
        numero: s.numero,
        arquivo: s.arquivo,
        hash: s.hash,
        ms: Math.max(0, relogio() - t0),
        erro: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
    aplicados.push(s);
    const tempo: TempoScript = {
      numero: s.numero,
      arquivo: s.arquivo,
      hash: s.hash,
      ms: Math.max(0, relogio() - t0),
      situacao: acao === 'aplicar' ? 'aplicado' : 'retomado',
    };
    tempos.push(tempo);
    opcoes.aoTempo?.(tempo);
    opcoes.aoAplicar?.(s);
  }
  if (conta) {
    await acesso.escreverConfirmando(
      (e) => e.executar(`GRANT SGH_APLICACAO TO USER ${conta}`), // = PAPEL_APLICACAO
    );
  }
  if (leitura) {
    await acesso.escreverConfirmando((e) =>
      e.executar(`GRANT SELECT ON SGH_VERSAO_SCRIPT TO USER ${leitura}`),
    );
  }
  return {
    aplicados,
    jaAplicados: plano.jaAplicados.length,
    papelConcedidoA: conta,
    leituraConcedidaA: leitura,
    tempos,
    totalMs: Math.max(0, relogio() - inicio),
  };
}

/** Um script pendente: DDL e registro (ou só o registro, se retomado); devolve o que fez. */
async function aplicarUm(
  acesso: AcessoScripts,
  s: ScriptSgh,
  quantosRegistrados: number,
  ambiente: AmbienteScript,
): Promise<'aplicar' | 'retomar'> {
  const existentes = await acesso.ler((l) => objetosExistentes(l, objetosCriados(s)));
  const acao = acaoDoPendente(s, existentes, quantosRegistrados);
  if (acao === null) {
    throw new ErroScriptSgh(
      `${s.arquivo}: objetos já existem sem registro em ${TABELA_VERSAO} (${existentes.join(', ')}); confira à mão antes de seguir.`,
    );
  }
  if (acao === 'aplicar') {
    const proprio = registraEmTransacaoPropria(s);
    await acesso.escreverConfirmando(async (e) => {
      for (const c of s.comandos) await e.executar(c);
      if (!proprio) await registrar(e, s, ambiente);
    });
    if (proprio) await acesso.escreverConfirmando((e) => registrar(e, s, ambiente));
  } else {
    await acesso.escreverConfirmando((e) => registrar(e, s, ambiente));
  }
  return acao;
}
