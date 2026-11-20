// Reprodução dos cenários de assinatura do registro clínico (M22; ficha, seção 9) pelo EXECUTOR, na transação da
// captura (sempre desfeita). O registro é de um PROFISSIONAL da cópia (o executor confere que o usuário da sessão é
// o dono do CBO ativo; login e CBO só em memória, nunca impressos), num atendimento existente (paciente e retratos
// vigentes só por ID, em memória). As respostas são SINTÉTICAS (marca "SINTETICO M22", gravador do domínio), sobre a
// representação do modelo convertida na hora pelo parser do M09, exatamente como a API monta: linhas, texto
// formatado, formulário, documento e prova. Nenhum dado de pessoa sai daqui.
import { condicaoLoginDoProfissional } from '@sgh/legado';
import type { RespostaRegistro } from '@sgh/contratos';
import { PROTOCOLO_SINTETICO, mapaDoModeloE08, respostasE08 } from '@sgh/dominio-recepcao';
import type { CorRisco } from '@sgh/contratos';
import {
  type CabecalhoDocumento,
  camposParaRegistro,
  converterModelo,
  hashDoConteudo,
  montarRegistro,
  type RepresentacaoFormulario,
  respostasSinteticas,
} from '@sgh/dominio-pep';
import {
  agoraDoBanco,
  type CabecalhoDocumentoLido,
  cabecalhoDocumento,
  type CenarioCaptura,
  dataHoraLocal,
  ErroOperacao,
  type Escritor,
  type GravacaoEvolucao,
  type GravacaoRascunho,
  lerDefinicaoFormulario,
  listarModelosFormulario,
  MARCADOR_REGISTRO,
  opcoesPrioridadeVistasE08,
  perguntaPrioridadeE08,
  retratosAtuais,
  seloDoModelo,
  SITUACAO_LANCADO,
  SITUACAO_SUSPENSO,
  versaoRascunho,
} from '@sgh/legado';

type Executar = (e: Escritor, entrada: unknown) => Promise<{ resultado: Record<string, unknown> }>;
type ExecutarOutra = (
  e: Escritor,
  nome: string,
  entrada: unknown,
  operador: string,
) => Promise<{ resultado: Record<string, unknown> }>;

export const OPERACOES_REPRODUCAO_PEP = new Set([
  'pep.registrarEvolucao',
  'pep.salvarRascunho',
  'pep.descartarRascunho',
  'pep.suspenderEvolucao',
]);

/** Modelo de cada cenário (os 10 de maior uso do escopo mínimo). */
const MODELO_DO_CENARIO: Readonly<Record<string, string>> = {
  enf091: 'ENF091',
  evam: 'EVAM',
  m12: 'M12',
  enf03: 'ENF03',
  enf0411: 'ENF0411',
  enf041: 'ENF041',
  fisiuti: 'FISIUTI',
  m9: 'M9',
  e08: 'E08',
  m10: 'M10',
  componentes: 'ENF03',
  alergia: 'E08',
  correcao: 'EVAM',
};
/** Tipos de pergunta do cenário "componentes": grade, unidade e lista marcada. */
const TIPOS_COMPONENTES = new Set(['9', '6', '7', '12']);

async function exigirRecusa(p: Promise<unknown>, codigo: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    if (e instanceof ErroOperacao && e.problema.codigo === codigo) return;
    throw e;
  }
  throw new Error(`Cenário de recusa: esperava ${codigo}, a operação gravou.`);
}

export interface ModeloPronto {
  readonly id: number;
  readonly rep: RepresentacaoFormulario;
  readonly selo: string;
  readonly versaoLayout: number | null;
  readonly codigo: string;
  readonly tipoComposicao: number;
  readonly nomeTipoComposicao: string;
  readonly descricao: string;
}

export async function modeloPronto(e: Escritor, codigo: string): Promise<ModeloPronto> {
  const m = (await listarModelosFormulario(e)).find((x) => x.codigo === codigo);
  if (!m) throw new Error(`Modelo ${codigo} não está na cópia.`);
  const def = await lerDefinicaoFormulario(e, m);
  const rep = await converterModelo(def);
  const [t] = await e.consultar(
    `SELECT e.ID_PRTPCOMP T, c.NOME N, e.DESCRICAO D FROM PREVOLUCAO e LEFT JOIN PRTPCOMP c ON c.ID = e.ID_PRTPCOMP
      WHERE e.ID_EVOLUCAO = ?`,
    [m.id],
    { teto: 1 },
  );
  const versoes = def.versoes.map((v) => v.versao);
  return {
    id: m.id,
    rep,
    selo: await seloDoModelo(e, m.id),
    versaoLayout: versoes.length ? Math.max(...versoes) : null,
    codigo,
    tipoComposicao: Number(t?.['T'] ?? 2),
    nomeTipoComposicao: String(t?.['N'] ?? 'Evolução').trim(),
    descricao: String(t?.['D'] ?? '').trim(),
  };
}

export interface Profissional {
  readonly login: string;
  readonly cbo: number;
}

/** Profissional da cópia com CBO ativo e com o modelo permitido à especialidade (só em memória). */
export async function profissional(
  e: Escritor,
  modelo: number,
  exceto: Profissional | null = null,
): Promise<Profissional> {
  const ls = await e.consultar(
    `SELECT FIRST 20 r.ID CBO, u.NOME LOGIN FROM TBCBOPRO r JOIN TBPROFIS p ON p.ID = r.ID_TBPROFIS
       JOIN TBUSERS u ON ${condicaoLoginDoProfissional('p').replace(/\?/g, 'u.NOME')}
      WHERE COALESCE(r.ATIVO, 'T') <> 'F'
        AND (NOT EXISTS (SELECT 1 FROM PREVOLESPEC x WHERE x.ID_EVOLUCAO = ?)
             OR EXISTS (SELECT 1 FROM PREVOLESPEC x JOIN TBCBOSUS_TBESPEC s ON s.ID_TBESPEC = x.ESPEC
                         WHERE x.ID_EVOLUCAO = ? AND s.ID_TBCBOSUS = r.ID_TBCBOSUS))
      ORDER BY r.ID DESC`,
    [modelo, modelo],
    { teto: 20 },
  );
  // O login identifica um só profissional (o executor confere TBUSERS.NOME → TBPROFIS → TBCBOPRO).
  for (const l of ls) {
    const p = { login: String(l['LOGIN']).trim(), cbo: Number(l['CBO']) };
    if (exceto && (p.login === exceto.login || p.cbo === exceto.cbo)) continue;
    const [n] = await e.consultar('SELECT COUNT(*) N FROM TBUSERS WHERE NOME = ?', [p.login], { teto: 1 });
    if (Number(n?.['N']) === 1) return p;
  }
  throw new Error('Nenhum profissional com CBO ativo para o modelo na cópia.');
}

/**
 * Modelo do escopo com especialidade (PREVOLESPEC) e um profissional da cópia cujo CBO NÃO é dessa especialidade
 * (o cenário de recusa "modelo não permitido"; login e CBO só em memória).
 */
export async function profissionalSemPermissao(e: Escritor): Promise<{ codigo: string; prof: Profissional }> {
  const codigos = [...new Set(Object.values(MODELO_DO_CENARIO))];
  const ls = await e.consultar(
    `SELECT FIRST 20 m.COD, r.ID CBO, u.NOME LOGIN FROM PREVOLUCAO m
       JOIN TBCBOPRO r ON COALESCE(r.ATIVO, 'T') <> 'F'
       JOIN TBPROFIS p ON p.ID = r.ID_TBPROFIS JOIN TBUSERS u ON ${condicaoLoginDoProfissional('p').replace(/\?/g, 'u.NOME')}
      WHERE m.COD IN (${codigos.map(() => '?').join(', ')})
        AND EXISTS (SELECT 1 FROM PREVOLESPEC x WHERE x.ID_EVOLUCAO = m.ID_EVOLUCAO)
        AND NOT EXISTS (SELECT 1 FROM PREVOLESPEC x JOIN TBCBOSUS_TBESPEC s ON s.ID_TBESPEC = x.ESPEC
                         WHERE x.ID_EVOLUCAO = m.ID_EVOLUCAO AND s.ID_TBCBOSUS = r.ID_TBCBOSUS)
      ORDER BY r.ID DESC`,
    codigos,
    { teto: 20 },
  );
  for (const l of ls) {
    const prof = { login: String(l['LOGIN']).trim(), cbo: Number(l['CBO']) };
    const [n] = await e.consultar('SELECT COUNT(*) N FROM TBUSERS WHERE NOME = ?', [prof.login], { teto: 1 });
    if (Number(n?.['N']) === 1) return { codigo: String(l['COD']).trim(), prof };
  }
  throw new Error('Nenhum modelo com especialidade e profissional de outra especialidade na cópia.');
}

/**
 * Rascunho começado no OUTRO sistema: o cabeçalho incluído direto (como o executável grava), sem a marca de origem
 * do novo (SGH_PEP_RASCUNHO). Só na transação da captura (desfeita).
 */
export async function rascunhoDoOutroSistema(
  e: Escritor,
  m: ModeloPronto,
  prof: Profissional,
  at: Atendimento,
): Promise<{ id: number; versao: string }> {
  const clinica = await horarioClinico(e);
  const utc = UTC(clinica);
  const r = await e.executarRetornando(
    `INSERT INTO PRCABEVOLTMP (ID_HTATENDIMENTO, ID_HTPACIENTE, ID_EVOLUCAO, DATA_HORA_EVOLUCAO, ID_TBCBOPRO_EVOLUCAO,
       HORARIO_VERAO_EVOLUCAO, DATA_HORA_LANCAMENTO, HORARIO_VERAO_LANCAMENTO, PRE_IMPRESSO, FUSO_HORARIO_LANCAMENTO,
       FUSO_HORARIO_EVOLUCAO, DATA_HORA_EVOLUCAO_UTC, DATA_HORA_LANCAMENTO_UTC)
     VALUES (?, ?, ?, ?, ?, 'F', CURRENT_TIMESTAMP, 'F', 'F', -3, -3, ?, ?) RETURNING ID_CABEVOL`,
    [at.retratos.htAtendimento, at.retratos.htPaciente, m.id, dataHoraLocal(clinica), prof.cbo, utc, utc],
  );
  const id = Number(r['ID_CABEVOL']);
  return { id, versao: await versaoRascunho(e, id) };
}

export interface Atendimento {
  readonly id: number;
  readonly paciente: number;
  readonly retratos: { readonly htAtendimento: number; readonly htPaciente: number };
}

/** Atendimento existente (internação ou externo) com os retratos vigentes (só IDs, em memória). */
export async function atendimento(e: Escritor, tipo: 'I' | 'E'): Promise<Atendimento> {
  const ls = await e.consultar(
    `SELECT FIRST 5 a.ID, a.ID_RICADPAC P FROM ATCABECATEND a
      WHERE a.TP_ATENDIMENTO = ? AND EXISTS (SELECT 1 FROM HTATENDIMENTO h WHERE h.ID_ATCABECATEND = a.ID)
        AND EXISTS (SELECT 1 FROM HTPACIENTE h WHERE h.ID_RICADPAC = a.ID_RICADPAC)
      ORDER BY a.ID DESC`,
    [tipo],
    { teto: 5 },
  );
  for (const l of ls) {
    const id = Number(l['ID']);
    const paciente = Number(l['P']);
    const r = await retratosAtuais(e, id, paciente);
    if (r?.doPaciente)
      return { id, paciente, retratos: { htAtendimento: r.htAtendimento, htPaciente: r.htPaciente } };
  }
  throw new Error(`Nenhum atendimento ${tipo} com retratos na cópia.`);
}

const p2 = (n: number) => String(n).padStart(2, '0');
/** Horário clínico local "AAAA-MM-DDTHH:MM", N minutos antes do relógio do banco (dentro da tolerância). */
export async function horarioClinico(e: Escritor, minutosAntes = 2): Promise<string> {
  const d = new Date((await agoraDoBanco(e)).getTime() - minutosAntes * 60_000);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

const UTC = (local: string) => `${local.length === 16 ? `${local}:00` : local.slice(0, 19)}.0000-03:00`;

export function documentoDe(cab: CabecalhoDocumentoLido, evento: string): CabecalhoDocumento {
  return {
    hospital: cab.hospital,
    paciente: cab.paciente,
    atendimento: cab.atendimento,
    lancamento: [
      ['id_tabela_origem', MARCADOR_REGISTRO],
      ['tipo_assinatura', cab.tipoAssinatura],
      ['situacao_documento', cab.situacao],
      ['data_hora_evento', UTC(evento)],
      ['profissional_evento', cab.profissional],
    ],
  };
}

export const formModelo = (m: ModeloPronto) => ({
  modelo: m.id,
  tipoComposicao: m.tipoComposicao,
  nomeTipoComposicao: m.nomeTipoComposicao,
  descricaoModelo: m.descricao,
});

/** A entrada da finalização como a API monta (gravador do domínio; marcador no lugar do ID do registro). */
export async function gravacaoEvolucao(
  e: Escritor,
  hospital: string,
  m: ModeloPronto,
  prof: Profissional,
  at: Atendimento,
  respostas: readonly RespostaRegistro[],
  extra: {
    rascunho?: { id: number; versao: string };
    justificativaRetroativo?: string;
    corrige?: number;
  } = {},
): Promise<GravacaoEvolucao> {
  const dataHoraClinica = await horarioClinico(e);
  const montado = montarRegistro(m.rep, respostas, formModelo(m), { exigirConfirmacao: true });
  const cab = await cabecalhoDocumento(e, at.retratos, prof.cbo, SITUACAO_LANCADO);
  const documento = montado
    .documento(Number.NaN, documentoDe(cab, dataHoraClinica))
    .replace('<id_prcabevol>NaN</id_prcabevol>', `<id_prcabevol>${MARCADOR_REGISTRO}</id_prcabevol>`);
  return {
    paciente: at.paciente,
    modelo: m.id,
    atendimento: at.id,
    cbo: prof.cbo,
    dataHoraClinica,
    ...(extra.justificativaRetroativo ? { justificativaRetroativo: extra.justificativaRetroativo } : {}),
    toleranciaMin: 15,
    retratos: at.retratos,
    linhas: montado.linhas.map((l) => ({ ...l })),
    rtf: montado.rtf,
    xml: montado.xml(Number.NaN).replace('id_prcabevol="NaN"', `id_prcabevol="${MARCADOR_REGISTRO}"`),
    documento,
    ...(extra.rascunho ? { rascunho: extra.rascunho } : {}),
    ...(extra.corrige ? { corrige: extra.corrige } : {}),
    hashConteudo: await hashDoConteudo({
      estabelecimento: hospital,
      registro: 0,
      modelo: m.id,
      paciente: at.paciente,
      atendimento: at.id,
      dataHoraClinica,
      impressao: m.rep.impressaoLayout,
      respostas,
    }),
    representacao: {
      impressao: m.rep.impressaoLayout,
      selo: m.selo,
      codigo: m.codigo,
      versaoLayout: m.versaoLayout,
      representacao: m.rep,
    },
  };
}

export async function gravacaoRascunho(
  e: Escritor,
  m: ModeloPronto,
  prof: Profissional,
  at: Atendimento,
  respostas: readonly RespostaRegistro[],
  rascunho?: { id: number; versao: string },
  minutosAntes = 2,
): Promise<GravacaoRascunho> {
  const montado = montarRegistro(m.rep, respostas, formModelo(m));
  return {
    paciente: at.paciente,
    modelo: m.id,
    atendimento: at.id,
    cbo: prof.cbo,
    dataHoraClinica: await horarioClinico(e, minutosAntes),
    retratos: at.retratos,
    linhas: montado.linhas.map((l) => ({ ...l })),
    ...(rascunho ? { rascunho } : {}),
  };
}

const rascunhoDe = (r: { resultado: Record<string, unknown> }) => ({
  id: Number(r.resultado['rascunho']),
  versao: String(r.resultado['versao']),
});

/** A entrada da suspensão como a API monta (o documento na situação "Suspenso"). */
export async function suspensaoDe(
  e: Escritor,
  m: ModeloPronto,
  prof: Profissional,
  at: Atendimento,
  respostas: readonly RespostaRegistro[],
  registro: number,
) {
  const montado = montarRegistro(m.rep, respostas, formModelo(m));
  const cab = await cabecalhoDocumento(e, at.retratos, prof.cbo, SITUACAO_SUSPENSO);
  const evento = await horarioClinico(e, 0);
  const documento = montado
    .documento(Number.NaN, documentoDe(cab, evento))
    .replace('<id_prcabevol>NaN</id_prcabevol>', `<id_prcabevol>${MARCADOR_REGISTRO}</id_prcabevol>`);
  return {
    registro,
    cbo: prof.cbo,
    justificativa: 'Registro SINTETICO M22 no paciente errado',
    documento,
  };
}

// ── M44: o formulário de classificação (E08) preenchido pela classificação de risco ──────────────────────

/** Cor de cada cenário `e08-*` (prioridade-N: a N-ésima cor; completo e sem glicemia: amarelo). */
const COR_DO_CENARIO_E08: Readonly<Record<string, CorRisco>> = {
  'e08-completo': 'amarelo',
  'e08-sem-glicemia': 'amarelo',
  'e08-prioridade-1': 'vermelho',
  'e08-prioridade-2': 'laranja',
  'e08-prioridade-3': 'amarelo',
  'e08-prioridade-4': 'verde',
  'e08-prioridade-5': 'azul',
  'e08-recusa-opcao': 'laranja',
};

/**
 * As respostas do E08 como a classificação monta (motor do M44 sobre o modelo convertido da cópia, de-para do
 * protocolo sintético, só índices vistos no perfil), com sinais e queixa SINTÉTICOS. Devolve também os IDs das
 * opções de "Prioridade clínica" (o cenário de recusa troca uma delas por uma resposta de fora do modelo).
 */
export async function respostasDaClassificacao(
  e: Escritor,
  m: ModeloPronto,
  cenario: string,
): Promise<{ respostas: RespostaRegistro[]; comPrioridade: boolean; idsPrioridade: Set<number> }> {
  const pergunta = await perguntaPrioridadeE08(e);
  if (pergunta === null) throw new Error('Modelo E08 sem a pergunta "Prioridade clínica" ativa na cópia.');
  const vistas = await opcoesPrioridadeVistasE08(e, pergunta);
  const indices = new Set(vistas.map((v) => v.indice).filter((i): i is number => i !== null));
  const { mapa, faltam } = mapaDoModeloE08(camposParaRegistro(m.rep));
  const cor = COR_DO_CENARIO_E08[cenario] ?? 'amarelo';
  const r = respostasE08(
    {
      cor,
      cores: PROTOCOLO_SINTETICO.cores,
      sinais: {
        pas: 128,
        pad: 82,
        fc: 96,
        fr: 18,
        temperatura: 37.4,
        saturacao: 97,
        glicemia: cenario === 'e08-sem-glicemia' ? null : 112,
        dor: 6,
        glasgow: 15,
      },
      queixa: 'Queixa SINTETICO M44: dor no peito há duas horas',
      observacoes: cenario === 'e08-completo' ? 'Observação SINTETICO M44 (ação, atenção)' : null,
      alergia: cenario === 'e08-completo' ? 'nao' : null,
      comorbidades: cenario === 'e08-completo' ? ['has'] : [],
    },
    mapa,
    indices,
    faltam,
  );
  if (r.situacao !== 'respostas')
    throw new Error(`Modelo E08 diferente na cópia (faltam ${r.faltam.join(', ')}).`);
  return {
    respostas: r.respostas,
    comPrioridade: r.comPrioridade,
    idsPrioridade: new Set(vistas.map((v) => v.idResposta)),
  };
}

/** Uma resposta cadastrada que NÃO é do modelo (a "opção nunca vista" do cenário de recusa). */
async function respostaDeOutroModelo(e: Escritor, modelo: number): Promise<number> {
  const [x] = await e.consultar(
    `SELECT FIRST 1 r.ID_RESPOSTA FROM PRRESPOSTA r
      WHERE r.ID_PRPERGUNTA NOT IN (SELECT v.ID_PRPERGUNTA FROM PRPADEVOL v WHERE v.ID_EVOLUCAO = ?)
      ORDER BY r.ID_RESPOSTA DESC`,
    [modelo],
    { teto: 1 },
  );
  if (!x) throw new Error('Nenhuma resposta fora do modelo E08 na cópia.');
  return Number(x['ID_RESPOSTA']);
}

/** A linha da classificação que acompanha o registro (SGH_PA_CLASSIFICACAO na mesma transação). */
export function classificacaoDoCenario(at: Atendimento, cenario: string, comPrioridade: boolean) {
  const cor = COR_DO_CENARIO_E08[cenario] ?? 'amarelo';
  return {
    cabecalho: String(at.id),
    reg: at.id,
    versaoProtocolo: 1,
    fluxograma: 'dor-toracica',
    discriminadores: [],
    automaticos: [],
    sinais: {
      pas: 128,
      pad: 82,
      fc: 96,
      fr: 18,
      temperatura: 37.4,
      saturacao: 97,
      glicemia: cenario === 'e08-sem-glicemia' ? null : 112,
      dor: 6,
      glasgow: 15,
    },
    corProposta: cor,
    corFinal: cor,
    justificativa: null,
    motivo: 'inicial' as const,
    descricaoMudanca: null,
    anterior: null,
    tempoAlvoMin: PROTOCOLO_SINTETICO.cores.find((c) => c.cor === cor)?.tempoAlvoMin ?? 60,
    comPrioridade,
  };
}

/**
 * Cenário de captura de uma operação do registro clínico. `definirOperador` põe o login do profissional como
 * usuário da sessão do cenário (o executor confere que ele é o dono do CBO).
 */
export function cenarioPep(
  nome: string,
  cenario: string,
  base: Pick<CenarioCaptura, 'operacao' | 'cenario' | 'tabelas'>,
  hospital: string,
  executar: Executar,
  executarOutra: ExecutarOutra,
  definirOperador: (login: string) => void,
): CenarioCaptura {
  let entrada: unknown = null;
  let recusaEsperada: string | null = null;
  // Chaves-alvo nas tabelas grandes que a operação altera ou apaga (pedidas antes e depois da execução).
  let rascunho: number | null = null;
  let registro: number | null = null;
  const alvo = (coluna: string, id: number | null) => (id === null ? [] : [{ [coluna]: id }]);
  const rodar = async (e: Escritor) => {
    if (recusaEsperada) return exigirRecusa(executar(e, entrada), recusaEsperada);
    const r = await executar(e, entrada);
    if (r.resultado['rascunho'] !== undefined) rascunho = Number(r.resultado['rascunho']);
    if (r.resultado['registro'] !== undefined) registro = Number(r.resultado['registro']);
  };
  const e08 = cenario.startsWith('e08-');
  const codigo = e08 ? 'E08' : (MODELO_DO_CENARIO[cenario] ?? 'EVAM');
  const preparar = async (e: Escritor) => {
    const m = await modeloPronto(e, codigo);
    const prof = await profissional(e, m.id);
    const at = await atendimento(e, cenario === 'externo' || e08 ? 'E' : 'I');
    definirOperador(prof.login);
    return { m, prof, at };
  };
  if (nome === 'pep.registrarEvolucao') {
    return {
      ...base,
      chavesAlvo: () => ({ PRCABEVOLTMP: alvo('ID_CABEVOL', rascunho) }),
      async preparar(e) {
        const { m, prof, at } = await preparar(e);
        let respostas = respostasSinteticas(
          m.rep,
          cenario === 'componentes' ? { tipos: TIPOS_COMPONENTES } : {},
        );
        if (cenario === 'pre-preenchido')
          respostas = respostas.map((r) => ({ ...r, autopreenchido: true, confirmado: true }));
        if (e08) {
          // M44: o formulário de classificação pela classificação de risco, com a linha SGH_ na mesma transação.
          const c = await respostasDaClassificacao(e, m, cenario);
          const g = await gravacaoEvolucao(e, hospital, m, prof, at, c.respostas);
          if (cenario === 'e08-recusa-opcao') {
            const fora = await respostaDeOutroModelo(e, m.id);
            recusaEsperada = 'resposta-fora-do-modelo';
            entrada = {
              ...g,
              linhas: g.linhas.map((l) =>
                c.idsPrioridade.has(l.idResposta) ? { ...l, idResposta: fora, indice: '6' } : l,
              ),
              classificacao: classificacaoDoCenario(at, cenario, false),
            };
          } else entrada = { ...g, classificacao: classificacaoDoCenario(at, cenario, c.comPrioridade) };
        } else if (cenario === 'de-rascunho') {
          const rasc = await executarOutra(
            e,
            'pep.salvarRascunho',
            await gravacaoRascunho(e, m, prof, at, respostas.slice(0, 1)),
            prof.login,
          );
          const r = rascunhoDe(rasc);
          rascunho = r.id;
          entrada = await gravacaoEvolucao(e, hospital, m, prof, at, respostas, { rascunho: r });
        } else if (cenario === 'recusa') {
          recusaEsperada = 'entrada-invalida';
          entrada = await gravacaoEvolucao(e, hospital, m, prof, at, respostas, {
            justificativaRetroativo: 'Registro SINTETICO \u{1F600} fora do CP1252',
          });
        } else if (cenario === 'recusa-modelo') {
          // Modelo com especialidade e um profissional de outra especialidade: modelo não permitido.
          const fora = await profissionalSemPermissao(e);
          const mf = await modeloPronto(e, fora.codigo);
          definirOperador(fora.prof.login);
          recusaEsperada = 'modelo-nao-permitido';
          entrada = await gravacaoEvolucao(e, hospital, mf, fora.prof, at, respostasSinteticas(mf.rep));
        } else if (cenario === 'correcao') {
          // O original registrado e suspenso pelo autor; a correção, ligada a ele.
          const g = await executarOutra(
            e,
            'pep.registrarEvolucao',
            await gravacaoEvolucao(e, hospital, m, prof, at, respostas),
            prof.login,
          );
          const original = Number(g.resultado['registro']);
          await executarOutra(
            e,
            'pep.suspenderEvolucao',
            await suspensaoDe(e, m, prof, at, respostas, original),
            prof.login,
          );
          entrada = await gravacaoEvolucao(e, hospital, m, prof, at, respostas, { corrige: original });
        } else entrada = await gravacaoEvolucao(e, hospital, m, prof, at, respostas);
      },
      executar: rodar,
    };
  }
  if (nome === 'pep.salvarRascunho') {
    return {
      ...base,
      chavesAlvo: () => ({
        PRCABEVOLTMP: alvo('ID_CABEVOL', rascunho),
        PREVOLPACTMP: alvo('ID_CABEVOL', rascunho),
      }),
      async preparar(e) {
        const { m, prof, at } = await preparar(e);
        const todas = respostasSinteticas(m.rep);
        if (cenario === 'novo') entrada = await gravacaoRascunho(e, m, prof, at, todas.slice(0, 2));
        else if (cenario === 'alergia') entrada = await gravacaoRascunho(e, m, prof, at, todas);
        else if (cenario === 'recusa-outro-sistema') {
          // Começado no outro sistema (sem a marca de origem): o novo não salva sobre ele.
          const r = await rascunhoDoOutroSistema(e, m, prof, at);
          rascunho = r.id;
          recusaEsperada = 'rascunho-de-outro-sistema';
          entrada = await gravacaoRascunho(e, m, prof, at, todas.slice(0, 2), r, 5);
        } else {
          const r = rascunhoDe(
            await executarOutra(
              e,
              'pep.salvarRascunho',
              await gravacaoRascunho(e, m, prof, at, todas.slice(0, 2)),
              prof.login,
            ),
          );
          rascunho = r.id;
          if (cenario === 'recusa-colisao') {
            // Alterado "por fora" (outro terminal) depois de lido: a versão lida não vale mais.
            await executarOutra(
              e,
              'pep.salvarRascunho',
              await gravacaoRascunho(e, m, prof, at, todas.slice(0, 1), r),
              prof.login,
            );
            recusaEsperada = 'conflito-versao';
          }
          entrada = await gravacaoRascunho(e, m, prof, at, todas.slice(2, 5), r, 5);
        }
      },
      executar: rodar,
    };
  }
  if (nome === 'pep.descartarRascunho') {
    return {
      ...base,
      chavesAlvo: () => ({ PRCABEVOLTMP: alvo('ID_CABEVOL', rascunho) }),
      async preparar(e) {
        const { m, prof, at } = await preparar(e);
        const r = rascunhoDe(
          await executarOutra(
            e,
            'pep.salvarRascunho',
            await gravacaoRascunho(e, m, prof, at, respostasSinteticas(m.rep, { maximo: 2 })),
            prof.login,
          ),
        );
        rascunho = r.id;
        if (cenario === 'recusa-de-outro') {
          const outro = await profissional(e, m.id, prof);
          definirOperador(outro.login);
          recusaEsperada = 'rascunho-de-outro';
          entrada = { rascunho: r.id, versao: r.versao, cbo: outro.cbo };
        } else entrada = { rascunho: r.id, versao: r.versao, cbo: prof.cbo };
      },
      executar: rodar,
    };
  }
  if (nome === 'pep.suspenderEvolucao') {
    return {
      ...base,
      chavesAlvo: () => ({ PRCABEVOL: alvo('ID_CABEVOL', registro) }),
      async preparar(e) {
        const { m, prof, at } = await preparar(e);
        const respostas = respostasSinteticas(m.rep);
        const g = await executarOutra(
          e,
          'pep.registrarEvolucao',
          await gravacaoEvolucao(e, hospital, m, prof, at, respostas),
          prof.login,
        );
        registro = Number(g.resultado['registro']);
        entrada = await suspensaoDe(e, m, prof, at, respostas, registro);
        if (cenario === 'recusa-suspenso') {
          await executarOutra(e, 'pep.suspenderEvolucao', entrada, prof.login);
          recusaEsperada = 'ja-suspenso';
        }
      },
      executar: rodar,
    };
  }
  throw new Error(`Operação ${nome} sem reprodução.`);
}
