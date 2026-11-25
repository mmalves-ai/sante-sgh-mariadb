// Registro oncológico e radioterapia (09-AREA linha 69): as regras do registro do tumor (CID-10 com a morfologia da
// CID-O-3 e o comportamento coerente), do estadiamento TNM (UICC, 8ª edição) e do plano de radioterapia com as sessões
// (frações). Puro: a porta confere o banco (existência, estabelecimento, versão) e chama estas funções antes de gravar.
// Padrões públicos: TNM UICC 8ª edição; CID-O-3 (Registro Hospitalar de Câncer do INCA): o 5º dígito da morfologia é o
// comportamento (/0 benigno, /1 incerto, /2 in situ, /3 maligno primário, /6 metastático, /9 incerto se primário ou
// metastático); a dose em centigray (cGy), como no laudo de radioterapia do SUS e na guia TISS de radioterapia.

export const TIPOS_ESTADIAMENTO = [
  'clinico',
  'patologico',
  'pos_neoadjuvancia',
  'recidiva',
  'autopsia',
] as const;
export type TipoEstadiamento = (typeof TIPOS_ESTADIAMENTO)[number];
export const BASES_DIAGNOSTICO = [
  'clinica',
  'pesquisa_clinica',
  'exame_imagem',
  'marcador_tumoral',
  'citologia',
  'histologia_metastase',
  'histologia_primario',
  'autopsia',
  'ignorada',
] as const;
export type BaseDiagnostico = (typeof BASES_DIAGNOSTICO)[number];
export const LATERALIDADES_TUMOR = ['direita', 'esquerda', 'bilateral', 'nao_se_aplica', 'ignorada'] as const;
export type LateralidadeTumor = (typeof LATERALIDADES_TUMOR)[number];
export const TECNICAS_RADIOTERAPIA = [
  'convencional',
  'conformacional',
  'imrt',
  'vmat',
  'radiocirurgia',
  'sbrt',
  'braquiterapia',
  'outra',
] as const;
export type TecnicaRadioterapia = (typeof TECNICAS_RADIOTERAPIA)[number];
export const SITUACOES_PLANO_RT = [
  'em_planejamento',
  'aprovado',
  'em_andamento',
  'pausado',
  'interrompido',
  'concluido',
  'cancelado',
] as const;
export type SituacaoPlanoRt = (typeof SITUACOES_PLANO_RT)[number];
export const DESFECHOS_SESSAO_RT = ['realizada', 'falta', 'suspensa'] as const;
export type DesfechoSessaoRt = (typeof DESFECHOS_SESSAO_RT)[number];

export interface ErroCampoOnco {
  readonly campo: string;
  readonly mensagem: string;
}
const erro = (campo: string, mensagem: string): ErroCampoOnco => ({ campo, mensagem });
const dataValida = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

// ── Tumor: CID-10 × morfologia (CID-O-3) ─────────────────────────────────────────────────────────────────────────

/** "8140/3", "M8140/3" ou "81403" → "M8140/3"; null se não for um código de morfologia. */
export function normalizarMorfologia(codigo: string): string | null {
  const m = /^M?(\d{4})\/?([0-39])$/i.exec(codigo.trim());
  return m ? `M${m[1]}/${m[2]}` : null;
}

/** O comportamento que a CID-10 da neoplasia exige na morfologia (null: o capítulo não define). */
export function comportamentoDoCid(cid: string): readonly string[] | null {
  const c = cid.replace('.', '').toUpperCase();
  const cat = c.slice(0, 3);
  if (/^C(7[7-9]|80)$/.test(cat)) return ['3', '6', '9'];
  if (/^C\d\d$/.test(cat)) return ['3', '9'];
  if (/^D0\d$/.test(cat)) return ['2'];
  if (/^D(1\d|2\d|3[0-6])$/.test(cat)) return ['0'];
  if (/^D(3[7-9]|4[0-8])$/.test(cat)) return ['1'];
  return null;
}

/**
 * A categoria da topografia (CID-O-3) que o CID-10 do tumor exige; null quando a CID-10 não fixa o sítio.
 * - C00-C76 (sítio na própria CID-10): a mesma categoria (C50.4 → C50.x), exceto C43 (melanoma: pele, C44),
 *   C45 (mesotelioma) e C46 (Kaposi), cujo sítio vem da morfologia;
 * - C77 (linfonodos) → C77; C80 (primário desconhecido) → C80;
 * - C90-C96 (mieloma e leucemias) → C42 (sistema hematopoético);
 * - linfomas (C81-C86, C88), secundárias C78-C79, C97 e as neoplasias D: sem sítio fixo pelo CID.
 */
export function topografiasDoCid(cid: string): readonly string[] | null {
  const cat = cid.replace('.', '').toUpperCase().slice(0, 3);
  if (cat === 'C43') return ['C44'];
  if (/^C4[56]$/.test(cat)) return null;
  if (/^C([0-6]\d|7[0-7]|80)$/.test(cat)) return [cat];
  if (/^C9[0-6]$/.test(cat)) return ['C42'];
  return null;
}

export interface TumorEntrada {
  readonly cid: string;
  /** Topografia da CID-O-3 (C50.4); conferida contra a categoria do CID. */
  readonly topografia: string;
  readonly morfologia: string | null;
  readonly diagnosticadoEm: string;
  readonly baseDiagnostica: BaseDiagnostico;
  readonly lateralidade: LateralidadeTumor;
  readonly ecog: number | null;
}

/** As recusas do registro do tumor; `hoje` no fuso do estabelecimento. */
export function conferirTumor(t: TumorEntrada, hoje: string): ErroCampoOnco[] {
  const erros: ErroCampoOnco[] = [];
  const cat = t.cid.replace('.', '').toUpperCase().slice(0, 3);
  if (!/^(C\d\d|D0\d|D[1-3]\d|D4[0-8])$/.test(cat))
    erros.push(erro('cid', 'O CID do tumor tem de ser de neoplasia (C00 a D48).'));
  const topo = t.topografia.trim().toUpperCase();
  if (!/^C\d\d\.\d$/.test(topo))
    erros.push(erro('topografia', 'A topografia tem o formato C00.0 (CID-O-3).'));
  else {
    const aceitas = topografiasDoCid(t.cid);
    if (aceitas && !aceitas.includes(topo.slice(0, 3)))
      erros.push(
        erro(
          'topografia',
          `A topografia ${topo} não é do sítio do CID ${t.cid} (esperado ${aceitas.map((a) => `${a}.x`).join(' ou ')}).`,
        ),
      );
  }
  if (!dataValida(t.diagnosticadoEm)) erros.push(erro('diagnosticadoEm', 'Data do diagnóstico inválida.'));
  else if (t.diagnosticadoEm > hoje)
    erros.push(erro('diagnosticadoEm', 'A data do diagnóstico não pode ser futura.'));
  if (t.ecog !== null && (!Number.isInteger(t.ecog) || t.ecog < 0 || t.ecog > 5))
    erros.push(erro('ecog', 'O desempenho (ECOG) vai de 0 a 5.'));
  if (t.morfologia !== null) {
    const m = normalizarMorfologia(t.morfologia);
    if (!m) erros.push(erro('morfologia', 'A morfologia tem o formato M0000/0 (CID-O-3).'));
    else {
      const aceitos = comportamentoDoCid(t.cid);
      const comp = m.slice(-1);
      if (aceitos && !aceitos.includes(comp))
        erros.push(
          erro(
            'morfologia',
            `O comportamento /${comp} da morfologia não combina com o CID ${t.cid} (esperado /${aceitos.join(' ou /')}).`,
          ),
        );
    }
    const histologica = ['histologia_primario', 'histologia_metastase', 'autopsia', 'citologia'];
    if (m && !histologica.includes(t.baseDiagnostica) && t.baseDiagnostica !== 'ignorada' && m !== 'M8000/3')
      erros.push(
        erro(
          'baseDiagnostica',
          'Morfologia específica exige base citológica, histológica ou de autópsia; sem ela, use M8000/3 (neoplasia maligna).',
        ),
      );
  }
  if (['direita', 'esquerda', 'bilateral'].includes(t.lateralidade) && !ORGAOS_PARES.test(cat))
    erros.push(erro('lateralidade', 'A lateralidade só se aplica a órgão par.'));
  return erros;
}
/** Categorias da CID-10 de órgãos pares (mama, pulmão, rim, ovário, testículo, olho, membros, adrenal...). */
const ORGAOS_PARES =
  /^(C0[7-9]|C3[04]|C38|C40|C41|C44|C47|C49|C50|C56|C57|C62|C63|C64|C65|C66|C69|C74|C76|D0[3-5]|D1[1-6]|D2[2-4]|D2[7-9]|D3[0-5]|D4[0-8])$/;

// ── Estadiamento TNM (UICC 8ª edição) ───────────────────────────────────────────────────────────────────────────

const FORMA_T = /^(TX|T0|Tis|Ta|T[1-4][a-e]?(\(m\)|mi)?)$/;
const FORMA_N = /^(NX|N0|N[1-3][a-c]?(mi)?)$/;
const FORMA_M = /^(M0|M1[a-d]?)$/;

/** Tira o prefixo do tipo (c, p, yp, yc, r, a) e padroniza a caixa: "pT2a" → "T2a"; "tis" → "Tis". */
export function categoriaTnm(eixo: 'T' | 'N' | 'M', valor: string): string | null {
  let v = valor.trim().replace(/^(yp|yc|rp|rc|p|c|y|r|a)(?=[TNM])/i, '');
  if (!v) return null;
  v = v[0]!.toUpperCase() + v.slice(1);
  if (eixo === 'T' && /^tis$/i.test(v)) v = 'Tis';
  if (/^[TNM]x$/i.test(v)) v = v.toUpperCase();
  const forma = eixo === 'T' ? FORMA_T : eixo === 'N' ? FORMA_N : FORMA_M;
  return v.startsWith(eixo) && forma.test(v) ? v : null;
}

export interface EstadiamentoEntrada {
  readonly tipo: TipoEstadiamento;
  readonly data: string;
  readonly t: string;
  readonly n: string;
  readonly m: string;
  /** Grupo de estádio informado (código do cadastro: 0, I, IA, ..., IVC); null quando não se agrupa. */
  readonly estadio: string | null;
  /** Sítios das metástases (topografias da CID-O); obrigatório com M1. */
  readonly metastases: readonly string[];
}

/** O estádio que decorre só do TNM, independente da topografia (null: depende da tabela da localização). */
export function estadioDecorrente(t: string, n: string, m: string): string | null {
  if (m.startsWith('M1')) return 'IV';
  if ((t === 'Tis' || t === 'Ta') && n === 'N0' && m === 'M0') return '0';
  return null;
}

/**
 * As recusas do estadiamento. `diagnostico` é o do tumor (data e base). O estádio informado tem de ser coerente com o
 * TNM pelas regras universais da UICC: M1 é sempre estádio IV; estádio 0 só com Tis/Ta N0 M0. O agrupamento fino
 * (IA, IIB...) depende da tabela de cada localização e fica com o médico.
 */
export function conferirEstadiamento(
  e: EstadiamentoEntrada,
  diagnostico: { readonly diagnosticadoEm: string; readonly base: BaseDiagnostico },
  hoje: string,
): ErroCampoOnco[] {
  const erros: ErroCampoOnco[] = [];
  if (!dataValida(e.data)) erros.push(erro('data', 'Data do estadiamento inválida.'));
  else {
    if (e.data > hoje) erros.push(erro('data', 'A data do estadiamento não pode ser futura.'));
    if (e.data < diagnostico.diagnosticadoEm)
      erros.push(erro('data', 'O estadiamento não pode ser anterior ao diagnóstico do tumor.'));
  }
  const t = categoriaTnm('T', e.t);
  const n = categoriaTnm('N', e.n);
  const m = categoriaTnm('M', e.m);
  if (!t) erros.push(erro('t', 'Categoria T inválida (TX, T0, Tis, T1 a T4 com subdivisão).'));
  if (!n) erros.push(erro('n', 'Categoria N inválida (NX, N0, N1 a N3 com subdivisão).'));
  if (!m)
    erros.push(erro('m', 'Categoria M inválida (M0 ou M1 com subdivisão; MX não existe na 8ª edição).'));
  if (
    e.tipo === 'patologico' &&
    !['histologia_primario', 'histologia_metastase', 'autopsia'].includes(diagnostico.base)
  )
    erros.push(erro('tipo', 'O estadiamento patológico exige o diagnóstico por histologia.'));
  if (m?.startsWith('M1') && e.metastases.length === 0)
    erros.push(erro('metastases', 'Com M1, informe ao menos um sítio de metástase.'));
  if (m === 'M0' && e.metastases.length > 0)
    erros.push(erro('metastases', 'Com M0 não há sítio de metástase à distância: revise o M.'));
  if (t && n && m && e.estadio !== null) {
    const decorre = estadioDecorrente(t, n, m);
    if (m.startsWith('M1') && !e.estadio.startsWith('IV'))
      erros.push(erro('estadio', 'Com metástase à distância (M1), o estádio é IV.'));
    else if (e.estadio === '0' && decorre !== '0')
      erros.push(erro('estadio', 'Estádio 0 só com tumor in situ (Tis ou Ta), N0 e M0.'));
    else if (decorre === '0' && e.estadio !== '0')
      erros.push(erro('estadio', 'Tumor in situ sem linfonodo nem metástase é estádio 0.'));
  }
  return erros;
}

// ── Radioterapia: plano e sessões (frações) ─────────────────────────────────────────────────────────────────────

export interface PlanoRtEntrada {
  readonly tecnica: TecnicaRadioterapia;
  readonly doseTotalCgy: number;
  readonly doseFracaoCgy: number;
  readonly fracoesPrevistas: number;
  readonly fracoesPorSemana: number | null;
  readonly inicioPrevisto: string | null;
}
/** Acima disto por fração, só técnica de hipofracionamento extremo (radiocirurgia, SBRT, braquiterapia). */
export const DOSE_FRACAO_CONVENCIONAL_MAX_CGY = 800;

export function conferirPlanoRadioterapia(p: PlanoRtEntrada, hoje: string): ErroCampoOnco[] {
  const erros: ErroCampoOnco[] = [];
  if (!(p.doseTotalCgy > 0)) erros.push(erro('doseTotalCgy', 'A dose total tem de ser positiva.'));
  if (!(p.doseFracaoCgy > 0)) erros.push(erro('doseFracaoCgy', 'A dose por fração tem de ser positiva.'));
  if (!Number.isInteger(p.fracoesPrevistas) || p.fracoesPrevistas < 1)
    erros.push(erro('fracoesPrevistas', 'Informe o número de frações (1 ou mais).'));
  if (erros.length === 0 && Math.abs(p.doseFracaoCgy * p.fracoesPrevistas - p.doseTotalCgy) > 0.5)
    erros.push(
      erro(
        'doseTotalCgy',
        `Dose total (${p.doseTotalCgy} cGy) diferente de frações × dose por fração (${p.fracoesPrevistas} × ${p.doseFracaoCgy} = ${p.fracoesPrevistas * p.doseFracaoCgy} cGy).`,
      ),
    );
  if (
    p.doseFracaoCgy > DOSE_FRACAO_CONVENCIONAL_MAX_CGY &&
    !['radiocirurgia', 'sbrt', 'braquiterapia'].includes(p.tecnica)
  )
    erros.push(
      erro(
        'doseFracaoCgy',
        `Dose por fração acima de ${DOSE_FRACAO_CONVENCIONAL_MAX_CGY} cGy só em radiocirurgia, SBRT ou braquiterapia.`,
      ),
    );
  if (
    p.fracoesPorSemana !== null &&
    (!Number.isInteger(p.fracoesPorSemana) || p.fracoesPorSemana < 1 || p.fracoesPorSemana > 14)
  )
    erros.push(erro('fracoesPorSemana', 'Frações por semana vão de 1 a 14.'));
  if (p.inicioPrevisto !== null && (!dataValida(p.inicioPrevisto) || p.inicioPrevisto < hoje))
    erros.push(erro('inicioPrevisto', 'O início previsto é hoje ou depois.'));
  return erros;
}

// ── Quem confere e quem aplica a radioterapia (CBO 2002) ───────────────────────────────────────────────────────────

/** CBO do físico médico ("Físico (medicina)"), o responsável técnico que confere o planejamento. */
export const CBO_FISICO_MEDICO = '213150';
/** CBO do técnico e do tecnólogo em radiologia, que aplicam a fração no aparelho. */
export const CBOS_TECNICO_RADIOTERAPIA = ['324115', '324120'] as const;
const soDigitos = (cbo: string | null | undefined) => (cbo ?? '').replace(/\D/g, '');

/** O profissional é físico médico pelo CBO. */
export function ehFisicoMedico(cbo: string | null | undefined): boolean {
  return soDigitos(cbo) === CBO_FISICO_MEDICO;
}

/** Quem registra a sessão (fração aplicada): o médico, o físico médico ou o técnico/tecnólogo em radiologia. */
export function podeRegistrarSessaoRadioterapia(cbo: string | null | undefined): boolean {
  const c = soDigitos(cbo);
  return (
    c.startsWith('225') ||
    c === CBO_FISICO_MEDICO ||
    (CBOS_TECNICO_RADIOTERAPIA as readonly string[]).includes(c)
  );
}

/** Aprovação do plano: só em planejamento e com o físico médico que conferiu o planejamento. */
export function conferirAprovacaoPlano(situacao: SituacaoPlanoRt, temFisico: boolean): ErroCampoOnco[] {
  if (situacao !== 'em_planejamento') return [erro('situacao', 'Só o plano em planejamento é aprovado.')];
  if (!temFisico) return [erro('fisico', 'A aprovação exige o físico médico que conferiu o planejamento.')];
  return [];
}

/** Encerramento antes do fim (interrompido ou cancelado): com motivo, nunca de plano já encerrado. */
export function conferirEncerramentoPlano(situacao: SituacaoPlanoRt, motivo: string): ErroCampoOnco[] {
  if (['interrompido', 'concluido', 'cancelado'].includes(situacao))
    return [erro('situacao', 'O plano já está encerrado.')];
  if (!motivo.trim()) return [erro('motivo', 'Informe o motivo do encerramento.')];
  return [];
}

export interface SessaoRtEntrada {
  readonly desfecho: DesfechoSessaoRt;
  readonly doseAplicadaCgy: number | null;
  readonly motivo: string | null;
}
export interface PlanoRtAtual {
  readonly situacao: SituacaoPlanoRt;
  readonly doseTotalCgy: number;
  readonly doseFracaoCgy: number;
  readonly fracoesPrevistas: number;
  /** Frações já realizadas e a dose acumulada nelas. */
  readonly realizadas: number;
  readonly doseAcumuladaCgy: number;
}
/** Tolerância da dose acumulada sobre a total prescrita (5%), acima da qual a sessão é recusada. */
export const TOLERANCIA_DOSE_ACUMULADA = 0.05;

/**
 * Confere uma sessão e devolve a situação nova do plano: a 1ª realizada põe o plano em andamento; a que completa as
 * frações previstas o conclui. Sessão só de plano aprovado, em andamento ou pausado.
 */
export function conferirSessaoRadioterapia(
  plano: PlanoRtAtual,
  s: SessaoRtEntrada,
): { erros: ErroCampoOnco[]; situacaoPlano: SituacaoPlanoRt; doseAcumuladaCgy: number } {
  const erros: ErroCampoOnco[] = [];
  let situacaoPlano = plano.situacao;
  let acumulada = plano.doseAcumuladaCgy;
  if (!['aprovado', 'em_andamento', 'pausado'].includes(plano.situacao))
    erros.push(erro('plano', 'Sessão só de plano aprovado ou em andamento.'));
  if (s.desfecho === 'realizada') {
    if (s.doseAplicadaCgy === null || !(s.doseAplicadaCgy > 0))
      erros.push(erro('doseAplicadaCgy', 'Informe a dose aplicada na sessão.'));
    else {
      if (s.doseAplicadaCgy > plano.doseFracaoCgy * 1.1)
        erros.push(
          erro('doseAplicadaCgy', 'Dose aplicada acima de 110% da dose da fração: confira com o físico.'),
        );
      acumulada = plano.doseAcumuladaCgy + s.doseAplicadaCgy;
      if (acumulada > plano.doseTotalCgy * (1 + TOLERANCIA_DOSE_ACUMULADA))
        erros.push(
          erro(
            'doseAplicadaCgy',
            `A dose acumulada (${acumulada} cGy) passaria da dose total prescrita (${plano.doseTotalCgy} cGy).`,
          ),
        );
    }
    if (plano.realizadas >= plano.fracoesPrevistas)
      erros.push(erro('plano', 'Todas as frações previstas já foram realizadas.'));
    if (erros.length === 0)
      situacaoPlano = plano.realizadas + 1 >= plano.fracoesPrevistas ? 'concluido' : 'em_andamento';
  } else {
    if (!s.motivo?.trim()) erros.push(erro('motivo', 'Falta ou suspensão exige o motivo.'));
    if (s.doseAplicadaCgy !== null && s.doseAplicadaCgy !== 0)
      erros.push(erro('doseAplicadaCgy', 'Sessão não realizada não tem dose aplicada.'));
  }
  return { erros, situacaoPlano, doseAcumuladaCgy: acumulada };
}

/** Rótulo do TNM para a tela e o resumo: "cT2N1M0" (prefixo pelo tipo do estadiamento). */
export function rotuloTnm(tipo: TipoEstadiamento, t: string, n: string, m: string): string {
  const p =
    tipo === 'patologico'
      ? 'p'
      : tipo === 'pos_neoadjuvancia'
        ? 'yp'
        : tipo === 'recidiva'
          ? 'r'
          : tipo === 'autopsia'
            ? 'a'
            : 'c';
  return `${p}${t}${n}${m}`;
}
