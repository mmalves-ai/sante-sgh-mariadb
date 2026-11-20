// Janela em produção do M58 por hospital (M58-F5; ficha, seções 5, 8 a 12): o roteiro de cada passo com os tempos dos
// ensaios da cópia, a avaliação da verificação depois da janela (o relatório `janela.json` gravado por
// `pnpm janela:verificar`) e a retirada da restrição de entrada (`entrada.utf8`). Puro: quem lê os arquivos e o banco
// é a API ou o comando; aqui só se decide. Falha fechada: checagem sem número é "não executada" e reprova.
import {
  BLOCO_JANELA_MIN,
  type ChecagemJanela,
  type ChecagemJanelaAvaliada,
  type AchadoJanela,
  type AmbienteVerificacaoJanela,
  type CharsetLegado,
  type EtapaRoteiro,
  type EtapaRoteiroJanela,
  type FaseRoteiroJanela,
  LATENCIA_MAXIMA_JANELA_MS,
  MARGEM_JANELA,
  type MotivoRetiradaRestricao,
  type PassoDesligamento,
  type ResponsavelJanela,
  type SituacaoRetirada,
  type TemposEnsaioJanela,
  type VerificacaoJanela,
  type VerificacaoJanelaAvaliada,
} from '@sgh/contratos';
import { compararContagens } from './ensaio-firebird5.js';
import { charsetConfere, charsetEsperado, versaoMaior } from './plataforma.js';

// ── Roteiro ─────────────────────────────────────────────────────────────────────────────────────────────

/** Minutos de uma etapa medida no ensaio, com a margem da janela (regra 4); null sem a medida. */
export function minutosDaEtapa(segundos: number | null): number | null {
  if (segundos === null || !Number.isFinite(segundos) || segundos < 0) return null;
  return Math.max(1, Math.ceil((segundos * MARGEM_JANELA) / 60));
}

type Linha = readonly [
  EtapaRoteiroJanela,
  FaseRoteiroJanela,
  ResponsavelJanela,
  string | null,
  number | null,
  boolean,
];

// Os comandos que a TI copia da tela: os mesmos argumentos que tools/schema-check/src/janela.ts aceita (o spec do
// comando passa cada um pelo mesmo leitor). As contagens "antes" ficam em .janela/<h>/<passo>/producao/, onde o
// verificar do mesmo passo e ambiente as procura. Os marcadores <...> a TI preenche na hora.
const VERIFICAR = (h: string, p: PassoDesligamento) =>
  `pnpm janela:verificar -- --hospital=${h} --passo=${p} --ambiente=producao` +
  ' --inicio=<hora da parada, ISO> --fim=<hora de agora, ISO> --operacoes=<checklist das chave-usuários>.yaml';
const CONTAR_ANTES = (h: string, p: PassoDesligamento) =>
  `pnpm janela:contagens -- --hospital=${h} --passo=${p} --ambiente=producao`;

function linhasDoPasso(p: PassoDesligamento, h: string, t: TemposEnsaioJanela): Linha[] {
  const avisos: Linha[] = [
    ['confirmar-autorizacao', 'antes', 'dono', null, null, true],
    ['avisar-parceiros', 'antes', 'ti', null, null, false],
    ['avisar-hal-ai', 'antes', 'hal-ai', null, null, true],
    ['treinar-contingencia', 'antes', 'coordenacao', null, null, false],
    ['parar-acesso', 'parada', 'ti', null, null, true],
    // Com o banco já sem escrita (parar-acesso) e logo antes do backup: as contagens são as do backup (ficha §5) e o
    // tempo delas entra na janela estimada.
    ['contar-antes', 'parada', 'ti', CONTAR_ANTES(h, p), minutosDaEtapa(t.contagensS), true],
  ];
  // As operações-chave (modo de verificação) vêm antes do verificar, que as recebe pelo --operacoes: a verificação
  // gravada já sai com o checklist (sem ele, a checagem fica não executada e reprova).
  const verificar = (seg: number | null): Linha[] => [
    ['operacoes-chave', 'verificacao', 'chave-usuarios', null, null, true],
    ['verificar', 'verificacao', 'ti', VERIFICAR(h, p), minutosDaEtapa(seg), true],
    ['reabrir', 'reabertura', 'ti', null, null, false],
    ['registrar-execucao', 'reabertura', 'ti', `docs/coexistencia/desligamento/${h}.yaml`, null, false],
  ];
  if (p === 'desligamento')
    return [
      ['confirmar-autorizacao', 'antes', 'dono', null, null, true],
      ['conferir-sessoes', 'antes', 'coordenacao', null, null, true],
      ['avisar-areas', 'antes', 'coordenacao', null, null, false],
      ['treinar-contingencia', 'antes', 'coordenacao', null, null, false],
      ['encerrar-sessoes', 'parada', 'ti', null, null, true],
      ['retirar-executaveis', 'execucao', 'ti', null, null, true],
      ['parar-servicos-fornecedor', 'execucao', 'ti', null, null, true],
      ['revogar-contas-fornecedor', 'execucao', 'ti', null, null, false],
      ...verificar(null),
      ['religar-contingencia', 'volta-atras', 'ti', null, null, false],
    ];
  if (p === 'firebird5')
    return [
      ...avisos,
      [
        'backup',
        'execucao',
        'ti',
        'gbak -b -g -v <banco> <backup da versão 3>',
        minutosDaEtapa(t.backupS),
        true,
      ],
      ['instalar-motor', 'execucao', 'ti', null, null, true],
      [
        'habilitar-funcoes-externas',
        'execucao',
        'ti',
        'UdfAccess = Restrict UDF (firebird.conf)',
        null,
        true,
      ],
      [
        'restaurar',
        'execucao',
        'ti',
        'gbak -c -v <backup da versão 3> <banco novo>',
        minutosDaEtapa(t.restauracaoS),
        true,
      ],
      ['integridade', 'execucao', 'ti', 'gfix -v -full <banco novo>', minutosDaEtapa(t.integridadeS), true],
      ...verificar(t.contagensS),
      [
        'restaurar-backup-anterior',
        'volta-atras',
        'ti',
        'gbak -c -v <backup da versão 3> <banco>',
        minutosDaEtapa(t.voltaAtrasS),
        false,
      ],
    ];
  return [
    ...avisos,
    [
      'backup',
      'execucao',
      'ti',
      'gbak -b -g -v <banco> <backup antes do UTF-8>',
      minutosDaEtapa(t.backupS),
      true,
    ],
    ['converter', 'execucao', 'ti', `converter.sh completo ${h}`, minutosDaEtapa(t.conversaoS), true],
    ['definir-charset', 'execucao', 'ti', 'Parâmetros: codificação do texto no banco = UTF8', null, true],
    ...verificar(t.equivalenciaS),
    ['retirar-restricao', 'reabertura', 'dono', 'entrada.utf8', null, false],
    [
      'restaurar-backup-anterior',
      'volta-atras',
      'ti',
      'gbak -c -v <backup antes do UTF-8> <banco>',
      minutosDaEtapa(t.restauracaoS),
      false,
    ],
  ];
}

/** O roteiro do passo no hospital, numerado na ordem (as fases já vêm na ordem de FASES_ROTEIRO_JANELA). */
export function montarRoteiroJanela(
  passo: PassoDesligamento,
  hospital: string,
  tempos: TemposEnsaioJanela,
): EtapaRoteiro[] {
  return linhasDoPasso(passo, hospital, tempos).map(
    ([etapa, fase, responsavel, comando, minutos, critica], i) => ({
      etapa,
      ordem: i + 1,
      fase,
      responsavel,
      comando,
      minutos,
      critica,
    }),
  );
}

/** As etapas medidas que a janela não pode estimar sem (o banco parado: backup, restauração, conversão). */
const ETAPAS_QUE_ESTIMAM: readonly EtapaRoteiroJanela[] = ['backup', 'restaurar', 'converter'];

/**
 * A janela estimada (da parada à reabertura), em blocos de 15 minutos; null quando o passo não para o banco
 * (desligamento) ou quando falta o tempo de uma etapa que a estima.
 */
export function estimarJanelaDoRoteiro(roteiro: readonly EtapaRoteiro[]): number | null {
  const dentro = roteiro.filter((e) => e.fase !== 'antes' && e.fase !== 'volta-atras');
  const medidas = dentro.filter((e) => ETAPAS_QUE_ESTIMAM.includes(e.etapa));
  if (medidas.length === 0 || medidas.some((e) => e.minutos === null)) return null;
  const total = dentro.reduce((s, e) => s + (e.minutos ?? 0), 0);
  return Math.max(BLOCO_JANELA_MIN, Math.ceil(total / BLOCO_JANELA_MIN) * BLOCO_JANELA_MIN);
}

/** A volta atrás estimada (regra 12), em minutos; null sem a medida. */
export function estimarVoltaAtras(roteiro: readonly EtapaRoteiro[]): number | null {
  const v = roteiro.filter((e) => e.fase === 'volta-atras' && e.minutos !== null);
  return v.length === 0 ? null : v.reduce((s, e) => s + (e.minutos ?? 0), 0);
}

// ── Verificação depois da janela ────────────────────────────────────────────────────────────────────────

/** As checagens que cada passo exige: o desligamento não para o banco (sem contagens). */
export const CHECAGENS_DO_PASSO: Readonly<Record<PassoDesligamento, readonly ChecagemJanela[]>> = {
  desligamento: ['plataforma', 'schema', 'saude', 'operacoes'],
  firebird5: ['plataforma', 'schema', 'contagens', 'saude', 'operacoes'],
  utf8: ['plataforma', 'schema', 'contagens', 'saude', 'operacoes'],
};

/** O motor e o charset do banco esperados depois de cada passo (o desligamento não muda a plataforma). */
export function plataformaAlvo(passo: PassoDesligamento): { versaoMaior: number | null; utf8: boolean } {
  if (passo === 'desligamento') return { versaoMaior: null, utf8: false };
  return { versaoMaior: 5, utf8: passo === 'utf8' };
}

/** Uma diferença de contagem que o próprio roteiro do passo produz: faixa de linhas a mais (max null: sem teto). */
export interface MudancaEsperadaJanela {
  readonly min: number;
  readonly max: number | null;
}

/**
 * D-ESPERADAS-F5-58: as tabelas que o roteiro do passo muda de propósito entre a contagem "antes" e o verificar, por
 * passo e com a faixa exata (lista explícita, nunca curinga). `SGH_CFG_PARAMETRO` no UTF-8: a etapa definir-charset
 * grava a linha vigente de `legado.charset` = UTF8 (uma a mais; a anterior só ganha o fim da vigência).
 * `SGH_TRILHA`: a trilha só cresce (o registro da troca do parâmetro, as entradas da TI e das chave-usuários nas
 * operações-chave); perder linha continua reprovando.
 */
export const MUDANCAS_ESPERADAS_JANELA: Readonly<
  Record<PassoDesligamento, Readonly<Record<string, MudancaEsperadaJanela>>>
> = {
  desligamento: {},
  firebird5: { SGH_TRILHA: { min: 0, max: null } },
  utf8: { SGH_CFG_PARAMETRO: { min: 1, max: 1 }, SGH_TRILHA: { min: 0, max: null } },
};

export function mudancaEsperada(passo: PassoDesligamento, tabela: string, delta: number): boolean {
  const f = Object.hasOwn(MUDANCAS_ESPERADAS_JANELA[passo], tabela)
    ? MUDANCAS_ESPERADAS_JANELA[passo][tabela]
    : undefined;
  return !!f && Number.isInteger(delta) && delta >= f.min && (f.max === null || delta <= f.max);
}

/** O antes contra o depois da janela: as diferenças esperadas do passo saem de `diferentes` para `esperadas`. */
export function compararContagensJanela(
  passo: PassoDesligamento,
  antes: Readonly<Record<string, number>>,
  depois: Readonly<Record<string, number>>,
): ReturnType<typeof compararContagens> & { esperadas: { tabela: string; delta: number }[] } {
  const c = compararContagens(antes, depois);
  const esperadas: { tabela: string; delta: number }[] = [];
  const diferentes: string[] = [];
  for (const t of c.diferentes) {
    const delta = (depois[t] ?? 0) - (antes[t] ?? 0);
    if (mudancaEsperada(passo, t, delta)) esperadas.push({ tabela: t, delta });
    else diferentes.push(t);
  }
  return { ...c, diferentes, esperadas };
}

function achadosDe(v: VerificacaoJanela, c: ChecagemJanela): AchadoJanela[] | null {
  switch (c) {
    case 'plataforma': {
      const p = v.plataforma;
      if (!p) return null;
      const a: AchadoJanela[] = [];
      const alvo = plataformaAlvo(v.passo);
      let maior: number;
      try {
        maior = versaoMaior(p.versaoMotor);
      } catch {
        maior = 0;
      }
      if (alvo.versaoMaior !== null ? maior !== alvo.versaoMaior : maior === 0)
        a.push('motor-diferente-do-alvo');
      if ((charsetEsperado(p.charsetBanco) === 'UTF8') !== alvo.utf8) a.push('charset-diferente-do-alvo');
      if (!charsetConfere(p.charsetBanco, p.charsetParametro)) a.push('charset-desencontrado');
      return a;
    }
    case 'schema': {
      const s = v.schema;
      if (!s) return null;
      if (!s.esperada) return ['sem-impressao-homologada'];
      return s.obtida !== s.esperada || s.diferencas > 0 ? ['impressao-diferente'] : [];
    }
    case 'contagens': {
      const k = v.contagens;
      if (!k) return null;
      if (!k.hashAntes || k.tabelas === 0) return ['sem-contagem-antes'];
      const a: AchadoJanela[] = [];
      // As esperadas são reconferidas aqui pela faixa do passo (o arquivo não decide sozinho); com nenhuma, o resumo
      // do antes tem de ser o do depois.
      const esp = k.esperadas;
      const espOk =
        new Set(esp.map((e) => e.tabela)).size === esp.length &&
        esp.every((e) => mudancaEsperada(v.passo, e.tabela, e.delta));
      if (
        !espOk ||
        k.diferentes.length > 0 ||
        (esp.length === 0 && k.hashAntes !== k.hashDepois) ||
        k.iguais + k.ausentes.length + esp.length < k.tabelas
      )
        a.push('contagens-diferentes');
      if (k.ausentes.length > 0) a.push('tabelas-ausentes');
      return a;
    }
    case 'saude': {
      const s = v.saude;
      if (!s) return null;
      if (!s.conectou) return ['conexao-falhou'];
      const a: AchadoJanela[] = [];
      if (s.latenciaMs === null || s.latenciaMs > LATENCIA_MAXIMA_JANELA_MS) a.push('latencia-alta');
      if (!s.codecConfere) a.push('codec-desencontrado');
      return a;
    }
    case 'operacoes': {
      const o = v.operacoes;
      if (!o) return null;
      if (o.total === 0) return ['sem-operacoes'];
      return o.falhas.length > 0 || o.verdes < o.total ? ['operacoes-com-falha'] : [];
    }
  }
}

/** Cada checagem exigida pelo passo, reavaliada pelos números do relatório (a situação nunca é escrita à mão). */
export function avaliarChecagensJanela(v: VerificacaoJanela): ChecagemJanelaAvaliada[] {
  return CHECAGENS_DO_PASSO[v.passo].map((checagem) => {
    const a = achadosDe(v, checagem);
    if (a === null) return { checagem, situacao: 'nao-executada', achados: ['nao-executada'] };
    return { checagem, situacao: a.length === 0 ? 'aprovada' : 'reprovada', achados: a };
  });
}

const minutosEntre = (inicio: string | null, fim: string | null): number | null => {
  if (!inicio || !fim) return null;
  const d = (Date.parse(fim) - Date.parse(inicio)) / 60_000;
  return Number.isFinite(d) && d >= 0 ? Math.round(d) : null;
};

export function avaliarVerificacaoJanela(v: VerificacaoJanela): VerificacaoJanelaAvaliada {
  const checagens = avaliarChecagensJanela(v);
  return {
    ambiente: v.ambiente,
    em: v.em,
    inicio: v.inicio,
    fim: v.fim,
    duracaoMinutos: minutosEntre(v.inicio, v.fim),
    checagens,
    aprovada: checagens.every((c) => c.situacao === 'aprovada'),
    numeros: {
      tabelas: v.contagens?.tabelas ?? 0,
      tabelasIguais: v.contagens?.iguais ?? 0,
      operacoes: v.operacoes?.total ?? 0,
      operacoesVerdes: v.operacoes?.verdes ?? 0,
      latenciaMs: v.saude?.latenciaMs ?? null,
    },
    versaoMotor: v.plataforma?.versaoMotor ?? null,
    charsetBanco: v.plataforma?.charsetBanco ?? null,
  };
}

/** A verificação vigente do passo no ambiente: a mais recente (as anteriores ficam no histórico do arquivo). */
export function verificacaoVigente(
  verificacoes: readonly VerificacaoJanela[],
  passo: PassoDesligamento,
  ambiente: AmbienteVerificacaoJanela,
): VerificacaoJanela | null {
  let r: VerificacaoJanela | null = null;
  for (const v of verificacoes)
    if (v.passo === passo && v.ambiente === ambiente && (!r || v.em >= r.em)) r = v;
  return r;
}

// ── Retirada da restrição de entrada (regra 6) ──────────────────────────────────────────────────────────

export interface EstadoRetirada {
  /** O registro versionado dos passos é válido (inválido: nada conta; falha fechada). */
  readonly registroValido: boolean;
  readonly utf8Autorizado: boolean;
  readonly utf8Executado: boolean;
  /** A verificação na PRODUÇÃO depois da janela do UTF-8: null se ausente. O ensaio na cópia não libera. */
  readonly verificacaoProducaoAprovada: boolean | null;
  readonly charsetBanco: string;
  readonly charsetParametro: CharsetLegado;
  readonly chaveLigada: boolean;
}

/** O que falta para ligar `entrada.utf8` (vazio: pode ligar). */
export function motivosRetiradaRestricao(e: EstadoRetirada): MotivoRetiradaRestricao[] {
  const m: MotivoRetiradaRestricao[] = [];
  if (!e.registroValido) m.push('registro-invalido');
  if (!e.utf8Autorizado) m.push('utf8-nao-autorizado');
  if (!e.utf8Executado) m.push('utf8-nao-executado');
  if (e.verificacaoProducaoAprovada === null) m.push('verificacao-ausente');
  else if (!e.verificacaoProducaoAprovada) m.push('verificacao-reprovada');
  if (charsetEsperado(e.charsetBanco) !== 'UTF8') m.push('banco-nao-utf8');
  if (e.charsetParametro !== 'UTF8') m.push('parametro-nao-utf8');
  return m;
}

/**
 * A situação da restrição: `retirada` só quando a chave está ligada E tudo o que a sustenta continua de pé (o codec
 * ignora a chave com o banco ou o parâmetro fora do UTF-8: restricaoEntrada); `pode-retirar` quando nada falta.
 */
export function avaliarRetiradaRestricao(e: EstadoRetirada): {
  situacao: SituacaoRetirada;
  motivos: MotivoRetiradaRestricao[];
} {
  const motivos = motivosRetiradaRestricao(e);
  if (motivos.length > 0) return { situacao: 'restrita', motivos };
  return { situacao: e.chaveLigada ? 'retirada' : 'pode-retirar', motivos };
}
