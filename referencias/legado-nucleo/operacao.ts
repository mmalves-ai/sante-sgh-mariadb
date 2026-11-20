// Definição de uma operação de gravação compatível (roteiro 4.6 e 6.2; ficha do M04): a RECEITA
// declarativa (tabelas e colunas com a classe do valor, ordem, triggers que disparam e o que fazem, o que o
// novo não faz, condição, prova pós-escrita, cenários) e os passos 2 a 5 que só a operação conhece. O
// executor (executor.ts) faz os passos 0, 1, 6 e 7. A receita é conferida contra o catálogo
// (docs/operacoes/catalogo) e o perfil passivo (receitas.spec.ts); a tabela que um trigger grava nunca
// é passo do novo (regra 3: não duplicar trigger).
import type { DiferencaAceita } from '@sgh/contratos';
import type { z } from 'zod';
import type { ContextoLegado } from './contexto.js';
import type { Linha } from './driver.js';
import type { Escritor } from './transacao.js';

export type AcaoGravacao = 'INSERT' | 'UPDATE' | 'DELETE';

/**
 * De onde vem o valor que o novo põe na coluna: campo da entrada (com o valor que o legado grava quando o
 * campo não vem), constante, TBUSERS.NOME da sessão, expressão do banco (relógio) ou valor calculado pela
 * operação (ex.: fonética pelo procedimento do legado). Sem `valor`, o novo não põe a coluna no comando
 * (fica para o trigger ou para o DEFAULT da coluna).
 */
export type FonteValor =
  | { readonly de: 'entrada'; readonly campo: string; readonly seAusente: string | number | null }
  | { readonly de: 'constante'; readonly valor: string | number | boolean | Date | null }
  | { readonly de: 'sessao' }
  | { readonly de: 'banco'; readonly expressao: 'CURRENT_DATE' | 'CURRENT_TIMESTAMP' }
  | { readonly de: 'calculado'; readonly chave: string; readonly campo?: string };

/** Coluna da receita: a classe do valor (as do teste de assinatura), a origem e como o novo a preenche. */
export interface ColunaReceita {
  readonly classe: string;
  /** Classe quando o campo de entrada não vem (o que o legado grava no vazio). */
  readonly classeAusente?: string;
  /** Origem do valor ("entrada", "sessão: TBUSERS.NOME", "relógio do banco", "trigger X", "DEFAULT"…). */
  readonly origem: string;
  readonly valor?: FonteValor;
}

export interface PassoReceita {
  readonly ordem: number;
  readonly tabela: string;
  readonly acao: AcaoGravacao;
  readonly colunas: Readonly<Record<string, ColunaReceita>>;
  /** Colunas que o comando devolve (RETURNING). */
  readonly retorna?: readonly string[];
}

export interface EfeitoTriggerReceita {
  readonly trigger: string;
  readonly tabela: string;
  readonly acao: AcaoGravacao;
  readonly faz: string;
}

export interface CenarioReceita {
  readonly nome: string;
  readonly descricao: string;
  /** Cenário de recusa: nenhuma linha em nenhuma tabela. */
  readonly recusa?: boolean;
  /** Campos de entrada que o cenário preenche (os demais ficam no vazio do legado). */
  readonly campos?: readonly string[];
  /** Linhas que os triggers criam ou alteram neste cenário (tabela:ação → linhas). */
  readonly efeitos?: Readonly<Record<string, number>>;
  /**
   * Linhas que o novo grava em cada tabela dos passos (padrão: 1 no primeiro passo, 0 nos demais). M13: na
   * receita de carga (`modo: 'carga'`), a chave é `TABELA:ACAO` (a mesma tabela inclui e altera).
   */
  readonly linhas?: Readonly<Record<string, number>>;
  /**
   * M59.3: receita de alteração com passos alternativos (um por tabela; a entrada escolhe qual executa, como em
   * integracao.cifrarSegredoLegado): a ordem do passo que este cenário exercita. Sem ele, o primeiro passo.
   */
  readonly passo?: number;
  /**
   * M13 (receita de carga): colunas que mudam nos passos de alteração, por tabela (sem isso, as colunas do
   * passo que o cenário preenche). W1-01: vale também na alteração comum (a constante que a linha já tinha não muda).
   */
  readonly alteradas?: Readonly<Record<string, readonly string[]>>;
  /**
   * M11: regras da referência de perfil SÓ deste cenário (as da receita valem para todos): classe de coluna
   * com o motivo medido e ligação do catálogo que o cenário não tem (ex.: o telefone do contato não é o
   * celular), cada uma com o motivo.
   */
  readonly referencia?: {
    readonly classes?: Readonly<
      Record<string, Readonly<Record<string, { classe: string; motivo: string; formato?: string }>>>
    >;
    readonly semLigacoes?: readonly {
      readonly de: string;
      readonly para: string;
      readonly colunas: readonly string[];
      readonly motivo: string;
    }[];
  };
}

/**
 * M23: coluna que o gatilho do legado numera por um generator escolhido em tempo de execução (ex.: SILANEXA.CONTROLE
 * pelo GEN_CTRnn do ato), que a análise do gatilho não acha. A ferramenta de assinatura retrata os generators cujo
 * nome casa com `generators` e só aceita como `generator` o valor que ficou no intervalo que um deles andou.
 */
export interface GeradorDinamicoReceita {
  readonly tabela: string;
  readonly coluna: string;
  /** Expressão (fonte de RegExp) dos nomes dos generators candidatos. */
  readonly generators: string;
  readonly motivo: string;
}

export interface Receita {
  readonly nome: string;
  readonly modulo: string;
  readonly grupo: string;
  readonly descricao: string;
  readonly marco: string;
  readonly origem: 'sante-api' | 'perfil-passivo' | 'cenario-controlado';
  readonly arquivoOrigem: string | null;
  readonly passos: readonly PassoReceita[];
  /** Tabelas gravadas pelos triggers do legado (o novo não grava; a prova confere). */
  readonly efeitos: readonly EfeitoTriggerReceita[];
  readonly naoFaz: readonly string[];
  /** M14 (POL-3): o que falta provar; a operação fica desligada com este motivo visível (fora de dev). */
  readonly pendente?: string;
  readonly condicao: string;
  readonly concorrencia: string;
  /**
   * M19: fila concorrente (chamar a senha): a transação é NO WAIT e a operação trava cada candidata sem espera; a
   * ocupada (por outro guichê, deste ou do outro sistema) passa à seguinte (cap-14 §14.2.2).
   */
  readonly semEspera?: true;
  readonly prova: string;
  readonly cenarios: readonly CenarioReceita[];
  /** Operação crítica: exige reautenticação recente (M05). */
  readonly critica?: boolean;
  /** Evento da trilha (SGH_TRILHA.EVENTO) e recurso no vocabulário do novo. */
  readonly evento: string;
  readonly recurso: string;
  /** M06: o evento que o Delphi grava na trilha do legado para esta operação (trilha dupla). */
  readonly eventoLegado?: EventoLegadoReceita;
  /**
   * M22: eventos que o Delphi grava ANTES do principal na mesma ação, sem registro afetado (ex.: a ação 24
   * "Confirmar" junto da inclusão da evolução: 1.952 de 2.394 lançamentos de julho), na mesma transação.
   */
  readonly eventosLegadoAntes?: readonly Omit<EventoLegadoReceita, 'alvo'>[];
  /**
   * M20: generators do legado que a operação pede ANTES de gravar (o Delphi reserva o REG da ficha no GEN_REGEXT e o
   * grava também na guia), pelo `reservarDoGenerator` do gravador; lista explícita, conferida na reserva.
   */
  readonly generatorsReservados?: readonly string[];
  /** M23: colunas numeradas por generator dinâmico do gatilho (lista explícita, nunca toda coluna `generator`). */
  readonly geradoresDinamicos?: readonly GeradorDinamicoReceita[];
  /** M12: tabelas SGH_ que a operação grava pelo `registrarSgh` (autoria; nunca tabela do legado). */
  readonly registrosSgh?: readonly string[];
  /**
   * M13: receita de CARGA de catálogo: várias tabelas, cada uma com inclusão e alteração pela chave natural no
   * mesmo cenário (a referência de perfil monta cada passo pela ação dele).
   */
  readonly modo?: 'carga';
  /**
   * Regras da referência de perfil (assinatura:referencia): classe na INCLUSÃO onde o perfil (estado atual
   * das linhas) não a mostra, cada uma com o motivo medido; e as diferenças aceitas, cada uma com decisão.
   */
  readonly referencia?: {
    readonly classes?: Readonly<
      Record<string, Readonly<Record<string, { classe: string; motivo: string; formato?: string }>>>
    >;
    readonly diferencasAceitas?: readonly DiferencaAceita[];
    /**
     * M11: a alteração muda uma linha que a inclusão `operacao`/`cenario` criou (a reprodução cria assim): a
     * referência das cópias do efeito parte das classes dessa inclusão.
     */
    readonly base?: { readonly operacao: string; readonly cenario: string };
  };
}

/** Valores de resultado guardados em SGH_IDEMPOTENCIA e devolvidos à repetição: só IDs e códigos. */
export type ResultadoOperacao = Readonly<Record<string, number | string | boolean | null>>;

export interface ContextoOperacao extends ContextoLegado {
  /** TBUSERS.NOME de quem opera (sensível a maiúsculas): vai às colunas de usuário. */
  readonly usuarioLegado: string;
  readonly idempotencyKey: string;
  /** Setor do legado da sessão (chave de liberação por setor). */
  readonly setor?: string;
  /** M08: grupo do legado (TBGRUUSU.NOME) da sessão (chave de liberação por grupo, DP-4). */
  readonly grupo?: string;
  readonly estacao?: string;
  /** Instante (ms) da última reautenticação (operação crítica). */
  readonly reautenticadoEm?: number;
}

/** Linha principal a travar e reler (passo 2), quando a operação altera linha existente. */
export interface AlvoTrava {
  readonly tabela: string;
  /** Coluna → valor da chave (tabela física única; JOIN com WITH LOCK dá erro -104). */
  readonly chave: Readonly<Record<string, unknown>>;
  /** Colunas relidas: carimbo DATA_HORA_ULTIMA_ATUALIZACAO ou as colunas que a tela mostrou. */
  readonly colunas: readonly string[];
  /** Valores lidos pela tela, para o controle otimista (passo 3); ausente: sem conferência de versão. */
  readonly esperado?: Readonly<Record<string, unknown>>;
}

/** Transação da operação: o escritor do núcleo, com a conferência de que só grava tabela da receita. */
export interface TxOperacao extends Escritor {
  /** Primeira linha da consulta, ou null. */
  uma(sql: string, parametros?: readonly unknown[]): Promise<Linha | null>;
  /** M20: o próximo valor de um generator declarado em `receita.generatorsReservados` (nunca outro; nunca MAX+1). */
  reservarGenerator?(nome: string): Promise<number>;
}

export interface EventoOperacao {
  readonly tipo: string;
  /** Só IDs e códigos (nunca nome, documento ou texto clínico). */
  readonly carga: Readonly<Record<string, number | string>>;
}

export interface AlvoTrilha {
  readonly tabela: string;
  readonly id: string | number | null;
  readonly chaveNatural?: string | null;
}

/** Dados da SGH_TRILHA que dependem da entrada (M06: evento do catálogo, objeto, trilha do legado). */
export interface ExtrasTrilha {
  readonly evento?: string;
  readonly origem?: string | null;
  readonly idPaciente?: number | null;
  readonly atendimento?: number | null;
  readonly idTrilhaLegado?: string | null;
  readonly diferenca?: string | null;
}

/**
 * Evento que o Delphi registra na trilha do legado para a operação (M06, trilha dupla): o executor grava
 * TBCABTRILHA/TBLANTRILHASGH na MESMA transação, pelo auditoria.registrarEventoLegado, e liga a SGH_TRILHA a
 * ela. `alvo` é a tabela.coluna do registro afetado (TBLANTRILHASGH.TABELA_CAMPO).
 */
export interface EventoLegadoReceita {
  /** ADR 0022: 17, 18 e 25 (gerenciamento de usuários, grupos e permissões) na administração de acessos. */
  readonly tipo: 1 | 2 | 3 | 4 | 5 | 17 | 18 | 24 | 25;
  readonly criticidade: 7 | 4 | 2;
  readonly opcao: number;
  /** Sem alvo: só o cabeçalho (o Delphi grava os tipos 18 e 25 sem TBLANTRILHASGH; 811 e 4 eventos no pc). */
  readonly alvo:
    | 'RICADPAC.ID'
    | 'RECADATE.REG'
    | 'RICADINT.REG'
    // M21: a transferência de leito e as alterações (trocas) da internação.
    | 'RITRANSF.REGISTRO'
    | 'RICONTAS.REG'
    | 'TBUSERS.ID_TBUSERS'
    // M14: domínios com trilha do legado medida.
    | 'TBALERGIA.ID'
    | 'TBPRINC.COD'
    | 'SITABPRO.ID'
    // M22: a evolução registrada e a suspensa (TBLANTRILHASGH com o cabeçalho do registro).
    | 'PRCABEVOL.ID_CABEVOL'
    // M24: a prescrição (inclusão, suspensão e manutenção dos itens: TBLANTRILHASGH com PRPRESC.ID).
    | 'PRPRESC.ID'
    // M23: receita, atestado, pedido de exame e anexo.
    | 'PRRECEITA.ID_RECEITA'
    | 'PRATESTREQIMP.ID'
    | 'SILANEXA.ID'
    | 'PRGEDIMP.ID'
    // M26: o resultado do exame incluído.
    | 'SIRES01.ID'
    | 'SICADATE.ID'
    // M25: o horário checado (opção 5302 "Checar").
    | 'PRCHKGERAL.ID'
    | null;
}

export interface Operacao<E, S extends ResultadoOperacao> {
  readonly receita: Receita;
  readonly entrada: z.ZodType<E>;
  travar?(entrada: E, ctx: ContextoOperacao): AlvoTrava | null;
  /** Passo 3: condição no estado relido (e as buscas refeitas dentro da transação). */
  conferir?(tx: TxOperacao, entrada: E, ctx: ContextoOperacao, relido: Linha | null): Promise<void>;
  /** Passo 4: grava como o SPDATA (tabelas, colunas e ordem da receita). */
  gravar(tx: TxOperacao, entrada: E, ctx: ContextoOperacao): Promise<S>;
  /** Passo 5: relê o gravado e os efeitos dos triggers; faltou efeito, lança ErroProva. */
  provar(tx: TxOperacao, entrada: E, resultado: S, ctx: ContextoOperacao): Promise<void>;
  /**
   * M11: gravações SGH_ derivadas da operação, na MESMA transação (ex.: índice de busca SGH_BUSCA_NOME do
   * cadastro), depois da prova e antes da trilha. O escritor só aceita tabela SGH_ (nunca tabela do legado);
   * desfeita a operação, o derivado some junto.
   */
  sgh?(e: Escritor, entrada: E, resultado: S, ctx: ContextoOperacao): Promise<void>;
  eventos(entrada: E, resultado: S, ctx: ContextoOperacao): readonly EventoOperacao[];
  alvo(entrada: E, resultado: S): AlvoTrilha;
  /** M06: dados da SGH_TRILHA desta execução (evento, objeto, ligação com a trilha do legado). */
  trilha?(entrada: E, resultado: S, ctx: ContextoOperacao): ExtrasTrilha;
  /**
   * M23: o evento da trilha do legado desta execução, quando ele muda com a entrada (a receita e o atestado da mesma
   * operação são registrados pelo Delphi em opções diferentes). Ausente: os da receita (`eventoLegado`,
   * `eventosLegadoAntes`).
   */
  eventoLegadoDaEntrada?(entrada: E): {
    readonly evento?: EventoLegadoReceita;
    readonly antes?: readonly Omit<EventoLegadoReceita, 'alvo'>[];
  };
  /** M22: o atendimento (ATCABECATEND.ID) que o Delphi grava no cabeçalho da trilha do legado do evento. */
  atendimentoLegado?(entrada: E, resultado: S): number | null;
  /**
   * M12: registro próprio do novo em tabela SGH_ da operação (ex.: SGH_PRECO_AUTORIA, a autoria que o legado
   * não guarda), na MESMA transação, depois da prova e antes da SGH_TRILHA. O escritor só aceita tabela SGH_
   * (as tabelas do legado continuam só nos passos da receita). Declarado em `receita.registrosSgh`.
   */
  registrarSgh?(e: Escritor, entrada: E, resultado: S, ctx: ContextoOperacao): Promise<void>;
}

export class ErroReceita extends Error {
  override readonly name = 'ErroReceita';
}

const NOME_OPERACAO = /^[a-z]+\.[a-z][A-Za-z0-9]+$/;
const NOME_OBJETO = /^[A-Z][A-Z0-9_$]{0,30}$/;

/** Confere a receita: nome, ordem dos passos, efeito de trigger nunca é passo do novo (regra 3). */
export function conferirReceita(r: Receita): void {
  if (!NOME_OPERACAO.test(r.nome) || !r.nome.startsWith(`${r.modulo}.`)) {
    throw new ErroReceita(`Receita ${r.nome}: nome fora do padrão <modulo>.<verboObjeto>.`);
  }
  if (r.passos.length === 0) throw new ErroReceita(`Receita ${r.nome}: sem passos.`);
  r.passos.forEach((p, i) => {
    if (p.ordem !== i + 1) throw new ErroReceita(`Receita ${r.nome}: passos fora de ordem.`);
    if (!NOME_OBJETO.test(p.tabela)) throw new ErroReceita(`Receita ${r.nome}: tabela inválida.`);
    if (p.tabela.startsWith('SGH_')) {
      throw new ErroReceita(`Receita ${r.nome}: tabelas SGH_ técnicas são do executor (passo 6).`);
    }
    if (Object.keys(p.colunas).length === 0) throw new ErroReceita(`Receita ${r.nome}: passo sem colunas.`);
  });
  const gravadas = new Set(r.passos.map((p) => `${p.tabela}:${p.acao}`));
  for (const e of r.efeitos) {
    if (gravadas.has(`${e.tabela}:${e.acao}`)) {
      throw new ErroReceita(
        `Receita ${r.nome}: ${e.tabela} (${e.acao}) é efeito de ${e.trigger} e não pode ser passo do novo (não duplicar trigger).`,
      );
    }
  }
  const nomes = new Set<string>();
  for (const c of r.cenarios) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.nome) || nomes.has(c.nome)) {
      throw new ErroReceita(`Receita ${r.nome}: cenário inválido ou repetido (${c.nome}).`);
    }
    nomes.add(c.nome);
  }
  for (const t of r.registrosSgh ?? []) {
    if (!/^SGH_[A-Z0-9_]{1,27}$/.test(t))
      throw new ErroReceita(`Receita ${r.nome}: registro próprio só em tabela SGH_ (${t}).`);
  }
  if (!r.cenarios.some((c) => c.recusa)) {
    throw new ErroReceita(`Receita ${r.nome}: toda operação tem cenário de recusa.`);
  }
}

export function definirOperacao<E, S extends ResultadoOperacao>(op: Operacao<E, S>): Operacao<E, S> {
  conferirReceita(op.receita);
  return Object.freeze(op);
}

/** Tabelas que a operação toca: gravadas pelo novo e pelos triggers (para a marca de schema). */
export function tabelasDaReceita(r: Receita): string[] {
  const trilha = r.eventoLegado || r.eventosLegadoAntes?.length ? ['TBCABTRILHA', 'TBLANTRILHASGH'] : [];
  return [
    ...new Set([...r.passos.map((p) => p.tabela), ...r.efeitos.map((e) => e.tabela), ...trilha]),
  ].sort();
}
