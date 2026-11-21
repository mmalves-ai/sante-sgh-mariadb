// Homologação sobre a cópia (M36): regras puras do registro de conferência (`pnpm conferencia:verificar`, regra 4),
// do estado efetivo depois de uma reexecução com divergência (regra 6), da situação do pentest (regra 8) e do
// roteiro de homologação por hospital (entrega 1). Sem Nest, banco ou disco: quem lê os arquivos é o script
// (tools/assinatura). O roteiro é lido por chave-usuários e não cita o outro sistema pelo nome (ADR 0023).
import {
  CHAVE_RESULTADO_ILEGIVEL,
  type DefinicaoSetor,
  type EstadoOperacao,
  estadoEm,
  type MatrizPentest,
  MODULOS_REGISTRO_CLINICO,
  ondaDaOperacao,
  operacoesDoSetor,
  type RegistroConferencia,
  type ResultadoPorCenario,
  RODADAS_CONFERENCIA,
  SETORES_PRONTIDAO,
} from '@sgh/contratos';

// A regra 6 (estado efetivo) mora em @sgh/contratos: o executor (@sgh/legado) a aplica em tempo de execução.
export { estadoEfetivo, type ResultadoPorCenario } from '@sgh/contratos';

/** O que a verificação precisa saber de cada operação do catálogo. */
export interface OperacaoHomologacao {
  readonly nome: string;
  readonly modulo: string;
  readonly estado: EstadoOperacao | Readonly<Record<string, EstadoOperacao>>;
  readonly cenarios_assinatura: readonly string[];
  readonly origem_especificacao: string;
  readonly conferencias: readonly { readonly estabelecimento: string; readonly evidencia: string }[];
  readonly triggers: readonly { readonly nome: string }[];
  readonly motivo_estado?: string | undefined;
  readonly observacao?: string | undefined;
}

export interface EntradaConferencia {
  readonly operacoes: readonly OperacaoHomologacao[];
  /** Registros lidos (`<cod>/<operacao>`), ou o erro de leitura/esquema do arquivo. */
  readonly registros: ReadonlyMap<string, RegistroConferencia | { readonly erro: string }>;
  readonly ultimoResultado: (operacao: string, hospital: string) => ResultadoPorCenario | null;
  /** Origem da referência de cada cenário (perfil, cenario-controlado, reproducao), ou null sem arquivo. */
  readonly origemDoCenario: (operacao: string, cenario: string) => string | null;
  readonly impressaoHomologada: (hospital: string) => string | null;
  /**
   * Impressão do schema da cópia em que rodou a última reprodução (regra 4: "sobre a mesma impressão digital"); null
   * sem execução. `impressaoSchema` null: relatório sem a impressão (anterior ao M36).
   */
  readonly reproducao: (
    operacao: string,
    hospital: string,
  ) => { readonly impressaoSchema: string | null; readonly executadoEm: string | null } | null;
  /** Situação do pentest (regra 8); null: matriz ilegível (bloqueia a liberação, falha fechada). */
  readonly pentest: { readonly bloqueiaLiberacao: boolean; readonly motivo: string } | null;
}

export interface SaidaConferencia {
  readonly problemas: string[];
  readonly avisos: string[];
  /** Problemas por registro (`<cod>/<operacao>`), para o painel. */
  readonly porRegistro: ReadonlyMap<string, string[]>;
}

export const caminhoRegistro = (hospital: string, operacao: string): string =>
  `docs/operacoes/conferencias/${hospital}/${operacao}.yaml`;

const EXIGE_REGISTRO: readonly EstadoOperacao[] = ['conferida', 'liberada'];

function ehErro(r: RegistroConferencia | { readonly erro: string }): r is { readonly erro: string } {
  return 'erro' in r;
}

/**
 * Exige a referência `cenario-controlado` (a de perfil não basta): nas já gravadas pela integração atual
 * (`sante-api`), cujo perfil mistura o padrão dela com o do outro sistema (DP-8: a referência é sempre a do outro
 * sistema), e nas ondas 0 e 1 (critério de aceite: "conferida no pc, com origem cenario-controlado").
 */
export function exigeCenarioControlado(
  op: Pick<OperacaoHomologacao, 'nome' | 'origem_especificacao'>,
  todos: readonly string[],
): boolean {
  return op.origem_especificacao === 'sante-api' || ondaDaOperacao(op.nome, todos) <= 1;
}

/** Problemas de um registro contra o catálogo, as assinaturas, os resultados e a impressão homologada. */
export function problemasDoRegistro(
  r: RegistroConferencia,
  op: OperacaoHomologacao,
  e: Pick<EntradaConferencia, 'ultimoResultado' | 'origemDoCenario' | 'impressaoHomologada'> &
    Partial<Pick<EntradaConferencia, 'reproducao'>>,
  exigeControlado = false,
): string[] {
  const p: string[] = [];
  const cod = r.estabelecimento;
  if (r.resultado !== 'conferida') p.push('resultado do registro não é "conferida"');
  const vistos = new Set(r.cenarios.map((c) => c.cenario));
  for (const c of op.cenarios_assinatura)
    if (!vistos.has(c)) p.push(`cenário ${c} do catálogo não conferido`);
  for (const c of r.cenarios) {
    if (!op.cenarios_assinatura.includes(c.cenario)) p.push(`cenário ${c.cenario} não está no catálogo`);
    if (c.resultado !== 'conforme') p.push(`cenário ${c.cenario} divergente na conferência da tela`);
  }
  const res = e.ultimoResultado(op.nome, cod);
  if (!res) p.push('sem execução do assinatura:testar no estabelecimento');
  else if (CHAVE_RESULTADO_ILEGIVEL in res) p.push('relatório da última reprodução ilegível');
  else
    for (const c of op.cenarios_assinatura)
      if (res[c] !== 'verde')
        p.push(`cenário ${c} não está verde na última reprodução (${res[c] ?? 'ausente'})`);
  for (const c of op.cenarios_assinatura) {
    const origem = e.origemDoCenario(op.nome, c);
    if (origem === null) p.push(`cenário ${c} sem arquivo de referência`);
    else if (origem !== 'perfil' && origem !== 'cenario-controlado')
      p.push(`cenário ${c}: a referência não é uma captura de referência (origem ${origem})`);
    else if (origem === 'perfil' && exigeControlado)
      p.push(
        `cenário ${c}: referência de perfil; esta operação exige o cenário controlado (${op.origem_especificacao === 'sante-api' ? 'já gravada pela integração atual' : 'ondas 0 e 1'})`,
      );
  }
  const homologada = e.impressaoHomologada(cod);
  if (!homologada) p.push('estabelecimento sem impressão homologada do schema');
  else if (homologada !== r.impressao_schema) p.push('impressão do schema diferente da homologada');
  // Regra 4: a reprodução sem diferença tem de ser sobre a mesma impressão do schema (a da conferência e a homologada).
  if (res && e.reproducao) {
    const rp = e.reproducao(op.nome, cod);
    if (!rp?.impressaoSchema)
      p.push('a última reprodução não registra a impressão do schema (reexecutar o assinatura:testar)');
    else if (rp.impressaoSchema !== r.impressao_schema)
      p.push('a última reprodução rodou sobre impressão do schema diferente da do registro');
    else if (homologada && rp.impressaoSchema !== homologada)
      p.push('a última reprodução rodou sobre impressão do schema diferente da homologada');
  }
  if (MODULOS_REGISTRO_CLINICO.includes(op.modulo)) {
    const papeis = new Set(r.conferentes.map((c) => c.papel));
    if (!papeis.has('medico') || !papeis.has('enfermeiro'))
      p.push('registro clínico exige a conferência do médico e do enfermeiro');
  }
  return p;
}

/**
 * `pnpm conferencia:verificar` (regra 4): recusa operação `conferida` (ou `liberada`) sem registro, com cenário
 * não verde, com referência que não é do legado ou com schema diferente do homologado; registro clínico sem
 * médico e enfermeiro; registro de operação fora do catálogo ou com o arquivo trocado.
 */
export function verificarConferencias(e: EntradaConferencia): SaidaConferencia {
  const problemas: string[] = [];
  const avisos: string[] = [];
  const porRegistro = new Map<string, string[]>();
  const porNome = new Map(e.operacoes.map((o) => [o.nome, o]));
  const todos = e.operacoes.map((o) => o.nome);
  for (const [chave, r] of e.registros) {
    const [cod, nome] = chave.split('/') as [string, string];
    if (ehErro(r)) {
      problemas.push(`${chave}: registro inválido (${r.erro})`);
      porRegistro.set(chave, [`registro inválido (${r.erro})`]);
      continue;
    }
    const op = porNome.get(nome);
    const p: string[] = [];
    if (r.operacao !== nome || r.estabelecimento !== cod)
      p.push('arquivo fora da pasta ou com o nome trocado');
    if (!op) p.push('operação fora do catálogo');
    else p.push(...problemasDoRegistro(r, op, e, exigeCenarioControlado(op, todos)));
    porRegistro.set(chave, p);
    const estado = op ? estadoEm(op, cod) : null;
    if (estado && EXIGE_REGISTRO.includes(estado)) problemas.push(...p.map((x) => `${chave}: ${x}`));
    else if (p.length === 0 && r.resultado === 'conferida')
      avisos.push(`${chave}: registro completo; o catálogo ainda não marca a operação como conferida`);
    else if (p.length > 0) avisos.push(...p.map((x) => `${chave}: ${x} (operação ainda não conferida)`));
  }
  for (const op of e.operacoes) {
    const cods =
      typeof op.estado === 'string'
        ? EXIGE_REGISTRO.includes(op.estado)
          ? ['(estado único)']
          : []
        : Object.entries(op.estado)
            .filter(([, s]) => EXIGE_REGISTRO.includes(s))
            .map(([c]) => c);
    for (const cod of cods) {
      const chave = `${cod}/${op.nome}`;
      if (!e.registros.has(chave))
        problemas.push(`${chave}: ${estadoEm(op, cod)} sem registro de conferência`);
      const ref = op.conferencias.find((c) => c.estabelecimento === cod);
      if (ref && ref.evidencia !== caminhoRegistro(cod, op.nome))
        avisos.push(`${chave}: a conferência do catálogo aponta para ${ref.evidencia}, não para o registro`);
    }
    // Regra 8: sem pentest concluído (ou com crítico/alto aberto), nenhuma operação vai a `liberada`.
    const liberadas =
      typeof op.estado === 'string'
        ? op.estado === 'liberada'
          ? ['(estado único)']
          : []
        : Object.entries(op.estado)
            .filter(([, s]) => s === 'liberada')
            .map(([c]) => c);
    if (liberadas.length > 0 && (!e.pentest || e.pentest.bloqueiaLiberacao))
      for (const cod of liberadas)
        problemas.push(
          `${cod}/${op.nome}: liberada com o pentest bloqueando a liberação (${e.pentest?.motivo ?? 'matriz de achados ilegível'})`,
        );
    for (const c of op.cenarios_assinatura) {
      if (cods.length > 0 && !exigeCenarioControlado(op, todos) && e.origemDoCenario(op.nome, c) === 'perfil')
        avisos.push(
          `${op.nome}/${c}: conferida sobre a referência de perfil (de preferência cenário controlado)`,
        );
    }
  }
  return { problemas, avisos, porRegistro };
}

// ---------------------------------------------------------------------------------------------------------------
// Pentest

export interface SituacaoPentest {
  readonly situacao: string;
  readonly abertosCriticosOuAltos: number;
  readonly porSeveridade: Record<string, number>;
  readonly reteste: string | null;
  /** A versão não pode ir à primeira liberação: sem pentest concluído ou com crítico/alto aberto. */
  readonly bloqueiaLiberacao: boolean;
  readonly motivo: string;
}

export function situacaoPentest(m: MatrizPentest): SituacaoPentest {
  const porSeveridade: Record<string, number> = {};
  let abertos = 0;
  for (const a of m.achados) {
    porSeveridade[a.severidade] = (porSeveridade[a.severidade] ?? 0) + 1;
    const resolvido =
      a.situacao === 'excecao-aprovada' ||
      (a.situacao === 'retestado' && a.reteste?.resultado === 'corrigido');
    if ((a.severidade === 'critica' || a.severidade === 'alta') && !resolvido) abertos++;
  }
  const concluido = m.situacao === 'concluido' || m.situacao === 'retestado';
  const semReteste = m.achados.some(
    (a) => (a.severidade === 'critica' || a.severidade === 'alta') && a.situacao === 'corrigido',
  );
  const motivo = !concluido
    ? 'pentest externo não concluído (sem o pentest, nenhuma onda começa)'
    : abertos > 0
      ? `${abertos} achado(s) crítico(s) ou alto(s) sem correção retestada nem exceção aprovada`
      : semReteste
        ? 'correção de achado crítico ou alto sem reteste'
        : 'sem achado crítico ou alto aberto; reteste registrado';
  return {
    situacao: m.situacao,
    abertosCriticosOuAltos: abertos,
    porSeveridade,
    reteste: m.data_reteste,
    bloqueiaLiberacao: !concluido || abertos > 0 || semReteste,
    motivo,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Roteiro de homologação por hospital

export interface OperacaoDoRoteiro {
  readonly nome: string;
  readonly estado: EstadoOperacao;
  readonly cenarios: readonly string[];
  readonly santeApi: boolean;
  readonly origens: readonly string[];
  readonly motivo: string;
  /** Grava no banco (tabelas_gravadas do catálogo): só então entra o cenário de colisão. */
  readonly escrita: boolean;
  /** Tabelas gravadas e a ação (`agendamento (INSERT)`), para a TI localizar o que abrir. */
  readonly tabelas?: readonly string[];
  /** O que a operação faz (descrição do catálogo): o que deve aparecer no outro sistema. */
  readonly descricao?: string;
}

/** Cenários a conferir: os do catálogo, mais colisão (só nas de escrita) e recusa, sem repetir. */
export function cenariosParaConferir(o: Pick<OperacaoDoRoteiro, 'cenarios' | 'escrita'>): string[] {
  return [...new Set([...o.cenarios, ...(o.escrita ? ['colisao'] : []), 'recusa'])];
}

/** Âncora do setor na seção "O que abrir no outro sistema, por setor" (como o GitHub gera do título). */
export const ancoraDoSetor = (s: Pick<DefinicaoSetor, 'nome' | 'onda'>): string =>
  `${s.nome} (onda ${s.onda})`
    .toLowerCase()
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

const celula = (s: string) => s.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();

/**
 * Descrição do catálogo no roteiro, lido por chave-usuários (ADR 0023): o catálogo é técnico e cita o outro sistema
 * pelo nome; aqui ele vira "o outro sistema".
 */
export const textoDeProduto = (s: string): string =>
  s.replace(/\bSPDATA\b/gi, 'outro sistema').replace(/\blegado\b/gi, 'outro sistema');

/** Setores (da prontidão) que usam a operação, na ordem das ondas. */
export function setoresDaOperacao(nome: string, todos: readonly string[]): DefinicaoSetor[] {
  return SETORES_PRONTIDAO.filter((s) => operacoesDoSetor(s, todos).includes(nome)).sort(
    (a, b) => a.onda - b.onda,
  );
}

export function ordenarParaConferencia<T extends { readonly nome: string; readonly santeApi: boolean }>(
  ops: readonly T[],
  todos: readonly string[],
): T[] {
  return [...ops].sort(
    (a, b) =>
      ondaDaOperacao(a.nome, todos) - ondaDaOperacao(b.nome, todos) ||
      Number(b.santeApi) - Number(a.santeApi) ||
      a.nome.localeCompare(b.nome),
  );
}

export function roteiroHomologacaoMarkdown(p: {
  readonly hospital: string;
  readonly versao: string;
  readonly bloqueio: string | null;
  readonly operacoes: readonly OperacaoDoRoteiro[];
  readonly fila: readonly { readonly operacao: string; readonly motivo: string }[];
}): string {
  const todos = p.operacoes.map((o) => o.nome);
  const ordenadas = ordenarParaConferencia(p.operacoes, todos);
  const linhas: string[] = [
    `# Roteiro de homologação: estabelecimento \`${p.hospital}\``,
    '',
    `Versão: ${p.versao}. Gerado por \`pnpm homologacao:roteiro -- --hospital=${p.hospital}\` (ficha do M36, entrega 1) a partir do catálogo de operações e dos pacotes de homologação por setor do M35 (\`docs/prontidao/homologacao/\`). Registro de cada conferência: \`docs/operacoes/conferencias/${p.hospital}/<operacao>.yaml\` (modelo em \`docs/operacoes/conferencias/README.md\`), revisado em PR pelo responsável técnico e conferido por \`pnpm conferencia:verificar\`.`,
    '',
  ];
  if (p.bloqueio)
    linhas.push(
      `> **Bloqueio:** ${p.bloqueio}. A ordem abaixo é a mesma que valerá aqui; nenhuma conferência começa antes de tudo pronto no ProntoCardio (DP-4).`,
      '',
    );
  linhas.push(
    '## Como conduzir cada conferência',
    '',
    '1. A TI confirma a cópia renovada e neutralizada (`pnpm ambiente:verificar` verde) e que a instalação do outro sistema de homologação aponta só para a cópia (regras 1 e 2); registra a impressão digital (`pnpm schema:verificar`).',
    '2. **Cenário controlado** (a referência): o chave-usuário executa a tarefa no outro sistema, sobre a cópia, enquanto `pnpm assinatura:capturar -- --operacao=<op> --cenario=<c> --trace` retrata antes e depois; o arquivo sai com `origem: cenario-controlado`. A TI confere a pasta do trace vazia ao fim (a ferramenta também confere e recusa se sobrar).',
    '3. **Reprodução**: `pnpm assinatura:testar -- --operacao=<op> --hospital=' +
      p.hospital +
      '` (o Sante SGH executa o mesmo cenário pelo executor); qualquer diferença não aceita é defeito.',
    '4. **Conferência na tela**: o chave-usuário executa a mesma tarefa no Sante SGH e abre o resultado no outro sistema, como na tabela do setor (seção final); confere também a **colisão** (alterar a linha no outro sistema depois que o novo a leu: o novo avisa e não sobrescreve) e a **recusa**.',
    '5. O registro de conferência vai em PR; o responsável técnico revisa; `pnpm conferencia:verificar` precisa ficar verde antes de o catálogo marcar `conferida`.',
    '6. O que o chave-usuário apontar vira item no `ESTADO.md` (Marco atual), volta à IA com o cenário que falhou e é reapresentado na rodada seguinte (regra 7).',
    '',
  );
  for (const r of RODADAS_CONFERENCIA) {
    const ops = ordenadas.filter((o) => ondaDaOperacao(o.nome, todos) === r.onda);
    if (ops.length === 0) continue;
    const escritas = ops.filter((o) => o.escrita);
    linhas.push(
      `## ${r.rotulo}`,
      '',
      `Quem confere: ${r.quem}. Operações: ${ops.length} (${ops.filter((o) => o.estado === 'verde').length} verdes, ${ops.filter((o) => o.estado === 'conferida').length} conferidas). Cenários por operação: os do catálogo, mais colisão (nas ${escritas.length} que gravam) e recusa. "O que deve aparecer" é o que a operação faz; "Abrir e onde" leva à tabela do setor (seção final) e às tabelas gravadas, que a TI usa para localizar o registro.`,
      '',
      '| # | Operação | Estado | Cenários a conferir | O que deve aparecer | Abrir e onde (setor; tabelas gravadas) | Referência atual | Observação |',
      '|---|---|---|---|---|---|---|---|',
      ...ops.map((o, i) => {
        const setores = setoresDaOperacao(o.nome, todos)
          .map((s) => (s.onda <= 4 ? `[${s.nome}](#${ancoraDoSetor(s)})` : s.nome))
          .join('; ');
        const onde = [setores, (o.tabelas ?? []).join(', ')].filter(Boolean).join('; ');
        const cen = cenariosParaConferir(o).join(', ');
        const obs = [
          o.santeApi ? 'primeira da fila (já gravada pela integração atual)' : '',
          celula(textoDeProduto(o.motivo)),
        ]
          .filter(Boolean)
          .join('; ');
        return `| ${i + 1} | \`${o.nome}\` | ${o.estado} | ${cen} | ${celula(textoDeProduto(o.descricao ?? '')) || '—'} | ${celula(onde) || '—'} | ${o.origens.join(', ') || '—'} | ${obs || '—'} |`;
      }),
      '',
    );
  }
  if (p.fila.length)
    linhas.push(
      '## Fila de cenários controlados herdada dos marcos',
      '',
      'Operações completas e desligadas (POL-3) que os marcos de origem mandaram provar com o cenário controlado; cada uma só sai de `especificada` com a captura no outro sistema e a reprodução sem diferença.',
      '',
      '| Operação | Motivo registrado |',
      '|---|---|',
      ...p.fila.map((f) => `| \`${f.operacao}\` | ${celula(textoDeProduto(f.motivo))} |`),
      '',
    );
  linhas.push(
    '## O que abrir no outro sistema, por setor',
    '',
    ...SETORES_PRONTIDAO.filter((s) => s.onda <= 4).flatMap((s) => [
      `### ${s.nome} (onda ${s.onda})`,
      '',
      '| O que abrir | Onde | O que deve aparecer |',
      '|---|---|---|',
      ...s.roteiro.map((r) => `| ${celula(r.abrir)} | ${celula(r.onde)} | ${celula(r.esperado)} |`),
      '',
    ]),
  );
  return linhas.join('\n');
}
